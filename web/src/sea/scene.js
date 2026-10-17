// Sea, the picture, as a screen-printed poster: flat inks in stepped bands,
// a big sun with stepped halo rings sitting on the sea, water as flowing
// stripes, and the sun's reflection as a column that breaks into bars.
//
// Every Claude session is a paper boat born inside the sun. The sun pulses,
// the boat unfolds as a silhouette against it, then sails out toward you
// along its own lane, taking on color as it leaves the light. The more work
// a session does, the closer it comes. When a session ends it sails back into
// the sun. Subagents shoot up from their boat as streaks of light, hang in
// the sky as small stars while they work, and streak home when done.
//
// Alive: the sun breathes with the pad and pulses with notes, busy stretches
// rake light streaks across the sky, thin ISO50-style shapes drift, the
// colors slowly drift, and soft light leaks roll across the print.

import { paletteAt } from './palette.js';

const MAX_BOATS = 8;
const MAX_STREAKS = 12;
const MAX_SHAPES = 7;
const MAX_RIPPLES = 6;
const HORIZON = 0.44;       // horizon height, fraction of the screen from the bottom
const CAMF = 1.35;          // camera height times focal length, for the water's perspective
const Y_NEAR = 0.3;         // how far below the horizon the closest boats sail
const SPREAD = 0.75;        // how wide the lanes fan out from the sun
const BOAT_MIN = 0.032;     // boat height in the sun, as a fraction of the screen
const BOAT_MAX = 0.13;      // boat height when closest
const FPS_CAP = 30;
const MAX_RENDER_WIDTH = 1920;

// Where a session's sound sits, matching where its boat sits.
// Boats are born spread across the sun's face and fan out sideways sooner
// than they come forward, so sessions that left the sun around the same
// time don't sail on top of each other.
export function seaPlacement(journey, lane) {
  return { pan: lane * SPREAD * (0.25 + 0.75 * Math.pow(Math.max(0, journey), 0.55)), distance: 1 - journey };
}

function boatLayout(f, lane, aspect) {
  const g = Math.pow(Math.max(0, f), 1.15);
  const gx = Math.pow(Math.max(0, f), 0.55);
  return {
    x: aspect * (0.5 + lane * SPREAD * 0.5 * (0.25 + 0.75 * gx)),
    y: HORIZON - Y_NEAR * g,
    scale: BOAT_MIN + (BOAT_MAX - BOAT_MIN) * Math.pow(Math.max(0, f), 1.25),
  };
}

const SHAPES = [
  { type: 1, rx: 0.13, ry: 0.8, size: 0.05, rot: 0.2, spin: 0.02, seed: 1.3 },
  { type: 2, rx: 0.85, ry: 0.86, size: 0.035, rot: 0.3, spin: -0.03, seed: 0.5 },
  { type: 0, rx: 0.79, ry: 0.63, size: 0.055, rot: 0, spin: 0, seed: 2.1 },
  { type: 3, rx: 0.23, ry: 0.58, size: 0.018, rot: 0.4, spin: 0.025, seed: 4.2 },
  { type: 0, rx: 0.08, ry: 0.66, size: 0.03, rot: 0, spin: 0, seed: 3.6 },
  { type: 4, rx: 0.63, ry: 0.93, size: 0.09, rot: -0.08, spin: 0, seed: 5.1 },
  { type: 4, rx: 0.34, ry: 0.72, size: 0.06, rot: 0.05, spin: 0, seed: 6.2 },
];

