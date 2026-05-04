//! libmpv-based CaptureBackend implementation.
//!
//! Task 7: skeleton wiring of an `Mpv` child instance with the same
//! latency-tuning property set as the reference shell script. The mpv
//! window is a separate top-level for now; embedding into the Tauri
//! window is Task 11.

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
        CaptureError::Mpv(e.to_string())
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
            // Drop the previous instance before creating a new one.
            let _ = guard.take();
        }

        // Properties that are most reliably applied before initialization
        // (matching the CLI flags used by the reference script). libmpv2's
        // `with_initializer` exposes a pre-init context for exactly this.
        let pix_fmt = cfg.pix_fmt.clone();
        let audio_device = cfg.audio_device.clone();
        let volume = cfg.volume as i64;
        let muted = cfg.muted;

        let mpv = Mpv::with_initializer(move |init| {
            // Pairs of (key, value) string properties.
            let pairs: &[(&str, &str)] = &[
                ("profile", "low-latency"),
                ("cache", "no"),
                ("untimed", "yes"),
                ("video-latency-hacks", "yes"),
                ("vd-lavc-threads", "1"),
                ("demuxer-readahead-secs", "0"),
                ("demuxer-lavf-format", "video4linux2"),
                ("demuxer-lavf-probesize", "32"),
                ("demuxer-lavf-analyzeduration", "0"),
                ("title", "Elgato Capture"),
            ];
            for (k, v) in pairs {
                init.set_property(k, (*v).to_string())?;
            }
            init.set_property(
                "demuxer-lavf-o",
                format!("pixel_format={}", pix_fmt),
            )?;
            init.set_property("audio-file", format!("av://alsa:{}", audio_device))?;
            init.set_property("volume", volume)?;
            init.set_property("mute", if muted { "yes" } else { "no" }.to_string())?;
            Ok(())
        })
        .map_err(Self::map_err)?;

        // Begin playback of the V4L2 device.
        mpv.command("loadfile", &[&cfg.video_device, "replace"])
            .map_err(Self::map_err)?;

        *guard = Some(mpv);
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
