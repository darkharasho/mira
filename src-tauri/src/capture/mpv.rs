//! Subprocess-based MpvBackend.
//!
//! mpv runs as a real OS child process — same code path as the user's
//! `~/.local/bin/elgato-capture.sh` — and we drive runtime commands
//! (mute, volume, screenshot, stats) over its JSON IPC socket.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
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
    /// Pulse source name we suspended on start; on stop we unsuspend
    /// it so other apps (browsers, OBS, etc.) can use the device.
    suspended_pulse_source: Option<String>,
}

pub struct MpvBackend {
    inner: Mutex<Option<Running>>,
    request_id: AtomicU64,
    /// Child X11 window we own and reparent mpv into.
    child: Mutex<Option<X11Child>>,
}

impl MpvBackend {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            request_id: AtomicU64::new(1),
            child: Mutex::new(None),
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

/// True when the process is running inside a distrobox / podman / toolbox
/// container. We detect via the container runtime's marker file.
fn in_container() -> bool {
    std::path::Path::new("/run/.containerenv").is_file()
        || std::env::var("container").is_ok()
}

/// Pick the executable that will run mpv. Inside a container, defer to
/// `distrobox-host-exec` so mpv launches on the host where the GPU,
/// compositor, and audio stack live — the container's mesa stack can't
/// reach the host GPU and falls back to software rendering, which
/// starves the audio pipeline. Outside containers (AppImage / native),
/// call mpv directly.
///
/// Returns `(program, leading_args)` so the caller can append the rest
/// of mpv's flags. /tmp is shared across the distrobox boundary, so the
/// JSON IPC socket is reachable from both sides.
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
    format!("/tmp/mira-{pid}-{nanos}.sock")
}

fn mpv_log_path() -> String {
    let pid = std::process::id();
    format!("/tmp/mira-mpv-{pid}.log")
}

/// Map an alsa hw identifier to the matching low-latency dsnoop PCM
/// from ~/.asoundrc. The dsnoop wrapper imposes a small (1024-sample)
/// buffer that FFmpeg's hardcoded 524k-sample request can't bypass —
/// without it, audio is permanently 1-2s behind real time.
fn alsa_lowlatency_pcm(audio_device: &str) -> String {
    match audio_device {
        "hw:4,0" => "elgato_lowlatency".to_string(),
        other => other.to_string(),
    }
}

