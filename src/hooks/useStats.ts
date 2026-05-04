import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { StreamStats } from "../lib/types";

export function useStats(): StreamStats | null {
  const [stats, setStats] = useState<StreamStats | null>(null);
  useEffect(() => {
    let un: UnlistenFn | undefined;
    let cancelled = false;
    listen<StreamStats>("stream-stats", (e) => setStats(e.payload)).then((f) => {
      if (cancelled) f();
      else un = f;
    });
    return () => {
      cancelled = true;
      if (un) un();
    };
  }, []);
  return stats;
}
