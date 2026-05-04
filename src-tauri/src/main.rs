#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod settings;
mod devices;
mod hotplug;
mod capture;
mod commands;

use std::sync::Arc;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use crate::capture::CaptureBackend;
use crate::capture::mpv::MpvBackend;
use crate::commands::AppState;

fn main() {
    // Force the GTK webview onto XWayland. mpv embeds via the X11-only
    // --wid flag, and our overlay window uses XShape to define its input
    // region — both require X11 surfaces.
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
            commands::set_overlay_input_region,
            commands::set_video_visible,
        ])
        .setup(move |app| {
            crate::hotplug::spawn(app.handle().clone());

            // Wait for the main window's X11 surface to be realized, then
            // grab its ID + spawn a sibling overlay above it.
            let main_win = app.get_webview_window("main").unwrap();
            if let Some(xid) = x11_window_id(&main_win) {
                tracing::info!(xid, "captured main window X11 id for mpv child");
                backend_for_setup.set_parent_xid(xid);
            } else {
                tracing::warn!(
                    "could not resolve main window X11 id — embedded video unavailable"
                );
            }

            // Build the overlay window — a thin, always-on-top, transparent
            // strip pinned to the bottom-center of main that hosts the
            // floating control pill. By keeping it small (no transparent
            // middle to worry about), we don't need XShape input regions:
            // every pixel of the overlay is the pill, and pill catches
            // events naturally.
            let pos = main_win.outer_position().unwrap_or_default();
            let size = main_win.outer_size().unwrap_or_default();
            let overlay_w: u32 = 460;
            let overlay_h: u32 = 64;
            let overlay_x = pos.x + (size.width as i32 - overlay_w as i32) / 2;
            let overlay_y = pos.y + (size.height as i32 - overlay_h as i32 - 24);
            let overlay = WebviewWindowBuilder::new(
                app,
                "overlay",
                WebviewUrl::App("index.html".into()),
            )
            .title("Elgato Capture (overlay)")
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .accept_first_mouse(false)
            .position(overlay_x as f64, overlay_y as f64)
            .inner_size(overlay_w as f64, overlay_h as f64)
            .build()
            .expect("overlay window build failed");
            tracing::info!("overlay window created");
            if let Some(overlay_xid) = x11_window_id(&overlay) {
                backend_for_setup.set_overlay_xid(overlay_xid);
            }

            // Position-track: keep the overlay pinned to the bottom-center
            // of main on every move and resize.
            let overlay_for_track = overlay.clone();
            let main_win_for_track = main_win.clone();
            let reposition_overlay = move || {
                let pos = match main_win_for_track.outer_position() {
                    Ok(p) => p,
                    Err(_) => return,
                };
                let size = match main_win_for_track.outer_size() {
                    Ok(s) => s,
                    Err(_) => return,
                };
                let x = pos.x + (size.width as i32 - overlay_w as i32) / 2;
                let y = pos.y + (size.height as i32 - overlay_h as i32 - 24);
                let _ = overlay_for_track.set_position(tauri::PhysicalPosition::new(x, y));
            };
            let main_for_event = main_win.clone();
            main_win.on_window_event(move |event| match event {
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => reposition_overlay(),
                WindowEvent::CloseRequested { .. } => {
                    if let Some(overlay) = main_for_event.app_handle().get_webview_window("overlay")
                    {
                        let _ = overlay.close();
                    }
                }
                _ => {}
            });

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
