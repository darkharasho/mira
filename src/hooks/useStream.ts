import { useState, useCallback } from "react";
import { startStream, stopStream } from "../lib/ipc";
import type { StreamConfig } from "../lib/types";

export type StreamState = "idle" | "starting" | "running" | "error";

export function useStream() {
  const [state, setState] = useState<StreamState>("idle");
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (cfg: StreamConfig) => {
    setState("starting");
    setError(null);
    try {
      await startStream(cfg);
      setState("running");
    } catch (e) {
      setError(String(e));
      setState("error");
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await stopStream();
    } finally {
      setState("idle");
    }
  }, []);

  return { state, error, start, stop };
}
