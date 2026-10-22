#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod settings;
mod devices;
mod hotplug;
mod capture;
mod commands;
mod blur;
mod shape;

use std::sync::Arc;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use crate::capture::CaptureBackend;
use crate::capture::mpv::MpvBackend;
use crate::commands::AppState;

fn main() {
    // Force the GTK webview onto XWayland. mpv embeds via the X11-only
    // --wid flag, and the rounded corners and KWin blur are X11 window
    // properties — all require X11 surfaces.
    std::env::set_var("GDK_BACKEND", "x11");
    // WebKitGTK's DMA-BUF renderer fails GBM allocation on some GPU/Mesa
    // combos and leaves the window blank, so hand it shared-memory buffers
    // instead. (Disabling the renderer outright falls back to a path that
    // never clears pixels that turn transparent, so the overlay ghosts.)
    // Respect an explicit override.
    if std::env::var_os("WEBKIT_DMABUF_RENDERER_FORCE_SHM").is_none() {
        std::env::set_var("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1");
    }

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .manage(blur::Blur::default())
        .manage(shape::Shape::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_devices,
            commands::start_stream,
            commands::stop_stream,
            commands::set_mute,
            commands::set_volume,
            commands::get_stats,
            commands::take_screenshot,
            commands::default_settings,
            commands::set_blur_region,
        ])
        .setup(move |app| {
            crate::hotplug::spawn(app.handle().clone());

            let main_win = app.get_webview_window("main").unwrap();
            if let Some(xid) = x11_window_id(&main_win) {
                tracing::info!(xid, "captured main window X11 id for mpv child");
                backend_for_setup.set_parent_xid(xid);
            } else {
                tracing::warn!(
                    "could not resolve main window X11 id — embedded video unavailable"
                );
            }
            if let Ok(size) = main_win.inner_size() {
                backend_for_setup.set_region(size.width, size.height, 0, 0);
            }

            // mpv's X11 child always stacks above anything the main
            // webview draws, so the UI lives in a second, transparent
            // window kept exactly on top of main. Being transient for
            // main keeps it above main (fullscreen included) without
            // being always-on-top over other apps, and lets KWin blur
            // the video beneath its glass panels.
            let overlay = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("index.html".into()))
                .title("Mira")
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .skip_taskbar(true)
                .resizable(false)
                .visible(false)
                .transient_for(&main_win)?
                .build()?;
            if let Ok(pos) = main_win.inner_position() {
                let _ = overlay.set_position(pos);
            }
            if let Ok(size) = main_win.inner_size() {
                let _ = overlay.set_size(size);
            }
            overlay.show()?;
            overlay.set_focus()?;

            let backend_for_events = backend_for_setup.clone();
            let overlay_for_main = overlay.clone();
            let settle = Arc::new(std::sync::atomic::AtomicU64::new(0));
            main_win.on_window_event(move |event| match event {
                WindowEvent::Moved(p) => {
                    let _ = overlay_for_main.set_position(*p);
                    settle_overlay(&overlay_for_main, &settle);
                }
                WindowEvent::Resized(s) => {
                    let _ = overlay_for_main.set_size(*s);
                    settle_overlay(&overlay_for_main, &settle);
                    backend_for_events.set_region(s.width, s.height, 0, 0);
                    shape::sync(overlay_for_main.app_handle());
                }
                // Hotkeys live in the overlay; hand focus back to it
                // when the user activates main from the taskbar.
                WindowEvent::Focused(true) => {
                    let _ = overlay_for_main.set_focus();
                }
                WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
                    overlay_for_main.app_handle().exit(0);
                }
                _ => {}
            });
            let handle_for_overlay = app.handle().clone();
            overlay.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { .. } => handle_for_overlay.exit(0),
                // The overlay realizes after setup, so its first resize
                // is the earliest point its corners can be rounded.
                WindowEvent::Resized(_) => shape::sync(&handle_for_overlay),
                _ => {}
            });
            shape::sync(app.handle());

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

/// Following main is a round trip through the window manager per move,
/// so tracking it live leaves the overlay visibly trailing a fast drag.
/// The overlay still follows, but invisibly: it goes transparent as soon
/// as main starts moving or resizing, and once main has been still for a
/// moment it snaps to main's actual geometry and reappears.
fn settle_overlay(overlay: &tauri::WebviewWindow, generation: &Arc<std::sync::atomic::AtomicU64>) {
    use std::sync::atomic::Ordering;
    let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;
    overlay.app_handle().state::<shape::Shape>().set_visible(overlay, false);
    let overlay = overlay.clone();
    let generation = generation.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(120));
        if generation.load(Ordering::SeqCst) != mine {
            return;
        }
        if let Some(main) = overlay.app_handle().get_webview_window("main") {
            if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
                let _ = overlay.set_position(pos);
                let _ = overlay.set_size(size);
            }
        }
        // Let the move land before revealing, or the first frame shows
        // the overlay at its old spot.
        std::thread::sleep(std::time::Duration::from_millis(30));
        if generation.load(Ordering::SeqCst) == mine {
            overlay.app_handle().state::<shape::Shape>().set_visible(&overlay, true);
        }
    });
}

pub(crate) fn x11_window_id(win: &tauri::WebviewWindow) -> Option<u64> {
    let handle = win.window_handle().ok()?;
    match handle.as_raw() {
        RawWindowHandle::Xlib(x) => Some(x.window),
        RawWindowHandle::Xcb(x) => Some(x.window.get() as u64),
        _ => None,
    }
}
