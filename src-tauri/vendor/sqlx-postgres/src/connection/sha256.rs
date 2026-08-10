use crate::error::Error;
use crate::message::AuthenticationSha256Password;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Digest, Sha256};

type HmacSha1 = Hmac<Sha1>;

const CLIENT_KEY_LABEL: &[u8] = b"Client Key";
const SERVER_KEY_LABEL: &[u8] = b"Sever Key";

/// Candidate PBKDF2 iteration counts for openGauss' old protocol.
///
/// When the negotiated protocol minor version is below 50 the server does not
/// transmit the iteration count, so the client must reproduce the stored key
/// itself. `ITERATION_COUNT_V1` (2048) is used by the openGauss JDBC driver
/// for these old clients, while the server-side default (`ITERATION_COUNT`)
/// is 10000. We try both and disambiguate via the server signature.
const CANDIDATE_ITERATIONS: [u32; 2] = [2048, 10000];

/// Derive the openGauss sha256 password response.
///
/// This mirrors the `rfc5802_algorithm` in openGauss' client protocol
/// implementation. The wire response is an ASCII hex string which should be
/// sent back in a `PasswordMessage`.
pub fn rfc5802_algorithm(
    password: &[u8],
    body: &AuthenticationSha256Password,
) -> Result<Vec<u8>, Error> {
    // openGauss sends the salt/token as ASCII hex; decode to raw bytes.
    let salt = hex_decode(body.random64code())?;
    let token = hex_decode(body.token())?;

    // Determine the iteration count. New clients receive it on the wire; old
    // clients must derive it, using the server signature as a verifier.
    let iteration = match body.server_iteration() {
        Some(iteration) => iteration,
        None => {
            let signature = body.server_signature().ok_or_else(|| {
                err_protocol!("openGauss sha256 auth message carries neither an iteration count nor a server signature")
            })?;
            resolve_iteration(password, &salt, &token, signature)?
        }
    };

    // SaltedPassword := PBKDF2(password, salt, iterations, 32 bytes) using HMAC-SHA1.
    let mut salted_password = [0u8; 32];
    pbkdf2_hmac_sha1(password, &salt, iteration, &mut salted_password)?;

    // ClientKey := HMAC-SHA256(SaltedPassword, "Client Key")
    let mut mac = Hmac::<Sha256>::new_from_slice(&salted_password).map_err(Error::protocol)?;
    mac.update(CLIENT_KEY_LABEL);
    let client_key = mac.finalize().into_bytes();

    // StoredKey := SHA256(ClientKey)
    let stored_key = Sha256::digest(&client_key);

    // HMAC-SHA256(StoredKey, decoded token)
    let mut mac = Hmac::<Sha256>::new_from_slice(&stored_key).map_err(Error::protocol)?;
    mac.update(&token);
    let proof = mac.finalize().into_bytes();

    // Response := ClientKey XOR Proof, hex-encoded.
    let mut response = [0u8; 32];
    for i in 0..32 {
        response[i] = client_key[i] ^ proof[i];
    }

    Ok(hex_encode(&response))
}

/// Find the iteration count that reproduces the server's signature.
///
/// The server computes `sever_signature := HMAC-SHA256(ServerKey, token)`
/// where `ServerKey := HMAC-SHA256(SaltedPassword, "Sever Key")`. The client
/// derives the same value, so we try the known candidate iteration counts and
/// pick the first whose derived signature matches the transmitted one. This
/// both recovers the iteration used to store the password and confirms the
/// password itself is correct.
fn resolve_iteration(
    password: &[u8],
    salt: &[u8],
    token: &[u8],
    expected: &[u8; 64],
) -> Result<u32, Error> {
    let expected = hex_decode(expected)?;

    for iteration in CANDIDATE_ITERATIONS {
        let mut salted_password = [0u8; 32];
        pbkdf2_hmac_sha1(password, salt, iteration, &mut salted_password)?;

        // ServerKey := HMAC-SHA256(SaltedPassword, "Sever Key")
        let mut mac = Hmac::<Sha256>::new_from_slice(&salted_password).map_err(Error::protocol)?;
        mac.update(SERVER_KEY_LABEL);
        let server_key = mac.finalize().into_bytes();

        // sever_signature := HMAC-SHA256(ServerKey, token)
        let mut mac = Hmac::<Sha256>::new_from_slice(&server_key).map_err(Error::protocol)?;
        mac.update(token);
        let signature = mac.finalize().into_bytes();

        if signature.as_slice() == expected.as_slice() {
            log::debug!("openGauss sha256: candidate iteration {} matched server signature", iteration);
            return Ok(iteration);
        }
        log::debug!("openGauss sha256: candidate iteration {} did NOT match", iteration);
    }

    Err(err_protocol!(
        "openGauss sha256 authentication failed: no candidate iteration matched the server signature"
    ))
}

