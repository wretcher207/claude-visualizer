// The listener: Claude Code's hooks post their events here.
//
// It listens only on this computer (127.0.0.1) and takes an event only if it
// carries the key made on first run. Browsers mark every request a web page
// makes, and those are refused too. Each event gets an empty 200 as soon as it
// has arrived, from this module's own threads, so a busy scene can never hold
// Claude up, and the answer never has a body Claude could read as an
// instruction. Only then is the event trimmed to the few fields the world
// reads (which session, which event, which tool, how long it took) and handed
// on. Prompts, file contents and command output are dropped here, and nothing
// about Claude's work is written to disk.

use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const DEFAULT_PORT: u16 = 47207;
pub const HOOK_PATH: &str = "/prompt-is-prologue/hook";
pub const KEY_HEADER: &str = "x-prologue-key";
const CONFIG_FILE: &str = "listener.json";

const MAX_HEAD: usize = 16 * 1024;
const MAX_BODY: usize = 64 * 1024 * 1024;
const MAX_OPEN: usize = 64;
const READ_TIMEOUT: Duration = Duration::from_secs(2);
const WRITE_TIMEOUT: Duration = Duration::from_secs(1);

// The events the world uses. SessionStart isn't one: it can't be sent over HTTP.
const EVENTS: [&str; 16] = [
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "PermissionDenied",
    "Notification",
    "Elicitation",
    "ElicitationResult",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "PostCompact",
    "Stop",
    "StopFailure",
    "SessionEnd",
];

const OK: &str = "200 OK";
const BAD_REQUEST: &str = "400 Bad Request";
const UNAUTHORIZED: &str = "401 Unauthorized";
const FORBIDDEN: &str = "403 Forbidden";
const NOT_FOUND: &str = "404 Not Found";
const METHOD_NOT_ALLOWED: &str = "405 Method Not Allowed";
const LENGTH_REQUIRED: &str = "411 Length Required";
const TOO_LARGE: &str = "413 Content Too Large";
const HEAD_TOO_LARGE: &str = "431 Request Header Fields Too Large";
const NOT_IMPLEMENTED: &str = "501 Not Implemented";

/// Where to send events and the key they must carry. Saved on first run;
/// the hook entries in Claude Code's settings are written from it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Config {
    pub port: u16,
    pub key: String,
}

/// One of Claude's events, trimmed to what the world reads. Field names match
/// the hook payload, so the world handles it exactly like a demo event.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct HookEvent {
    pub session_id: String,
    pub hook_event_name: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_interrupt: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notification_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Loads or makes the key, takes the saved port (or the fixed one), and starts
/// listening. If something else holds that port, it moves to a free one and
/// saves it, so the hook entries can follow.
pub fn start(
    config_dir: PathBuf,
    sink: impl Fn(HookEvent) + Send + 'static,
) -> io::Result<Config> {
    let path = config_dir.join(CONFIG_FILE);
    let saved = load_config(&path);
    let key = match &saved {
        Some(cfg) => cfg.key.clone(),
        None => new_key()?,
    };
    let wanted = saved.as_ref().map_or(DEFAULT_PORT, |cfg| cfg.port);
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, wanted))
        .or_else(|_| TcpListener::bind((Ipv4Addr::LOCALHOST, 0)))?;
    let cfg = Config {
        port: listener.local_addr()?.port(),
        key,
    };
    if saved.as_ref() != Some(&cfg) {
        save_config(&path, &cfg)?;
    }
    run(listener, cfg.clone(), sink)?;
    Ok(cfg)
}

