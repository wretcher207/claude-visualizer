// Claude Code's settings file, edited carefully: the app's own hook entries go
// in and come out, and nothing else in the file moves. Its entries are found
// by their address (the listener's path on this computer, on any port), so a
// port change can rewrite them and taking them out finds every one.

use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::listener::{EVENTS, HOOK_PATH, KEY_HEADER};

/// Claude Code's user settings: in $CLAUDE_CONFIG_DIR if that's set, as
/// Claude Code does it, otherwise in ~/.claude.
pub fn settings_path() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|dir| !dir.is_empty()) {
        return Some(PathBuf::from(dir).join("settings.json"));
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    Some(PathBuf::from(home).join(".claude").join("settings.json"))
}

/// The settings as read: the file's own text (none if there was no file) and
/// what it holds.
pub struct Settings {
    pub path: PathBuf,
    pub text: Option<String>,
    pub doc: Value,
}

/// Reads the settings. A missing or empty file counts as empty settings; one
/// that can't be read or isn't a JSON object is an error, and then nothing
/// gets changed.
pub fn read(path: &Path) -> Result<Settings, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => Some(text),
        Err(err) if err.kind() == io::ErrorKind::NotFound => None,
        Err(err) => return Err(format!("{} couldn't be read ({err}).", path.display())),
    };
    let body = text.as_deref().unwrap_or("").trim_start_matches('\u{feff}');
    let doc = if body.trim().is_empty() {
        Value::Object(Map::new())
    } else {
        serde_json::from_str(body)
            .map_err(|err| format!("{} isn't valid JSON ({err}).", path.display()))?
    };
    if !doc.is_object() {
        return Err(format!("{} doesn't hold a JSON object.", path.display()));
    }
    Ok(Settings { path: path.to_path_buf(), text, doc })
}

/// One of the app's own hook entries, on any port.
pub fn is_ours(hook: &Value) -> bool {
    let Some(url) = hook.get("url").and_then(Value::as_str) else {
        return false;
    };
    let Some(rest) = url
        .strip_prefix("http://127.0.0.1:")
        .or_else(|| url.strip_prefix("http://localhost:"))
    else {
        return false;
    };
    hook.get("type").and_then(Value::as_str) == Some("http")
        && rest.find('/').is_some_and(|slash| {
            rest[..slash].bytes().all(|b| b.is_ascii_digit()) && &rest[slash..] == HOOK_PATH
        })
}

/// A hook the old Claude Visualizer's README set up: a command running its hook.js.
pub fn is_old_visualizer(hook: &Value) -> bool {
    hook.get("type").and_then(Value::as_str) == Some("command")
        && hook.get("command").and_then(Value::as_str).is_some_and(|command| {
            let command = command.to_lowercase();
            command.contains("claude-visualizer") && command.contains("hook.js")
        })
}

/// How many hooks in the settings match.
pub fn count(doc: &Value, matches: impl Fn(&Value) -> bool) -> usize {
    let Some(hooks) = doc.get("hooks").and_then(Value::as_object) else {
        return 0;
    };
    hooks
        .values()
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(|group| group.get("hooks").and_then(Value::as_array))
        .flatten()
        .filter(|hook| matches(hook))
        .count()
}

/// Takes out every hook that matches. A group, event list or hooks section
/// left empty by that goes too; ones that were already empty stay. Returns
/// how many hooks came out.
pub fn remove(doc: &mut Value, matches: impl Fn(&Value) -> bool) -> usize {
    let mut removed = 0;
    let mut emptied_events = Vec::new();
    let Some(hooks) = doc.get_mut("hooks").and_then(Value::as_object_mut) else {
        return 0;
    };
    for (event, groups) in hooks.iter_mut() {
        let Some(groups) = groups.as_array_mut() else {
            continue;
        };
        let had_groups = !groups.is_empty();
        groups.retain_mut(|group| {
            let Some(list) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
                return true;
            };
            let before = list.len();
            list.retain(|hook| !matches(hook));
            removed += before - list.len();
            !(before > 0 && list.is_empty())
        });
        if had_groups && groups.is_empty() {
            emptied_events.push(event.clone());
        }
    }
    for event in &emptied_events {
        hooks.shift_remove(event);
    }
    if !emptied_events.is_empty() && hooks.is_empty() {
        if let Some(root) = doc.as_object_mut() {
            root.shift_remove("hooks");
        }
    }
    removed
}

