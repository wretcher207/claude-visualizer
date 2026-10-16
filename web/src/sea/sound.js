// Sea, the sound. Flowing, not rhythmic: a slow pad that swells and fades
// under everything, a faint wash of water that roughens when Claude is busy,
// and soft keys for the work itself. Every note is drawn from the pad chord
// that is sounding at that moment, so the bed and the phrases cannot clash.
// Each traveler's notes come from where its light sits on the water.

import { chordTones } from '../audio/music.js';
import { playKeys, playBell, playBreath, playPadChord } from '../audio/voices.js';
import { createTicker } from '../ticker.js';

// F# major pentatonic chords only: I add9, vi7, ii11 (no third), V sus2 add6.
const CHORDS = [
  { name: 'F#add9', bass: 42, pad: [54, 61, 68, 70] },
  { name: 'D#m7', bass: 39, pad: [51, 58, 61, 66] },
  { name: 'G#m7sus', bass: 44, pad: [56, 63, 66, 70] },
  { name: 'C#sus2/6', bass: 37, pad: [49, 56, 63, 70] },
];

const CHORD_SECONDS = 22;
const PAD_ATTACK = 8;
const PAD_RELEASE = 10;
const PAD_LEVEL = 0.15;
const PAD_BREATH_HZ = 0.057;

// Each traveler gets its own register, so sessions can be told apart by ear.
const REGISTERS = [
  [66, 83], [70, 87], [61, 78], [73, 90], [63, 80], [68, 85], [59, 76], [75, 92],
];

const PHRASE_VELOCITY = { explore: 0.42, change: 0.52, run: 0.4, plan: 0.3, external: 0.42, other: 0.32 };

export class SeaSound {
  constructor(engine, { placement, washOn = true }) {
    this.engine = engine;
    this.placement = placement;
    this.washOn = washOn;
    this.energy = 0;
    this.night = 0;
    this.started = false;
    this.schedule = [];
    this.recent = [];
    this.recentBy = new Map();
    this.phraseFree = new Map();
    this.globalFree = 0;
    this.dipUntil = 0;
    this.noteListeners = new Set();
    this.lfoStart = 0;
  }

  // ---- For the picture ----

  onNote(fn) {
    this.noteListeners.add(fn);
  }

  // Tell listeners a note will sound at audio time `at`.
  emitNote(at, travelerId, strength) {
    const delay = Math.max(0, at - this.engine.now);
    for (const fn of this.noteListeners) fn(delay, travelerId, strength);
  }

  // How full the pad is right now, 0 to 1: its slow breathing plus the swell
  // where one chord blooms into the next. Before sound starts, a stand-in.
  breath() {
    if (!this.started) {
      return 0.5 + 0.5 * Math.sin((performance.now() / 1000) * Math.PI * 2 * PAD_BREATH_HZ);
    }
    const t = this.engine.now;
    const lfo = 0.5 + 0.5 * Math.sin((t - this.lfoStart) * Math.PI * 2 * PAD_BREATH_HZ);
    let sum = 0;
    for (const entry of this.schedule) {
      const attack = entry.attack;
      const holdEnd = entry.at + attack + (CHORD_SECONDS - PAD_ATTACK + 2);
      if (t < entry.at) continue;
      if (t < entry.at + attack) sum += (t - entry.at) / attack;
      else if (t < holdEnd) sum += 1;
      else if (t < holdEnd + PAD_RELEASE) sum += 1 - (t - holdEnd) / PAD_RELEASE;
    }
    const swell = Math.max(0, Math.min(1, (sum - 0.9) * 2));
    return Math.max(0, Math.min(1, 0.75 * lfo + 0.25 * swell));
  }

