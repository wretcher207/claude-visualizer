// Connecting to Claude Code. The app puts its hook entries into Claude Code's
// settings when it starts and takes them out when it quits, so a closed app
// never leaves Claude logging hook errors. The first time, the page shows what
// was added, with OK and Undo. Undo (and the tray's Disconnect, later) keeps
// the app out of the settings until the person connects it again. Old Claude
// Visualizer hooks are pointed out and removed only on a yes.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::claude_settings as settings;
use crate::listener;

const PREFS_FILE: &str = "connection.json";

// What the person chose, kept in the app's config folder.
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(default)]
struct Prefs {
    off: bool,              // they turned it off (Undo, or Disconnect)
    acknowledged: bool,     // they've seen what was added and said OK
    old_hooks_kept: bool,   // they chose to keep the old visualizer's hooks
    created_settings: bool, // the settings file didn't exist until the app made it
    created_hooks: bool,    // the settings had no "hooks" section until the app added one
}

/// What the page shows about the connection.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct Status {
    pub connected: bool,
    /// Show what was added, with OK and Undo.
    pub just_added: bool,
    /// Old Claude Visualizer hooks to offer to remove.
    pub old_hooks: usize,
    /// Why nothing could be changed, in a sentence.
    pub problem: Option<String>,
    pub settings_path: String,
}

pub struct Connection {
    prefs_path: PathBuf,
    settings_path: Option<PathBuf>,
    listener: Option<listener::Config>,
    state: Mutex<(Prefs, Status)>,
}

impl Connection {
    /// Connects at start unless the person turned it off. Without a listener
    /// (or a settings path) it changes nothing and says why.
    pub fn start(
        config_dir: &Path,
        settings_path: Option<PathBuf>,
        listener: Option<listener::Config>,
    ) -> Connection {
        let prefs_path = config_dir.join(PREFS_FILE);
        let prefs = load_prefs(&prefs_path);
        let status = Status {
            settings_path: settings_path.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
            ..Status::default()
        };
        let conn = Connection { prefs_path, settings_path, listener, state: Mutex::new((prefs, status)) };
        {
            let mut state = conn.state.lock().unwrap();
            let (prefs, status) = &mut *state;
            if !prefs.off {
                conn.connect(prefs, status);
            }
            conn.save(prefs);
        }
        conn
    }

    pub fn status(&self) -> Status {
        self.state.lock().unwrap().1.clone()
    }

    /// The person's answer from the page (or, later, the tray).
    pub fn answer(&self, choice: &str) -> Status {
        let mut state = self.state.lock().unwrap();
        let (prefs, status) = &mut *state;
        match choice {
            "ok" => {
                prefs.acknowledged = true;
                status.just_added = false;
            }
            "undo" | "disconnect" => {
                prefs.off = true;
                self.disconnect(prefs, status);
            }
            "connect" => {
                prefs.off = false;
                self.connect(prefs, status);
            }
            "remove-old" => self.remove_old(status),
            "keep-old" => {
                prefs.old_hooks_kept = true;
                status.old_hooks = 0;
            }
            _ => {}
        }
        self.save(prefs);
        status.clone()
    }

    /// The app is quitting: take the entries out, but stay connected for next time.
    pub fn quit(&self) {
        let mut state = self.state.lock().unwrap();
        let (prefs, status) = &mut *state;
        if status.connected {
            self.disconnect(prefs, status);
            self.save(prefs);
        }
    }

    fn connect(&self, prefs: &mut Prefs, status: &mut Status) {
        let Some(listener) = &self.listener else {
            status.problem = Some("The app couldn't start listening for Claude, so Claude Code's settings weren't changed.".into());
            return;
        };
        let result = self.edit(|s| {
            let no_hooks = s.doc.get("hooks").is_none();
            settings::remove(&mut s.doc, settings::is_ours);
            settings::add_ours(&mut s.doc, listener.port, &listener.key)?;
            Ok((s.text.is_none(), no_hooks))
        });
        match result {
            Ok(((created, no_hooks), doc)) => {
                prefs.created_settings |= created;
                prefs.created_hooks |= no_hooks;
                status.connected = true;
                status.just_added = !prefs.acknowledged;
                status.old_hooks = if prefs.old_hooks_kept { 0 } else { settings::count(&doc, settings::is_old_visualizer) };
                status.problem = None;
            }
            Err(problem) => {
                status.connected = false;
                status.problem = Some(problem);
            }
        }
    }