export function createSeaScene(canvas, { world, placement }) {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  });
  let program = gl ? buildProgram(gl) : null;
  if (!program) return createFallback(canvas, { world });

  let u = locate(gl, program);
  const quad = gl.createBuffer();
  const fillQuad = () => {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  };
  fillQuad();
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => {
    program = buildProgram(gl);
    u = locate(gl, program);
    fillQuad();
  });

  const boats = new Map();
  const streaks = [];
  const ripples = [];
  const pulses = [];
  const boatA = new Float32Array(MAX_BOATS * 4);
  const boatB = new Float32Array(MAX_BOATS * 4);
  const boatC = new Float32Array(MAX_BOATS * 4);
  const streakA = new Float32Array(MAX_STREAKS * 4);
  const streakB = new Float32Array(MAX_STREAKS * 4);
  const shapeA = new Float32Array(MAX_SHAPES * 4);
  const shapeB = new Float32Array(MAX_SHAPES * 4);
  const rippleData = new Float32Array(MAX_RIPPLES * 4);
  const leakData = new Float32Array(8);
  const t0 = performance.now();
  let breathFn = () => 0.5 + 0.5 * Math.sin(((performance.now() - t0) / 1000) * Math.PI * 2 * 0.057);
  let lastFrame = -1e9;
  let width = 0;
  let height = 0;
  let aspect = 1;
  let clock = 0;
  let flow = 0;
  let rough = 0;
  let sunPulse = 0;
  let shapePulse = 0;
  let streakDebt = 0;
  let burstAt = -100;
  let streaksSeen = 0;
  // The first shapes sit where they always have; their lives are staggered so
  // they change one at a time, the first after about five minutes.
  const shapes = SHAPES.map((s, i) => ({ ...s, born: -8, life: 300 + i * 75 + Math.random() * 60 }));
  // Dials for the "alive" layers, so notes like "more leak" are a one-line change.
  const tune = { leak: 3.2, hue: 0.12, breath: 1 };

  // ---- Boats ----

  function boatFor(traveler) {
    let b = boats.get(traveler.id);
    if (!b) {
      b = {
        id: traveler.id,
        traveler,
        seed: traveler.seed,
        born: clock,
        f: 0,
        departing: false,
        departedAt: null,
        alpha: 1,
        unfold: 0,
        fold: 0,
        foldTarget: 1,
        lit: 0,
        flash: 0,
        pulse: 0,
        shake: 0,
        hop: 0,
        subs: new Map(),
        x: aspect * 0.5,
        y: HORIZON,
        scale: BOAT_MIN,
        tilt: 0,
      };
      boats.set(traveler.id, b);
      sunPulse = 1;
      burstAt = clock;
      addRipple(aspect * 0.5, HORIZON - 0.004, 0.05);
    }
    b.traveler = traveler;
    return b;
  }

  function addRipple(x, y, scale) {
    ripples.push({ x, y, t0: clock, scale });
    while (ripples.length > MAX_RIPPLES) ripples.shift();
  }

  function apexOf(b) {
    return { x: b.x, y: b.y + b.scale * (0.38 + 0.7 * b.fold) };
  }

  function onMoment(m) {
    if (!m.traveler) return;
    // Only a new traveler makes a boat. A goodbye or a toll for a boat that
    // was never drawn would otherwise fire a sun burst for nothing.
    const b = m.type === 'traveler:new' ? boatFor(m.traveler) : boats.get(m.traveler.id);
    if (!b) return;
    b.traveler = m.traveler;
    switch (m.type) {
      case 'traveler:new':
        if (b.departing) {
          b.departing = false;
          b.departedAt = null;
          b.alpha = 1;
        }
        break;
      case 'traveler:gone':
        b.departing = true;
        break;
      case 'tool':
        if (m.sub) {
          const s = b.subs.get(m.sub.id);
          if (s) s.pulse = Math.min(1.4, s.pulse + 0.6);
        }
        break;
      case 'tool:fail':
      case 'error':
        b.shake = 1;
        break;
      case 'fresh':
        b.flash = 1;
        b.hop = 1;
        addRipple(b.x, b.y, b.scale);
        break;
      case 'subagent:out': {
        const seed = m.sub.seed;
        const apex = apexOf(b);
        b.subs.set(m.sub.id, {
          id: m.sub.id,
          side: seed > 0.5 ? 1 : -1,
          reachX: 0.05 + 0.09 * fract(seed * 7.13),
          reachY: 0.14 + 0.24 * fract(seed * 3.71),
          phase: 'launch',
          t0: clock,
          from: apex,
          head: apex,
          tail: apex,
          pulse: 0.6,
        });
        break;
      }
      case 'subagent:back': {
        const s = b.subs.get(m.sub.id);
        if (s && s.phase !== 'return') {
          s.phase = 'return';
          s.t0 = clock;
          s.from = { ...s.head };
        }
        break;
      }
      default:
        break;
    }
  }

  function toll(traveler) {
    const b = boats.get(traveler.id);
    if (!b) return;
    b.flash = 1;
    addRipple(b.x, b.y, b.scale);
  }

  // A note sounded (or is about to): the sun and the boat answer it.
  function notePulse(delaySeconds, travelerId, strength = 0.5) {
    pulses.push({ due: clock + Math.max(0, delaySeconds), id: travelerId, strength });
  }

  function updateBoats(dt, worldNow, pal) {
    const ease = (tau) => 1 - Math.exp(-dt / tau);
    for (const b of [...boats.values()]) {
      const tr = b.traveler;
      const live = !b.departing && world.travelers.get(b.id) === tr;
      if (!live) b.departing = true;
      const age = clock - b.born;

      // Birth: the sun pulses, the boat unfolds against it, then sails out.
      b.unfold = b.departedAt === null ? easeOutBack(clamp01((age - 0.35) / 0.95)) : b.unfold;
      const sailUp = easeOutBack(clamp01((age - 0.9) / 0.9));
      b.foldTarget = live && tr.resting ? 0.18 : 1;
      b.fold += (b.foldTarget * sailUp - b.fold) * ease(b.foldTarget < 1 ? 1.2 : 0.35);

      const target = b.departing ? 0 : age < 1.8 ? 0 : world.journey(tr);
      b.f += (target - b.f) * ease(b.departing ? 2.2 : 5);
      if (b.departing && b.f < 0.03) {
        if (b.departedAt === null) {
          b.departedAt = clock;
          sunPulse = Math.max(sunPulse, 0.8);
          burstAt = clock;
        }
        const k = clamp01((clock - b.departedAt) / 0.7);
        b.unfold = 1 - k;
        b.alpha = 1 - k;
        if (k >= 1) {
          boats.delete(b.id);
          continue;
        }
      }

      b.flash *= Math.exp(-dt / 1.0);
      b.pulse *= Math.exp(-dt / 0.45);
      b.shake *= Math.exp(-dt / 0.4);
      b.hop *= Math.exp(-dt / 0.5);

      const lay = boatLayout(b.f, tr.lane, aspect);
      const bob = Math.sin(clock * 1.25 + b.seed * 20) * lay.scale * 0.03;
      b.x = lay.x + Math.sin(clock * 55) * lay.scale * 0.05 * b.shake;
      b.y = lay.y + bob + lay.scale * 0.12 * b.hop;
      b.scale = lay.scale;
      let tilt = Math.sin(clock * 1.05 + b.seed * 13) * 0.05 * (0.4 + rough);
      if (live && tr.waiting) tilt += Math.sin(clock * 2.4) * 0.07;
      b.tilt = tilt;

      const energy = live ? world.travelerEnergy(tr, worldNow) : 0;
      b.lit = smooth01(0.02, 0.22, b.f) * (b.fold < 0.5 ? 0.8 : 1);
      b.glow = Math.min(1.5, pal.lantern * (0.55 + 0.3 * energy) + 0.7 * b.flash + 0.35 * b.pulse);

      updateSubs(b, dt);
    }
  }

  function updateSubs(b, dt) {
    const apex = apexOf(b);
    for (const s of [...b.subs.values()]) {
      s.pulse *= Math.exp(-dt / 0.5);
      const sky = {
        x: b.x + s.side * s.reachX * aspect * 0.5,
        y: Math.min(0.97, HORIZON + s.reachY + 0.25 * b.scale),
      };
      if (b.departing) s.phase = 'return';
      if (s.phase === 'launch') {
        const k = clamp01((clock - s.t0) / 0.9);
        s.head = lerp2(s.from, sky, easeOut(k));
        s.tail = lerp2(s.from, sky, easeOut(Math.max(0, k - 0.35)));
        s.intensity = 1;
        if (k >= 1) s.phase = 'hover';
      } else if (s.phase === 'hover') {
        const wx = Math.sin(clock * 0.5 + s.side * 3 + s.reachX * 40) * 0.008;
        const wy = Math.cos(clock * 0.42 + s.reachY * 30) * 0.006;
        s.head = { x: sky.x + wx, y: sky.y + wy };
        s.tail = { x: s.head.x, y: s.head.y - 0.012 - 0.025 * s.pulse };
        s.intensity = 0.55 + 0.45 * Math.min(1, s.pulse);
      } else {
        const k = clamp01((clock - s.t0) / 0.7);
        s.head = lerp2(s.from, apex, easeIn(k));
        s.tail = lerp2(s.from, apex, easeIn(Math.max(0, k - 0.3)));
        s.intensity = 0.9;
        if (k >= 1) {
          b.subs.delete(s.id);
          b.pulse = Math.min(1, b.pulse + 0.6);
        }
      }
    }
  }

  // Streaks rake across the sky, radiating from up-left: now and then and
  // faint when things are calm, often and brighter in busy stretches.
  function updateStreaks(dt) {
    streakDebt += dt * (0.12 + Math.max(0, rough - 0.2) * 3);
    while (streakDebt >= 1) {
      streakDebt -= 1;
      const start = { x: aspect * (0.1 + 0.9 * Math.random()), y: HORIZON + 0.15 + (0.98 - HORIZON - 0.15) * Math.random() };
      const radiant = { x: -0.15 * aspect, y: 1.35 };
      const dx = start.x - radiant.x;
      const dy = start.y - radiant.y;
      const len = Math.hypot(dx, dy);
      const peak = 0.3 + 0.4 * clamp01((rough - 0.15) / 0.5);
      streaksSeen++;
      streaks.push({ start, dir: { x: dx / len, y: dy / len }, len: 0.12 + 0.18 * Math.random(), speed: 0.35 + 0.25 * Math.random(), age: 0, life: 1.8, peak });
    }
    for (let i = streaks.length - 1; i >= 0; i--) {
      const s = streaks[i];
      s.age += dt;
      if (s.age > s.life) streaks.splice(i, 1);
    }
  }

  function pack(pal) {
    // Boats, nearest drawn last.
    const ordered = [...boats.values()].sort((a, b) => a.f - b.f).slice(-MAX_BOATS);
    boatA.fill(0);
    boatB.fill(0);
    boatC.fill(0);
    ordered.forEach((b, i) => {
      boatA.set([b.x, b.y, b.scale, b.tilt], i * 4);
      boatB.set([b.fold, b.lit, b.glow, Math.max(0.001, b.unfold)], i * 4);
      boatC.set([b.alpha, 0, 0, 0], i * 4);
    });

    // Streaks: subagents first, then the busy ones.
    streakA.fill(0);
    streakB.fill(0);
    let n = 0;
    for (const b of ordered) {
      for (const s of b.subs.values()) {
        if (n >= MAX_STREAKS) break;
        streakA.set([s.head.x, s.head.y, s.tail.x, s.tail.y], n * 4);
        const arms = s.phase === 'hover' ? 5 + 5 * Math.min(1, s.pulse) : 3;
        streakB.set([s.intensity * b.alpha, 2.2, 0.85 * s.intensity * b.alpha, arms], n * 4);
        n++;
      }
    }
    for (const s of streaks) {
      if (n >= MAX_STREAKS) break;
      const head = { x: s.start.x + s.dir.x * s.speed * s.age, y: s.start.y + s.dir.y * s.speed * s.age };
      const l = s.len * Math.min(1, s.age * 2.5);
      streakA.set([head.x, head.y, head.x - s.dir.x * l, head.y - s.dir.y * l], n * 4);
      streakB.set([Math.sin((Math.PI * s.age) / s.life) * s.peak, 1.4, 0, 0], n * 4);
      n++;
    }

    // Floating shapes wander slowly; now and then one fades out and comes
    // back somewhere else as a different shape.
    shapes.forEach((s, i) => {
      const age = clock - s.born;
      if (age > s.life) {
        shapes[i] = respawnShape(clock);
        return;
      }
      const fade = clamp01(age / 8) * clamp01((s.life - age) / 8);
      const x = aspect * (s.rx + Math.sin(clock * 0.011 + s.seed) * 0.06 + Math.sin(clock * 0.029 + s.seed * 2.3) * 0.02);
      const y = s.ry + Math.cos(clock * 0.009 + s.seed * 1.3) * 0.035 + Math.sin(clock * 0.023 + s.seed) * 0.012;
      shapeA.set([x, y, s.size, s.rot + s.spin * clock], i * 4);
      shapeB.set([s.type, Math.min(0.75, 0.16 + 0.22 * rough + 0.3 * shapePulse) * fade, 0, 0], i * 4);
    });

    // Ripples.
    rippleData.fill(0);
    ripples.forEach((r, i) => rippleData.set([r.x, r.y, clock - r.t0, r.scale], i * 4));

    // Light leaks, slowly wandering.
    const lk = pal.leakStrength * tune.leak;
    leakData.set([
      aspect * (0.22 + 0.22 * Math.sin(clock * 0.013)), 0.76 + 0.14 * Math.sin(clock * 0.017), 0.7, lk * (0.6 + 0.4 * Math.sin(clock * 0.05)),
      aspect * (0.84 + 0.14 * Math.sin(clock * 0.011 + 2)), 0.3 + 0.2 * Math.sin(clock * 0.009 + 1), 0.55, lk * (0.6 + 0.4 * Math.sin(clock * 0.043 + 1.7)),
    ]);
    return { boatCount: ordered.length, streakCount: n };
  }

  // ---- Frame ----

  function resize() {
    const cssW = canvas.clientWidth || innerWidth;
    const cssH = canvas.clientHeight || innerHeight;
    const s = Math.min(1, MAX_RENDER_WIDTH / cssW);
    const w = Math.max(2, Math.round(cssW * s));
    const h = Math.max(2, Math.round(cssH * s));
    if (w !== width || h !== height) {
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    aspect = width / height;
  }

  function render({ now, phase, energy, worldNow }) {
    if (now - lastFrame < 1000 / FPS_CAP - 2) return false;
    const dt = Math.min(0.1, Math.max(0.001, (now - lastFrame) / 1000));
    lastFrame = now;
    clock = (now - t0) / 1000;
    resize();

    const pal = paletteAt(phase);
    rough += (Math.min(1, energy * 1.3) - rough) * (1 - Math.exp(-dt / 2));
    flow += dt * (0.35 + 1.4 * rough);
    if (flow > 1e5) flow -= 1e5;

    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      if (p.due > clock) continue;
      pulses.splice(i, 1);
      sunPulse = Math.min(1, sunPulse + 0.12 * p.strength);
      shapePulse = Math.min(1, shapePulse + 0.25 * p.strength);
      const b = boats.get(p.id);
      if (b) b.pulse = Math.min(1, b.pulse + p.strength);
    }
    sunPulse *= Math.exp(-dt / 0.7);
    shapePulse *= Math.exp(-dt / 0.8);
    for (let i = ripples.length - 1; i >= 0; i--) if (clock - ripples[i].t0 > 4) ripples.splice(i, 1);

    updateBoats(dt, worldNow, pal);
    updateStreaks(dt);
    const counts = pack(pal);
    const breath = clamp01(breathFn()) * tune.breath;

    gl.useProgram(program);
    gl.uniform2f(u.uRes, width, height);
    gl.uniform1f(u.uAspect, aspect);
    gl.uniform1f(u.uTime, clock);
    gl.uniform1f(u.uHorizon, HORIZON);
    gl.uniform1f(u.uCamF, CAMF);
    gl.uniform1f(u.uFlow, flow);
    gl.uniform1f(u.uRough, rough);
    gl.uniform1f(u.uHue, tune.hue * Math.sin((clock * Math.PI * 2) / 240));
    gl.uniform1f(u.uMoon, pal.moon);
    gl.uniform1f(u.uStars, pal.stars);
    for (const name of ['skyH', 'skyL', 'skyHi', 'skyZ', 'sun', 'halo', 'wFar', 'wMid', 'wDeep', 'crest', 'reflect', 'paperL', 'paperS', 'sil', 'glow', 'line', 'leak', 'star']) {
      gl.uniform3fv(u['c_' + name], pal[name]);
    }
    gl.uniform4f(u.uSunGeo, aspect * 0.5, HORIZON + pal.sunLift, pal.sunRadius, breath);
    gl.uniform1f(u.uSunPulse, sunPulse);
    gl.uniform1f(u.uBurst, clock - burstAt);
    gl.uniform4fv(u.uLeaks, leakData);
    gl.uniform1i(u.uBoatCount, counts.boatCount);
    gl.uniform4fv(u.uBoatA, boatA);
    gl.uniform4fv(u.uBoatB, boatB);
    gl.uniform4fv(u.uBoatC, boatC);
    gl.uniform1i(u.uStreakCount, counts.streakCount);
    gl.uniform4fv(u.uStreakA, streakA);
    gl.uniform4fv(u.uStreakB, streakB);
    gl.uniform4fv(u.uShapeA, shapeA);
    gl.uniform4fv(u.uShapeB, shapeB);
    gl.uniform4fv(u.uRipple, rippleData);

    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(u.aPos);
    gl.vertexAttribPointer(u.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  return {
    render,
    onMoment,
    toll,
    notePulse,
    setBreath(fn) {
      breathFn = fn;
    },
    tune,
    describe: () => `webgl ${width}x${height}, ${boats.size} boats, ${streaksSeen} streaks so far, ${FPS_CAP} fps cap`,
  };
}

// A new floating shape somewhere in the sky, clear of the sun.
function respawnShape(now) {
  const type = Math.floor(Math.random() * 5);
  let rx;
  let ry;
  do {
    rx = 0.06 + 0.88 * Math.random();
    ry = HORIZON + 0.14 + (0.95 - HORIZON - 0.14) * Math.random();
  } while (Math.abs(rx - 0.5) < 0.2 && ry < HORIZON + 0.32);
  const size = type === 4 ? 0.05 + 0.05 * Math.random() : 0.018 + 0.04 * Math.random();
  return {
    type,
    rx,
    ry,
    size,
    rot: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.06,
    seed: Math.random() * 10,
    born: now,
    life: 360 + Math.random() * 360,
  };
}

// ---- Small helpers ----

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function smooth01(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeIn(t) {
  return t * t * t;
}

function easeOutBack(t) {
  const c = 1.6;
  return t <= 0 ? 0 : t >= 1 ? 1 : 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

function lerp2(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function fract(v) {
  return v - Math.floor(v);
}

// ---- GL plumbing ----

const COLOR_UNIFORMS = ['skyH', 'skyL', 'skyHi', 'skyZ', 'sun', 'halo', 'wFar', 'wMid', 'wDeep', 'crest', 'reflect', 'paperL', 'paperS', 'sil', 'glow', 'line', 'leak', 'star'];

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

#define MAXB ${MAX_BOATS}
#define MAXS ${MAX_STREAKS}
#define MAXF ${MAX_SHAPES}
#define MAXR ${MAX_RIPPLES}

uniform vec2 uRes;
uniform float uAspect, uTime, uHorizon, uCamF, uFlow, uRough, uHue, uMoon, uStars, uSunPulse, uBurst;
uniform vec3 ${COLOR_UNIFORMS.map((c) => 'c_' + c).join(', ')};
uniform vec4 uSunGeo;
uniform vec4 uLeaks[2];
uniform int uBoatCount;
uniform vec4 uBoatA[MAXB];
uniform vec4 uBoatB[MAXB];
uniform vec4 uBoatC[MAXB];
uniform int uStreakCount;
uniform vec4 uStreakA[MAXS];
uniform vec4 uStreakB[MAXS];
uniform vec4 uShapeA[MAXF];
uniform vec4 uShapeB[MAXF];
uniform vec4 uRipple[MAXR];

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash11(float n) {
  return fract(sin(n * 127.1 + 1.7) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), w.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), w.x), w.y);
}

// ---- Sky: a gradient printed in eight flat steps ----

vec3 skyRamp(float t) {
  vec3 c = mix(c_skyH, c_skyL, smoothstep(0.0, 0.34, t));
  c = mix(c, c_skyHi, smoothstep(0.34, 0.67, t));
  return mix(c, c_skyZ, smoothstep(0.67, 1.0, t));
}

vec3 skyBands(vec2 p, float px) {
  float span = 1.0 - uHorizon;
  float e = clamp((p.y - uHorizon) / span, 0.0, 1.0);
  float wob = sin(p.x * 3.1 + uTime * 0.13) * 0.006 + sin(p.x * 7.3 - uTime * 0.09) * 0.003;
  float ee = clamp(e + wob, 0.0, 1.0);
  float t = pow(ee, 0.8) * 8.0;
  float b = floor(t);
  float f = t - b;
  float aa = px / span * 6.4 * pow(max(ee, 0.004), -0.2) * 1.2;
  vec3 c0 = skyRamp(b / 7.0);
  vec3 c1 = skyRamp(min(b + 1.0, 7.0) / 7.0);
  return mix(c0, c1, smoothstep(1.0 - aa, 1.0, f));
}

vec3 stars(vec2 p, float px, vec3 col) {
  if (uStars <= 0.01) return col;
  vec2 g = p * 55.0;
  vec2 cell = floor(g);
  float h = hash12(cell);
  if (h < 0.9) return col;
  vec2 c = (cell + 0.25 + 0.5 * vec2(hash12(cell + 3.1), hash12(cell + 7.7))) / 55.0;
  float r = px * (0.8 + 1.6 * (h - 0.9) / 0.1);
  float tw = 0.6 + 0.4 * sin(uTime * (0.6 + h * 2.0) + h * 50.0);
  float a = (1.0 - smoothstep(r, r + px, length(p - c))) * tw * uStars * smoothstep(uHorizon + 0.03, uHorizon + 0.12, p.y);
  return mix(col, c_star, a);
}

// ---- The sun: a flat disk inside stepped halo rings; a moon at night ----

vec3 sunDisk(vec2 p, float px, vec3 sky) {
  vec2 S = uSunGeo.xy;
  float breath = uSunGeo.w;
  float R = uSunGeo.z * (1.0 + 0.09 * breath + 0.035 * uSunPulse);
  float d = length(p - S);
  vec3 col = sky;
  for (int k = 3; k >= 1; k--) {
    float fk = float(k);
    float rr = R * (1.0 + fk * 0.26 * (1.0 + 0.42 * breath + 0.4 * uSunPulse));
    float a = 0.5 - fk * 0.12;
    float m = 1.0 - smoothstep(rr - px, rr + px, d);
    col = mix(col, mix(sky, c_halo, a), m);
  }
  vec3 sunCol = c_sun;
  if (uMoon > 0.01) {
    vec2 C = S + vec2(R * 0.5, R * 0.28);
    float cut = 1.0 - smoothstep(R * 0.92 - px, R * 0.92 + px, length(p - C));
    sunCol = mix(sunCol, mix(sky, c_halo, 0.38), cut * uMoon);
  }
  col = mix(col, sunCol, 1.0 - smoothstep(R - px, R + px, d));

  // A birth or a homecoming: one ring bursts out of the sun.
  if (uBurst >= 0.0 && uBurst < 1.4) {
    float k = uBurst / 1.4;
    float br = R * (1.05 + 2.4 * (1.0 - (1.0 - k) * (1.0 - k)));
    float th = px * (1.5 + 2.5 * (1.0 - k));
    float ring = 1.0 - smoothstep(th, th + px, abs(d - br));
    col = mix(col, c_line, ring * (1.0 - k) * 0.9);
  }
  return col;
}

// ---- Water: depth bands, flowing stripes, the sun's column, reflections ----

vec3 water(vec2 p, float px) {
  float dy = max(uHorizon - p.y, 1e-4);
  float z = uCamF / dy;
  float xw = (p.x - 0.5 * uAspect) * z / uCamF;

  float zt = dy / uHorizon + sin(xw * 0.07 + uTime * 0.25) * 0.01;
  float zaa = px / uHorizon * 1.5;
  vec3 base = mix(c_wFar, c_wMid, smoothstep(0.16 - zaa, 0.16 + zaa, zt));
  base = mix(base, c_wDeep, smoothstep(0.46 - zaa, 0.46 + zaa, zt));

  float spacing = 1.5;
  float wav = sin(xw * 0.55 + uTime * 0.7 + z * 0.06) * (0.15 + 0.5 * uRough)
            + sin(xw * 1.35 - uTime * 1.05 + z * 0.11) * (0.04 + 0.16 * uRough);
  float u = (z + uFlow) / spacing + wav;
  float e = max(uCamF / (dy * dy) * px / spacing, 1e-4);
  float vis = 1.0 - smoothstep(0.22, 0.5, e);
  float id = floor(u);
  float f = fract(u);

  // Wave marks: light crests and darker troughs, broken into dashes of
  // uneven length so the sea never reads as ruled lines.
  float w = 0.13 + 0.12 * uRough;
  float crest = smoothstep(0.0, e, f) * (1.0 - smoothstep(w - e, w + e, f));
  float dashC = smoothstep(0.42 - 0.18 * uRough, 0.5 - 0.18 * uRough, vnoise(vec2(p.x * 5.0 + id * 3.7, id * 1.3)));
  float t0 = 0.55;
  float trough = smoothstep(t0 - e, t0 + e, f) * (1.0 - smoothstep(t0 + 0.07 - e, t0 + 0.07 + e, f));
  float dashT = smoothstep(0.52, 0.6, vnoise(vec2(p.x * 4.0 - id * 2.9, id * 0.7 + 5.0)));
  vec3 crestCol = mix(base, c_crest, 0.55);
  vec3 troughCol = base * 0.82;
  vec3 near = mix(base, crestCol, crest * dashC);
  near = mix(near, troughCol, trough * dashT);
  vec3 c = mix(mix(base, crestCol, w * 0.45), near, vis);

  // The sun's reflection: a thin bright seam at the horizon that opens into
  // glitter bars of uneven width as the water comes toward you.
  float R = uSunGeo.z * (1.0 + 0.09 * uSunGeo.w);
  float zt0 = dy / uHorizon;
  float broken = smoothstep(0.0, 0.3, vis);
  float halfW = R * (0.05 + 0.8 * zt0) * mix(1.0, 0.3 + 0.9 * hash11(id + 3.0), broken) * (1.0 + 0.25 * uSunPulse);
  float dx = abs(p.x - uSunGeo.x - sin(id * 1.7 + uTime * 0.6) * 0.012 * vis);
  float column = 1.0 - smoothstep(halfW - px, halfW + px, dx);
  float barOn = step(0.28, hash11(id + 11.0));
  c = mix(c, c_reflect, column * mix(1.0, crest * barOn, broken) * 0.92 * (1.0 - 0.45 * zt0));

  // Each boat's reflection: short bars under the hull.
  for (int i = 0; i < MAXB; i++) {
    if (i >= uBoatCount) break;
    vec4 A = uBoatA[i];
    vec4 B = uBoatB[i];
    float sc = A.z;
    float below = A.y - p.y;
    if (below < 0.0 || below > sc * 0.7 || uBoatC[i].x < 0.01) continue;
    float step01 = below / (sc * 0.16);
    float k = floor(step01);
    float bar = 1.0 - smoothstep(0.5, 0.5 + px / (sc * 0.16), fract(step01));
    float hw = sc * B.w * (0.95 - k * 0.2);
    float sway = sin(uTime * 1.6 + k * 1.3 + float(i) * 2.0) * sc * 0.06;
    float m = (1.0 - smoothstep(hw - px, hw + px, abs(p.x - A.x - sway))) * bar * uBoatC[i].x;
    vec3 rc = mix(c_sil, mix(c_paperS, c_glow, clamp(B.z, 0.0, 1.0)), B.y);
    c = mix(c, rc, m * 0.55);
  }

  // Rings on the water: arrivals, fresh starts, and the bell when waiting.
  for (int i = 0; i < MAXR; i++) {
    vec4 Rp = uRipple[i];
    if (Rp.w <= 0.0 || Rp.z < 0.0 || Rp.z > 4.0) continue;
    float d = length((p - Rp.xy) / vec2(1.0, 0.3));
    float r1 = Rp.w * (0.6 + Rp.z * 0.75);
    float th = max(px * 1.4, Rp.w * 0.05);
    float ring = (1.0 - smoothstep(th - px, th + px, abs(d - r1)))
               + (1.0 - smoothstep(th - px, th + px, abs(d - r1 * 0.62))) * step(Rp.w * 0.5, r1 * 0.62);
    c = mix(c, c_reflect, clamp(ring, 0.0, 1.0) * (1.0 - Rp.z / 4.0) * 0.8);
  }
  return c;
}

// ---- Thin ISO50-style shapes drifting in the sky ----

float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

vec3 shapes(vec2 p, float px, vec3 col) {
  for (int i = 0; i < MAXF; i++) {
    vec4 A = uShapeA[i];
    vec4 B = uShapeB[i];
    if (B.y <= 0.001) continue;
    vec2 q = p - A.xy;
    float cs = cos(A.w);
    float sn = sin(A.w);
    q = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y);
    float r = A.z;
    float d;
    if (B.x < 0.5) d = abs(length(q) - r);
    else if (B.x < 1.5) d = abs(sdTri(q, r));
    else if (B.x < 2.5) d = abs(abs(q.x) + abs(q.y) - r) * 0.7071;
    else if (B.x < 3.5) { vec2 dd = abs(q) - vec2(r); d = abs(length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0)); }
    else d = length(q - vec2(clamp(q.x, -r, r), 0.0));
    col = mix(col, c_line, (1.0 - smoothstep(px * 0.7, px * 1.7, d)) * B.y);
  }
  return col;
}

