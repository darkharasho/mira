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
        <IconBtn onClick={onScreenshot} title="Screenshot (P)"><CameraIcon /></IconBtn>
        <IconBtn onClick={onMute} title="Mute (M)">{muted ? <VolumeMuteIcon /> : <VolumeIcon />}</IconBtn>
        <IconBtn onClick={onFullscreen} title="Fullscreen (F)"><FullscreenIcon /></IconBtn>
        <IconBtn onClick={onSettings} title="Settings"><SettingsIcon /></IconBtn>
      </div>
    </div>
  );
}

function Sep() {
  return <span className="w-px h-4 bg-white/10" />;
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function CameraIcon() {
  return (
    <svg {...iconProps}>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function VolumeMuteIcon() {
  return (
    <svg {...iconProps}>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 8V5a2 2 0 0 1 2-2h3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
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
