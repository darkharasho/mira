# Elgato Capture App — Design

## Goal

Replace the user's existing `~/.local/bin/elgato-capture.sh` workflow with a polished
desktop app that displays a live, low-latency view of an Elgato capture card and
exposes a small set of controls through a modern UI. The bash script is **not**
modified or removed — it continues to live alongside the app.

## Scope

**In scope (single-window viewer app):**

- Live v4l2 + ALSA capture preview with latency parity to the existing mpv script.
- Device + audio + pixel-format selection on first launch and via in-app settings.
- A "Dark Glass" floating control surface over the live video.
- Stats overlay (resolution, fps, latency, pixel format), toggleable.
- Fullscreen, mute, screenshot.
- Auto-hide controls when idle.
- Persistent user settings.

**Out of scope:**

- Recording to file.
- Hotkey/scene presets, overlays, multi-source compositing.
- Cross-platform support (Windows/macOS). The capture stack is Linux-only;
  abstractions allow a future port but no non-Linux backend is implemented.
- Modifying or replacing `elgato-capture.sh`.

## Target environment

- Linux only.
- Wayland (X11 not targeted; not deliberately broken).
- Validated on Bazzite (Fedora-based) + KDE Plasma. Other Wayland compositors
  (GNOME, wlroots) are expected to work but are not validation targets.

## Architecture

### Tech stack

- **Shell:** Tauri 2 (Rust core + system webview for UI).
- **UI:** React + TypeScript + Tailwind CSS.
- **Video:** libmpv via the `libmpv2` Rust crate, rendered through mpv's render
  API into a Wayland EGL subsurface inside the Tauri window.
- **Audio:** mpv's existing ALSA path (`av://alsa:hw:X,Y`).
- **Device enumeration:** `v4l2` + `alsa` Rust crates; `udev` for hotplug events.
- **Settings persistence:** `tauri-plugin-store` writing JSON to
  `$XDG_CONFIG_HOME/elgato-capture/settings.json`.

### Why libmpv (not GStreamer, not subprocess+`--wid`)

The existing script proves mpv with `--profile=low-latency` plus the demuxer
tuning produces acceptable latency. Reusing that profile through libmpv keeps
latency parity for free. `--wid` embedding is X11-only and the target is
Wayland. GStreamer is feasible but requires re-tuning to match latency and
loses mpv's profile system. A separate-window fallback (mpv as its own
top-level window position-locked to Tauri) is documented as a contingency
but not the default plan.

### Capture backend abstraction

The Rust backend exposes a `CaptureBackend` trait with the lifecycle the UI
needs (`enumerate_devices`, `start(config)`, `stop`, `screenshot`, property
get/set, event stream). The `MpvBackend` is the only implementation. The trait
exists so a hypothetical Windows/macOS backend could slot in later — it is not
a requirement of this project to write one.

### Process model

A single Tauri process. mpv runs in-process via libmpv (no child process).
Rust owns one `MpvInstance` at a time. Stream parameter changes (device, pixel
format, audio source) tear down the instance and recreate it; mpv's startup is
fast enough (<1s) that live re-routing isn't worth the complexity.

## UI flow

```
launch
  │
  ├── settings exist AND saved devices resolve ──▶ Viewer (stream auto-starts)
  │                                                    │
  │                                                    ├── gear → Settings panel (overlay)
  │                                                    └── close → stop + persist + exit
  │
  └── otherwise ──▶ Startup screen
                      │
                      └── Start clicked ──▶ Viewer
```

### Startup screen

Centered card on a dark backdrop. Fields:

- **Video device** — dropdown of detected v4l2 devices (friendly name + `/dev/videoN`).
- **Audio source** — dropdown of ALSA capture PCMs (`hw:X,Y` with card name).
- **Pixel format** — populated from the chosen video device's reported formats.
  Defaults to `yuyv422` if available (matches the script).
- **"Remember and skip this screen next time"** checkbox (default on).
- **Start** button. Disabled until video and audio are valid.

If a previously-saved device is now missing, the startup screen is shown with
a one-line "previous device unavailable" notice instead of erroring into the
viewer.

### Viewer

Borderless window, video fills it. The "Dark Glass" surface is overlaid:

- **Floating pill bar** (bottom center): status dot, device label, fullscreen
  button, screenshot button, mute toggle, gear icon. Backdrop blur, rounded,
  subtle border.
- **Stats overlay** (top right, monospace): two lines —
  `{w}×{h} · {fps} fps` / `{pix_fmt} · {latency_ms}ms`. Toggleable.
- **Auto-hide:** mouse movement or keypress reveals controls; 2.5s of stillness
  fades them (200ms ease).
- **Custom titlebar:** top 32px is a draggable region while controls are
  visible. No native window decorations. Close/minimize live in the floating
  bar's far right when not fullscreen.

### Settings panel

Triggered by the gear icon. Slides in from the right, ~360px wide. Video keeps
running behind it, dimmed to ~70%. Contents:

- Same three pickers as startup (video device, audio source, pixel format).
- Volume slider.
- "Show stats" toggle.
- "Skip startup screen next launch" toggle.
- Footer with About + Quit.

Closes on click-outside or `Esc`.

### Hotkeys

| Key   | Action                          |
|-------|---------------------------------|
| `F`   | Toggle fullscreen               |
| `M`   | Toggle mute                     |
| `S`   | Toggle stats overlay            |
| `P`   | Take screenshot                 |
| `Esc` | Close panel / exit fullscreen   |
| `Q`   | Quit                            |

## Visual direction — Dark Glass

- Background: pure black (the video is the surface).
- Control bar: `rgba(20,22,30,0.55)` with `backdrop-filter: blur(14px)` and
  a 1px white-8% inner border. Rounded full pill.
