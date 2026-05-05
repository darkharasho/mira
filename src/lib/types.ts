export interface PixFormat { fourcc: string; label: string; }
export interface VideoDevice {
  path: string;
  name: string;
  formats: PixFormat[];
  audio_capture: string | null;
}
export interface AudioDevice { id: string; label: string; }
export interface DeviceList {
  video: VideoDevice[];
  audio_outputs: AudioDevice[];
}
export interface StreamConfig {
  video_device: string;
  audio_device: string;
  pix_fmt: string;
  volume: number;
  muted: boolean;
  audio_output: string | null;
}
export interface StreamStats {
  width: number; height: number; fps: number; pix_fmt: string; latency_ms: number;
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
  audio_output: string | null;
}
