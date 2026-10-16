// FIRST PASS (photographic water), kept for reference. Not loaded by the app.
// David asked for a graphic poster look instead on 2026-10-15; see scene.js.
// Sea, the picture. One full-screen shader draws the sky, clouds, stars and
// water; boats and their lights are positioned here and handed to it.
//
// Each Claude session is a small sailboat with a lantern. It starts close
// and sails toward the horizon as its own work adds up. Subagents are
// smaller lanterns that drift off from it and come back. When Claude is
// waiting on you, the lantern flashes with each toll of the bell and rings
// spread on the water. During compaction the lantern dims and rests.
//
// The camera sits low on the water, so boats stand against the sky.

import { paletteAt } from './palette-photo.js';

const MAX_LIGHTS = 16;
const MAX_RIPPLES = 8;
const HORIZON = 0.47;   // horizon height, fraction of the screen from the bottom
const CAM_H = 1.0;      // camera height above the water
const FOCAL = 1.35;
const MAST = 1.4;       // lantern height above the water
const NEAR = 18;        // where a new traveler starts
const FAR = 420;        // where a long journey ends
const FPS_CAP = 30;
const MAX_RENDER_WIDTH = 1000; // the scene is soft; this keeps a modest GPU cool
const TRAVEL_PER_WORK = 1.6;

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
  if (!program) return createFallback(canvas, { world, placement });

  let uniforms = locate(gl, program);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => {
    program = buildProgram(gl);
    uniforms = locate(gl, program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  });

  const boats = new Map();
  const ripples = [];
  const lightPos = new Float32Array(MAX_LIGHTS * 4);
  const lightScreen = new Float32Array(MAX_LIGHTS * 4);
  const lightInfo = new Float32Array(MAX_LIGHTS * 4);
  const rippleData = new Float32Array(MAX_RIPPLES * 4);
  const t0 = performance.now();
  let lastFrame = -1e9;
  let width = 0;
  let height = 0;
  let aspect = 1;
  let waveT = 0;
  let travel = 0;
  let rough = 0;
  let clock = 0;

  // ---- Boats ----

  function boatFor(traveler) {
    let b = boats.get(traveler.id);
    if (!b) {
      b = {
        id: traveler.id,
        traveler,
        journey: placement(traveler).distance,
        fade: 0,
        fadeTarget: 1,
        rest: 0,
        flare: 0.8,
        pulse: 0,
        fail: 0,
        lastToll: -1e9,
        subs: new Map(),
        x: 0,
        y: MAST,
        z: NEAR,
        laid: false,
        pendingRipple: 0.7,
      };
      boats.set(traveler.id, b);
    }
    b.traveler = traveler;
    return b;
  }

  function addRipple(x, z, strength) {
    ripples.push({ x, z, t: clock, strength });
    while (ripples.length > MAX_RIPPLES) ripples.shift();
  }

  function onMoment(m) {
    if (!m.traveler) return;
    const b = boatFor(m.traveler);
    switch (m.type) {
      case 'traveler:new':
        b.fadeTarget = 1;
        b.flare = 0.8;
        if (b.laid) addRipple(b.x, b.z, 0.7);
        else b.pendingRipple = 0.7;
        break;
      case 'traveler:gone':
        b.fadeTarget = 0;
        break;
      case 'tool':
        if (m.sub) {
          const s = b.subs.get(m.sub.id);
          if (s) s.pulse = Math.min(1.4, s.pulse + 0.7);
        } else {
          b.pulse = Math.min(1.2, b.pulse + 0.35);
        }
        break;
      case 'tool:fail':
      case 'error':
        b.fail = 1;
        break;
      case 'fresh':
        b.flare = 1;
        addRipple(b.x, b.z, 0.6);
        break;
      case 'subagent:out': {
        const seed = m.sub.seed;
        b.subs.set(m.sub.id, {
          id: m.sub.id,
          side: seed > 0.5 ? 1 : -1,
          reach: 2.2 + 3.2 * fract(seed * 7.13),
          depth: (fract(seed * 3.71) * 2 - 1) * 16,
          phase: seed * 40,
          out: 0,
          target: 1,
          pulse: 0.8,
        });
        break;
      }
      case 'subagent:back': {
        const s = b.subs.get(m.sub.id);
        if (s) s.target = 0;
        break;
      }
      default:
        break;
    }
  }

  function toll(traveler) {
    const b = boatFor(traveler);
    b.lastToll = clock;
    addRipple(b.x, b.z, 1);
  }

  function updateBoats(dt, worldNow, night) {
    const ease = (tau) => 1 - Math.exp(-dt / tau);
    for (const b of [...boats.values()]) {
      const tr = b.traveler;
      const live = world.travelers.get(b.id) === tr;
      if (!live) b.fadeTarget = 0;

      b.journey += (world.journey(tr) - b.journey) * ease(4);
      b.fade += (b.fadeTarget - b.fade) * ease(b.fadeTarget ? 2.5 : 4);
      b.rest += ((live && tr.resting ? 1 : 0) - b.rest) * ease(1.8);
      b.pulse *= Math.exp(-dt / 0.6);
      b.flare *= Math.exp(-dt / 1.6);
      b.fail *= Math.exp(-dt / 0.5);

      if (!live && b.fade < 0.01) {
        boats.delete(b.id);
        continue;
      }

      // Where it is.
      const j = b.journey;
      // Even steps on screen: the boat shrinks steadily toward the horizon.
      b.z = (CAM_H * FOCAL) / ((CAM_H * FOCAL) / NEAR + ((CAM_H * FOCAL) / FAR - (CAM_H * FOCAL) / NEAR) * j);
      const scale = FOCAL / b.z;
      const sxH = tr.lane * (0.62 - 0.3 * j) * 0.5 * Math.min(aspect, 2);
      b.x = sxH / scale;
      const swell = swellAt(b.x, b.z + travel, waveT, rough);
      b.y = MAST + swell.h * 0.8;
      b.tilt = -swell.sx * 0.9;
      b.scale = scale;
      b.uvx = 0.5 + sxH / aspect;
      b.uvy = HORIZON + (b.y - CAM_H) * scale;
      if (!b.laid) {
        b.laid = true;
        if (b.pendingRipple) addRipple(b.x, b.z, b.pendingRipple);
      }

      // How bright the lantern is.
      const energy = live ? world.travelerEnergy(tr, worldNow) : 0;
      let light = 0.72 + 0.3 * energy + 0.3 * b.pulse + 0.9 * b.flare;
      b.white = 0;
      if (live && tr.waiting) {
        const since = clock - b.lastToll;
        const flash = Math.exp(-since / 1.1);
        light = 0.45 + 0.2 * (0.5 + 0.5 * Math.sin(clock * 1.6)) + 1.5 * flash;
        b.white = 0.6 * flash + 0.25;
      }
      light *= 1 - 0.88 * b.rest;
      light *= 1 - 0.6 * b.fail * (0.5 + 0.5 * Math.sin(clock * 37));
      b.light = light * b.fade * (0.85 + 0.35 * night);

      // Subagents drift out, wander, and come home.
      for (const s of [...b.subs.values()]) {
        s.out += (s.target - s.out) * ease(s.target ? 2.2 : 1.6);
        s.pulse *= Math.exp(-dt / 0.5);
        if (s.target === 0 && s.out < 0.03) {
          b.subs.delete(s.id);
          continue;
        }
        const wander = Math.sin(clock * 0.4 + s.phase) * 0.8;
        s.x = b.x + s.side * (1.2 + s.reach * s.out + wander * s.out);
        s.z = Math.max(NEAR * 0.7, b.z + s.depth * s.out * (0.4 + 0.6 * b.journey));
        const sw = swellAt(s.x, s.z + travel, waveT, rough);
        s.y = 0.55 + sw.h * 0.8;
        s.scale = FOCAL / s.z;
        s.uvx = 0.5 + (s.x * s.scale) / aspect;
        s.uvy = HORIZON + (s.y - CAM_H) * s.scale;
        s.light = (0.45 + 0.5 * s.pulse) * Math.min(1, s.out * 1.5) * b.fade * (1 - 0.7 * b.rest) * (0.85 + 0.35 * night);
      }
    }
  }

  function packLights(night) {
    let n = 0;
    const put = (x, y, z, intensity, uvx, uvy, radius, kind, scale, tilt, silhouette, white) => {
      if (n >= MAX_LIGHTS) return;
      const i = n * 4;
      lightPos.set([x, y, z, intensity], i);
      lightScreen.set([uvx, uvy, radius, kind], i);
      lightInfo.set([scale, tilt, silhouette, white], i);
      n++;
    };
    const ordered = [...boats.values()].sort((a, b) => b.z - a.z);
    for (const b of ordered) {
      const radius = clamp(0.055 * b.scale, 0.0018, 0.0065);
      put(b.x, b.y, b.z, b.light, b.uvx, b.uvy, radius, 0, b.scale, b.tilt, b.fade * (1 - 0.55 * night), b.white);
    }
    for (const b of ordered) {
      for (const s of b.subs.values()) {
        const radius = clamp(0.035 * s.scale, 0.0013, 0.004);
        put(s.x, s.y, s.z, s.light, s.uvx, s.uvy, radius, 1, s.scale, 0, 0, 0);
      }
    }
    return n;
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
    const folded = phase <= 1 ? phase : 1 - (phase - 1) / 0.25;
    const night = clamp(folded * 3.3 - 2.3, 0, 1);
    const dark = clamp((folded - 0.45) / 0.55, 0, 1);
    rough += (Math.min(1, energy * 1.3) - rough) * (1 - Math.exp(-dt / 2));
    waveT += dt * (0.32 + 0.6 * rough);
    const targetTravel = (world.totalWork * TRAVEL_PER_WORK) % 20000;
    if (targetTravel < travel - 1000) travel -= 20000;
    travel += (targetTravel - travel) * (1 - Math.exp(-dt / 5));

    updateBoats(dt, worldNow, night);
    const lightCount = packLights(night);

    rippleData.fill(0);
    ripples.forEach((r, i) => rippleData.set([r.x, r.z, r.t, r.strength], i * 4));

    const u = uniforms;
    gl.useProgram(program);
    gl.uniform2f(u.uRes, width, height);
    gl.uniform1f(u.uAspect, aspect);
    gl.uniform1f(u.uTime, clock);
    gl.uniform1f(u.uWaveT, waveT);
    gl.uniform1f(u.uTravel, travel);
    gl.uniform1f(u.uRough, rough);
    gl.uniform1f(u.uHorizon, HORIZON);
    gl.uniform1f(u.uCamH, CAM_H);
    gl.uniform1f(u.uFocal, FOCAL);
    gl.uniform3fv(u.uZenith, pal.zenith);
    gl.uniform3fv(u.uMid, pal.mid);
    gl.uniform3fv(u.uHorizonCol, pal.horizon);
    gl.uniform3fv(u.uGlow, pal.glow);
    gl.uniform3fv(u.uHaze, pal.haze);
    gl.uniform3fv(u.uSunCol, pal.sun);
    gl.uniform3fv(u.uCloudLit, pal.cloudLit);
    gl.uniform3fv(u.uCloudShade, pal.cloudShade);
    gl.uniform3fv(u.uWaterDeep, pal.waterDeep);
    gl.uniform3fv(u.uSunDir, pal.sunDir);
    gl.uniform1f(u.uSunSize, pal.sunSize);
    gl.uniform1f(u.uSunPower, pal.sunPower);
    gl.uniform1f(u.uCloudCover, pal.cloudCover);
    gl.uniform1f(u.uGlowStrength, pal.glowStrength);
    gl.uniform1f(u.uReflect, pal.reflect);
    gl.uniform1f(u.uStars, pal.stars);
    gl.uniform1f(u.uExposure, pal.exposure);
    gl.uniform1f(u.uDark, dark);
    gl.uniform1f(u.uPixel, 1 / (height * FOCAL));
    gl.uniform1i(u.uLightCount, lightCount);
    gl.uniform4fv(u.uLightPos, lightPos);
    gl.uniform4fv(u.uLightScreen, lightScreen);
    gl.uniform4fv(u.uLightInfo, lightInfo);
    gl.uniform4fv(u.uRipples, rippleData);

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
    describe: () => `webgl ${width}x${height}, ${boats.size} boats, ${FPS_CAP} fps cap`,
  };
}

