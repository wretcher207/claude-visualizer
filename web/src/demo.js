// Demo mode: a believable day of Claude Code work, generated ahead of time
// from a fixed seed. Every event has the same shape as a real hook payload,
// so the world cannot tell the difference. Several sessions overlap, some
// call subagents, some wait for permission, some compact, some end and some
// are simply left open.

import { createRng } from './rng.js';

const PROJECTS = ['~/code/harbor-api', '~/code/tide-tables', '~/sites/lantern', '~/code/foghorn', '~/code/driftwood', '~/sites/saltmarsh'];
const FILES = ['src/tides.ts', 'src/routes/charts.ts', 'src/lib/moon.js', 'README.md', 'package.json', 'src/app.css', 'tests/tides.test.ts', 'src/components/Chart.tsx', 'scripts/build.js'];
const PATTERNS = ['TODO', 'export function', 'useEffect', 'fetch\\(', 'class .*Store', 'timezone'];
const GLOBS = ['**/*.ts', 'src/**/*.tsx', '*.md', 'tests/**/*'];
const COMMANDS = ['npm test', 'npm run build', 'git status', 'git diff --stat', 'node scripts/check.js', 'npm run lint'];
const PROMPTS = [
  'the tide chart is off by an hour after the DST change, can you look?',
  'add a small legend under the chart',
  'tighten up the README install section',
  'why is the build so slow now',
  'make the moon phase icons match the new palette',
  'write tests for the harbor endpoints',
];
const AGENT_TYPES = ['Explore', 'general-purpose', 'Plan'];

const DURATION = {
  Read: [40, 120, 400],
  Grep: [120, 300, 1200],
  Glob: [60, 150, 600],
  Edit: [60, 140, 500],
  Write: [80, 200, 600],
  Bash: [700, 4000, 30000],
  WebSearch: [1500, 3000, 7000],
  WebFetch: [900, 2000, 5000],
  TodoWrite: [20, 40, 120],
  AskUserQuestion: [8000, 20000, 60000],
  mcp__github__get_issue: [300, 900, 3000],
};

export class DemoSource {
  constructor({ seed = 207, chunkMs = 4 * 60 * 60 * 1000 } = {}) {
    this.seed = seed;
    this.chunkMs = chunkMs;
    this.reset(0);
  }

  reset(startAt) {
    this.rng = createRng(this.seed);
    this.ids = 0;
    this.sessions = 0;
    this.events = [];
    this.cursor = 0;
    this.builtUntil = startAt;
    this.pendingStarts = [startAt + 1200, startAt + 26000, startAt + 140000];
    this.extend();
  }

  // Emit every event that is due by world time `now`.
  pump(now, emit) {
    if (now > this.builtUntil - 60000) this.extend();
    while (this.cursor < this.events.length && this.events[this.cursor].t <= now) {
      emit(this.events[this.cursor].e);
      this.cursor++;
    }
    if (this.cursor > 5000) {
      this.events = this.events.slice(this.cursor);
      this.cursor = 0;
    }
  }

  extend() {
    const until = this.builtUntil + this.chunkMs;
    const fresh = [];
    while (this.pendingStarts.length && this.pendingStarts[0] < until) {
      const start = this.pendingStarts.shift();
      const end = this.buildSession(fresh, start);
      // Someone opens a new session a few minutes after one wraps up.
      this.pendingStarts.push(end + this.rng.range(60000, 9 * 60000));
      this.pendingStarts.sort((a, b) => a - b);
    }
    fresh.sort((a, b) => a.t - b.t);
    const remaining = this.events.slice(this.cursor);
    this.events = mergeSorted(remaining, fresh);
    this.cursor = 0;
    this.builtUntil = until;
  }

  // ---- One session: a run of turns, then it ends or is left open ----

