// Run with: node --test web/test
// Live events: what the app's listener passes on, and the rules between the
// demo and real work.

import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { DemoSource } from '../src/demo.js';
import { Sources, isDemoSession, listenForClaude } from '../src/live.js';

// What the app's listener passes on: the fields of HookEvent in
// src-tauri/src/listener.rs, codes only for the last four, and a permission
// notification's message reduced to its type. Keep this in step with it.
const KEPT = ['session_id', 'hook_event_name', 'tool_name', 'agent_id', 'agent_type', 'duration_ms', 'is_interrupt', 'notification_type', 'error', 'trigger', 'reason'];
const CODES = ['notification_type', 'error', 'trigger', 'reason'];

function throughListener(evt) {
  const out = {};
  for (const key of KEPT) if (evt[key] !== undefined) out[key] = evt[key];
  for (const key of CODES) if (out[key] !== undefined && !/^[a-z0-9_]{1,64}$/.test(out[key])) delete out[key];
  if (evt.hook_event_name === 'Notification' && String(evt.message || '').toLowerCase().includes('permission')) {
    out.notification_type = 'permission_prompt';
  }
  return JSON.parse(JSON.stringify(out));
}

function describe(m) {
  return [m.type, m.traveler?.id, m.sub?.id, m.kind, m.reason, m.toolName, m.category, m.error, m.tools].join('|');
}

function playDay(transform, hours = 6) {
  const world = new World();
  const demo = new DemoSource({ seed: 207 });
  const moments = [];
  world.on((m) => moments.push(describe(m)));
  for (let now = 0; now <= hours * 3600 * 1000; now += 250) {
    demo.pump(now, (e) => world.handle(transform(e), now));
    world.update(now);
  }
  return { moments, world };
}

test('the world needs nothing the listener drops', () => {
  const raw = playDay((e) => e);
  const live = playDay(throughListener);
  assert.ok(raw.moments.length > 1000, `a full day of moments (${raw.moments.length})`);
  assert.deepEqual(live.moments, raw.moments);
  assert.equal(live.world.totalWork, raw.world.totalWork);
});

function demoRunning(minutes) {
  const world = new World();
  const demo = new DemoSource({ seed: 207 });
  const sources = new Sources({ world, demo });
  const moments = [];
  world.on((m) => moments.push(m));
  assert.equal(sources.playDemo(0), true);
  let now = 0;
  for (; now <= minutes * 60000; now += 250) {
    sources.pump(now);
    world.update(now);
  }
  return { world, demo, sources, moments, now };
}

test('the first real event turns the demo off and starts a new day', () => {
  const { world, sources, moments, now } = demoRunning(40);
  const demoBoats = [...world.travelers.keys()];
  assert.ok(demoBoats.length > 0 && demoBoats.every(isDemoSession), 'demo boats on the water');
  assert.ok(world.dayWork > 0, 'the demo moved the day along');

  sources.live({ session_id: 'real-1', hook_event_name: 'UserPromptSubmit' }, now);

  assert.equal(sources.demoOn, false);
  assert.deepEqual([...world.travelers.keys()], ['real-1']);
  const gone = moments.filter((m) => m.type === 'traveler:gone' && m.now === now);
  assert.deepEqual(gone.map((m) => m.traveler.id).sort(), demoBoats.sort());
  assert.ok(gone.every((m) => m.reason === 'demo-off'));
  const order = moments.filter((m) => m.now === now).map((m) => m.type);
  assert.ok(order.indexOf('dawn') > order.lastIndexOf('traveler:gone'), 'the day starts over after the demo boats leave');
  assert.ok(order.indexOf('traveler:new') > order.indexOf('dawn'), 'and the real boat sets out at dawn');
  assert.equal(world.dayWork, 0);

  // The demo stays off: no more of its events reach the world.
  for (let t = now; t <= now + 60 * 60000; t += 250) sources.pump(t);
  assert.ok([...world.travelers.keys()].every((id) => !isDemoSession(id)));
});

test('no demo while real boats are on the water', () => {
  const world = new World();
  const sources = new Sources({ world, demo: new DemoSource({ seed: 207 }) });

  sources.live({ session_id: 'real-1', hook_event_name: 'PreToolUse', tool_name: 'Read' }, 0);
  assert.equal(sources.realBoats(), 1);
  assert.equal(sources.playDemo(1000), false);

  sources.live({ session_id: 'real-1', hook_event_name: 'SessionEnd' }, 2000);
  assert.equal(sources.realBoats(), 0);
  assert.equal(sources.playDemo(3000), true);
});

test('a quiet real boat that fades away frees the demo', () => {
  const world = new World();
  const sources = new Sources({ world, demo: new DemoSource({ seed: 207 }) });
  sources.live({ session_id: 'real-1', hook_event_name: 'Stop' }, 0);
  world.update(19 * 60000);
  assert.equal(sources.playDemo(19 * 60000), false);
  world.update(21 * 60000);
  assert.equal(sources.playDemo(21 * 60000), true);
});

test('a demo played again sets out from the sun again', () => {
  const { world, sources, now } = demoRunning(30);
  sources.live({ session_id: 'real-1', hook_event_name: 'SessionEnd' }, now);
  assert.equal(sources.realBoats(), 0);

  assert.equal(sources.playDemo(now + 1000), true);
  const born = [];
  world.on((m) => { if (m.type === 'traveler:new') born.push(m.traveler); });
  for (let t = now + 1000; t <= now + 5 * 60000; t += 250) sources.pump(t);
  assert.ok(born.length > 0);
  assert.ok(born.every((t) => !t.returning && t.work < 30), 'fresh boats, not the last demo carrying on');
});

test('the demo page never hears from Claude', () => {
  assert.equal(listenForClaude(() => assert.fail('no events without the app')), false);
});
