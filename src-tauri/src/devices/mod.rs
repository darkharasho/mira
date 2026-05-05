use serde::{Deserialize, Serialize};

pub mod v4l2;
pub mod pulse;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoDevice {
    pub path: String,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDevice {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceList {
    pub video: Vec<VideoDevice>,
    /// PulseAudio output sinks (speakers, headphones) for routing
    /// captured audio playback.
    pub audio_outputs: Vec<AudioDevice>,
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
    fn unknown_fourcc_lowercased() {
        assert_eq!(fourcc_to_mpv_label("ABCD"), "abcd");
    }
}
