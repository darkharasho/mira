# Mira

Low-latency Linux viewer for Elgato (and other v4l2/USB) capture cards. Built with Tauri 2 + React + Tailwind, drives mpv via IPC, and routes audio through a custom dsnoop ALSA wrapper for sub-30ms capture latency. Replaces the bare `~/.local/bin/elgato-capture.sh` workflow with a real control surface.

Validated on Bazzite (Fedora) + KDE Plasma + Wayland with an Elgato Game Capture Neo at `/dev/video2`.

## Architecture

The Tauri window is a **transparent control surface** (Dark Glass: floating pill bar, stats overlay, slide-in settings panel). The actual video is rendered by a sibling **mpv window** running borderless and position-locked to the Tauri window via geometry tracking and a one-shot KWin script. The two windows look like one for normal usage.

A future Task 21 (deferred) replaces the sibling-window setup with libmpv's render API into a Wayland subsurface, removing the seam entirely.

## Build environment

Bazzite is immutable Fedora — its custom mesa stack means devel headers should not be layered on the host. All builds happen in a Fedora distrobox.

```bash
distrobox create --name elgato-dev --image registry.fedoraproject.org/fedora-toolbox:42
distrobox enter elgato-dev -- bash -lc "sudo dnf install -y \
  alsa-lib-devel mpv-libs-devel libudev-devel webkit2gtk4.1-devel \
  gcc gcc-c++ pkgconf-pkg-config nodejs cargo"
```

For AppImage bundling, also drop `linuxdeploy-x86_64.AppImage` and `appimagetool-x86_64.AppImage` (from their upstream GitHub releases) onto the distrobox `$PATH`.

## Build

```bash
distrobox enter elgato-dev -- bash -lc "cd /path/to/linux-game-streamer && \
  npm install && npm run tauri build -- --bundles appimage"
```

The resulting AppImage runs natively on the host — Tauri bundles the runtime libs.

## Develop

These npm scripts run from the host and shell into the `elgato-dev` distrobox for you:

```bash
npm run app:dev      # tauri dev (full app, hot reload)
npm run app:build    # release AppImage
npm run app:test     # rust unit tests
npm run app:shell    # drop into the container
```

Vite-only commands (`npm run dev`, `npm run build`) run on the host as usual — they don't need libmpv/ALSA headers.

## Hotkeys

| Key   | Action                          |
|-------|---------------------------------|
| `F`   | Toggle fullscreen               |
| `M`   | Toggle mute                     |
| `S`   | Toggle stats overlay            |
| `P`   | Take screenshot                 |
| `Esc` | Close panel / exit fullscreen   |
| `Q`   | Quit                            |

Screenshots land in `~/Pictures/mira/capture-YYYYMMDD-HHMMSS.png`.

## Manual smoke checklist

Run after every meaningful change with the real hardware:

- [ ] Cold launch shows the startup screen with the Elgato in the video dropdown.
- [ ] Selecting Elgato + the matching ALSA capture + `yuyv422` enables the Start button.
- [ ] Clicking Start opens the mpv window underneath, position-locked behind the Tauri window's video region. Audio plays.
- [ ] Mouse stops → controls fade in 2.5s. Mouse moves → controls reappear.
- [ ] `F` toggles fullscreen. `M` toggles mute. `S` toggles stats. `P` saves a screenshot to `~/Pictures/elgato/`.
- [ ] Settings panel opens via the gear icon, slides from the right, closes on Esc.
- [ ] Apply with a different pixel format restarts the stream cleanly.
- [ ] Quit + relaunch skips the startup screen and reconnects automatically.
- [ ] Unplug + replug the Elgato (or `modprobe -r/modprobe uvcvideo` for a USB cam) → device dropdowns update without restart.
- [ ] Move the Tauri window — the mpv window tracks within ~1 frame.

## Known limitations

- **Two windows.** mpv runs as a sibling top-level window position-locked to the Tauri window. There may be a brief geometry mismatch on rapid drag/resize. Embedded rendering is deferred to Task 21.
- **KWin scripting is best-effort.** The `keepBelow` + `noBorder` script runs once 1.5s after Tauri startup. If you click Start later than that, the mpv window may briefly appear above. Toggle the gear icon's Apply to nudge the script (or just wait — geometry tracking is unaffected).
- **The `~/.local/bin/elgato-capture.sh` script is unchanged** and remains a fallback if the app misbehaves.

## Spec & plan

- Spec: [`docs/superpowers/specs/2026-05-04-capture-app-design.md`](docs/superpowers/specs/2026-05-04-capture-app-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-05-04-capture-app.md`](docs/superpowers/plans/2026-05-04-capture-app.md)