  start() {
    if (this.started) return;
    this.started = true;
    const engine = this.engine;
    const ctx = engine.ctx;

    // ---- Pad: chords -> lowpass that breathes -> slow swell -> out ----
    this.padIn = ctx.createGain();
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 700;
    this.padFilter.Q.value = 0.6;
    this.padBreath = ctx.createGain();
    this.padBreath.gain.value = 0.8;
    this.padOut = ctx.createGain();
    this.padOut.gain.value = 1;
    this.padIn.connect(this.padFilter);
    this.padFilter.connect(this.padBreath);
    this.padBreath.connect(this.padOut);
    this.padOut.connect(engine.mix);
    const padVerb = ctx.createGain();
    padVerb.gain.value = 0.32;
    this.padOut.connect(padVerb);
    padVerb.connect(engine.reverbSend);
    slowLfo(ctx, 0.043, 180).connect(this.padFilter.frequency);
    this.lfoStart = ctx.currentTime;
    slowLfo(ctx, PAD_BREATH_HZ, 0.2).connect(this.padBreath.gain);

    // ---- Wash: two loops of pink noise, filtered into distant surf ----
    this.washGain = ctx.createGain();
    this.washGain.gain.value = 0;
    const washOut = ctx.createGain();
    washOut.gain.value = this.washOn ? 1 : 0;
    this.washOut = washOut;
    for (const [seed, pan, offset] of [[11, -0.6, 0], [29, 0.6, 1.7]]) {
      const src = ctx.createBufferSource();
      src.buffer = engine.noiseBuffer(6, seed);
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 650;
      band.Q.value = 0.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1700;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      src.connect(band);
      band.connect(lp);
      lp.connect(p);
      p.connect(this.washGain);
      src.start(ctx.currentTime + 0.05, offset);
    }
    this.washGain.connect(washOut);
    washOut.connect(engine.mix);
    const washVerb = ctx.createGain();
    washVerb.gain.value = 0.2;
    washOut.connect(washVerb);
    washVerb.connect(engine.reverbSend);

    this.nextChordAt = ctx.currentTime + 0.1;
    this.chordIndex = 0;
    this.nextSwellAt = ctx.currentTime + 1.5;
    this.ticker = createTicker(400, () => this.tick());
    this.tick();
  }

  stop() {
    this.ticker.stop();
  }

  setWash(on) {
    this.washOn = on;
    if (this.washOut) this.washOut.gain.setTargetAtTime(on ? 1 : 0, this.engine.now, 0.5);
  }

  // Called a few times a second with the world's state.
  setState({ energy, daylight }) {
    this.energy = energy;
    this.night = Math.max(0, (daylight - 0.7) / 0.3);
    if (!this.started) return;
    const now = this.engine.now;
    const dip = now < this.dipUntil ? 0.55 : 1;
    const cutoff = (520 + 1500 * energy) * (1 - 0.25 * this.night) * dip;
    this.padFilter.frequency.setTargetAtTime(cutoff, now, 2.5);
    this.padOut.gain.setTargetAtTime(0.9 + 0.35 * energy, now, 2.5);
  }

  tick() {
    const ctx = this.engine.ctx;
    const now = ctx.currentTime;

    while (this.nextChordAt < now + 3) {
      const chord = CHORDS[this.chordIndex % CHORDS.length];
      const first = this.schedule.length === 0;
      playPadChord(this.engine, {
        chord,
        at: this.nextChordAt,
        attack: first ? 5 : PAD_ATTACK,
        hold: CHORD_SECONDS - PAD_ATTACK + 2,
        release: PAD_RELEASE,
        level: PAD_LEVEL,
        dest: this.padIn,
      });
      this.schedule.push({ at: this.nextChordAt, chord, attack: first ? 5 : PAD_ATTACK });
      if (this.schedule.length > 4) this.schedule.shift();
      this.nextChordAt += CHORD_SECONDS;
      this.chordIndex++;
    }

    // Surf: swells come more often and a little louder on rough water.
    while (this.nextSwellAt < now + 1) {
      const at = this.nextSwellAt;
      const level = 0.05 * (0.5 + 0.9 * this.energy) * (0.7 + 0.6 * Math.random());
      const g = this.washGain.gain;
      g.setTargetAtTime(level, at, 1.1);
      g.setTargetAtTime(level * 0.3, at + 2.6, 1.8);
      this.nextSwellAt += (6 + Math.random() * 5) * (1 - 0.35 * this.energy);
    }
  }

  // The pad chord sounding at a given moment (once it has begun to bloom).
  chordAt(time) {
    let current = this.schedule[0] ? this.schedule[0].chord : CHORDS[0];
    for (const entry of this.schedule) if (entry.at + 3 <= time) current = entry.chord;
    return current;
  }

  // ---- Responding to the world ----

