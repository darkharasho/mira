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
import {
  Camera,
  ChartBar,
  CornersIn,
  CornersOut,
  GearSix,
  SpeakerHigh,
  SpeakerSlash,
  Warning,
} from "@phosphor-icons/react";
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
    const t = window.setTimeout(() => setToast(null), 2800);
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
    }),
    [settings, audioCapture],
  );

  // Restart the stream whenever any setting that mpv consumes at start
  // time changes — device, pix fmt. Volume/mute are applied live via
  // IPC and don't need a restart.
  useEffect(() => {
    start(cfg);
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.video_device, audioCapture, settings.pix_fmt]);

  useEffect(() => {
    ipcSetVolume(settings.volume).catch(() => {});
  }, [settings.volume]);

  const onScreenshot = useCallback(async () => {
    try {
      const path = await takeScreenshot();
      const home = path.startsWith("/home/") ? `/${path.split("/").slice(1, 3).join("/")}` : null;
      const display = home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
      setToast(`Screenshot saved → ${display}`);
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
    <SpeakerSlash size={28} weight="regular" color="url(#miraIconStroke)" />
  ) : (
    <SpeakerHigh size={28} weight="regular" color="url(#miraIconStroke)" />
  );

  return (
    <div className="h-full flex flex-col relative">
      {error && (
        <div className="mx-4 mt-3 mb-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn flex items-start gap-2 z-10">
          <Warning size={16} weight="regular" color="url(#miraIconWarn)" className="mt-0.5 shrink-0" />
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

      {/* Bottom control strip. No pill background — icons sit on the dark
          frame so the gradient glyphs have room to breathe. */}
      <div className="h-20 relative flex items-center justify-center shrink-0 z-10">
        <div className="flex items-center gap-3">
          <PillBtn onClick={onScreenshot} title="Screenshot (P)">
            <Camera size={28} weight="regular" color="url(#miraIconStroke)" />
          </PillBtn>
          <PillBtn onClick={onToggleStats} title="Toggle stats (S)" active={settings.show_stats}>
            <ChartBar size={28} weight="regular" color="url(#miraIconStroke)" />
          </PillBtn>
          <span className="w-px h-6 bg-white/10" />
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
            >
              {muteIcon}
            </PillBtn>
          </div>
          <span className="w-px h-6 bg-white/10" />
          <PillBtn
            onClick={onToggleFullscreen}
            title={fullscreen ? "Exit fullscreen (F / Esc)" : "Fullscreen (F)"}
            active={fullscreen}
          >
            {fullscreen
              ? <CornersIn size={28} weight="regular" color="url(#miraIconStroke)" />
              : <CornersOut size={28} weight="regular" color="url(#miraIconStroke)" />}
          </PillBtn>
          <PillBtn onClick={() => setPanelOpen(true)} title="Settings">
            <GearSix size={28} weight="regular" color="url(#miraIconStroke)" />
          </PillBtn>
        </div>
        {settings.show_stats && stats && status === "running" && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-mono text-zinc-400
                           tabular-nums select-none whitespace-nowrap pointer-events-none">
            {stats.width}×{stats.height} · {stats.fps.toFixed(1)}fps · {stats.frame_drops} drops
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
                        shadow-[0_4px_12px_-4px_rgba(0,0,0,0.6)] z-30 max-w-[80%]
                        truncate font-mono">
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
    <span className="relative group/tip inline-flex flex-col items-center">
      <button
        onClick={onClick}
        aria-label={title}
        aria-pressed={active}
        className="grid place-items-center w-11 h-11 rounded-full transition-all duration-150
                   active:scale-90 hover:bg-white/10 hover:scale-110"
      >
        {children}
      </button>
      <span
        aria-hidden
        className={`pointer-events-none absolute -bottom-1.5 h-[3px] rounded-full bg-accent
                    shadow-[0_0_8px_rgba(92,240,138,0.7)]
                    transition-all duration-200
                    ${active ? "w-4 opacity-100" : "w-0 opacity-0"}`}
      />
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
