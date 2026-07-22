//! Standalone license key generator for DBManager.
//!
//! The generated key matches the validation in `src-tauri/src/license.rs`:
//!   normalized key = "DBM" + BODY + SIG
//!   SIG = HMAC-SHA256("DBM" + BODY)[..8]  (uppercase hex)
//!
//! IMPORTANT: Set the SAME secret the app is built with, e.g.
//!   DBMANAGER_LICENSE_SECRET=$(cat secret.txt) cargo run -p licensegen -- 5
//!
//! The app reads the secret from the build-time env var DBMANAGER_LICENSE_SECRET
//! (falling back to the DEFAULT_SECRET constant). Use the env var for both so they match.

use hmac::{Hmac, Mac};
use rand::Rng;
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

const PREFIX: &str = "DBM";

fn secret() -> String {
    std::env::var("DBMANAGER_LICENSE_SECRET")
        .unwrap_or_else(|_| "change-me-in-production-32chars-min".to_string())
}

fn sign(payload: &str) -> String {
    let mac = HmacSha256::new_from_slice(secret().as_bytes()).expect("valid key length");
    let mut mac = mac;
    mac.update(payload.as_bytes());
    let result = mac.finalize().into_bytes();
    result
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<String>()[..8]
        .to_string()
}

fn rand_body(len: usize) -> String {
    const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let body_len: usize = args
        .get(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(12);

    let body = rand_body(body_len);
    let sig = sign(&format!("{}{}", PREFIX, body));
    let normalized = format!("{}{}{}", PREFIX, body, sig);

    // Pretty-print with dashes (normalize() strips them, so any layout validates).
    // DBM-<body[0..4]>-<body[4..]>-<sig>
    let pretty = format!(
        "{}-{}-{}",
        &normalized[..4],
        &normalized[4..normalized.len() - 8],
        &normalized[normalized.len() - 8..]
    );

    println!("License key : {}", pretty);
    println!("Raw (no dashes): {}", normalized);
    println!("Secret used : {}", if std::env::var("DBMANAGER_LICENSE_SECRET").is_ok() { "<from env>" } else { "<DEFAULT_SECRET>" });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn normalize(key: &str) -> String {
        key.to_uppercase().replace([' ', '-', '\t', '\n'], "")
    }

    fn validate_key(key: &str) -> bool {
        let k = normalize(key);
        if !k.starts_with(PREFIX) || k.len() < PREFIX.len() + 8 { return false; }
        let body = &k[PREFIX.len()..k.len() - 8];
        let provided_sig = &k[k.len() - 8..];
        if body.is_empty() { return false; }
        sign(&format!("{}{}", PREFIX, body)) == provided_sig
    }

    #[test]
    fn generated_key_validates() {
        let body = rand_body(12);
        let sig = sign(&format!("{}{}", PREFIX, body));
        let key = format!("{}{}{}", PREFIX, body, sig);
        assert!(validate_key(&key));
        // dashed form also validates
        let pretty = format!("{}-{}-{}", &key[..4], &key[4..key.len()-8], &key[key.len()-8..]);
        assert!(validate_key(&pretty));
        // tampered signature fails
        let bad = format!("{}{}{}", PREFIX, body, "00000000");
        assert!(!validate_key(&bad));
    }
}
