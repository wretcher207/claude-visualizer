// Live events (phase 2 step 3): what the app's listener hands over must drive
// the world exactly like the demo does, and the demo must step aside for
// real work.

import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { DemoSource } from '../src/demo.js';
import { LiveSource, Sources, normalize, HOOK_EVENT } from '../src/live.js';

// Every moment the world emits, reduced to what the scene and sound see.
function record(world) {
  const out = [];
  world.on((m) => out.push([m.type, m.traveler?.id ?? null, m.sub?.id ?? null, m.category ?? null, m.now]));
  return out;
}

test('cut-down live events drive the world exactly like full demo payloads', () => {
  const full = new World();
  const cut = new World();
  const a = record(full);
  const b = record(cut);
  const demo = new DemoSource({ seed: 207 });
  const live = new LiveSource();
  const end = 3 * 3600 * 1000;
  for (let now = 0; now <= end; now += 250) {
    demo.pump(now, (e) => {
      full.handle(e, now);
      live.push(e); // what the listener would pass on, cut down the same way
    });
    live.pump(now, (e) => cut.handle(e, now));
    full.update(now);
    cut.update(now);
  }
  assert.ok(a.length > 1000, `expected a busy three hours, got ${a.length} moments`);
  assert.deepEqual(b, a);
});

test('only the fields the world reads get through', () => {
  const e = normalize({
    session_id: 's',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'cat secrets' },
    prompt: 'private',
    cwd: '/home/me',
    transcript_path: '/home/me/t.jsonl',
    duration_ms: 12,
    is_interrupt: false,
  });
  assert.deepEqual(e, { session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash', duration_ms: 12, is_interrupt: false });
  assert.equal(normalize({ hook_event_name: 'Stop' }), null);
  assert.equal(normalize(null), null);
  assert.equal(normalize({ session_id: 's', hook_event_name: 'Notification', message: 'waiting for input' }).message, undefined);
  assert.equal(normalize({ session_id: 's', hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' }).message, 'permission');
});

test('connect listens for the app event and feeds the queue', async () => {
  let name = null;
  let handler = null;
  const fakeTauri = { event: { listen: async (n, fn) => { name = n; handler = fn; return () => {}; } } };
  const live = new LiveSource();
  assert.equal(await live.connect(undefined), null, 'no app, no listening');
  await live.connect(fakeTauri);
  assert.equal(name, HOOK_EVENT);
  handler({ payload: { session_id: 'real-1', hook_event_name: 'PreToolUse', tool_name: 'Read' } });
  const got = [];
  live.pump(0, (e) => got.push(e));
  assert.deepEqual(got, [{ session_id: 'real-1', hook_event_name: 'PreToolUse', tool_name: 'Read' }]);
});

function setup(demoOn) {
  const world = new World();
  const live = new LiveSource();
  const sources = new Sources({ world, demo: new DemoSource({ seed: 207 }), live, demoOn });
  const moments = record(world);
  const changes = [];
  sources.onChange = (on) => changes.push(on);
  return { world, live, sources, moments, changes };
}

test('the demo turns itself off when a real session shows up, and its boats sail home', () => {
  const { world, live, sources, changes } = setup(true);
  let now = 0;
  for (; now <= 10 * 60 * 1000; now += 250) {
    sources.pump(now);
    world.update(now);
  }
  const demoBoats = [...world.travelers.keys()];
  assert.ok(demoBoats.length >= 1, 'the demo should have boats out after ten minutes');

  live.push({ session_id: 'real-1', hook_event_name: 'UserPromptSubmit' });
  assert.equal(sources.demoOn, false);
  assert.deepEqual(changes, [false]);
  sources.pump(now);
  assert.deepEqual([...world.travelers.keys()], ['real-1']);

  // No more demo events reach the world afterward.
  for (now += 250; now <= 40 * 60 * 1000; now += 250) {
    sources.pump(now);
    world.update(now);
  }
  for (const id of world.travelers.keys()) assert.ok(!id.startsWith('demo-'), `${id} came back`);
});

test("the demo can't start while a real boat is on the water", () => {
  const { world, live, sources } = setup(false);
  live.push({ session_id: 'real-1', hook_event_name: 'PreToolUse', tool_name: 'Edit' });
  sources.pump(1000);
  assert.equal(sources.demoAvailable(), false);
  assert.equal(sources.setDemo(true, 1000), false);
  assert.equal(sources.demoOn, false);

  // Once the real boat has gone home, the demo can play.
  live.push({ session_id: 'real-1', hook_event_name: 'SessionEnd' });
  sources.pump(2000);
  assert.equal(world.travelers.size, 0);
  assert.equal(sources.setDemo(true, 2000), true);
  let now = 2000;
  for (; now <= 5 * 60 * 1000; now += 250) {
    sources.pump(now);
    world.update(now);
  }
  assert.ok([...world.travelers.keys()].some((id) => id.startsWith('demo-')), 'demo boats should be out');
});

test('the app starts without the demo; the web page starts with it', () => {
  const app = setup(false);
  const page = setup(true);
  for (let now = 0; now <= 5 * 60 * 1000; now += 250) {
    app.sources.pump(now);
    page.sources.pump(now);
  }
  assert.equal(app.world.travelers.size, 0);
  assert.ok(page.world.travelers.size >= 1);
});
