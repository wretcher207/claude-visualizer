// The app is a thin shell. Everything you see and hear is the plain web
// layer in ../web, loaded unchanged (see tauri.conf.json).
//
// It also runs the listener Claude Code's hooks post to (listener/), and
// hands each event it keeps to the page as a `prologue:hook` event. The
// page starts listening for those in phase 2 step 3.

use tauri::{Emitter, Manager};

pub const HOOK_EVENT: &str = "prologue:hook";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            start_listener(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// If the listener can't start, the scene still runs; it just won't see
// Claude. That's never worth refusing to open over.
fn start_listener(app: &tauri::AppHandle) {
    let dir = match app.path().app_config_dir() {
        Ok(dir) => dir,
        Err(e) => return eprintln!("listener: no config folder: {e}"),
    };
    let mut cfg = match prologue_listener::Config::load_or_create(&dir) {
        Ok(cfg) => cfg,
        Err(e) => return eprintln!("listener: can't read or make {}: {e}", dir.display()),
    };
    let handle = app.clone();
    let listener = prologue_listener::start(&cfg, move |event| {
        let _ = handle.emit(HOOK_EVENT, &event);
    });
    match listener {
        Ok(l) if l.port != cfg.port => {
            // Something else holds the port. Keep the new one so the test
            // sender (and, from step 4, the app's hook entries) follow it.
            eprintln!("listener: port {} is taken, using {}", cfg.port, l.port);
            cfg.port = l.port;
            if let Err(e) = cfg.save(&dir) {
                eprintln!("listener: can't save the new port: {e}");
            }
        }
        Ok(_) => {}
        Err(e) => eprintln!("listener: can't listen: {e}"),
    }
}
