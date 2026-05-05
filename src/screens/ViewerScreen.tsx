import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStream } from "../hooks/useStream";
import { useHotkeys } from "../hooks/useHotkeys";
import { useDevices } from "../hooks/useDevices";
import { useStats } from "../hooks/useStats";
import { SettingsPanel } from "../components/SettingsPanel";
import {
  setMute as ipcSetMute,
  setVideoRegion,
  setVolume as ipcSetVolume,
  takeScreenshot,
} from "../lib/ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Settings } from "../lib/types";

/// Single-window viewer. The mpv X11 child window is reparented into our
/// Tauri toplevel and sized to the `videoSlotRef` rectangle — i.e. the
/// middle band, leaving the top status bar and bottom control pill clear.
/// X11 children stack above the WebKit widget in the same toplevel, so
/// chrome MUST live outside the video rectangle to be visible.
export function ViewerScreen({
  settings,
  onChangeSettings,
  onResetToStartup,
  fullscreen,
  onToggleFullscreen,
}: {
  settings: Settings;
  onChangeSettings: (patch: Partial<Settings>) => void;
  onResetToStartup: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const { state, error, start, stop } = useStream();
  const { devices } = useDevices();
  const stats = useStats();
  const videoSlotRef = useRef<HTMLDivElement | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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

  // X11 child windows stack above the WebKit widget, so the settings
  // panel would render *behind* mpv if we left the video slot full
  // width. Instead, when the panel opens, shrink the video slot via
  // right padding equal to the panel width — the ResizeObserver above
  // pushes the new geometry to mpv and the panel becomes visible in
  // the carved-out space. Avoids unmap/remap cycles that break xv VO.
  const PANEL_WIDTH = 360;

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Audio capture device follows whichever video device is selected
  // (via the matching USB sibling resolved on the Rust side).
  const audioCapture = useMemo(
    () =>
      devices.video.find((d) => d.path === settings.video_device)?.audio_capture ?? null,
    [devices.video, settings.video_device],
  );

  const cfg = useMemo(
    () => ({
      video_device: settings.video_device!,
      audio_device: audioCapture ?? "",
      pix_fmt: settings.pix_fmt!,
      volume: settings.volume,
      muted: settings.muted,
      audio_output: settings.audio_output,
    }),
    [settings, audioCapture],
  );

  // Restart the stream whenever any setting that mpv consumes at start
  // time changes — device, pix fmt, output sink. Volume/mute are
  // applied live via IPC and don't need a restart.
  useEffect(() => {
    start(cfg);
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.video_device, audioCapture, settings.pix_fmt, settings.audio_output]);

  useEffect(() => {
    ipcSetVolume(settings.volume).catch(() => {});
  }, [settings.volume]);

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
    f: onToggleFullscreen,
    escape: () => {
      if (fullscreen) onToggleFullscreen();
    },
  });

  const status: "running" | "starting" | "error" | "idle" =
    state === "running" ? "running"
      : state === "starting" ? "starting"
      : state === "error" ? "error"
      : "idle";

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
    <div className="h-full flex flex-col relative">
      {error && (
        <div className="mx-4 mt-3 mb-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn flex items-start gap-2 z-10">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="flex-1">
            <div className="font-mono leading-snug">{error}</div>
            <button className="underline mt-1 hover:text-warn/80" onClick={onResetToStartup}>
              Open settings
            </button>
          </div>
        </div>
      )}

      {/* Video slot — mpv's X11 child is sized to this rectangle. When
          the settings panel is open we shrink it so mpv carves out the
          panel's column instead of covering it. */}
      <div
        ref={videoSlotRef}
        style={{ marginRight: panelOpen ? PANEL_WIDTH + 16 : undefined }}
        className="flex-1 min-h-0 bg-black ml-4 mr-4 rounded-lg overflow-hidden relative transition-[margin] duration-250">
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

      {/* Bottom control pill. mpv's X11 child paints over the video slot
          above, so the button tooltips have to fit inside this strip —
          PillBtn keeps them small + close to the button so an h-20
          strip is enough. */}
      <div className="h-20 relative flex items-center justify-center shrink-0 z-10">
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
          <PillBtn onClick={onToggleStats} title="Toggle stats (S)" active={settings.show_stats}>
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
              <path d="M2 13V8m4 5V5m4 8V9m4 4V3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </PillBtn>
          <span className="w-px h-4 bg-white/10 mx-0.5" />
          <div className="group/vol flex items-center">
            <div className="overflow-hidden flex items-center
                            w-0 group-hover/vol:w-44
                            opacity-0 group-hover/vol:opacity-100
                            transition-all duration-200 ease-out">
              <span className="text-[10px] font-mono text-zinc-400 w-8 text-right tabular-nums select-none mr-2">
                {settings.volume}
              </span>
              <input
                type="range"
                min={0}
                max={150}
                value={settings.volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onChangeSettings({ volume: v });
                  ipcSetVolume(v).catch(() => {});
                }}
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
          <span className="w-px h-4 bg-white/10 mx-0.5" />
          <PillBtn
            onClick={onToggleFullscreen}
            title={fullscreen ? "Exit fullscreen (F / Esc)" : "Fullscreen (F)"}
            active={fullscreen}
          >
            {fullscreen ? (
              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
                <path d="M6 1v3a2 2 0 0 1-2 2H1M10 1v3a2 2 0 0 0 2 2h3M6 15v-3a2 2 0 0 0-2-2H1M10 15v-3a2 2 0 0 1 2-2h3"
                      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
                <path d="M1 5V2a1 1 0 0 1 1-1h3M11 1h3a1 1 0 0 1 1 1v3M15 11v3a1 1 0 0 1-1 1h-3M5 15H2a1 1 0 0 1-1-1v-3"
                      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </PillBtn>
          <PillBtn onClick={() => setPanelOpen(true)} title="Settings">
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M8 1v2m0 10v2m4.95-12.95l-1.41 1.41M3.46 12.54l-1.41 1.41M15 8h-2M3 8H1m12.95 4.95l-1.41-1.41M3.46 3.46L2.05 2.05"
                stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
              />
            </svg>
          </PillBtn>
        </div>
        {settings.show_stats && stats && status === "running" && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-mono text-zinc-400
                           tabular-nums select-none whitespace-nowrap pointer-events-none">
            {stats.width}×{stats.height} · {stats.fps.toFixed(1)}fps · {stats.latency_ms}ms
          </span>
        )}
      </div>

      <SettingsPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        devices={devices}
        settings={settings}
        onChange={onChangeSettings}
        onApply={() => setPanelOpen(false)}
      />

      {toast && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-24 px-4 py-2 rounded-full
                        bg-zinc-950/95 border border-white/10 text-xs text-zinc-100
                        shadow-[0_4px_12px_-4px_rgba(0,0,0,0.6)] z-20">
          {toast}
        </div>
      )}
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
      <span className="absolute -top-5 left-1/2 -translate-x-1/2 px-2 py-0 rounded
                       bg-zinc-950/95 border border-white/15
                       text-[10px] font-medium text-white whitespace-nowrap leading-4
                       opacity-0 group-hover/tip:opacity-100
                       translate-y-0.5 group-hover/tip:translate-y-0
                       transition-all duration-150 pointer-events-none z-50
                       shadow-[0_6px_20px_-4px_rgba(0,0,0,0.8)]">
        {title}
      </span>
    </span>
  );
}
