//! Rounded window corners. The video is an mpv X11 child window, which
//! CSS can't clip, so both toplevels get an XShape bounding region built
//! from the same rounded strips as the blur. Children are clipped to
//! their parent's shape, so mpv's corners round with main's.

use std::sync::Mutex;

use x11rb::connection::Connection;
use x11rb::protocol::shape::{self, ConnectionExt as _};
use x11rb::protocol::xproto::{AtomEnum, ClipOrdering, ConnectionExt as _, PropMode, Rectangle};
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;

use crate::blur::{rounded_strips, BlurRect};

/// Corner radius in CSS pixels.
const RADIUS: f64 = 14.0;

#[derive(Default)]
pub struct Shape {
    conn: Mutex<Option<RustConnection>>,
    opacity_atom: Mutex<Option<u32>>,
}

impl Shape {
    fn with_conn(&self, f: impl FnOnce(&RustConnection)) {
        let mut guard = self.conn.lock().unwrap();
        if guard.is_none() {
            match x11rb::connect(None) {
                Ok((c, _)) => *guard = Some(c),
                Err(e) => {
                    tracing::warn!(%e, "x11 connect failed");
                    return;
                }
            }
        }
        if let Some(conn) = guard.as_ref() {
            f(conn);
        }
    }

    /// Make `window` fully transparent (or restore it) through
    /// `_NET_WM_WINDOW_OPACITY`, which KWin applies at compositing time —
    /// no unmap, no focus change, no webview redraw.
    pub fn set_visible(&self, window: &tauri::WebviewWindow, visible: bool) {
        let Some(xid) = crate::x11_window_id(window) else { return };
        let xid = xid as u32;
        self.with_conn(|conn| {
            let mut atom = self.opacity_atom.lock().unwrap();
            if atom.is_none() {
                *atom = conn
                    .intern_atom(false, b"_NET_WM_WINDOW_OPACITY")
                    .ok()
                    .and_then(|c| c.reply().ok())
                    .map(|r| r.atom);
            }
            let Some(atom) = *atom else { return };
            let res = if visible {
                conn.delete_property(xid, atom).map(|_| ())
            } else {
                conn.change_property32(PropMode::REPLACE, xid, atom, AtomEnum::CARDINAL, &[0])
                    .map(|_| ())
            };
            if let Err(e) = res
                .map_err(|e| e.to_string())
                .and_then(|_| conn.flush().map_err(|e| e.to_string()))
            {
                tracing::warn!(%e, "failed to set window opacity");
            }
        });
    }

    /// Round `window`'s corners, or square them again when `rounded` is
    /// false (fullscreen / maximized). Silently skips windows GTK hasn't
    /// realized yet; the next resize catches them.
    pub fn apply(&self, window: &tauri::WebviewWindow, rounded: bool) {
        let Some(xid) = crate::x11_window_id(window) else { return };
        let Ok(size) = window.inner_size() else { return };
        let scale = window.scale_factor().unwrap_or(1.0);

        let xid = xid as u32;
        self.with_conn(|conn| {
            let res = if rounded {
                let rect = BlurRect {
                    x: 0.0,
                    y: 0.0,
                    w: size.width as f64,
                    h: size.height as f64,
                    r: RADIUS * scale,
                };
                let rects: Vec<Rectangle> = rounded_strips(&rect, 1.0)
                    .chunks(4)
                    .map(|q| Rectangle {
                        x: q[0] as i16,
                        y: q[1] as i16,
                        width: q[2] as u16,
                        height: q[3] as u16,
                    })
                    .collect();
                conn.shape_rectangles(
                    shape::SO::SET,
                    shape::SK::BOUNDING,
                    ClipOrdering::UNSORTED,
                    xid,
                    0,
                    0,
                    &rects,
                )
                .map(|_| ())
            } else {
                conn.shape_mask(shape::SO::SET, shape::SK::BOUNDING, xid, 0, 0, x11rb::NONE)
                    .map(|_| ())
            };
            if let Err(e) = res
                .map_err(|e| e.to_string())
                .and_then(|_| conn.flush().map_err(|e| e.to_string()))
            {
                tracing::warn!(%e, "failed to set window shape");
            }
        });
    }
}

/// Round both windows unless main fills the screen.
pub fn sync(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(main) = app.get_webview_window("main") else { return };
    let filled = main.is_fullscreen().unwrap_or(false) || main.is_maximized().unwrap_or(false);
    let shape = app.state::<Shape>();
    shape.apply(&main, !filled);
    if let Some(overlay) = app.get_webview_window("overlay") {
        shape.apply(&overlay, !filled);
    }
}
