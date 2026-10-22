import { useEffect, useRef, useState } from "react";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { DevicePicker } from "./DevicePicker";
import { findVideoDevice, formatCaptureMode, type DeviceList, type Settings } from "../lib/types";

/// Sentinel for the "let the backend pick" capture-mode choice. Can't
/// be "" — DevicePicker already uses that for its disabled placeholder.
const AUTO_MODE = "auto";

type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | {
      kind: "available";
      version: string;
      update: Awaited<ReturnType<typeof checkForUpdate>>;
    }
  | { kind: "installing" }
  | { kind: "error"; msg: string };

export function SettingsPanel({
  open,
  onClose,
  devices,
  settings,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  devices: DeviceList;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const [appVersion, setAppVersion] = useState<string>("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ kind: "idle" });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    setUpdateStatus({ kind: "checking" });
    try {
      const update = await checkForUpdate();
      if (update?.available) {
        setUpdateStatus({ kind: "available", version: update.version, update });
      } else {
        setUpdateStatus({ kind: "upToDate" });
      }
    } catch (e) {
      setUpdateStatus({ kind: "error", msg: String(e) });
    }
  };

  const handleInstallUpdate = async () => {
    if (updateStatus.kind !== "available") return;
    setUpdateStatus({ kind: "installing" });
    try {
      await updateStatus.update?.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setUpdateStatus({ kind: "error", msg: String(e) });
    }
  };

  const selectedVideo = findVideoDevice(devices.video, settings.video_device);
  // Capture modes belong to a (device, pixel format) pair — the same
  // card often tops out lower in an uncompressed format than in MJPEG.
  const captureModes =
    selectedVideo?.formats.find((f) => f.label === settings.pix_fmt)?.modes ?? [];

  return (
    <>
      {/* Click-away catcher; transparent so the video stays clear. */}
      {open && <div data-no-drag className="absolute inset-0 z-30" onClick={onClose} />}
      {/* Opacity-only transition: KWin's blur region can't follow a
          moving panel, so the sheet fades in place. */}
      <aside
        data-glass={open ? "on" : "off"}
        data-no-drag
        className={`glass absolute top-16 right-3 bottom-24 w-[340px] rounded-2xl z-40
                    flex flex-col transition-opacity duration-200 ease-glass
                    ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <header className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-sm font-semibold text-white/90">Settings</h2>
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="grid place-items-center w-7 h-7 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        {/* Scrolled by hand rather than overflow-y-auto: WebKit gives a
            native scroller its own composited layer, and on the
            transparent overlay that layer never clears — scrolling and
            closing the sheet leave stale copies behind. */}
        <div
          ref={scrollRef}
          onWheel={(e) => {
            if (scrollRef.current) scrollRef.current.scrollTop += e.deltaY;
          }}
          className="flex-1 min-h-0 overflow-hidden px-5 pb-5"
        >
        <div className="space-y-4">
          <DevicePicker
            label="Video device"
            value={selectedVideo?.path ?? null}
            onChange={(v) => onChange({ video_device: v })}
            options={devices.video.map((d) => ({ value: d.path, label: `${d.name} (${d.node})` }))}
          />
          <DevicePicker
            label="Pixel format"
            value={settings.pix_fmt}
            onChange={(v) => onChange({ pix_fmt: v })}
            options={(selectedVideo?.formats ?? []).map((f) => ({ value: f.label, label: f.label }))}
          />
          <DevicePicker
            label="Capture resolution"
            value={settings.capture_mode ?? AUTO_MODE}
            onChange={(v) => onChange({ capture_mode: v === AUTO_MODE ? null : v })}
            options={[
              { value: AUTO_MODE, label: "Auto (device best)" },
              ...captureModes.map((m) => ({
                value: formatCaptureMode(m),
                label: `${m.width}×${m.height} @ ${Math.round(m.fps)}fps`,
              })),
            ]}
          />
          <DevicePicker
            label="Display resolution"
            value={settings.display_resolution}
            onChange={(v) =>
              onChange({ display_resolution: v as Settings["display_resolution"] })
            }
            options={[
              { value: "720p", label: "720p (1280×720)" },
              { value: "1080p", label: "1080p (1920×1080)" },
              { value: "1440p", label: "1440p (2560×1440)" },
            ]}
          />
          <label className="block">
            <span className="flex justify-between text-[10px] uppercase tracking-[0.14em] text-white/45 font-medium">
              Volume <span className="font-mono normal-case tracking-normal">{settings.volume}</span>
            </span>
            <input
              type="range"
              min={0}
              max={150}
              value={settings.volume}
              onChange={(e) => onChange({ volume: Number(e.target.value) })}
              className="glass-range w-full mt-1.5"
              style={{ "--fill": `${(settings.volume / 150) * 100}%` } as React.CSSProperties}
            />
          </label>
          <Toggle
            label="Show stats"
            value={settings.show_stats}
            onChange={(v) => onChange({ show_stats: v })}
          />
          <Toggle
            label="Skip startup screen next launch"
            value={settings.skip_startup}
            onChange={(v) => onChange({ skip_startup: v })}
          />

          <div className="pt-3 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-400 font-medium">
                Updates
              </span>
              {appVersion && (
                <span className="text-[10px] text-zinc-500 font-mono">v{appVersion}</span>
              )}
            </div>
            <UpdateRow
              status={updateStatus}
              onCheck={handleCheckUpdate}
              onInstall={handleInstallUpdate}
            />
          </div>
        </div>
        </div>
      </aside>
    </>
  );
}

function UpdateRow({
  status,
  onCheck,
  onInstall,
}: {
  status: UpdateStatus;
  onCheck: () => void;
  onInstall: () => void;
}) {
  switch (status.kind) {
    case "checking":
      return <p className="text-xs text-zinc-400">Checking for updates…</p>;
    case "upToDate":
      return (
        <div className="flex items-center justify-between">
          <p className="text-xs text-accent">Up to date.</p>
          <button
            onClick={onCheck}
            className="text-xs text-zinc-400 hover:text-white underline"
          >
            Check again
          </button>
        </div>
      );
    case "available":
      return (
        <div className="space-y-2">
          <p className="text-xs text-zinc-200">
            Update available: <span className="font-mono">v{status.version}</span>
          </p>
          <button
            onClick={onInstall}
            className="w-full rounded-lg bg-accent text-zinc-950 font-medium py-1.5 text-xs hover:bg-accent/90 transition-colors"
          >
            Download and install
          </button>
        </div>
      );
    case "installing":
      return <p className="text-xs text-zinc-400">Installing update…</p>;
    case "error":
      return (
        <div className="space-y-1">
          <p className="text-xs text-warn font-mono">{status.msg}</p>
          <button
            onClick={onCheck}
            className="text-xs text-zinc-400 hover:text-white underline"
          >
            Retry
          </button>
        </div>
      );
    case "idle":
    default:
      return (
        <button
          onClick={onCheck}
          className="w-full rounded-lg bg-white/5 hover:bg-white/10 py-1.5 text-xs text-zinc-200 transition-colors border border-white/5"
        >
          Check for updates
        </button>
      );
  }
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="w-full flex items-center justify-between text-sm py-1 text-left"
    >
      <span className="text-white/80">{label}</span>
      <span
        className={`relative w-9 h-5 rounded-full transition-colors duration-200
                    ${value ? "bg-accent shadow-[0_0_12px_rgba(92,240,138,0.35)]" : "bg-white/15"}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ease-glass
                      ${value ? "left-[18px] bg-zinc-950" : "left-0.5 bg-white"}`}
        />
      </span>
    </button>
  );
}
