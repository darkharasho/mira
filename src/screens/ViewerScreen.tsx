import { useCallback, useEffect, useMemo, useState } from "react";
import { useStream } from "../hooks/useStream";
import { useHotkeys } from "../hooks/useHotkeys";
import { useDevices } from "../hooks/useDevices";
import { useStats } from "../hooks/useStats";
import { useAutoHide } from "../hooks/useAutoHide";
import { useBlurRegion } from "../hooks/useBlurRegion";
import { useStalePixelRefresh } from "../hooks/useStalePixelRefresh";
import { SettingsPanel } from "../components/SettingsPanel";
import { WindowFrame } from "../components/WindowFrame";
import { WindowControls } from "../components/WindowControls";
import { MiraMark } from "../components/MiraMark";
import {
  setMute as ipcSetMute,
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
import { findVideoDevice, parseCaptureMode, type Settings } from "../lib/types";

/// Viewer chrome. Renders in the transparent overlay window that sits on
/// top of main, where mpv's video fills the entire window. The chrome
/// stays out of the way until the pointer moves, then fades in as glass
/// panels that KWin blurs against the video underneath.
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
  const { devices, loading: devicesLoading } = useDevices();
  const stats = useStats();
  const [panelOpen, setPanelOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Resolve the saved device against the live list. Audio capture follows
  // whichever video device is selected (via the matching USB sibling
  // resolved on the Rust side).
  const device = useMemo(
    () => findVideoDevice(devices.video, settings.video_device),
    [devices.video, settings.video_device],
  );
  const devicePath = device?.path ?? null;
  const audioCapture = device?.audio_capture ?? null;
  const deviceMissing = !devicesLoading && !device;

  // Settings saved before stable paths existed hold a raw /dev/videoN
  // node. Rewrite to the by-id path so a later renumbering can't point
  // the selection at a different camera.
  useEffect(() => {
    if (devicePath && devicePath !== settings.video_device) {
      onChangeSettings({ video_device: devicePath });
    }
  }, [devicePath, settings.video_device, onChangeSettings]);

  // Restart the stream whenever any setting that mpv consumes at start
  // time changes — device, pix fmt. Volume/mute are applied live via
  // IPC and don't need a restart. Waits for the device list: starting
  // before it loads would launch without the audio sibling.
  useEffect(() => {
    if (!devicePath) return;
    const mode = parseCaptureMode(settings.capture_mode);
    start({
      video_device: devicePath,
      audio_device: audioCapture ?? "",
      pix_fmt: settings.pix_fmt!,
      width: mode.width,
      height: mode.height,
      fps: mode.fps,
      volume: settings.volume,
      muted: settings.muted,
    });
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devicePath, audioCapture, settings.pix_fmt, settings.capture_mode]);

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
      if (panelOpen) setPanelOpen(false);
      else if (fullscreen) onToggleFullscreen();
    },
  });

  const status: "running" | "starting" | "error" | "idle" =
    state === "running" ? "running"
      : state === "starting" ? "starting"
      : state === "error" ? "error"
      : "idle";

  const live = status === "running";
  const [hoveringChrome, setHoveringChrome] = useState(false);
  const shown = useAutoHide(2500, panelOpen || hoveringChrome || !live || deviceMissing);
  const glass = shown ? "on" : "off";
  useBlurRegion();
  const stalePixels = useStalePixelRefresh();

  const hover = {
    onMouseEnter: () => setHoveringChrome(true),
    onMouseLeave: () => setHoveringChrome(false),
  };
  const fade = `transition-opacity duration-300 ease-glass ${shown ? "opacity-100" : "opacity-0 pointer-events-none"}`;
  const iconProps = { size: 20, weight: "regular" as const, color: "url(#miraIconStroke)" };

  return (
    <WindowFrame resizable={!fullscreen} style={{ cursor: shown ? undefined : "none" }}>
      {/* Edge scrims keep the chrome legible over bright frames. */}
      <div
        className={`absolute inset-0 pointer-events-none ${stalePixels ? (shown ? "" : "opacity-0") : fade}`}
        style={{
          background:
            "linear-gradient(180deg, rgb(4 5 10 / 0.5) 0, transparent 90px), linear-gradient(0deg, rgb(4 5 10 / 0.55) 0, transparent 130px)",
        }}
      />

      {!live && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 text-sm text-zinc-400">
            <MiraMark className={`w-10 h-10 ${status === "starting" ? "animate-pulse" : "opacity-60"}`} />
            {deviceMissing
              ? "No capture device"
              : status === "starting"
              ? "Connecting to capture device…"
              : status === "error"
              ? "Stream stopped"
              : "Idle"}
          </div>
        </div>
      )}

      {/* Top bar: identity + live status + stats on the left, window
          controls on the right. Bare areas drag the window. */}
      <div className={`absolute top-3 left-3 right-3 flex items-start justify-between gap-3 ${fade}`}>
        <div
          {...hover}
          data-glass={glass}
          className="glass flex items-center gap-2.5 h-9 pl-2.5 pr-4 rounded-xl text-[12.5px] min-w-0"
        >
          <MiraMark className="w-4 h-4 shrink-0" />
          <span className="font-semibold tracking-tight">Mira</span>
          <Sep />
          <StatusDot status={status} />
          <span className="text-white/60 truncate">{device?.name ?? "No device"}</span>
          {settings.show_stats && stats && live && (
            <>
              <Sep />
              <span className="font-mono text-[11px] text-white/75 tabular-nums whitespace-nowrap">
                {stats.width}×{stats.height} · {stats.fps.toFixed(1)} fps
                {stats.pix_fmt && ` · ${stats.pix_fmt}`} ·{" "}
                <span className={stats.frame_drops > 0 ? "text-warn" : "text-accent"}>
                  {stats.frame_drops} drops
                </span>
              </span>
            </>
          )}
        </div>
        {!fullscreen && (
          <div {...hover}>
            <WindowControls glass={glass} />
          </div>
        )}
      </div>

      {(error || deviceMissing) && (
        <div
          data-no-drag
          data-glass="on"
          className="glass absolute top-16 left-1/2 -translate-x-1/2 max-w-[min(560px,80%)] z-20
                     rounded-2xl px-4 py-3 text-xs text-warn flex items-start gap-2.5"
        >
          <Warning size={16} weight="regular" color="url(#miraIconWarn)" className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-mono leading-snug">
              {deviceMissing
                ? `Capture device ${settings.video_device ?? "(none)"} is not connected. Pick one in settings.`
                : error}
            </div>
            <button className="underline mt-1 hover:text-warn/80" onClick={onResetToStartup}>
              Open settings
            </button>
          </div>
        </div>
      )}

      {/* Bottom dock. */}
      <div
        {...hover}
        data-glass={glass}
        data-no-drag
        className={`glass absolute left-1/2 bottom-4 -translate-x-1/2 z-20 flex items-center gap-1 p-1.5 rounded-[14px] ${fade}`}
      >
        <DockBtn onClick={onMute} title={settings.muted ? "Unmute (M)" : "Mute (M)"} active={settings.muted}>
          {settings.muted ? <SpeakerSlash {...iconProps} /> : <SpeakerHigh {...iconProps} />}
        </DockBtn>
        <div className="flex items-center gap-2 pl-1 pr-3">
          <input
            type="range"
            min={0}
            max={150}
            value={settings.volume}
            aria-label="Volume"
            onChange={(e) => {
              const v = Number(e.target.value);
              onChangeSettings({ volume: v });
              ipcSetVolume(v).catch(() => {});
            }}
            className="glass-range w-24"
            style={{ "--fill": `${(settings.volume / 150) * 100}%` } as React.CSSProperties}
          />
          <span className="w-7 text-right text-[10px] font-mono text-white/55 tabular-nums">
            {settings.volume}
          </span>
        </div>
        <Sep tall />
        <DockBtn onClick={onScreenshot} title="Screenshot (P)">
          <Camera {...iconProps} />
        </DockBtn>
        <DockBtn onClick={onToggleStats} title="Stats (S)" active={settings.show_stats}>
          <ChartBar {...iconProps} />
        </DockBtn>
        <DockBtn
          onClick={onToggleFullscreen}
          title={fullscreen ? "Exit fullscreen (F / Esc)" : "Fullscreen (F)"}
          active={fullscreen}
        >
          {fullscreen ? <CornersIn {...iconProps} /> : <CornersOut {...iconProps} />}
        </DockBtn>
        <Sep tall />
        <DockBtn onClick={() => setPanelOpen((o) => !o)} title="Settings" active={panelOpen}>
          <GearSix {...iconProps} />
        </DockBtn>
      </div>

      <SettingsPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        devices={devices}
        settings={settings}
        onChange={onChangeSettings}
      />

      {toast && (
        <div
          data-glass="on"
          className="glass absolute left-1/2 -translate-x-1/2 bottom-[84px] z-30 max-w-[80%]
                     px-4 py-2 rounded-xl text-xs font-mono text-zinc-100 truncate pointer-events-none"
        >
          {toast}
        </div>
      )}
    </WindowFrame>
  );
}

