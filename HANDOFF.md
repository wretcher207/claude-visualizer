# Handoff

Status 2026-10-15: phase 1 done and approved. David watched the poster Sea, said it feels right, and asked for a few tweaks, which are in. Next is planning phase 2 with him. Committed locally on `prompt-is-prologue`, not pushed.

## Start here (fresh chat)

1. Read `AGENTS.md` (rules), `PLAN.md` (the locked plan and every product decision), then this file.
2. The next job is planning phase 2 with David, not building it. Bring him the open decisions below in one short batch, settle them, write the result into `PLAN.md`, then build.
3. To see the current state: double-click `web/open-demo.cmd` (or run `node web/serve.cjs`) and open http://127.0.0.1:5178/web/, then click once. In the Claude app, the workspace launch config has a `prologue` preview entry. 16x runs a day in minutes; D opens the debug panel with a time-of-day slider.

## Where things stand

- Branch `prompt-is-prologue`, from `main` at `ee9a4de`. Phase 1 is committed locally and not pushed. The repo is public: push only when David says so.
- Phase 1 of `PLAN.md` is built in `web/`: the world model (`src/world.js`), the seeded demo day (`src/demo.js`), the shared audio engine (`src/audio/`), and the Sea vibe (`src/sea/`). Zero dependencies, no build step.
- The old Claude Visualizer (`server.js`, `hook.js`, `lib/`, `public/`, `start.bat`, `start.vbs`) is untouched and still listens on the whole network if started. Phase 2 removes it. Don't run `npm start`.
- `design-refs/` holds David's four Tycho reference images for mood. It is excluded from git locally (`.git/info/exclude`) and must never be committed.
- `web/src/sea/scene-photo.js` and `palette-photo.js` are the first, photographic look, kept for reference and not loaded.

## How Sea got here

- First pass: realistic water, sailboats with lanterns. David's verdict: boats just faded in, and it felt flat, lifeless and too realistic.
- He then chose: graphic poster look, boats born out of the sun, paper boats, and all four "alive" layers (sun breathes, light streaks, floating shapes, moving color). That rebuild is what he approved.
- Tweaks after approval (2026-10-15): sun breathing slightly more, light leak slightly stronger, faint streaks even when calm, closest boats slightly bigger, and floating shapes that wander and now and then swap for a new shape. On the shapes he said "that's fine" to the suggestion; if he meant "leave them as they were", revert by restoring the fixed-position drift in `pack()`.

## What Sea does now