/// Serves an already bound socket: one thread accepts, one thread per request
/// reads and answers, and a single hand-off thread trims the events and passes
/// them on in the order they arrived.
fn run(
    listener: TcpListener,
    cfg: Config,
    sink: impl Fn(HookEvent) + Send + 'static,
) -> io::Result<()> {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    thread::Builder::new()
        .name("prologue-hand-off".into())
        .spawn(move || {
            for body in rx {
                if let Some(event) = trim(&body) {
                    sink(event);
                }
            }
        })?;

    let cfg = Arc::new(cfg);
    thread::Builder::new()
        .name("prologue-listener".into())
        .spawn(move || {
            let open = Arc::new(AtomicUsize::new(0));
            for conn in listener.incoming() {
                let Ok(conn) = conn else {
                    thread::sleep(Duration::from_millis(20));
                    continue;
                };
                // Past the cap the connection is just closed, and Claude carries on at once.
                if open.fetch_add(1, Ordering::SeqCst) >= MAX_OPEN {
                    open.fetch_sub(1, Ordering::SeqCst);
                    continue;
                }
                let slot = Slot(open.clone());
                let (cfg, tx) = (cfg.clone(), tx.clone());
                let _ = thread::Builder::new()
                    .name("prologue-request".into())
                    .spawn(move || {
                        let _slot = slot;
                        if let Some(body) = serve(conn, &cfg) {
                            let _ = tx.send(body);
                        }
                    });
            }
        })?;
    Ok(())
}

// Counts open requests; frees its place even if the request's thread fails.
struct Slot(Arc<AtomicUsize>);

impl Drop for Slot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

// Reads one request and answers it. Returns the body when it's a real event.
fn serve(mut conn: TcpStream, cfg: &Config) -> Option<Vec<u8>> {
    if !conn.peer_addr().ok()?.ip().is_loopback() {
        return None;
    }
    let _ = conn.set_read_timeout(Some(READ_TIMEOUT));
    let _ = conn.set_write_timeout(Some(WRITE_TIMEOUT));
    let _ = conn.set_nodelay(true);

    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 16 * 1024];
    let head_end = loop {
        if let Some(end) = head_end(&buf) {
            break end;
        }
        if buf.len() > MAX_HEAD {
            reply(&mut conn, HEAD_TOO_LARGE);
            return None;
        }
        let n = conn.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
    };

    let request = match check(&buf[..head_end], cfg) {
        Ok(request) => request,
        Err(status) => {
            reply(&mut conn, status);
            return None;
        }
    };
    if request.expect_continue {
        conn.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").ok()?;
    }

    let mut body = buf.split_off(head_end);
    body.truncate(request.length);
    let have = body.len();
    body.resize(request.length, 0);
    conn.read_exact(&mut body[have..]).ok()?;

    reply(&mut conn, OK);
    Some(body)
}

fn head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|i| i + 4)
}

fn reply(conn: &mut TcpStream, status: &str) {
    let text = format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    let _ = conn.write_all(text.as_bytes());
    let _ = conn.flush();
}

#[derive(Debug, PartialEq)]
struct Request {
    length: usize,
    expect_continue: bool,
}

// Decides from the request line and headers alone whether to take a request.
fn check(head: &[u8], cfg: &Config) -> Result<Request, &'static str> {
    let text = std::str::from_utf8(head).map_err(|_| BAD_REQUEST)?;
    let mut lines = text.split("\r\n");
    let parts: Vec<&str> = lines.next().unwrap_or("").split(' ').collect();
    let [method, target, version] = parts[..] else {
        return Err(BAD_REQUEST);
    };
    if !version.starts_with("HTTP/1.") {
        return Err(BAD_REQUEST);
    }
    if method != "POST" {
        return Err(METHOD_NOT_ALLOWED);
    }
    if target != HOOK_PATH {
        return Err(NOT_FOUND);
    }

    let hosts = [format!("127.0.0.1:{}", cfg.port), format!("localhost:{}", cfg.port)];
    let mut host_ok = false;
    let mut key_ok = false;
    let mut length = None;
    let mut expect_continue = false;
    for line in lines.filter(|line| !line.is_empty()) {
        let (name, value) = line.split_once(':').ok_or(BAD_REQUEST)?;
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            // Every request a web page makes carries these. Claude Code's never do.
            "origin" | "sec-fetch-site" | "sec-fetch-mode" | "sec-fetch-dest" => {
                return Err(FORBIDDEN)
            }
            "host" => host_ok = hosts.iter().any(|h| h == value),
            KEY_HEADER => key_ok = same(value.as_bytes(), cfg.key.as_bytes()),
            "content-length" => {
                if length.is_some() {
                    return Err(BAD_REQUEST);
                }
                length = Some(value.parse::<usize>().map_err(|_| BAD_REQUEST)?);
            }
            "transfer-encoding" => return Err(NOT_IMPLEMENTED),
            "expect" => expect_continue = value.eq_ignore_ascii_case("100-continue"),
            _ => {}
        }
    }
    if !host_ok {
        return Err(FORBIDDEN);
    }
    if !key_ok {
        return Err(UNAUTHORIZED);
    }
    let length = length.ok_or(LENGTH_REQUIRED)?;
    if length > MAX_BODY {
        return Err(TOO_LARGE);
    }
    Ok(Request {
        length,
        expect_continue,
    })
}

