// The listener Claude Code's HTTP hooks post to (phase 2 step 2).
//
// It listens on 127.0.0.1 only and takes an event only if it carries the
// secret key, on the one path only this app uses, with no Origin header and
// a Host of this computer. That shuts out other machines, web pages (a page
// can't add the key header without a preflight, which is refused, and it
// always sends Origin) and DNS rebinding.
//
// Every request is answered from its own thread the moment its headers are
// checked: 200 with an empty body, before the body is read. An empty 2xx is
// the only reply Claude reads as "nothing to say", so the app can never hand
// Claude an instruction, and a huge tool result or a busy scene can't hold
// Claude up. Only then is the body read, cut down to the few fields the
// world uses, and passed on. Nothing about Claude's work is written to disk.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The one path the app answers on. Step 4 finds the app's own hook entries
/// in settings.json by this path, so it must stay unique to this app.
pub const HOOK_PATH: &str = "/prompt-is-prologue/v1/hook";
/// The header that carries the secret key.
pub const KEY_HEADER: &str = "x-prologue-key";
/// The fixed port. If something else holds it, the next free one is used.
pub const DEFAULT_PORT: u16 = 47207;

const CONFIG_FILE: &str = "listener.json";
const PORT_TRIES: u16 = 20;
const MAX_HEADER_BYTES: usize = 16 * 1024;
// PostToolUse can carry a whole file or command output. Bodies past this
// are drained and dropped rather than held in memory.
const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;
const MAX_CONNECTIONS: usize = 64;
const READ_TIMEOUT: Duration = Duration::from_secs(5);

const OK: &[u8] = b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const REFUSED: &[u8] = b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const BAD: &[u8] = b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

// ---- Config ----

/// The port and key, made on first run and kept in the app's config folder.
/// This is the only thing the listener writes to disk.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Config {
    pub port: u16,
    pub key: String,
}

impl Config {
    pub fn new() -> io::Result<Config> {
        Ok(Config { port: DEFAULT_PORT, key: new_key()? })
    }

    /// Reads `listener.json` from `dir`, or makes and saves a new one.
    pub fn load_or_create(dir: &Path) -> io::Result<Config> {
        let path = dir.join(CONFIG_FILE);
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<Config>(&text) {
                if cfg.port != 0 && cfg.key.len() >= 32 {
                    return Ok(cfg);
                }
            }
        }
        let cfg = Config::new()?;
        cfg.save(dir)?;
        Ok(cfg)
    }

    pub fn save(&self, dir: &Path) -> io::Result<()> {
        std::fs::create_dir_all(dir)?;
        let text = serde_json::to_string_pretty(self).map_err(io::Error::other)?;
        let tmp = dir.join(format!("{CONFIG_FILE}.tmp"));
        write_private(&tmp, text.as_bytes())?;
        std::fs::rename(&tmp, dir.join(CONFIG_FILE))
    }
}

fn new_key() -> io::Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| io::Error::other(e.to_string()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(unix)]
fn write_private(path: &Path, data: &[u8]) -> io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(data)
}

// On Windows the app's config folder is already private to the user.
#[cfg(not(unix))]
fn write_private(path: &Path, data: &[u8]) -> io::Result<()> {
    std::fs::write(path, data)
}

// ---- The event the scene gets ----

/// What's left of a hook event after the listener is done with it: only the
/// fields `web/src/world.js` reads, in the same names, so the world sees the
/// same shape the demo makes. Prompts, tool inputs and results, file paths,
/// transcripts and the working folder are all dropped.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct Event {
    pub session_id: String,
    pub hook_event_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_interrupt: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notification_type: Option<String>,
    /// A Notification's text is only checked for "permission", so that word
    /// is all that's kept of it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// StopFailure's error kind, kept short.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// Everything not named here (tool_input, tool_response, prompt, cwd,
