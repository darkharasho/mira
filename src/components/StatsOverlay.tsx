import type { StreamStats } from "../lib/types";

export function StatsOverlay({ stats, visible }: { stats: StreamStats | null; visible: boolean }) {
  if (!visible || !stats) return null;
  const { width, height, fps, pix_fmt, frame_drops } = stats;
  return (
    <div className="absolute top-3 right-4 font-mono text-[11px] text-white/70 leading-snug text-right
                    transition-opacity duration-200">
      <div>{width}×{height} · {fps.toFixed(2)} fps</div>
      <div>{pix_fmt || "—"} · {frame_drops} drops</div>
    </div>
  );
}
