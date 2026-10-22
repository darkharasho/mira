//! Child X11 window owned by us, sized to wherever the React layout
//! says the video should render. mpv embeds into this child via --wid
//! instead of the Tauri top-level — that's the only way to keep mpv
//! from filling the entire window (mpv ignores --geometry under --wid).

use std::sync::Mutex;

use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    ConfigureWindowAux, ConnectionExt, CreateWindowAux, EventMask, WindowClass,
};
use x11rb::rust_connection::RustConnection;
use x11rb::COPY_FROM_PARENT;

pub struct X11Child {
    conn: RustConnection,
    pub xid: u32,
    rect: Mutex<Option<(u32, u32, i32, i32)>>,
}

impl X11Child {
    /// Create a new child window of `parent`. It starts at 1x1 in the
    /// top-left and is mapped immediately so mpv can attach to it.
    pub fn create(parent: u32) -> Result<Self, String> {
        let (conn, _) = x11rb::connect(None)
            .map_err(|e| format!("x11 connect: {e}"))?;
        let xid = conn.generate_id().map_err(|e| format!("x11 gen id: {e}"))?;

        // Use COPY_FROM_PARENT for visual + depth so the child matches
        // whatever the Tauri window already negotiated.
        let aux = CreateWindowAux::default()
            .background_pixel(0)
            .border_pixel(0)
            .event_mask(EventMask::EXPOSURE);

        conn.create_window(
            COPY_FROM_PARENT as u8,
            xid,
            parent,
            0, 0, 1, 1, 0,
            WindowClass::INPUT_OUTPUT,
            COPY_FROM_PARENT,
            &aux,
        )
        .map_err(|e| format!("x11 create_window: {e}"))?;

        conn.map_window(xid)
            .map_err(|e| format!("x11 map_window: {e}"))?;
        conn.flush().map_err(|e| format!("x11 flush: {e}"))?;

        tracing::info!(parent, child = xid, "created mpv child X11 window");

        Ok(Self {
            conn,
            xid,
            rect: Mutex::new(None),
        })
    }

    /// Reposition + resize the child window inside its parent.
    pub fn set_geometry(&self, w: u32, h: u32, x: i32, y: i32) {
        // Skip no-ops to avoid spamming the X server during ResizeObserver
        // bursts on initial layout.
        {
            let mut last = self.rect.lock().unwrap();
            if *last == Some((w, h, x, y)) {
                return;
            }
            *last = Some((w, h, x, y));
        }
        let aux = ConfigureWindowAux::default()
            .x(x)
            .y(y)
            .width(w.max(1))
            .height(h.max(1));
        if let Err(e) = self.conn.configure_window(self.xid, &aux) {
            tracing::warn!(?e, "x11 configure_window failed");
            return;
        }
        if let Err(e) = self.conn.flush() {
            tracing::warn!(?e, "x11 flush failed");
        }
    }
}
