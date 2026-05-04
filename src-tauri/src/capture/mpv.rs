//! libmpv-based CaptureBackend implementation. mpv runs as its own
//! freely-positioned top-level window (no embedding, no overlay games);
//! the Tauri window is a control panel that drives it.

use std::path::Path;
use std::sync::Mutex;

use libmpv2::Mpv;

use super::{CaptureBackend, CaptureError, StreamConfig, StreamStats};

/// libmpv's `mpv_create` returns NULL if `LC_NUMERIC` isn't `C` (or another
/// dot-decimal locale). Tauri inherits the user's locale, so call this
/// before every Mpv::new().
fn force_c_numeric_locale() {
    use std::ffi::CString;
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let c = CString::new("C").unwrap();
        // Safety: setlocale(LC_NUMERIC, "C") on glibc is async-signal-safe
        // and idempotent. We hold no locks across the call.
        unsafe {
            libc::setlocale(libc::LC_NUMERIC, c.as_ptr());
        }
        tracing::info!("forced LC_NUMERIC=C for libmpv");
    });
}

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

        // libmpv refuses to create the instance under a non-dot-decimal
        // locale (Tauri inherits the user's locale; on Bazzite this can be
        // en_US.UTF-8 with regional overrides). Force LC_NUMERIC=C up front.
        force_c_numeric_locale();

        // Build the mpv instance and apply every property post-init via
        // a single `try_set` helper so any failing key/value gets reported
        // back to the UI by name. Each set is also logged to tracing so
        // the terminal shows a clean trail.
        let mpv = Mpv::new().map_err(Self::ctx("mpv_create"))?;

        // Turn libmpv's own stderr logging on so we see what it didn't like.
        let _ = mpv.set_property("terminal", "yes".to_string());
        let _ = mpv.set_property("msg-level", "all=v".to_string());

        // Persistent runtime properties — these are real properties exposed
        // by libmpv post-init.
        let runtime_pairs: &[(&'static str, &'static str)] = &[
            ("profile", "low-latency"),
            ("cache", "no"),
            ("untimed", "yes"),
            ("video-latency-hacks", "yes"),
            ("vd-lavc-threads", "1"),
            ("demuxer-readahead-secs", "0"),
            ("title", "Elgato Capture"),
        ];
        for (k, v) in runtime_pairs {
            tracing::debug!(prop = k, val = v, "set_property");
            if let Err(e) = mpv.set_property(k, (*v).to_string()) {
                tracing::error!(prop = k, val = v, ?e, "set_property failed");
                return Err(CaptureError::Mpv(format!(
                    "set {k}={v}: {}",
                    {
                        let m = e.to_string();
                        if m.is_empty() || m == "null" {
                            "rejected by libmpv (see terminal for details)".into()
                        } else {
                            m
                        }
                    }
                )));
            }
        }

        mpv.set_property("volume", cfg.volume as i64)
            .map_err(Self::ctx("set volume"))?;
        mpv.set_property("mute", if cfg.muted { "yes" } else { "no" }.to_string())
            .map_err(Self::ctx("set mute"))?;

        // Per-file options live on the `loadfile` command, not as runtime
        // properties. demuxer-lavf-*, demuxer-lavf-o, and audio-file are
        // all load-time only — passing them via set_property fails with
        // PROPERTY_NOT_FOUND.
        let per_file_opts = format!(
            "demuxer-lavf-format=video4linux2,\
             demuxer-lavf-probesize=32,\
             demuxer-lavf-analyzeduration=0,\
             demuxer-lavf-o=pixel_format={pix},\
             audio-file=av://alsa:{aud}",
            pix = cfg.pix_fmt,
            aud = cfg.audio_device,
        );
        tracing::info!(opts = %per_file_opts, video = %cfg.video_device, "loadfile");
        mpv.command(
            "loadfile",
            &[&cfg.video_device, "replace", "-1", &per_file_opts],
        )
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
