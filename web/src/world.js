// The world: turns raw Claude Code hook events into travelers, subagents,
// energy and the day's progress. It knows nothing about drawing or sound;
// scenes and sound engines listen to its moments and read its state.
//
// Every time value here is "world time" in milliseconds. In live use that is
// the wall clock; in demo mode it runs faster when the demo is sped up.

import { toolCategory, isAskTool, WORK_WEIGHT, ENERGY_IMPULSE } from './events.js';

export const WORLD_DEFAULTS = {
  idleFadeMs: 20 * 60 * 1000,      // a traveler with no activity fades out
  dawnAfterIdleMs: 45 * 60 * 1000, // everyone quiet this long: a new day
  dayWorkTau: 500,                 // work for the day to get ~63% of the way to night
  journeyWorkTau: 220,             // work for a traveler to get ~63% of the way to the horizon
  energyTauMs: 25000,              // how long a burst of activity lingers
  maxTravelers: 8,
  maxSubagents: 4,                 // per traveler, shown; extra ones still count as work
  restFallbackMs: 3 * 60 * 1000,   // if compaction never reports back
  subagentReturnMs: 5000,          // a returning subagent rejoins its traveler
  departedMemoryMs: 24 * 60 * 60 * 1000,
};

// Lateral lanes, filled from the middle outward. Values are fractions of the
// usable screen half-width: 0 is center, -1 is the left edge.
const SLOT_LANES = [0.04, -0.44, 0.46, -0.76, 0.78, -0.22, 0.26, -0.92];

