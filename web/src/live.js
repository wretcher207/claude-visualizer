// Where the world's events come from. The demo plays a made-up day. In the
// app, Claude Code's own events arrive from the listener
// (src-tauri/src/listener.rs), already trimmed to the fields the world reads,
// so the world takes them exactly like the demo's.
//
// Real work always wins. The first real event turns the demo off: its boats
// sail home into the sun and a new day starts, so the light only ever shows
// real work. The demo can't start while real boats are on the water.

const DEMO_PREFIX = 'demo-'; // every demo session id starts with this (demo.js)

export function isDemoSession(id) {
  return String(id).startsWith(DEMO_PREFIX);
}

export class Sources {
  constructor({ world, demo }) {
    this.world = world;
    this.demo = demo;
    this.demoOn = false;
  }

  // How many real sessions are on the water right now.
  realBoats() {
    let count = 0;
    for (const id of this.world.travelers.keys()) if (!isDemoSession(id)) count++;
    return count;
  }

  playDemo(now) {
    if (this.demoOn || this.realBoats() > 0) return false;
    // A fresh demo day: its boats set out from the sun again, not from where
    // the last demo left them.
    for (const id of [...this.world.departed.keys()]) if (isDemoSession(id)) this.world.departed.delete(id);
    this.demo.reset(now);
    this.demoOn = true;
    return true;
  }

  stopDemo(now) {
    if (!this.demoOn) return false;
    this.demoOn = false;
    for (const t of [...this.world.travelers.values()]) {
      if (isDemoSession(t.id)) this.world.depart(t, 'demo-off', now);
    }
    if (this.world.dayWork > 0) this.world.newDay(now);
    return true;
  }

  // One of Claude Code's own events.
  live(evt, now) {
    this.stopDemo(now);
    this.world.handle(evt, now);
  }

  pump(now) {
    if (this.demoOn) this.demo.pump(now, (evt) => this.world.handle(evt, now));
  }
}

// In the app, calls onEvent with each of Claude's events and returns true.
// On the demo web page there is no app around: it returns false.
export function listenForClaude(onEvent) {
  const events = globalThis.__TAURI__?.event;
  if (!events) return false;
  events.listen('claude-hook', (message) => onEvent(message.payload));
  return true;
}
