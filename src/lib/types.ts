export interface CaptureMode { width: number; height: number; fps: number; }
export interface PixFormat { fourcc: string; label: string; modes: CaptureMode[]; }
export interface VideoDevice {
  path: string;
  node: string;
  name: string;
  formats: PixFormat[];
  audio_capture: string | null;
}
export interface DeviceList {
  video: VideoDevice[];
}
export interface StreamConfig {
  video_device: string;
  audio_device: string;
  pix_fmt: string;
  width: number;
  height: number;
  fps: number;
  volume: number;
  muted: boolean;
}
export interface StreamStats {
  width: number; height: number; fps: number; pix_fmt: string; frame_drops: number;
}
export type DisplayResolution = "720p" | "1080p" | "1440p";

export interface Settings {
  video_device: string | null;
  pix_fmt: string | null;
  volume: number;
  muted: boolean;
  show_stats: boolean;
  skip_startup: boolean;
  display_resolution: DisplayResolution;
  /// "WIDTHxHEIGHT@FPS", or null for the device's best advertised mode.
  capture_mode: string | null;
}

/// Serialize a capture mode the way settings store it.
export function formatCaptureMode(m: CaptureMode): string {
  return `${m.width}x${m.height}@${Math.round(m.fps)}`;
}

/// Parse a stored capture mode back into dimensions. Returns zeros for
/// null/garbage, which the backend reads as "resolve the best mode".
export function parseCaptureMode(s: string | null): CaptureMode {
  const m = /^(\d+)x(\d+)@([\d.]+)$/.exec(s ?? "");
  if (!m) return { width: 0, height: 0, fps: 0 };
  return { width: Number(m[1]), height: Number(m[2]), fps: Number(m[3]) };
}

/// Match a saved `video_device` against the enumerated list. Accepts the
/// stable by-id path or, for settings saved by older versions, the raw
/// `/dev/videoN` node.
export function findVideoDevice(list: VideoDevice[], saved: string | null): VideoDevice | undefined {
  if (!saved) return undefined;
  return list.find((d) => d.path === saved) ?? list.find((d) => d.node === saved);
}
