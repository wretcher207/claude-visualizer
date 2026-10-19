// Test sender for the app's listener. Sends events to the running app the way
// Claude Code's hooks do (one POST per event, a JSON body, the key in a header,
// a keep-alive Node client like Claude's axios) and reports what came back.
// It reads the port and key from the app's listener.json.
//
//   node src-tauri/tools/send-test-events.mjs session [minutes] [speed]
//       replays the start of a demo day as live events (default 6 minutes at 8x)
//   node src-tauri/tools/send-test-events.mjs refusals
//       requests the app must turn away: no key, a wrong key, a web page,
//       a wrong host, path or method
//   node src-tauri/tools/send-test-events.mjs timing [megabytes]
//       how fast the answer comes back for small events and for a huge tool
//       result (default 16 MB)
//   node src-tauri/tools/send-test-events.mjs private
//       one of each event with a marker in every private field (prompt, path,
//       tool input and output, messages); none of it should reach the page

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DemoSource } from '../../web/src/demo.js';

const IDENTIFIER = 'com.deadpixeldesign.promptisprologue';
const HOOK_PATH = '/prompt-is-prologue/hook';
const MARKER = 'PRIVATE-MARKER';

function configDir() {
  if (process.platform === 'win32') return join(process.env.APPDATA, IDENTIFIER);
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', IDENTIFIER);
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), IDENTIFIER);
}

const { port, key } = JSON.parse(readFileSync(join(configDir(), 'listener.json'), 'utf8'));
const agent = new http.Agent({ keepAlive: true });

function post(body, { headers = {}, path = HOOK_PATH, method = 'POST', withKey = true, chunked = false } = {}) {
  const data = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const started = process.hrtime.bigint();
  const ms = () => Number(process.hrtime.bigint() - started) / 1e6;
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      agent,
      headers: {
        'Content-Type': 'application/json',
        ...(chunked ? {} : { 'Content-Length': data.length }),
        ...(withKey ? { 'X-Prologue-Key': key } : {}),
        ...headers,
      },
    }, (res) => {
      let bodyBytes = 0;
      res.on('data', (c) => { bodyBytes += c.length; });
      res.on('end', () => resolve({ status: res.statusCode, bodyBytes, ms: ms() }));
    });
    req.on('error', (err) => resolve({ status: `connection ${err.code || err.message}`, bodyBytes: 0, ms: ms() }));
    req.setTimeout(3000, () => req.destroy(new Error('timed out')));
    if (chunked) {
      req.write(data.subarray(0, 10));
      req.end(data.subarray(10));
    } else {
      req.end(data);
    }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fmt = (n) => n.toFixed(2);

async function session(minutes = 6, speed = 8) {
  const demo = new DemoSource({ seed: 2026 });
  const until = minutes * 60000;
  const events = demo.events.filter((x) => x.t <= until);
  const ids = new Set();
  const times = [];
  const statuses = {};
  const t0 = Date.now();
  for (const { t, e } of events) {
    const wait = t0 + t / speed - Date.now();
    if (wait > 0) await sleep(wait);
    const evt = { ...e, session_id: e.session_id.replace(/^demo-/, 'test-') };
    ids.add(evt.session_id);
    const r = await post(evt);
    times.push(r.ms);
    statuses[r.status] = (statuses[r.status] || 0) + 1;
  }
  console.log(`sent ${events.length} events from ${ids.size} sessions over ${minutes} demo minutes at ${speed}x`);
  console.log(`answers: ${JSON.stringify(statuses)}`);
  console.log(`answer time: median ${fmt(median(times))} ms, max ${fmt(Math.max(...times))} ms`);
}

