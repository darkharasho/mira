import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "../hooks/useSettings";
import { useDevices } from "../hooks/useDevices";
import { useStats } from "../hooks/useStats";
import { SettingsPanel } from "../components/SettingsPanel";
import {
  setMute as ipcSetMute,
  setOverlayInputRegion,
  setVideoVisible,
  setVolume as ipcSetVolume,
  takeScreenshot,
} from "../lib/ipc";

/// Chrome overlay rendered into the always-on-top, transparent overlay
/// window. The window covers the whole main window; an XShape input
/// region clips event handling to the chrome rectangles so clicks in
/// the transparent middle fall through to the main window.
export function OverlayPill() {
  const { settings, update } = useSettings();
  const { devices } = useDevices();
  const stats = useStats();
  const [panelOpen, setPanelOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const headerRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const toastRef = useRef<HTMLDivElement | null>(null);

  // Hide mpv whenever any chrome element wants to render over it.
  useEffect(() => {
    setVideoVisible(!panelOpen).catch(() => {});
  }, [panelOpen]);

  // Push the union of currently-visible chrome rectangles to the
  // overlay window's XShape input region. Recomputed when the layout
  // changes (resize, settings open/close, toast in/out).
  useEffect(() => {
    const push = () => {
      const rects: Array<[number, number, number, number]> = [];
      const collect = (el: HTMLElement | null) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          rects.push([
            Math.max(0, Math.round(r.left)),
            Math.max(0, Math.round(r.top)),
            Math.max(1, Math.round(r.width)),
            Math.max(1, Math.round(r.height)),
          ]);
        }
      };
      collect(headerRef.current);
      collect(pillRef.current);
      if (panelOpen) collect(panelRef.current);
      if (toast) collect(toastRef.current);
      setOverlayInputRegion(rects).catch(() => {});
    };
    push();
    const ro = new ResizeObserver(push);
    [headerRef, pillRef, panelRef, toastRef].forEach((r) => {
      if (r.current) ro.observe(r.current);
    });
    window.addEventListener("resize", push);
    const t = window.setInterval(push, 1000); // belt-and-braces re-push
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", push);
      window.clearInterval(t);
    };
  }, [panelOpen, toast]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const onScreenshot = useCallback(async () => {
    try {
      const path = await takeScreenshot();
      setToast(`Saved ${path.split("/").pop()}`);
    } catch (e) {
      setToast(`Screenshot failed: ${e}`);
    }
  }, []);

  const onMute = useCallback(() => {
    if (!settings) return;
    const next = !settings.muted;
    update({ muted: next });
    ipcSetMute(next).catch(() => {});
  }, [settings, update]);

  const onToggleStats = useCallback(() => {
    if (!settings) return;
    update({ show_stats: !settings.show_stats });
  }, [settings, update]);

  const onApplySettings = useCallback(async () => {
    setPanelOpen(false);
  }, []);

  const status = useMemo(() => {
    if (!stats) return "idle" as const;
    if (stats.width > 0) return "running" as const;
    return "starting" as const;
  }, [stats]);

  if (!settings) return null;

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

  const dotClass =
    status === "running" ? "bg-accent shadow-[0_0_8px_#5cf08a]"
      : status === "starting" ? "bg-zinc-400 animate-pulse"
      : "bg-zinc-600";
  const statusText =
    status === "running" ? "Live"
      : status === "starting" ? "Starting…"
      : "Idle";
  const deviceLabel =
    devices.video.find((d) => d.path === settings.video_device)?.name ??
    settings.video_device ?? "—";

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Top status pill + gear, floating */}
      <div
        ref={headerRef}
        className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-auto"
      >
        <div className="flex items-center gap-2.5 min-w-0 px-3 py-1.5 rounded-full
                        bg-zinc-900/80 backdrop-blur-xl border border-white/10
                        shadow-[0_8px_24px_-12px_rgba(0,0,0,0.8)]">
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
          className="grid place-items-center w-9 h-9 rounded-full bg-zinc-900/80 backdrop-blur-xl
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
      </div>

      {/* Floating pill — bottom center */}
      <div
        ref={pillRef}
        className="absolute left-1/2 -translate-x-1/2 bottom-6 pointer-events-auto"
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
                  update({ volume: v });
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
        </div>
      </div>

      {/* Settings panel slide-in */}
      <div ref={panelRef} className={panelOpen ? "pointer-events-auto" : ""}>
        <SettingsPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          devices={devices}
          settings={settings}
          onChange={update}
          onApply={onApplySettings}
        />
      </div>

      {toast && (
        <div
          ref={toastRef}
          className="absolute left-1/2 -translate-x-1/2 bottom-24 px-4 py-2 rounded-full
                     bg-zinc-950/95 border border-white/10 text-xs text-zinc-100
                     shadow-[0_4px_12px_-4px_rgba(0,0,0,0.6)] pointer-events-auto"
        >
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
      <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md
                       bg-zinc-950/95 border border-white/15
                       text-[11px] font-medium text-white whitespace-nowrap
                       opacity-0 group-hover/tip:opacity-100
                       translate-y-1 group-hover/tip:translate-y-0
                       transition-all duration-150 pointer-events-none z-50
                       shadow-[0_6px_20px_-4px_rgba(0,0,0,0.8)]">
        {title}
      </span>
    </span>
  );
}
