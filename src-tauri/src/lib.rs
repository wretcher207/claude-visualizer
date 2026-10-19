// The app is a thin shell. Everything you see and hear is the plain web
// layer in ../web, loaded unchanged (see tauri.conf.json). The listener
// (listener.rs) receives Claude Code's events and hands them to the page, and
// connection.rs puts the app's hooks into Claude Code's settings while it runs.

mod claude_settings;
mod connection;
mod listener;

use std::time::Duration;

use tauri::{Emitter, Manager, RunEvent, State};

use connection::{Connection, Status};

#[tauri::command]
fn claude_connection(conn: State<Connection>) -> Status {
    conn.status()
}

#[tauri::command]
fn claude_answer(conn: State<Connection>, choice: String) -> Status {
    conn.answer(&choice)
}

/// For the uninstaller (`--disconnect`): takes the app's hooks out of Claude
/// Code's settings without starting the app.
pub fn disconnect_claude() {
    connection::disconnect_everywhere();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            // The scene still opens if the listener can't start; it just won't
            // hear Claude, and the app leaves Claude's settings alone.
            let handle = app.handle().clone();
            let config_dir = app.path().app_config_dir().ok();
            let listener = config_dir.clone().and_then(|dir| {
                listener::start(dir, move |event| {
                    let _ = handle.emit("claude-hook", event);
                })
                .inspect_err(|err| eprintln!("The Claude listener didn't start: {err}"))
                .ok()
            });
            let dir = config_dir.unwrap_or_else(std::env::temp_dir);
            app.manage(Connection::start(&dir, claude_settings::settings_path(), listener));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![claude_connection, claude_answer])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        // Quitting takes the hooks out, so a closed app leaves Claude no errors.
        // It happens as soon as the app means to exit, and once more at the
        // very end (taking them out twice is harmless). Step 5 keeps the app
        // in the tray when its window closes; then only a real quit may do this.
        let exiting = matches!(event, RunEvent::ExitRequested { .. });
        if exiting || matches!(event, RunEvent::Exit) {
            if let Some(conn) = app.try_state::<Connection>() {
                conn.quit();
            }
        }
        // A stray close message to Tauri's hidden helper window (taskkill
        // without /F sends one to every window) leaves the app unable to
        // finish exiting once its own window closes, so make sure it ends.
        if exiting {
            std::thread::spawn(|| {
                std::thread::sleep(Duration::from_secs(3));
                std::process::exit(0);
            });
        }
    });
}
