import { getCurrentWindow } from "@tauri-apps/api/window";
import { withMain } from "../lib/mainWindow";

/// Minimize / maximize / close as a small glass pill. Window ops target
/// main; the overlay follows it. Closing either window quits the app.
export function WindowControls({ glass = "on" }: { glass?: "on" | "off" }) {
  return (
    <div data-glass={glass} className="glass flex items-center gap-0.5 p-1 rounded-xl">
      <TitleBtn onClick={() => withMain((w) => w.minimize())} title="Minimize">
        <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
          <path d="M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </TitleBtn>
      <TitleBtn onClick={() => withMain((w) => w.toggleMaximize())} title="Maximize">
        <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
          <rect x="2.5" y="2.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </TitleBtn>
      <TitleBtn onClick={() => getCurrentWindow().close()} title="Close" danger>
        <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </TitleBtn>
    </div>
  );
}

function TitleBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={title}
      className={`grid place-items-center w-7 h-7 rounded-lg text-zinc-300 transition-colors
                  ${danger ? "hover:bg-red-500/85 hover:text-white" : "hover:bg-white/12 hover:text-white"}`}
    >
      {children}
    </button>
  );
}
