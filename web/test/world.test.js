// Run with: node --test web/test
// Zero dependencies: node's own test runner.

import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { DemoSource } from '../src/demo.js';

function runDemo(hours, seed = 207) {
  const world = new World();
  const demo = new DemoSource({ seed });
  const moments = [];
  const counts = {};
  let maxTravelers = 0;
  let lastDay = 0;
  let dayWentBackwards = false;
  world.on((m) => {
    moments.push(m);
    counts[m.type] = (counts[m.type] || 0) + 1;
    if (m.type === 'dawn') lastDay = 0;
  });
  const end = hours * 3600 * 1000;
  for (let now = 0; now <= end; now += 250) {
    demo.pump(now, (e) => world.handle(e, now));
    world.update(now);
    maxTravelers = Math.max(maxTravelers, world.travelers.size);
    const day = world.daylightTarget();
    if (day < lastDay - 1e-9) dayWentBackwards = true;
    lastDay = day;
  }
  return { world, moments, counts, maxTravelers, dayWentBackwards };
}

test('demo is deterministic for a seed', () => {
  const a = [];
  const b = [];
  const da = new DemoSource({ seed: 11 });
  const db = new DemoSource({ seed: 11 });
  da.pump(30 * 60 * 1000, (e) => a.push(e));
  db.pump(30 * 60 * 1000, (e) => b.push(e));
  assert.ok(a.length > 100, `expected a busy half hour, got ${a.length} events`);
  assert.deepEqual(a, b);
});

test('demo never relies on SessionStart', () => {
  const seen = [];
  new DemoSource().pump(2 * 3600 * 1000, (e) => seen.push(e.hook_event_name));
  assert.ok(!seen.includes('SessionStart'));
});

test('a day of demo work exercises every moment and stays in bounds', () => {
  const { counts, maxTravelers, dayWentBackwards, world } = runDemo(6);
  for (const type of ['traveler:new', 'leg', 'tool', 'tool:fail', 'turn:end', 'waiting:start', 'waiting:end', 'subagent:out', 'subagent:back', 'rest', 'fresh', 'traveler:gone']) {
    assert.ok(counts[type] > 0, `no ${type} moments in six hours`);
  }
  assert.ok(maxTravelers >= 2, 'sessions should overlap');
  assert.ok(maxTravelers <= world.cfg.maxTravelers);
  assert.equal(counts['waiting:start'], counts['waiting:end'] + countWaiting(world));
  assert.equal(counts.rest, counts.fresh + countResting(world));
  assert.ok(!dayWentBackwards, 'the day only moves forward between dawns');
});

test('a traveler is born on its first event of any kind', () => {
  const world = new World();
  const born = [];
  world.on((m) => { if (m.type === 'traveler:new') born.push(m.traveler.id); });
  world.handle({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Read' }, 0);
  world.handle({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Read' }, 10);
  assert.deepEqual(born, ['s1']);
});

test('waiting starts on a permission request and ends when work resumes', () => {
  const world = new World();
  const seen = [];
  world.on((m) => seen.push(m.type));
  world.handle({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash' }, 0);
  world.handle({ hook_event_name: 'PermissionRequest', session_id: 's', tool_name: 'Bash' }, 10);
  world.handle({ hook_event_name: 'Notification', session_id: 's', notification_type: 'permission_prompt' }, 20);
  assert.equal(seen.filter((t) => t === 'waiting:start').length, 1);
  world.handle({ hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'Bash' }, 5000);
  assert.ok(seen.includes('waiting:end'));
});

test('a subagent that asked for permission ends the wait when its tool finishes', () => {
  const world = new World();
  const seen = [];
  world.on((m) => seen.push(m.type));
  world.handle({ hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a1' }, 0);
  world.handle({ hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a2' }, 0);
  world.handle({ hook_event_name: 'PermissionRequest', session_id: 's', tool_name: 'Bash', agent_id: 'a1' }, 10);
  world.handle({ hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'Read', agent_id: 'a2' }, 20);
  assert.equal(world.travelers.get('s').waiting, 'permission', 'another subagent finishing changes nothing');
  world.handle({ hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'Bash', agent_id: 'a1' }, 5000);
  assert.equal(world.travelers.get('s').waiting, null);
  assert.ok(seen.includes('waiting:end'));
});

test('an idle traveler fades after twenty minutes and comes back at the same point', () => {
  const world = new World();
  const seen = [];
  world.on((m) => seen.push(m));
  for (let i = 0; i < 50; i++) world.handle({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Edit' }, i * 1000);
  const work = world.travelers.get('s').work;
  world.update(49000 + 19 * 60 * 1000);
  assert.ok(world.travelers.has('s'));
  world.update(49000 + 21 * 60 * 1000);
  assert.ok(!world.travelers.has('s'));
  assert.equal(seen.at(-1).type, 'traveler:gone');
  world.handle({ hook_event_name: 'UserPromptSubmit', session_id: 's' }, 30 * 60 * 1000);
  assert.equal(world.travelers.get('s').work, work);
});

test('dawn comes after everyone has been quiet for a while', () => {
  const world = new World();
  const seen = [];
  world.on((m) => seen.push(m.type));
  for (let i = 0; i < 400; i++) world.handle({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Read' }, i * 500);
  assert.ok(world.daylightTarget() > 0.5);
  world.update(200000 + 44 * 60 * 1000);
  assert.ok(!seen.includes('dawn'));
  world.update(200000 + 46 * 60 * 1000);
  assert.ok(seen.includes('dawn'));
  assert.equal(world.daylightTarget(), 0);
});

test('subagent tool calls move the parent and never start waiting', () => {
  const world = new World();
  const seen = [];
  world.on((m) => seen.push(m.type));
  world.handle({ hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a1', agent_type: 'Explore' }, 0);
  world.handle({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'AskUserQuestion', agent_id: 'a1' }, 10);
  assert.ok(!seen.includes('waiting:start'));
  assert.ok(world.travelers.get('s').work > 0);
  world.handle({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a1' }, 20);
  world.update(20 + 6000);
  assert.equal(world.travelers.get('s').subs.size, 0);
});

function countWaiting(world) {
  let n = 0;
  for (const t of world.travelers.values()) if (t.waiting) n++;
  return n;
}

function countResting(world) {
  let n = 0;
  for (const t of world.travelers.values()) if (t.resting) n++;
  return n;
}
