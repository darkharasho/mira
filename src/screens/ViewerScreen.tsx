import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDevices } from "../hooks/useDevices";
import { useStream } from "../hooks/useStream";
import { useStats } from "../hooks/useStats";
import { useHotkeys } from "../hooks/useHotkeys";
import { SettingsPanel } from "../components/SettingsPanel";
import { Toast } from "../components/Toast";
import {
  setMute as ipcSetMute,
  setVolume as ipcSetVolume,
  setVideoRegion,
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
  const [toast, setToast] = useState<string | null>(null);
  const videoSlotRef = useRef<HTMLDivElement | null>(null);

  // Push the video slot's bounding rect to mpv whenever it changes.
  useEffect(() => {
    const el = videoSlotRef.current;
    if (!el) return;
    const push = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      const x = Math.round(r.left);
      const y = Math.round(r.top);
      setVideoRegion(w, h, x, y).catch(() => {});
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
      const path = await takeScreenshot();
      setToast(`Saved ${path.split("/").pop()}`);
    } catch (e) {
      setToast(`Screenshot failed: ${e}`);
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

  useEffect(() => {
    ipcSetVolume(settings.volume).catch(() => {});
  }, [settings.volume]);

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

  const muteIcon = settings.muted ? (
    <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
      <path d="M8 3L4.5 6H2v4h2.5L8 13V3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11 6l3 4M14 6l-3 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
      <path d="M8 3L4.5 6H2v4h2.5L8 13V3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11 6c.8.8.8 3.2 0 4M13 4c1.5 1.5 1.5 6.5 0 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Top chrome strip — opaque, sits above the embedded mpv region */}
      <header className="px-4 py-2 flex items-center justify-between border-b border-white/5 bg-zinc-950/80">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
          <span className="text-xs font-medium tracking-tight text-zinc-100">{statusText}</span>
          <span className="text-xs text-zinc-500">·</span>
          <span className="text-xs text-zinc-300 truncate max-w-[420px]" title={deviceLabel}>
            {deviceLabel}
          </span>
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
          which renders its embedded X11 window in this exact rectangle. */}
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

      {/* Bottom chrome strip — opaque, contains the floating pill */}
      <div className="border-t border-white/5 bg-zinc-950/80 py-3 px-4 flex items-center justify-between gap-3">
        {settings.show_stats && stats && status === "running" ? (
          <div className="font-mono text-[10px] text-zinc-500 leading-snug shrink-0">
            <div>{stats.width}×{stats.height} · {stats.fps.toFixed(2)} fps</div>
            <div>{stats.pix_fmt || "—"} · {stats.latency_ms}ms</div>
          </div>
        ) : (
          <div className="text-[10px] text-zinc-600 shrink-0 w-28">&nbsp;</div>
        )}
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-full
                        bg-zinc-900/85 border border-white/10">

          <PillBtn onClick={onScreenshot} title="Screenshot (P)">
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
              <rect x="1.5" y="3.5" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="8" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5.5 3.5L6.5 2h3l1 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </PillBtn>

          <PillBtn onClick={onToggleStats} title="Toggle stats (S)" active={settings.show_stats}>
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
              <path d="M2 13V8m4 5V5m4 8V9m4 4V3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </PillBtn>

          <span className="w-px h-4 bg-white/10 mx-0.5" />

          {/* Mute button anchored right, slider expands leftward on hover */}
          <div className="group/vol flex items-center">
            <div
              className="overflow-hidden flex items-center
                         w-0 group-hover/vol:w-44
                         opacity-0 group-hover/vol:opacity-100
                         transition-all duration-200 ease-out"
            >
              <span className="text-[10px] font-mono text-zinc-400 w-8 text-right tabular-nums select-none mr-2">
                {settings.volume}
              </span>
              <input
                type="range"
                min={0}
                max={150}
                value={settings.volume}
                onChange={(e) => onChangeSettings({ volume: Number(e.target.value) })}
                className="w-32 accent-accent mr-2"
              />
            </div>
            <PillBtn
              onClick={onMute}
              title={settings.muted ? "Unmute (M)" : "Mute (M)"}
              active={settings.muted}
            >
              {muteIcon}
            </PillBtn>
          </div>
        </div>
      </div>

      <SettingsPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        devices={devices}
        settings={settings}
        onChange={onChangeSettings}
        onApply={onApplySettings}
      />

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function PillBtn({
  children,
  onClick,
  title,
  active,
  showTooltip = true,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
  showTooltip?: boolean;
}) {
  return (
    <span className="relative group/tip inline-flex">
      <button
        onClick={onClick}
        aria-label={title}
        className={`grid place-items-center w-9 h-9 rounded-full transition-all duration-150
                    active:scale-90
                    ${active
                      ? "bg-accent/25 text-accent shadow-[0_0_14px_-2px_rgba(92,240,138,0.6)] hover:bg-accent/40 hover:scale-105"
                      : "text-zinc-400 hover:bg-white/20 hover:text-white hover:scale-110"}`}
      >
        {children}
      </button>
      {showTooltip && (
        <span
          className="absolute -top-10 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md
                     bg-zinc-950/95 border border-white/15
                     text-[11px] font-medium text-white whitespace-nowrap
                     opacity-0 group-hover/tip:opacity-100
                     translate-y-1 group-hover/tip:translate-y-0
                     transition-all duration-150 pointer-events-none z-50
                     shadow-[0_6px_20px_-4px_rgba(0,0,0,0.8)]"
        >
          {title}
        </span>
      )}
    </span>
  );
}
