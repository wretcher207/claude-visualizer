// The shared audio engine: one AudioContext, a master chain that cannot clip,
// reverb and delay spaces, gentle tape wobble, a cap on ringing voices, and a
// meter. Vibes build their sound on top of this.

import { inKey, gainToDb } from './music.js';

const MAX_VOICES = 32;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.voices = [];
    this.volume = 0.8;
    this.muted = false;
    this.stats = {
      notes: 0,
      outOfKey: 0,
      stolen: 0,
      ceilingHits: 0,
      peak: 0,
      peakHold: 0,
      maxPeak: 0,
      rms: 0,
      reduction: 0,
      maxReduction: 0,
    };
  }

  get ready() {
    return Boolean(this.ctx);
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'playback' });
    this.ctx = ctx;

    // ---- Master: mix -> trim -> limiter -> soft clip -> volume -> out ----
    // The browser's compressor adds its own make-up gain (about +1 dB at
    // these settings); the trim sets the overall level with that in mind. A gentler "glue"
    // compressor would add +7 dB or more, which is why there isn't one.
    this.mix = ctx.createGain();
    this.trim = ctx.createGain();
    this.trim.gain.value = 2;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;

    this.clipper = ctx.createWaveShaper();
    this.clipper.curve = softClipCurve();
    this.clipper.oversample = '2x';

    this.output = ctx.createGain();
    this.output.gain.value = this.muted ? 0 : this.volume * this.volume;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.meterBuf = new Float32Array(this.analyser.fftSize);
    this.preAnalyser = ctx.createAnalyser();
    this.preAnalyser.fftSize = 2048;

    this.mix.connect(this.trim);
    this.trim.connect(this.limiter);
    this.trim.connect(this.preAnalyser);
    this.limiter.connect(this.clipper);
    this.clipper.connect(this.output);
    this.clipper.connect(this.analyser);
    this.output.connect(ctx.destination);

    // ---- Instrument bus with a slow tape wobble ----
    this.instrBus = ctx.createGain();
    const wobble = ctx.createDelay(0.05);
    wobble.delayTime.value = 0.012;
    lfo(ctx, 0.33, 0.0011).connect(wobble.delayTime);
    lfo(ctx, 0.071, 0.0008).connect(wobble.delayTime);
    this.instrBus.connect(wobble);
    wobble.connect(this.mix);

    // ---- Reverb: a long, darkening room ----
    this.reverbSend = ctx.createGain();
    const preDelay = ctx.createDelay(0.2);
    preDelay.delayTime.value = 0.028;
    const reverbHp = ctx.createBiquadFilter();
    reverbHp.type = 'highpass';
    reverbHp.frequency.value = 180;
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulse(ctx, 4.8, 2.6);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.85;
    this.reverbSend.connect(preDelay);
    preDelay.connect(reverbHp);
    reverbHp.connect(this.convolver);
    this.convolver.connect(this.reverbReturn);
    this.reverbReturn.connect(this.mix);

    // ---- Delay: soft ping-pong echoes that darken as they repeat ----
    this.delaySend = ctx.createGain();
    const delayHp = ctx.createBiquadFilter();
    delayHp.type = 'highpass';
    delayHp.frequency.value = 300;
    const left = ctx.createDelay(2);
    const right = ctx.createDelay(2);
    left.delayTime.value = 0.44;
    right.delayTime.value = 0.44;
    const fbLR = ctx.createGain();
    const fbRL = ctx.createGain();
    fbLR.gain.value = 0.42;
    fbRL.gain.value = 0.42;
    const lpLR = lowpass(ctx, 2400);
    const lpRL = lowpass(ctx, 2000);
    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.value = -0.7;
    panR.pan.value = 0.7;
    this.delayReturn = ctx.createGain();
    this.delayReturn.gain.value = 0.8;
    this.delaySend.connect(delayHp);
    delayHp.connect(left);
    left.connect(panL);
    left.connect(fbLR);
    fbLR.connect(lpLR);
    lpLR.connect(right);
    right.connect(panR);
    right.connect(fbRL);
    fbRL.connect(lpRL);
    lpRL.connect(left);
    panL.connect(this.delayReturn);
    panR.connect(this.delayReturn);
    this.delayReturn.connect(this.mix);
    const delayToVerb = ctx.createGain();
    delayToVerb.gain.value = 0.25;
    this.delayReturn.connect(delayToVerb);
    delayToVerb.connect(this.reverbSend);

    if (ctx.state === 'suspended') await ctx.resume();
  }

  // Connect a finished voice to the dry bus and the two spaces.
  route(node, { dry = 1, reverb = 0.3, delay = 0.15 } = {}) {
    const sends = [];
    for (const [dest, amount] of [[this.instrBus, dry], [this.reverbSend, reverb], [this.delaySend, delay]]) {
      if (amount <= 0) continue;
      const g = this.ctx.createGain();
      g.gain.value = amount;
      node.connect(g);
      g.connect(dest);
      sends.push(g);
    }
    return sends;
  }

  // Every note that sounds is counted and checked against the key.
  checkNote(midi) {
    this.stats.notes++;
    if (!inKey(midi)) {
      this.stats.outOfKey++;
      console.warn('Out of key note', midi);
    }
  }

  register(voice) {
    this.prune();
    this.voices.push(voice);
    while (this.voices.length > MAX_VOICES) {
      const oldest = this.voices.shift();
      oldest.kill(this.ctx.currentTime);
      this.stats.stolen++;
    }
  }

  prune() {
    const t = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > t);
  }

  activeVoices() {
    if (!this.ctx) return 0;
    this.prune();
    return this.voices.length;
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    this.applyOutput();
  }

  setMuted(muted) {
    this.muted = muted;
    this.applyOutput();
  }

  applyOutput() {
    if (!this.ctx) return;
    const target = this.muted ? 0 : this.volume * this.volume;
    this.output.gain.setTargetAtTime(target, this.ctx.currentTime, 0.12);
  }

  // Read the master level. Call a few times a second.
  meter() {
    if (!this.ctx) return this.stats;
    this.analyser.getFloatTimeDomainData(this.meterBuf);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < this.meterBuf.length; i++) {
      const v = this.meterBuf[i];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sum += v * v;
    }
    const s = this.stats;
    s.peak = peak;
    s.rms = Math.sqrt(sum / this.meterBuf.length);
    s.peakHold = Math.max(peak, s.peakHold * 0.92);
    s.maxPeak = Math.max(s.maxPeak, peak);
    if (peak > 0.95) s.ceilingHits++;
    this.preAnalyser.getFloatTimeDomainData(this.meterBuf);
    let pre = 0;
    for (let i = 0; i < this.meterBuf.length; i++) {
      const a = Math.abs(this.meterBuf[i]);
      if (a > pre) pre = a;
    }
    s.maxPrePeak = Math.max(s.maxPrePeak || 0, pre);
    s.reduction = this.limiter.reduction;
    s.maxReduction = Math.min(s.maxReduction, this.limiter.reduction);
    return s;
  }

  describeLevels() {
    const s = this.stats;
    return {
      peakDb: round1(gainToDb(s.peakHold)),
      maxPeakDb: round1(gainToDb(s.maxPeak)),
      maxIntoLimiterDb: round1(gainToDb(s.maxPrePeak || 0)),
      rmsDb: round1(gainToDb(s.rms)),
      // Chrome's reported reduction jumps around even when nothing is over
      // the threshold, so the level going into the limiter is the real check.
      limiterDb: round1(s.reduction),
      voices: this.activeVoices(),
      notes: s.notes,
      outOfKey: s.outOfKey,
      stolen: s.stolen,
      ceilingHits: s.ceilingHits,
    };
  }

  resetLevelStats() {
    Object.assign(this.stats, { maxPeak: 0, maxPrePeak: 0, maxReduction: 0, ceilingHits: 0, stolen: 0 });
  }

  noiseBuffer(seconds, seed = 1) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let s = seed >>> 0 || 1;
    // Pink-ish noise (Paul Kellet's filter), then normalized.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let max = 0;
    for (let i = 0; i < len; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      const white = ((s >>> 0) / 4294967296) * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = v;
      if (Math.abs(v) > max) max = Math.abs(v);
    }
    for (let i = 0; i < len; i++) data[i] /= max;
    // Crossfade the loop point so it never clicks.
    const fade = Math.floor(this.ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[i] = data[i] * k + data[len - fade + i] * (1 - k);
    }
    return buf;
  }
}

