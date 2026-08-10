use std::str::from_utf8;

use memchr::memchr;
use sqlx_core::bytes::{Buf, Bytes};

use crate::error::Error;
use crate::io::ProtocolDecode;

use crate::message::{BackendMessage, BackendMessageFormat};
use base64::prelude::{Engine as _, BASE64_STANDARD};
// On startup, the server sends an appropriate authentication request message,
// to which the frontend must reply with an appropriate authentication
// response message (such as a password).

// For all authentication methods except GSSAPI, SSPI and SASL, there is at
// most one request and one response. In some methods, no response at all is
// needed from the frontend, and so no authentication request occurs.

// For GSSAPI, SSPI and SASL, multiple exchanges of packets may
// be needed to complete the authentication.

// <https://www.postgresql.org/docs/devel/protocol-flow.html#id-1.10.5.7.3>
// <https://www.postgresql.org/docs/devel/protocol-message-formats.html>

#[derive(Debug)]
pub enum Authentication {
    /// The authentication exchange is successfully completed.
    Ok,

    /// The frontend must now send a [PasswordMessage] containing the
    /// password in clear-text form.
    CleartextPassword,

    /// The frontend must now send a [PasswordMessage] containing the
    /// password (with user name) encrypted via MD5, then encrypted
    /// again using the 4-byte random salt.
    Md5Password(AuthenticationMd5Password),

    /// openGauss-specific sha256 password authentication.
    ///
    /// openGauss reuses the PostgreSQL AuthenticationSASL message type (10)
    /// but prefixes the payload with an inner discriminator. When the
    /// discriminator is `0` or `2` the remainder is a 64-byte random hex
    /// salt, an 8-byte token and, depending on the negotiated protocol
    /// minor version, either a 64-byte server signature (old clients,
    /// minor < 50) or a 4-byte big-endian iteration count (new clients,
    /// minor > 50). When it is `1` the remainder is a 4-byte md5 salt.
    Sha256Password(AuthenticationSha256Password),

    /// The frontend must now initiate a SASL negotiation,
    /// using one of the SASL mechanisms listed in the message.
    ///
    /// The frontend will send a [SaslInitialResponse] with the name
    /// of the selected mechanism, and the first part of the SASL
    /// data stream in response to this.
    ///
    /// If further messages are needed, the server will
    /// respond with [Authentication::SaslContinue].
    Sasl(AuthenticationSasl),

    /// This message contains challenge data from the previous step of SASL negotiation.
    ///
    /// The frontend must respond with a [SaslResponse] message.
    SaslContinue(AuthenticationSaslContinue),

    /// SASL authentication has completed with additional mechanism-specific
    /// data for the client.
    ///
    /// The server will next send [Authentication::Ok] to
    /// indicate successful authentication.
    SaslFinal(AuthenticationSaslFinal),
}

impl BackendMessage for Authentication {
    const FORMAT: BackendMessageFormat = BackendMessageFormat::Authentication;

    fn decode_body(mut buf: Bytes) -> Result<Self, Error> {
        log::debug!("auth msg raw: {:?}", &buf[..]);
        Ok(match buf.get_u32() {
            0 => Authentication::Ok,

            3 => Authentication::CleartextPassword,

            5 => {
                let mut salt = [0; 4];
                buf.copy_to_slice(&mut salt);

                Authentication::Md5Password(AuthenticationMd5Password { salt })
            }

            10 => {
                // openGauss reuses this SASL message type, but its payload
                // begins with an inner discriminator instead of the SASL
                // mechanism list. A real PostgreSQL SASL payload always starts
                // with a printable mechanism name (e.g. "SCRAM-SHA-256"), whose
                // first four bytes as a big-endian integer are far larger than
                // the small discriminator values used by openGauss, so we can
                // safely distinguish the two.
                let mut probe = buf.clone();

                match probe.get_i32() {
                    0 | 2 => {
                        // Consume the discriminator from the real buffer too.
                        buf.get_i32();

                        let mut random64code = [0; 64];
                        let mut token = [0; 8];

                        buf.copy_to_slice(&mut random64code);
                        buf.copy_to_slice(&mut token);

                        // The openGauss server selects the payload layout based on
                        // the client's negotiated protocol minor version:
                        //   - minor < 50 (e.g. sqlx's protocol 3.0): a 64-byte
                        //     ASCII hex server signature follows the token.
                        //   - minor == 50: nothing follows the token.
                        //   - minor > 50: a 4-byte big-endian iteration count
                        //     follows the token.
                        let remaining = buf.remaining();
                        let server_signature = if remaining >= 64 {
                            let mut signature = [0; 64];
                            buf.copy_to_slice(&mut signature);
                            Some(signature)
                        } else {
                            None
                        };

                        let server_iteration = if remaining == 4 {
                            Some(buf.get_u32())
                        } else {
                            None
                        };

                        Authentication::Sha256Password(AuthenticationSha256Password {
                            random64code,
                            token,
                            server_signature,
                            server_iteration,
                        })
                    }
                    1 => {
                        // Consume the discriminator from the real buffer too.
                        buf.get_i32();

                        let mut salt = [0; 4];
                        buf.copy_to_slice(&mut salt);

                        Authentication::Md5Password(AuthenticationMd5Password { salt })
                    }
                    _ => Authentication::Sasl(AuthenticationSasl(buf)),
                }
            }
            11 => Authentication::SaslContinue(AuthenticationSaslContinue::decode(buf)?),
            12 => Authentication::SaslFinal(AuthenticationSaslFinal::decode(buf)?),

            ty => {
                return Err(err_protocol!("unknown authentication method: {}", ty));
            }
        })
    }
}

