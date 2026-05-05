import { useEffect, useMemo, useState } from "react";
import { useDevices } from "../hooks/useDevices";
import { DevicePicker } from "../components/DevicePicker";
import type { Settings } from "../lib/types";

export function StartupScreen({
  initial,
  onStart,
}: {
  initial: Settings;
  onStart: (next: Settings) => void;
}) {
  const { devices, loading, refresh } = useDevices();
  const [video, setVideo] = useState<string | null>(initial.video_device);
  const [output, setOutput] = useState<string | null>(initial.audio_output);
  const [pixFmt, setPixFmt] = useState<string | null>(initial.pix_fmt);
  const [skip, setSkip] = useState(initial.skip_startup);

  const selectedVideo = useMemo(
    () => devices.video.find((d) => d.path === video),
    [devices.video, video],
  );

  useEffect(() => {
    if (loading) return;
    if (!video && devices.video[0]) setVideo(devices.video[0].path);
  }, [loading, devices, video]);

  useEffect(() => {
    if (!selectedVideo) return;
    if (!selectedVideo.formats.find((f) => f.label === pixFmt)) {
      const yuyv = selectedVideo.formats.find((f) => f.label === "yuyv422");
      setPixFmt(yuyv?.label ?? selectedVideo.formats[0]?.label ?? null);
    }
  }, [selectedVideo, pixFmt]);

  const ready = !!video && !!pixFmt;

  return (
    <div className="h-full flex flex-col p-5">
      <header className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_#5cf08a]" />
          <h1 className="text-sm font-semibold tracking-tight">Elgato Capture</h1>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          title="Refresh devices"
          className="text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30
                     w-7 h-7 grid place-items-center rounded-md hover:bg-white/5"
        >
          <svg viewBox="0 0 16 16" className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none">
            <path
              d="M2 8a6 6 0 0 1 10.5-3.97M14 8a6 6 0 0 1-10.5 3.97M14 2v3.5h-3.5M2 14v-3.5h3.5"
              stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>

      <div className="flex-1 flex flex-col gap-3.5">
        <p className="text-xs text-zinc-400 leading-relaxed">
          Pick your capture source. The video preview opens in its own window when you click Start.
        </p>

        <DevicePicker
          label="Video device"
          value={video}
          onChange={setVideo}
          options={devices.video.map((d) => ({ value: d.path, label: `${d.name} (${d.path})` }))}
          disabled={loading}
        />
        <DevicePicker
          label="Audio output"
          value={output ?? "__default__"}
          onChange={(v) => setOutput(v === "__default__" ? null : v)}
          options={[
            { value: "__default__", label: "System default" },
            ...devices.audio_outputs.map((d) => ({ value: d.id, label: d.label })),
          ]}
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
        className="mt-4 w-full rounded-lg bg-accent text-zinc-950 font-medium py-2.5 text-sm
                   hover:bg-accent/90 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed
                   transition-colors shadow-[0_0_24px_-6px_#5cf08a]"
        disabled={!ready}
        onClick={() =>
          onStart({
            ...initial,
            video_device: video,
            audio_output: output,
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
