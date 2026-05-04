import { useEffect, useState } from "react";

export function useAutoHide(idleMs = 2500): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let timer: number | undefined;
    const reset = () => {
      setVisible(true);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setVisible(false), idleMs);
    };
    reset();
    window.addEventListener("mousemove", reset);
    window.addEventListener("keydown", reset);
    window.addEventListener("touchstart", reset);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("mousemove", reset);
      window.removeEventListener("keydown", reset);
      window.removeEventListener("touchstart", reset);
    };
  }, [idleMs]);

  return visible;
}
