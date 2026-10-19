// The musical ground every vibe stands on: F# major pentatonic, the key the
// original visualizer used. Every pitch that sounds is checked against it.

export const TONIC = 54; // F#3 as a MIDI note
export const PENTATONIC = [0, 2, 4, 7, 9]; // F#, G#, A#, C#, D#

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function pitchClass(midi) {
  return (((midi - TONIC) % 12) + 12) % 12;
}

export function inKey(midi) {
  return PENTATONIC.includes(pitchClass(midi));
}

// Every note of a chord's voicing, spread over a register.
export function chordTones(chord, low, high) {
  const classes = new Set([...chord.pad, chord.bass].map(pitchClass));
  const out = [];
  for (let m = low; m <= high; m++) if (classes.has(pitchClass(m))) out.push(m);
  return out;
}

export function nearestIndex(pool, midi) {
  let best = 0;
  for (let i = 1; i < pool.length; i++) {
    if (Math.abs(pool[i] - midi) < Math.abs(pool[best] - midi)) best = i;
  }
  return best;
}

export function dbToGain(db) {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain) {
  return gain > 0 ? 20 * Math.log10(gain) : -Infinity;
}
