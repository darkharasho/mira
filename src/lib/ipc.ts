import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DeviceList, Settings, StreamConfig, StreamStats } from "./types";

export const listDevices = () => invoke<DeviceList>("list_devices");
export const startStream = (cfg: StreamConfig) => invoke<void>("start_stream", { cfg });
export const stopStream = () => invoke<void>("stop_stream");
export const setMute = (mute: boolean) => invoke<void>("set_mute", { mute });
export const setVolume = (vol: number) => invoke<void>("set_volume", { vol });
export const getStats = () => invoke<StreamStats>("get_stats");
export const takeScreenshot = () => invoke<string>("take_screenshot");
export const defaultSettings = () => invoke<Settings>("default_settings");

export const onDevicesChanged = (cb: () => void) =>
  listen("devices-changed", () => cb());