- Status dot: `#5cf08a` with a soft glow when streaming, amber on error.
- Stats overlay: `ui-monospace` font, white at 70% opacity.
- Settings panel: same glass treatment, larger radius on the inner edge.
- Motion: 200ms ease for show/hide; settings panel slides 250ms cubic-bezier.

## Feature behaviors

### Device enumeration

- v4l2: list `/dev/video*`, query `VIDIOC_QUERYCAP` for friendly name and
  `VIDIOC_ENUM_FMT` / `VIDIOC_ENUM_FRAMESIZES` for supported formats.
- ALSA: enumerate capture PCMs via the `alsa` crate, surfacing `hw:X,Y` and
  card description.
- Hotplug: a Rust `udev` monitor on the `video4linux` and `sound` subsystems
  emits a Tauri event; the UI silently refreshes its dropdowns.

### Stream lifecycle

`MpvBackend::start(config)`:

1. Create libmpv instance.
2. Apply equivalents of the script's flags: `profile=low-latency`,
   `cache=no`, `untimed=yes`, `video-latency-hacks=yes`, `vd-lavc-threads=1`,
   `demuxer-readahead-secs=0`, `demuxer-lavf-format=video4linux2`,
   `demuxer-lavf-o=pixel_format=<chosen>`, `demuxer-lavf-probesize=32`,
   `demuxer-lavf-analyzeduration=0`, `audio-file=av://alsa:<chosen>`.
3. Wire the render API to the Wayland EGL subsurface owned by the Rust side.
4. `loadfile <video device>`.

`stop()` destroys the instance and releases the surface.

### Stats

A 2Hz Tokio task on the Rust side reads mpv properties (`width`, `height`,
`estimated-vf-fps`, `video-format`, `vo-delay`) and emits a Tauri event the
overlay consumes. No-op when overlay is hidden.

### Screenshot

mpv `screenshot` command into `~/Pictures/elgato/` (created if missing),
filename `capture-YYYYMMDD-HHMMSS.png`. The bar shows a brief toast on success.

### Mute / volume

mpv `mute` and `volume` properties; persisted.

### Fullscreen

Tauri `Window::set_fullscreen`. The control bar continues to auto-hide.

### Auto-hide

Implemented in the React layer with a single `useAutoHide` hook listening on
`mousemove` / `keydown`. 2.5s idle threshold.

### Settings persistence

`tauri-plugin-store` JSON at `$XDG_CONFIG_HOME/elgato-capture/settings.json`:

```json
{
  "video_device": "/dev/video2",
  "audio_device": "hw:6,0",
  "pix_fmt": "yuyv422",
  "volume": 100,
  "muted": false,
  "show_stats": true,
  "skip_startup": true
}
```

### Errors

- Device disappears or mpv fails to start: status dot turns amber, the bar
  shows a one-line message, the settings panel opens automatically.
- Settings file corrupt or missing: treated as first launch.

### Quit

Window close → stop mpv → persist settings → exit. Cleanly destroys the
libmpv instance to avoid orphaned ALSA holds.

## Project structure

```
linux-game-streamer/
├── src/                          # React UI
│   ├── App.tsx                   # routes startup vs viewer
│   ├── screens/
│   │   ├── StartupScreen.tsx
│   │   └── ViewerScreen.tsx
│   ├── components/
│   │   ├── ControlBar.tsx
│   │   ├── StatsOverlay.tsx
│   │   ├── SettingsPanel.tsx
│   │   ├── DevicePicker.tsx
│   │   └── Toast.tsx
│   ├── hooks/
│   │   ├── useDevices.ts
│   │   ├── useStream.ts
│   │   ├── useStats.ts
│   │   ├── useSettings.ts
│   │   └── useAutoHide.ts
│   ├── lib/ipc.ts                # typed invoke wrappers
│   └── styles/
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands.rs
│   │   ├── capture/
│   │   │   ├── mod.rs            # CaptureBackend trait
│   │   │   └── mpv.rs
│   │   ├── devices/
│   │   │   ├── mod.rs
│   │   │   ├── v4l2.rs
│   │   │   └── alsa.rs
│   │   ├── hotplug.rs
│   │   └── settings.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── README.md
└── CLAUDE.md
```

### Dependencies

**Rust:** `tauri` 2, `libmpv2`, `v4l2`, `alsa`, `udev`, `tauri-plugin-store`,
`serde`, `serde_json`, `tokio`.

**JS:** `react`, `react-dom`, `tailwindcss`, `@tauri-apps/api`,
`@tauri-apps/plugin-store`.

## Testing

Lean. This is a single-user desktop app; the value is in manual verification
on the actual hardware.

- Rust unit tests for device-info parsing and settings round-trip.
- A manual smoke checklist captured in `README.md`: cold start, device
  switch, fullscreen, screenshot, hotplug, settings persistence across
  restarts.

No UI/E2E tests — Tauri + Wayland harnesses are not worth maintaining for
this scope.

## Distribution

`cargo tauri build` produces AppImage, `.deb`, and `.rpm`. AppImage is the
primary target for Bazzite (immutable Fedora). A `.desktop` file ships in the
bundle so the app appears in the launcher.

## Risks and open questions

- **libmpv render API + Wayland subsurface plumbing** is the highest-risk
  piece. If it stalls during implementation, fall back to running mpv as a
  position-locked sibling top-level window (the script's behavior with extra
  glue). The user-visible result is acceptable; the architectural cost is
  documented.
- **Tauri webview's window handle exposure on Wayland** must be sufficient to
  parent a subsurface. If not, the fallback above applies.
- **udev permissions** — the user already has working v4l2/ALSA access since
  the script works; no extra group setup expected.
