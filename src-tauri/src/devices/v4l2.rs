//! v4l2 capture device enumeration.
//!
//! For each video device we also resolve the USB sibling alsa card and
//! emit `audio_capture` as `hw:N,0`. The mpv command in the capture
//! backend uses that id directly so audio always tracks the chosen
//! video device — no separate dropdown needed.

use super::{PixFormat, VideoDevice, fourcc_to_mpv_label};
use std::path::{Path, PathBuf};
use v4l::context;
use v4l::video::Capture;
use v4l::Device;

pub fn enumerate() -> Vec<VideoDevice> {
    let mut out = Vec::new();
    for node in context::enum_devices() {
        let path = node.path().to_string_lossy().to_string();
        if !Path::new(&path).exists() {
            continue;
        }
        let Ok(dev) = Device::with_path(&path) else { continue };
        let Ok(caps) = dev.query_caps() else { continue };
        if !caps.capabilities.contains(v4l::capability::Flags::VIDEO_CAPTURE) {
            continue;
        }
        let formats: Vec<PixFormat> = dev
            .enum_formats()
            .unwrap_or_default()
            .into_iter()
            .map(|f| {
                let fourcc = f.fourcc.str().unwrap_or("????").to_string();
                PixFormat {
                    label: fourcc_to_mpv_label(&fourcc),
                    fourcc,
                }
            })
            .collect();
        let audio_capture = audio_sibling_for(&path);
        out.push(VideoDevice {
            path: stable_path_for(&path).unwrap_or_else(|| path.clone()),
            node: path,
            name: caps.card,
            formats,
            audio_capture,
        });
    }
    out
}

/// `/dev/videoN` numbering follows probe order, so it shifts whenever
/// another camera enumerates first. Prefer the udev `/dev/v4l/by-id`
/// symlink (vendor + product + serial) so a saved selection keeps
/// pointing at the same physical device. None for devices without one,
/// e.g. v4l2loopback.
fn stable_path_for(node: &str) -> Option<String> {
    let target = std::fs::canonicalize(node).ok()?;
    let mut links: Vec<PathBuf> = std::fs::read_dir("/dev/v4l/by-id")
        .ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| std::fs::canonicalize(p).ok().as_ref() == Some(&target))
        .collect();
    links.sort();
    links.into_iter().next().map(|p| p.to_string_lossy().into_owned())
}

/// Resolve the alsa hw identifier of the audio interface that sits on
/// the same USB device as the given v4l2 path. Returns None if the
/// video device isn't on USB or has no audio sibling.
fn audio_sibling_for(video_path: &str) -> Option<String> {
    let video_dev = sysfs_device_root(video_path)?;
    for entry in std::fs::read_dir("/sys/class/sound").ok()? {
        let Ok(entry) = entry else { continue };
        let card_name = entry.file_name();
        let Some(card_str) = card_name.to_str() else { continue };
        let Some(card_idx_str) = card_str.strip_prefix("card") else { continue };
        let Ok(card_idx) = card_idx_str.parse::<u32>() else { continue };
        let Ok(card_dev) = std::fs::canonicalize(entry.path().join("device")) else {
            continue;
        };
        if usb_root(&card_dev) == Some(video_dev.clone()) {
            return Some(format!("hw:{card_idx},0"));
        }
    }
    None
}

/// Resolve the USB device root for a v4l2 path: strip the trailing
/// interface segment (e.g. `:1.0`) so the parent USB device is
/// returned. Used to compare with the alsa card's USB parent.
fn sysfs_device_root(video_path: &str) -> Option<PathBuf> {
    let name = Path::new(video_path).file_name()?.to_str()?;
    let link = format!("/sys/class/video4linux/{name}/device");
    let resolved = std::fs::canonicalize(link).ok()?;
    usb_root(&resolved)
}

/// Walk up the sysfs path until we leave the USB interface (`...:I.J`)
/// and return the USB device directory. Returns None for non-USB
/// devices.
fn usb_root(p: &Path) -> Option<PathBuf> {
    let mut cur = p.to_path_buf();
    while let Some(name) = cur.file_name().and_then(|n| n.to_str()) {
        if !name.contains(':') {
            return Some(cur);
        }
        cur = cur.parent()?.to_path_buf();
    }
    None
}