/// Adds the app's entry to each event the world uses, after whatever is
/// there: one second to answer, and the key written out in full (Claude Code
/// only fills in $VARIABLES that the hook lists, so a variable won't do).
pub fn add_ours(doc: &mut Value, port: u16, key: &str) -> Result<(), String> {
    let mut headers = Map::new();
    headers.insert(KEY_HEADER.into(), key.into());
    let mut entry = Map::new();
    entry.insert("type".into(), "http".into());
    entry.insert("url".into(), format!("http://127.0.0.1:{port}{HOOK_PATH}").into());
    entry.insert("timeout".into(), 1.into());
    entry.insert("headers".into(), Value::Object(headers));

    let root = doc.as_object_mut().ok_or("The settings aren't a JSON object.")?;
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or("The settings' \"hooks\" isn't a JSON object.")?;
    for event in EVENTS {
        let groups = hooks
            .entry(event)
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| format!("The settings' hooks for {event} aren't a list."))?;
        let mut group = Map::new();
        group.insert("hooks".into(), Value::Array(vec![Value::Object(entry.clone())]));
        groups.push(Value::Object(group));
    }
    Ok(())
}

/// Writes the settings back in the file's own style (indent, line endings,
/// final newline), but only if that changes the file. The old file is backed
/// up first, and the new one is swapped in whole, so Claude Code never reads
/// half a file. Returns whether it wrote.
pub fn write(settings: &Settings) -> io::Result<bool> {
    let text = render(&settings.doc, settings.text.as_deref());
    if settings.text.as_deref() == Some(text.as_str()) {
        return Ok(false);
    }
    if settings.text.is_none() && settings.doc.as_object().is_some_and(Map::is_empty) {
        return Ok(false);
    }
    if let Some(dir) = settings.path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    if settings.text.is_some() {
        std::fs::copy(&settings.path, backup_path(&settings.path))?;
    }
    let tmp = sibling(&settings.path, ".prologue-tmp");
    std::fs::write(&tmp, &text)?;
    if let Ok(meta) = std::fs::metadata(&settings.path) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    swap_in(&tmp, &settings.path)?;
    Ok(true)
}

