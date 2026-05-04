import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDevices } from "../hooks/useDevices";
import { useStream } from "../hooks/useStream";
import { useStats } from "../hooks/useStats";
import { useHotkeys } from "../hooks/useHotkeys";
import { SettingsPanel } from "../components/SettingsPanel";
import {
  setMute as ipcSetMute,
  setVideoRegion,
  setVideoVisible,
  takeScreenshot,
} from "../lib/ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Settings } from "../lib/types";

export function ViewerScreen({
  settings,
  onChangeSettings,
  onResetToStartup,
}: {
  settings: Settings;
  onChangeSettings: (patch: Partial<Settings>) => void;
  onResetToStartup: () => void;
}) {
  const { devices } = useDevices();
  const { state, error, start, stop } = useStream();
  const stats = useStats();
  const [panelOpen, setPanelOpen] = useState(false);
  const videoSlotRef = useRef<HTMLDivElement | null>(null);

  // Push the video slot's bounding rect to mpv on every layout change.
  useEffect(() => {
    const el = videoSlotRef.current;
    if (!el) return;
    const push = () => {
      const r = el.getBoundingClientRect();
      setVideoRegion(
        Math.max(1, Math.round(r.width)),
        Math.max(1, Math.round(r.height)),
        Math.round(r.left),
        Math.round(r.top),
      ).catch(() => {});
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    window.addEventListener("resize", push);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", push);
    };
  }, []);

  // Hide the embedded mpv X11 child while the settings panel is open
  // so the panel renders above it; show again on close.
  useEffect(() => {
    setVideoVisible(!panelOpen).catch(() => {});
  }, [panelOpen]);

  const cfg = useMemo(
    () => ({
      video_device: settings.video_device!,
      audio_device: settings.audio_device!,
      pix_fmt: settings.pix_fmt!,
      volume: settings.volume,
      muted: settings.muted,
    }),
    [settings],
  );

  useEffect(() => {
    if (state === "idle") start(cfg);
    return () => {
      stop();
    };
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
      await takeScreenshot();
    } catch {
      /* no-op — overlay handles the user-facing toast for screenshots */
    }
  }, []);

  const onMute = useCallback(() => {
    const next = !settings.muted;
    onChangeSettings({ muted: next });
    ipcSetMute(next).catch(() => {});
  }, [settings.muted, onChangeSettings]);

  const onToggleStats = useCallback(
    () => onChangeSettings({ show_stats: !settings.show_stats }),
    [settings.show_stats, onChangeSettings],
  );

  const onQuit = useCallback(() => getCurrentWindow().close(), []);

  useHotkeys({
    m: onMute,
    s: onToggleStats,
    p: onScreenshot,
    q: onQuit,
    escape: () => {
      if (panelOpen) setPanelOpen(false);
    },
  });

  const status: "running" | "starting" | "error" | "idle" =
    state === "running" ? "running"
      : state === "starting" ? "starting"
      : state === "error" ? "error"
      : "idle";

  const dotClass =
    status === "running" ? "bg-accent shadow-[0_0_8px_#5cf08a]"
      : status === "starting" ? "bg-zinc-400 animate-pulse"
      : status === "error" ? "bg-warn shadow-[0_0_8px_#f0b35c]"
      : "bg-zinc-600";

  const statusText =
    status === "running" ? "Live"
      : status === "starting" ? "Starting…"
      : status === "error" ? "Error"
      : "Idle";

  const deviceLabel =
    devices.video.find((d) => d.path === settings.video_device)?.name ??
    settings.video_device ??
    "—";

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 py-2 flex items-center justify-between border-b border-white/5 bg-zinc-950/80 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
          <span className="text-xs font-medium tracking-tight text-zinc-100">{statusText}</span>
          <span className="text-xs text-zinc-500">·</span>
          <span className="text-xs text-zinc-300 truncate max-w-[420px]" title={deviceLabel}>
            {deviceLabel}
          </span>
          {settings.show_stats && stats && status === "running" && (
            <>
              <span className="text-xs text-zinc-600">·</span>
              <span className="text-[10px] font-mono text-zinc-500">
                {stats.width}×{stats.height} · {stats.fps.toFixed(2)} fps · {stats.latency_ms}ms
              </span>
            </>
          )}
        </div>
        <button
          onClick={() => setPanelOpen(true)}
          title="Settings"
          className="grid place-items-center w-8 h-8 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
        >
          <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M8 1v2m0 10v2m4.95-12.95l-1.41 1.41M3.46 12.54l-1.41 1.41M15 8h-2M3 8H1m12.95 4.95l-1.41-1.41M3.46 3.46L2.05 2.05"
              stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      {error && (
        <div className="mx-4 mt-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn flex items-start gap-2">
          <span>⚠</span>
          <div className="flex-1">
            <div className="font-mono leading-snug">{error}</div>
            <button className="underline mt-1 hover:text-warn/80" onClick={onResetToStartup}>
              Open settings
            </button>
          </div>
        </div>
      )}

      {/* Video slot — bare div whose bounding rect is reported to mpv,
          which renders its embedded X11 child window in this rectangle. */}
      <div ref={videoSlotRef} className="flex-1 min-h-0 bg-black relative">
        {status !== "running" && (
          <div className="absolute inset-0 grid place-items-center text-xs text-zinc-600 pointer-events-none">
            {status === "starting"
              ? "Connecting to capture device…"
              : status === "error"
              ? "Stream stopped"
              : "Idle"}
          </div>
        )}
      </div>

      <SettingsPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        devices={devices}
        settings={settings}
        onChange={onChangeSettings}
        onApply={onApplySettings}
      />
    </div>
  );
}
