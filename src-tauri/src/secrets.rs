use keyring::Entry;

const SERVICE: &str = "com.dbmanager.credentials";

pub fn save_secret(conn_id: &str, password: &str) -> Result<(), String> {
    if password.is_empty() {
        return Ok(());
    }
    let entry = Entry::new(SERVICE, conn_id).map_err(|e| e.to_string())?;
    entry.set_password(password).map_err(|e| e.to_string())
}

pub fn load_secret(conn_id: &str) -> Option<String> {
    let entry = Entry::new(SERVICE, conn_id).ok()?;
    entry.get_password().ok()
}

pub fn delete_secret(conn_id: &str) {
    if let Ok(entry) = Entry::new(SERVICE, conn_id) {
        let _ = entry.delete_credential();
    }
}

#[tauri::command]
pub fn save_connection_secret(id: String, password: String) -> Result<(), String> {
    save_secret(&id, &password)
}

#[tauri::command]
pub fn get_connection_secret(id: String) -> Option<String> {
    load_secret(&id)
}

#[tauri::command]
pub fn delete_connection_secret(id: String) -> Result<(), String> {
    delete_secret(&id);
    Ok(())
}