/// Build the `--demuxer-lavf-o` value for one stream. The v4l2 demuxer
/// needs `video_size` (and ideally `framerate`) spelled out: given only
/// a pixel format it keeps whatever mode the device node currently
/// holds, which after a cold plug is the UVC default of 640x480.
fn demuxer_opts(cfg: &StreamConfig, mode: &Option<crate::devices::CaptureMode>) -> String {
    let mut opts = vec![format!("pixel_format={}", cfg.pix_fmt)];
    if let Some(m) = mode {
        if m.width > 0 && m.height > 0 {
            opts.push(format!("video_size={}x{}", m.width, m.height));
        }
        if m.fps > 0.0 {
            opts.push(format!("framerate={}", m.fps));
        }
    }
    opts.join(",")
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
        // FFmpeg only auto-detects the v4l2 demuxer from a /dev/videoN
        // name, so resolve stable /dev/v4l/by-id symlinks first.
        let video_node = std::fs::canonicalize(&cfg.video_device)
            .unwrap_or_else(|_| cfg.video_device.clone().into());
        if cfg.pix_fmt.is_empty() {
            return Err(CaptureError::Other("pix_fmt is empty".into()));
        }

        // Without an explicit video_size the v4l2 demuxer just adopts
        // the node's current format — 640x480 on a freshly enumerated
        // UVC card, which a 16:9 source gets squeezed into. Resolve the
        // device's best advertised mode when the caller didn't pick one.
        let resolved_mode = if cfg.width > 0 && cfg.height > 0 {
            Some(crate::devices::CaptureMode {
                width: cfg.width,
                height: cfg.height,
                fps: cfg.fps,
            })
        } else {
            let mode = crate::devices::v4l2::best_mode(
                &video_node.to_string_lossy(),
                &cfg.pix_fmt,
            );
            tracing::info!(?mode, "no capture mode configured; using device best");
            mode
        };

        let socket_path = fresh_socket_path();
        let _ = std::fs::remove_file(&socket_path);

        // mpv runs as a real OS subprocess and embeds into a child X11
        // window we own (sized to the React layout's video slot). When
        // we're inside a container, prepend distrobox-host-exec so mpv
        // runs on the host with real GPU access — the X11 child XID is
        // just a number and DISPLAY is shared across the boundary.
        let (program, leading_args) = mpv_command();
        tracing::info!(program = %program, leading = ?leading_args, "spawning mpv subprocess");
        let mut cmd = Command::new(&program);
        for a in &leading_args {
            cmd.arg(a);
        }
        // When we're running from an AppImage, AppRun sets LD_LIBRARY_PATH
        // (plus GIO/GTK/etc.) to $APPDIR/usr/lib so the bundled webkit2gtk
        // resolves correctly. Those vars get inherited by every child,
        // including system /usr/bin/mpv — which then loads bundled libs
        // that ABI-mismatch host libs (e.g. an older libnghttp2 missing
        // symbols host libcurl needs) and dies at startup. Scrub them so
        // mpv links cleanly against the host's library set.
        //
        // Only do this in AppImage runs — outside the AppImage, things
        // like XDG_DATA_DIRS are legitimate (pipewire/alsa plugin
        // discovery, etc.) and stripping them changes mpv's audio
        // behavior in dev/distrobox.
        let in_appimage = std::env::var_os("APPIMAGE").is_some()
            || std::env::var_os("APPDIR").is_some();
        if in_appimage {
            for var in [
                "LD_LIBRARY_PATH",
                "LD_PRELOAD",
                "GIO_MODULE_DIR",
                "GTK_PATH",
                "GTK_EXE_PREFIX",
                "GDK_PIXBUF_MODULE_FILE",
                "GDK_PIXBUF_MODULEDIR",
                "GST_PLUGIN_PATH",
                "GST_PLUGIN_SYSTEM_PATH",
                "FONTCONFIG_PATH",
                "FONTCONFIG_FILE",
                "XDG_DATA_DIRS",
            ] {
                cmd.env_remove(var);
            }
        }
        if let Some(child_xid) = self.child.lock().unwrap().as_ref().map(|c| c.xid) {
            cmd.arg(format!("--wid={child_xid}"))
                // GL VO embedded in the X11 child via x11 GLX context.
                // xv was the previous fallback when GL-through-XWayland
                // failed inside the container, but xv forces a CPU
                // yuyv422→uyvy422 conversion at 1080p60 that starves
                // the audio demuxer. Now that mpv runs on the host
                // (via distrobox-host-exec), the host's GPU drives
                // GL natively — no conversion, no audio xruns.
                .arg("--vo=gpu")
                .arg("--gpu-context=x11")
                .arg("--hwdec=no");
            cmd.env_remove("WAYLAND_DISPLAY");
            tracing::info!(child_xid, "embedding mpv into our child X11 window");
        }
        let log_path = mpv_log_path();
        let log_file = std::fs::File::create(&log_path)
            .map_err(|e| CaptureError::Mpv(format!("open mpv log {log_path}: {e}")))?;
        let log_file_err = log_file
            .try_clone()
            .map_err(|e| CaptureError::Mpv(format!("dup mpv log: {e}")))?;

        // pipewire-pulse claims USB capture devices the moment any
        // client opens its source. Suspend it so we can open hw:N,0
        // alsa-direct (low latency, same path as elgato-capture.sh).
        // An empty audio_device means the video device has no USB audio
        // sibling (webcam without a mic, v4l2loopback) — stream video only.
        let has_audio = !cfg.audio_device.is_empty();
        let suspended_pulse_source = if has_audio {
            super::super::devices::pulse::pulse_source_for_alsa(&cfg.audio_device)
        } else {
            None
        };
        if let Some(name) = &suspended_pulse_source {
            super::super::devices::pulse::set_suspended(name, true);
            tracing::info!(source = %name, "suspended pulse source for alsa-direct capture");
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
            .arg("--msg-level=all=v")
            .arg("--no-cache")
            .arg("--untimed")
            .arg("--video-latency-hacks=yes")
            .arg("--vd-lavc-threads=1")
            .arg("--demuxer-readahead-secs=0")
            // FFmpeg's alsa demuxer reports wallclock timestamps (unix
            // epoch) while v4l2 reports monotonic from zero — they
            // differ by ~56 years. `--initial-audio-sync=no` keeps mpv
            // from waiting that long at start, but the low-latency
            // profile also sets `video-sync=audio`, which clock-locks
            // video to the runaway audio stream and produces a frame
            // every ~minute. `--video-sync=desync` lets each track
            // free-run at its own rate — correct for live capture
            // where there's no shared timeline anyway.
            .arg("--initial-audio-sync=no")
            .arg("--video-sync=desync")
            // Talk to pipewire directly — the pulse compat layer adds
            // 100-300ms of sink buffer that we can't tune from here.
            .arg("--ao=pipewire")
            // low-latency profile sets audio-buffer=0, which combined
            // with dsnoop's 21ms ALSA buffer guarantees xruns on every
            // scheduling jitter — the AO starves and audio drops out
            // entirely. 50ms is enough to absorb jitter on the pipewire
            // path while keeping lip sync tight for game capture.
            .arg("--audio-buffer=0.05")
            .arg(format!("--demuxer-lavf-o={}", demuxer_opts(cfg, &resolved_mode)))
            .arg("--demuxer-lavf-probesize=32")
            .arg("--demuxer-lavf-analyzeduration=0")
            .arg(format!("--volume={}", cfg.volume))
            .arg(format!("--mute={}", if cfg.muted { "yes" } else { "no" }))
            .arg("--title=Mira")
            .arg(format!("--input-ipc-server={socket_path}"))
            .arg(&video_node)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_file_err));
        if has_audio {
            cmd.arg(format!("--audio-file=av://alsa:{}", alsa_lowlatency_pcm(&cfg.audio_device)));
        }

        // Ask the kernel to SIGTERM mpv as soon as our process exits —
        // including hard crashes / Vite HMR restarts where stop() never
        // runs. Without this, mpv survives, holds /dev/videoN, and the
        // next launch fails with "avformat_open_input() failed".
        unsafe {
            cmd.pre_exec(|| {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }

        tracing::info!(?cfg, %socket_path, log = %log_path, "spawning mpv");
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

        *guard = Some(Running {
            child,
            socket_path,
            suspended_pulse_source,
        });
        Ok(())
    }

    fn stop(&self) -> Result<(), CaptureError> {
        let mut guard = self.inner.lock().unwrap();
        if let Some(mut running) = guard.take() {
            let _ = self.ipc(&running.socket_path, json!({"command": ["quit"]}));
            // Give mpv a moment to exit cleanly, then SIGKILL.
            let mut waited_clean = false;
            for _ in 0..20 {
                if let Ok(Some(_)) = running.child.try_wait() {
                    waited_clean = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            if !waited_clean {
                let _ = running.child.kill();
                let _ = running.child.wait();
            }
            let _ = std::fs::remove_file(&running.socket_path);
            if let Some(name) = &running.suspended_pulse_source {
                super::super::devices::pulse::set_suspended(name, false);
                tracing::info!(source = %name, "released pulse source suspension");
            }
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
        // vo-delay is meaningless under --video-sync=desync (always 0).
        // Frame drops since stream start are the headline indicator
        // that the pipeline is keeping up.
        let frame_drops = get("frame-drop-count")
            .as_u64()
            .or_else(|| get("decoder-frame-drop-count").as_u64())
            .unwrap_or(0) as u32;

        Ok(StreamStats {
            width,
            height,
            fps,
            pix_fmt,
            frame_drops,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::devices::CaptureMode;

    fn cfg() -> StreamConfig {
        StreamConfig {
            video_device: "/dev/video0".into(),
            audio_device: String::new(),
            pix_fmt: "yuyv422".into(),
            width: 0,
            height: 0,
            fps: 0.0,
            volume: 100,
            muted: false,
        }
    }

    #[test]
    fn demuxer_opts_pin_size_and_rate() {
        let mode = Some(CaptureMode { width: 1920, height: 1080, fps: 60.0 });
        assert_eq!(
            demuxer_opts(&cfg(), &mode),
            "pixel_format=yuyv422,video_size=1920x1080,framerate=60"
        );
    }

    #[test]
    fn demuxer_opts_omit_unknown_rate() {
        let mode = Some(CaptureMode { width: 1280, height: 720, fps: 0.0 });
        assert_eq!(
            demuxer_opts(&cfg(), &mode),
            "pixel_format=yuyv422,video_size=1280x720"
        );
    }

    #[test]
    fn demuxer_opts_without_mode_is_format_only() {
        assert_eq!(demuxer_opts(&cfg(), &None), "pixel_format=yuyv422");
    }
}
