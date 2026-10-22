import { useCallback, useEffect, useMemo, useState } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useSettings } from "./hooks/useSettings";
import { StartupScreen } from "./screens/StartupScreen";
import { ViewerScreen } from "./screens/ViewerScreen";
import { WindowFrame } from "./components/WindowFrame";
import { WindowControls } from "./components/WindowControls";
import { MiraMark } from "./components/MiraMark";
import { mainWindow, withMain } from "./lib/mainWindow";
import type { DisplayResolution, Settings } from "./lib/types";

// The video fills the whole window, so the window size IS the video size.
const VIDEO_TO_WINDOW: Record<DisplayResolution, [number, number]> = {
  "720p": [1280, 720],
  "1080p": [1920, 1080],
  "1440p": [2560, 1440],
};

export default function App() {
  const { settings, update } = useSettings();
  const [forceStartup, setForceStartup] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const showStartup = useMemo(() => {
    if (!settings) return false;
    if (forceStartup) return true;
    if (!settings.skip_startup) return true;
    return !settings.video_device || !settings.pix_fmt;
  }, [settings, forceStartup]);

  const onStart = useCallback(
    async (next: Settings) => {
      await update(next);
      setForceStartup(false);
    },
    [update],
  );

  const toggleFullscreen = useCallback(async () => {
    const win = await mainWindow();
    const next = !(await win.isFullscreen());
    await win.setFullscreen(next);
    setFullscreen(next);
  }, []);

  // The resolution dropdown drives window size, but only when not in
  // fullscreen — setSize while fullscreen would un-fullscreen the window.
  useEffect(() => {
    if (fullscreen) return;
    const res = settings?.display_resolution;
    if (!res) return;
    const dims = VIDEO_TO_WINDOW[res];
    if (!dims) return;
    withMain((w) => w.setSize(new LogicalSize(dims[0], dims[1])));
  }, [settings?.display_resolution, fullscreen]);

  if (settings && !showStartup) {
    return (
      <ViewerScreen
        settings={settings}
        onChangeSettings={update}
        onResetToStartup={() => setForceStartup(true)}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
    );
  }

  // Startup / loading: an opaque surface over main's black backdrop.
  return (
    <WindowFrame
      resizable={!fullscreen}
      style={{ background: "radial-gradient(ellipse at 50% 0%, #1a1d2b 0%, #0a0c14 55%, #05060a 100%)" }}
    >
      <div className="absolute top-3 left-3 flex items-center gap-2 h-9 px-2 pointer-events-none">
        <MiraMark className="w-4 h-4" />
        <span className="text-xs font-semibold tracking-tight text-zinc-200">Mira</span>
      </div>
      <div className="absolute top-3 right-3">
        <WindowControls glass="off" />
      </div>
      <div className="h-full grid place-items-center p-6">
        {!settings ? (
          <div className="text-zinc-500 text-sm">Loading…</div>
        ) : (
          <StartupScreen initial={settings} onStart={onStart} />
        )}
      </div>
    </WindowFrame>
  );
}
