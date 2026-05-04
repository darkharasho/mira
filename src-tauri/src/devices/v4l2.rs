use super::{PixFormat, VideoDevice, fourcc_to_mpv_label};
use std::path::Path;
use v4l::context;
use v4l::video::Capture;
use v4l::Device;

pub fn enumerate() -> Vec<VideoDevice> {
    let mut out = Vec::new();
    for node in context::enum_devices() {
        let path = node.path().to_string_lossy().to_string();
        if !Path::new(&path).exists() { continue; }
        let Ok(dev) = Device::with_path(&path) else { continue };
        let Ok(caps) = dev.query_caps() else { continue };
        if !caps.capabilities.contains(v4l::capability::Flags::VIDEO_CAPTURE) {
            continue;
        }
        let formats: Vec<PixFormat> = dev.enum_formats().unwrap_or_default()
            .into_iter()
            .map(|f| {
                let fourcc = f.fourcc.str().unwrap_or("????").to_string();
                PixFormat { label: fourcc_to_mpv_label(&fourcc), fourcc }
            })
            .collect();
        out.push(VideoDevice { path, name: caps.card, formats });
    }
    out
}
