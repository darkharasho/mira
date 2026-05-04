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

use super::{CaptureBackend, CaptureError, StreamConfig, StreamStats};

struct Running {
    child: Child,
    socket_path: String,
}

pub struct MpvBackend {
    inner: Mutex<Option<Running>>,
    request_id: AtomicU64,
}

impl MpvBackend {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            request_id: AtomicU64::new(1),
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

/// True when the process is running inside a distrobox / podman / toolbox
/// container. We detect via the container runtime's marker file.
fn in_container() -> bool {
    std::path::Path::new("/run/.containerenv").is_file()
        || std::env::var("container").is_ok()
}

/// Pick the executable that will run mpv. In a container, defer to
/// `distrobox-host-exec` so mpv launches on the host — that's where
/// the user's compositor + GPU live, and where their bash script
/// already works. Outside containers, just use mpv directly.
///
/// Returns `(program, leading_args)` so the caller can append the rest
/// of mpv's flags.
fn mpv_command() -> (String, Vec<String>) {
    if in_container() {
        if let Some(host_exec) = first_existing(&[
            "/usr/bin/distrobox-host-exec",
            "/usr/local/bin/distrobox-host-exec",
        ]) {
            return (host_exec, vec!["mpv".into()]);
        }
    }
    (mpv_path_in_path(), Vec::new())
}

fn mpv_path_in_path() -> String {
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

        // Mirror the reference script's CLI exactly. mpv is a self-contained
        // child process, so its Wayland/GPU connection is independent of
        // Tauri's webview — no dmabuf-import collisions.
        let (program, leading_args) = mpv_command();
        tracing::info!(program = %program, leading = ?leading_args, "spawning mpv subprocess");
        let mut cmd = Command::new(&program);
        for a in &leading_args {
            cmd.arg(a);
        }
        cmd.arg("--profile=low-latency")
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
