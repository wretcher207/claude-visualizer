// FIRST PASS palette for scene-photo.js. Not loaded by the app.
// Sea, the light through the day. 0 is dawn, 0.33 hazy day, 0.66 dusk,
// 1 night, and 1.25 loops back to dawn. Colors were pulled by eye from
// the reference mood (pink dusk sky over dark water) and pushed toward
// Tycho's faded, warm-washed palette. Nothing is sampled from the artwork.

const KEYS = [
  {
    at: 0,
    zenith: '#6f7db0', mid: '#b9a6c8', horizon: '#f1c2a9', glow: '#ffb18a', haze: '#d8b2b6',
    sun: '#ffe1b0', sunElev: 3, sunAz: -22, sunSize: 0.032, sunPower: 1,
    cloudLit: '#ffc4a6', cloudShade: '#8d84ac', cloudCover: 0.44, glowStrength: 0.55,
    waterDeep: '#2c3350', reflect: 0.72, stars: 0, exposure: 1,
  },
  {
    at: 0.33,
    zenith: '#5c8d9b', mid: '#9db8b3', horizon: '#e9d3b1', glow: '#ffd59a', haze: '#d2cdb6',
    sun: '#fff0d2', sunElev: 15, sunAz: -4, sunSize: 0.028, sunPower: 0.85,
    cloudLit: '#fff2de', cloudShade: '#91a8a8', cloudCover: 0.36, glowStrength: 0.32,
    waterDeep: '#1f434c', reflect: 0.7, stars: 0, exposure: 1,
  },
  {
    at: 0.66,
    zenith: '#6c5a86', mid: '#a17ba1', horizon: '#eaa3a0', glow: '#ff8e78', haze: '#c88d9d',
    sun: '#ff9d80', sunElev: -3, sunAz: 18, sunSize: 0.04, sunPower: 0,
    cloudLit: '#ff8b77', cloudShade: '#98708f', cloudCover: 0.52, glowStrength: 0.75,
    waterDeep: '#211830', reflect: 0.55, stars: 0.04, exposure: 1,
  },
  {
    at: 1,
    zenith: '#0d1130', mid: '#1e1c44', horizon: '#3b2f5e', glow: '#5c3f79', haze: '#261f40',
    sun: '#000000', sunElev: -18, sunAz: 30, sunSize: 0.04, sunPower: 0,
    cloudLit: '#4a3e6d', cloudShade: '#14132b', cloudCover: 0.4, glowStrength: 0.28,
    waterDeep: '#06070f', reflect: 0.6, stars: 1, exposure: 1,
  },
];

const LOOP = { ...KEYS[0], at: 1.25 };
const ALL = [...KEYS, LOOP];
const COLOR_KEYS = ['zenith', 'mid', 'horizon', 'glow', 'haze', 'sun', 'cloudLit', 'cloudShade', 'waterDeep'];
const NUMBER_KEYS = ['sunElev', 'sunAz', 'sunSize', 'sunPower', 'cloudCover', 'glowStrength', 'reflect', 'stars', 'exposure'];

const parsed = ALL.map((k) => {
  const out = { at: k.at };
  for (const c of COLOR_KEYS) out[c] = hexToRgb(k[c]);
  for (const n of NUMBER_KEYS) out[n] = k[n];
  return out;
});

export function paletteAt(phase) {
  const p = Math.max(0, Math.min(1.25, phase));
  let i = 0;
  while (i < parsed.length - 2 && parsed[i + 1].at <= p) i++;
  const a = parsed[i];
  const b = parsed[i + 1];
  const raw = (p - a.at) / (b.at - a.at);
  const t = raw * raw * (3 - 2 * raw);
  const out = {};
  for (const c of COLOR_KEYS) out[c] = mixRgb(a[c], b[c], t);
  for (const n of NUMBER_KEYS) out[n] = a[n] + (b[n] - a[n]) * t;
  const elev = (out.sunElev * Math.PI) / 180;
  const az = (out.sunAz * Math.PI) / 180;
  out.sunDir = [Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)];
  return out;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
