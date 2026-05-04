import { useCallback, useEffect, useMemo, useState } from "react";
import { useDevices } from "../hooks/useDevices";
import { useStream } from "../hooks/useStream";
import { useStats } from "../hooks/useStats";
import { useAutoHide } from "../hooks/useAutoHide";
import { useHotkeys } from "../hooks/useHotkeys";
import { ControlBar } from "../components/ControlBar";
import { StatsOverlay } from "../components/StatsOverlay";
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

  // Start the stream once on mount; stop on unmount.
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

  const onFullscreen = useCallback(async () => {
    const win = getCurrentWindow();
    await win.setFullscreen(!(await win.isFullscreen()));
  }, []);

  const onToggleStats = useCallback(
    () => onChangeSettings({ show_stats: !settings.show_stats }),
    [settings.show_stats, onChangeSettings],
  );

  const onQuit = useCallback(() => getCurrentWindow().close(), []);

  useHotkeys({
    f: onFullscreen,
    m: onMute,
    s: onToggleStats,
    p: onScreenshot,
    q: onQuit,
    escape: async () => {
      const win = getCurrentWindow();
      if (panelOpen) setPanelOpen(false);
      else if (await win.isFullscreen()) await win.setFullscreen(false);
    },
  });

  // Persist volume changes via IPC immediately.
  useEffect(() => {
    ipcSetVolume(settings.volume).catch(() => {});
  }, [settings.volume]);

  const status =
    state === "running"
      ? "running"
      : state === "starting"
        ? "starting"
        : state === "error"
          ? "error"
          : "idle";

  const deviceLabel =
    devices.video.find((d) => d.path === settings.video_device)?.name ??
    settings.video_device ??
    "—";

  return (
    <div className="absolute inset-0">
      {/* Top drag region for the borderless transparent window */}
      <div
        data-tauri-drag-region
        className={`absolute top-0 left-0 right-0 h-8 transition-opacity ${visible ? "opacity-100" : "opacity-0"}`}
      />
      <StatsOverlay stats={stats} visible={!!settings.show_stats && visible} />
      <ControlBar
        visible={visible}
        status={status}
        deviceLabel={deviceLabel}
        muted={settings.muted}
        onMute={onMute}
        onScreenshot={onScreenshot}
        onFullscreen={onFullscreen}
        onSettings={() => setPanelOpen(true)}
      />
      <SettingsPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        devices={devices}
        settings={settings}
        onChange={onChangeSettings}
        onApply={onApplySettings}
      />
      {error && (
        <div className="absolute top-3 left-4 text-xs text-warn font-mono">
          ⚠ {error}{" "}
          <button className="underline ml-2" onClick={onResetToStartup}>
            open settings
          </button>
        </div>
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
