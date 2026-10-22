import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import "./index.css";

// Two windows load this bundle. "main" only hosts mpv's embedded video
// (an X11 child that covers the whole window), so it renders nothing.
// "overlay" is a transparent window kept on top of main that owns the
// entire UI.
const label = getCurrentWindow().label;
document.documentElement.dataset.window = label;

// StrictMode is intentionally disabled: the stream-lifecycle effect in
// ViewerScreen owns a libmpv child process holding /dev/video2 exclusively.
// StrictMode's mount/cleanup/remount cycle in dev tears down and reopens
// the v4l2 device 3ms apart, which fails with avformat_open_input() because
// the first mpv hasn't fully released the FD yet.
if (label !== "main") {
  ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
}
