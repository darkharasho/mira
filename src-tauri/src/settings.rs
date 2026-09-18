use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    pub video_device: Option<String>,
    pub pix_fmt: Option<String>,
    pub volume: u8,
    pub muted: bool,
    pub show_stats: bool,
    pub skip_startup: bool,
    #[serde(default = "default_display_resolution")]
    pub display_resolution: String,
    /// Capture mode to request from the device, as "WIDTHxHEIGHT@FPS"
    /// (e.g. "1920x1080@60"). None means "use the device's best
    /// advertised mode", resolved at stream start.
    #[serde(default)]
    pub capture_mode: Option<String>,
}

fn default_display_resolution() -> String {
    "1080p".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            video_device: None,
            pix_fmt: Some("yuyv422".to_string()),
            volume: 100,
            muted: false,
            show_stats: true,
            skip_startup: true,
            display_resolution: default_display_resolution(),
            capture_mode: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_json() {
        let s = Settings {
            video_device: Some("/dev/video2".into()),
            pix_fmt: Some("yuyv422".into()),
            volume: 80,
            muted: true,
            show_stats: false,
            skip_startup: true,
            display_resolution: "1440p".into(),
            capture_mode: Some("1920x1080@60".into()),
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn defaults_match_script() {
        let d = Settings::default();
        assert_eq!(d.pix_fmt.as_deref(), Some("yuyv422"));
        assert_eq!(d.volume, 100);
        assert!(!d.muted);
        assert!(d.skip_startup);
    }
}
