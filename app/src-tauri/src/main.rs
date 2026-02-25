#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_os::init())
    .plugin(tauri_plugin_opener::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
