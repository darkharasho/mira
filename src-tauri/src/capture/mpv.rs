//! Subprocess-based MpvBackend.
//!
//! mpv runs as a real OS child process — same code path as the user's
//! `~/.local/bin/elgato-capture.sh` — and we drive runtime commands
//! (mute, volume, screenshot, stats) over its JSON IPC socket.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::x11_child::X11Child;
use super::{CaptureBackend, CaptureError, StreamConfig, StreamStats};

struct Running {
    child: Child,
    socket_path: String,
}

pub struct MpvBackend {
    inner: Mutex<Option<Running>>,
    request_id: AtomicU64,
    /// Child X11 window we own and reparent mpv into.
    child: Mutex<Option<X11Child>>,
    /// X11 ID of the always-on-top overlay window. Used by the
    /// XShape input-region command so the transparent middle of the
    /// overlay passes mouse events through to the main window.
    overlay_xid: Mutex<Option<u32>>,
}

impl MpvBackend {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            request_id: AtomicU64::new(1),
            child: Mutex::new(None),
            overlay_xid: Mutex::new(None),
        }
    }

    pub fn set_parent_xid(&self, xid: u64) {
        let mut guard = self.child.lock().unwrap();
        if guard.is_some() {
            return;
        }
        match X11Child::create(xid as u32) {
            Ok(child) => *guard = Some(child),
            Err(e) => tracing::error!(?e, "failed to create child X11 window"),
        }
    }

    pub fn set_overlay_xid(&self, xid: u64) {
        *self.overlay_xid.lock().unwrap() = Some(xid as u32);
        tracing::info!(xid, "captured overlay window X11 id");
    }

    /// Apply an XShape input region to the overlay window so that only
    /// the listed rectangles receive mouse events; everything else
    /// passes through to the window below.
    pub fn apply_overlay_input_region(&self, rects: &[(i32, i32, u32, u32)]) {
        let xid = *self.overlay_xid.lock().unwrap();
        let Some(xid) = xid else {
            tracing::warn!("apply_overlay_input_region: overlay xid not set yet");
            return;
        };
        if let Err(e) = super::x11_child::set_input_region(xid, rects) {
            tracing::warn!(?e, "x11 input region failed");
        }
    }

    /// Update the video region inside the parent window. The child X11
    /// window we own gets resized/repositioned; mpv (embedded inside
    /// it) follows automatically.
    pub fn set_region(&self, w: u32, h: u32, x: i32, y: i32) {
        if let Some(child) = self.child.lock().unwrap().as_ref() {
            child.set_geometry(w, h, x, y);
        }
    }

    /// Show or hide the embedded video by mapping/unmapping the child
    /// X11 window. mpv keeps decoding behind the scenes; this just
    /// stops it from drawing on top of our webview content.
    pub fn set_video_visible(&self, visible: bool) {
        if let Some(child) = self.child.lock().unwrap().as_ref() {
            child.set_mapped(visible);
        }
    }

    fn next_id(&self) -> u64 {
        self.request_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Send a JSON command over the IPC socket and return the parsed reply.
    fn ipc(&self, socket_path: &str, command: Value) -> Result<Value, CaptureError> {
        let id = self.next_id();
        let mut req = command;
        req.as_object_mut()
            .ok_or_else(|| CaptureError::Other("ipc command must be an object".into()))?
            .insert("request_id".into(), json!(id));
        let line = serde_json::to_string(&req)
            .map_err(|e| CaptureError::Other(format!("serialize ipc: {e}")))?;

        let mut stream = UnixStream::connect(socket_path)
            .map_err(|e| CaptureError::Mpv(format!("ipc connect {socket_path}: {e}")))?;
        stream
            .set_read_timeout(Some(Duration::from_millis(500)))
            .ok();

        writeln!(stream, "{line}")
            .map_err(|e| CaptureError::Mpv(format!("ipc write: {e}")))?;
        stream
            .flush()
            .map_err(|e| CaptureError::Mpv(format!("ipc flush: {e}")))?;

        let reader = BufReader::new(&stream);
        for raw in reader.lines() {
            let raw = raw.map_err(|e| CaptureError::Mpv(format!("ipc read: {e}")))?;
            if raw.trim().is_empty() {
                continue;
            }
            let value: Value = match serde_json::from_str(&raw) {
                Ok(v) => v,
                Err(_) => continue,
            };
            // Skip async events.
            if value.get("event").is_some() {
                continue;
            }
            if value.get("request_id").and_then(Value::as_u64) == Some(id) {
                if value.get("error").and_then(Value::as_str) == Some("success") {
                    return Ok(value.get("data").cloned().unwrap_or(Value::Null));
                }
                let err = value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                return Err(CaptureError::Mpv(format!("ipc error: {err}")));
            }
        }
        Err(CaptureError::Mpv("ipc: connection closed".into()))
    }
}

