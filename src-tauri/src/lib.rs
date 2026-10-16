// The app is a thin shell. Everything you see and hear is the plain web
// layer in ../web, loaded unchanged (see tauri.conf.json).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
