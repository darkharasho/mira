use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    pub video_device: Option<String>,
    pub audio_device: Option<String>,
    pub pix_fmt: Option<String>,
    pub volume: u8,
    pub muted: bool,
    pub show_stats: bool,
    pub skip_startup: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            video_device: None,
            audio_device: None,
            pix_fmt: Some("yuyv422".to_string()),
            volume: 100,
            muted: false,
            show_stats: true,
            skip_startup: true,
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
            audio_device: Some("hw:6,0".into()),
            pix_fmt: Some("yuyv422".into()),
            volume: 80,
            muted: true,
            show_stats: false,
            skip_startup: true,
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
