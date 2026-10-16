// Instruments. Each call plays one note (or one chord) and cleans up after
// itself. Placement comes in as pan (-1..1) and distance (0 near, 1 far):
// far sounds are quieter, darker and wetter, like a light near the horizon.

import { midiToFreq } from './music.js';
import { fadeOut } from './engine.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Soft electric piano: a sine carrier with a decaying FM bite and a short
// sparkle two octaves up.
export function playKeys(engine, {
  midi,
  at,
  velocity = 0.5,
  pan = 0,
  distance = 0,
  decay = 3.2,
  brightness = 0.5,
  bendCents = 0,
  cutoffScale = 1,
  reverb = 0,
  delay = 0,
}) {
  const ctx = engine.ctx;
  if (!Number.isFinite(midi)) return;
  engine.checkNote(midi);
  const f = midiToFreq(midi);
  const t0 = Math.max(at, ctx.currentTime + 0.01);
  const end = t0 + decay * 1.3 + 0.1;

  const car = ctx.createOscillator();
  car.frequency.value = f;
  const mod = ctx.createOscillator();
  mod.frequency.value = f;
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(f * (0.7 + 1.3 * velocity * brightness), t0);
  modGain.gain.setTargetAtTime(f * 0.1, t0 + 0.01, 0.25);
  mod.connect(modGain);
  modGain.connect(car.frequency);

  const spark = ctx.createOscillator();
  spark.frequency.value = f * 4;
  const sparkGain = ctx.createGain();
  sparkGain.gain.setValueAtTime(0, t0);
  sparkGain.gain.linearRampToValueAtTime(0.05 * velocity * brightness, t0 + 0.004);
  sparkGain.gain.setTargetAtTime(0, t0 + 0.004, 0.06);

  if (bendCents) {
    for (const o of [car, mod]) {
      o.detune.setValueAtTime(0, t0 + 0.05);
      o.detune.linearRampToValueAtTime(bendCents, t0 + 0.8);
    }
  }

  const amp = ctx.createGain();
  const peak = 0.2 * velocity * (1 - 0.45 * distance);
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(peak, t0 + 0.006);
  amp.gain.setTargetAtTime(0, t0 + 0.006, decay / 4.5);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = clamp((1500 + 3200 * brightness) * (1 - 0.5 * distance) * cutoffScale, 300, 12000);
  filter.Q.value = 0.4;

  const panner = ctx.createStereoPanner();
  panner.pan.value = clamp(pan, -1, 1);

  car.connect(amp);
  spark.connect(sparkGain);
  sparkGain.connect(amp);
  amp.connect(filter);
  filter.connect(panner);
  const sends = engine.route(panner, {
    dry: 1 - 0.45 * distance,
    reverb: 0.22 + 0.5 * distance + reverb,
    delay: 0.15 + 0.12 * distance + delay,
  });

  const oscs = [car, mod, spark];
  for (const o of oscs) {
    o.start(t0);
    o.stop(end);
  }
  car.onended = () => disconnectAll([panner, ...sends]);

  engine.register({
    end,
    kill(when) {
      fadeOut(amp.gain, when, 0.03);
      for (const o of oscs) {
        try { o.stop(when + 0.2); } catch { /* already stopping */ }
      }
    },
  });
}

// A distant buoy bell: inharmonic partials with a slow warble. Clearly not
// one of the keys, so "Claude is waiting on you" never blends into the music.
export function playBell(engine, { midi, at, velocity = 0.5, pan = 0, distance = 0 }) {
  const ctx = engine.ctx;
  if (!Number.isFinite(midi)) return;
  engine.checkNote(midi);
  const f = midiToFreq(midi);
  const t0 = Math.max(at, ctx.currentTime + 0.01);
  const partials = [
    [1, 1, 7],
    [1.0035, 0.6, 6],
    [2, 0.42, 4.2],
    [2.5, 0.24, 3.2],
    [3, 0.18, 2.6],
    [4.16, 0.09, 1.4],
  ];
  const bus = ctx.createGain();
  bus.gain.value = 0.085 * velocity * (1 - 0.4 * distance);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 4200 * (1 - 0.4 * distance);
  const panner = ctx.createStereoPanner();
  panner.pan.value = clamp(pan, -1, 1);
  bus.connect(filter);
  filter.connect(panner);
  const sends = engine.route(panner, { dry: 0.75, reverb: 0.55 + 0.3 * distance, delay: 0.2 });

  let end = t0;
  const oscs = [];
  const gains = [];
  for (const [ratio, amp, decay] of partials) {
    const o = ctx.createOscillator();
    o.frequency.value = f * ratio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(amp, t0 + 0.008);
    g.gain.setTargetAtTime(0, t0 + 0.008, decay / 4.5);
    o.connect(g);
    g.connect(bus);
    const stopAt = t0 + decay * 1.3;
    o.start(t0);
    o.stop(stopAt);
    end = Math.max(end, stopAt);
    oscs.push(o);
    gains.push(g);
  }
  oscs[0].onended = () => disconnectAll([panner, ...sends]);

  engine.register({
    end,
    kill(when) {
      fadeOut(bus.gain, when, 0.05);
      for (const o of oscs) {
        try { o.stop(when + 0.3); } catch { /* already stopping */ }
      }
    },
  });
}