// ---- Paper boats ----

vec3 boats(vec2 p, float px, vec3 col) {
  for (int i = 0; i < MAXB; i++) {
    if (i >= uBoatCount) break;
    vec4 A = uBoatA[i];
    vec4 B = uBoatB[i];
    float alpha = uBoatC[i].x;
    float sc = A.z;
    if (alpha < 0.005) continue;
    vec2 q = p - A.xy;
    float cs = cos(A.w);
    float sn = sin(A.w);
    q = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y) / sc;
    float unfold = max(B.w, 0.001);
    q.x /= unfold;
    float aa = px / sc * 1.3;
    float aax = aa / unfold;

    float hw = mix(0.58, 1.0, clamp(q.y / 0.38, 0.0, 1.0));
    float hull = (1.0 - smoothstep(hw - aax, hw + aax, abs(q.x)))
               * smoothstep(-aa, aa, q.y) * (1.0 - smoothstep(0.38 - aa, 0.38 + aa, q.y));
    float brim = smoothstep(0.27 - aa, 0.27 + aa, q.y);

    float apex = 0.38 + 0.7 * B.x;
    float sy = (q.y - 0.38) / max(apex - 0.38, 0.02);
    float sw = 0.46 * (1.0 - sy);
    float sail = smoothstep(-aa, aa, q.y - 0.38) * (1.0 - smoothstep(sw - aax, sw + aax, abs(q.x))) * step(sy, 1.0);

    vec3 lit = c_paperL;
    vec3 shade = c_paperS;
    vec3 hullCol = mix(lit, mix(lit, shade, 0.75), brim);
    vec3 sailCol = mix(lit, shade, smoothstep(-aax, aax, q.x));
    vec3 paper = mix(hullCol, sailCol, step(0.5, sail));
    paper += c_glow * clamp(B.z, 0.0, 1.5) * 0.3;
    vec3 bc = mix(c_sil, paper, B.y);
    float m = max(hull, sail) * alpha;
    col = mix(col, bc, m);

    float gd = length((p - A.xy - vec2(0.0, sc * 0.45)) / vec2(1.4, 1.0));
    col += c_glow * B.z * alpha * 0.2 * exp(-gd / (sc * 0.8)) * (1.0 - m);
  }
  return col;
}

