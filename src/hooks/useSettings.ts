import { useEffect, useState, useCallback } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { defaultSettings } from "../lib/ipc";
import type { Settings } from "../lib/types";

const STORE_PATH = "settings.json";

let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(STORE_PATH);
  return storePromise;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    (async () => {
      const store = await getStore();
      const stored = (await store.get<Settings>("settings")) ?? null;
      setSettings(stored ?? (await defaultSettings()));
    })();
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      (async () => {
        const store = await getStore();
        await store.set("settings", next);
        await store.save();
      })();
      return next;
    });
  }, []);

  return { settings, update };
}
