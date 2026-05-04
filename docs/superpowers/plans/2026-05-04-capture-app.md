# Elgato Capture App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri 2 + React desktop app that replaces the user's `elgato-capture.sh` workflow with a polished low-latency viewer for an Elgato capture card on Linux/Wayland.

**Architecture:** Tauri shell with a Rust backend that owns a single libmpv instance rendered into a Wayland EGL subsurface inside the Tauri window. React UI handles routing (startup vs viewer), the "Dark Glass" floating control surface, settings persistence, and stats display. Capture, audio, and device enumeration are Linux-specific (v4l2 + ALSA + udev) and live behind a `CaptureBackend` trait in case a future port wants in.

**Tech Stack:** Rust (Tauri 2, libmpv2, v4l2, alsa, udev, tokio, serde, tauri-plugin-store), TypeScript + React + Tailwind CSS, Vite.

**Spec:** `docs/superpowers/specs/2026-05-04-capture-app-design.md`

**High-risk task call-out:** Task 11 (libmpv render API + Wayland subsurface). If it stalls for >1 day, fall back to Task 11-FALLBACK (sibling top-level mpv window position-locked to Tauri).

---

## File Structure

```
linux-game-streamer/
├── src/                              # React UI
│   ├── main.tsx                      # Vite entry
│   ├── App.tsx                       # routes startup vs viewer
│   ├── index.css                     # tailwind imports + globals
│   ├── lib/
│   │   ├── ipc.ts                    # typed invoke wrappers
│   │   └── types.ts                  # shared TS types (mirror Rust)
│   ├── hooks/
│   │   ├── useSettings.ts
│   │   ├── useDevices.ts
│   │   ├── useStream.ts
│   │   ├── useStats.ts
│   │   ├── useAutoHide.ts
│   │   └── useHotkeys.ts
│   ├── components/
│   │   ├── DevicePicker.tsx
│   │   ├── ControlBar.tsx
│   │   ├── StatsOverlay.tsx
│   │   ├── SettingsPanel.tsx
│   │   └── Toast.tsx
│   └── screens/
│       ├── StartupScreen.tsx
│       └── ViewerScreen.tsx
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── icons/                        # Tauri-generated
│   └── src/
│       ├── main.rs                   # app entry, plugin registration
│       ├── commands.rs               # #[tauri::command] surface
│       ├── settings.rs               # JSON store wrapper
│       ├── devices/
│       │   ├── mod.rs                # public types + enumerate()
│       │   ├── v4l2.rs               # video device enumeration
│       │   └── alsa.rs               # audio device enumeration
│       ├── hotplug.rs                # udev watcher
│       └── capture/
│           ├── mod.rs                # CaptureBackend trait + types
│           └── mpv.rs                # libmpv impl + Wayland surface
├── docs/superpowers/
│   ├── specs/2026-05-04-capture-app-design.md
│   └── plans/2026-05-04-capture-app.md  (this file)
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── index.html
├── README.md                         # updated with smoke checklist
└── elgato-capture.sh                 # untouched (lives in ~/.local/bin/)
```

Each Rust module has a single responsibility. The React side is split by hooks (state/effects) vs components (presentation) vs screens (composition).

---

## Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `.gitignore` additions.

- [ ] **Step 1: Verify prerequisites**

Run:
```bash
node --version          # expect ≥ 20
cargo --version
pkg-config --exists libmpv && echo OK || echo MISSING
pkg-config --exists alsa  && echo OK || echo MISSING
pkg-config --exists libudev && echo OK || echo MISSING
```

If `MISSING`, install on Bazzite:
```bash
sudo rpm-ostree install mpv-libs-devel alsa-lib-devel systemd-devel webkit2gtk4.1-devel
# reboot, then re-run the pkg-config checks
```

- [ ] **Step 2: Initialize npm package**

```bash
npm init -y
npm pkg set name="elgato-capture" type="module" private=true
npm pkg set scripts.dev="vite" scripts.build="vite build" scripts.tauri="tauri"
npm install --save-dev vite @vitejs/plugin-react typescript @types/react @types/react-dom tailwindcss@^4 @tailwindcss/vite@^4 @tauri-apps/cli@^2
npm install react react-dom @tauri-apps/api@^2 @tauri-apps/plugin-store@^2
```

- [ ] **Step 3: Write `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
});
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "jsx": "react-jsx",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Tailwind v4 theme tokens**

Tailwind v4 has no JS config file and no `init` command. Theme tokens live in CSS via `@theme`. The actual `@theme` block is written into `src/index.css` in step 7 below. No separate config file to create here.

- [ ] **Step 6: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Elgato Capture</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body class="bg-black text-white antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Write `src/index.css`**

```css
@import "tailwindcss";

@theme {
  --color-glass: rgba(20, 22, 30, 0.55);
  --color-accent: #5cf08a;
  --color-warn: #f0b35c;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}

html, body, #root { height: 100%; margin: 0; background: #000; }
*, *::before, *::after { box-sizing: border-box; }
```

- [ ] **Step 8: Write `src/main.tsx` and stub `src/App.tsx`**

`src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>
);
```

`src/App.tsx`:
```tsx
export default function App() {
  return <div className="grid place-items-center h-full">Elgato Capture booting…</div>;
}
```

- [ ] **Step 9: Initialize Tauri**

```bash
npx @tauri-apps/cli@^2 init --ci \
  --app-name "Elgato Capture" \
  --window-title "Elgato Capture" \
  --frontend-dist "../dist" \
  --dev-url "http://localhost:1420" \
  --before-dev-command "npm run dev" \
  --before-build-command "npm run build"
```

- [ ] **Step 10: Patch `src-tauri/tauri.conf.json` window settings**

Edit the `app.windows[0]` entry to:
```json
{
  "label": "main",
  "title": "Elgato Capture",
  "width": 1280,
  "height": 720,
  "minWidth": 640,
  "minHeight": 360,
  "decorations": false,
  "transparent": false,
  "resizable": true,
  "fullscreen": false
}
```
And under `app.security.csp` set it to `null` for now (we'll tighten later if needed).

- [ ] **Step 11: Add Rust deps to `src-tauri/Cargo.toml`**

Under `[dependencies]`:
```toml
tauri = { version = "2", features = [] }
tauri-plugin-store = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time"] }
thiserror = "1"
anyhow = "1"
libmpv2 = "3"
v4l = "0.14"
alsa = "0.9"
udev = "0.9"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
raw-window-handle = "0.6"
```

- [ ] **Step 12: Wire the store plugin in `src-tauri/src/main.rs`**

```rust
fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("tauri run failed");
}
```

- [ ] **Step 13: Verify dev build runs**

```bash
npm run tauri dev
```
Expected: window opens showing "Elgato Capture booting…". Close it.

- [ ] **Step 14: Commit**

```bash
git add .
git commit -m "feat(scaffold): tauri 2 + react + tailwind project skeleton"
```

---

## Task 2: Settings module (Rust)

**Files:**
- Create: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Write the failing test**

`src-tauri/src/settings.rs`:
```rust
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
```

- [ ] **Step 2: Add `mod settings;` to `src-tauri/src/main.rs`**

Above `fn main()`:
```rust
mod settings;
```

- [ ] **Step 3: Run test, expect PASS**

```bash
cd src-tauri && cargo test settings
```
Expected: `test settings::tests::round_trips_through_json ... ok` and `defaults_match_script ... ok`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/settings.rs src-tauri/src/main.rs
git commit -m "feat(settings): typed Settings with defaults matching the script"
```