    fn disconnect(&self, prefs: &mut Prefs, status: &mut Status) {
        let created = prefs.created_settings;
        let keep_hooks = !prefs.created_hooks;
        let result = self.edit(|s| {
            let hooks_at = s.doc.as_object().and_then(|o| o.keys().position(|k| k == "hooks"));
            settings::remove(&mut s.doc, settings::is_ours);
            // An empty hooks section that was there before the app goes back where it was.
            if let (true, Some(at), Some(root)) = (keep_hooks, hooks_at, s.doc.as_object_mut()) {
                if !root.contains_key("hooks") {
                    root.shift_insert(at, "hooks".into(), serde_json::json!({}));
                }
            }
            // A settings file the app made, now holding nothing, goes again
            // rather than being written back (empty settings with no file
            // aren't written).
            let emptied = created && s.doc.as_object().is_some_and(|o| o.is_empty());
            if emptied {
                s.text = None;
            }
            Ok(emptied)
        });
        match result {
            Ok((emptied, _)) => {
                if emptied {
                    if let Some(path) = &self.settings_path {
                        let _ = std::fs::remove_file(path);
                    }
                    prefs.created_settings = false;
                }
                prefs.created_hooks = false;
                status.connected = false;
                status.just_added = false;
                status.problem = None;
            }
            Err(problem) => status.problem = Some(problem),
        }
    }

    fn remove_old(&self, status: &mut Status) {
        match self.edit(|s| {
            settings::remove(&mut s.doc, settings::is_old_visualizer);
            Ok(())
        }) {
            Ok(_) => status.old_hooks = 0,
            Err(problem) => status.problem = Some(problem),
        }
    }

    // Reads the settings fresh, changes them, and writes them back only if
    // that made a difference. Returns the change's own result and the settings.
    fn edit<T>(
        &self,
        change: impl FnOnce(&mut settings::Settings) -> Result<T, String>,
    ) -> Result<(T, serde_json::Value), String> {
        let path = self
            .settings_path
            .as_ref()
            .ok_or("The app couldn't find your home folder, so Claude Code's settings weren't changed.")?;
        let mut s = settings::read(path)?;
        let out = change(&mut s)?;
        settings::write(&s).map_err(|err| format!("{} couldn't be saved ({err}).", path.display()))?;
        Ok((out, s.doc))
    }

    fn save(&self, prefs: &Prefs) {
        if let Some(dir) = self.prefs_path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(prefs) {
            let _ = std::fs::write(&self.prefs_path, text);
        }
    }
}