/// Body of [Authentication::Md5Password].
#[derive(Debug)]
pub struct AuthenticationMd5Password {
    pub salt: [u8; 4],
}

/// Body of [Authentication::Sha256Password].
#[derive(Debug)]
pub struct AuthenticationSha256Password {
    pub random64code: [u8; 64],
    pub token: [u8; 8],
    pub server_signature: Option<[u8; 64]>,
    pub server_iteration: Option<u32>,
}

impl AuthenticationSha256Password {
    #[inline]
    pub fn random64code(&self) -> &[u8; 64] {
        &self.random64code
    }

    #[inline]
    pub fn token(&self) -> &[u8; 8] {
        &self.token
    }

    #[inline]
    pub fn server_signature(&self) -> Option<&[u8; 64]> {
        self.server_signature.as_ref()
    }

    #[inline]
    pub fn server_iteration(&self) -> Option<u32> {
        self.server_iteration
    }
}

/// Body of [Authentication::Sasl].
#[derive(Debug)]
pub struct AuthenticationSasl(Bytes);

impl AuthenticationSasl {
    #[inline]
    pub fn mechanisms(&self) -> SaslMechanisms<'_> {
        SaslMechanisms(&self.0)
    }
}

/// An iterator over the SASL authentication mechanisms provided by the server.
pub struct SaslMechanisms<'a>(&'a [u8]);

impl<'a> Iterator for SaslMechanisms<'a> {
    type Item = &'a str;

    fn next(&mut self) -> Option<Self::Item> {
        if !self.0.is_empty() && self.0[0] == b'\0' {
            return None;
        }

        let mechanism = memchr(b'\0', self.0).and_then(|nul| from_utf8(&self.0[..nul]).ok())?;

        self.0 = &self.0[(mechanism.len() + 1)..];

        Some(mechanism)
    }
}

#[derive(Debug)]
pub struct AuthenticationSaslContinue {
    pub salt: Vec<u8>,
    pub iterations: u32,
    pub nonce: String,
    pub message: String,
}

impl ProtocolDecode<'_> for AuthenticationSaslContinue {
    fn decode_with(buf: Bytes, _: ()) -> Result<Self, Error> {
        let mut iterations: u32 = 4096;
        let mut salt = Vec::new();
        let mut nonce = Bytes::new();

        // [Example]
        // r=/z+giZiTxAH7r8sNAeHr7cvpqV3uo7G/bJBIJO3pjVM7t3ng,s=4UV68bIkC8f9/X8xH7aPhg==,i=4096

        for item in buf.split(|b| *b == b',') {
            let key = item[0];
            let value = &item[2..];

            match key {
                b'r' => {
                    nonce = buf.slice_ref(value);
                }

                b'i' => {
                    iterations = atoi::atoi(value).unwrap_or(4096);
                }

                b's' => {
                    salt = BASE64_STANDARD.decode(value).map_err(Error::protocol)?;
                }

                _ => {}
            }
        }

        Ok(Self {
            iterations,
            salt,
            nonce: from_utf8(&nonce).map_err(Error::protocol)?.to_owned(),
            message: from_utf8(&buf).map_err(Error::protocol)?.to_owned(),
        })
    }
}

