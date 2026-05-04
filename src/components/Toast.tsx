import { useEffect } from "react";

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 1800);
    return () => window.clearTimeout(t);
  }, [onDone]);
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-24 px-4 py-2 rounded-full
                    bg-glass backdrop-blur-xl border border-white/10 text-xs">
      {message}
    </div>
  );
}
