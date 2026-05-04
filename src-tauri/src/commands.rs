use std::sync::Arc;
use tauri::State;
use crate::capture::{CaptureBackend, StreamConfig, StreamStats};
use crate::capture::mpv::MpvBackend;
use crate::devices::{DeviceList, alsa as alsa_dev, v4l2 as v4l2_dev};
use crate::settings::Settings;

pub struct AppState {
    pub backend: Arc<MpvBackend>,
}

#[tauri::command]
pub fn list_devices() -> DeviceList {
    DeviceList { video: v4l2_dev::enumerate(), audio: alsa_dev::enumerate() }
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
    let dir = dirs::picture_dir()
        .unwrap_or_else(|| std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default()))
        .join("elgato");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let path = dir.join(format!("capture-{ts}.png"));
    state.backend.screenshot(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
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

/// Update the overlay window's XShape input region: the union of these
/// rectangles is where mouse events get caught; outside, events pass
/// through to the main window. Called by the overlay React on layout.
#[tauri::command]
pub fn set_overlay_input_region(
    state: State<AppState>,
    rects: Vec<(i32, i32, u32, u32)>,
) {
    state.backend.apply_overlay_input_region(&rects);
}

/// Show or hide the embedded video. Called when the settings panel
/// opens (false) or closes (true) so the panel can render without mpv
/// stacking on top of it.
#[tauri::command]
pub fn set_video_visible(state: State<AppState>, visible: bool) {
    state.backend.set_video_visible(visible);
}