#[derive(Debug)]
pub struct AuthenticationSaslFinal {
    pub verifier: Vec<u8>,
}

impl ProtocolDecode<'_> for AuthenticationSaslFinal {
    fn decode_with(buf: Bytes, _: ()) -> Result<Self, Error> {
        let mut verifier = Vec::new();

        for item in buf.split(|b| *b == b',') {
            let key = item[0];
            let value = &item[2..];

            if let b'v' = key {
                verifier = BASE64_STANDARD.decode(value).map_err(Error::protocol)?;
            }
        }

        Ok(Self { verifier })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode_authentication(payload: &[u8]) -> Authentication {
        // `decode_body` expects the first u32 to be the auth type code.
        let mut bytes = Bytes::copy_from_slice(payload);
        Authentication::decode_body(bytes.split_to(bytes.len())).unwrap()
    }

    #[test]
    fn test_standard_sasl_mechanism_list() {
        // A real PostgreSQL SASL payload: auth type 10 + null-terminated
        // mechanism list.
        let payload = b"\x00\x00\x00\x0aSCRAM-SHA-256\0SCRAM-SHA-256-PLUS\0";

        match decode_authentication(payload) {
            Authentication::Sasl(body) => {
                let mechanisms: Vec<&str> = body.mechanisms().collect();
                assert_eq!(mechanisms, vec!["SCRAM-SHA-256", "SCRAM-SHA-256-PLUS"]);
            }
            other => panic!("expected Sasl, got {:?}", other),
        }
    }

    #[test]
    fn test_opengauss_sha256_old_layout() {
        // Old protocol (minor < 50): auth type 10 + discriminator 0 + 64-byte
        // random salt + 8-byte token + 64-byte server signature. No iteration.
        let mut payload = Vec::new();
        payload.extend_from_slice(&10i32.to_be_bytes());
        payload.extend_from_slice(&0i32.to_be_bytes());
        payload.extend_from_slice(&[b'1'; 64]);
        payload.extend_from_slice(&[b'3'; 8]);
        payload.extend_from_slice(&[b'7'; 64]);

        match decode_authentication(&payload) {
            Authentication::Sha256Password(body) => {
                assert_eq!(body.random64code(), &[b'1'; 64]);
                assert_eq!(body.token(), &[b'3'; 8]);
                assert_eq!(body.server_signature(), Some(&[b'7'; 64]));
                assert_eq!(body.server_iteration(), None);
            }
            other => panic!("expected Sha256Password, got {:?}", other),
        }
    }

    #[test]
    fn test_opengauss_sha256_new_layout() {
        // New protocol (minor > 50): auth type 10 + discriminator 2 +
        // 64-byte random salt + 8-byte token + 4-byte iteration count.
        let mut payload = Vec::new();
        payload.extend_from_slice(&10i32.to_be_bytes());
        payload.extend_from_slice(&2i32.to_be_bytes());
        payload.extend_from_slice(&[b'1'; 64]);
        payload.extend_from_slice(&[b'3'; 8]);
        payload.extend_from_slice(&10000i32.to_be_bytes());

        match decode_authentication(&payload) {
            Authentication::Sha256Password(body) => {
                assert_eq!(body.random64code(), &[b'1'; 64]);
                assert_eq!(body.token(), &[b'3'; 8]);
                assert_eq!(body.server_signature(), None);
                assert_eq!(body.server_iteration(), Some(10000));
            }
            other => panic!("expected Sha256Password, got {:?}", other),
        }
    }

    #[test]
    fn test_opengauss_md5_discriminator_1() {
        // openGauss md5 fallback: auth type 10 + discriminator 1 + 4-byte salt.
        let mut payload = Vec::new();
        payload.extend_from_slice(&10i32.to_be_bytes());
        payload.extend_from_slice(&1i32.to_be_bytes());
        payload.extend_from_slice(&[1, 2, 3, 4]);

        match decode_authentication(&payload) {
            Authentication::Md5Password(body) => {
                assert_eq!(body.salt, [1, 2, 3, 4]);
            }
            other => panic!("expected Md5Password, got {:?}", other),
        }
    }
}