// ---- Light streaks ----

vec3 streaks(vec2 p, float px, vec3 col) {
  for (int i = 0; i < MAXS; i++) {
    if (i >= uStreakCount) break;
    vec4 S = uStreakA[i];
    vec4 T = uStreakB[i];
    vec2 a = S.xy;
    vec2 ba = S.zw - S.xy;
    float h = clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    float d = length(p - a - ba * h);
    float w = T.y * px * 0.5;
    float line = (1.0 - smoothstep(w, w + px, d)) * (1.0 - h) * T.x * smoothstep(uHorizon, uHorizon + 0.03, p.y);
    float hr = T.y * px * 1.1;
    vec2 q = abs(p - a);
    float head = (1.0 - smoothstep(hr, hr + px, length(p - a))) * T.z;
    if (T.w > 0.0) {
      float L = T.w * px;
      float armH = (1.0 - smoothstep(px * 0.5, px * 1.3, q.y)) * (1.0 - smoothstep(0.0, L, q.x));
      float armV = (1.0 - smoothstep(px * 0.5, px * 1.3, q.x)) * (1.0 - smoothstep(0.0, L, q.y));
      head = max(head, max(armH, armV) * T.z);
    }
    col = mix(col, c_line, clamp(line + head, 0.0, 1.0));
  }
  return col;
}

