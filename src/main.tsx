import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// StrictMode is intentionally disabled: the stream-lifecycle effect in
// ViewerScreen owns a libmpv child process holding /dev/video2 exclusively.
// StrictMode's mount/cleanup/remount cycle in dev tears down and reopens
// the v4l2 device 3ms apart, which fails with avformat_open_input() because
// the first mpv hasn't fully released the FD yet.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
