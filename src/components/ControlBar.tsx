import type { ReactNode } from "react";
import screenshotIcon from "../assets/icons/screenshot.svg";
import volumeIcon from "../assets/icons/volume.svg";
import volumeMuteIcon from "../assets/icons/volume-mute.svg";
import fullscreenIcon from "../assets/icons/fullscreen.svg";
import settingsIcon from "../assets/icons/settings.svg";

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
        <IconBtn onClick={onScreenshot} title="Screenshot (P)" src={screenshotIcon} />
        <IconBtn onClick={onMute} title="Mute (M)" src={muted ? volumeMuteIcon : volumeIcon} />
        <IconBtn onClick={onFullscreen} title="Fullscreen (F)" src={fullscreenIcon} />
        <IconBtn onClick={onSettings} title="Settings" src={settingsIcon} />
      </div>
    </div>
  );
}

function Sep() {
  return <span className="w-px h-4 bg-white/10" />;
}

function IconBtn({
  src,
  onClick,
  title,
  children,
}: {
  src?: string;
  onClick: () => void;
  title: string;
  children?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="grid place-items-center w-8 h-8 rounded-md bg-white/5 hover:bg-white/15 transition"
    >
      {src ? <img src={src} alt={title} className="w-5 h-5" draggable={false} /> : children}
    </button>
  );
}
