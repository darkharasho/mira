use serde::{Deserialize, Serialize};

pub mod mpv;
pub mod x11_child;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamConfig {
    pub video_device: String,
    /// Alsa hw identifier of the audio sibling for the video device,
    /// already wrapped to the low-latency dsnoop PCM if available.
    pub audio_device: String,
    pub pix_fmt: String,
    /// Capture resolution to request from the device. `None` (or a zero
    /// dimension) means "pick the device's best advertised mode" —
    /// without an explicit size the v4l2 demuxer inherits whatever the
    /// node was last left in, typically 640x480.
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    /// Frame rate to request; 0 leaves it to the driver.
    #[serde(default)]
    pub fps: f64,
    pub volume: u8,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StreamStats {
    pub width: u32,
    pub height: u32,
    pub fps: f32,
    pub pix_fmt: String,
    pub frame_drops: u32,
}

#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error("mpv: {0}")] Mpv(String),
    #[error("not started")] NotStarted,
    #[error("io: {0}")] Io(#[from] std::io::Error),
    #[error("other: {0}")] Other(String),
}

pub trait CaptureBackend: Send + Sync {
    fn start(&self, cfg: &StreamConfig) -> Result<(), CaptureError>;
    fn stop(&self) -> Result<(), CaptureError>;
    fn is_running(&self) -> bool;
    fn screenshot(&self, path: &std::path::Path) -> Result<(), CaptureError>;
    fn set_mute(&self, mute: bool) -> Result<(), CaptureError>;
    fn set_volume(&self, vol: u8) -> Result<(), CaptureError>;
    fn stats(&self) -> Result<StreamStats, CaptureError>;
}
