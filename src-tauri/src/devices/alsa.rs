//! ALSA capture-PCM enumeration.
//!
//! Walks every sound card, asks each card's control interface for its PCM
//! devices, and emits one `AudioDevice` per PCM that supports capture.
use super::AudioDevice;
use alsa::card::Iter as CardIter;
use alsa::ctl::{Ctl, DeviceIter};
use alsa::Direction;

pub fn enumerate() -> Vec<AudioDevice> {
    let mut out = Vec::new();
    for card in CardIter::new().flatten() {
        let card_idx = card.get_index();
        let name = match card.get_name() {
            Ok(n) => n,
            Err(_) => continue,
        };
        let ctl_path = format!("hw:{card_idx}");
        let ctl = match Ctl::new(&ctl_path, false) {
            Ok(c) => c,
            Err(_) => continue,
        };
        for device in DeviceIter::new(&ctl) {
            // pcm_info returns Err for streams the device does not support,
            // so a successful Capture query means this PCM is capture-capable.
            if ctl.pcm_info(device as u32, 0, Direction::Capture).is_ok() {
                out.push(AudioDevice {
                    id: format!("hw:{card_idx},{device}"),
                    label: format!("{name} (hw:{card_idx},{device})"),
                });
            }
        }
    }
    out
}
