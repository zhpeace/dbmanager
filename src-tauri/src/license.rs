use std::path::PathBuf;
use sha2::Sha256;
use hmac::{Hmac, Mac};
use serde::Serialize;
use tauri::Manager;

type HmacSha256 = Hmac<Sha256>;

const LICENSE_PREFIX: &str = "DXN";
const DEFAULT_SECRET: &str = "change-me-in-production-32chars-min";

/// All database connectors supported by the application.
pub const ALL_CONNECTORS: &[&str] = &[
    "postgresql",
    "mysql",
    "sqlite",
    "mongodb",
    "redis",
    "oracle",
    "dameng",
];

/// Connectors available in the free tier. Everything else requires Pro.
pub const FREE_CONNECTORS: &[&str] = &["postgresql", "mysql", "sqlite", "redis"];

fn secret() -> String {
    std::env::var("DATANEX_LICENSE_SECRET").unwrap_or_else(|_| DEFAULT_SECRET.to_string())
}

fn app_license_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
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
    result
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<String>()[..8]
        .to_string()
}

fn validate_key(key: &str) -> bool {
    let k = normalize(key);
    // canonical form: DXN + BODY + SIG(8)  -> total >= 3 + 8 = 11
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

/// Licensing is bypassed in debug builds and when DATANEX_SKIP_LICENSE is set,
/// so developers / CI are never blocked by the activation gate.
fn bypass_active() -> bool {
    cfg!(debug_assertions) || std::env::var("DATANEX_SKIP_LICENSE").is_ok()
}

/// Returns the normalized, validated license key if a valid license is present.
fn load_valid_key(app: &tauri::AppHandle) -> Option<String> {
    if bypass_active() {
        return Some("DEV".to_string());
    }
    let path = app_license_path(app);
    std::fs::read_to_string(&path)
        .ok()
        .filter(|c| validate_key(c))
        .map(|c| normalize(&c))
}

pub fn is_activated(app: &tauri::AppHandle) -> bool {
    load_valid_key(app).is_some()
}

/// Feature entitlements derived from the activated license.
#[derive(Serialize, Clone, Default)]
pub struct Entitlements {
    pub tier: String,
    pub connectors: Vec<String>,
    pub ddl: bool,
    pub bulk: bool,
    pub export: bool,
    pub multi_connection: bool,
}

impl Entitlements {
    pub fn free() -> Self {
        Entitlements {
            tier: "free".to_string(),
            connectors: FREE_CONNECTORS.iter().map(|s| s.to_string()).collect(),
            ddl: false,
            bulk: false,
            export: false,
            multi_connection: false,
        }
    }

    pub fn pro() -> Self {
        Entitlements {
            tier: "pro".to_string(),
            connectors: ALL_CONNECTORS.iter().map(|s| s.to_string()).collect(),
            ddl: true,
            bulk: true,
            export: true,
            multi_connection: true,
        }
    }
}

#[allow(dead_code)]
pub fn entitlements(app: &tauri::AppHandle) -> Entitlements {
    if is_activated(app) {
        Entitlements::pro()
    } else {
        Entitlements::free()
    }
}

/// Returns Ok(()) when the Pro tier is active, otherwise an error.
pub fn require_pro(app: &tauri::AppHandle) -> Result<(), String> {
    if is_activated(app) {
        Ok(())
    } else {
        Err("此功能需要 Datanex Pro 版授权，请激活 License 后使用。".to_string())
    }
}

/// Gates a specific connector by tier. Free connectors are always allowed;
/// anything else requires an active Pro license.
pub fn require_connector(app: &tauri::AppHandle, connector: &str) -> Result<(), String> {
    let c = connector.to_lowercase();
    if FREE_CONNECTORS.contains(&c.as_str()) {
        Ok(())
    } else {
        require_pro(app)
    }
}

#[derive(Serialize, Clone)]
pub struct LicenseStatus {
    pub activated: bool,
    pub key: Option<String>,
    pub tier: String,
    pub entitlements: Entitlements,
}

#[tauri::command]
pub fn activate_license(app: tauri::AppHandle, key: String) -> Result<LicenseStatus, String> {
    if bypass_active() {
        return Ok(LicenseStatus {
            activated: true,
            key: Some(normalize(&key)),
            tier: "pro".to_string(),
            entitlements: Entitlements::pro(),
        });
    }
    if !validate_key(&key) {
        return Err("Invalid license key".to_string());
    }
    let path = app_license_path(&app);
    std::fs::write(&path, normalize(&key)).map_err(|e| e.to_string())?;
    Ok(LicenseStatus {
        activated: true,
        key: Some(normalize(&key)),
        tier: "pro".to_string(),
        entitlements: Entitlements::pro(),
    })
}

#[tauri::command]
pub fn get_license_status(app: tauri::AppHandle) -> LicenseStatus {
    if bypass_active() {
        return LicenseStatus {
            activated: true,
            key: Some("DEV".to_string()),
            tier: "pro".to_string(),
            entitlements: Entitlements::pro(),
        };
    }
    match load_valid_key(&app) {
        Some(key) => LicenseStatus {
            activated: true,
            key: Some(key),
            tier: "pro".to_string(),
            entitlements: Entitlements::pro(),
        },
        None => LicenseStatus {
            activated: false,
            key: None,
            tier: "free".to_string(),
            entitlements: Entitlements::free(),
        },
    }
}
