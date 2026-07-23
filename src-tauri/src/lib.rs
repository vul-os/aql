// Aql — the mind. Rust core behind the Tauri bridge.
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

#[derive(serde::Serialize)]
struct SystemPulse {
    os: String,
    arch: String,
    family: String,
    cores: usize,
    version: String,
}

/// Minimal host telemetry — proves the front-end <-> Rust bridge.
/// The device/telemetry engine will grow behind this seam.
#[tauri::command]
fn system_pulse() -> SystemPulse {
    SystemPulse {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        family: std::env::consts::FAMILY.to_string(),
        cores: std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(0),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![system_pulse])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
