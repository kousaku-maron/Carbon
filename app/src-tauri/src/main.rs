#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
use tauri::Manager;

mod page_title;
mod pdf_export;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            pdf_export::start_note_pdf_export,
            page_title::fetch_page_title,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        match event {
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window("main") {
                    if let Err(error) = window.hide() {
                        eprintln!("failed to hide main window: {error}");
                    }
                }
            }
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    if !has_visible_windows {
                        if let Err(error) = window.show() {
                            eprintln!("failed to show main window: {error}");
                            return;
                        }
                    }
                    if let Err(error) = window.set_focus() {
                        eprintln!("failed to focus main window: {error}");
                    }
                }
            }
            _ => {}
        }

        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, event);
    });
}
