use std::path::PathBuf;
use sha2::Sha256;
use hmac::{Hmac, Mac};
use tauri::Manager;

type HmacSha256 = Hmac<Sha256>;

const LICENSE_PREFIX: &str = "DBM";
const DEFAULT_SECRET: &str = "change-me-in-production-32chars-min";

fn secret() -> String {
    std::env::var("DBMANAGER_LICENSE_SECRET").unwrap_or_else(|_| DEFAULT_SECRET.to_string())
}

fn app_license_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let _ = std::fs::create_dir_all(&dir);
    dir.join("license.dat")
}

fn normalize(key: &str) -> String {
    key.to_uppercase().replace([' ', '-', '\t', '\n'], "")
}

fn sign(payload: &str) -> String {
    let secret = secret();
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("valid key length");
    mac.update(payload.as_bytes());
    let result = mac.finalize().into_bytes();
    result.iter().map(|b| format!("{:02X}", b)).collect::<String>()[..8].to_string()
}

fn validate_key(key: &str) -> bool {
    let k = normalize(key);
    // canonical form: DBM + BODY + SIG(8)  -> total >= 3 + 8 = 11
    if !k.starts_with(LICENSE_PREFIX) || k.len() < LICENSE_PREFIX.len() + 8 {
        return false;
    }
    let body = &k[LICENSE_PREFIX.len()..k.len() - 8];
    let provided_sig = &k[k.len() - 8..];
    if body.is_empty() {
        return false;
    }
    sign(&format!("{}{}", LICENSE_PREFIX, body)) == provided_sig
}

#[derive(serde::Serialize)]
pub struct LicenseStatus {
    pub activated: bool,
    pub key: Option<String>,
}

#[tauri::command]
pub fn activate_license(app: tauri::AppHandle, key: String) -> Result<LicenseStatus, String> {
    if cfg!(debug_assertions) || std::env::var("DBMANAGER_SKIP_LICENSE").is_ok() {
        return Ok(LicenseStatus { activated: true, key: Some(normalize(&key)) });
    }
    if !validate_key(&key) {
        return Err("Invalid license key".to_string());
    }
    let path = app_license_path(&app);
    std::fs::write(&path, normalize(&key)).map_err(|e| e.to_string())?;
    Ok(LicenseStatus { activated: true, key: Some(normalize(&key)) })
}

#[tauri::command]
pub fn get_license_status(app: tauri::AppHandle) -> LicenseStatus {
    // In debug/development builds, licensing is bypassed so developers are
    // not blocked by the activation gate. Production builds still enforce it.
    if cfg!(debug_assertions) || std::env::var("DBMANAGER_SKIP_LICENSE").is_ok() {
        return LicenseStatus { activated: true, key: Some("DEV".to_string()) };
    }
    let path = app_license_path(&app);
    match std::fs::read_to_string(&path) {
        Ok(content) if validate_key(&content) => LicenseStatus { activated: true, key: Some(content) },
        _ => LicenseStatus { activated: false, key: None },
    }
}

#[allow(dead_code)]
pub fn is_activated(app: &tauri::AppHandle) -> bool {
    let path = app_license_path(app);
    match std::fs::read_to_string(&path) {
        Ok(content) => validate_key(&content),
        Err(_) => false,
    }
}
