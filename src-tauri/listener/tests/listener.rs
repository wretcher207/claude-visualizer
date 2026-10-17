// Step 2's checks: events with the key get through cut down to what the
// world uses, everything else is refused, and the answer comes back within
// a few milliseconds even for a huge tool result.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

use prologue_listener::{filter, start, Config, Event, HOOK_PATH, KEY_HEADER};

fn listener() -> (Config, u16, Receiver<Event>) {
    let mut cfg = Config::new().unwrap();
    cfg.port = 0; // any free port, so tests can run side by side
    let (tx, rx) = channel();
    let l = start(&cfg, move |e| {
        let _ = tx.send(e);
    })
    .unwrap();
    (cfg, l.port, rx)
}

// Sends a raw request and returns (status line, whole reply, time to the
// first byte of the reply).
fn send(port: u16, head: &str, body: &[u8]) -> (String, String, Duration) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    // Write the body from another thread, like a client streaming a big
    // payload, so a reply that comes before the body is measured as such.
    let mut w = s.try_clone().unwrap();
    let body = body.to_vec();
    let t0 = Instant::now();
    s.write_all(head.as_bytes()).unwrap();
    let writer = std::thread::spawn(move || {
        let _ = w.write_all(&body);
    });
    let mut first = [0u8; 1];
    s.read_exact(&mut first).unwrap();
    let ttfb = t0.elapsed();
    let mut rest = Vec::new();
    let _ = s.read_to_end(&mut rest);
    let _ = writer.join();
    let mut reply = vec![first[0]];
    reply.extend(rest);
    let reply = String::from_utf8_lossy(&reply).to_string();
    let status = reply.lines().next().unwrap_or("").to_string();
    (status, reply, ttfb)
}

fn post(port: u16, key: &str, extra: &str, body: &[u8]) -> (String, String, Duration) {
    let head = format!(
        "POST {HOOK_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\n{KEY_HEADER}: {key}\r\n{extra}Content-Length: {}\r\n\r\n",
        body.len()
    );
    send(port, &head, body)
}

const TOOL: &str = r#"{"session_id":"s1","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"cat secrets.txt"},"cwd":"C:\\Users\\wretc\\workspace","transcript_path":"x.jsonl","prompt":"private words"}"#;

#[test]
fn takes_an_event_with_the_key_and_keeps_only_what_the_world_uses() {
    let (cfg, port, rx) = listener();
    let (status, reply, _) = post(port, &cfg.key, "", TOOL.as_bytes());
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert!(reply.ends_with("\r\n\r\n"), "the reply has no body: {reply:?}");
    let e = rx.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(e.session_id, "s1");
    assert_eq!(e.hook_event_name, "PreToolUse");
    assert_eq!(e.tool_name.as_deref(), Some("Bash"));
    let out = serde_json::to_string(&e).unwrap();
    for gone in ["secrets", "wretc", "jsonl", "private", "cwd", "tool_input"] {
        assert!(!out.contains(gone), "{gone} leaked into {out}");
    }
}

#[test]
fn refuses_without_the_key_or_with_a_wrong_one() {
    let (cfg, port, rx) = listener();
    let head = format!(
        "POST {HOOK_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: {}\r\n\r\n",
        TOOL.len()
    );
    assert_eq!(send(port, &head, TOOL.as_bytes()).0, "HTTP/1.1 403 Forbidden");
    let mut wrong = cfg.key.clone().into_bytes();
    wrong[0] = if wrong[0] == b'a' { b'b' } else { b'a' };
    let wrong = String::from_utf8(wrong).unwrap();
    assert_eq!(post(port, &wrong, "", TOOL.as_bytes()).0, "HTTP/1.1 403 Forbidden");
    assert_eq!(post(port, "short", "", TOOL.as_bytes()).0, "HTTP/1.1 403 Forbidden");
    assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
}

#[test]
fn refuses_web_pages() {
    let (cfg, port, rx) = listener();
    // A page's fetch always carries Origin, even with the right key.
    let page = post(port, &cfg.key, "Origin: https://example.com\r\n", TOOL.as_bytes());
    assert_eq!(page.0, "HTTP/1.1 403 Forbidden");
    let null_origin = post(port, &cfg.key, "Origin: null\r\n", TOOL.as_bytes());
    assert_eq!(null_origin.0, "HTTP/1.1 403 Forbidden");
    // The preflight a page needs before it may send the key header.
    let preflight = format!(
        "OPTIONS {HOOK_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://example.com\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: {KEY_HEADER}\r\n\r\n"
    );
    let (status, reply, _) = send(port, &preflight, b"");
    assert_eq!(status, "HTTP/1.1 403 Forbidden");
    assert!(!reply.to_ascii_lowercase().contains("access-control"));
    // A plain form post has no custom headers, so it has no key.
    let form = format!(
        "POST {HOOK_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://example.com\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n",
        TOOL.len()
    );
    assert_eq!(send(port, &form, TOOL.as_bytes()).0, "HTTP/1.1 403 Forbidden");
    assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
}

#[test]
fn refuses_another_host_name_and_other_paths() {
    let (cfg, port, rx) = listener();
    // DNS rebinding: a page on evil.example resolved to 127.0.0.1.
    let head = format!(
        "POST {HOOK_PATH} HTTP/1.1\r\nHost: evil.example:{port}\r\n{KEY_HEADER}: {}\r\nContent-Length: {}\r\n\r\n",
        cfg.key,
        TOOL.len()
    );
    assert_eq!(send(port, &head, TOOL.as_bytes()).0, "HTTP/1.1 403 Forbidden");
    for path in ["/", "/hook", "/prompt-is-prologue/v1/hook/", "/prompt-is-prologue/v1/hook?x=1"] {
        let head = format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{KEY_HEADER}: {}\r\nContent-Length: {}\r\n\r\n",
            cfg.key,
            TOOL.len()
        );
        assert_eq!(send(port, &head, TOOL.as_bytes()).0, "HTTP/1.1 403 Forbidden", "{path}");
    }
    let get = format!("GET {HOOK_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{KEY_HEADER}: {}\r\n\r\n", cfg.key);
    assert_eq!(send(port, &get, b"").0, "HTTP/1.1 403 Forbidden");
    assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
}

