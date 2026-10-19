// Prompt Is Prologue: boot, clocks and wiring.
//
// Three clocks run here:
//  - world time: what the world and the demo use. Runs faster when the demo
//    is sped up. Advanced by a timer, so it keeps going when the window is
//    hidden and the music keeps playing.
//  - audio time: the AudioContext clock. All notes are scheduled on it.
//  - frame time: drawing only. Stops completely when the window is hidden.

import { World } from './world.js';
import { DemoSource } from './demo.js';
import { AudioEngine } from './audio/engine.js';
import { SeaSound } from './sea/sound.js';
import { createSeaScene, seaPlacement } from './sea/scene.js';
import { createUi } from './ui.js';
import { createTicker } from './ticker.js';
import { Sources, listenForClaude } from './live.js';
import { showConnection } from './connect.js';

const PUMP_MS = 50;
const TOLL_EVERY_MS = 18000;
const DAWN_HOLD = 0.08; // a day younger than this still looks like dawn

const world = new World();
const demo = new DemoSource({ seed: 207 });
const sources = new Sources({ world, demo });
const engine = new AudioEngine();
const canvas = document.getElementById('scene');

const state = {
  started: false,
  speed: 1,
  worldNow: 0,
  lastPump: performance.now(),
  phase: 0,          // shown time of day: 0 dawn, 1 night, up to 1.25 on the way back to dawn
  dawning: false,
  energy: 0,
  dayOverride: null,
  energyOverride: null,
};

// Where a traveler sits, shared by sound and picture so they always agree.
function placement(traveler) {
  return seaPlacement(world.journey(traveler), traveler.lane);
}

const sound = new SeaSound(engine, { placement });
const scene = createSeaScene(canvas, { world, placement });

// The picture moves with the music: the sun breathes with the pad, and the
// sun and each boat pulse when that boat's notes sound.
scene.setBreath(() => sound.breath());
sound.onNote((delay, travelerId, strength) => scene.notePulse(delay, travelerId, strength));

// ---- Waiting on you: one clock for the bell and the ripples ----

// Next ring time (real clock) for each boat that's waiting. The pump rings
// them, so the bell keeps time when the window is hidden.
const tolls = new Map();

function ring(traveler) {
  sound.toll(traveler);
  scene.toll(traveler);
  tolls.set(traveler.id, performance.now() + TOLL_EVERY_MS);
}

world.on((m) => {
  if (m.type === 'waiting:start') ring(m.traveler);
  if (m.type === 'waiting:end' || m.type === 'traveler:gone' || m.type === 'rest') tolls.delete(m.traveler.id);
  // A new day rolls on through the night to dawn, unless the light hasn't
  // left dawn yet; then it just starts over where it is.
  if (m.type === 'dawn' && state.phase > DAWN_HOLD) state.dawning = true;
  sound.onMoment(m);
  scene.onMoment(m);
});

// ---- The pump: world time, events, smoothed state ----

function pump() {
  const real = performance.now();
  const dt = Math.min(1000, real - state.lastPump);
  state.lastPump = real;

  if (state.started) {
    state.worldNow += dt * (sources.demoOn ? state.speed : 1);
    sources.pump(state.worldNow);
    world.update(state.worldNow);
  }

  for (const [id, at] of tolls) if (real >= at) ring(world.travelers.get(id));

  // The shown time of day trails the world's target so the light changes slowly.
  const target = world.daylightTarget();
  if (state.dawning) {
    state.phase += (dt / 1000) * (0.35 / 60);
    if (state.phase >= 1.25) {
      state.phase = 0;
      state.dawning = false;
    }
  } else {
    const k = 1 - Math.exp(-dt / 20000);
    state.phase += (target - state.phase) * k;
  }

  const energy = world.energy(state.worldNow);
  state.energy += (energy - state.energy) * (1 - Math.exp(-dt / 1500));

  sound.setState({ energy: shownEnergy(), daylight: nightPhase(shownPhase()) });
  for (const fn of pumpHooks) fn();
}

function shownPhase() {
  return state.dayOverride !== null ? state.dayOverride : state.phase;
}

function shownEnergy() {
  return state.energyOverride !== null ? state.energyOverride : state.energy;
}

// How far into night we are, folding the trip back to dawn into the scale.
function nightPhase(phase) {
  return phase <= 1 ? phase : 1 - (phase - 1) / 0.25;
}

const pumpHooks = new Set();
const pumpTicker = createTicker(PUMP_MS, pump);

// ---- Drawing ----

const frameStats = { fps: 0, cpuMs: 0, frames: 0, lastFpsAt: performance.now() };

function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) return;
  const t0 = performance.now();
  const drew = scene.render({
    now,
    phase: shownPhase(),
    energy: shownEnergy(),
    worldNow: state.worldNow,
  });
  if (!drew) return;
  frameStats.cpuMs = frameStats.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  frameStats.frames++;
  if (now - frameStats.lastFpsAt > 1000) {
    frameStats.fps = (frameStats.frames * 1000) / (now - frameStats.lastFpsAt);
    frameStats.frames = 0;
    frameStats.lastFpsAt = now;
  }
}

requestAnimationFrame(frame);

// ---- Start, controls, debug ----

// The demo page's "Click to begin": the world starts with the demo playing.
async function begin() {
  startWorld();
  playDemo();
  await startSound();
}

function startWorld() {
  if (state.started) return;
  state.started = true;
  state.lastPump = performance.now();
}

async function startSound() {
  if (engine.ready) return;
  await engine.start();
  sound.start();
}

// The demo plays only while no real boats are on the water (see live.js).
function playDemo() {
  if (!sources.playDemo(state.worldNow)) return false;
  ui.setLive(false);
  startSound();
  return true;
}

// URL options for testing and stills:
//   ?autostart   run the world and picture without a click (sound still needs one)
//   ?day=0.66    hold the time of day (0 dawn, 0.33 day, 0.66 dusk, 1 night)
//   ?energy=0.5  hold how busy the water is (0 to 1)
//   ?speed=16    demo speed
const params = new URLSearchParams(location.search);
if (params.has('autostart')) {
  startWorld();
  sources.playDemo(state.worldNow);
}
if (params.has('day')) state.dayOverride = clampParam(params.get('day'), 0, 1.25);
if (params.has('energy')) state.energyOverride = clampParam(params.get('energy'), 0, 1);

function clampParam(value, lo, hi) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
}

const ui = createUi({ engine, sound, state, begin, frameStats, world, scene, shownPhase, shownEnergy });
if (params.has('speed')) ui.setSpeed(Number(params.get('speed')) || 1);

// In the app, Claude's own events arrive from the listener and real work
// always wins over the demo (see live.js). There's no start screen: the sea is
// there from the start, and boats and music arrive with Claude's first session.
const inApp = listenForClaude((evt) => {
  sources.live(evt, state.worldNow);
  ui.setLive(true);
  startSound();
});
if (inApp) {
  startWorld();
  ui.openLive();
  showConnection();
}

window.prologue = { world, demo, sources, playDemo, engine, sound, scene, state, ui, frameStats, pumpHooks, pumpTicker };
