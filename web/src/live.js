// Live mode: real Claude Code sessions, as the app's listener hands them over
// (src-tauri/listener). The listener already cut each hook event down to the
// fields the world reads, in the same names a real payload uses, so the world
// can't tell live events from the demo's. This side checks them again,
// queues them, and gives them to the world on the same pump as the demo.
//
// `Sources` decides which of the two feeds the world: the demo, or real work.
// Real work always wins. The demo turns itself off when a real session shows
// up, and can't be started while a real boat is on the water.

// The Tauri event the app emits for each kept hook event (src-tauri/src/lib.rs).
export const HOOK_EVENT = 'prologue:hook';

const MAX_QUEUE = 5000;
const STRING_FIELDS = { session_id: 128, hook_event_name: 64, tool_name: 128, agent_id: 128, agent_type: 128, notification_type: 64, error: 64 };

// The same cut the listener makes, so nothing else reaches the world even if
// something other than the listener ever emits the event.
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const evt = {};
  for (const [key, max] of Object.entries(STRING_FIELDS)) {
    const v = raw[key];
    if (typeof v === 'string' && v) evt[key] = v.slice(0, max);
  }
  if (!evt.session_id || !evt.hook_event_name) return null;
  // A Notification's text is only checked for "permission", so that word is
  // all that's kept of it, as the listener does.
  if (typeof raw.message === 'string' && raw.message.toLowerCase().includes('permission')) evt.message = 'permission';
  if (Number.isFinite(raw.duration_ms)) evt.duration_ms = raw.duration_ms;
  if (typeof raw.is_interrupt === 'boolean') evt.is_interrupt = raw.is_interrupt;
  return evt;
}

export class LiveSource {
  constructor() {
    this.queue = [];
    this.ids = new Set();
    this.onSession = null;
    this.dropped = 0;
  }

  // Listen for the app's events. Resolves to an unlisten function, or null
  // when there's no app around (the plain demo page).
  async connect(tauri = globalThis.__TAURI__) {
    if (!tauri?.event?.listen) return null;
    return tauri.event.listen(HOOK_EVENT, (msg) => this.push(msg.payload));
  }

  push(raw) {
    const evt = normalize(raw);
    if (!evt) return;
    if (this.queue.length >= MAX_QUEUE) {
      this.queue.shift();
      this.dropped++;
    }
    this.queue.push(evt);
    if (!this.ids.has(evt.session_id)) {
      this.ids.add(evt.session_id);
      if (this.onSession) this.onSession(evt.session_id);
    }
  }

  // Same shape as DemoSource.pump: everything that has arrived is due now.
  pump(now, emit) {
    const due = this.queue;
    this.queue = [];
    for (const evt of due) emit(evt);
  }

  isLive(id) {
    return this.ids.has(id);
  }
}

export class Sources {
  // `demoOn` is where it starts: on for the web page, off in the app.
  constructor({ world, demo, live, demoOn }) {
    this.world = world;
    this.demo = demo;
    this.live = live;
    this.demoOn = demoOn;
    this.onChange = null;
    this.now = 0;
    live.onSession = () => {
      if (this.demoOn) this.setDemo(false, this.now);
    };
  }

  pump(now) {
    this.now = now;
    const handle = (evt) => this.world.handle(evt, now);
    if (this.demoOn) this.demo.pump(now, handle);
    this.live.pump(now, handle);
  }

  // A real boat is on the water.
  realBoats() {
    for (const id of this.world.travelers.keys()) if (this.live.isLive(id)) return true;
    return false;
  }

  demoAvailable() {
    return !this.realBoats();
  }

  // Returns whether the demo is on afterward.
  setDemo(on, now = this.now) {
    if (on === this.demoOn) return this.demoOn;
    if (on) {
      if (!this.demoAvailable()) return false;
      this.demo.reset(now);
      this.demoOn = true;
    } else {
      this.demoOn = false;
      // The demo's boats sail home into the sun, so fake boats never sit
      // beside real work.
      for (const id of [...this.world.travelers.keys()]) {
        if (!this.live.isLive(id)) this.world.handle({ session_id: id, hook_event_name: 'SessionEnd' }, now);
      }
    }
    if (this.onChange) this.onChange(this.demoOn);
    return this.demoOn;
  }
}
