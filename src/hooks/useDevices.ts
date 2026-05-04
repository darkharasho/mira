import { useEffect, useState, useCallback } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listDevices, onDevicesChanged } from "../lib/ipc";
import type { DeviceList } from "../lib/types";

export function useDevices() {
  const [devices, setDevices] = useState<DeviceList>({ video: [], audio: [] });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setDevices(await listDevices());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    let un: UnlistenFn | undefined;
    let cancelled = false;
    onDevicesChanged(() => refresh()).then((f) => {
      if (cancelled) f();
      else un = f;
    });
    return () => {
      cancelled = true;
      if (un) un();
    };
  }, [refresh]);

  return { devices, loading, refresh };
}
