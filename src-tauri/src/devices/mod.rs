use serde::{Deserialize, Serialize};

pub mod v4l2;
pub mod pulse;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoDevice {
    /// Path to open and persist: the stable `/dev/v4l/by-id/...` link
    /// when udev provides one, otherwise the raw node.
    pub path: String,
    /// Raw `/dev/videoN` node. Lets settings saved before stable paths
    /// existed still resolve to a device.
    pub node: String,
    pub name: String,
    pub formats: Vec<PixFormat>,
    /// Auto-derived alsa capture identifier (e.g. "hw:4,0") for the
    /// audio sibling on the same USB device. None for v4l2 devices
    /// without an associated USB audio interface (webcams without a
    /// mic, virtual devices, etc.).
    pub audio_capture: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PixFormat {
    pub fourcc: String,
    pub label: String,
    /// Capture modes the device advertises for this format, best first
    /// (largest frame, then highest rate). mpv has to be told which one
    /// to ask for — the v4l2 demuxer otherwise inherits whatever format
    /// the node was left in, which on most UVC cards is 640x480.
    pub modes: Vec<CaptureMode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CaptureMode {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
}

/// Sort capture modes best-first: largest frame area, then highest rate.
pub fn sort_modes(modes: &mut [CaptureMode]) {
    modes.sort_by(|a, b| {
        let area = (b.width as u64 * b.height as u64).cmp(&(a.width as u64 * a.height as u64));
        area.then(b.fps.partial_cmp(&a.fps).unwrap_or(std::cmp::Ordering::Equal))
    });
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceList {
    pub video: Vec<VideoDevice>,
}

/// Map a v4l2 fourcc into the lowercase label mpv accepts as `pixel_format`.
pub fn fourcc_to_mpv_label(fourcc: &str) -> String {
    match fourcc {
        "YUYV" => "yuyv422".into(),
        "UYVY" => "uyvy422".into(),
        "NV12" => "nv12".into(),
        "MJPG" => "mjpeg".into(),
        other => other.to_ascii_lowercase(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_known_fourccs() {
        assert_eq!(fourcc_to_mpv_label("YUYV"), "yuyv422");
        assert_eq!(fourcc_to_mpv_label("MJPG"), "mjpeg");
    }
    #[test]
    fn sorts_largest_frame_then_fastest_first() {
        let mut modes = vec![
            CaptureMode { width: 640, height: 480, fps: 60.0 },
            CaptureMode { width: 1920, height: 1080, fps: 30.0 },
            CaptureMode { width: 1920, height: 1080, fps: 60.0 },
        ];
        sort_modes(&mut modes);
        assert_eq!(modes[0], CaptureMode { width: 1920, height: 1080, fps: 60.0 });
        assert_eq!(modes[2], CaptureMode { width: 640, height: 480, fps: 60.0 });
    }

    #[test]
    fn unknown_fourcc_lowercased() {
        assert_eq!(fourcc_to_mpv_label("ABCD"), "abcd");
    }
}
