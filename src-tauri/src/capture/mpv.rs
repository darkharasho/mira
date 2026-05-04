//! libmpv-based CaptureBackend implementation. mpv runs as its own
//! freely-positioned top-level window (no embedding, no overlay games);
//! the Tauri window is a control panel that drives it.

use std::path::Path;
use std::sync::Mutex;

use libmpv2::Mpv;

use super::{CaptureBackend, CaptureError, StreamConfig, StreamStats};

pub struct MpvBackend {
    inner: Mutex<Option<Mpv>>,
}

impl MpvBackend {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    fn map_err<E: std::fmt::Display>(e: E) -> CaptureError {
        let msg = e.to_string();
        if msg.is_empty() || msg == "null" {
            CaptureError::Mpv(format!("{:?}", "<empty libmpv error — check tracing logs>"))
        } else {
            CaptureError::Mpv(msg)
        }
    }

    fn ctx<E: std::fmt::Display>(what: &'static str) -> impl Fn(E) -> CaptureError {
        move |e| {
            let msg = e.to_string();
            let msg = if msg.is_empty() || msg == "null" {
                "<no detail>".to_string()
            } else {
                msg
            };
            CaptureError::Mpv(format!("{what}: {msg}"))
        }
    }
}

impl Default for MpvBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl CaptureBackend for MpvBackend {
    fn start(&self, cfg: &StreamConfig) -> Result<(), CaptureError> {
        let mut guard = self.inner.lock().unwrap();
        if guard.is_some() {
            let _ = guard.take();
        }

        tracing::info!(
            video = %cfg.video_device,
            audio = %cfg.audio_device,
            pix_fmt = %cfg.pix_fmt,
            volume = cfg.volume,
            muted = cfg.muted,
            "starting mpv stream"
        );

        // Validate inputs before handing them to libmpv (avoids the
        // notorious empty-error case from FFI nulls).
        if cfg.video_device.is_empty() {
            return Err(CaptureError::Other("video_device is empty".into()));
        }
        if cfg.audio_device.is_empty() {
            return Err(CaptureError::Other("audio_device is empty".into()));
        }
        if cfg.pix_fmt.is_empty() {
            return Err(CaptureError::Other("pix_fmt is empty".into()));
        }

        // Build the mpv instance and apply every property post-init via
        // a single `try_set` helper so any failing key/value gets reported
        // back to the UI by name. Each set is also logged to tracing so
        // the terminal shows a clean trail.
        let mpv = Mpv::new().map_err(Self::ctx("mpv_create"))?;

        // Turn libmpv's own stderr logging on so we see what it didn't like.
        let _ = mpv.set_property("terminal", "yes".to_string());
        let _ = mpv.set_property("msg-level", "all=v".to_string());

        let pairs: Vec<(&'static str, String)> = vec![
            ("profile", "low-latency".into()),
            ("cache", "no".into()),
            ("untimed", "yes".into()),
            ("video-latency-hacks", "yes".into()),
            ("vd-lavc-threads", "1".into()),
            ("demuxer-readahead-secs", "0".into()),
            ("demuxer-lavf-format", "video4linux2".into()),
            ("demuxer-lavf-probesize", "32".into()),
            ("demuxer-lavf-analyzeduration", "0".into()),
            ("demuxer-lavf-o", format!("pixel_format={}", cfg.pix_fmt)),
            ("audio-file", format!("av://alsa:{}", cfg.audio_device)),
            ("title", "Elgato Capture".into()),
        ];
        for (k, v) in pairs {
            tracing::debug!(prop = k, val = %v, "set_property");
            if let Err(e) = mpv.set_property(k, v.clone()) {
                tracing::error!(prop = k, val = %v, ?e, "set_property failed");
                return Err(CaptureError::Mpv(format!(
                    "set {k}={v}: {}",
                    {
                        let m = e.to_string();
                        if m.is_empty() || m == "null" { "rejected by libmpv (see terminal for details)".into() } else { m }
                    }
                )));
            }
        }

        mpv.set_property("volume", cfg.volume as i64)
            .map_err(Self::ctx("set volume"))?;
        mpv.set_property("mute", if cfg.muted { "yes" } else { "no" }.to_string())
            .map_err(Self::ctx("set mute"))?;

        // Begin playback of the V4L2 device.
        mpv.command("loadfile", &[&cfg.video_device, "replace"])
            .map_err(Self::ctx("loadfile"))?;

        *guard = Some(mpv);
        tracing::info!("mpv stream started");
        Ok(())
    }

    fn stop(&self) -> Result<(), CaptureError> {
        let mut guard = self.inner.lock().unwrap();
        // Dropping the `Mpv` calls `mpv_terminate_destroy`.
        let _ = guard.take();
        Ok(())
    }

    fn is_running(&self) -> bool {
        self.inner.lock().unwrap().is_some()
    }

    fn screenshot(&self, path: &Path) -> Result<(), CaptureError> {
        let guard = self.inner.lock().unwrap();
        let mpv = guard.as_ref().ok_or(CaptureError::NotStarted)?;
        let p = path.to_string_lossy();
        mpv.command("screenshot-to-file", &[&p, "video"])
            .map_err(Self::map_err)
    }

    fn set_mute(&self, mute: bool) -> Result<(), CaptureError> {
        let guard = self.inner.lock().unwrap();
        let mpv = guard.as_ref().ok_or(CaptureError::NotStarted)?;
        mpv.set_property("mute", if mute { "yes" } else { "no" }.to_string())
            .map_err(Self::map_err)
    }

    fn set_volume(&self, vol: u8) -> Result<(), CaptureError> {
        let guard = self.inner.lock().unwrap();
        let mpv = guard.as_ref().ok_or(CaptureError::NotStarted)?;
        mpv.set_property("volume", vol as i64)
            .map_err(Self::map_err)
    }

    fn stats(&self) -> Result<StreamStats, CaptureError> {
        let guard = self.inner.lock().unwrap();
        let mpv = guard.as_ref().ok_or(CaptureError::NotStarted)?;
        let width = mpv.get_property::<i64>("width").unwrap_or(0) as u32;
        let height = mpv.get_property::<i64>("height").unwrap_or(0) as u32;
        let fps = mpv
            .get_property::<f64>("estimated-vf-fps")
            .unwrap_or(0.0) as f32;
        let pix_fmt = mpv
            .get_property::<String>("video-format")
            .unwrap_or_default();
        let latency_ms = (mpv.get_property::<f64>("vo-delay").unwrap_or(0.0) * 1000.0)
            .round() as u32;
        Ok(StreamStats {
            width,
            height,
            fps,
            pix_fmt,
            latency_ms,
        })
    }
}
