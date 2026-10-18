// The app is a thin shell. Everything you see and hear is the plain web
// layer in ../web, loaded unchanged (see tauri.conf.json). The listener
// (listener.rs) receives Claude Code's events and hands them to the page.

mod listener;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // The scene still opens if the listener can't start; it just won't hear Claude.
            let handle = app.handle().clone();
            let started = app.path().app_config_dir().map_err(|err| err.to_string()).and_then(|dir| {
                listener::start(dir, move |event| {
                    let _ = handle.emit("claude-hook", event);
                })
                .map_err(|err| err.to_string())
            });
            if let Err(err) = started {
                eprintln!("The Claude listener didn't start: {err}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
