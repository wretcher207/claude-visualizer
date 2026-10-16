// Sea as a screen-printed poster: flat inks, a big sun, stepped gradients.
// 0 is dawn, 0.33 day, 0.66 dusk, 1 night, and 1.25 loops back to dawn.
// The day borrows the mood of Tycho's "Awake" poster (deep blue sky, cream
// sun, warm bands below); dusk follows the pink-sea reference. Colors are
// picked by eye, not sampled from the artwork.

const KEYS = [
  {
    at: 0,
    skyH: '#f7caa6', skyL: '#eaa6a4', skyHi: '#b59ac4', skyZ: '#7b80b6',
    sun: '#fff0cc', halo: '#ffd9b4',
    wFar: '#d6a3b0', wMid: '#9a83ab', wDeep: '#5c5a88', crest: '#f6cfb9', reflect: '#ffe6bf',
    paperL: '#faf3e6', paperS: '#dccdbd', sil: '#4b4670', glow: '#ffcf94',
    line: '#fff4e6', leak: '#ffb08a', star: '#ffffff',
    sunLift: 0.06, sunRadius: 0.15, moon: 0, stars: 0, lantern: 0, leakStrength: 0.18,
  },
  {
    at: 0.33,
    skyH: '#3a8fc4', skyL: '#2479b6', skyHi: '#146aa8', skyZ: '#0c5a95',
    sun: '#e4e5d4', halo: '#9cc3d8',
    wFar: '#b5412b', wMid: '#bf6618', wDeep: '#bc9127', crest: '#ecd9a6', reflect: '#e6e6d6',
    paperL: '#f1efe3', paperS: '#cbc8b6', sil: '#0b4c7c', glow: '#ffd8a2',
    line: '#eef0e0', leak: '#ffc27a', star: '#ffffff',
    sunLift: 0.07, sunRadius: 0.12, moon: 0, stars: 0, lantern: 0, leakStrength: 0.12,
  },
  {
    at: 0.5,
    skyH: '#f3c38a', skyL: '#e9a17c', skyHi: '#ab8db2', skyZ: '#5b70a7',
    sun: '#ffd27a', halo: '#ffc89a',
    wFar: '#d9774f', wMid: '#b2545e', wDeep: '#6b3c63', crest: '#f7c08a', reflect: '#ffe0a0',
    paperL: '#fff1df', paperS: '#e5c4ad', sil: '#4a2f50', glow: '#ffc98a',
    line: '#fff0dc', leak: '#ffb27a', star: '#ffffff',
    sunLift: 0.04, sunRadius: 0.15, moon: 0, stars: 0, lantern: 0.1, leakStrength: 0.2,
  },
  {
    at: 0.66,
    skyH: '#f6a596', skyL: '#e78aa0', skyHi: '#bb78a9', skyZ: '#6d5c92',
    sun: '#ff8a63', halo: '#ffb197',
    wFar: '#d0738c', wMid: '#8f4f7c', wDeep: '#4b2e5b', crest: '#ffa492', reflect: '#ffb791',
    paperL: '#ffe8de', paperS: '#e4b6b8', sil: '#3a2346', glow: '#ffc78e',
    line: '#ffe6dd', leak: '#ff9478', star: '#ffffff',
    sunLift: 0.015, sunRadius: 0.17, moon: 0, stars: 0.05, lantern: 0.25, leakStrength: 0.22,
  },
  {
    at: 1,
    skyH: '#4b3c76', skyL: '#362d64', skyHi: '#221f4e', skyZ: '#11133a',
    sun: '#f2e8d0', halo: '#6a5c9c',
    wFar: '#3c3269', wMid: '#241f4b', wDeep: '#120f2b', crest: '#5f50a0', reflect: '#efe2c4',
    paperL: '#ffdca2', paperS: '#eaa86a', sil: '#0d0b22', glow: '#ffb35f',
    line: '#cfc8ff', leak: '#6f56c4', star: '#fffaf0',
    sunLift: 0.06, sunRadius: 0.1, moon: 0.55, stars: 1, lantern: 1, leakStrength: 0.14,
  },
];

const LOOP = { ...KEYS[0], at: 1.25 };
const ALL = [...KEYS, LOOP];
const COLOR_KEYS = ['skyH', 'skyL', 'skyHi', 'skyZ', 'sun', 'halo', 'wFar', 'wMid', 'wDeep', 'crest', 'reflect', 'paperL', 'paperS', 'sil', 'glow', 'line', 'leak', 'star'];
const NUMBER_KEYS = ['sunLift', 'sunRadius', 'moon', 'stars', 'lantern', 'leakStrength'];

const parsed = ALL.map((k) => {
  const out = { at: k.at };
  for (const c of COLOR_KEYS) out[c] = hexToRgb(k[c]);
  for (const n of NUMBER_KEYS) out[n] = k[n];
  return out;
});

export const PALETTE_COLORS = COLOR_KEYS;

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
  return out;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