// A gentle bob for boats and dinghies. Each one rides its own phase.
function swellAt(x, z, t, rough) {
  const amp = 0.05 + 0.14 * rough;
  const ph = x * 0.37 + z * 0.21;
  const h = amp * (Math.sin(t * 1.15 + ph) + 0.55 * Math.sin(t * 1.9 + ph * 1.7));
  const sx = amp * 0.35 * Math.cos(t * 1.15 + ph * 1.3);
  return { h, sx };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function fract(v) {
  return v - Math.floor(v);
}

// ---- GL plumbing ----

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

#define MAXL ${MAX_LIGHTS}
#define MAXR ${MAX_RIPPLES}

uniform vec2 uRes;
uniform float uAspect, uTime, uWaveT, uTravel, uRough, uHorizon, uCamH, uFocal;
uniform vec3 uZenith, uMid, uHorizonCol, uGlow, uHaze, uSunCol, uCloudLit, uCloudShade, uWaterDeep, uSunDir;
uniform float uSunSize, uSunPower, uCloudCover, uGlowStrength, uReflect, uStars, uExposure, uDark, uPixel;
uniform int uLightCount;
uniform vec4 uLightPos[MAXL];
uniform vec4 uLightScreen[MAXL];
uniform vec4 uLightInfo[MAXL];
uniform vec4 uRipples[MAXR];

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Value noise with its slope, for the fine chop on the water.
vec3 vnoised(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}

const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);