  onMoment(m) {
    if (!this.started) return;
    const t = this.engine.now + 0.03;
    switch (m.type) {
      case 'tool': this.toolPhrase(m, t); break;
      case 'tool:fail': this.sigh(m, t); break;
      case 'leg': this.leg(m, t); break;
      case 'turn:end': if (m.tools >= 3) this.cadence(m, t); break;
      case 'subagent:out': this.subagentOut(m, t); break;
      case 'subagent:back': this.subagentBack(m, t); break;
      case 'rest': this.exhale(m, t); break;
      case 'fresh': this.freshStart(m, t); break;
      case 'error': this.stumble(m, t); break;
      case 'traveler:new': this.arrival(m, t); break;
      case 'traveler:gone': this.departure(m, t); break;
      case 'dawn': this.sunrise(t); break;
      default: break;
    }
  }

  // "Claude is waiting on you": a buoy bell, two tolls, falling a fourth.
  toll(traveler) {
    if (!this.started) return;
    const t = this.engine.now + 0.03;
    const place = this.placement(traveler);
    playBell(this.engine, { midi: 78, at: t, velocity: 0.75, pan: place.pan, distance: place.distance * 0.6 });
    playBell(this.engine, { midi: 73, at: t + 1.5, velocity: 0.55, pan: place.pan, distance: place.distance * 0.6 });
  }

  toolPhrase(m, t) {
    const traveler = m.traveler;
    const place = this.placement(traveler);
    const chord = this.chordAt(t);
    const [lo, hi] = REGISTERS[traveler.slot % REGISTERS.length];
    const busy = this.density(traveler.id, t);

    // A subagent's work: a tiny high glint near its traveler.
    if (m.fromSub) {
      if (busy >= 6 && Math.random() < 0.6) return;
      const pool = chordTones(chord, Math.min(lo + 12, 86), Math.min(hi + 7, 96));
      const start = this.claimSlot(traveler.id, t, 0.1);
      if (start === null) return;
      playKeys(this.engine, {
        midi: pick(pool),
        at: start,
        velocity: 0.15 + 0.08 * Math.random(),
        pan: place.pan + (m.sub && m.sub.seed > 0.5 ? 0.18 : -0.18),
        distance: Math.min(1, place.distance + 0.15),
        decay: 1.8,
        brightness: 0.35,
        delay: 0.12,
      });
      this.noteOn(traveler.id, start);
      this.emitNote(start, traveler.id, 0.2);
      return;
    }

    const category = m.category;
    if (category === 'ask' || category === 'delegate') return;
    if (this.globalDensity(t) > 14 && Math.random() < 0.5) return;
    if (busy >= 10 && Math.random() < 0.5) return;

    const pool = chordTones(chord, lo, hi);
    let shape;
    let spacing;
    let decay = 3.2;
    let brightness = 0.4 + 0.3 * this.energy;
    switch (category) {
      case 'explore': {
        const count = randInt(1, 3);
        const i0 = randInt(0, Math.max(0, Math.floor(pool.length * 0.6) - 1));
        shape = range(count).map((k) => pool[Math.min(pool.length - 1, i0 + k)]);
        spacing = 0.17 + Math.random() * 0.09;
        break;
      }
      case 'change': {
        const count = randInt(2, 3);
        const i0 = randInt(Math.floor(pool.length * 0.4), pool.length - 1);
        shape = range(count).map((k) => pool[Math.max(0, i0 - k)]);
        spacing = 0.22 + Math.random() * 0.08;
        brightness += 0.08;
        break;
      }
      case 'run': {
        const i0 = randInt(0, Math.max(0, pool.length - 3));
        shape = [pool[i0], pool[Math.min(pool.length - 1, i0 + 2)]];
        spacing = 0.22;
        decay = 1.7;
        brightness -= 0.1;
        break;
      }
      case 'plan':
        shape = [pool[randInt(Math.floor(pool.length * 0.6), pool.length - 1)]];
        spacing = 0;
        break;
      default:
        shape = [pick(pool)];
        spacing = 0;
        brightness += category === 'external' ? 0.2 : 0;
        break;
    }
    if (busy >= 6) shape = shape.slice(0, 1);

    const start = this.claimSlot(traveler.id, t, spacing * shape.length + 0.08);
    if (start === null) return;
    const velocity = (PHRASE_VELOCITY[category] || 0.35) * (1 - 0.3 * this.energy) * (busy >= 6 ? 0.75 : 1) * (1 - 0.15 * this.night);
    shape.forEach((midi, k) => {
      const at = start + k * spacing + (Math.random() - 0.5) * 0.02;
      playKeys(this.engine, {
        midi,
        at,
        velocity: velocity * (category === 'change' ? 1 - k * 0.12 : 0.9 + k * 0.08),
        pan: place.pan,
        distance: place.distance,
        decay: decay + Math.random() * 0.8,
        brightness: brightness * (1 - 0.3 * this.night),
        reverb: 0.08 * this.night,
      });
      this.noteOn(traveler.id, at);
      this.emitNote(at, traveler.id, 0.5);
    });
  }

