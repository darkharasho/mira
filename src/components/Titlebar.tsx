import { getCurrentWindow } from "@tauri-apps/api/window";
import { MiraMark } from "./MiraMark";

export function Titlebar() {
  const win = getCurrentWindow();
  return (
    <div
      data-tauri-drag-region
      className="h-9 flex items-center justify-between px-3 select-none
                 border-b border-white/5 bg-black/30 shrink-0"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pointer-events-none">
        <MiraMark className="w-4 h-4 shrink-0" />
        <span className="text-[11px] font-medium tracking-tight text-zinc-300">
          Mira
        </span>
      </div>
      <div className="flex items-center gap-1">
        <TitleBtn onClick={() => win.minimize()} title="Minimize">
          <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
            <path d="M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </TitleBtn>
        <TitleBtn
          onClick={async () => {
            const isMax = await win.isMaximized();
            if (isMax) await win.unmaximize();
            else await win.maximize();
          }}
          title="Maximize"
        >
          <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
            <rect x="2.5" y="2.5" width="7" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </TitleBtn>
        <TitleBtn onClick={() => win.close()} title="Close" danger>
          <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </TitleBtn>
      </div>
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
      title={title}
      className={`grid place-items-center w-7 h-7 rounded-md text-zinc-400 transition-colors
                  ${danger ? "hover:bg-red-500/80 hover:text-white" : "hover:bg-white/10 hover:text-zinc-100"}`}
    >
      {children}
    </button>
  );
}