float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = ROT * p; a *= 0.5; }
  return s / 0.875;
}

float fbm2(vec2 p) {
  return (vnoise(p) * 0.5 + vnoise(ROT * p) * 0.25) / 0.75;
}

float fbm5(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = ROT * p; a *= 0.5; }
  return s / 0.96875;
}

vec3 sky(vec3 rd, bool detailed) {
  float e = max(rd.y, 0.0);
  vec3 col = mix(uHorizonCol, uMid, smoothstep(0.0, 0.16, e));
  col = mix(col, uZenith, smoothstep(0.1, 0.62, e));

  vec2 sxz = normalize(uSunDir.xz + vec2(1e-4));
  float az = dot(normalize(rd.xz + vec2(1e-4)), sxz) * 0.5 + 0.5;
  float glow = pow(az, 4.0) * exp(-e * 6.0);
  col += uGlow * glow * uGlowStrength;
  col = mix(col, uHaze, exp(-e * 26.0) * 0.5);

  if (uStars > 0.01) {
    vec2 sp = rd.xy / (rd.z + 1.0) * 110.0;
    vec2 cell = floor(sp);
    float h = hash12(cell);
    if (h > 0.972) {
      vec2 off = vec2(hash12(cell + 7.1), hash12(cell + 3.7)) - 0.5;
      float d = length(fract(sp) - 0.5 - off * 0.7);
      float tw = 0.65 + 0.35 * sin(uTime * (0.7 + h * 2.3) + h * 61.0);
      col += vec3(1.0, 0.96, 0.9) * smoothstep(0.16, 0.0, d) * tw * (h - 0.972) / 0.028 * uStars * smoothstep(0.01, 0.12, e);
    }
  }

  float sd = dot(rd, uSunDir);
  float disk = smoothstep(cos(uSunSize), cos(uSunSize * 0.8), sd);
  col = mix(col, uSunCol, disk * uSunPower);
  col += uSunCol * (pow(max(sd, 0.0), 90.0) * 0.35 + pow(max(sd, 0.0), 8.0) * 0.07) * uSunPower;

  if (rd.y > 0.002) {
    vec2 cp = rd.xz / (rd.y + 0.06) * 0.9;
    cp += vec2(uTime * 0.0035, uTime * 0.002 + uTravel * 0.0012);
    vec2 w = cp;
    if (detailed) w += (vec2(vnoise(cp * 0.6 + vec2(3.1, 1.7)), vnoise(cp * 0.6 + vec2(8.3, 2.9))) - 0.5) * 1.3;
    float d = detailed ? fbm5(w) : fbm2(w);
    float d2 = detailed ? fbm3(w + sxz * 0.22) : fbm2(w + sxz * 0.22);
    float dens = smoothstep(1.0 - uCloudCover - 0.02, 1.0 - uCloudCover + 0.22, d);
    float lit = clamp(0.5 + (d - d2) * 3.2, 0.0, 1.0);
    lit = mix(lit, 1.0, 0.3 * glow + 0.25 * exp(-e * 5.0));
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    float edge = smoothstep(0.0, 0.35, dens) * (1.0 - smoothstep(0.35, 0.9, dens));
    cc += uCloudLit * edge * 0.18 * (0.4 + glow);
    float fade = smoothstep(0.0, 0.07, e) * (1.0 - 0.35 * smoothstep(0.5, 1.0, e));
    col = mix(col, cc, dens * fade);
  }
  return col;
}

