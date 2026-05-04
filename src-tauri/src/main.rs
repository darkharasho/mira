#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod settings;
mod devices;
mod hotplug;
mod capture;
mod commands;

use std::sync::Arc;
use tauri::{Emitter, Manager};
use crate::capture::CaptureBackend;
use crate::capture::mpv::MpvBackend;
use crate::commands::AppState;

async fn run_kwin_keepbelow_script() -> Result<(), zbus::Error> {
    let conn = zbus::Connection::session().await?;
    let proxy = zbus::Proxy::new(
        &conn,
        "org.kde.KWin",
        "/Scripting",
        "org.kde.kwin.Scripting",
    )
    .await?;
    // Sleep briefly so the mpv window is mapped before the script runs.
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    let script = r#"
        workspace.windowList().forEach(function(w) {
            if (w.resourceClass === "mpv" && w.caption === "elgato-capture-video") {
                w.keepBelow = true;
                w.noBorder = true;
            }
        });
    "#;
    let id: i32 = proxy
        .call("loadScript", &(script, "elgato-capture-pos-lock"))
        .await?;
    let _ = proxy.call_method("start", &(id,)).await?;
    Ok(())
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
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
        ])
        .setup(move |app| {
            crate::hotplug::spawn(app.handle().clone());

            let win = app.get_webview_window("main").unwrap();
            let backend_for_track = backend_for_setup.clone();
            let win_for_event = win.clone();
            win.on_window_event(move |event| {
                use tauri::WindowEvent;
                match event {
                    WindowEvent::Moved(p) => {
                        if let Ok(size) = win_for_event.outer_size() {
                            let geom = format!(
                                "{}x{}+{}+{}",
                                size.width, size.height, p.x, p.y
                            );
                            let _ = backend_for_track.set_geometry(&geom);
                        }
                    }
                    WindowEvent::Resized(s) => {
                        if let Ok(pos) = win_for_event.outer_position() {
                            let geom = format!(
                                "{}x{}+{}+{}",
                                s.width, s.height, pos.x, pos.y
                            );
                            let _ = backend_for_track.set_geometry(&geom);
                        }
                    }
                    _ => {}
                }
            });

            tauri::async_runtime::spawn(async move {
                if let Err(e) = run_kwin_keepbelow_script().await {
                    tracing::warn!("KWin script failed (non-fatal): {e}");
                }
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
