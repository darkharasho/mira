export interface PixFormat { fourcc: string; label: string; }
export interface VideoDevice { path: string; name: string; formats: PixFormat[]; }
export interface AudioDevice { id: string; label: string; }
export interface DeviceList { video: VideoDevice[]; audio: AudioDevice[]; }
export interface StreamConfig {
  video_device: string;
  audio_device: string;
  pix_fmt: string;
  volume: number;
  muted: boolean;
}
export interface StreamStats {
  width: number; height: number; fps: number; pix_fmt: string; latency_ms: number;
}
export interface Settings {
  video_device: string | null;
  audio_device: string | null;
  pix_fmt: string | null;
  volume: number;
  muted: boolean;
  show_stats: boolean;
  skip_startup: boolean;
}
