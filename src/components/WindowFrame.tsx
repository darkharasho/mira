import type { ReactNode } from "react";
import { withMain } from "../lib/mainWindow";
import { announceWindowDrag } from "../hooks/useAutoHide";

type Dir = "North" | "South" | "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest";

const EDGE = 6;
const CORNER = 14;

const HANDLES: { dir: Dir; style: React.CSSProperties; cursor: string }[] = [
  { dir: "North", cursor: "ns-resize", style: { top: 0, left: CORNER, right: CORNER, height: EDGE } },
  { dir: "South", cursor: "ns-resize", style: { bottom: 0, left: CORNER, right: CORNER, height: EDGE } },
  { dir: "West", cursor: "ew-resize", style: { left: 0, top: CORNER, bottom: CORNER, width: EDGE } },
  { dir: "East", cursor: "ew-resize", style: { right: 0, top: CORNER, bottom: CORNER, width: EDGE } },
  { dir: "NorthWest", cursor: "nwse-resize", style: { top: 0, left: 0, width: CORNER, height: CORNER } },
  { dir: "SouthEast", cursor: "nwse-resize", style: { bottom: 0, right: 0, width: CORNER, height: CORNER } },
  { dir: "NorthEast", cursor: "nesw-resize", style: { top: 0, right: 0, width: CORNER, height: CORNER } },
  { dir: "SouthWest", cursor: "nesw-resize", style: { bottom: 0, left: 0, width: CORNER, height: CORNER } },
];

/// Full-window frame for the undecorated overlay. Pressing on any bare
/// surface moves main (the overlay tracks it); thin edge handles resize
/// it. Interactive children should stop mousedown propagation — buttons
/// and inputs are skipped automatically.
export function WindowFrame({
  children,
  resizable,
  className = "",
  style,
}: {
  children: ReactNode;
  resizable: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`relative h-full overflow-hidden select-none ${className}`}
      style={style}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest("button, input, select, a, [data-no-drag]")) return;
        announceWindowDrag();
        withMain((w) => w.startDragging());
      }}
    >
      {children}
      {resizable &&
        HANDLES.map((h) => (
          <div
            key={h.dir}
            data-no-drag
            className="absolute z-50"
            style={{ ...h.style, cursor: h.cursor }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              announceWindowDrag();
              withMain((w) => w.startResizeDragging(h.dir));
            }}
          />
        ))}
    </div>
  );
}