  sigh(m, t) {
    const place = this.placement(m.traveler);
    const [lo] = REGISTERS[m.traveler.slot % REGISTERS.length];
    const pool = chordTones(this.chordAt(t), lo - 5, lo + 7);
    const start = this.claimSlot(m.traveler.id, t, 0.3);
    if (start === null) return;
    playKeys(this.engine, {
      midi: pool[0], at: start, velocity: 0.3, pan: place.pan, distance: place.distance,
      decay: 1.5, brightness: 0.2, bendCents: -35, cutoffScale: 0.5,
    });
  }

  leg(m, t) {
    const place = this.placement(m.traveler);
    const chord = this.chordAt(t);
    playKeys(this.engine, {
      midi: chord.bass + 24, at: t + 0.05, velocity: 0.28, pan: place.pan, distance: place.distance,
      decay: 5, brightness: 0.25, reverb: 0.15,
    });
    this.emitNote(t + 0.05, m.traveler.id, 0.4);
  }

  cadence(m, t) {
    const place = this.placement(m.traveler);
    const root = this.chordAt(t).bass + 24;
    const start = this.claimSlot(m.traveler.id, t + 0.2, 0.9);
    if (start === null) return;
    playKeys(this.engine, { midi: root + 7, at: start, velocity: 0.3, pan: place.pan, distance: place.distance, decay: 4.5, brightness: 0.35 });
    playKeys(this.engine, { midi: root + 12, at: start + 0.42, velocity: 0.27, pan: place.pan, distance: place.distance, decay: 5.5, brightness: 0.32 });
    this.emitNote(start, m.traveler.id, 0.5);
    this.emitNote(start + 0.42, m.traveler.id, 0.6);
  }

  subagentOut(m, t) {
    const place = this.placement(m.traveler);
    const [lo, hi] = REGISTERS[m.traveler.slot % REGISTERS.length];
    const pool = chordTones(this.chordAt(t), Math.min(lo + 10, 84), Math.min(hi + 10, 94));
    const i0 = randInt(0, Math.max(0, pool.length - 3));
    const side = m.sub && m.sub.seed > 0.5 ? 0.25 : -0.25;
    for (let k = 0; k < 3; k++) {
      playBreath(this.engine, {
        midi: pool[Math.min(pool.length - 1, i0 + k)], at: t + k * 0.18, velocity: 0.28,
        pan: place.pan + side * (k + 1) / 3, distance: place.distance, attack: 0.08, release: 2.4, glideCents: -50,
      });
    }
  }

  subagentBack(m, t) {
    const place = this.placement(m.traveler);
    const [lo, hi] = REGISTERS[m.traveler.slot % REGISTERS.length];
    const pool = chordTones(this.chordAt(t), Math.min(lo + 8, 84), Math.min(hi + 6, 94));
    const i0 = randInt(1, Math.max(1, pool.length - 1));
    const side = m.sub && m.sub.seed > 0.5 ? 0.25 : -0.25;
    for (let k = 0; k < 2; k++) {
      playBreath(this.engine, {
        midi: pool[Math.max(0, i0 - k)], at: t + k * 0.24, velocity: 0.22,
        pan: place.pan + side * (1 - k / 2), distance: place.distance, attack: 0.1, release: 2.2, glideCents: 30,
      });
    }
  }

  // Compaction: the traveler rests. A long, low exhale and the pad dims.
  exhale(m, t) {
    const place = this.placement(m.traveler);
    const chord = this.chordAt(t);
    this.dipUntil = t + 10;
    this.setState({ energy: this.energy, daylight: this.night * 0.3 + 0.7 });
    playBreath(this.engine, { midi: chord.bass + 12, at: t, velocity: 0.55, pan: place.pan * 0.5, distance: place.distance, attack: 2.2, release: 7, glideCents: 0, cutoff: 700 });
    playBreath(this.engine, { midi: chord.bass + 19, at: t + 0.4, velocity: 0.4, pan: place.pan * 0.5, distance: place.distance, attack: 2.6, release: 7, glideCents: 0, cutoff: 800 });
    const g = this.washGain.gain;
    g.setTargetAtTime(0.06, t + 0.5, 1.4);
    g.setTargetAtTime(0.015, t + 4, 2.2);
  }