// Ten wave trains from long swell to fine chop, each with sharpened crests.
// Steepness is the same at every size, like a real sea. Trains too fine to
// see at a distance fade out instead of shimmering. Returns the slope.
vec2 waveGrad(vec2 p, float t, float rough, float footprint) {
  vec2 warp = vec2(vnoise(p * 0.06 + t * 0.015), vnoise(p * 0.06 + vec2(17.0, 5.0) - t * 0.015)) - 0.5;
  p += warp * 7.0;
  float steep = mix(0.01, 0.026, rough);
  float ex = mix(1.6, 2.5, rough);
  float wl = 13.0;
  vec2 g = vec2(0.0);
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float a = fi * 2.39996 + 0.4;
    vec2 dir = normalize(vec2(sin(a) * 0.85, 0.55 + 0.45 * abs(cos(a))));
    float k = 6.2831853 / wl;
    float ph = dot(dir, p) * k + sqrt(9.81 * k) * t + fi * 1.7;
    float s = sin(ph) * 0.5 + 0.5;
    float fade = smoothstep(footprint, footprint * 3.0, wl);
    g += dir * (wl * steep * ex * pow(max(s, 1e-4), ex - 1.0) * 0.5 * cos(ph) * k) * fade;
    wl *= 0.69;
  }
  return g;
}

