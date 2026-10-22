//! KWin blur-behind for the overlay window. KWin's blur effect reads
//! `_KDE_NET_WM_BLUR_BEHIND_REGION` (a CARDINAL list of x,y,w,h quads in
//! window-local physical pixels) and blurs whatever is stacked beneath
//! those rectangles — here, the main window with mpv's video. An empty
//! property means "blur the whole window", so "no blur" is expressed by
//! deleting the property instead.

use std::sync::Mutex;

use serde::Deserialize;
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt, PropMode};
use x11rb::wrapper::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;

/// A rounded rectangle in CSS pixels, as measured by the overlay webview.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct BlurRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub r: f64,
}

struct Target {
    conn: RustConnection,
    xid: u32,
    atom: u32,
}

#[derive(Default)]
pub struct Blur {
    target: Mutex<Option<Target>>,
}

impl Blur {
    /// Resolved on first use: the overlay's X11 window only exists once
    /// GTK realizes it, which happens after setup() returns.
    fn attach(window: &tauri::WebviewWindow) -> Result<Target, String> {
        let xid = crate::x11_window_id(window).ok_or("overlay has no X11 window")? as u32;
        let (conn, _) = x11rb::connect(None).map_err(|e| format!("x11 connect: {e}"))?;
        let atom = conn
            .intern_atom(false, b"_KDE_NET_WM_BLUR_BEHIND_REGION")
            .map_err(|e| e.to_string())?
            .reply()
            .map_err(|e| e.to_string())?
            .atom;
        Ok(Target { conn, xid, atom })
    }

    pub fn set_region(&self, window: &tauri::WebviewWindow, rects: &[BlurRect]) {
        let mut guard = self.target.lock().unwrap();
        if guard.is_none() {
            match Self::attach(window) {
                Ok(t) => *guard = Some(t),
                Err(e) => {
                    tracing::warn!(%e, "KWin blur unavailable");
                    return;
                }
            }
        }
        let Some(t) = guard.as_ref() else { return };
        let scale = window.scale_factor().unwrap_or(1.0);
        let quads: Vec<u32> = rects.iter().flat_map(|r| rounded_strips(r, scale)).collect();
        let res = if quads.is_empty() {
            t.conn.delete_property(t.xid, t.atom).map(|_| ())
        } else {
            t.conn
                .change_property32(PropMode::REPLACE, t.xid, t.atom, AtomEnum::CARDINAL, &quads)
                .map(|_| ())
        };
        if let Err(e) = res
            .map_err(|e| e.to_string())
            .and_then(|_| t.conn.flush().map_err(|e| e.to_string()))
        {
            tracing::warn!(%e, "failed to set blur region");
        }
    }
}

/// Approximate a rounded rectangle with axis-aligned strips so the blur
/// doesn't leak out past the CSS border-radius at the corners. Rows with
/// the same inset are merged, so a pill costs ~2r/3 quads, not 2r.
pub(crate) fn rounded_strips(rect: &BlurRect, scale: f64) -> Vec<u32> {
    let x = (rect.x * scale).round() as i64;
    let y = (rect.y * scale).round() as i64;
    let w = (rect.w * scale).round() as i64;
    let h = (rect.h * scale).round() as i64;
    if w <= 0 || h <= 0 || x < 0 || y < 0 {
        return Vec::new();
    }
    let r = ((rect.r * scale).round() as i64).clamp(0, w.min(h) / 2);
    let mut out = Vec::new();
    let mut push = |x: i64, y: i64, w: i64, h: i64| {
        if w > 0 && h > 0 {
            out.extend_from_slice(&[x as u32, y as u32, w as u32, h as u32]);
        }
    };
    let inset = |row: i64| -> i64 {
        let dy = r as f64 - row as f64 - 0.5;
        (r as f64 - (r as f64 * r as f64 - dy * dy).max(0.0).sqrt()).round() as i64
    };
    let mut row = 0;
    while row < r {
        let i = inset(row);
        let mut end = row + 1;
        while end < r && inset(end) == i {
            end += 1;
        }
        let n = end - row;
        push(x + i, y + row, w - 2 * i, n);
        push(x + i, y + h - end, w - 2 * i, n);
        row = end;
    }
    push(x, y + r, w, h - 2 * r);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(w: f64, h: f64, r: f64) -> BlurRect {
        BlurRect { x: 10.0, y: 20.0, w, h, r }
    }

    #[test]
    fn square_rect_is_one_quad() {
        assert_eq!(rounded_strips(&rect(100.0, 40.0, 0.0), 1.0), vec![10, 20, 100, 40]);
    }

    #[test]
    fn rounded_rect_stays_inside_bounds_and_covers_middle() {
        let q = rounded_strips(&rect(100.0, 40.0, 12.0), 1.0);
        assert_eq!(q.len() % 4, 0);
        let area: u32 = q.chunks(4).map(|c| c[2] * c[3]).sum();
        // Less than the bounding box, more than the box minus the four
        // corner squares.
        assert!(area < 100 * 40);
        assert!(area > 100 * 40 - 4 * 12 * 12);
        for c in q.chunks(4) {
            assert!(c[0] >= 10 && c[0] + c[2] <= 110);
            assert!(c[1] >= 20 && c[1] + c[3] <= 60);
        }
    }

    #[test]
    fn scale_applies_to_everything() {
        assert_eq!(rounded_strips(&rect(50.0, 20.0, 0.0), 2.0), vec![20, 40, 100, 40]);
    }
}