  // After compaction: a fresh traveler sets out from the same spot.
  freshStart(m, t) {
    const place = this.placement(m.traveler);
    const [lo, hi] = REGISTERS[m.traveler.slot % REGISTERS.length];
    const pool = chordTones(this.chordAt(t), lo, hi);
    for (let k = 0; k < 3; k++) {
      playKeys(this.engine, {
        midi: pool[Math.min(pool.length - 1, k * 2)], at: t + 0.1 + k * 0.32, velocity: 0.36,
        pan: place.pan, distance: place.distance, decay: 4, brightness: 0.45,
      });
    }
  }

  stumble(m, t) {
    const place = this.placement(m.traveler);
    const root = this.chordAt(t).bass + 12;
    playKeys(this.engine, { midi: root, at: t, velocity: 0.3, pan: place.pan, distance: place.distance, decay: 2, brightness: 0.15, cutoffScale: 0.4 });
    playKeys(this.engine, { midi: root + 7, at: t + 0.18, velocity: 0.24, pan: place.pan, distance: place.distance, decay: 2, brightness: 0.15, cutoffScale: 0.4 });
  }

  arrival(m, t) {
    const place = this.placement(m.traveler);
    const [lo] = REGISTERS[m.traveler.slot % REGISTERS.length];
    const pool = chordTones(this.chordAt(t), lo - 5, lo + 9);
    for (let k = 0; k < 3; k++) {
      playBreath(this.engine, {
        midi: pool[Math.min(pool.length - 1, k * 2)], at: t + k * 0.35, velocity: 0.34,
        pan: place.pan, distance: place.distance, attack: 0.9, release: 4, glideCents: -20,
      });
    }
    playKeys(this.engine, {
      midi: pool[pool.length - 1], at: t + 1.2, velocity: 0.3, pan: place.pan, distance: place.distance, decay: 4.5, brightness: 0.4,
    });
  }

  departure(m, t) {
    const place = this.placement(m.traveler);
    const [lo, hi] = REGISTERS[m.traveler.slot % REGISTERS.length];
    const pool = chordTones(this.chordAt(t), lo, hi);
    for (let k = 0; k < 2; k++) {
      playBreath(this.engine, {
        midi: pool[Math.max(0, pool.length - 2 - k * 2)], at: t + k * 0.5, velocity: 0.2,
        pan: place.pan, distance: 1, attack: 0.6, release: 5, glideCents: 0,
      });
    }
  }

  // A new day: a warm swell of the home chord.
  sunrise(t) {
    [66, 73, 80, 82].forEach((midi, k) => {
      playBreath(this.engine, { midi, at: t + k * 0.6, velocity: 0.24, pan: (k - 1.5) * 0.3, distance: 0.3, attack: 4, release: 9, glideCents: 0, cutoff: 1800 });
    });
  }

  // ---- Keeping it from getting crowded ----

  claimSlot(id, t, length) {
    const start = Math.max(t, this.phraseFree.get(id) || 0, this.globalFree);
    if (start - t > 0.8) return null;
    this.phraseFree.set(id, start + length);
    this.globalFree = start + 0.06;
    return start;
  }

  noteOn(id, at) {
    this.recent.push(at);
    let list = this.recentBy.get(id);
    if (!list) this.recentBy.set(id, (list = []));
    list.push(at);
  }

  density(id, t) {
    const list = this.recentBy.get(id);
    if (!list) return 0;
    while (list.length && list[0] < t - 3) list.shift();
    return list.length;
  }

  globalDensity(t) {
    while (this.recent.length && this.recent[0] < t - 2) this.recent.shift();
    return this.recent.length;
  }
}

function slowLfo(ctx, rate, depth) {
  const osc = ctx.createOscillator();
  osc.frequency.value = rate;
  const g = ctx.createGain();
  g.gain.value = depth;
  osc.connect(g);
  osc.start();
  return g;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}
