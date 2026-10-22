import { useEffect, useMemo, useState } from "react";
import { useDevices } from "../hooks/useDevices";
import { DevicePicker } from "../components/DevicePicker";
import { findVideoDevice, type Settings } from "../lib/types";

export function StartupScreen({
  initial,
  onStart,
}: {
  initial: Settings;
  onStart: (next: Settings) => void;
}) {
  const { devices, loading, refresh } = useDevices();
  const [video, setVideo] = useState<string | null>(initial.video_device);
  const [pixFmt, setPixFmt] = useState<string | null>(initial.pix_fmt);
  const [skip, setSkip] = useState(initial.skip_startup);

  const selectedVideo = useMemo(
    () => findVideoDevice(devices.video, video),
    [devices.video, video],
  );

  useEffect(() => {
    if (loading) return;
    if (selectedVideo) {
      // Normalize a legacy /dev/videoN selection to its stable path.
      if (selectedVideo.path !== video) setVideo(selectedVideo.path);
      return;
    }
    // Nothing saved, or the saved device is gone. Prefer a device with
    // an audio sibling — that's a capture card rather than a bare webcam.
    const fallback = devices.video.find((d) => d.audio_capture) ?? devices.video[0];
    if (fallback) setVideo(fallback.path);
  }, [loading, devices, video, selectedVideo]);

  useEffect(() => {
    if (!selectedVideo) return;
    if (!selectedVideo.formats.find((f) => f.label === pixFmt)) {
      const yuyv = selectedVideo.formats.find((f) => f.label === "yuyv422");
      setPixFmt(yuyv?.label ?? selectedVideo.formats[0]?.label ?? null);
    }
  }, [selectedVideo, pixFmt]);

  const ready = !!video && !!pixFmt;

  return (
    <div data-no-drag className="glass-solid w-[400px] max-w-full rounded-3xl p-6 flex flex-col select-text">
      <header className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Connect a capture source</h1>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          title="Refresh devices"
          className="text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-30
                     w-8 h-8 grid place-items-center rounded-full hover:bg-white/10"
        >
          <svg viewBox="0 0 16 16" className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none">
            <path
              d="M2 8a6 6 0 0 1 10.5-3.97M14 8a6 6 0 0 1-10.5 3.97M14 2v3.5h-3.5M2 14v-3.5h3.5"
              stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>

      <div className="flex flex-col gap-4">
        <p className="text-xs text-zinc-400 leading-relaxed -mt-2">
          The video fills this window once capture starts. Move the mouse to bring the controls back.
        </p>

        <DevicePicker
          label="Video device"
          value={video}
          onChange={setVideo}
          options={devices.video.map((d) => ({ value: d.path, label: `${d.name} (${d.node})` }))}
          disabled={loading}
        />
        <DevicePicker
          label="Pixel format"
          value={pixFmt}
          onChange={setPixFmt}
          options={(selectedVideo?.formats ?? []).map((f) => ({ value: f.label, label: f.label }))}
          disabled={loading || !selectedVideo}
        />

        <label className="flex items-center gap-2.5 text-xs text-zinc-400 select-none cursor-pointer mt-1">
          <input
            type="checkbox"
            checked={skip}
            onChange={(e) => setSkip(e.target.checked)}
            className="w-3.5 h-3.5 rounded accent-accent"
          />
          Remember and skip this on next launch
        </label>
      </div>

      <button
        className="mt-6 w-full rounded-xl bg-accent text-zinc-950 font-semibold py-2.5 text-sm
                   hover:bg-accent/90 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed
                   transition-colors shadow-[0_0_24px_-6px_#5cf08a]"
        disabled={!ready}
        onClick={() =>
          onStart({
            ...initial,
            video_device: video,
            pix_fmt: pixFmt,
            skip_startup: skip,
          })
        }
      >
        Start capture
      </button>
    </div>
  );
}