// transcript_path, ...) is skipped by serde without being kept.
#[derive(Deserialize)]
struct Raw {
    session_id: Option<Value>,
    hook_event_name: Option<Value>,
    tool_name: Option<Value>,
    duration_ms: Option<Value>,
    agent_id: Option<Value>,
    agent_type: Option<Value>,
    is_interrupt: Option<Value>,
    notification_type: Option<Value>,
    message: Option<Value>,
    error: Option<Value>,
}

fn short(v: Option<Value>, max: usize) -> Option<String> {
    match v {
        Some(Value::String(s)) if !s.is_empty() => Some(s.chars().take(max).collect()),
        _ => None,
    }
}

/// Cuts a hook payload down to an `Event`, or `None` if it isn't one.
pub fn filter(body: &[u8]) -> Option<Event> {
    let raw: Raw = serde_json::from_slice(body).ok()?;
    let session_id = short(raw.session_id, 128)?;
    let hook_event_name = short(raw.hook_event_name, 64)?;
    let message = short(raw.message, 4096)
        .filter(|m| m.to_lowercase().contains("permission"))
        .map(|_| "permission".to_string());
    let error = match raw.error {
        Some(Value::Object(o)) => short(o.get("type").cloned(), 64),
        other => short(other, 64),
    };
    Some(Event {
        session_id,
        hook_event_name,
        tool_name: short(raw.tool_name, 128),
        duration_ms: raw.duration_ms.as_ref().and_then(Value::as_f64),
        agent_id: short(raw.agent_id, 128),
        agent_type: short(raw.agent_type, 128),
        is_interrupt: raw.is_interrupt.as_ref().and_then(Value::as_bool),
        notification_type: short(raw.notification_type, 64),
        message,
        error,
    })
}

// ---- The server ----

/// A running listener. It runs until the app quits.
pub struct Listener {
    pub port: u16,
}

/// Binds 127.0.0.1 on `cfg.port`, or the next free port if that one is
/// taken, and starts answering. `on_event` runs on the request's own
/// thread, after Claude already has its answer. The port actually used is
/// in the result; if it differs from `cfg.port`, the caller saves it and
/// (from step 4) rewrites the app's hook entries.
pub fn start<F>(cfg: &Config, on_event: F) -> io::Result<Listener>
where
    F: Fn(Event) + Send + Sync + 'static,
{
    let socket = bind(cfg.port)?;
    let port = socket.local_addr()?.port();
    let shared = Arc::new(Shared {
        key: cfg.key.clone(),
        port,
        active: AtomicUsize::new(0),
        on_event: Box::new(on_event),
    });
    thread::Builder::new()
        .name("prologue-listener".into())
        .spawn(move || accept_loop(socket, shared))?;
    Ok(Listener { port })
}

fn bind(preferred: u16) -> io::Result<TcpListener> {
    let mut last = None;
    for i in 0..PORT_TRIES {
        let Some(port) = preferred.checked_add(i) else { break };
        match TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)) {
            Ok(s) => return Ok(s),
            Err(e) => last = Some(e),
        }
    }
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| last.unwrap_or(e))
}

struct Shared {
    key: String,
    port: u16,
    active: AtomicUsize,
    on_event: Box<dyn Fn(Event) + Send + Sync>,
}

fn accept_loop(socket: TcpListener, shared: Arc<Shared>) {
    for conn in socket.incoming() {
        let Ok(stream) = conn else { continue };
        // A flood of connections gets dropped instead of piling up threads.
        if shared.active.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
            shared.active.fetch_sub(1, Ordering::SeqCst);
            continue;
        }
        let s = shared.clone();
        let spawned = thread::Builder::new().name("prologue-request".into()).spawn(move || {
            let _ = handle(stream, &s);
            s.active.fetch_sub(1, Ordering::SeqCst);
        });
        if spawned.is_err() {
            shared.active.fetch_sub(1, Ordering::SeqCst);
        }
    }
}

struct Head {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
}

impl Head {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
}

