// Aql desktop shell — a thin Tauri v2 wrapper around the portal SPA.
// Nearly all application logic lives in the web frontend; the shell provides
// the window, the CORS-free HTTP plugin used to reach arbitrary gateways, and
// a single host-telemetry IPC command.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[derive(serde::Serialize)]
struct SystemPulse {
    os: String,
    arch: String,
    family: String,
    cores: usize,
    version: String,
}

/// Minimal host telemetry — proves the front-end <-> Rust bridge.
/// The device/telemetry engine (ROADMAP Phase 1) will grow behind this seam;
/// today this is the only thing on the Rust side of the IPC boundary.
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

fn main() {
    tauri::Builder::default()
        // Native fetch for the webview — gateways enforce a CORS allowlist that
        // can never include the Tauri origin, so all API traffic goes through
        // this plugin (see src/lib/hub.ts). Do not remove.
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![system_pulse])
        .run(tauri::generate_context!())
        .expect("error while running Aql");
}
