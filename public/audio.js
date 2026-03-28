/* ==========================================================================
   Audio Engine — Generative ambient music in F# major pentatonic
   Inspired by Tycho's "A Walk" — warm, dreamy, exploratory

   Each tool event triggers a mini melodic phrase, not just a single note.
   Notes cascade, echo, and layer into evolving generative music.
   F# pentatonic means everything harmonizes no matter what — you literally
   cannot hit a wrong note.
   ========================================================================== */

(function () {
  'use strict';

  // ---- State ----
  let ctx = null;
  let masterGain = null;
  let padGain = null;
  let delayNode = null;
  let delayFeedback = null;
  let reverbNode = null;
  let isMuted = false;
  let isInitialized = false;
  let padOscillators = [];

  // Master volume
  const MASTER_VOLUME = 0.30;
  const PAD_VOLUME = 0.05;

  // ---- F# Major Pentatonic Scale ----
  // Full palette of notes across 3 octaves to draw from
  const SCALE = [
    // Octave 3 (deep, warm)
    185.00,  // F#3
    207.65,  // G#3
    233.08,  // A#3
    277.18,  // C#4
    311.13,  // D#4
    // Octave 4 (sweet spot)
    369.99,  // F#4
    415.30,  // G#4
    466.16,  // A#4
    554.37,  // C#5
    622.25,  // D#5
    // Octave 5 (bright, airy)
    739.99,  // F#5
    830.61,  // G#5
    932.33,  // A#5
  ];

  // Index ranges for different registers
  const LOW = [0, 1, 2, 3, 4];          // F#3 — D#4
  const MID = [3, 4, 5, 6, 7, 8];       // C#4 — C#5
  const HIGH = [7, 8, 9, 10, 11, 12];   // A#4 — A#5

  // ---- Tool → Musical personality ----
  // Each tool has a register preference and a pattern style
  const TOOL_VOICES = {
    // Exploration tools — gentle ascending arpeggios
    Read:          { register: MID,  style: 'arpUp',    notes: 3, velocity: 0.5 },
    Glob:          { register: MID,  style: 'arpUp',    notes: 2, velocity: 0.45 },
    Grep:          { register: MID,  style: 'arpDown',  notes: 3, velocity: 0.5 },
    WebFetch:      { register: HIGH, style: 'arpUp',    notes: 3, velocity: 0.45 },
    WebSearch:     { register: HIGH, style: 'scatter',  notes: 3, velocity: 0.45 },

    // Creation tools — richer, fuller phrases
    Edit:          { register: MID,  style: 'arpDown',  notes: 3, velocity: 0.6 },
    Write:         { register: MID,  style: 'chord',    notes: 3, velocity: 0.6 },
    Bash:          { register: MID,  style: 'pulse',    notes: 2, velocity: 0.55 },
    Skill:         { register: MID,  style: 'arpUp',    notes: 2, velocity: 0.5 },
    TodoWrite:     { register: LOW,  style: 'arpUp',    notes: 2, velocity: 0.45 },

    // Big events — wide chords, more notes
    Agent:         { register: HIGH, style: 'bloom',    notes: 5, velocity: 0.75 },
    SubagentStart: { register: HIGH, style: 'bloom',    notes: 4, velocity: 0.65 },
    Plan:          { register: LOW,  style: 'chord',    notes: 3, velocity: 0.6 },
    EnterPlanMode: { register: LOW,  style: 'chord',    notes: 3, velocity: 0.55 },
    ExitPlanMode:  { register: MID,  style: 'arpUp',    notes: 3, velocity: 0.55 },

    _default:      { register: MID,  style: 'arpUp',    notes: 2, velocity: 0.5 },
  };

  // ---- Utility ----
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function pickN(arr, n) {
    // Pick n unique random items from arr
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(n, arr.length));
  }

  function pickConsecutive(arr, n, direction) {
    // Pick n consecutive indices starting from a random point
    const start = Math.floor(Math.random() * (arr.length - n + 1));
    const indices = [];
    for (let i = 0; i < n; i++) {
      indices.push(arr[direction === 'down' ? (arr.length - 1 - start - i) : (start + i)]);
    }
    return indices;
  }

  // ---- Generate reverb impulse ----
  function createReverbImpulse(duration, decay) {
    const length = ctx.sampleRate * duration;
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  // ---- Create stereo delay (echo) ----
  // Gives that spacious Tycho delay-tail feel
  function createDelay() {
    delayNode = ctx.createDelay(2.0);
    delayNode.delayTime.value = 0.375; // Dotted eighth feel at ~80bpm

    delayFeedback = ctx.createGain();
    delayFeedback.gain.value = 0.35; // Each echo is 35% quieter

    // Filter the delay to make echoes warmer (roll off highs)
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 2000;
    delayFilter.Q.value = 0.5;

    // Delay -> filter -> feedback -> delay (loop)
    delayNode.connect(delayFilter);
    delayFilter.connect(delayFeedback);
    delayFeedback.connect(delayNode);

    // Output the delay to master
    delayFilter.connect(masterGain);
  }

  // ---- Warm pad drone ----
  function startPad() {
    if (!ctx || padOscillators.length > 0) return;

    padGain = ctx.createGain();
    padGain.gain.value = isMuted ? 0 : PAD_VOLUME;
    padGain.connect(masterGain);

    // F#2 fundamental
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 92.50;
    osc1.connect(padGain);
    osc1.start();

    // C#3 — perfect fifth above
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 138.59;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.35;
    osc2.connect(osc2Gain);
    osc2Gain.connect(padGain);
    osc2.start();

    // F#3 — octave above fundamental, very quiet
    const osc3 = ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.value = 185.00;
    const osc3Gain = ctx.createGain();
    osc3Gain.gain.value = 0.15;
    osc3.connect(osc3Gain);
    osc3Gain.connect(padGain);
    osc3.start();

    // Breathing LFO
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.06; // One breath every ~16 seconds
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = PAD_VOLUME * 0.35;
    lfo.connect(lfoGain);
    lfoGain.connect(padGain.gain);
    lfo.start();

    padOscillators = [osc1, osc2, osc3, lfo];
  }

  // ---- Play a single voice (one note with harmonics + bass octave + envelope) ----
  function playVoice(frequency, velocity, startTime, decay) {
    if (!ctx || isMuted) return;

    decay = decay || 4.0;
    const detune = (Math.random() - 0.5) * 8;

    // Sub bass — one octave below the fundamental
    // Rounder, softer, longer decay — sits underneath like a warm blanket
    const oscBass = ctx.createOscillator();
    oscBass.type = 'sine';
    oscBass.frequency.value = frequency / 2;
    oscBass.detune.value = detune * 0.5; // Less detune on bass for stability

    // Fundamental
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = frequency;
    osc1.detune.value = detune;

    // Octave harmonic — bell brightness
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = frequency * 2;
    osc2.detune.value = detune + (Math.random() - 0.5) * 6;

    // Third partial — shimmer
    const osc3 = ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.value = frequency * 3;
    osc3.detune.value = detune + (Math.random() - 0.5) * 10;

    const gainBass = ctx.createGain();
    const gain1 = ctx.createGain();
    const gain2 = ctx.createGain();
    const gain3 = ctx.createGain();
    gainBass.gain.value = 0;
    gain1.gain.value = 0;
    gain2.gain.value = 0;
    gain3.gain.value = 0;

    const peak = 0.18 * velocity;

    // Anchor the automation timeline so ramps have a defined start point
    gainBass.gain.setValueAtTime(0, startTime);
    gain1.gain.setValueAtTime(0, startTime);
    gain2.gain.setValueAtTime(0, startTime);
    gain3.gain.setValueAtTime(0, startTime);

    // Bass envelope — slightly slower attack, longer decay for warmth
    gainBass.gain.linearRampToValueAtTime(peak * 0.45, startTime + 0.04);
    gainBass.gain.exponentialRampToValueAtTime(0.001, startTime + decay * 1.2);

    // Soft attack
    gain1.gain.linearRampToValueAtTime(peak, startTime + 0.025);
    gain2.gain.linearRampToValueAtTime(peak * 0.25, startTime + 0.025);
    gain3.gain.linearRampToValueAtTime(peak * 0.06, startTime + 0.025);

    // Long decay
    gain1.gain.exponentialRampToValueAtTime(0.001, startTime + decay);
    gain2.gain.exponentialRampToValueAtTime(0.001, startTime + decay * 0.75);
    gain3.gain.exponentialRampToValueAtTime(0.001, startTime + decay * 0.5);

    oscBass.connect(gainBass);
    osc1.connect(gain1);
    osc2.connect(gain2);
    osc3.connect(gain3);

    // Mix bus — split between dry, reverb, and delay
    const voiceBus = ctx.createGain();
    voiceBus.gain.value = 1.0;
    gainBass.connect(voiceBus);
    gain1.connect(voiceBus);
    gain2.connect(voiceBus);
    gain3.connect(voiceBus);

    // Dry path
    const dryGain = ctx.createGain();
    dryGain.gain.value = 0.45;
    voiceBus.connect(dryGain);
    dryGain.connect(masterGain);

    // Reverb send
    if (reverbNode) {
      const reverbSend = ctx.createGain();
      reverbSend.gain.value = 0.35;
      voiceBus.connect(reverbSend);
      reverbSend.connect(reverbNode);
    }

    // Delay send — this creates the echoing cascades
    if (delayNode) {
      const delaySend = ctx.createGain();
      delaySend.gain.value = 0.25;
      voiceBus.connect(delaySend);
      delaySend.connect(delayNode);
    }

    oscBass.start(startTime);
    osc1.start(startTime);
    osc2.start(startTime);
    osc3.start(startTime);
    oscBass.stop(startTime + decay * 1.2 + 0.5);
    osc1.stop(startTime + decay + 0.5);
    osc2.stop(startTime + decay * 0.75 + 0.5);
    osc3.stop(startTime + decay * 0.5 + 0.5);
  }

  // ---- Pattern generators ----
  // Each returns an array of { freq, time, velocity, decay }

  // Ascending arpeggio — notes climb up the scale
  function patternArpUp(register, noteCount, velocity) {
    const indices = pickConsecutive(register, noteCount, 'up');
    const spacing = 0.12 + Math.random() * 0.15; // 120-270ms between notes
    return indices.map((idx, i) => ({
      freq: SCALE[idx],
      time: i * spacing,
      velocity: velocity * (0.85 + i * 0.05), // Slightly louder as it climbs
      decay: 3.5 + Math.random() * 1.5,
    }));
  }

  // Descending arpeggio — notes drift downward
  function patternArpDown(register, noteCount, velocity) {
    const indices = pickConsecutive(register, noteCount, 'down');
    const spacing = 0.15 + Math.random() * 0.12;
    return indices.map((idx, i) => ({
      freq: SCALE[idx],
      time: i * spacing,
      velocity: velocity * (1.0 - i * 0.08), // Softer as it descends
      decay: 3.0 + Math.random() * 2.0,
    }));
  }

  // Chord — multiple notes at once, slightly staggered for warmth
  function patternChord(register, noteCount, velocity) {
    const indices = pickN(register, noteCount);
    return indices.map((idx, i) => ({
      freq: SCALE[idx],
      time: i * 0.03, // Barely staggered — sounds like a chord
      velocity: velocity * (0.7 + Math.random() * 0.3),
      decay: 4.0 + Math.random() * 2.0,
    }));
  }

  // Scatter — notes placed randomly in time, exploratory
  function patternScatter(register, noteCount, velocity) {
    const indices = pickN(register, noteCount);
    return indices.map((idx) => ({
      freq: SCALE[idx],
      time: Math.random() * 0.6, // Random within 600ms window
      velocity: velocity * (0.6 + Math.random() * 0.4),
      decay: 3.0 + Math.random() * 2.0,
    }));
  }

  // Pulse — quick rhythmic repetition of one or two notes
  function patternPulse(register, noteCount, velocity) {
    const idx = pick(register);
    const result = [];
    for (let i = 0; i < noteCount; i++) {
      result.push({
        freq: SCALE[idx + (i % 2 === 1 && idx + 2 < SCALE.length ? 2 : 0)],
        time: i * 0.18,
        velocity: velocity * (i === 0 ? 1.0 : 0.6),
        decay: 2.5,
      });
    }
    return result;
  }

  // Bloom — big, wide, notes ripple outward from center
  function patternBloom(register, noteCount, velocity) {
    const indices = pickN(register, noteCount);
    // Sort by pitch for a nice spread
    indices.sort((a, b) => a - b);
    const mid = Math.floor(indices.length / 2);
    return indices.map((idx, i) => {
      const distFromCenter = Math.abs(i - mid);
      return {
        freq: SCALE[idx],
        time: distFromCenter * 0.1, // Center notes first, outer notes later
        velocity: velocity * (1.0 - distFromCenter * 0.08),
        decay: 5.0 + Math.random() * 2.0, // Extra long decay for big events
      };
    });
  }

  // Pattern dispatcher
  const PATTERNS = {
    arpUp:   patternArpUp,
    arpDown: patternArpDown,
    chord:   patternChord,
    scatter: patternScatter,
    pulse:   patternPulse,
    bloom:   patternBloom,
  };

  // ---- Play a full tool phrase ----
  function playToolPhrase(toolName) {
    if (!ctx || isMuted) return;

    const voice = TOOL_VOICES[toolName] || TOOL_VOICES._default;
    const patternFn = PATTERNS[voice.style] || PATTERNS.arpUp;
    const notes = patternFn(voice.register, voice.notes, voice.velocity);

    const now = ctx.currentTime;
    for (const note of notes) {
      playVoice(note.freq, note.velocity, now + note.time, note.decay);
    }
  }

  // ---- Initialize ----
  function init() {
    if (isInitialized) return;

    ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Browsers suspend AudioContext until a user gesture — resume it
    if (ctx.state === 'suspended') ctx.resume();

    masterGain = ctx.createGain();
    masterGain.gain.value = MASTER_VOLUME;
    masterGain.connect(ctx.destination);

    // Reverb — spacious 3.5 second tail
    reverbNode = ctx.createConvolver();
    reverbNode.buffer = createReverbImpulse(3.5, 2.2);
    reverbNode.connect(masterGain);

    // Delay — warm echoes
    createDelay();

    // Pad drone
    startPad();

    isInitialized = true;
  }

  // ---- Public API ----
  window.AmbientAudio = {
    init: init,

    playToolSound: function (toolName) {
      if (!isInitialized) return;
      playToolPhrase(toolName);
    },

    toggleMute: function () {
      if (!ctx) return false;
      isMuted = !isMuted;

      const now = ctx.currentTime;
      if (isMuted) {
        masterGain.gain.linearRampToValueAtTime(0, now + 0.5);
        if (padGain) padGain.gain.linearRampToValueAtTime(0, now + 0.5);
      } else {
        masterGain.gain.linearRampToValueAtTime(MASTER_VOLUME, now + 0.5);
        if (padGain) padGain.gain.linearRampToValueAtTime(PAD_VOLUME, now + 0.5);
      }

      return isMuted;
    },

    isMuted: function () { return isMuted; },
    isReady: function () { return isInitialized; },
  };
})();