// An airy, breathy tone that slides gently into pitch. Used for things that
// come and go: subagents heading out, travelers arriving and leaving.
export function playBreath(engine, {
  midi,
  at,
  velocity = 0.4,
  pan = 0,
  distance = 0,
  attack = 0.15,
  release = 2.2,
  glideCents = -35,
  cutoff = 2200,
}) {
  const ctx = engine.ctx;
  if (!Number.isFinite(midi)) return;
  engine.checkNote(midi);
  const f = midiToFreq(midi);
  const t0 = Math.max(at, ctx.currentTime + 0.01);
  const end = t0 + attack + release * 1.4 + 0.1;

  const tri = ctx.createOscillator();
  tri.type = 'triangle';
  tri.frequency.value = f;
  const air = ctx.createOscillator();
  air.frequency.value = f * 2;
  const airGain = ctx.createGain();
  airGain.gain.value = 0.25;
  for (const o of [tri, air]) {
    o.detune.setValueAtTime(glideCents, t0);
    o.detune.linearRampToValueAtTime(0, t0 + attack + 0.05);
  }

  const amp = ctx.createGain();
  const peak = 0.16 * velocity * (1 - 0.4 * distance);
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(peak, t0 + attack);
  amp.gain.setTargetAtTime(0, t0 + attack, release / 4);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff * (1 - 0.4 * distance);
  filter.Q.value = 0.5;
  const panner = ctx.createStereoPanner();
  panner.pan.value = clamp(pan, -1, 1);

  tri.connect(amp);
  air.connect(airGain);
  airGain.connect(amp);
  amp.connect(filter);
  filter.connect(panner);
  const sends = engine.route(panner, { dry: 0.55, reverb: 0.55 + 0.3 * distance, delay: 0.4 });

  for (const o of [tri, air]) {
    o.start(t0);
    o.stop(end);
  }
  tri.onended = () => disconnectAll([panner, ...sends]);

  engine.register({
    end,
    kill(when) {
      fadeOut(amp.gain, when, 0.04);
      for (const o of [tri, air]) {
        try { o.stop(when + 0.25); } catch { /* already stopping */ }
      }
    },
  });
}

// A slow pad chord: each note is a pair of warm, slightly detuned oscillators
// spread left and right, with a sine bass underneath. Returns a handle so the
// caller can release it early.
export function playPadChord(engine, { chord, at, attack, hold, release, level, dest }) {
  const ctx = engine.ctx;
  const wave = warmWave(ctx);
  const t0 = Math.max(at, ctx.currentTime + 0.02);
  const end = t0 + attack + hold + release + 0.2;

  const chordGain = ctx.createGain();
  chordGain.gain.setValueAtTime(0, t0);
  chordGain.gain.linearRampToValueAtTime(level, t0 + attack);
  chordGain.gain.setValueAtTime(level, t0 + attack + hold);
  chordGain.gain.linearRampToValueAtTime(0, t0 + attack + hold + release);
  chordGain.connect(dest);

  const oscs = [];
  for (const midi of chord.pad) {
    engine.checkNote(midi);
    for (const side of [-1, 1]) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = midiToFreq(midi);
      o.detune.value = side * (5 + Math.random() * 3);
      const p = ctx.createStereoPanner();
      p.pan.value = side * 0.55;
      const g = ctx.createGain();
      g.gain.value = 0.5 / chord.pad.length;
      o.connect(g);
      g.connect(p);
      p.connect(chordGain);
      oscs.push(o);
    }
  }
  engine.checkNote(chord.bass);
  const bass = ctx.createOscillator();
  bass.frequency.value = midiToFreq(chord.bass);
  const bassGain = ctx.createGain();
  bassGain.gain.value = 0.32;
  bass.connect(bassGain);
  bassGain.connect(chordGain);
  oscs.push(bass);

  for (const o of oscs) {
    o.start(t0);
    o.stop(end);
  }
  bass.onended = () => disconnectAll([chordGain]);

  return {
    end,
    release(when, seconds) {
      fadeOut(chordGain.gain, when, seconds / 4);
      for (const o of oscs) {
        try { o.stop(when + seconds * 1.5); } catch { /* already stopping */ }
      }
    },
  };
}

// Harmonics falling off a little faster than a sawtooth: warm, not buzzy.
const waveCache = new WeakMap();
function warmWave(ctx) {
  let wave = waveCache.get(ctx);
  if (!wave) {
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let h = 1; h < n; h++) imag[h] = 1 / Math.pow(h, 1.7);
    wave = ctx.createPeriodicWave(real, imag);
    waveCache.set(ctx, wave);
  }
  return wave;
}

function disconnectAll(nodes) {
  for (const n of nodes) {
    try { n.disconnect(); } catch { /* already gone */ }
  }
}
