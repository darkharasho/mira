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

        // Mirror the reference script's CLI flags via the pre-init
        // option setter. mpv_set_option_string (what `MpvInitializer`
        // calls under the hood) is the same code path the CLI uses to
        // parse --flag=value arguments, so anything the script uses is
        // accepted.
        let pix_fmt = cfg.pix_fmt.clone();
        let audio_device = cfg.audio_device.clone();
        let mpv = Mpv::with_initializer(move |init| -> Result<(), libmpv2::Error> {
            // Verbose libmpv stderr so we can see why anything fails.
            let _ = init.set_property("terminal", "yes".to_string());
            let _ = init.set_property("msg-level", "all=v".to_string());

            for (k, v) in [
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
                // Force the legacy GL backend. The default `gpu-next` /
                // libplacebo Vulkan path on Wayland tries dmabuf imports
                // which conflict with Tauri's WebKitGTK already holding
                // Wayland GPU resources in this process. The script works
                // because it doesn't share a process with a webview.
                ("vo", "gpu"),
                ("gpu-api", "opengl"),
            ] {
                tracing::debug!(prop = k, val = v, "pre-init option");
                init.set_property(k, v.to_string()).map_err(|e| {
                    tracing::error!(prop = k, val = v, ?e, "pre-init option failed");
                    e
                })?;
            }

            let lavf_opts = format!("pixel_format={}", pix_fmt);
            tracing::debug!(prop = "demuxer-lavf-o", val = %lavf_opts, "pre-init option");
            init.set_property("demuxer-lavf-o", lavf_opts.clone())
                .map_err(|e| {
                    tracing::error!(prop = "demuxer-lavf-o", val = %lavf_opts, ?e, "pre-init option failed");
                    e
                })?;
            let _ = audio_device;
            Ok(())
        })
        .map_err(Self::ctx("mpv init"))?;

        // Volume + mute are real runtime properties.
        mpv.set_property("volume", cfg.volume as i64)
            .map_err(Self::ctx("set volume"))?;
        mpv.set_property("mute", if cfg.muted { "yes" } else { "no" }.to_string())
            .map_err(Self::ctx("set mute"))?;

        // Attach the ALSA capture device as an audio source. `audio-files`
        // is a list-typed property — setting it via set_property splits
        // the value on commas, which mangles av://alsa:hw:N,M into two
        // bogus paths. The `change-list` command treats the value as one
        // opaque string and avoids the splitting.
        let audio_url = format!("av://alsa:{}", cfg.audio_device);
        tracing::info!(audio = %audio_url, "change-list audio-files add");
        mpv.command("change-list", &["audio-files", "add", &audio_url])
            .map_err(Self::ctx("change-list audio-files"))?;

        // Begin playback of the V4L2 device — three-arg form for older
        // mpv compatibility (no `index` parameter).
        tracing::info!(video = %cfg.video_device, "loadfile");
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
