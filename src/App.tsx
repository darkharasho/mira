import { useCallback, useMemo, useState } from "react";
import { useSettings } from "./hooks/useSettings";
import { StartupScreen } from "./screens/StartupScreen";
import { ViewerScreen } from "./screens/ViewerScreen";
import { Titlebar } from "./components/Titlebar";
import type { Settings } from "./lib/types";

export default function App() {
  const { settings, update } = useSettings();
  const [forceStartup, setForceStartup] = useState(false);

  const showStartup = useMemo(() => {
    if (!settings) return false;
    if (forceStartup) return true;
    if (!settings.skip_startup) return true;
    return !settings.video_device || !settings.audio_device || !settings.pix_fmt;
  }, [settings, forceStartup]);

  const onStart = useCallback(
    async (next: Settings) => {
      await update(next);
      setForceStartup(false);
    },
    [update],
  );

  return (
    <div className="h-full flex flex-col">
      <Titlebar />
      <main className="flex-1 min-h-0">
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
          />
        )}
      </main>
    </div>
  );
}