vec3 lightColor(float kind, float white) {
  vec3 warm = vec3(1.0, 0.7, 0.4);
  vec3 pale = vec3(1.0, 0.86, 0.64);
  return mix(mix(warm, pale, kind), vec3(1.0, 0.94, 0.84), clamp(white, 0.0, 1.0));
}

vec3 water(vec3 rd) {
  float dist = uCamH / max(-rd.y, 1e-4);
  vec2 p = rd.xz * dist;
  vec2 wp = p + vec2(0.0, uTravel);
  float footprint = dist * dist / uCamH * uPixel * 1.5 + 0.02;
  vec2 g = waveGrad(wp, uWaveT, uRough, footprint);

  float ringGlow = 0.0;
  for (int i = 0; i < MAXR; i++) {
    vec4 R = uRipples[i];
    if (R.w <= 0.0) continue;
    float age = uTime - R.z;
    if (age < 0.0 || age > 8.0) continue;
    vec2 d = p - R.xy;
    float dd = length(d) + 1e-3;
    float radius = 0.3 + age * 1.05;
    float band = exp(-pow((dd - radius) * 1.1, 2.0));
    float a = R.w * 0.3 * exp(-age * 0.4);
    g += (d / dd) * a * band * cos((dd - radius) * 3.2);
    ringGlow += band * a * max(cos((dd - radius) * 3.2), 0.0) / (1.0 + dd * 0.05);
  }

  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = -rd;
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(rd, n);
  r.y = abs(r.y) + 0.002;
  vec3 refl = sky(r, false) * uReflect;
  vec3 body = uWaterDeep * (0.85 + 0.3 * smoothstep(-0.3, 0.3, g.y));
  vec3 col = mix(body, refl, clamp(fres, 0.0, 1.0));
  col += uSunCol * pow(max(dot(r, uSunDir), 0.0), 380.0) * uSunPower * 1.6;

  for (int i = 0; i < MAXL; i++) {
    if (i >= uLightCount) break;
    vec4 L = uLightPos[i];
    if (L.w <= 0.002) continue;
    vec3 toL = L.xyz - vec3(p.x, 0.0, p.y);
    float dl = length(toL);
    vec3 ld = toL / dl;
    vec3 h = normalize(ld + v);
    float spec = pow(max(dot(n, h), 0.0), 220.0);
    float att = L.w / (1.0 + dl * dl * 0.012);
    vec3 lc = lightColor(uLightScreen[i].w, uLightInfo[i].w);
    col += lc * (spec * mix(1.2, 7.0, uDark) + max(dot(n, ld), 0.0) * 0.05) * att;
  }

  col += vec3(1.0, 0.8, 0.58) * ringGlow * mix(0.45, 1.3, uDark);

  float hz = 1.0 - exp(-dist * 0.0065);
  col = mix(col, mix(uWaterDeep, uHaze, 0.6), hz * 0.85);
  return col;
}

