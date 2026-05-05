use std::sync::Arc;
use tauri::State;
use crate::capture::{CaptureBackend, StreamConfig, StreamStats};
use crate::capture::mpv::MpvBackend;
use crate::devices::{DeviceList, pulse as pulse_dev, v4l2 as v4l2_dev};
use crate::settings::Settings;

pub struct AppState {
    pub backend: Arc<MpvBackend>,
}

#[tauri::command]
pub fn list_devices() -> DeviceList {
    DeviceList {
        video: v4l2_dev::enumerate(),
        audio_outputs: pulse_dev::enumerate_sinks(),
    }
}

#[tauri::command]
pub fn start_stream(state: State<AppState>, cfg: StreamConfig) -> Result<(), String> {
    state.backend.start(&cfg).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stop_stream(state: State<AppState>) -> Result<(), String> {
    state.backend.stop().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_mute(state: State<AppState>, mute: bool) -> Result<(), String> {
    state.backend.set_mute(mute).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_volume(state: State<AppState>, vol: u8) -> Result<(), String> {
    state.backend.set_volume(vol).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_stats(state: State<AppState>) -> Result<StreamStats, String> {
    state.backend.stats().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn take_screenshot(state: State<AppState>) -> Result<String, String> {
    tracing::info!("take_screenshot invoked");
    let dir = dirs::picture_dir()
        .unwrap_or_else(|| std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default()))
        .join("mira");
    tracing::info!(?dir, "screenshot target dir");
    std::fs::create_dir_all(&dir).map_err(|e| {
        tracing::error!(?e, "create_dir_all failed");
        e.to_string()
    })?;
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let path = dir.join(format!("capture-{ts}.png"));
    tracing::info!(?path, "calling backend screenshot");
    state.backend.screenshot(&path).map_err(|e| {
        tracing::error!(?e, "backend screenshot failed");
        e.to_string()
    })?;
    let s = path.to_string_lossy().into_owned();
    tracing::info!(path = %s, "screenshot ok");
    Ok(s)
}

#[tauri::command]
pub fn default_settings() -> Settings { Settings::default() }

/// Update the rectangle (in window-local CSS pixels) where mpv should
/// render its embedded video. The webview measures its layout and calls
/// this whenever the video region changes (initial mount + resize).
#[tauri::command]
pub fn set_video_region(state: State<AppState>, w: u32, h: u32, x: i32, y: i32) {
    state.backend.set_region(w, h, x, y);
}

/// Show or hide the embedded video. Called when the settings panel
/// opens (false) or closes (true) so the panel can render without mpv
/// stacking on top of it.
#[tauri::command]
pub fn set_video_visible(state: State<AppState>, visible: bool) {
    state.backend.set_video_visible(visible);
}