  buildSession(out, start) {
    const rng = this.rng;
    const n = ++this.sessions;
    const base = {
      session_id: `demo-session-${n}-${Math.floor(rng.next() * 1e9).toString(36)}`,
      transcript_path: '',
      cwd: PROJECTS[(n - 1) % PROJECTS.length],
      permission_mode: 'default',
    };
    const turns = rng.int(6, 22);
    const compactEvery = rng.int(8, 13);
    let sinceCompact = 0;
    let t = start;

    for (let turn = 0; turn < turns; turn++) {
      push(out, t, base, { hook_event_name: 'UserPromptSubmit', prompt: rng.pick(PROMPTS) });
      t += turn === 0 && n === 1 ? 1500 : rng.pause(2000, 5000, 15000);

      // Look around first.
      const reads = rng.int(2, 7);
      for (let i = 0; i < reads; i++) {
        const name = rng.chance(0.08) ? rng.pick(['WebSearch', 'WebFetch', 'mcp__github__get_issue']) : rng.pick(['Read', 'Read', 'Grep', 'Glob', 'Read']);
        t = this.tool(out, t, base, name);
      }

      // Sometimes send helpers out in parallel.
      if (rng.chance(0.18)) t = this.subagents(out, t, base, rng.int(1, 3));

      if (rng.chance(0.3)) t = this.tool(out, t, base, 'TodoWrite');

      // Then change things.
      const edits = rng.int(1, 5);
      for (let i = 0; i < edits; i++) {
        t = this.tool(out, t, base, rng.chance(0.25) ? 'Write' : 'Edit', { permission: rng.chance(0.06) });
      }

      // Then check the work.
      const runs = rng.int(0, 3);
      for (let i = 0; i < runs; i++) {
        const fail = rng.chance(0.16);
        t = this.tool(out, t, base, 'Bash', { permission: rng.chance(0.12), fail });
        if (fail) {
          t = this.tool(out, t, base, 'Read');
          t = this.tool(out, t, base, 'Edit');
        }
      }

      if (rng.chance(0.05)) t = this.tool(out, t, base, 'AskUserQuestion');

      t += rng.pause(600, 2000, 6000);
      if (rng.chance(0.012)) {
        push(out, t, base, { hook_event_name: 'StopFailure', error: 'rate_limit', error_details: 'demo' });
      } else {
        push(out, t, base, { hook_event_name: 'Stop', last_assistant_message: 'Done.' });
      }

      sinceCompact++;
      if (sinceCompact >= compactEvery && turn < turns - 1) {
        sinceCompact = 0;
        t += rng.range(2000, 8000);
        push(out, t, base, { hook_event_name: 'PreCompact', trigger: 'auto' });
        t += rng.range(25000, 60000);
        push(out, t, base, { hook_event_name: 'PostCompact', trigger: 'auto' });
      }

      // The person reads, thinks, types the next prompt.
      t += rng.pause(30000, 170000, 900000);
    }

    if (rng.chance(0.6)) {
      push(out, t, base, { hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
    }
    return t;
  }

  tool(out, t, base, name, opts = {}, agent = null) {
    const rng = this.rng;
    const id = `toolu_demo_${(++this.ids).toString(36)}`;
    const extra = agent ? { agent_id: agent.id, agent_type: agent.type } : {};
    const input = toolInput(rng, name);
    push(out, t, base, { hook_event_name: 'PreToolUse', tool_name: name, tool_input: input, tool_use_id: id, ...extra });

    let at = t;
    if (opts.permission) {
      push(out, at + 40, base, { hook_event_name: 'PermissionRequest', tool_name: name, tool_input: input });
      push(out, at + 80, base, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: `Claude needs your permission to use ${name}` });
      at += rng.pause(3000, 8000, 30000);
    }

    const [min, typical, max] = DURATION[name] || [100, 400, 2000];
    const duration = rng.pause(min, typical, max);
    at += duration;

    if (opts.fail) {
      push(out, at, base, { hook_event_name: 'PostToolUseFailure', tool_name: name, tool_input: input, tool_use_id: id, error: 'Command failed with exit code 1', is_interrupt: false, ...extra });
    } else {
      push(out, at, base, { hook_event_name: 'PostToolUse', tool_name: name, tool_input: input, tool_use_id: id, tool_response: 'ok', duration_ms: Math.round(duration), ...extra });
    }

    // Thinking before the next step.
    return at + rng.pause(2000, 8000, 30000);
  }

  subagents(out, t, base, count) {
    const rng = this.rng;
    const calls = [];
    for (let i = 0; i < count; i++) {
      const id = `toolu_demo_${(++this.ids).toString(36)}`;
      const agent = { id: `agent-${(++this.ids).toString(36)}`, type: rng.pick(AGENT_TYPES) };
      const startAt = t + i * rng.range(150, 600);
      push(out, startAt, base, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: agent.type, description: 'Survey the chart code' }, tool_use_id: id });
      push(out, startAt + 120, base, { hook_event_name: 'SubagentStart', agent_id: agent.id, agent_type: agent.type });

      let at = startAt + rng.range(800, 2500);
      const steps = rng.int(4, 14);
      for (let s = 0; s < steps; s++) {
        const name = rng.pick(['Read', 'Read', 'Grep', 'Glob', 'Bash', 'WebSearch']);
        at = this.tool(out, at, base, name, {}, agent);
      }
      push(out, at, base, { hook_event_name: 'SubagentStop', agent_id: agent.id, agent_type: agent.type, last_assistant_message: 'Found it.' });
      calls.push({ id, end: at, startAt });
    }

    let end = t;
    for (const call of calls) {
      push(out, call.end + 60, base, { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: call.id, tool_response: 'done', duration_ms: Math.round(call.end - call.startAt) });
      end = Math.max(end, call.end + 60);
    }
    return end + rng.pause(800, 2500, 7000);
  }
}

function toolInput(rng, name) {
  switch (name) {
    case 'Read': return { file_path: rng.pick(FILES) };
    case 'Grep': return { pattern: rng.pick(PATTERNS), path: 'src' };
    case 'Glob': return { pattern: rng.pick(GLOBS) };
    case 'Edit': return { file_path: rng.pick(FILES), old_string: '...', new_string: '...' };
    case 'Write': return { file_path: rng.pick(FILES), content: '...' };
    case 'Bash': return { command: rng.pick(COMMANDS) };
    case 'WebSearch': return { query: 'tide prediction harmonic constants' };
    case 'WebFetch': return { url: 'https://example.com/tides' };
    case 'TodoWrite': return { todos: [{ content: 'fix offset', status: 'in_progress' }] };
    case 'AskUserQuestion': return { questions: [{ question: 'Which timezone should charts use?' }] };
    default: return {};
  }
}

function push(out, t, base, fields) {
  out.push({ t: Math.round(t), e: { ...base, ...fields } });
}

function mergeSorted(a, b) {
  const out = new Array(a.length + b.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.length && j < b.length) out[k++] = a[i].t <= b[j].t ? a[i++] : b[j++];
  while (i < a.length) out[k++] = a[i++];
  while (j < b.length) out[k++] = b[j++];
  return out;
}
