// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The uninstaller runs the app this way to take its hooks out of Claude
    // Code's settings (src-tauri/windows/hooks.nsh).
    if std::env::args().any(|arg| arg == "--disconnect") {
        prompt_is_prologue_lib::disconnect_claude();
        return;
    }
    prompt_is_prologue_lib::run()
}