async function refusals() {
  const evt = { session_id: 'test-refused', hook_event_name: 'UserPromptSubmit', prompt: 'should never arrive' };
  const cases = [
    ['no key', post(evt, { withKey: false })],
    ['wrong key', post(evt, { headers: { 'X-Prologue-Key': 'f'.repeat(64) } })],
    ['from a web page (Origin)', post(evt, { headers: { Origin: 'https://example.com' } })],
    ['from a web page (Sec-Fetch-Mode)', post(evt, { headers: { 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Site': 'cross-site' } })],
    ['CORS preflight', post('', { method: 'OPTIONS', withKey: false, headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-prologue-key' } })],
    ['wrong host (DNS rebinding)', post(evt, { headers: { Host: `attacker.example:${port}` } })],
    ['wrong path', post(evt, { path: '/' })],
    ['GET', post('', { method: 'GET' })],
    ['chunked body', post(evt, { chunked: true })],
  ];
  let refused = 0;
  for (const [name, pending] of cases) {
    const r = await pending;
    const ok = r.status !== 200 && r.bodyBytes === 0;
    if (ok) refused++;
    console.log(`${ok ? 'refused ' : 'ACCEPTED'}  ${name}: ${r.status}`);
  }
  const good = await post({ ...evt, session_id: 'test-accepted', prompt: 'the one that should arrive' });
  console.log(`accepted  with the key: ${good.status}, body ${good.bodyBytes} bytes`);
  await post({ session_id: 'test-accepted', hook_event_name: 'SessionEnd', reason: 'other' });
  console.log(`${refused} of ${cases.length} refused`);
}

async function timing(megabytes = 16) {
  const small = { session_id: 'test-timing', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'notes.txt' } };
  const smallTimes = [];
  for (let i = 0; i < 40; i++) smallTimes.push((await post(small)).ms);
  console.log(`small event (${JSON.stringify(small).length} bytes): median ${fmt(median(smallTimes))} ms, max ${fmt(Math.max(...smallTimes))} ms over 40`);

  for (const mb of [1, megabytes]) {
    const huge = JSON.stringify({
      session_id: 'test-timing',
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: 'big.txt' },
      tool_response: { type: 'text', file: { filePath: 'big.txt', content: 'x'.repeat(mb * 1024 * 1024) } },
      duration_ms: 12,
    });
    const times = [];
    let status = null;
    for (let i = 0; i < 8; i++) {
      const r = await post(huge);
      status = r.status;
      times.push(r.ms);
    }
    console.log(`${mb} MB tool result: ${status}, median ${fmt(median(times))} ms, max ${fmt(Math.max(...times))} ms over 8`);
  }
  await post({ session_id: 'test-timing', hook_event_name: 'SessionEnd', reason: 'other' });
}

async function sendPrivate() {
  const base = {
    session_id: 'test-private',
    transcript_path: `C:/Users/someone/.claude/projects/${MARKER}.jsonl`,
    cwd: `C:/Users/someone/${MARKER}`,
    permission_mode: 'default',
  };
  const events = [
    { hook_event_name: 'UserPromptSubmit', prompt: `${MARKER} my private prompt` },
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `echo ${MARKER}` }, tool_use_id: 'toolu_1' },
    { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: `echo ${MARKER}` } },
    { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: `Claude needs your permission ${MARKER}` },
    { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: `echo ${MARKER}` }, error: `exit 1: ${MARKER}`, is_interrupt: false },
    { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: MARKER }, tool_response: { file: { content: MARKER } }, duration_ms: 3 },
    { hook_event_name: 'SubagentStart', agent_id: 'agent-private', agent_type: 'Explore' },
    { hook_event_name: 'SubagentStop', agent_id: 'agent-private', agent_type: 'Explore', last_assistant_message: MARKER, agent_transcript_path: MARKER },
    { hook_event_name: 'PreCompact', trigger: 'manual', custom_instructions: MARKER },
    { hook_event_name: 'PostCompact', trigger: 'manual', compact_summary: MARKER },
    { hook_event_name: 'Stop', last_assistant_message: MARKER, stop_hook_active: false },
    { hook_event_name: 'StopFailure', error: 'rate_limit', error_details: MARKER, last_assistant_message: MARKER },
    { hook_event_name: 'SessionEnd', reason: 'other' },
  ];
  const statuses = [];
  for (const e of events) statuses.push((await post({ ...base, ...e })).status);
  console.log(`sent ${events.length} events carrying "${MARKER}": ${statuses.join(' ')}`);
}

const [cmd = 'session', ...args] = process.argv.slice(2);
const nums = args.map(Number);
if (cmd === 'session') await session(nums[0] || undefined, nums[1] || undefined);
else if (cmd === 'refusals') await refusals();
else if (cmd === 'timing') await timing(nums[0] || undefined);
else if (cmd === 'private') await sendPrivate();
else console.log('commands: session [minutes] [speed] | refusals | timing [megabytes] | private');
agent.destroy();