fn pbkdf2_hmac_sha1(
    password: &[u8],
    salt: &[u8],
    iterations: u32,
    out: &mut [u8],
) -> Result<(), Error> {
    let mut block = 1u32;
    let mut pos = 0usize;

    while pos < out.len() {
        let mut mac = HmacSha1::new_from_slice(password).map_err(Error::protocol)?;
        mac.update(salt);
        mac.update(&block.to_be_bytes());

        let mut u = mac.finalize().into_bytes();
        let mut t = u;

        for _ in 1..iterations {
            let mut mac = HmacSha1::new_from_slice(password).map_err(Error::protocol)?;
            mac.update(&u);
            u = mac.finalize().into_bytes();

            for (t_byte, u_byte) in t.iter_mut().zip(u.iter()) {
                *t_byte ^= u_byte;
            }
        }

        let len = (out.len() - pos).min(t.len());
        out[pos..pos + len].copy_from_slice(&t[..len]);

        pos += len;
        block += 1;
    }

    Ok(())
}

fn hex_decode(input: &[u8]) -> Result<Vec<u8>, Error> {
    if input.len() % 2 != 0 {
        return Err(err_protocol!("invalid hex payload"));
    }

    let mut out = Vec::with_capacity(input.len() / 2);
    for chunk in input.chunks(2) {
        let hi = hex_value(chunk[0])?;
        let lo = hex_value(chunk[1])?;
        out.push((hi << 4) | lo);
    }

    Ok(out)
}

fn hex_value(b: u8) -> Result<u8, Error> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        b'A'..=b'F' => Ok(b - b'A' + 10),
        _ => Err(err_protocol!("invalid hex character")),
    }
}

fn hex_encode(input: &[u8]) -> Vec<u8> {
    const HEX: &[u8; 16] = b"0123456789abcdef";

    let mut out = Vec::with_capacity(input.len() * 2);
    for &b in input {
        out.push(HEX[(b >> 4) as usize]);
        out.push(HEX[(b & 0x0f) as usize]);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rfc5802_algorithm_vector() {
        // Vector from opengauss-protocol's own test suite:
        // password = [1, 2, 3, 4], random64code = 64x '1', token = 8x '3',
        // server_iteration = 1.
        let body = AuthenticationSha256Password {
            random64code: [b'1'; 64],
            token: [b'3'; 8],
            server_signature: None,
            server_iteration: Some(1),
        };

        let result = rfc5802_algorithm(&[1, 2, 3, 4], &body).unwrap();

        assert_eq!(
            std::str::from_utf8(&result).unwrap(),
            "6308566b6ff5463d5bbcf7cbd95e2bf416a833994ea26d04d48f3b719d4b58fb"
        );
    }

    #[test]
    fn test_old_layout_with_server_signature() {
        // Old protocol: no iteration on the wire. The client must recover the
        // iteration from the server signature. We emulate the server by
        // deriving a signature for iteration 2048 and check the client picks
        // it up.
        let password = b"secret-password";
        let salt = [b'a'; 32];
        let token = [b'b'; 4];

        // ServerKey := HMAC-SHA256(PBKDF2(password, salt, 2048), "Sever Key")
        let mut salted = [0u8; 32];
        pbkdf2_hmac_sha1(password, &salt, 2048, &mut salted).unwrap();
        let mut mac = Hmac::<Sha256>::new_from_slice(&salted).unwrap();
        mac.update(SERVER_KEY_LABEL);
        let server_key = mac.finalize().into_bytes();
        let mut mac = Hmac::<Sha256>::new_from_slice(&server_key).unwrap();
        mac.update(&token);
        let signature = mac.finalize().into_bytes();

        let mut signature_hex = [0u8; 64];
        let hex = hex_encode(&signature);
        signature_hex.copy_from_slice(&hex);

        let body = AuthenticationSha256Password {
            random64code: {
                let hex = hex_encode(&salt);
                let mut r = [0u8; 64];
                r.copy_from_slice(&hex);
                r
            },
            token: {
                let hex = hex_encode(&token);
                let mut t = [0u8; 8];
                t.copy_from_slice(&hex);
                t
            },
            server_signature: Some(signature_hex),
            server_iteration: None,
        };

        let result = rfc5802_algorithm(password, &body).unwrap();
        assert_eq!(result.len(), 64);
    }

    #[test]
    fn test_hex_roundtrip() {
        let input = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
        let encoded = hex_encode(&input);
        assert_eq!(std::str::from_utf8(&encoded).unwrap(), "0123456789abcdef");

        let decoded = hex_decode(&encoded).unwrap();
        assert_eq!(decoded, input);
    }
}