// Compares keys in the same time whatever they hold.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

// The fields read from Claude's payload. Everything else in it (the prompt,
// tool input and output, file paths, messages) is skipped by the parser.
#[derive(Deserialize)]
struct Incoming {
    session_id: Option<Value>,
    hook_event_name: Option<Value>,
    tool_name: Option<Value>,
    agent_id: Option<Value>,
    agent_type: Option<Value>,
    duration_ms: Option<Value>,
    is_interrupt: Option<Value>,
    notification_type: Option<Value>,
    message: Option<Value>,
    error: Option<Value>,
    trigger: Option<Value>,
    reason: Option<Value>,
}

fn trim(body: &[u8]) -> Option<HookEvent> {
    let raw: Incoming = serde_json::from_slice(body).ok()?;
    let session_id = text(&raw.session_id, 128)?;
    let name = raw.hook_event_name.as_ref()?.as_str()?;
    let hook_event_name = *EVENTS.iter().find(|known| **known == name)?;

    // The world only asks whether a notification is about permission, so keep
    // that answer and never the message itself.
    let mut notification_type = word(&raw.notification_type);
    let about_permission = raw
        .message
        .as_ref()
        .and_then(Value::as_str)
        .is_some_and(|m| m.to_lowercase().contains("permission"));
    if hook_event_name == "Notification" && about_permission {
        notification_type = Some("permission_prompt".into());
    }

    Some(HookEvent {
        session_id,
        hook_event_name,
        tool_name: text(&raw.tool_name, 256),
        agent_id: text(&raw.agent_id, 128),
        agent_type: text(&raw.agent_type, 128),
        duration_ms: raw
            .duration_ms
            .as_ref()
            .and_then(Value::as_f64)
            .filter(|ms| ms.is_finite() && *ms >= 0.0),
        is_interrupt: raw.is_interrupt.as_ref().and_then(Value::as_bool),
        notification_type,
        // A short code like "rate_limit". Error text (which can hold command
        // output) never passes this.
        error: word(&raw.error),
        trigger: word(&raw.trigger),
        reason: word(&raw.reason),
    })
}

// An id or name: a string of printable characters, not too long.
fn text(value: &Option<Value>, max: usize) -> Option<String> {
    let s = value.as_ref()?.as_str()?;
    let fits = !s.is_empty() && s.chars().count() <= max && !s.chars().any(char::is_control);
    fits.then(|| s.to_string())
}

// A short code word, like "permission_prompt" or "auto".
fn word(value: &Option<Value>) -> Option<String> {
    let s = value.as_ref()?.as_str()?;
    let fits = !s.is_empty()
        && s.len() <= 64
        && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
    fits.then(|| s.to_string())
}

fn load_config(path: &Path) -> Option<Config> {
    let cfg: Config = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    let key_ok = cfg.key.len() == 64 && cfg.key.bytes().all(|b| b.is_ascii_hexdigit());
    (cfg.port != 0 && key_ok).then_some(cfg)
}

fn save_config(path: &Path, cfg: &Config) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&tmp)?;
    file.write_all(serde_json::to_string_pretty(cfg)?.as_bytes())?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(&tmp, path)
}