- Look: a screen print. Sky in eight flat stepped bands, a big flat sun with stepped halo rings sitting down into the sea, water in three flat depth bands with flowing crest and trough dashes, and the sun's reflection as a thin seam opening into glitter bars. Print grain and paper mottle over everything. Renders at full resolution, 30 fps.
- Time of day follows total work since the last dawn (`dayWorkTau` 500 in `world.js`): dawn (pastel), day (deep blue sky, cream sun, red, orange and mustard sea; the mood of Tycho's "Awake" with no road), golden hour, pink dusk, night (indigo, crescent moon, stars). 45 minutes of quiet everywhere brings the next dawn.
- Each session is a paper boat born inside the sun: a ring bursts from the sun, the boat unfolds as a silhouette against it, sails out toward you along its lane and turns paper-colored. It's halfway after about 150 tool calls (`journeyWorkTau` 220). Newborns spread across the sun's face. Ending or 20 minutes idle sends the boat back into the sun.
- Subagents shoot up as streaks, hover over their boat as four-point twinkles that flare with their tool calls, and streak home.
- Waiting on David: buoy bell (F#5 then C#5, every 18 s); the boat flashes, rocks, and stepped rings open on the water, on the same clock.
- Compaction: the sail folds down and the boat dims; it refolds with a hop and a flash afterward.
- Night: paper boats glow from inside like lanterns.
- Alive: the sun swells with the pad's breathing and pulses with every note, as does the boat whose note it is; streaks rake the sky (faint about every 8 s when calm, more and brighter when busy); seven thin shapes wander and swap one at a time every 6 to 12 minutes; colors drift slowly in hue; two warm light leaks wander. Dials: `tune` in `scene.js` (`leak` 3.2, `hue` 0.12, `breath` 1); breathing strength is in the shader (`0.09` disk, `0.42` rings).
- Sound: breathing F# pentatonic pad, soft FM keys per boat register, airy tones for subagents, the buoy bell, optional surf (on by default, switchable, remembered). Notes pan and recede with the boat's position.

## Small things David hasn't decided (leave as is unless he raises them)

- The waiting bell rings every 18 s until answered. Suggested: ring less and less, then stop after a few minutes while the rings on the water continue. He didn't respond to this one.
- Note density (about one note a second with two sessions), surf on by default, and day pacing (dusk after about 2 hours of heavy work, night after about 6). No changes requested.

## Phase 2: decisions to bring to David in one batch

Already decided in `PLAN.md`: Tauri app, tray icon until clicked, starts at login, cross-platform, local-only listener with a secret key, the app adds its own hooks on first run and shows exactly what it changed, uninstall removes exactly those, the old server, analytics and logging go away.

Still open:
1. What clicking the tray icon opens: a normal window that remembers its size and place, or a borderless full-screen view.
2. When the window is closed, does the music keep playing from the tray? (Likely yes, since hearing Claude work is the point, but ask.)
3. The tray menu: for example Open, Mute, Pause, Demo, Quit. Plus what the tray icon looks like (creative, ask).
4. If the old Claude Visualizer's hooks are found in his settings, should the app offer to remove them?
5. Whether demo mode stays available inside the app (from the tray) for showing it off when Claude is idle.
6. Unsigned builds show warnings: Windows SmartScreen as well as Mac. Ship unsigned first and decide on signing later, as `PLAN.md` says, or revisit now.

## Phase 2 technical notes

- Hook facts gathered 2026-10-15 from the Claude Code docs (re-check before building): HTTP hooks look like `{"type": "http", "url": "...", "timeout": N, "headers": {...}}`. The default timeout is 600 s, so set 1 to 2 s. Non-2xx responses and connection failures don't block Claude. `SessionStart` and `Setup` can't use HTTP hooks; the world doesn't need them.
- Events the world handles: UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied, Notification, Elicitation, ElicitationResult, SubagentStart, SubagentStop, PreCompact, PostCompact, Stop, StopFailure, SessionEnd.
- Check whether the Claude desktop app's sessions read the same `~/.claude/settings.json` hooks as the CLI.
- Wiring: `main.js` creates `DemoSource`. Phase 2 adds a live source (for example `src/live.js`) fed by the Tauri listener, with demo as a fallback or a tray choice. The web layer stays framework-free so the same files ship in the app and on the demo page.
- Guard needed: the scene's `boatFor()` creates a boat for any moment that names a traveler, including `traveler:gone` or a toll for a session it never drew. Harmless in the demo; live, it could fire a sun burst for a boat that never appeared.
- `workspace/lightcut` is a working Tauri v2 app on this machine; reuse its setup. Rendering inside a Tauri webview (WebView2 on Windows, WebKitGTK on Linux) is untested.
- Background timers: the page uses a worker ticker so music keeps going when hidden. Re-check this inside the webview.

## Verified (2026-10-15)

- `node --test "web/test/*.test.js"`: 8 pass.
- Levels before and after the limiter: peaks into the limiter −9 dB at 1x and −5.6 to −8.7 dB at 16x, nothing at the −2 dB threshold, no ceiling hits, 32-voice cap holds, 0 out-of-key notes. Default volume sits about 10 dB under streaming music, on purpose.
- Note pulses reach the picture and the breath value tracks the pad.
- With the Browser pane hidden, the worker ticker held 20 updates a second and notes kept scheduling.
- Headless Chrome at 1920x1080 on the HD 530: old visualizer 176% of one core and 73% GPU; first-pass Sea 27% and 26% (at 1000 px); poster Sea about 18.5% and 4.5% at full 1920 px. Not re-measured after the last tweaks, which add no meaningful work.
- Stills and forced frames: the birth beats, every time of day, waiting rings, a resting boat, subagent twinkles, departure into the sun, newborns side by side, calm streaks (7 a minute at zero energy), shapes swapping after about 5 minutes. Clean console.

## Not verified

- Sound by ear. Levels and key are measured; only David can judge the music.
- Live motion in a visible window. The Claude Browser pane was hidden during work, so checks used stills and forced frames. David has watched it and approved.
- Firefox, Safari, Linux, phones, and the Tauri webviews.

## Decisions made while building

- Typography is a system font stack for now; the real typeface is a release-phase decision.
- No "glue" compressor: the browser's compressor adds about +7 dB of make-up gain. Master is trim (2), limiter at −2 dB, soft clip.
- The day palette borrows the mood of "Awake" but deliberately has no converging road, so it isn't a copy of the artwork.
- The demo uses seed 207 and paces about 500 tool calls an hour across about three sessions. Demo speed isn't remembered between visits; volume and surf are.