impl Default for MpvBackend {
    fn default() -> Self {
        Self::new()
    }
}

fn mpv_executable() -> String {
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(':').filter(|s| !s.is_empty()) {
            let candidate = std::path::Path::new(dir).join("mpv");
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }
    first_existing(&["/usr/bin/mpv", "/usr/local/bin/mpv"]).unwrap_or_else(|| "mpv".into())
}

fn first_existing(paths: &[&str]) -> Option<String> {
    paths
        .iter()
        .find(|p| std::path::Path::new(p).is_file())
        .map(|s| s.to_string())
}

fn fresh_socket_path() -> String {
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("/tmp/elgato-capture-{pid}-{nanos}.sock")
}

impl CaptureBackend for MpvBackend {
    fn start(&self, cfg: &StreamConfig) -> Result<(), CaptureError> {
        let mut guard = self.inner.lock().unwrap();
        if let Some(prev) = guard.take() {
            drop(prev); // best-effort kill
        }

        if cfg.video_device.is_empty() {
            return Err(CaptureError::Other("video_device is empty".into()));
        }
        if cfg.audio_device.is_empty() {
            return Err(CaptureError::Other("audio_device is empty".into()));
        }
        if cfg.pix_fmt.is_empty() {
            return Err(CaptureError::Other("pix_fmt is empty".into()));
        }

        let socket_path = fresh_socket_path();
        let _ = std::fs::remove_file(&socket_path);

        // mpv runs as a real OS subprocess and embeds into a child X11
        // window we own (sized to the React layout's video slot).
        let program = mpv_executable();
        tracing::info!(program = %program, "spawning mpv subprocess");
        let mut cmd = Command::new(&program);
        if let Some(child_xid) = self.child.lock().unwrap().as_ref().map(|c| c.xid) {
            cmd.arg(format!("--wid={child_xid}"))
                // mpv's `--wid` is X11-only; force the X11 GPU context
                // (default `auto` prefers Wayland whenever WAYLAND_DISPLAY
                // is set, which crashes with dmabuf import errors against
                // an X11-embedded window).
                .arg("--gpu-context=x11egl");
            cmd.env_remove("WAYLAND_DISPLAY");
            tracing::info!(child_xid, "embedding mpv into our child X11 window");
        }
        cmd.arg("--profile=low-latency")
            // Suppress mpv's own UI — no on-screen controller, no OSD
            // text, no input bindings/cursor. The control surface lives
            // entirely in our overlay window.
            .arg("--osc=no")
            .arg("--no-osd-bar")
            .arg("--input-default-bindings=no")
            .arg("--input-vo-keyboard=no")
            .arg("--cursor-autohide=always")
            .arg("--no-cache")
            .arg("--untimed")
            .arg("--video-latency-hacks=yes")
            .arg("--vd-lavc-threads=1")
            .arg("--demuxer-readahead-secs=0")
            .arg("--demuxer-lavf-format=video4linux2")
            .arg(format!("--demuxer-lavf-o=pixel_format={}", cfg.pix_fmt))
            .arg("--demuxer-lavf-probesize=32")
            .arg("--demuxer-lavf-analyzeduration=0")
            .arg(format!("--audio-file=av://alsa:{}", cfg.audio_device))
            .arg(format!("--volume={}", cfg.volume))
            .arg(format!("--mute={}", if cfg.muted { "yes" } else { "no" }))
            .arg("--title=Elgato Capture")
            .arg(format!("--input-ipc-server={socket_path}"))
            .arg(&cfg.video_device)
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());

