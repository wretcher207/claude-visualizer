// Test sender for the app's listener (phase 2 step 2). Start the app, then:
//
//   node src-tauri/tools/send-test.cjs
//
// It reads the port and key from the app's listener.json, sends a short
// fake session the way Claude Code's HTTP hooks would, checks that requests
// without the key or from a web page are refused, and times the answer to a
// huge tool result. Pass a path to use another listener.json.

const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ID = 'com.deadpixeldesign.promptisprologue';
const HOOK_PATH = '/prompt-is-prologue/v1/hook';
const KEY_HEADER = 'x-prologue-key';

function configPath() {
  if (process.argv[2]) return process.argv[2];
  if (process.platform === 'win32') return path.join(process.env.APPDATA, ID, 'listener.json');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', ID, 'listener.json');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), ID, 'listener.json');
}

function post({ port, headers = {}, body = '' }) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const req = http.request(
      { host: '127.0.0.1', port, path: HOOK_PATH, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } },
      (res) => {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => resolve({ status: res.statusCode, body: text, ms }));
      },
    );
    req.on('error', (err) => resolve({ status: 0, body: String(err.code || err), ms: Number(process.hrtime.bigint() - t0) / 1e6 }));
    req.end(body);
  });
}

// Times the answer the way Claude feels it: from the first byte sent to the
// first byte back, with the body still streaming out behind it.
function postRaw({ port, key, body }) {
  return new Promise((resolve) => {
    const data = Buffer.from(body);
    const sock = net.connect(port, '127.0.0.1', () => {
      const head =
        `POST ${HOOK_PATH} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\n` +
        `${KEY_HEADER}: ${key}\r\nContent-Length: ${data.length}\r\nConnection: close\r\n\r\n`;
      const t0 = process.hrtime.bigint();
      let ms = null;
      let text = '';
      sock.on('data', (d) => {
        if (ms === null) ms = Number(process.hrtime.bigint() - t0) / 1e6;
        text += d;
      });
      sock.on('close', () => resolve({ status: Number(text.split(' ')[1]) || 0, ms }));
      sock.write(head);
      // Hand the body over on the next turn, so the clock measures the app
      // and not node copying 40 MB into the socket.
      setImmediate(() => sock.end(data));
    });
    sock.on('error', () => {});
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const file = configPath();
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Can't read ${file}. Start the app once first.`);
    process.exit(1);
  }
  const { port, key } = cfg;
  const withKey = { [KEY_HEADER]: key };
  let failed = 0;
  const check = (label, ok, detail) => {
    if (!ok) failed++;
    console.log(`${ok ? 'pass' : 'FAIL'}  ${label}  (${detail})`);
  };

  // A short fake session: a prompt, a few tools, a subagent, a stop.
  const sid = `send-test-${Date.now()}`;
  const events = [
    { hook_event_name: 'UserPromptSubmit', prompt: 'a test prompt the app must drop' },
    { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'README.md' } },
    { hook_event_name: 'PostToolUse', tool_name: 'Read', duration_ms: 14, tool_response: { content: 'text' } },
    { hook_event_name: 'PreToolUse', tool_name: 'Grep' },
    { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' },
    { hook_event_name: 'PreToolUse', tool_name: 'Glob', agent_id: 'a1', agent_type: 'Explore' },
    { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'Explore' },
    { hook_event_name: 'PreToolUse', tool_name: 'Edit' },
    { hook_event_name: 'PreToolUse', tool_name: 'Bash' },
    { hook_event_name: 'Stop' },
  ];
  let worst = 0;
  let all200 = true;
  for (const e of events) {
    const r = await post({ port, headers: withKey, body: JSON.stringify({ session_id: sid, cwd: process.cwd(), ...e }) });
    worst = Math.max(worst, r.ms);
    if (r.status !== 200 || r.body !== '') all200 = false;
    await sleep(400);
  }
  check('a fake session is taken', all200, `${events.length} events, slowest answer ${worst.toFixed(1)} ms`);

  const nokey = await post({ port, body: JSON.stringify({ session_id: sid, hook_event_name: 'Stop' }) });
  check('refused without the key', nokey.status === 403, `status ${nokey.status}`);

  const wrong = await post({ port, headers: { [KEY_HEADER]: 'x'.repeat(key.length) }, body: '{}' });
  check('refused with a wrong key', wrong.status === 403, `status ${wrong.status}`);

  const page = await post({ port, headers: { ...withKey, Origin: 'https://example.com' }, body: '{}' });
  check('refused from a web page', page.status === 403, `status ${page.status}`);

  const big = JSON.stringify({
    session_id: sid,
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    duration_ms: 3,
    tool_response: { content: 'x'.repeat(40 * 1024 * 1024) },
  });
  const huge = await postRaw({ port, key, body: big });
  // Node itself spends a good part of this pushing 40 MB at the socket; the
  // listener's own share (well under 1 ms) is measured by its cargo tests.
  check('a 40 MB tool result is answered fast', huge.status === 200 && huge.ms < 50, `status ${huge.status}, ${huge.ms?.toFixed(1)} ms`);

  const end = await post({ port, headers: withKey, body: JSON.stringify({ session_id: sid, hook_event_name: 'SessionEnd' }) });
  check('the session ends', end.status === 200, `status ${end.status}`);

  console.log(failed ? `${failed} failed` : `all passed on port ${port}`);
  process.exit(failed ? 1 : 0);
}

main();