fn read_head(r: &mut BufReader<TcpStream>) -> io::Result<Option<Head>> {
    let mut lines = Vec::new();
    let mut total = 0;
    loop {
        let mut line = String::new();
        let n = r.by_ref().take((MAX_HEADER_BYTES - total + 1) as u64).read_line(&mut line)?;
        if n == 0 {
            return Ok(None);
        }
        total += n;
        if total > MAX_HEADER_BYTES {
            return Ok(None);
        }
        let line = line.trim_end_matches(['\r', '\n']).to_string();
        if line.is_empty() {
            break;
        }
        lines.push(line);
    }
    let mut first = lines.first().map(|l| l.split(' ')).into_iter().flatten();
    let (Some(method), Some(path)) = (first.next(), first.next()) else { return Ok(None) };
    let (method, path) = (method.to_string(), path.to_string());
    let headers = lines[1..]
        .iter()
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    Ok(Some(Head { method, path, headers }))
}

fn same_key(given: &str, key: &str) -> bool {
    let (a, b) = (given.as_bytes(), key.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn allowed(head: &Head, s: &Shared) -> bool {
    if head.method != "POST" || head.path != HOOK_PATH {
        return false;
    }
    // Browsers always send Origin on a cross-site POST; Claude Code doesn't.
    if head.header("origin").is_some() {
        return false;
    }
    let host_ok = head.header("host").is_some_and(|h| {
        h == format!("127.0.0.1:{}", s.port) || h == format!("localhost:{}", s.port)
    });
    host_ok && head.header(KEY_HEADER).is_some_and(|k| same_key(k, &s.key))
}

fn handle(stream: TcpStream, s: &Shared) -> io::Result<()> {
    stream.set_read_timeout(Some(READ_TIMEOUT))?;
    stream.set_nodelay(true)?;
    let mut writer = stream.try_clone()?;
    let mut r = BufReader::new(stream);

    let Some(head) = read_head(&mut r)? else {
        return writer.write_all(BAD);
    };
    if !allowed(&head, s) {
        return writer.write_all(REFUSED);
    }

    // Claude has its answer before the body is even read.
    writer.write_all(OK)?;
    writer.flush()?;

    let chunked = head
        .header("transfer-encoding")
        .is_some_and(|v| v.to_ascii_lowercase().contains("chunked"));
    let body = if chunked {
        read_chunked(&mut r)?
    } else {
        let len: usize = head.header("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
        read_exact_capped(&mut r, len)?
    };
    if let Some(event) = body.as_deref().and_then(filter) {
        (s.on_event)(event);
    }
    Ok(())
}

// Reads `len` bytes, or drains them and gives `None` past the cap.
fn read_exact_capped(r: &mut impl Read, len: usize) -> io::Result<Option<Vec<u8>>> {
    if len > MAX_BODY_BYTES {
        io::copy(&mut r.take(len as u64), &mut io::sink())?;
        return Ok(None);
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body)?;
    Ok(Some(body))
}

fn read_chunked(r: &mut BufReader<TcpStream>) -> io::Result<Option<Vec<u8>>> {
    let mut body = Vec::new();
    let mut over = false;
    loop {
        let mut line = String::new();
        r.read_line(&mut line)?;
        let size = usize::from_str_radix(line.trim().split(';').next().unwrap_or(""), 16)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "bad chunk size"))?;
        if size == 0 {
            // Trailers end with a blank line.
            loop {
                let mut t = String::new();
                if r.read_line(&mut t)? == 0 || t.trim().is_empty() {
                    break;
                }
            }
            return Ok(if over { None } else { Some(body) });
        }
        if over || body.len() + size > MAX_BODY_BYTES {
            over = true;
            body = Vec::new();
            io::copy(&mut r.by_ref().take(size as u64), &mut io::sink())?;
        } else {
            let start = body.len();
            body.resize(start + size, 0);
            r.read_exact(&mut body[start..])?;
        }
        let mut crlf = [0u8; 2];
        r.read_exact(&mut crlf)?;
    }
}
