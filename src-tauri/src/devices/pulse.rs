//! Audio capture source enumeration via PulseAudio (pactl).
//!
//! pactl gives us friendly per-card descriptions and the underlying
//! alsa.card index. AudioDevice.id is the alsa hw identifier ("hw:4,0")
//! so mpv consumes it directly via `av://alsa:<id>`. This is the same
//! low-latency path the user's standalone elgato-capture.sh script
//! uses.
//!
//! Caveat: when nothing has touched the source recently, pipewire keeps
//! it in `SUSPENDED` state and the kernel alsa device is free. As soon
//! as something opens the pulse source, pipewire grabs the alsa device
//! and locks out alsa-direct readers. The accompanying
//! `suspend_pulse_for_alsa()` flips the pulse source back to suspended
//! so we can safely open hw:N,0 ourselves.

use super::AudioDevice;

/// Enumerate pulse output sinks (speakers, headphones). The `id` is
/// the pulse sink name suitable for `PULSE_SINK=` env on a client.
pub fn enumerate_sinks() -> Vec<AudioDevice> {
    let Ok(output) = std::process::Command::new("pactl")
        .args(["list", "sinks"])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut out = Vec::new();
    for block in split_blocks_with(&text, "\nSink #") {
        let Some(name) = field(block, "Name: ") else { continue };
        let description = field(block, "Description: ").unwrap_or(name);
        out.push(AudioDevice {
            id: name.to_string(),
            label: description.to_string(),
        });
    }
    out
}

fn split_blocks_with<'a>(text: &'a str, marker: &str) -> Vec<&'a str> {
    let mut blocks = Vec::new();
    let mut start = 0;
    for (i, _) in text.match_indices(marker) {
        if i > start {
            blocks.push(&text[start..i]);
        }
        start = i + 1;
    }
    if start < text.len() {
        blocks.push(&text[start..]);
    }
    blocks
}

/// Find the pulse source name corresponding to an alsa hw identifier.
/// Used so we can `pactl suspend-source <name>` before opening the
/// device directly via alsa.
pub fn pulse_source_for_alsa(hw_id: &str) -> Option<String> {
    let (card, device) = parse_hw(hw_id)?;
    parsed_sources().into_iter().find_map(|s| {
        if s.alsa_card.as_deref() == Some(card)
            && s.alsa_device.as_deref().unwrap_or("0") == device
        {
            Some(s.name)
        } else {
            None
        }
    })
}

/// Suspend (`true`) or resume (`false`) a pulse source by name. Best
/// effort — we log on failure but don't return errors, since suspend
/// failure at most means audio still works through the pulse path.
pub fn set_suspended(source: &str, suspend: bool) {
    let arg = if suspend { "1" } else { "0" };
    match std::process::Command::new("pactl")
        .args(["suspend-source", source, arg])
        .status()
    {
        Ok(s) if s.success() => {}
        Ok(s) => tracing::warn!(?s, source, "pactl suspend-source non-zero exit"),
        Err(e) => tracing::warn!(?e, source, "pactl suspend-source failed"),
    }
}

struct Source {
    name: String,
    alsa_card: Option<String>,
    alsa_device: Option<String>,
}

fn parsed_sources() -> Vec<Source> {
    let Ok(output) = std::process::Command::new("pactl")
        .args(["list", "sources"])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut out = Vec::new();
    for block in split_blocks(&text) {
        let Some(name) = field(block, "Name: ") else { continue };
        if name.ends_with(".monitor") {
            continue;
        }
        out.push(Source {
            name: name.to_string(),
            alsa_card: property(block, "alsa.card"),
            alsa_device: property(block, "alsa.device"),
        });
    }
    out
}

fn parse_hw(s: &str) -> Option<(&str, &str)> {
    s.strip_prefix("hw:")?.split_once(',')
}

fn split_blocks(text: &str) -> Vec<&str> {
    let mut blocks = Vec::new();
    let mut start = 0;
    for (i, _) in text.match_indices("\nSource #") {
        if i > start {
            blocks.push(&text[start..i]);
        }
        start = i + 1;
    }
    if start < text.len() {
        blocks.push(&text[start..]);
    }
    blocks
}

fn field<'a>(block: &'a str, prefix: &str) -> Option<&'a str> {
    block
        .lines()
        .map(str::trim_start)
        .find_map(|l| l.strip_prefix(prefix))
        .map(str::trim)
}

fn property(block: &str, key: &str) -> Option<String> {
    let needle = format!("{key} = \"");
    block.lines().find_map(|l| {
        let l = l.trim();
        let rest = l.strip_prefix(&needle)?;
        rest.strip_suffix('"').map(str::to_string)
    })
}