fn new_key() -> io::Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|err| io::Error::other(err.to_string()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    const KEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn cfg() -> Config {
        Config {
            port: 47207,
            key: KEY.into(),
        }
    }

    // The request Claude Code 2.1.296 actually sends (seen with a probe), with our key.
    fn head(extra: &str) -> String {
        format!(
            "POST {HOOK_PATH} HTTP/1.1\r\nAccept: application/json, text/plain, */*\r\n\
             Content-Type: application/json\r\nX-Prologue-Key: {KEY}\r\nUser-Agent: axios/1.15.2\r\n\
             Content-Length: 12\r\nAccept-Encoding: gzip, compress, deflate, br\r\n\
             Host: 127.0.0.1:47207\r\nConnection: keep-alive\r\n{extra}\r\n"
        )
    }

    #[test]
    fn takes_claudes_request() {
        let got = check(head("").as_bytes(), &cfg());
        assert_eq!(got, Ok(Request { length: 12, expect_continue: false }));
    }

    #[test]
    fn refuses_anything_else() {
        let wrong_key = head("").replace(KEY, &KEY.replace('0', "1"));
        let no_key = head("").replace(&format!("X-Prologue-Key: {KEY}\r\n"), "");
        let cases: Vec<(String, &str)> = vec![
            (wrong_key, UNAUTHORIZED),
            (no_key, UNAUTHORIZED),
            (head("Origin: https://example.com\r\n"), FORBIDDEN),
            (head("Origin: null\r\n"), FORBIDDEN),
            (head("Sec-Fetch-Mode: no-cors\r\n"), FORBIDDEN),
            (head("").replace("Host: 127.0.0.1:47207", "Host: evil.example:47207"), FORBIDDEN),
            (head("").replace("Host: 127.0.0.1:47207", "Host: 127.0.0.1:80"), FORBIDDEN),
            (head("").replace(HOOK_PATH, "/"), NOT_FOUND),
            (head("").replace(HOOK_PATH, &format!("{HOOK_PATH}?x=1")), NOT_FOUND),
            (head("").replace("POST ", "OPTIONS "), METHOD_NOT_ALLOWED),
            (head("").replace("POST ", "GET "), METHOD_NOT_ALLOWED),
            (head("").replace("Content-Length: 12\r\n", ""), LENGTH_REQUIRED),
            (head("Content-Length: 12\r\n"), BAD_REQUEST),
            (head("Transfer-Encoding: chunked\r\n"), NOT_IMPLEMENTED),
            (head("").replace("Content-Length: 12", "Content-Length: 99999999999"), TOO_LARGE),
            (head("").replace(" HTTP/1.1", ""), BAD_REQUEST),
        ];
        for (request, status) in cases {
            assert_eq!(check(request.as_bytes(), &cfg()), Err(status), "{request}");
        }
    }

    #[test]
    fn keeps_only_what_the_world_reads() {
        let body = serde_json::json!({
            "session_id": "abc-123",
            "transcript_path": "C:/Users/someone/.claude/projects/x.jsonl",
            "cwd": "C:/Users/someone/secret-project",
            "permission_mode": "default",
            "hook_event_name": "PostToolUse",
            "prompt": "my private prompt",
            "tool_name": "Read",
            "tool_input": { "file_path": "C:/secret.txt" },
            "tool_response": { "file": { "content": "file contents" } },
            "tool_use_id": "toolu_1",
            "duration_ms": 42,
            "agent_id": "agent-7",
            "agent_type": "Explore",
        });
        let event = trim(body.to_string().as_bytes()).unwrap();
        let sent = serde_json::to_value(&event).unwrap();
        assert_eq!(
            sent,
            serde_json::json!({
                "session_id": "abc-123",
                "hook_event_name": "PostToolUse",
                "tool_name": "Read",
                "agent_id": "agent-7",
                "agent_type": "Explore",
                "duration_ms": 42.0,
            })
        );
    }

    #[test]
    fn keeps_codes_and_drops_text() {
        let failure = serde_json::json!({
            "session_id": "s", "hook_event_name": "PostToolUseFailure", "tool_name": "Bash",
            "error": "Command failed with exit code 1: secret output", "is_interrupt": false,
        });
        let event = trim(failure.to_string().as_bytes()).unwrap();
        assert_eq!(event.error, None);
        assert_eq!(event.is_interrupt, Some(false));

        let stop = serde_json::json!({ "session_id": "s", "hook_event_name": "StopFailure", "error": "rate_limit" });
        assert_eq!(trim(stop.to_string().as_bytes()).unwrap().error.as_deref(), Some("rate_limit"));

        let ask = serde_json::json!({
            "session_id": "s", "hook_event_name": "Notification",
            "message": "Claude needs your permission to use Bash",
        });
        let event = trim(ask.to_string().as_bytes()).unwrap();
        assert_eq!(event.notification_type.as_deref(), Some("permission_prompt"));
        assert!(!serde_json::to_string(&event).unwrap().contains("Claude needs"));
    }

    #[test]
    fn drops_what_it_cannot_use() {
        let cases = [
            r#"{"hook_event_name":"PreToolUse"}"#.to_string(),
            r#"{"session_id":"s","hook_event_name":"SessionStart"}"#.to_string(),
            r#"{"session_id":"s","hook_event_name":"MadeUp"}"#.to_string(),
            r#"{"session_id":42,"hook_event_name":"Stop"}"#.to_string(),
            format!(r#"{{"session_id":"{}","hook_event_name":"Stop"}}"#, "x".repeat(200)),
            "not json".to_string(),
        ];
        for body in cases {
            assert_eq!(trim(body.as_bytes()), None, "{body}");
        }
        // Odd types in fields it doesn't need don't cost the event.
        let odd = r#"{"session_id":"s","hook_event_name":"Stop","tool_name":{"x":1},"duration_ms":"slow"}"#;
        let event = trim(odd.as_bytes()).unwrap();
        assert_eq!((event.tool_name, event.duration_ms), (None, None));
    }

    #[test]
    fn answers_then_hands_on() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let cfg = Config { port, key: KEY.into() };
        let (tx, rx) = mpsc::channel();
        run(listener, cfg, move |event| tx.send(event).unwrap()).unwrap();

        // A huge tool result, the size of a big file read in full.
        let huge = "x".repeat(16 * 1024 * 1024);
        let body = serde_json::json!({
            "session_id": "s1", "hook_event_name": "PostToolUse", "tool_name": "Read",
            "tool_response": huge,
        })
        .to_string();
        let started = Instant::now();
        let (status, answer) = send(port, &body, KEY, "");
        let took = started.elapsed();
        assert_eq!(status, "HTTP/1.1 200 OK");
        assert!(!answer.contains("\r\n\r\n{"), "the answer has no body");
        assert!(answer.ends_with("Content-Length: 0\r\nConnection: close\r\n\r\n"));
        let event = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(event.session_id, "s1");
        eprintln!("16 MB event answered in {took:?}");

        let (status, _) = send(port, r#"{"session_id":"s2","hook_event_name":"Stop"}"#, "wrong", "");
        assert_eq!(status, "HTTP/1.1 401 Unauthorized");
        let (status, _) = send(port, r#"{"session_id":"s3","hook_event_name":"Stop"}"#, KEY, "Origin: http://evil.example\r\n");
        assert_eq!(status, "HTTP/1.1 403 Forbidden");
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err(), "refused events never reach the world");
    }

    fn send(port: u16, body: &str, key: &str, extra: &str) -> (String, String) {
        let mut conn = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        let head = format!(
            "POST {HOOK_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\n\
             {KEY_HEADER}: {key}\r\nContent-Length: {}\r\n{extra}\r\n",
            body.len()
        );
        // One write, so a refused request (answered without its body being
        // read) has nothing left unread when the listener closes.
        let _ = conn.write_all([head.as_bytes(), body.as_bytes()].concat().as_slice());
        let mut answer = String::new();
        let _ = conn.read_to_string(&mut answer);
        (answer.lines().next().unwrap_or("").to_string(), answer)
    }

    #[test]
    fn makes_a_key_and_keeps_it() {
        let dir = std::env::temp_dir().join(format!("prologue-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let first = start(dir.clone(), |_| {}).unwrap();
        assert_eq!(first.key.len(), 64);
        let saved = load_config(&dir.join(CONFIG_FILE)).unwrap();
        assert_eq!(saved, first);
        // The first copy still holds the port, so a second one moves and saves the new port.
        let second = start(dir.clone(), |_| {}).unwrap();
        assert_eq!(second.key, first.key);
        assert_ne!(second.port, first.port);
        assert_eq!(load_config(&dir.join(CONFIG_FILE)).unwrap().port, second.port);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
