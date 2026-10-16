# Prompt Is Prologue (was Claude Visualizer)

Ambient scenes and music that follow Claude Code while it works. Each running session is a traveler in a shared landscape; the scene and its sound are built as one piece. The plan, every product decision and the phase order are in `PLAN.md`. Current state is in `HANDOFF.md`.

## Layout

- `web/` is the new project: a plain web layer with no framework and no dependencies, written as ES modules. The same files will run inside the Tauri app (phase 2) and on the public demo page.
  - `src/world.js` turns raw hook events into travelers, subagents, energy and the day's progress. It knows nothing about drawing or sound.
  - `src/demo.js` generates a seeded, realistic day of hook events in the exact shape of real payloads.
  - `src/audio/` is the shared engine (master chain, spaces, voice cap, meter) and instruments.
  - `src/sea/` is the Sea vibe: `scene.js` (WebGL poster scene), `palette.js` (time of day), `sound.js`. `scene-photo.js` and `palette-photo.js` are the first-pass photographic look, kept for reference and not loaded.
  - `test/` holds node's built-in test runner tests.
- `src-tauri/` is the Tauri app (phase 2): a thin shell that embeds `web/` unchanged. `src-tauri/tools/perf.ps1` measures the running app's CPU and GPU share.
- `server.js`, `hook.js`, `lib/` and `public/` are the old Claude Visualizer. Leave them alone until phase 2 replaces them.
- `design-refs/` holds David's Tycho reference images for mood only. It is excluded from git locally and must never be committed or copied into the project.

## Run and test

- Double-click `web/open-demo.cmd`, or run `node web/serve.cjs`, then open http://127.0.0.1:5178/web/ and click to begin.
- `node --test "web/test/*.test.js"` runs the world and demo tests.
- Press D for the debug panel: time-of-day and energy overrides, frame rate, levels, voice count, out-of-key count.
- URL options: `?autostart`, `?day=0.66`, `?energy=0.5`, `?speed=16`.
- `web/tools/perf.ps1` measures CPU and GPU share in headless Chrome on the real GPU.
- The app: `npm install` once, then `npm run tauri build -- --no-bundle` and run `src-tauri/target/release/prompt-is-prologue.exe`. Check things on that build; `npm run tauri dev` serves `web/` through the CLI's own server, which injects a reload script.

## Rules

- No dependencies, no build step, no CDN or runtime font fetches. The app must work offline.
- Sea's look is a graphic poster (flat inks, stepped gradients, a big sun), chosen by David. Surreal beats realistic. Boats are paper boats born from the sun.
- Every pitch is F# major pentatonic. The engine counts out-of-key notes; it must stay at zero. Phrase notes come from the pad chord sounding at that moment.
- A vibe's scene and sound are designed together and share placement: a traveler's notes pan and recede with its light.
- Nothing in the audio path may depend on `requestAnimationFrame`. World time and scheduling run on the worker ticker so music keeps going when the window is hidden. Drawing pauses when hidden. In the app the page only counts as hidden when the webview is hidden (`Webview::hide`); minimizing or hiding the window alone keeps it drawing.
- GPU budget: always-on visuals must stay light on weak integrated graphics. The yardstick is the Intel HD 530 David's PC had until 2026-10-15: stay under about a quarter of its 3D engine. The poster Sea used about 5% there at full 1920 px and 30 fps; the photographic first pass needed 26% at 1000 px. David's PC now has a GTX 1060, whose percentages move with its clock, so measure a new visual against the poster Sea at the same clock (`web/tools/perf.ps1` for a page, `src-tauri/tools/perf.ps1` for the app, `nvidia-smi` for the clock) and keep it near Sea's cost.
- Don't rely on `SessionStart`: HTTP hooks can't deliver it. A traveler is born on the first event from an unseen session id.
- The browser's DynamicsCompressor adds its own make-up gain, and its `reduction` reading is unreliable. Check the level going into the limiter instead.
- UI copy: no em dashes. Final public copy goes through the david-voice agent in the release phase.
- Creative choices David hasn't made (looks, sounds, copy, structure) get asked about in one batch before building.