vec3 hueShift(vec3 c, float a) {
  vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x * uAspect, uv.y);
  float px = 1.0 / uRes.y;

  vec3 col = vec3(0.0);
  float edge = smoothstep(uHorizon - px, uHorizon + px, p.y);
  if (edge > 0.0) {
    vec3 sky = stars(p, px, skyBands(p, px));
    col = sunDisk(p, px, sky);
  }
  if (edge < 1.0) {
    vec3 wat = water(p, px);
    col = edge > 0.0 ? mix(wat, col, edge) : wat;
  }

  col = shapes(p, px, col);
  col = boats(p, px, col);
  col = streaks(p, px, col);

  for (int i = 0; i < 2; i++) {
    vec4 L = uLeaks[i];
    float d = length(p - L.xy) / L.z;
    float a = exp(-d * d * 2.2) * L.w;
    col = 1.0 - (1.0 - col) * (1.0 - c_leak * a);
  }

  col = hueShift(col, uHue);
  float mottle = vnoise(p * 7.0 + 13.0) * 0.6 + vnoise(p * 23.0) * 0.4;
  col *= 1.0 + (mottle - 0.5) * 0.06;
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 517.0) - 0.5) * 0.045;
  float vig = smoothstep(1.25, 0.3, length((uv - 0.5) * vec2(uAspect * 0.7, 1.0)));
  col *= mix(0.86, 1.0, vig);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function buildProgram(gl) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Sea shader failed to compile:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('Sea shader failed to link:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

function locate(gl, program) {
  const names = [
    'uRes', 'uAspect', 'uTime', 'uHorizon', 'uCamF', 'uFlow', 'uRough', 'uHue', 'uMoon', 'uStars', 'uSunPulse', 'uBurst',
    'uSunGeo', 'uLeaks', 'uBoatCount', 'uBoatA', 'uBoatB', 'uBoatC', 'uStreakCount', 'uStreakA', 'uStreakB',
    'uShapeA', 'uShapeB', 'uRipple',
  ];
  const out = { aPos: gl.getAttribLocation(program, 'aPos') };
  for (const n of names) out[n] = gl.getUniformLocation(program, n);
  for (const c of COLOR_UNIFORMS) out['c_' + c] = gl.getUniformLocation(program, 'c_' + c);
  return out;
}

// Without WebGL: the same poster, painted plainly, so it still works.
function createFallback(canvas, { world }) {
  const ctx = canvas.getContext('2d');
  let last = -1e9;
  const css = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
  return {
    render({ now, phase }) {
      if (now - last < 100) return false;
      last = now;
      const w = (canvas.width = Math.min(1200, innerWidth));
      const h = (canvas.height = Math.round((w * innerHeight) / innerWidth));
      const aspect = w / h;
      const pal = paletteAt(phase);
      const hy = h * (1 - HORIZON);
      const bands = [pal.skyH, pal.skyL, pal.skyHi, pal.skyZ];
      for (let i = 0; i < 8; i++) {
        const t = i / 7;
        const k = Math.min(2, Math.floor(t * 3));
        const m = t * 3 - k;
        const c = bands[k].map((v, j) => v + (bands[k + 1][j] - v) * m);
        ctx.fillStyle = css(c);
        ctx.fillRect(0, hy - (hy * (i + 1)) / 8, w, hy / 8 + 1);
      }
      ctx.fillStyle = css(pal.sun);
      ctx.beginPath();
      ctx.arc(w / 2, hy - pal.sunLift * h, pal.sunRadius * h, 0, Math.PI * 2);
      ctx.fill();
      for (const [color, from, to] of [[pal.wFar, 0, 0.16], [pal.wMid, 0.16, 0.46], [pal.wDeep, 0.46, 1]]) {
        ctx.fillStyle = css(color);
        ctx.fillRect(0, hy + from * (h - hy), w, (to - from) * (h - hy) + 1);
      }
      ctx.fillStyle = css(pal.paperL);
      for (const t of world.travelers.values()) {
        const lay = boatLayout(world.journey(t), t.lane, aspect);
        const x = (lay.x / aspect) * w;
        const y = h * (1 - lay.y);
        const s = lay.scale * h;
        ctx.beginPath();
        ctx.moveTo(x - s * 0.46, y - s * 0.38);
        ctx.lineTo(x, y - s * 1.08);
        ctx.lineTo(x + s * 0.46, y - s * 0.38);
        ctx.lineTo(x + s, y - s * 0.38);
        ctx.lineTo(x + s * 0.58, y);
        ctx.lineTo(x - s * 0.58, y);
        ctx.lineTo(x - s, y - s * 0.38);
        ctx.closePath();
        ctx.fill();
      }
      return true;
    },
    onMoment() {},
    toll() {},
    notePulse() {},
    setBreath() {},
    describe: () => 'canvas fallback (no WebGL)',
  };
}
