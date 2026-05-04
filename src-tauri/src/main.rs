#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod settings;
mod devices;
mod hotplug;
mod capture;
mod commands;

use std::sync::Arc;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{Emitter, Manager};
use crate::capture::CaptureBackend;
use crate::capture::mpv::MpvBackend;
use crate::commands::AppState;

fn main() {
    // Force the GTK webview onto XWayland. mpv embeds into our window via
    // the X11-only `--wid` flag, so the parent has to expose an X11 window
    // ID. WebKitGTK respects GDK_BACKEND; setting it before any Wayland or
    // X11 init in the process makes the webview an XWayland client without
    // affecting the rest of the system.
    std::env::set_var("GDK_BACKEND", "x11");

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,app=debug")),
        )
        .init();

    let backend = Arc::new(MpvBackend::new());
    let state = AppState { backend: backend.clone() };
    let backend_for_setup = backend.clone();

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
            commands::set_video_region,
        ])
        .setup(move |app| {
            crate::hotplug::spawn(app.handle().clone());

            // Resolve the main window's X11 ID and hand it to the backend
            // so future stream starts can use --wid for embedding.
            if let Some(win) = app.get_webview_window("main") {
                if let Some(xid) = x11_window_id(&win) {
                    tracing::info!(xid, "captured Tauri window X11 id for mpv --wid");
                    backend_for_setup.set_parent_xid(xid);
                } else {
                    tracing::warn!(
                        "could not resolve X11 window id — mpv will open as a sibling window"
                    );
                }
            }

            let backend_for_stats = backend_for_setup.clone();
            let app_handle_for_stats = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(500));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    interval.tick().await;
                    if backend_for_stats.is_running() {
                        if let Ok(s) = backend_for_stats.stats() {
                            let _ = app_handle_for_stats.emit("stream-stats", s);
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri run failed");
}

fn x11_window_id(win: &tauri::WebviewWindow) -> Option<u64> {
    let handle = win.window_handle().ok()?;
    match handle.as_raw() {
        RawWindowHandle::Xlib(x) => Some(x.window),
        RawWindowHandle::Xcb(x) => Some(x.window.get() as u64),
        _ => None,
    }
}
