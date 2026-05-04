use std::time::Duration;
use tauri::{AppHandle, Emitter};
use udev::MonitorBuilder;

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let Ok(builder) = MonitorBuilder::new() else { return };
        let Ok(builder) = builder.match_subsystem("video4linux") else { return };
        let Ok(builder) = builder.match_subsystem("sound") else { return };
        let Ok(socket) = builder.listen() else { return };
        loop {
            for event in socket.iter() {
                let _ = event;
                let _ = app.emit("devices-changed", ());
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    });
}