export class World {
  constructor(options = {}) {
    this.cfg = { ...WORLD_DEFAULTS, ...options };
    this.travelers = new Map();
    this.departed = new Map();
    this.listeners = new Set();
    this.energyRaw = 0;
    this.energyAt = 0;
    this.dayWork = 0;
    this.totalWork = 0;
    this.lastEventAt = null;
    this.eventCount = 0;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(moment) {
    for (const fn of this.listeners) {
      try { fn(moment); } catch (err) { console.error('moment listener failed', err); }
    }
  }

  // ---- Energy: a decaying measure of how busy things are ----

  decay(holder, now) {
    const dt = Math.max(0, now - holder.energyAt);
    holder.energyRaw *= Math.exp(-dt / this.cfg.energyTauMs);
    holder.energyAt = now;
  }

  energy(now) {
    this.decay(this, now);
    return 1 - Math.exp(-this.energyRaw);
  }

  travelerEnergy(t, now) {
    this.decay(t, now);
    return 1 - Math.exp(-t.energyRaw * 1.6);
  }

  // 0 is dawn, 1 is deep night. Follows everyone's work since the last dawn.
  daylightTarget() {
    return 1 - Math.exp(-this.dayWork / this.cfg.dayWorkTau);
  }

  // 0 is just setting out, 1 is at the horizon. Follows the traveler's own work.
  journey(t) {
    return 1 - Math.exp(-t.work / this.cfg.journeyWorkTau);
  }

  // ---- Event intake ----

  handle(evt, now) {
    if (!evt || typeof evt !== 'object') return;
    const sid = evt.session_id;
    const name = evt.hook_event_name;
    if (!sid || !name) return;
    this.eventCount++;

    if (name === 'SessionEnd') {
      const t = this.travelers.get(sid);
      if (t) this.depart(t, 'ended', now);
      return;
    }

    let t = this.travelers.get(sid);
    if (!t) t = this.spawn(evt, now);

    t.lastActive = now;
    this.lastEventAt = now;
    if (evt.cwd) t.cwd = evt.cwd;

    switch (name) {
      case 'UserPromptSubmit':
        this.endWaiting(t, now);
        t.turnTools = 0;
        this.emit({ type: 'leg', traveler: t, now });
        break;

      case 'PreToolUse':
        this.onTool(t, evt, now);
        break;

      case 'PostToolUse':
        if (!evt.agent_id) this.endWaiting(t, now);
        break;

      case 'PostToolUseFailure': {
        if (!evt.agent_id) this.endWaiting(t, now);
        const sub = evt.agent_id ? t.subs.get(evt.agent_id) || null : null;
        if (!evt.is_interrupt) this.emit({ type: 'tool:fail', traveler: t, sub, now });
        break;
      }

      case 'PermissionRequest':
      case 'Elicitation':
        this.startWaiting(t, name === 'Elicitation' ? 'question' : 'permission', now);
        break;

      case 'Notification': {
        const kind = evt.notification_type || '';
        const msg = String(evt.message || '').toLowerCase();
        if (kind === 'permission_prompt' || kind === 'elicitation_dialog' || msg.includes('permission')) {
          this.startWaiting(t, 'permission', now);
        }
        break;
      }

      case 'PermissionDenied':
      case 'ElicitationResult':
        this.endWaiting(t, now);
        break;

      case 'SubagentStart':
        if (evt.agent_id) this.ensureSub(t, evt.agent_id, evt.agent_type, now);
        break;

      case 'SubagentStop':
        if (evt.agent_id) this.subReturns(t, evt.agent_id, now);
        break;

      case 'PreCompact':
        this.startRest(t, now);
        break;

      case 'PostCompact':
        this.endRest(t, now);
        break;

      case 'Stop':
        this.endWaiting(t, now);
        this.emit({ type: 'turn:end', traveler: t, tools: t.turnTools, now });
        t.turnTools = 0;
        break;

      case 'StopFailure':
        this.endWaiting(t, now);
        this.emit({ type: 'error', traveler: t, error: evt.error || null, now });
        break;

      default:
        break;
    }
  }

  onTool(t, evt, now) {
    const category = toolCategory(evt.tool_name);
    const fromSub = Boolean(evt.agent_id);
    let sub = null;
    let share = 1;

    if (fromSub) {
      sub = this.ensureSub(t, evt.agent_id, evt.agent_type, now);
      if (sub) sub.lastActive = now;
      share = 0.5;
    } else if (!isAskTool(evt.tool_name)) {
      this.endWaiting(t, now);
    }

    const work = (WORK_WEIGHT[category] || 1) * share;
    t.work += work;
    this.dayWork += work;
    this.totalWork += work;

    const impulse = (ENERGY_IMPULSE[category] || 0.05) * (fromSub ? 0.6 : 1);
    this.decay(this, now);
    this.energyRaw += impulse;
    this.decay(t, now);
    t.energyRaw += impulse;
    if (sub) {
      this.decay(sub, now);
      sub.energyRaw += impulse;
    }

    if (!fromSub) t.turnTools++;
    t.lastToolAt = now;

    this.emit({ type: 'tool', traveler: t, sub, fromSub, category, toolName: evt.tool_name, now });

    if (!fromSub && isAskTool(evt.tool_name)) this.startWaiting(t, 'question', now);
  }

  // ---- Travelers ----

  spawn(evt, now) {
    if (this.travelers.size >= this.cfg.maxTravelers) {
      let oldest = null;
      for (const other of this.travelers.values()) {
        if (!oldest || other.lastActive < oldest.lastActive) oldest = other;
      }
      if (oldest) this.depart(oldest, 'crowded', now);
    }

    const used = new Set();
    for (const other of this.travelers.values()) used.add(other.slot);
    let slot = 0;
    while (used.has(slot)) slot++;

    const memory = this.departed.get(evt.session_id);
    const t = {
      id: evt.session_id,
      slot,
      lane: SLOT_LANES[slot % SLOT_LANES.length],
      seed: hashString(evt.session_id),
      cwd: evt.cwd || null,
      born: now,
      lastActive: now,
      lastToolAt: null,
      work: memory ? memory.work : 0,
      energyRaw: 0,
      energyAt: now,
      turnTools: 0,
      waiting: null,
      waitingSince: null,
      resting: false,
      restSince: null,
      subs: new Map(),
      returning: Boolean(memory),
    };
    this.departed.delete(evt.session_id);
    this.travelers.set(t.id, t);
    this.emit({ type: 'traveler:new', traveler: t, now });
    return t;
  }

  depart(t, reason, now) {
    this.travelers.delete(t.id);
    this.departed.set(t.id, { work: t.work, at: now });
    this.emit({ type: 'traveler:gone', traveler: t, reason, now });
  }

  startWaiting(t, kind, now) {
    if (t.waiting) return;
    t.waiting = kind;
    t.waitingSince = now;
    this.emit({ type: 'waiting:start', traveler: t, kind, now });
  }

  endWaiting(t, now) {
    if (!t.waiting) return;
    const kind = t.waiting;
    t.waiting = null;
    t.waitingSince = null;
    this.emit({ type: 'waiting:end', traveler: t, kind, now });
  }

  startRest(t, now) {
    if (t.resting) return;
    this.endWaiting(t, now);
    t.resting = true;
    t.restSince = now;
    this.emit({ type: 'rest', traveler: t, now });
  }

  endRest(t, now) {
    if (!t.resting) return;
    t.resting = false;
    t.restSince = null;
    this.emit({ type: 'fresh', traveler: t, now });
  }

  // ---- Subagents ----

  ensureSub(t, agentId, agentType, now) {
    const existing = t.subs.get(agentId);
    if (existing) return existing;
    let shown = 0;
    for (const s of t.subs.values()) if (!s.returning) shown++;
    if (shown >= this.cfg.maxSubagents) return null;
    const sub = {
      id: agentId,
      type: agentType || null,
      seed: hashString(agentId),
      born: now,
      lastActive: now,
      energyRaw: 0,
      energyAt: now,
      returning: false,
      returnedAt: null,
    };
    t.subs.set(agentId, sub);
    this.emit({ type: 'subagent:out', traveler: t, sub, now });
    return sub;
  }

  subReturns(t, agentId, now) {
    const sub = t.subs.get(agentId);
    if (!sub || sub.returning) return;
    sub.returning = true;
    sub.returnedAt = now;
    this.emit({ type: 'subagent:back', traveler: t, sub, now });
  }

  // ---- Time passing ----

  // A new day: the work so far stops counting, and the light heads on
  // through the night to dawn.
  newDay(now) {
    this.dayWork = 0;
    this.emit({ type: 'dawn', now });
  }

  update(now) {
    for (const t of [...this.travelers.values()]) {
      if (t.resting && now - t.restSince > this.cfg.restFallbackMs) this.endRest(t, now);
      for (const sub of [...t.subs.values()]) {
        if (sub.returning && now - sub.returnedAt > this.cfg.subagentReturnMs) t.subs.delete(sub.id);
      }
      if (now - t.lastActive > this.cfg.idleFadeMs) this.depart(t, 'idle', now);
    }

    if (this.lastEventAt !== null && this.dayWork > 0 && now - this.lastEventAt > this.cfg.dawnAfterIdleMs) {
      this.newDay(now);
    }

    for (const [id, memory] of this.departed) {
      if (now - memory.at > this.cfg.departedMemoryMs) this.departed.delete(id);
    }
  }
}

export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
