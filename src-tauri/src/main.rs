#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod settings;
mod devices;
mod hotplug;
mod capture;
mod commands;

use std::sync::Arc;
use crate::capture::mpv::MpvBackend;
use crate::commands::AppState;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let state = AppState { backend: Arc::new(MpvBackend::new()) };

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::list_devices,
            commands::start_stream,
            commands::stop_stream,
            commands::set_mute,
            commands::set_volume,
            commands::get_stats,
            commands::take_screenshot,
            commands::default_settings,
        ])
        .setup(|app| {
            crate::hotplug::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri run failed");
}