fn load_prefs(path: &Path) -> Prefs {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// For the uninstaller: takes the app's entries out of Claude Code's settings
/// without starting the app.
pub fn disconnect_everywhere() {
    let Some(path) = settings::settings_path() else {
        return;
    };
    if let Ok(mut s) = settings::read(&path) {
        if settings::remove(&mut s.doc, settings::is_ours) > 0 {
            let _ = settings::write(&s);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const MINE: &str = "{\n  \"hooks\": {\n    \"PostToolUse\": [\n      {\n        \"matcher\": \"Bash\",\n        \"hooks\": [\n          {\n            \"type\": \"command\",\n            \"command\": \"node track.mjs\"\n          }\n        ]\n      }\n    ]\n  },\n  \"theme\": \"dark\"\n}\n";

    struct Place {
        dir: PathBuf,
        settings: PathBuf,
    }

    impl Place {
        fn new(name: &str, settings_text: Option<&str>) -> Place {
            let dir = std::env::temp_dir().join(format!("prologue-conn-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(dir.join("app")).unwrap();
            let settings = dir.join("claude").join("settings.json");
            if let Some(text) = settings_text {
                std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
                std::fs::write(&settings, text).unwrap();
            }
            Place { dir, settings }
        }

        fn start(&self, port: u16) -> Connection {
            let listener = listener::Config { port, key: KEY.into() };
            Connection::start(&self.dir.join("app"), Some(self.settings.clone()), Some(listener))
        }

        fn text(&self) -> Option<String> {
            std::fs::read_to_string(&self.settings).ok()
        }

        fn ours(&self) -> usize {
            settings::count(&settings::read(&self.settings).unwrap().doc, settings::is_ours)
        }
    }

    impl Drop for Place {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn connects_at_start_and_lets_go_at_quit() {
        let place = Place::new("cycle", Some(MINE));
        let conn = place.start(47207);
        let status = conn.status();
        assert!(status.connected && status.just_added && status.problem.is_none());
        assert_eq!(place.ours(), 16);
        assert_eq!(std::fs::read_to_string(settings::backup_path(&place.settings)).unwrap(), MINE);

        assert!(!conn.answer("ok").just_added);
        conn.quit();
        assert_eq!(place.text().as_deref(), Some(MINE), "quitting leaves the file as it was");

        // Next start: straight back in, without the panel.
        let again = place.start(47207);
        assert!(again.status().connected && !again.status().just_added);
        assert_eq!(place.ours(), 16);
        again.quit();
        assert_eq!(place.text().as_deref(), Some(MINE));
    }

    #[test]
    fn undo_keeps_it_out_until_connected_again() {
        let place = Place::new("undo", Some(MINE));
        let conn = place.start(47207);
        let status = conn.answer("undo");
        assert!(!status.connected && !status.just_added);
        assert_eq!(place.text().as_deref(), Some(MINE));
        conn.quit();

        let later = place.start(47207);
        assert!(!later.status().connected);
        assert_eq!(place.text().as_deref(), Some(MINE), "an app that was turned off stays out");
        let status = later.answer("connect");
        assert!(status.connected && status.just_added, "connecting again shows what was added");
        assert_eq!(place.ours(), 16);
        later.quit();
    }

    #[test]
    fn follows_the_listener_to_a_new_port() {
        let place = Place::new("port", Some(MINE));
        place.start(1111).answer("ok");
        // Say the app was stopped hard, so its entries stayed behind.
        let conn = place.start(2222);
        let text = place.text().unwrap();
        assert_eq!(text.matches(":2222/prompt-is-prologue/hook").count(), 16);
        assert!(!text.contains(":1111/"));
        conn.quit();
        assert_eq!(place.text().as_deref(), Some(MINE));
    }

    #[test]
    fn offers_to_remove_the_old_visualizer() {
        let old = "{\n  \"hooks\": {\n    \"Stop\": [\n      {\n        \"hooks\": [\n          {\n            \"type\": \"command\",\n            \"command\": \"node /home/me/claude-visualizer/hook.js\",\n            \"async\": true\n          }\n        ]\n      }\n    ]\n  }\n}\n";
        let place = Place::new("old", Some(old));
        let conn = place.start(47207);
        assert_eq!(conn.status().old_hooks, 1);
        assert_eq!(conn.answer("remove-old").old_hooks, 0);
        conn.quit();
        assert_eq!(place.text().as_deref(), Some("{\n  \"hooks\": {}\n}\n"), "only the old hook went; its section stays");

        let kept = Place::new("kept", Some(old));
        let conn = kept.start(47207);
        assert_eq!(conn.answer("keep-old").old_hooks, 0);
        conn.quit();
        assert_eq!(kept.text().as_deref(), Some(old), "kept means untouched");
        assert_eq!(kept.start(47207).status().old_hooks, 0, "and it doesn't ask again");
    }

    #[test]
    fn an_empty_hooks_section_stays() {
        let empty = "{
  \"hooks\": {},
  \"theme\": \"dark\"
}
";
        let place = Place::new("empty-hooks", Some(empty));
        let conn = place.start(47207);
        assert_eq!(place.ours(), 16);
        conn.quit();
        assert_eq!(place.text().as_deref(), Some(empty));
        // A hooks section the app added goes again.
        let added = Place::new("no-hooks", Some("{
  \"theme\": \"dark\"
}
"));
        added.start(47207).quit();
        assert_eq!(added.text().as_deref(), Some("{
  \"theme\": \"dark\"
}
"));
    }

    #[test]
    fn a_file_it_made_goes_again() {
        let place = Place::new("fresh", None);
        let conn = place.start(47207);
        assert!(conn.status().connected);
        assert_eq!(place.ours(), 16);
        conn.quit();
        assert!(place.text().is_none(), "no settings file before, none after");
        assert!(!settings::backup_path(&place.settings).exists());
    }

    #[test]
    fn changes_nothing_it_cannot_read() {
        let broken = "{ \"hooks\": ";
        let place = Place::new("broken", Some(broken));
        let conn = place.start(47207);
        let status = conn.status();
        assert!(!status.connected);
        assert!(status.problem.unwrap().contains("isn't valid JSON"));
        conn.quit();
        assert_eq!(place.text().as_deref(), Some(broken));
        assert!(!settings::backup_path(&place.settings).exists());

        let quiet = Place::new("nolistener", Some(MINE));
        let conn = Connection::start(&quiet.dir.join("app"), Some(quiet.settings.clone()), None);
        assert!(!conn.status().connected && conn.status().problem.is_some());
        assert_eq!(quiet.text().as_deref(), Some(MINE));
    }
}
