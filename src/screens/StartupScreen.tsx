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
  const [audio, setAudio] = useState<string | null>(initial.audio_device);
  const [pixFmt, setPixFmt] = useState<string | null>(initial.pix_fmt);
  const [skip, setSkip] = useState(initial.skip_startup);

  const selectedVideo = useMemo(
    () => devices.video.find((d) => d.path === video),
    [devices.video, video],
  );

  // Default selections once devices load
  useEffect(() => {
    if (loading) return;
    if (!video && devices.video[0]) setVideo(devices.video[0].path);
    if (!audio && devices.audio[0]) setAudio(devices.audio[0].id);
  }, [loading, devices, video, audio]);

  // Reset pix_fmt if not in selected device's formats
  useEffect(() => {
    if (!selectedVideo) return;
    if (!selectedVideo.formats.find((f) => f.label === pixFmt)) {
      const yuyv = selectedVideo.formats.find((f) => f.label === "yuyv422");
      setPixFmt(yuyv?.label ?? selectedVideo.formats[0]?.label ?? null);
    }
  }, [selectedVideo, pixFmt]);

  const ready = !!video && !!audio && !!pixFmt;

  return (
    <div className="grid place-items-center h-full p-6">
      <div className="w-[420px] rounded-2xl border border-white/10 bg-glass backdrop-blur-xl p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Select capture source</h1>
          <p className="text-xs text-white/50 mt-1">Choose your video device, audio source, and pixel format.</p>
        </div>

        <DevicePicker
          label="Video device"
          value={video}
          onChange={setVideo}
          options={devices.video.map((d) => ({ value: d.path, label: `${d.name} (${d.path})` }))}
          disabled={loading}
        />
        <DevicePicker
          label="Audio source"
          value={audio}
          onChange={setAudio}
          options={devices.audio.map((d) => ({ value: d.id, label: d.label }))}
          disabled={loading}
        />
        <DevicePicker
          label="Pixel format"
          value={pixFmt}
          onChange={setPixFmt}
          options={(selectedVideo?.formats ?? []).map((f) => ({ value: f.label, label: f.label }))}
          disabled={loading || !selectedVideo}
        />

        <label className="flex items-center gap-2 text-xs text-white/70 select-none">
          <input
            type="checkbox"
            checked={skip}
            onChange={(e) => setSkip(e.target.checked)}
          />
          Remember and skip this screen next time
        </label>

        <div className="flex gap-2 pt-2">
          <button
            className="flex-1 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 py-2 text-sm font-medium transition"
            disabled={!ready}
            onClick={() =>
              onStart({
                ...initial,
                video_device: video,
                audio_device: audio,
                pix_fmt: pixFmt,
                skip_startup: skip,
              })
            }
          >
            Start
          </button>
          <button
            className="rounded-lg border border-white/10 hover:bg-white/5 px-3 py-2 text-sm transition"
            onClick={refresh}
            disabled={loading}
            title="Refresh devices"
          >
            ↻
          </button>
        </div>
      </div>
    </div>
  );
}