// Fade a parameter to zero from wherever it is right now.
export function fadeOut(param, at, timeConstant) {
  if (param.cancelAndHoldAtTime) {
    param.cancelAndHoldAtTime(at);
  } else {
    const v = param.value;
    param.cancelScheduledValues(at);
    param.setValueAtTime(v, at);
  }
  param.setTargetAtTime(0, at, timeConstant);
}

function lfo(ctx, rate, depth) {
  const osc = ctx.createOscillator();
  osc.frequency.value = rate;
  const g = ctx.createGain();
  g.gain.value = depth;
  osc.connect(g);
  osc.start();
  return g;
}

function lowpass(ctx, freq) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  f.Q.value = 0.3;
  return f;
}

// Unity gain below 0.7, then a smooth shoulder that never passes 0.97.
function softClipCurve() {
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a < 0.7 ? a : 0.7 + 0.27 * Math.tanh((a - 0.7) / 0.27);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

// A stereo room tail that gets darker as it fades, like a real space.
function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    let s = c ? 0x9e3779b9 : 0x7f4a7c15;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      const white = ((s >>> 0) / 4294967296) * 2 - 1;
      const k = 0.8 - 0.72 * t;
      lp += k * (white - lp);
      const attack = i < rate * 0.004 ? i / (rate * 0.004) : 1;
      data[i] = lp * Math.pow(1 - t, decay) * attack;
    }
  }
  return buf;
}

function round1(v) {
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : v;
}
