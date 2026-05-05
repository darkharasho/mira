import { useEffect, useState } from "react";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { DevicePicker } from "./DevicePicker";
import type { DeviceList, Settings } from "../lib/types";

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
  onApply,
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const [appVersion, setAppVersion] = useState<string>("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ kind: "idle" });

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

  const selectedVideo = devices.video.find((d) => d.path === settings.video_device);

  return (
    <>
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-200 z-30
                    ${open ? "opacity-30" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />
      <aside
        className={`absolute top-0 right-0 h-full w-[360px] bg-glass backdrop-blur-2xl
                    border-l border-white/10 p-5 transition-transform duration-250 z-40
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
            label="Pixel format"
            value={settings.pix_fmt}
            onChange={(v) => onChange({ pix_fmt: v })}
            options={(selectedVideo?.formats ?? []).map((f) => ({ value: f.label, label: f.label }))}
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
            <span className="text-xs uppercase tracking-wider text-white/50">Volume</span>
            <input
              type="range"
              min={0}
              max={150}
              value={settings.volume}
              onChange={(e) => onChange({ volume: Number(e.target.value) })}
              className="w-full mt-1"
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

          <div className="pt-2 border-t border-white/5">
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

        <div className="absolute left-5 right-5 bottom-5 flex gap-2">
          <button
            onClick={onApply}
            className="flex-1 rounded-lg bg-white/10 hover:bg-white/15 py-2 text-sm font-medium transition"
          >
            Apply
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 hover:bg-white/5 px-3 py-2 text-sm transition"
          >
            Close
          </button>
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
    <label className="flex items-center justify-between text-sm py-1">
      <span className="text-white/80">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
