import { useEffect, useRef, useState } from "react";

const DRAG_EVENT = "mira:window-drag";

/// Tell the chrome a window move/resize is starting. The overlay follows
/// main a beat behind, so the chrome hides for the duration rather than
/// visibly trailing the video. Dispatched after the current mousedown has
/// finished propagating, so that press doesn't count as fresh activity.
export function announceWindowDrag() {
  window.setTimeout(() => window.dispatchEvent(new Event(DRAG_EVENT)));
}

/// Chrome visibility for the viewer: shown on pointer/keyboard activity,
/// hidden after `idleMs` of stillness or as soon as the pointer leaves the
/// window. While `pinned`, it stays up regardless — except during a
/// window drag, which always hides it.
export function useAutoHide(idleMs = 2500, pinned = false): boolean {
  const [active, setActive] = useState(true);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  useEffect(() => {
    let timer: number | undefined;
    const setDrag = (v: boolean) => {
      draggingRef.current = v;
      setDragging(v);
    };
    const reset = (e: Event) => {
      // Moves with the button still held are the drag itself leaking
      // through before the window manager grabs the pointer.
      if (draggingRef.current && e.type === "mousemove" && (e as MouseEvent).buttons !== 0) return;
      setDrag(false);
      setActive(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setActive(false), idleMs);
    };
    const leave = () => {
      window.clearTimeout(timer);
      setActive(false);
    };
    const drag = () => {
      leave();
      setDrag(true);
    };
    setActive(true);
    timer = window.setTimeout(() => setActive(false), idleMs);
    window.addEventListener("mousemove", reset);
    window.addEventListener("mousedown", reset);
    window.addEventListener("keydown", reset);
    window.addEventListener(DRAG_EVENT, drag);
    document.documentElement.addEventListener("mouseleave", leave);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", reset);
      window.removeEventListener("mousedown", reset);
      window.removeEventListener("keydown", reset);
      window.removeEventListener(DRAG_EVENT, drag);
      document.documentElement.removeEventListener("mouseleave", leave);
    };
  }, [idleMs]);

  return (active || pinned) && !dragging;
}
