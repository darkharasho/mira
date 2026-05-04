import type { ReactNode } from "react";

type Status = "running" | "starting" | "error" | "idle";

export function ControlBar({
  visible,
  status,
  deviceLabel,
  muted,
  onMute,
  onScreenshot,
  onFullscreen,
  onSettings,
}: {
  visible: boolean;
  status: Status;
  deviceLabel: string;
  muted: boolean;
  onMute: () => void;
  onScreenshot: () => void;
  onFullscreen: () => void;
  onSettings: () => void;
}) {
  const dot =
    status === "running"
      ? "bg-accent shadow-[0_0_10px_var(--tw-shadow-color)] shadow-accent"
      : status === "error"
        ? "bg-warn"
        : "bg-white/30";
  return (
    <div
      className={`absolute left-1/2 -translate-x-1/2 bottom-5 transition-opacity duration-200
                  ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
    >
      <div className="flex items-center gap-3 px-4 py-2 rounded-full
                      bg-glass backdrop-blur-xl border border-white/10 text-sm">
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        <span className="text-white/80">{deviceLabel}</span>
        <Sep />
        <IconBtn onClick={onScreenshot} title="Screenshot (P)">📷</IconBtn>
        <IconBtn onClick={onMute} title="Mute (M)">{muted ? "🔇" : "🔊"}</IconBtn>
        <IconBtn onClick={onFullscreen} title="Fullscreen (F)">⛶</IconBtn>
        <IconBtn onClick={onSettings} title="Settings">⚙</IconBtn>
      </div>
    </div>
  );
}

function Sep() {
  return <span className="w-px h-4 bg-white/10" />;
}

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="grid place-items-center w-7 h-7 rounded-md bg-white/5 hover:bg-white/15 transition"
    >
      {children}
    </button>
  );
}
