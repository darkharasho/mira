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
    pub volume: u8,
    pub muted: bool,
    /// Optional pulse sink name to route capture audio output through.
    /// None = use system default sink.
    pub audio_output: Option<String>,
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
