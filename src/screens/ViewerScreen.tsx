import { useCallback, useEffect, useMemo, useRef } from "react";
import { useStream } from "../hooks/useStream";
import { useHotkeys } from "../hooks/useHotkeys";
import {
  setMute as ipcSetMute,
  setVideoRegion,
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
  const { state, error, start, stop } = useStream();
  const videoSlotRef = useRef<HTMLDivElement | null>(null);

  // The slot fills the entire window minus the custom titlebar; report
  // its bounding rect to the backend so the X11 child window mpv embeds
  // into matches exactly.
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

  const onScreenshot = useCallback(async () => {
    try {
      await takeScreenshot();
    } catch {
      /* overlay handles user-facing toasts */
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

  // Sync volume changes from the settings store back to mpv.
  useEffect(() => {
    ipcSetVolume(settings.volume).catch(() => {});
  }, [settings.volume]);

  useHotkeys({
    m: onMute,
    s: onToggleStats,
    p: onScreenshot,
    q: onQuit,
  });

  const status: "running" | "starting" | "error" | "idle" =
    state === "running" ? "running"
      : state === "starting" ? "starting"
      : state === "error" ? "error"
      : "idle";

  return (
    <div className="h-full flex flex-col">
      {error && (
        <div className="mx-4 mt-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn flex items-start gap-2 z-20">
          <span>⚠</span>
          <div className="flex-1">
            <div className="font-mono leading-snug">{error}</div>
            <button className="underline mt-1 hover:text-warn/80" onClick={onResetToStartup}>
              Open settings
            </button>
          </div>
        </div>
      )}

      {/* Video slot fills the whole space below the Tauri custom titlebar.
          mpv's X11 child window embeds inside this rectangle. Chrome
          (status, pill, settings) lives in the always-on-top overlay
          window above. */}
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
    </div>
  );
}
