#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;

fn main() {
    tauri::Builder::default()
        .manage(backend::BackendManager::new())
        .invoke_handler(tauri::generate_handler![
            backend::backend_start,
            backend::backend_stop,
            backend::backend_diagnostics,
            backend::open_output_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