function Sep({ tall }: { tall?: boolean }) {
  return <span className={`w-px shrink-0 bg-white/15 ${tall ? "h-6 mx-1" : "h-3.5"}`} />;
}

function StatusDot({ status }: { status: "running" | "starting" | "error" | "idle" }) {
  const cls =
    status === "running"
      ? "bg-accent shadow-[0_0_0_3px_rgba(92,240,138,0.18),0_0_10px_#5cf08a]"
      : status === "starting"
      ? "bg-accent/60 animate-pulse"
      : status === "error"
      ? "bg-warn"
      : "bg-white/30";
  return <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${cls}`} />;
}

function DockBtn({
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
        aria-pressed={active}
        className={`grid place-items-center w-10 h-10 rounded-[10px] transition-all duration-150
                    active:scale-90 hover:bg-white/12 hover:-translate-y-px
                    ${active ? "bg-white/14 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]" : ""}`}
      >
        {children}
      </button>
      <span
        className="absolute -top-9 left-1/2 -translate-x-1/2 px-2 py-1 rounded-lg
                   bg-zinc-950/90 border border-white/10
                   text-[10px] font-medium text-white whitespace-nowrap leading-none
                   opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150
                   pointer-events-none"
      >
        {title}
      </span>
    </span>
  );
}