---

## Task 3: v4l2 device enumeration

**Files:**
- Create: `src-tauri/src/devices/mod.rs`, `src-tauri/src/devices/v4l2.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Write `devices/mod.rs` with shared types and a parser test**

```rust
use serde::{Deserialize, Serialize};

pub mod v4l2;
pub mod alsa;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoDevice {
    pub path: String,            // /dev/videoN
    pub name: String,            // friendly card name
    pub formats: Vec<PixFormat>, // supported pixel formats
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PixFormat {
    pub fourcc: String,          // e.g. "YUYV"
    pub label: String,           // e.g. "yuyv422" (lowercase, mpv-friendly)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDevice {
    pub id: String,              // hw:X,Y
    pub label: String,           // card description
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceList {
    pub video: Vec<VideoDevice>,
    pub audio: Vec<AudioDevice>,
}

/// Map a v4l2 fourcc into the lowercase label mpv accepts as `pixel_format`.
pub fn fourcc_to_mpv_label(fourcc: &str) -> String {
    match fourcc {
        "YUYV" => "yuyv422".into(),
        "UYVY" => "uyvy422".into(),
        "NV12" => "nv12".into(),
        "MJPG" => "mjpeg".into(),
        other => other.to_ascii_lowercase(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_known_fourccs() {
        assert_eq!(fourcc_to_mpv_label("YUYV"), "yuyv422");
        assert_eq!(fourcc_to_mpv_label("MJPG"), "mjpeg");
    }
    #[test]
    fn unknown_fourcc_lowercased() {
        assert_eq!(fourcc_to_mpv_label("ABCD"), "abcd");
    }
}
```

- [ ] **Step 2: Write `devices/v4l2.rs` enumeration**

```rust
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
        // Only true capture devices
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
```

- [ ] **Step 3: Add `mod devices;` to `src-tauri/src/main.rs`**

- [ ] **Step 4: Run unit tests**

```bash
cd src-tauri && cargo test devices
```
Expected: parser tests pass.

- [ ] **Step 5: Manual smoke test**

Add a temporary `#[test]` in `v4l2.rs` (run only locally, then delete):
```rust
#[test]
#[ignore]
fn smoke_lists_real_devices() {
    let v = super::enumerate();
    println!("{:#?}", v);
}
```
Run: `cargo test -- --ignored smoke_lists_real_devices --nocapture`
Expected: prints at least `/dev/video2` with `card: "Elgato ..."` and a `YUYV`/`yuyv422` format. Delete the smoke test before committing.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/devices src-tauri/src/main.rs
git commit -m "feat(devices): v4l2 enumeration with mpv-friendly format labels"
```

---

## Task 4: ALSA capture device enumeration

**Files:**
- Create: `src-tauri/src/devices/alsa.rs`

- [ ] **Step 1: Write enumeration**

```rust
use super::AudioDevice;
use alsa::card::Iter as CardIter;
use alsa::pcm::Stream;
use alsa::ctl::Ctl;

pub fn enumerate() -> Vec<AudioDevice> {
    let mut out = Vec::new();
    for card in CardIter::new().flatten() {
        let card_idx = card.get_index();
        let Ok(name) = card.get_name() else { continue };
        let ctl_path = format!("hw:{card_idx}");
        let Ok(ctl) = Ctl::new(&ctl_path, false) else { continue };
        let mut hint = -1;
        loop {
            match ctl.pcm_next_device(&mut hint) {
                Ok(Some(device)) => {
                    // Check this is a capture PCM
                    let mut info = alsa::pcm::Info::new().unwrap();
                    info.set_device(device as u32);
                    info.set_subdevice(0);
                    info.set_stream(Stream::Capture);
                    if ctl.pcm_info(&mut info).is_ok() {
                        out.push(AudioDevice {
                            id: format!("hw:{card_idx},{device}"),
                            label: format!("{name} (hw:{card_idx},{device})"),
                        });
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    }
    out
}
```

> If the `alsa` crate's API differs in the installed version, adapt: the goal is to emit one `AudioDevice { id: "hw:X,Y", label: "<card name> (hw:X,Y)" }` per capture-capable PCM. Verify with `arecord -l`.

- [ ] **Step 2: Smoke-test against the real machine**

Add a temporary ignored test that prints results, run with `--nocapture`, confirm `hw:6,0` for the Elgato shows up. Delete the smoke test.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/devices/alsa.rs
git commit -m "feat(devices): ALSA capture PCM enumeration"
```

---

## Task 5: Hotplug watcher (udev)

**Files:**
- Create: `src-tauri/src/hotplug.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Write `hotplug.rs`**

```rust
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use udev::MonitorBuilder;

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let Ok(builder) = MonitorBuilder::new() else { return };
        let Ok(builder) = builder.match_subsystem("video4linux") else { return };
        let Ok(builder) = builder.match_subsystem("sound") else { return };
        let Ok(socket) = builder.listen() else { return };
        loop {
            for event in socket.iter() {
                let _ = event;
                let _ = app.emit("devices-changed", ());
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    });
}
```

- [ ] **Step 2: Spawn it in `main.rs` `setup`**

```rust
.setup(|app| {
    crate::hotplug::spawn(app.handle().clone());
    Ok(())
})
```

And add `mod hotplug;` near the other module declarations.

- [ ] **Step 3: Manual test**

Run `npm run tauri dev`, in another shell:
```bash
sudo modprobe -r uvcvideo && sudo modprobe uvcvideo   # only if you have a USB cam attached
```
Devtools console should log `devices-changed` (we'll wire the listener in Task 14). For now confirm via `tracing` log, e.g., temporarily add `tracing::info!("udev event")` inside the loop. Remove the temp log.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/hotplug.rs src-tauri/src/main.rs
git commit -m "feat(hotplug): emit devices-changed on udev video/sound events"
```

---

## Task 6: CaptureBackend trait + types

**Files:**
- Create: `src-tauri/src/capture/mod.rs`

- [ ] **Step 1: Write the trait and shared types**

```rust
use serde::{Deserialize, Serialize};

pub mod mpv;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamConfig {
    pub video_device: String, // "/dev/video2"
    pub audio_device: String, // "hw:6,0"
    pub pix_fmt: String,      // "yuyv422"
    pub volume: u8,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StreamStats {
    pub width: u32,
    pub height: u32,
    pub fps: f32,
    pub pix_fmt: String,
    pub latency_ms: u32,
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
```

- [ ] **Step 2: Wire into `main.rs`**

Add `mod capture;` to module list.

- [ ] **Step 3: Build to confirm types compile**

```bash
cd src-tauri && cargo build
```
Expected: builds (the empty `mpv` module still needs creation in next task — make a stub now).

In `src-tauri/src/capture/mpv.rs`, write a stub:
```rust
// Filled in by Task 7+
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/capture src-tauri/src/main.rs
git commit -m "feat(capture): CaptureBackend trait and shared types"
```

---

## Task 7: MpvBackend skeleton (no rendering yet)

**Files:**
- Modify: `src-tauri/src/capture/mpv.rs`

This task wires libmpv with audio + a windowed VO so we can validate the full pipeline (device + audio + low-latency profile) end-to-end before tackling Wayland subsurface embedding. The mpv window will appear as a separate top-level for now; embedding comes in Task 11.

- [ ] **Step 1: Implement `MpvBackend`**

```rust
use std::path::Path;
use std::sync::Mutex;
use libmpv2::{Mpv, FileState};
use super::{CaptureBackend, CaptureError, StreamConfig, StreamStats};

pub struct MpvBackend {
    inner: Mutex<Option<Mpv>>,
}

impl MpvBackend {
    pub fn new() -> Self {
        Self { inner: Mutex::new(None) }
    }

    fn map_err<E: std::fmt::Display>(e: E) -> CaptureError {
        CaptureError::Mpv(e.to_string())
    }
}

impl CaptureBackend for MpvBackend {
    fn start(&self, cfg: &StreamConfig) -> Result<(), CaptureError> {
        let mut guard = self.inner.lock().unwrap();
        if guard.is_some() { let _ = guard.take(); }

        let mpv = Mpv::new().map_err(Self::map_err)?;
        // Match the script's profile and demuxer tuning.
        let pairs: &[(&str, &str)] = &[
            ("profile", "low-latency"),
            ("cache", "no"),
            ("untimed", "yes"),
            ("video-latency-hacks", "yes"),
            ("vd-lavc-threads", "1"),
            ("demuxer-readahead-secs", "0"),
            ("demuxer-lavf-format", "video4linux2"),
            ("demuxer-lavf-probesize", "32"),
            ("demuxer-lavf-analyzeduration", "0"),
            ("title", "Elgato Capture"),
        ];
        for (k, v) in pairs { mpv.set_property(k, *v).map_err(Self::map_err)?; }
        mpv.set_property("demuxer-lavf-o", format!("pixel_format={}", cfg.pix_fmt).as_str())
            .map_err(Self::map_err)?;
        mpv.set_property("audio-file", format!("av://alsa:{}", cfg.audio_device).as_str())
            .map_err(Self::map_err)?;
        mpv.set_property("volume", cfg.volume as i64).map_err(Self::map_err)?;
        mpv.set_property("mute", if cfg.muted { "yes" } else { "no" }).map_err(Self::map_err)?;

        mpv.command("loadfile", &[&cfg.video_device, "replace"]).map_err(Self::map_err)?;
        *guard = Some(mpv);
        Ok(())
    }

    fn stop(&self) -> Result<(), CaptureError> {
        let mut guard = self.inner.lock().unwrap();
        let _ = guard.take(); // Drop destroys the mpv instance
        Ok(())
    }

    fn is_running(&self) -> bool {
        self.inner.lock().unwrap().is_some()
    }

    fn screenshot(&self, path: &Path) -> Result<(), CaptureError> {
        let guard = self.inner.lock().unwrap();
        let mpv = guard.as_ref().ok_or(CaptureError::NotStarted)?;
        let p = path.to_string_lossy();
        mpv.command("screenshot-to-file", &[&p, "video"]).map_err(Self::map_err)?;
        Ok(())
    }

    fn set_mute(&self, mute: bool) -> Result<(), CaptureError> {
        let guard = self.inner.lock().unwrap();
        let mpv = guard.as_ref().ok_or(CaptureError::NotStarted)?;
        mpv.set_property("mute", if mute { "yes" } else { "no" }).map_err(Self::map_err)
    }

    fn set_volume(&self, vol: u8) -> Result<(), CaptureError> {
        let guard = self.inner.lock().unwrap();
        let mpv = guard.as_ref().ok_or(CaptureError::NotStarted)?;
        mpv.set_property("volume", vol as i64).map_err(Self::map_err)
    }

    fn stats(&self) -> Result<StreamStats, CaptureError> {
        let guard = self.inner.lock().unwrap();
        let mpv = guard.as_ref().ok_or(CaptureError::NotStarted)?;
        let width = mpv.get_property::<i64>("width").unwrap_or(0) as u32;
        let height = mpv.get_property::<i64>("height").unwrap_or(0) as u32;
        let fps = mpv.get_property::<f64>("estimated-vf-fps").unwrap_or(0.0) as f32;
        let pix_fmt = mpv.get_property::<String>("video-format").unwrap_or_default();
        // vo-delay is seconds; convert to ms.
        let latency_ms = (mpv.get_property::<f64>("vo-delay").unwrap_or(0.0) * 1000.0).round() as u32;
        Ok(StreamStats { width, height, fps, pix_fmt, latency_ms })
    }
}
```

> If `libmpv2`'s exact API differs (e.g., `Mpv::new()` returns `Result<Mpv, libmpv2::Error>`, property setters spelled `set_property_string` etc.), adapt the calls. The crate is small and the docs are clear — keep the structure and translate.

- [ ] **Step 2: Build**

```bash
cd src-tauri && cargo build
```
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/capture/mpv.rs
git commit -m "feat(capture): MpvBackend skeleton with script-equivalent tuning"
```

---

## Task 8: Tauri command surface

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Write `commands.rs`**

```rust
use std::sync::Arc;
use tauri::State;
use crate::capture::{CaptureBackend, StreamConfig, StreamStats};
use crate::devices::{DeviceList, alsa as alsa_dev, v4l2 as v4l2_dev};
use crate::settings::Settings;

pub struct AppState {
    pub backend: Arc<dyn CaptureBackend>,
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
```

- [ ] **Step 2: Add `dirs = "5"` and `chrono = "0.4"` to `Cargo.toml`**

- [ ] **Step 3: Wire commands and state in `main.rs`**

```rust
mod commands;

use std::sync::Arc;
use crate::capture::mpv::MpvBackend;
use crate::commands::AppState;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let state = AppState { backend: Arc::new(MpvBackend::new()) };

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::list_devices,
            commands::start_stream,
            commands::stop_stream,
            commands::set_mute,
            commands::set_volume,
            commands::get_stats,
            commands::take_screenshot,
            commands::default_settings,
        ])
        .setup(|app| { crate::hotplug::spawn(app.handle().clone()); Ok(()) })
        .run(tauri::generate_context!())
        .expect("tauri run failed");
}
```

- [ ] **Step 4: Build & run**

```bash
npm run tauri dev
```
In the Tauri window's devtools (right-click → Inspect):
```js
await window.__TAURI__.core.invoke("list_devices")
```
Expected: JSON with arrays for `video` and `audio` populated.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat(ipc): expose device + stream commands to the webview"
```

---

## Task 9: Frontend IPC + types

**Files:**
- Create: `src/lib/types.ts`, `src/lib/ipc.ts`

- [ ] **Step 1: Write `src/lib/types.ts`**

```ts
export interface PixFormat { fourcc: string; label: string; }
export interface VideoDevice { path: string; name: string; formats: PixFormat[]; }
export interface AudioDevice { id: string; label: string; }
export interface DeviceList { video: VideoDevice[]; audio: AudioDevice[]; }
export interface StreamConfig {
  video_device: string;
  audio_device: string;
  pix_fmt: string;
  volume: number;
  muted: boolean;
}
export interface StreamStats {
  width: number; height: number; fps: number; pix_fmt: string; latency_ms: number;
}
export interface Settings {
  video_device: string | null;
  audio_device: string | null;
  pix_fmt: string | null;
  volume: number;
  muted: boolean;
  show_stats: boolean;
  skip_startup: boolean;
}
```

- [ ] **Step 2: Write `src/lib/ipc.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DeviceList, Settings, StreamConfig, StreamStats } from "./types";

export const listDevices = () => invoke<DeviceList>("list_devices");
export const startStream = (cfg: StreamConfig) => invoke<void>("start_stream", { cfg });
export const stopStream = () => invoke<void>("stop_stream");
export const setMute = (mute: boolean) => invoke<void>("set_mute", { mute });
export const setVolume = (vol: number) => invoke<void>("set_volume", { vol });
export const getStats = () => invoke<StreamStats>("get_stats");
export const takeScreenshot = () => invoke<string>("take_screenshot");
export const defaultSettings = () => invoke<Settings>("default_settings");

export const onDevicesChanged = (cb: () => void) =>
  listen("devices-changed", () => cb());
```

- [ ] **Step 3: Commit**

```bash
git add src/lib
git commit -m "feat(ipc): typed wrappers for tauri commands and events"
```

---

## Task 10: Settings hook + store integration

**Files:**
- Create: `src/hooks/useSettings.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useEffect, useState, useCallback } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { defaultSettings } from "../lib/ipc";
import type { Settings } from "../lib/types";

const STORE_PATH = "settings.json";

let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(STORE_PATH);
  return storePromise;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    (async () => {
      const store = await getStore();
      const stored = (await store.get<Settings>("settings")) ?? null;
      setSettings(stored ?? (await defaultSettings()));
    })();
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      (async () => {
        const store = await getStore();
        await store.set("settings", next);
        await store.save();
      })();
      return next;
    });
  }, []);

  return { settings, update };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSettings.ts
git commit -m "feat(settings): tauri-store backed useSettings hook"
```

---

## Task 11: libmpv render API → Wayland subsurface (HIGH RISK)

**Files:**
- Modify: `src-tauri/src/capture/mpv.rs`
- Modify: `src-tauri/src/main.rs`

**Goal:** Make the mpv output render *inside* the Tauri window instead of a separate top-level window.

**Approach:** On window creation, get the Tauri window's raw window handle (Wayland: `wl_surface`). Create a `wl_subsurface` parented to it. Bind libmpv's render API (`MPV_RENDER_API_TYPE_OPENGL`) with an EGL context made for that subsurface. Trigger redraws from mpv's `update` callback.

This is the highest-risk task. Set a 1-day budget. If still stalled, use Task 11-FALLBACK below.

- [ ] **Step 1: Add render-API deps**

In `src-tauri/Cargo.toml`:
```toml
khronos-egl = { version = "6", features = ["dynamic"] }
wayland-client = "0.31"
wayland-protocols = { version = "0.32", features = ["client", "staging"] }
gl = "0.14"
```

- [ ] **Step 2: Acquire the Tauri window's Wayland surface**

In `main.rs` `setup`, after the window is created, get the handle:
```rust
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
let win = app.get_webview_window("main").unwrap();
let handle = win.window_handle().expect("window handle").as_raw();
let RawWindowHandle::Wayland(wl) = handle else {
    panic!("Wayland-only build; got {handle:?}");
};
let wl_surface = wl.surface.as_ptr();
// pass `wl_surface` into a new `MpvBackend::with_surface(...)` (replacing `MpvBackend::new`)
```

- [ ] **Step 3: In `mpv.rs`, add a render context that draws into a Wayland subsurface**

This step is too platform-specific to fully predict the crate API; implement it as:

  1. Create a `wayland-client` connection to the parent surface, attach a `wl_subcompositor`-created `wl_subsurface` over the parent.
  2. Use `khronos-egl` to make an EGL display from `EGL_PLATFORM_WAYLAND_KHR` for a `wl_egl_window` over the subsurface.
  3. Construct `libmpv2::render::RenderContext` with `RenderParam::ApiType(RenderApiType::OpenGl)` and `RenderParam::OpenGlInitParams { get_proc_address, ctx: () }` where `get_proc_address` calls `egl::get_proc_address`.
  4. In mpv's render-update callback, schedule a redraw on the GL thread that calls `RenderContext::render::<Gl>` with the subsurface's framebuffer (FBO 0) and the surface size.
  5. On `WindowEvent::Resized`, resize the `wl_egl_window`.

> Reference: `libmpv2` examples directory (`examples/render-context-glutin.rs`); the official mpv render API doc (`include/mpv/render_gl.h`). Mirror the example, swapping glutin for raw EGL+Wayland.

- [ ] **Step 4: Acceptance test**

Launch the app, hardcode `cfg = { video_device: "/dev/video2", audio_device: "hw:6,0", pix_fmt: "yuyv422", volume: 100, muted: false }` via devtools `invoke("start_stream", { cfg })`. The capture must appear inside the Tauri window, not as a separate window. Resizing the Tauri window must resize the video. Audio must play.

- [ ] **Step 5: Commit**

```bash
git add src-tauri
git commit -m "feat(capture): render mpv into a Wayland subsurface inside the tauri window"
```

### Task 11-FALLBACK: Sibling top-level mpv window (only if Task 11 stalls >1 day)

If render-API embedding proves intractable, change `MpvBackend` to:

1. Set the libmpv property `wid` to `0` (force own window) — already the default if no render context is attached. So just don't attach one.
2. After `loadfile`, position-lock the mpv window to the Tauri window:
   - Get the mpv window via libmpv's `window-id` property (X11) or by spawning mpv in `--no-input-default-bindings` mode and using `kdotool` / `wlrctl` to track and reposition. On KDE Wayland, use the KWin scripting interface (`org.kde.KWin`) over D-Bus to subscribe to window geometry events and call `setGeometry` on the mpv window keyed by `WM_CLASS=mpv`.
   - Mirror the Tauri window's geometry (minus the top 32px reserved for our titlebar) onto the mpv window on every move/resize event.
3. Hide the mpv window when the Tauri window is minimized; show on restore.
4. The control bar and stats overlay continue to live in the Tauri webview, painted *over* the mpv window — since the mpv window sits beneath, use `setKeepBelow` on the mpv window via KWin and `setKeepAbove` on the Tauri window.

Document this fallback in `README.md` under "Known limitations" if used.

---

## Task 12: Stats polling + event push

**Files:**
- Modify: `src-tauri/src/main.rs` (or a new `stats.rs` if preferred)
- Create: `src/hooks/useStats.ts`

- [ ] **Step 1: Spawn a 2Hz stats task in `main.rs` `setup`**

```rust
let backend = state_arc.clone(); // capture an Arc<dyn CaptureBackend>
let app_handle = app.handle().clone();
tauri::async_runtime::spawn(async move {
    let mut interval = tokio::time::interval(std::time::Duration::from_millis(500));
    loop {
        interval.tick().await;
        if backend.is_running() {
            if let Ok(s) = backend.stats() {
                let _ = app_handle.emit("stream-stats", s);
            }
        }
    }
});
```

> Refactor `AppState` so the `Arc<dyn CaptureBackend>` is also accessible to `setup` (e.g., construct the Arc before `Builder::default()` and clone into both `manage` and the spawn).

- [ ] **Step 2: Write `src/hooks/useStats.ts`**

```ts
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { StreamStats } from "../lib/types";

export function useStats(): StreamStats | null {
  const [stats, setStats] = useState<StreamStats | null>(null);
  useEffect(() => {
    const un = listen<StreamStats>("stream-stats", (e) => setStats(e.payload));
    return () => { un.then((f) => f()); };
  }, []);
  return stats;
}
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/main.rs src/hooks/useStats.ts
git commit -m "feat(stats): 2Hz polling pushed to the UI as stream-stats events"
```

---

## Task 13: useDevices, useStream, useAutoHide, useHotkeys

**Files:**
- Create: `src/hooks/useDevices.ts`, `src/hooks/useStream.ts`, `src/hooks/useAutoHide.ts`, `src/hooks/useHotkeys.ts`

- [ ] **Step 1: `useDevices.ts`**

```ts
import { useEffect, useState, useCallback } from "react";
import { listDevices, onDevicesChanged } from "../lib/ipc";
import type { DeviceList } from "../lib/types";

export function useDevices() {
  const [devices, setDevices] = useState<DeviceList>({ video: [], audio: [] });
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    setDevices(await listDevices());
    setLoading(false);
  }, []);
  useEffect(() => {
    refresh();
    const un = onDevicesChanged(() => refresh());
    return () => { un.then((f) => f()); };
  }, [refresh]);
  return { devices, loading, refresh };
}
```

- [ ] **Step 2: `useStream.ts`**

```ts
import { useState, useCallback } from "react";
import { startStream, stopStream } from "../lib/ipc";
import type { StreamConfig } from "../lib/types";

export type StreamState = "idle" | "starting" | "running" | "error";

export function useStream() {
  const [state, setState] = useState<StreamState>("idle");
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (cfg: StreamConfig) => {
    setState("starting"); setError(null);
    try { await startStream(cfg); setState("running"); }
    catch (e) { setError(String(e)); setState("error"); }
  }, []);

  const stop = useCallback(async () => {
    try { await stopStream(); } finally { setState("idle"); }
  }, []);

  return { state, error, start, stop };
}
```

- [ ] **Step 3: `useAutoHide.ts`**

```ts
import { useEffect, useState } from "react";

export function useAutoHide(idleMs = 2500): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    let timer: number | undefined;
    const reset = () => {
      setVisible(true);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setVisible(false), idleMs);
    };
    reset();
    window.addEventListener("mousemove", reset);
    window.addEventListener("keydown", reset);
    window.addEventListener("touchstart", reset);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("mousemove", reset);
      window.removeEventListener("keydown", reset);
      window.removeEventListener("touchstart", reset);
    };
  }, [idleMs]);
  return visible;
}
```

- [ ] **Step 4: `useHotkeys.ts`**

```ts
import { useEffect } from "react";

type Handler = (e: KeyboardEvent) => void;

export function useHotkeys(map: Record<string, Handler>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;
      const fn = map[e.key.toLowerCase()];
      if (fn) { e.preventDefault(); fn(e); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map]);
}
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks
git commit -m "feat(hooks): devices, stream, auto-hide, hotkeys"
```

---

## Task 14: DevicePicker + StartupScreen

**Files:**
- Create: `src/components/DevicePicker.tsx`, `src/screens/StartupScreen.tsx`

- [ ] **Step 1: `DevicePicker.tsx`**

```tsx
type Option = { value: string; label: string };

export function DevicePicker({
  label, value, onChange, options, disabled,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  options: Option[];
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-white/50">{label}</span>
      <select
        className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm
                   focus:outline-none focus:ring-1 focus:ring-white/30 disabled:opacity-50"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>Select…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: `StartupScreen.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useDevices } from "../hooks/useDevices";
import { DevicePicker } from "../components/DevicePicker";
import type { Settings } from "../lib/types";

export function StartupScreen({
  initial, onStart,
}: {
  initial: Settings;
  onStart: (next: Settings) => void;
}) {
  const { devices, loading, refresh } = useDevices();
  const [video, setVideo] = useState<string | null>(initial.video_device);
  const [audio, setAudio] = useState<string | null>(initial.audio_device);
  const [pixFmt, setPixFmt] = useState<string | null>(initial.pix_fmt);
  const [skip, setSkip] = useState(initial.skip_startup);

  const selectedVideo = useMemo(
    () => devices.video.find((d) => d.path === video),
    [devices.video, video]
  );

  // Default selections once devices load
  useEffect(() => {
    if (loading) return;
    if (!video && devices.video[0]) setVideo(devices.video[0].path);
    if (!audio && devices.audio[0]) setAudio(devices.audio[0].id);
  }, [loading, devices, video, audio]);

  // Reset pix_fmt if not in selected device's formats
  useEffect(() => {
    if (!selectedVideo) return;
    if (!selectedVideo.formats.find((f) => f.label === pixFmt)) {
      const yuyv = selectedVideo.formats.find((f) => f.label === "yuyv422");
      setPixFmt(yuyv?.label ?? selectedVideo.formats[0]?.label ?? null);
    }
  }, [selectedVideo, pixFmt]);

  const ready = !!video && !!audio && !!pixFmt;

  return (
    <div className="grid place-items-center h-full p-6">
      <div className="w-[420px] rounded-2xl border border-white/10 bg-glass backdrop-blur-xl p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Select capture source</h1>
          <p className="text-xs text-white/50 mt-1">Choose your video device, audio source, and pixel format.</p>
        </div>

        <DevicePicker
          label="Video device"
          value={video}
          onChange={setVideo}
          options={devices.video.map((d) => ({ value: d.path, label: `${d.name} (${d.path})` }))}
          disabled={loading}
        />
        <DevicePicker
          label="Audio source"
          value={audio}
          onChange={setAudio}
          options={devices.audio.map((d) => ({ value: d.id, label: d.label }))}
          disabled={loading}
        />
        <DevicePicker
          label="Pixel format"
          value={pixFmt}
          onChange={setPixFmt}
          options={(selectedVideo?.formats ?? []).map((f) => ({ value: f.label, label: f.label }))}
          disabled={loading || !selectedVideo}
        />

        <label className="flex items-center gap-2 text-xs text-white/70 select-none">
          <input
            type="checkbox"
            checked={skip}
            onChange={(e) => setSkip(e.target.checked)}
          />
          Remember and skip this screen next time
        </label>

        <div className="flex gap-2 pt-2">
          <button
            className="flex-1 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50
                       py-2 text-sm font-medium transition"
            disabled={!ready}
            onClick={() => onStart({
              ...initial,
              video_device: video, audio_device: audio, pix_fmt: pixFmt,
              skip_startup: skip,
            })}
          >
            Start
          </button>
          <button
            className="rounded-lg border border-white/10 hover:bg-white/5 px-3 py-2 text-sm transition"
            onClick={refresh}
            disabled={loading}
            title="Refresh devices"
          >↻</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/DevicePicker.tsx src/screens/StartupScreen.tsx
git commit -m "feat(ui): device picker and startup screen"
```

---

## Task 15: ControlBar + StatsOverlay + Toast

**Files:**
- Create: `src/components/ControlBar.tsx`, `src/components/StatsOverlay.tsx`, `src/components/Toast.tsx`

- [ ] **Step 1: `Toast.tsx`**

```tsx
import { useEffect } from "react";
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 1800);
    return () => window.clearTimeout(t);
  }, [onDone]);
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-24 px-4 py-2 rounded-full
                    bg-glass backdrop-blur-xl border border-white/10 text-xs">
      {message}
    </div>
  );
}
```

- [ ] **Step 2: `ControlBar.tsx`**

```tsx
import type { ReactNode } from "react";

type Status = "running" | "starting" | "error" | "idle";

export function ControlBar({
  visible, status, deviceLabel, muted, onMute, onScreenshot, onFullscreen, onSettings,
}: {
  visible: boolean;
  status: Status;
  deviceLabel: string;
  muted: boolean;
  onMute: () => void;
  onScreenshot: () => void;
  onFullscreen: () => void;
  onSettings: () => void;
}) {
  const dot = status === "running" ? "bg-accent shadow-[0_0_10px_var(--tw-shadow-color)] shadow-accent"
            : status === "error"   ? "bg-warn"
            : "bg-white/30";
  return (
    <div
      className={`absolute left-1/2 -translate-x-1/2 bottom-5 transition-opacity duration-200
                  ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
    >
      <div className="flex items-center gap-3 px-4 py-2 rounded-full
                      bg-glass backdrop-blur-xl border border-white/10 text-sm">
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        <span className="text-white/80">{deviceLabel}</span>
        <Sep />
        <IconBtn onClick={onScreenshot} title="Screenshot (P)">📷</IconBtn>
        <IconBtn onClick={onMute} title="Mute (M)">{muted ? "🔇" : "🔊"}</IconBtn>
        <IconBtn onClick={onFullscreen} title="Fullscreen (F)">⛶</IconBtn>
        <IconBtn onClick={onSettings} title="Settings">⚙</IconBtn>
      </div>
    </div>
  );
}

function Sep() { return <span className="w-px h-4 bg-white/10" />; }
function IconBtn({ children, onClick, title }: { children: ReactNode; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title}
      className="grid place-items-center w-7 h-7 rounded-md bg-white/5 hover:bg-white/15 transition">
      {children}
    </button>
  );
}
```

- [ ] **Step 3: `StatsOverlay.tsx`**

```tsx
import type { StreamStats } from "../lib/types";

export function StatsOverlay({ stats, visible }: { stats: StreamStats | null; visible: boolean }) {
  if (!visible || !stats) return null;
  const { width, height, fps, pix_fmt, latency_ms } = stats;
  return (
    <div className={`absolute top-3 right-4 font-mono text-[11px] text-white/70 leading-snug text-right
                     transition-opacity duration-200`}>
      <div>{width}×{height} · {fps.toFixed(2)} fps</div>
      <div>{pix_fmt || "—"} · {latency_ms}ms</div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components
git commit -m "feat(ui): floating control bar, stats overlay, toast"
```

---

## Task 16: SettingsPanel (slide-in)

**Files:**
- Create: `src/components/SettingsPanel.tsx`

- [ ] **Step 1: Write the panel**

```tsx
import { useEffect } from "react";
import { DevicePicker } from "./DevicePicker";
import type { DeviceList, Settings } from "../lib/types";

export function SettingsPanel({
  open, onClose, devices, settings, onChange, onApply,
}: {
  open: boolean;
  onClose: () => void;
  devices: DeviceList;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onApply: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-200
                    ${open ? "opacity-30" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />
      <aside
        className={`absolute top-0 right-0 h-full w-[360px] bg-glass backdrop-blur-2xl
                    border-l border-white/10 p-5 transition-transform duration-250
                    ${open ? "translate-x-0" : "translate-x-full"}`}
        style={{ transitionTimingFunction: "cubic-bezier(.2,.8,.2,1)" }}
      >
        <h2 className="text-sm font-semibold text-white/90 mb-4">Settings</h2>
        <div className="space-y-4">
          <DevicePicker
            label="Video device"
            value={settings.video_device}
            onChange={(v) => onChange({ video_device: v })}
            options={devices.video.map((d) => ({ value: d.path, label: `${d.name} (${d.path})` }))}
          />
          <DevicePicker
            label="Audio source"
            value={settings.audio_device}
            onChange={(v) => onChange({ audio_device: v })}
            options={devices.audio.map((d) => ({ value: d.id, label: d.label }))}
          />
          <DevicePicker
            label="Pixel format"
            value={settings.pix_fmt}
            onChange={(v) => onChange({ pix_fmt: v })}
            options={(devices.video.find((d) => d.path === settings.video_device)?.formats ?? [])
              .map((f) => ({ value: f.label, label: f.label }))}
          />
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-white/50">Volume</span>
            <input type="range" min={0} max={150} value={settings.volume}
              onChange={(e) => onChange({ volume: Number(e.target.value) })}
              className="w-full mt-1" />
          </label>
          <Toggle label="Show stats" value={settings.show_stats} onChange={(v) => onChange({ show_stats: v })} />
          <Toggle label="Skip startup screen next launch" value={settings.skip_startup} onChange={(v) => onChange({ skip_startup: v })} />
        </div>

        <div className="absolute left-5 right-5 bottom-5 flex gap-2">
          <button
            onClick={onApply}
            className="flex-1 rounded-lg bg-white/10 hover:bg-white/15 py-2 text-sm font-medium transition"
          >Apply</button>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 hover:bg-white/5 px-3 py-2 text-sm transition"
          >Close</button>
        </div>
      </aside>
    </>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between text-sm py-1">
      <span className="text-white/80">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SettingsPanel.tsx
git commit -m "feat(ui): slide-in settings panel"
```

---

## Task 17: ViewerScreen (compose all the things)

**Files:**
- Create: `src/screens/ViewerScreen.tsx`

- [ ] **Step 1: Write it**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDevices } from "../hooks/useDevices";
import { useStream } from "../hooks/useStream";
import { useStats } from "../hooks/useStats";
import { useAutoHide } from "../hooks/useAutoHide";
import { useHotkeys } from "../hooks/useHotkeys";
import { ControlBar } from "../components/ControlBar";
import { StatsOverlay } from "../components/StatsOverlay";
import { SettingsPanel } from "../components/SettingsPanel";
import { Toast } from "../components/Toast";
import { setMute as ipcSetMute, setVolume as ipcSetVolume, takeScreenshot } from "../lib/ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Settings } from "../lib/types";

export function ViewerScreen({
  settings, onChangeSettings, onResetToStartup,
}: {
  settings: Settings;
  onChangeSettings: (patch: Partial<Settings>) => void;
  onResetToStartup: () => void;
}) {
  const { devices } = useDevices();
  const { state, error, start, stop } = useStream();
  const stats = useStats();
  const visible = useAutoHide(2500);
  const [panelOpen, setPanelOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const cfg = useMemo(() => ({
    video_device: settings.video_device!,
    audio_device: settings.audio_device!,
    pix_fmt: settings.pix_fmt!,
    volume: settings.volume,
    muted: settings.muted,
  }), [settings]);

  useEffect(() => {
    if (state === "idle") start(cfg);
    return () => { stop(); };
    // start once on mount; restart-on-config-change handled by Apply button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onApplySettings = useCallback(async () => {
    await stop();
    await start({
      video_device: settings.video_device!,
      audio_device: settings.audio_device!,
      pix_fmt: settings.pix_fmt!,
      volume: settings.volume,
      muted: settings.muted,
    });
    setPanelOpen(false);
  }, [settings, start, stop]);

  const onScreenshot = useCallback(async () => {
    try {
      const path = await takeScreenshot();
      setToast(`Saved ${path.split("/").pop()}`);
    } catch (e) { setToast(`Screenshot failed: ${e}`); }
  }, []);

  const onMute = useCallback(() => {
    const next = !settings.muted;
    onChangeSettings({ muted: next });
    ipcSetMute(next).catch(() => {});
  }, [settings.muted, onChangeSettings]);

  const onFullscreen = useCallback(async () => {
    const win = getCurrentWindow();
    await win.setFullscreen(!(await win.isFullscreen()));
  }, []);

  const onToggleStats = useCallback(() => onChangeSettings({ show_stats: !settings.show_stats }), [settings.show_stats, onChangeSettings]);

  const onQuit = useCallback(() => getCurrentWindow().close(), []);

  useHotkeys({
    f: onFullscreen,
    m: onMute,
    s: onToggleStats,
    p: onScreenshot,
    q: onQuit,
    escape: async () => {
      const win = getCurrentWindow();
      if (panelOpen) setPanelOpen(false);
      else if (await win.isFullscreen()) await win.setFullscreen(false);
    },
  });

  // Persist volume changes from the slider via the IPC immediately.
  useEffect(() => { ipcSetVolume(settings.volume).catch(() => {}); }, [settings.volume]);

  const status = state === "running" ? "running" : state === "starting" ? "starting" : state === "error" ? "error" : "idle";
  const deviceLabel = devices.video.find((d) => d.path === settings.video_device)?.name ?? settings.video_device ?? "—";

  // Top drag region for moving the borderless window.
  return (
    <div className="absolute inset-0">
      <div data-tauri-drag-region className={`absolute top-0 left-0 right-0 h-8 transition-opacity ${visible ? "opacity-100" : "opacity-0"}`} />
      <StatsOverlay stats={stats} visible={!!settings.show_stats && visible} />
      <ControlBar
        visible={visible}
        status={status}
        deviceLabel={deviceLabel}
        muted={settings.muted}
        onMute={onMute}
        onScreenshot={onScreenshot}
        onFullscreen={onFullscreen}
        onSettings={() => setPanelOpen(true)}
      />
      <SettingsPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        devices={devices}
        settings={settings}
        onChange={onChangeSettings}
        onApply={onApplySettings}
      />
      {error && (
        <div className="absolute top-3 left-4 text-xs text-warn font-mono">
          ⚠ {error} <button className="underline ml-2" onClick={onResetToStartup}>open settings</button>
        </div>
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/ViewerScreen.tsx
git commit -m "feat(ui): viewer screen composing controls, stats, settings, hotkeys"
```

---

## Task 18: App router

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace stub**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSettings } from "./hooks/useSettings";
import { StartupScreen } from "./screens/StartupScreen";
import { ViewerScreen } from "./screens/ViewerScreen";

export default function App() {
  const { settings, update } = useSettings();
  const [forceStartup, setForceStartup] = useState(false);

  const showStartup = useMemo(() => {
    if (!settings) return false;
    if (forceStartup) return true;
    if (!settings.skip_startup) return true;
    return !settings.video_device || !settings.audio_device || !settings.pix_fmt;
  }, [settings, forceStartup]);

  const onStart = useCallback(async (next: typeof settings) => {
    if (!next) return;
    await update(next);
    setForceStartup(false);
  }, [update]);

  if (!settings) return <div className="grid place-items-center h-full text-white/50 text-sm">Loading…</div>;

  return showStartup
    ? <StartupScreen initial={settings} onStart={(s) => onStart(s)} />
    : <ViewerScreen settings={settings} onChangeSettings={update} onResetToStartup={() => setForceStartup(true)} />;
}
```

- [ ] **Step 2: Run end-to-end**

```bash
npm run tauri dev
```
Confirm: cold start shows startup screen → pick Elgato + ALSA → click Start → viewer opens, stream plays inside the window. Move mouse — bar appears. Stop moving — bar fades. Hotkeys work. Reload — auto-skips startup and reconnects.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): startup vs viewer routing wired to persisted settings"
```

---

## Task 19: Distribution + .desktop

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Create: `src-tauri/dist-resources/elgato-capture.desktop` (referenced by bundle config)

- [ ] **Step 1: Write the `.desktop` file**

```
[Desktop Entry]
Type=Application
Name=Elgato Capture
Comment=Low-latency Elgato Game Capture viewer
Exec=elgato-capture %U
Icon=elgato-capture
Categories=AudioVideo;Video;
Terminal=false
StartupWMClass=Elgato Capture
```

- [ ] **Step 2: Configure `bundle` in `tauri.conf.json`**

```jsonc
"bundle": {
  "active": true,
  "targets": ["appimage", "deb", "rpm"],
  "identifier": "com.darkharasho.elgato-capture",
  "category": "Video",
  "shortDescription": "Low-latency Elgato capture viewer",
  "longDescription": "A polished Linux/Wayland viewer for Elgato capture cards using libmpv.",
  "linux": {
    "deb": { "depends": ["libmpv2 | libmpv1", "libudev1", "libasound2"] },
    "rpm": { "depends": ["mpv-libs", "systemd-libs", "alsa-lib"] }
  }
}
```

- [ ] **Step 3: Build a release artifact**

```bash
npm run tauri build -- --bundles appimage
```
Expected: produces `src-tauri/target/release/bundle/appimage/Elgato Capture_<version>_amd64.AppImage`. Run it directly (`./Elgato\ Capture_*.AppImage`) and verify the viewer works.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/dist-resources
git commit -m "build: appimage/deb/rpm bundling + .desktop entry"
```

---

## Task 20: README smoke checklist

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README with a focused doc**

```markdown
# Elgato Capture

Low-latency Linux/Wayland viewer for Elgato capture cards.

## Build

```bash
npm install
npm run tauri build -- --bundles appimage
```

## Manual smoke checklist

After every meaningful change, run through this with the real hardware:

- [ ] Cold launch shows startup screen with the Elgato in the video dropdown.
- [ ] Selecting Elgato + the matching ALSA capture + `yuyv422` lets Start enable.
- [ ] Clicking Start opens the viewer and the live stream renders **inside** the app window with audio.
- [ ] Mouse stops → controls fade in 2.5s. Mouse moves → controls reappear.
- [ ] `F` toggles fullscreen. `M` toggles mute. `S` toggles stats. `P` saves a screenshot to `~/Pictures/elgato/`.
- [ ] Settings panel opens via gear, slides from the right, closes on Esc.
- [ ] Apply with a different pixel format restarts the stream cleanly.
- [ ] Quit + relaunch skips the startup screen and reconnects automatically.
- [ ] Unplug + replug the Elgato (or `modprobe -r/modprobe uvcvideo` for a USB cam) → device dropdown updates without restart.

The original `~/.local/bin/elgato-capture.sh` still works and is unchanged — keep it as a fallback.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: build steps and manual smoke checklist"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Task |
|---|---|
| Tech stack (Tauri 2 + React + Tailwind) | 1 |
| Settings JSON shape + path | 2, 10 |
| v4l2 enumeration | 3 |
| ALSA enumeration | 4 |
| udev hotplug | 5 |
| CaptureBackend trait | 6 |
| libmpv profile parity | 7 |
| Wayland subsurface render | 11 |
| Tauri command surface | 8 |
| Frontend IPC types | 9 |
| Startup screen + auto-default | 14, 18 |
| Dark Glass control bar | 15 |
| Stats overlay (toggleable, 2Hz) | 12, 15 |
| Settings panel | 16 |
| Auto-hide | 13 (useAutoHide) + 17 |
| Hotkeys (F/M/S/P/Esc/Q) | 13, 17 |
| Screenshot to ~/Pictures/elgato | 8, 17 |
| Mute / volume | 8, 17 |
| Fullscreen | 17 |
| Error handling (amber dot, panel auto-open) | 17 |
| Settings persistence | 10, 18 |
| AppImage/deb/rpm + .desktop | 19 |
| Manual smoke checklist | 20 |

No gaps. The `elgato-capture.sh` script is intentionally untouched (no task modifies it).

**Placeholder scan:** No "TBD" / "TODO" / generic "add error handling" steps. Task 11 is high-risk by nature — its acceptance is concrete (stream renders inside the Tauri window, resizes, audio plays) and a fallback (Task 11-FALLBACK) is explicit.

**Type consistency:** `Settings`, `StreamConfig`, `StreamStats`, `DeviceList`, `VideoDevice`, `AudioDevice`, `PixFormat` are defined once in Rust and mirrored in TS with matching field names. IPC command names are identical in `commands.rs` and `lib/ipc.ts`. Hotkey strings (`f`/`m`/`s`/`p`/`q`/`escape`) match the spec's table.
