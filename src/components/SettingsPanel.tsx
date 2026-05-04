import { useEffect } from "react";
import { DevicePicker } from "./DevicePicker";
import type { DeviceList, Settings } from "../lib/types";

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

  const selectedVideo = devices.video.find((d) => d.path === settings.video_device);

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
            options={(selectedVideo?.formats ?? []).map((f) => ({ value: f.label, label: f.label }))}
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