/// Where the copy from before the app's latest change goes.
pub fn backup_path(path: &Path) -> PathBuf {
    sibling(path, ".bak-prologue")
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

// Another program reading the file at that moment can make the swap fail on
// Windows, so it tries a few times.
fn swap_in(tmp: &Path, path: &Path) -> io::Result<()> {
    let mut tries = 0;
    loop {
        match std::fs::rename(tmp, path) {
            Ok(()) => return Ok(()),
            Err(_) if tries < 10 => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(err) => {
                let _ = std::fs::remove_file(tmp);
                return Err(err);
            }
        }
    }
}

fn render(doc: &Value, original: Option<&str>) -> String {
    let indent = original.and_then(detect_indent).unwrap_or("  ");
    let mut out = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(indent.as_bytes());
    let mut serializer = serde_json::Serializer::with_formatter(&mut out, formatter);
    doc.serialize(&mut serializer).expect("a JSON value always serializes");
    let mut text = String::from_utf8(out).expect("serde_json writes UTF-8");
    if original.is_none_or(|t| t.ends_with('\n')) {
        text.push('\n');
    }
    if original.is_some_and(|t| t.contains("\r\n")) {
        text = text.replace('\n', "\r\n");
    }
    if original.is_some_and(|t| t.starts_with('\u{feff}')) {
        text.insert(0, '\u{feff}');
    }
    text
}

// The whitespace in front of the first indented line.
fn detect_indent(text: &str) -> Option<&str> {
    text.lines().skip(1).find_map(|line| {
        let width = line.len() - line.trim_start_matches([' ', '\t']).len();
        (width > 0).then(|| &line[..width])
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Shaped like David's settings: other keys around the hooks, his own
    // hooks on SessionStart, PreToolUse and PostToolUse, with matchers.
    const DAVIDS: &str = r#"{
  "deniedMcpServers": [],
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -NoProfile -File \"C:\\Users\\someone\\.claude\\hooks\\start.ps1\"",
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:/Users/someone/.claude/hooks/gate.mjs\"",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:/Users/someone/.claude/hooks/track.mjs\"",
            "timeout": 10
          }
        ]
      }
    ]
  },
  "enabledPlugins": {
    "something@market": true
  },
  "theme": "dark",
  "inputNeededNotifEnabled": true
}
"#;

    const KEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn doc(text: &str) -> Value {
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn rewrites_the_file_exactly_as_it_was() {
        assert_eq!(render(&doc(DAVIDS), Some(DAVIDS)), DAVIDS);
        let four = DAVIDS.replace("  ", "    ");
        assert_eq!(render(&doc(&four), Some(&four)), four);
        let crlf_no_final_newline = DAVIDS.trim_end().replace('\n', "\r\n");
        assert_eq!(render(&doc(&crlf_no_final_newline), Some(&crlf_no_final_newline)), crlf_no_final_newline);
        let bom = format!("\u{feff}{DAVIDS}");
        assert_eq!(render(&doc(DAVIDS), Some(&bom)), bom);
    }

    #[test]
    fn adds_one_entry_per_event_after_everything_else() {
        let mut d = doc(DAVIDS);
        add_ours(&mut d, 47207, KEY).unwrap();
        assert_eq!(count(&d, is_ours), 16);
        let pre = d["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre.len(), 2, "David's group stays first, ours goes after it");
        assert_eq!(pre[0]["matcher"], "Write|Edit|MultiEdit");
        assert_eq!(
            pre[1],
            serde_json::json!({ "hooks": [{
                "type": "http",
                "url": "http://127.0.0.1:47207/prompt-is-prologue/hook",
                "timeout": 1,
                "headers": { "x-prologue-key": KEY }
            }] })
        );
        let events: Vec<&String> = d["hooks"].as_object().unwrap().keys().collect();
        assert_eq!(&events[..3], ["SessionStart", "PreToolUse", "PostToolUse"]);
        assert!(d["hooks"].get("SessionStart").unwrap().as_array().unwrap().len() == 1, "SessionStart can't send over HTTP");
        let keys: Vec<&String> = d.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["deniedMcpServers", "hooks", "enabledPlugins", "theme", "inputNeededNotifEnabled"]);
    }

    #[test]
    fn taking_them_out_leaves_the_file_byte_for_byte() {
        for original in [DAVIDS.to_string(), DAVIDS.replace("  ", "\t").replace('\n', "\r\n"), "{}\n".to_string(), "{\n  \"theme\": \"dark\"\n}\n".to_string()] {
            let mut d = doc(&original);
            add_ours(&mut d, 47207, KEY).unwrap();
            assert_ne!(render(&d, Some(&original)), original);
            assert_eq!(remove(&mut d, is_ours), 16);
            assert_eq!(render(&d, Some(&original)), original);
        }
    }

    #[test]
    fn a_moved_port_replaces_the_old_entries() {
        let mut d = doc(DAVIDS);
        add_ours(&mut d, 1111, KEY).unwrap();
        add_ours(&mut d, 1111, KEY).unwrap();
        assert_eq!(count(&d, is_ours), 32, "even doubled up");
        assert_eq!(remove(&mut d, is_ours), 32);
        add_ours(&mut d, 2222, KEY).unwrap();
        let text = render(&d, Some(DAVIDS));
        assert_eq!(text.matches("http://127.0.0.1:2222/prompt-is-prologue/hook").count(), 16);
        assert!(!text.contains(":1111/"));
    }

    #[test]
    fn knows_its_own_entries_and_nothing_else() {
        let hook = |url: &str| serde_json::json!({ "type": "http", "url": url });
        assert!(is_ours(&hook("http://127.0.0.1:47207/prompt-is-prologue/hook")));
        assert!(is_ours(&hook("http://localhost:5/prompt-is-prologue/hook")));
        for other in [
            "http://127.0.0.1:47207/prompt-is-prologue/hook/x",
            "http://127.0.0.1:47207/other",
            "http://127.0.0.1/prompt-is-prologue/hook",
            "http://127.0.0.1:47a/prompt-is-prologue/hook",
            "https://example.com/prompt-is-prologue/hook",
            "http://127.0.0.1.example.com:80/prompt-is-prologue/hook",
        ] {
            assert!(!is_ours(&hook(other)), "{other}");
        }
        let command = serde_json::json!({ "type": "command", "url": "http://127.0.0.1:1/prompt-is-prologue/hook" });
        assert!(!is_ours(&command));
    }

    #[test]
    fn finds_and_takes_out_only_the_old_visualizer() {
        let text = r#"{
  "hooks": {
    "PreToolUse": [
      { "hooks": [{ "type": "command", "command": "node /path/to/claude-visualizer/hook.js", "async": true }] },
      { "matcher": "Bash", "hooks": [
        { "type": "command", "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\path\\to\\Claude-Visualizer\\hook.js\"", "async": true },
        { "type": "command", "command": "node mine.js" }
      ] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node /path/to/claude-visualizer/hook.js", "async": true }] }
    ],
    "Stop": []
  }
}"#;
        let mut d = doc(text);
        assert_eq!(count(&d, is_old_visualizer), 3);
        assert_eq!(remove(&mut d, is_old_visualizer), 3);
        assert_eq!(
            d,
            serde_json::json!({ "hooks": {
                "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node mine.js" }] }],
                "Stop": []
            } })
        );
    }

    #[test]
    fn reads_what_it_can_and_refuses_the_rest() {
        let dir = std::env::temp_dir().join(format!("prologue-settings-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");

        let missing = read(&path).unwrap();
        assert_eq!((missing.text, missing.doc), (None, serde_json::json!({})));

        for (bad, why) in [("{ \"hooks\": ", "isn't valid JSON"), ("[1, 2]", "doesn't hold a JSON object")] {
            std::fs::write(&path, bad).unwrap();
            let err = read(&path).err().unwrap();
            assert!(err.contains(why), "{err}");
        }
        std::fs::write(&path, "{ \"hooks\": [] }").unwrap();
        let mut odd = read(&path).unwrap();
        assert!(add_ours(&mut odd.doc, 1, KEY).is_err(), "hooks that aren't an object are left alone");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn writes_only_when_something_changed_and_backs_up_first() {
        let dir = std::env::temp_dir().join(format!("prologue-write-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        std::fs::write(&path, DAVIDS).unwrap();

        let same = read(&path).unwrap();
        assert!(!write(&same).unwrap(), "nothing changed, nothing written");
        assert!(!backup_path(&path).exists());

        let mut s = read(&path).unwrap();
        add_ours(&mut s.doc, 47207, KEY).unwrap();
        assert!(write(&s).unwrap());
        assert_eq!(std::fs::read_to_string(backup_path(&path)).unwrap(), DAVIDS);
        let mut s = read(&path).unwrap();
        assert_eq!(count(&s.doc, is_ours), 16);
        remove(&mut s.doc, is_ours);
        assert!(write(&s).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), DAVIDS);
        assert!(!sibling(&path, ".prologue-tmp").exists());

        // No file at all: adding makes one, and empty settings aren't written.
        let fresh = dir.join("new").join("settings.json");
        assert!(!write(&read(&fresh).unwrap()).unwrap());
        assert!(!fresh.exists());
        let mut s = read(&fresh).unwrap();
        add_ours(&mut s.doc, 47207, KEY).unwrap();
        assert!(write(&s).unwrap());
        assert_eq!(count(&read(&fresh).unwrap().doc, is_ours), 16);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
