export interface PixFormat { fourcc: string; label: string; }
export interface VideoDevice {
  path: string;
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
}