// A small sailboat in local units: the water line is y = 0, the lantern sits
// at the top of the mast (y = 1).
float boatMask(vec2 q, float aa) {
  float halfW = mix(0.42, 0.62, clamp((q.y + 0.03) / 0.16, 0.0, 1.0));
  float hull = (1.0 - smoothstep(halfW - aa, halfW + aa, abs(q.x)))
    * (1.0 - smoothstep(0.13 - aa, 0.13 + aa, q.y))
    * smoothstep(-0.03 - aa, -0.03 + aa, q.y);
  float mast = (1.0 - smoothstep(0.012, 0.012 + aa, abs(q.x))) * smoothstep(0.1, 0.1 + aa, q.y)
    * (1.0 - smoothstep(1.0 - aa, 1.0 + aa, q.y));
  float s1 = q.x - 0.035;
  float s2 = q.y - 0.17;
  float s3 = (0.5 - q.x) * (0.93 - 0.17) / (0.5 - 0.035) - (q.y - 0.17);
  float sail = smoothstep(-aa, aa, s1) * smoothstep(-aa, aa, s2) * smoothstep(-aa, aa, s3);
  return max(max(hull, mast), sail);
}

vec3 shoulder(vec3 c) {
  vec3 over = max(c - 0.8, 0.0);
  return min(c, 0.8) + 0.2 * (1.0 - exp(-over / 0.2));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 rd = normalize(vec3((uv.x - 0.5) * uAspect, uv.y - uHorizon, uFocal));
  vec3 col = rd.y >= 0.0 ? sky(rd, true) : water(rd);

  vec3 silCol = uWaterDeep * 0.5 + vec3(0.012, 0.009, 0.02);
  for (int i = 0; i < MAXL; i++) {
    if (i >= uLightCount) break;
    vec4 S = uLightScreen[i];
    vec4 I = uLightInfo[i];
    vec2 d = (uv - S.xy) * vec2(uAspect, 1.0);
    if (S.w < 0.5 && I.z > 0.01) {
      float sc = I.x * (${MAST.toFixed(2)});
      float c = cos(I.y);
      float s = sin(I.y);
      vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y) / sc;
      q.y += 1.0;
      float aa = 1.2 / (uRes.y * sc);
      col = mix(col, silCol, boatMask(q, aa) * clamp(I.z, 0.0, 1.0));
    }
    float inten = uLightPos[i].w;
    float r = S.z;
    float dd = length(d);
    float core = exp(-(dd * dd) / (r * r));
    float halo = (exp(-dd / (r * 6.0)) * 0.22 + exp(-dd / (r * 18.0)) * 0.05) * mix(0.45, 1.0, uDark);
    col += lightColor(S.w, I.w) * inten * (core * 1.4 + halo);
  }

  col *= uExposure;
  col = col * 0.94 + vec3(0.024, 0.017, 0.034);
  col = shoulder(col);
  float vig = smoothstep(1.3, 0.35, length((uv - 0.5) * vec2(uAspect * 0.75, 1.0)));
  col *= mix(0.8, 1.0, vig);
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 517.0) - 0.5) * 0.035;
  gl_FragColor = vec4(col, 1.0);
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
    'uRes', 'uAspect', 'uTime', 'uWaveT', 'uTravel', 'uRough', 'uHorizon', 'uCamH', 'uFocal',
    'uZenith', 'uMid', 'uHorizonCol', 'uGlow', 'uHaze', 'uSunCol', 'uCloudLit', 'uCloudShade', 'uWaterDeep', 'uSunDir',
    'uSunSize', 'uSunPower', 'uCloudCover', 'uGlowStrength', 'uReflect', 'uStars', 'uExposure', 'uDark', 'uPixel',
    'uLightCount', 'uLightPos', 'uLightScreen', 'uLightInfo', 'uRipples',
  ];
  const out = { aPos: gl.getAttribLocation(program, 'aPos') };
  for (const n of names) out[n] = gl.getUniformLocation(program, n);
  return out;
}