        tracing::info!(?cfg, %socket_path, "spawning mpv");
        let child = cmd.spawn().map_err(|e| {
            CaptureError::Mpv(format!("failed to spawn mpv: {e}"))
        })?;

        // Wait briefly for mpv to create the IPC socket, so subsequent
        // ipc() calls succeed without racing.
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if Path::new(&socket_path).exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        *guard = Some(Running { child, socket_path });
        Ok(())
    }

    fn stop(&self) -> Result<(), CaptureError> {
        let mut guard = self.inner.lock().unwrap();
        if let Some(mut running) = guard.take() {
            let _ = self.ipc(&running.socket_path, json!({"command": ["quit"]}));
            // Give mpv a moment to exit cleanly, then SIGKILL.
            for _ in 0..20 {
                if let Ok(Some(_)) = running.child.try_wait() {
                    let _ = std::fs::remove_file(&running.socket_path);
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            let _ = running.child.kill();
            let _ = running.child.wait();
            let _ = std::fs::remove_file(&running.socket_path);
        }
        Ok(())
    }

    fn is_running(&self) -> bool {
        let mut guard = self.inner.lock().unwrap();
        match guard.as_mut() {
            None => false,
            Some(running) => match running.child.try_wait() {
                Ok(Some(_)) => {
                    // Process exited; clean up.
                    let _ = std::fs::remove_file(&running.socket_path);
                    *guard = None;
                    false
                }
                _ => true,
            },
        }
    }

    fn screenshot(&self, path: &Path) -> Result<(), CaptureError> {
        let socket_path = {
            let guard = self.inner.lock().unwrap();
            guard
                .as_ref()
                .ok_or(CaptureError::NotStarted)?
                .socket_path
                .clone()
        };
        let p = path.to_string_lossy().into_owned();
        self.ipc(
            &socket_path,
            json!({"command": ["screenshot-to-file", p, "video"]}),
        )?;
        Ok(())
    }

    fn set_mute(&self, mute: bool) -> Result<(), CaptureError> {
        let socket_path = {
            let guard = self.inner.lock().unwrap();
            guard
                .as_ref()
                .ok_or(CaptureError::NotStarted)?
                .socket_path
                .clone()
        };
        self.ipc(
            &socket_path,
            json!({"command": ["set_property", "mute", mute]}),
        )?;
        Ok(())
    }

    fn set_volume(&self, vol: u8) -> Result<(), CaptureError> {
        let socket_path = {
            let guard = self.inner.lock().unwrap();
            guard
                .as_ref()
                .ok_or(CaptureError::NotStarted)?
                .socket_path
                .clone()
        };
        self.ipc(
            &socket_path,
            json!({"command": ["set_property", "volume", vol as i64]}),
        )?;
        Ok(())
    }

    fn stats(&self) -> Result<StreamStats, CaptureError> {
        let socket_path = {
            let guard = self.inner.lock().unwrap();
            guard
                .as_ref()
                .ok_or(CaptureError::NotStarted)?
                .socket_path
                .clone()
        };

        let get = |prop: &str| -> Value {
            self.ipc(
                &socket_path,
                json!({"command": ["get_property", prop]}),
            )
            .unwrap_or(Value::Null)
        };

        let width = get("width").as_u64().unwrap_or(0) as u32;
        let height = get("height").as_u64().unwrap_or(0) as u32;
        let fps = get("estimated-vf-fps").as_f64().unwrap_or(0.0) as f32;
        let pix_fmt = get("video-format").as_str().unwrap_or("").to_string();
        let latency_ms =
            (get("vo-delay").as_f64().unwrap_or(0.0) * 1000.0).round() as u32;

        Ok(StreamStats {
            width,
            height,
            fps,
            pix_fmt,
            latency_ms,
        })
    }
}
