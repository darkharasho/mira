import { useEffect } from "react";
import { refreshOverlay } from "../lib/ipc";

/// Old WebKitGTKs never clear the parts of the transparent overlay that
/// stop being painted, so a closed sheet or faded dock lingers on screen.
/// Shortly after anything settles — a fade finishing, content changing, a
/// scroll — ask the Rust side to hand WebKit fresh buffers. It's a no-op
/// on WebKit versions without the bug.
export function useStalePixelRefresh(settleMs = 120) {
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => refreshOverlay().catch(() => {}), settleMs);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    document.addEventListener("transitionend", schedule);
    document.addEventListener("scroll", schedule, true);
    return () => {
      window.clearTimeout(timer);
      mo.disconnect();
      document.removeEventListener("transitionend", schedule);
      document.removeEventListener("scroll", schedule, true);
    };
  }, [settleMs]);
}
