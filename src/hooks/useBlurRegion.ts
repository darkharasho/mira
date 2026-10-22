import { useEffect, useRef } from "react";
import { setBlurRegion, type BlurRect } from "../lib/ipc";

/// Keep KWin's blur-behind region in sync with every `[data-glass="on"]`
/// element. KWin can't fade the blur per-pixel, so glass elements should
/// animate opacity only (a moving element would leave its blur behind)
/// and flip `data-glass` off when hidden.
export function useBlurRegion() {
  const last = useRef("");

  useEffect(() => {
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rects: BlurRect[] = [];
        document.querySelectorAll<HTMLElement>('[data-glass="on"]').forEach((el) => {
          const b = el.getBoundingClientRect();
          if (b.width < 1 || b.height < 1) return;
          const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
          rects.push({ x: b.left, y: b.top, w: b.width, h: b.height, r });
        });
        const key = JSON.stringify(rects);
        if (key === last.current) return;
        last.current = key;
        setBlurRegion(rects).catch(() => {});
      });
    };

    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-glass", "class", "style"],
    });
    const ro = new ResizeObserver(sync);
    ro.observe(document.documentElement);
    window.addEventListener("resize", sync);
    document.addEventListener("transitionend", sync);
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", sync);
      document.removeEventListener("transitionend", sync);
      last.current = "";
      setBlurRegion([]).catch(() => {});
    };
  }, []);
}
