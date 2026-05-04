import { useCallback, useEffect, useMemo, useState } from "react";
import { useDevices } from "../hooks/useDevices";
import { useStream } from "../hooks/useStream";
import { useStats } from "../hooks/useStats";
import { useHotkeys } from "../hooks/useHotkeys";
import { useAutoHide } from "../hooks/useAutoHide";
import { SettingsPanel } from "../components/SettingsPanel";
import { Toast } from "../components/Toast";
import {
  setMute as ipcSetMute,
  setVolume as ipcSetVolume,
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
  const visible = useAutoHide(2500);
  const [panelOpen, setPanelOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Force chrome visible while the settings panel is open so the gear /
  // bar don't fade behind the user's interaction.
  const chromeVisible = visible || panelOpen;

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
    <div className="h-full relative">
      {/* Background fill — always visible, contains optional stats */}
      <section className="absolute inset-0 grid place-items-center px-10">
        {settings.show_stats && stats && status === "running" ? (
          <div className="font-mono text-xs text-zinc-400 leading-relaxed text-center space-y-1">
            <div className="text-3xl text-zinc-100 font-light tracking-tight">
              {stats.width}×{stats.height}
            </div>
            <div className="text-zinc-500">
              {stats.fps.toFixed(2)} fps · {stats.pix_fmt || "—"} · {stats.latency_ms}ms
            </div>
          </div>
        ) : (
          <div className="text-xs text-zinc-600">
            {status === "running"
              ? "Stats hidden · press S"
              : status === "starting"
              ? "Connecting to capture device…"
              : status === "error"
              ? "Stream stopped"
              : "Idle"}
          </div>
        )}
      </section>

      {error && (
        <div className="absolute top-5 left-5 right-5 z-10 rounded-lg border border-warn/30 bg-warn/10 backdrop-blur px-3 py-2 text-xs text-warn flex items-start gap-2">
          <span>⚠</span>
          <div className="flex-1">
            <div className="font-mono leading-snug">{error}</div>
            <button className="underline mt-1 hover:text-warn/80" onClick={onResetToStartup}>
              Open settings
            </button>
          </div>
        </div>
      )}

      {/* Header overlay — auto-hide */}
      <header
        className={`absolute top-0 left-0 right-0 px-5 pt-4 pb-3 flex items-center justify-between
                    transition-opacity duration-200
                    ${chromeVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <div className="flex items-center gap-2.5 min-w-0 px-3 py-1.5 rounded-full
                        bg-zinc-900/70 backdrop-blur-md border border-white/10">
          <div className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
          <span className="text-xs font-medium tracking-tight text-zinc-100">{statusText}</span>
          <span className="text-xs text-zinc-500">·</span>
          <span className="text-xs text-zinc-300 truncate max-w-[280px]" title={deviceLabel}>
            {deviceLabel}
          </span>
        </div>
        <button
          onClick={() => setPanelOpen(true)}
          title="Settings"
          className="grid place-items-center w-9 h-9 rounded-full bg-zinc-900/70 backdrop-blur-md
                     border border-white/10 text-zinc-300 hover:text-white hover:bg-zinc-800
                     transition-colors shrink-0"
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

      {/* Floating control pill — auto-hide */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 bottom-6 transition-opacity duration-200
                    ${chromeVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-full
                        bg-zinc-900/85 backdrop-blur-xl border border-white/10
                        shadow-[0_8px_24px_-12px_rgba(0,0,0,0.8)]">
          <PillBtn onClick={onScreenshot} title="Screenshot (P)">
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
              <rect x="1.5" y="3.5" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="8" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5.5 3.5L6.5 2h3l1 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </PillBtn>

          {/* Volume group: mute icon + hover-reveal slider */}
          <div className="group/vol flex items-center">
            <PillBtn onClick={onMute} title="Mute (M)" active={settings.muted}>
              {muteIcon}
            </PillBtn>
            <div className="overflow-hidden flex items-center
                            w-0 group-hover/vol:w-32
                            opacity-0 group-hover/vol:opacity-100
                            transition-all duration-200 ease-out">
              <input
                type="range"
                min={0}
                max={150}
                value={settings.volume}
                onChange={(e) => onChangeSettings({ volume: Number(e.target.value) })}
                className="w-28 accent-accent ml-2 mr-1"
              />
            </div>
          </div>

          <PillBtn onClick={onToggleStats} title="Toggle stats (S)" active={settings.show_stats}>
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
              <path d="M2 13V8m4 5V5m4 8V9m4 4V3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </PillBtn>
          <span className="w-px h-4 bg-white/10 mx-0.5" />
          <PillBtn onClick={onResetToStartup} title="Change source">
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
              <path d="M3 7l3-3 3 3M6 4v6a3 3 0 0 0 3 3h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </PillBtn>
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
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`grid place-items-center w-8 h-8 rounded-full transition-colors
                  ${active
                    ? "bg-accent/15 text-accent"
                    : "text-zinc-300 hover:bg-white/10 hover:text-white"}`}
    >
      {children}
    </button>
  );
}
