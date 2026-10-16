// Controls, keyboard, auto-hide and the debug panel (press D).

const STORE_KEY = 'prologue-settings';

export function createUi({ engine, sound, state, begin, frameStats, world, scene, shownPhase, shownEnergy }) {
  const $ = (id) => document.getElementById(id);
  const intro = $('intro');
  const controls = $('controls');
  const debug = $('debug');
  const volume = $('volume');
  const mute = $('mute');
  const wash = $('wash');
  const speedButtons = [...document.querySelectorAll('.speed button')];

  const saved = load();
  if (typeof saved.volume === 'number') volume.value = String(saved.volume);
  engine.setVolume(Number(volume.value));
  if (typeof saved.wash === 'boolean') {
    sound.setWash(saved.wash);
    wash.setAttribute('aria-pressed', String(saved.wash));
  }
  setSpeed(1);

  async function start() {
    intro.classList.add('gone');
    controls.hidden = false;
    await begin();
    poke();
  }

  intro.addEventListener('click', start, { once: true });

  volume.addEventListener('input', () => {
    engine.setVolume(Number(volume.value));
    if (engine.muted) toggleMute(false);
    save({ volume: Number(volume.value) });
  });

  mute.addEventListener('click', () => toggleMute());
  wash.addEventListener('click', () => {
    const on = wash.getAttribute('aria-pressed') !== 'true';
    wash.setAttribute('aria-pressed', String(on));
    sound.setWash(on);
    save({ wash: on });
  });
  $('fullscreen').addEventListener('click', toggleFullscreen);
  for (const b of speedButtons) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));

  function toggleMute(force) {
    const muted = typeof force === 'boolean' ? force : !engine.muted;
    engine.setMuted(muted);
    mute.setAttribute('aria-pressed', String(muted));
    mute.textContent = muted ? 'Muted' : 'Mute';
  }

  function setSpeed(speed) {
    state.speed = speed;
    for (const b of speedButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed));
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    const key = e.key.toLowerCase();
    if (!state.started && (key === ' ' || key === 'enter')) { start(); return; }
    if (key === 'm') toggleMute();
    else if (key === 'f') toggleFullscreen();
    else if (key === 'd') debug.hidden = !debug.hidden;
    else if (key === '1') setSpeed(1);
    else if (key === '2') setSpeed(4);
    else if (key === '3') setSpeed(16);
    poke();
  });

  // Hide the controls and cursor when the mouse rests.
  let idleTimer = null;
  function poke() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (state.started && debug.hidden) document.body.classList.add('idle');
    }, 3000);
  }
  window.addEventListener('pointermove', poke);

  // ---- Debug panel ----
  const day = $('dbg-day');
  const dayOut = $('dbg-day-out');
  const energy = $('dbg-energy');
  const energyOut = $('dbg-energy-out');
  day.addEventListener('input', () => {
    const v = Number(day.value);
    state.dayOverride = v < 0 ? null : v;
    dayOut.textContent = v < 0 ? 'auto' : v.toFixed(2);
  });
  energy.addEventListener('input', () => {
    const v = Number(energy.value);
    state.energyOverride = v < 0 ? null : v;
    energyOut.textContent = v < 0 ? 'auto' : v.toFixed(2);
  });

  const stats = $('dbg-stats');
  setInterval(() => {
    if (engine.ready) engine.meter();
    if (debug.hidden) return;
    const lv = engine.ready ? engine.describeLevels() : null;
    const lines = [
      `frame   ${frameStats.fps.toFixed(0)} fps  ${frameStats.cpuMs.toFixed(2)} ms cpu`,
      `render  ${scene.describe()}`,
      `world   ${(state.worldNow / 60000).toFixed(1)} min  x${state.speed}`,
      `day     ${shownPhase().toFixed(3)}  target ${world.daylightTarget().toFixed(3)}`,
      `energy  ${shownEnergy().toFixed(3)}`,
      `boats   ${world.travelers.size}  subs ${[...world.travelers.values()].reduce((n, t) => n + t.subs.size, 0)}`,
    ];
    if (lv) {
      lines.push(
        `peak    ${lv.peakDb} dB  max ${lv.maxPeakDb} dB`,
        `rms     ${lv.rmsDb} dB`,
        `into limiter  max ${lv.maxIntoLimiterDb} dB (limits above -2)`,
        `voices  ${lv.voices}  stolen ${lv.stolen}`,
        `notes   ${lv.notes}  out of key ${lv.outOfKey}`,
      );
    }
    stats.textContent = lines.join('\n');
  }, 120);

  return { setSpeed, toggleMute, start };
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
}

function save(patch) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...load(), ...patch }));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}