#[test]
fn answers_within_a_few_milliseconds_even_for_a_huge_tool_result() {
    let (cfg, port, rx) = listener();
    let big = "x".repeat(40 * 1024 * 1024);
    let body = format!(
        r#"{{"session_id":"s2","hook_event_name":"PostToolUse","tool_name":"Read","duration_ms":12,"tool_response":{{"content":"{big}"}}}}"#
    );
    let (status, _, ttfb) = post(port, &cfg.key, "", body.as_bytes());
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert!(ttfb < Duration::from_millis(20), "answered after {ttfb:?}");
    let e = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(e.hook_event_name, "PostToolUse");
    assert_eq!(e.duration_ms, Some(12.0));
    println!("40 MB tool result: answered in {ttfb:?}");
}

#[test]
fn answers_quickly_while_the_scene_is_busy() {
    // The scene's side can be slow; Claude's answer must not wait for it.
    let mut cfg = Config::new().unwrap();
    cfg.port = 0;
    let l = start(&cfg, |_| std::thread::sleep(Duration::from_secs(2))).unwrap();
    for _ in 0..3 {
        let (status, _, ttfb) = post(l.port, &cfg.key, "", TOOL.as_bytes());
        assert_eq!(status, "HTTP/1.1 200 OK");
        assert!(ttfb < Duration::from_millis(20), "answered after {ttfb:?}");
    }
}

#[test]
fn reads_chunked_bodies() {
    let (cfg, port, rx) = listener();
    let (a, b) = TOOL.split_at(40);
    let body = format!("{:x}\r\n{a}\r\n{:x}\r\n{b}\r\n0\r\n\r\n", a.len(), b.len());
    let head = format!(
        "POST {HOOK_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{KEY_HEADER}: {}\r\nTransfer-Encoding: chunked\r\n\r\n",
        cfg.key
    );
    assert_eq!(send(port, &head, body.as_bytes()).0, "HTTP/1.1 200 OK");
    let e = rx.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(e.tool_name.as_deref(), Some("Bash"));
}

#[test]
fn moves_to_a_free_port_when_its_own_is_taken() {
    let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let mut cfg = Config::new().unwrap();
    cfg.port = taken.local_addr().unwrap().port();
    let l = start(&cfg, |_| {}).unwrap();
    assert_ne!(l.port, cfg.port);
    assert_eq!(post(l.port, &cfg.key, "", TOOL.as_bytes()).0, "HTTP/1.1 200 OK");
}

#[test]
fn listens_only_on_this_computer() {
    let (_, port, _) = listener();
    // Any address of this machine other than loopback must not connect.
    let others: Vec<_> = std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|u| u.connect("192.0.2.1:9").map(|_| u))
        .and_then(|u| u.local_addr())
        .map(|a| a.ip())
        .into_iter()
        .filter(|ip| !ip.is_loopback() && !ip.is_unspecified())
        .collect();
    for ip in others {
        let r = TcpStream::connect_timeout(&(ip, port).into(), Duration::from_millis(300));
        assert!(r.is_err(), "reachable on {ip}");
    }
}

#[test]
fn filter_keeps_the_fields_each_event_needs() {
    let n = filter(br#"{"session_id":"s","hook_event_name":"Notification","notification_type":"permission_prompt","message":"Claude needs your permission to use Bash on C:\\secret"}"#).unwrap();
    assert_eq!(n.notification_type.as_deref(), Some("permission_prompt"));
    assert_eq!(n.message.as_deref(), Some("permission"));
    let idle = filter(br#"{"session_id":"s","hook_event_name":"Notification","message":"Claude is waiting for your input"}"#).unwrap();
    assert_eq!(idle.message, None);
    let sub = filter(br#"{"session_id":"s","hook_event_name":"PreToolUse","tool_name":"Read","agent_id":"a1","agent_type":"Explore"}"#).unwrap();
    assert_eq!((sub.agent_id.as_deref(), sub.agent_type.as_deref()), (Some("a1"), Some("Explore")));
    let fail = filter(br#"{"session_id":"s","hook_event_name":"PostToolUseFailure","is_interrupt":true,"error":"boom at C:\\x"}"#).unwrap();
    assert_eq!(fail.is_interrupt, Some(true));
    let stop = filter(br#"{"session_id":"s","hook_event_name":"StopFailure","error":{"type":"rate_limit","message":"details"}}"#).unwrap();
    assert_eq!(stop.error.as_deref(), Some("rate_limit"));
    assert!(filter(br#"{"hook_event_name":"Stop"}"#).is_none());
    assert!(filter(b"not json").is_none());
}

#[test]
fn config_is_made_once_and_kept() {
    let dir = std::env::temp_dir().join(format!("prologue-cfg-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let a = Config::load_or_create(&dir).unwrap();
    let b = Config::load_or_create(&dir).unwrap();
    assert_eq!(a, b);
    assert_eq!(a.key.len(), 64);
    assert_eq!(a.port, prologue_listener::DEFAULT_PORT);
    let _ = std::fs::remove_dir_all(&dir);
}
