#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;

fn main() {
    tauri::Builder::default()
        .manage(backend::BackendManager::new())
        .invoke_handler(tauri::generate_handler![
            backend::backend_start,
            backend::backend_stop,
            backend::backend_diagnostics,
            backend::cookie_capture_and_commit,
            backend::open_output_folder,
            backend::settings_ensure_directory,
            backend::settings_write_config_atomic
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
