fn main() {
  if std::env::var("DATANEX_LICENSE_SECRET").is_err() {
    println!("cargo:rustc-env-DATANEX_LICENSE_SECRET=change-me-in-production-32chars-min");
  }
  tauri_build::build()
}
