import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../hooks/useSettings";
import {
  setMute as ipcSetMute,
  setVolume as ipcSetVolume,
  takeScreenshot,
} from "../lib/ipc";

/// Renders inside the always-on-top overlay window. The window is sized
/// to the pill itself, so every pixel is interactive — no need for an
/// XShape input region.
export function OverlayPill() {
  const { settings, update } = useSettings();
  const [toast, setToast] = useState<string | null>(null);

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

  return (
    <div className="h-full grid place-items-center">
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

      {toast && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full
                        bg-zinc-950/95 border border-white/10 text-[11px] text-zinc-100
                        whitespace-nowrap shadow-[0_4px_12px_-4px_rgba(0,0,0,0.6)]">
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