// Without WebGL: a calm painted gradient with the lanterns, so it still works.
function createFallback(canvas, { world, placement }) {
  const ctx = canvas.getContext('2d');
  let last = -1e9;
  return {
    render({ now, phase }) {
      if (now - last < 100) return false;
      last = now;
      const w = (canvas.width = Math.min(1200, innerWidth));
      const h = (canvas.height = Math.round((w * innerHeight) / innerWidth));
      const pal = paletteAt(phase);
      const css = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, css(pal.zenith));
      g.addColorStop(0.35, css(pal.mid));
      g.addColorStop(1 - HORIZON, css(pal.horizon));
      g.addColorStop(1 - HORIZON, css(pal.waterDeep));
      g.addColorStop(1, css(pal.waterDeep.map((v) => v * 0.6)));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      for (const t of world.travelers.values()) {
        const p = placement(t);
        const z = (CAM_H * FOCAL) / ((CAM_H * FOCAL) / NEAR + ((CAM_H * FOCAL) / FAR - (CAM_H * FOCAL) / NEAR) * p.distance);
        const x = w / 2 + t.lane * 0.31 * w;
        const y = h * (1 - HORIZON) - (MAST - CAM_H) * (FOCAL / z) * h;
        ctx.fillStyle = '#ffcf8a';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.5, 60 / z), 0, Math.PI * 2);
        ctx.fill();
      }
      return true;
    },
    onMoment() {},
    toll() {},
    describe: () => 'canvas fallback (no WebGL)',
  };
}
