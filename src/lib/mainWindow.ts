import { Window } from "@tauri-apps/api/window";

// The UI runs in the overlay window, but move/resize/fullscreen/minimize
// all target main — the overlay just follows it (see main.rs).
let cached: Promise<Window | null> | null = null;

export async function mainWindow(): Promise<Window> {
  cached ??= Window.getByLabel("main");
  const win = await cached;
  if (!win) throw new Error("main window not found");
  return win;
}

export function withMain(fn: (win: Window) => Promise<unknown>) {
  mainWindow().then(fn).catch(() => {});
}
