import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useSettings } from "./hooks/useSettings";
import { StartupScreen } from "./screens/StartupScreen";
import { ViewerScreen } from "./screens/ViewerScreen";
import { Titlebar } from "./components/Titlebar";
import type { DisplayResolution, Settings } from "./lib/types";

// Custom titlebar (h-9) + bottom control pill (h-20) = 116px of vertical
// chrome. Side video margins (mx-4 + mx-4) = 32px of horizontal chrome.
// The window size targets a video rectangle of EXACTLY the chosen res.
const VIDEO_TO_WINDOW: Record<DisplayResolution, [number, number]> = {
  "720p": [1280 + 32, 720 + 36 + 80],
  "1080p": [1920 + 32, 1080 + 36 + 80],
  "1440p": [2560 + 32, 1440 + 36 + 80],
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
    const win = getCurrentWindow();
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
    getCurrentWindow().setSize(new LogicalSize(dims[0], dims[1])).catch(() => {});
  }, [settings?.display_resolution, fullscreen]);

  return (
    <div className="h-full flex flex-col">
      {!fullscreen && <Titlebar />}
      <main className="flex-1 min-h-0 relative overflow-hidden">
        {!settings ? (
          <div className="grid place-items-center h-full text-zinc-500 text-sm">
            Loading…
          </div>
        ) : showStartup ? (
          <StartupScreen initial={settings} onStart={onStart} />
        ) : (
          <ViewerScreen
            settings={settings}
            onChangeSettings={update}
            onResetToStartup={() => setForceStartup(true)}
            fullscreen={fullscreen}
            onToggleFullscreen={toggleFullscreen}
          />
        )}
      </main>
    </div>
  );
}
