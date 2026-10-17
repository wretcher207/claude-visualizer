# Handoff

Status 2026-10-17: phase 1 done and approved. Phase 2 step 1 (the app window) is done. Step 2, the listener, is built in `src-tauri/listener/` and wired into the app; its checks pass in a Linux build (below), and the Windows check on David's PC is still to do. The branch `prompt-is-prologue` is on GitHub.

Added 2026-10-16: mail bottles (David's email as messages in bottles on the Sea, plus a Mail panel) are designed and wait until phase 2 is done. Decisions are in `PLAN.md` under "Mail bottles"; the mail side lives outside this repo in `workspace/inbox-watcher`.

## Start here (fresh chat)

1. Read `AGENTS.md` (rules), `PLAN.md` (the locked plan and every product decision), then this file.
2. The next job is the Windows check of step 2 ("Phase 2 step 2: the listener" below), then step 3 of "Phase 2: the build order" in `PLAN.md` (the live scene). Step 1's results and the findings that change step 5 are in "Phase 2 step 1: the app window".
3. To see the current state: double-click `web/open-demo.cmd` (or run `node web/serve.cjs`) and open http://127.0.0.1:5178/web/, then click once. In the Claude app, the workspace launch config has a `prologue` preview entry. 16x runs a day in minutes; D opens the debug panel with a time-of-day slider.
4. To run the app: `npm install` once, then `npm run tauri build -- --no-bundle` and open `src-tauri/target/release/prompt-is-prologue.exe`.

## Where things stand

- Branch `prompt-is-prologue`, from `main` at `ee9a4de`, pushed to GitHub with no PR. The repo is public: push only when David says so.
- Phase 1 of `PLAN.md` is built in `web/`: the world model (`src/world.js`), the seeded demo day (`src/demo.js`), the shared audio engine (`src/audio/`), and the Sea vibe (`src/sea/`). Zero dependencies, no build step.
- Phase 2 step 2 is built in `src-tauri/listener/`, a small crate of its own (see "Phase 2 step 2: the listener").
- Phase 2 step 1 is built in `src-tauri/`: a bare Tauri app that opens `web/` unchanged. The root `package.json` gained `@tauri-apps/cli` as a devDependency and a `tauri` script; `.gitignore` gained `src-tauri/target/` and `src-tauri/gen/`.
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

## Phase 2: decided

All six open choices were settled with David on 2026-10-15: the sun icon, and the rest as proposed. They're in `PLAN.md` under "Phase 2 (settled with David 2026-10-15)", and the build order is in "Phase 2: the build order".

## Phase 2 step 1: the app window (checked 2026-10-15)

What's built: `src-tauri/`, set up like lightcut, on Tauri 2.12.4 (wry 0.57.0) and WebView2 155. It embeds `web/` unchanged (`frontendDist: "../web"`, no dev server) and serves it from `http://tauri.localhost`. One 1280x720 window. A CSP that allows the ticker's `blob:` worker (`worker-src blob:`). `additionalBrowserArgs` is wry 0.57.0's own default (`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`, read from its source) plus `--autoplay-policy=no-user-gesture-required`. Identifier `com.deadpixeldesign.promptisprologue`; it names the WebView2 data folder (`%LOCALAPPDATA%\com.deadpixeldesign.promptisprologue\EBWebView`, where volume and surf are saved), so settle it before release. The icon is a plain gray disc until step 5. No `withGlobalTauri`, tray or full screen yet.

Build notes: the first release build took 9.5 minutes with all four threads busy on the 4-thread GTX 1060 PC (LTO, like lightcut); don't build while David is recording. All checks ran on the release build, because `npm run tauri dev` serves `web/` through the CLI's own server, which injects a reload script.

The four checks, on David's PC:

1. **Draws correctly: pass.** Clean console from a fresh load (no errors, no CSP reports). ANGLE on Direct3D 11, canvas at the full window size, steady 100 Hz frames. A still at `?day=0.33&energy=0.3` matches Chrome's. The 30 fps cap draws 25 fps on David's 100 Hz display (it waits for every fourth frame); a browser tab does the same.
2. **Graphics budget: pass, measured against the browser tab.** On the same card at the same clock (P8, 607 MHz), picture only: the app maximized (1920x1009) used 13.6% of the 3D engine and 9.5% of one core; the headless browser tab (`web/tools/perf.ps1`, 1920x1080) 13.1% and 18.0%. With music on, 22 to 30% of one core (sound included). The card's clock moves the percentage a lot (the same app read 3.3% at P0, 1379 MHz), so compare only at the same clock. These were measured on the GTX 1060 PC David used that evening. By that comparison the app should sit near the tab's 4.5% on the HD 530, but that's inferred until it's measured there (see hardware below). `src-tauri/tools/perf.ps1` measures the running app.
3. **Music keeps time when hidden: pass, once the page knows it's hidden** (see the first finding). In a test copy that hides the webview on minimize, with sound started while hidden: 6.5 minutes hidden, 20 ticks a second (7,788 ticks, longest gap 269 ms, none over 500 ms), world clock 1:1 with real time, 40 notes a minute, 0 frames drawn, 0% GPU, 14% of one core. The bare app's own minimize and `SW_HIDE` runs held time too (longest gap 78 ms), but there the page never became hidden.
4. **Sound starts without a click: pass.** `prologue.ui.start()` with no click ever: the AudioContext is `running` and notes play, in a visible window and in a hidden one (the start-at-login case). Negative control without the autoplay flag: it stays `suspended`, the clock stays at 0, and `engine.start()` waits at `ctx.resume()` for a click.

Findings that change later steps:

- **Minimizing or hiding the window doesn't hide the page.** WebView2 isn't told, so `document.visibilityState` stays `visible` and Sea keeps drawing at full rate (25 fps, the same GPU as a visible window) when minimized, and after `ShowWindow(SW_HIDE)`, which is what Tauri's `window.hide()` does. Step 5 must hide the webview as well: `WebviewWindow::as_ref().hide()` and `.show()` (Tauri's `Webview::hide`, which calls WebView2's `SetIsVisible`). The test copy did it on `WindowEvent::Resized` with a 0x0 size (minimized) and the page went hidden at once. The bare app doesn't do this yet.
- **Hardware is the HD 530 again.** On 2026-10-15 David tried a different PC with a GTX 1060, then moved back to the EliteDesk (i7-6700, HD 530, 32 GB) on 2026-10-16. The GPU budget in `AGENTS.md` and step 7 of `PLAN.md` are measured on the HD 530 as before. The step 1 checks that evening ran on the GTX 1060 PC, so re-measure the app's graphics use on the HD 530 before relying on those numbers.
- **The sound device's clock ran about 7% slow** against the system clock that evening: AudioContext time advanced 0.928 s per real second in the app and 0.927 in Chrome, measured at the same moment on the 48 kHz default device. That's the device or its driver, not the app (David was troubleshooting Focusrite dropouts then). If the music ever sounds flat or crackly on this PC, check the audio device before the app.
- `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is ignored once the app sets `additionalBrowserArgs`, so DevTools-protocol tests need a test build with `--remote-debugging-port=9222` merged in (`--config <file>`, a separate `CARGO_TARGET_DIR`). Never ship that. The step 1 helpers (DevTools client, window control, tick recorder, the hide-on-minimize `lib.rs`) are outside the repo in `C:\Users\wretc\AppData\Roaming\Claude\side-session-notes\local_bfa98c5b-a4f5-443c-a2ad-7ab0b5ccb613\prologue-step1-harness\`.
- All of `web/` is embedded in the exe, including `test/`, `tools/`, `serve.cjs` and the photo scenes. Harmless; trim at release.

## Phase 2 step 2: the listener (built 2026-10-17)

What's built: `src-tauri/listener/`, its own crate in a Cargo workspace with the app, so `cargo test -p prologue-listener` runs on any machine without a webview. Dependencies are serde, serde_json and getrandom, all already in the app's tree through Tauri. `src/lib.rs` starts it in `setup` and emits each kept event to the page as `prologue:hook`; nothing in `web/` listens yet (step 3).

- Listens on `127.0.0.1` only, port 47207. If that's taken it tries the next 19, then any free port, and saves the one it got.
- First run makes `listener.json` (port and a 64-character random key) in the app's config folder: `%APPDATA%\com.deadpixeldesign.promptisprologue\` on Windows. It's the only file the listener writes.
- Takes a request only if it's a POST to `/prompt-is-prologue/v1/hook` (step 4 finds the app's hook entries by this path), with `x-prologue-key` matching (compared in constant time), a Host of `127.0.0.1:<port>` or `localhost:<port>` (stops DNS rebinding), and no Origin header (browsers always send one on a cross-site POST, and the key header forces a preflight, which is refused). Everything else gets an empty 403.
- Answers an empty 200 from the request's own thread as soon as the headers pass, before reading the body, so a big tool result or a busy scene never holds Claude up. Up to 64 requests at once; more are dropped.
- Then reads the body (Content-Length or chunked, up to 64 MB; bigger is drained and dropped) and keeps only what `world.js` reads: `session_id`, `hook_event_name`, `tool_name`, `duration_ms`, `agent_id`, `agent_type`, `is_interrupt`, `notification_type`, a Notification `message` cut down to the word "permission" when it has it, and StopFailure's `error` kind. Prompts, tool inputs and results, `cwd` and transcript paths are dropped. `cwd` was only stored by the world, never used.

Checked in the cloud, on Linux:

- `cargo test -p prologue-listener --release`: 11 pass. A 40 MB tool result is answered in about 0.3 ms; a scene that takes 2 s per event doesn't slow the answer; no key, a wrong key, an Origin header, a preflight, another Host, another path or a GET are all refused; nothing is reachable on the machine's other addresses; the port moves when it's taken.
- The whole app (debug build under a virtual display) started the listener and made `listener.json`; `node src-tauri/tools/send-test.cjs` passed five runs in a row, and with 47207 held by another program the app moved to 47208, saved it, and the sender followed.

Still to check on David's PC: `npm run tauri build -- --no-bundle`, start the exe, then `node src-tauri/tools/send-test.cjs`; all six lines should pass. Watch for Windows Defender Firewall asking about the app: it shouldn't, since it listens only on 127.0.0.1. Boats appear from these events once step 3 adds the page side. Still unchecked anywhere: that Claude Code's own HTTP hooks send no Origin header and the Host as `127.0.0.1:<port>`; step 4 finds out with real sessions.

## Phase 2 technical notes

- Hook facts, checked 2026-10-15 against the Claude Code docs (hooks and desktop pages), with Claude Code 2.1.296 on this PC:
  - Shape: `{"type": "http", "url": "...", "headers": {...}, "timeout": N}`. `timeout` is in seconds. The default is 600 (30 on UserPromptSubmit), so set 1. SessionEnd hooks run inside a 1.5 s exit budget.
  - HTTP hooks have no `async`: Claude waits for every POST, up to the timeout. All matching hooks for an event run in parallel, so ours doesn't add to the time David's own hooks take.
  - Reply 2xx with an empty body. A JSON body is read as hook output and can carry decisions, so never send JSON. A plain-text body counts as a non-blocking error. Non-2xx replies, refused connections and timeouts never block Claude, and a timed-out PreToolUse hook doesn't block the tool.
  - `SessionStart` and `Setup` accept only command and mcp_tool hooks, never http. The world doesn't need them.
  - Header values only expand `$VARS` listed in `allowedEnvVars`, so write the key into the header literally.
  - Settings-file edits are picked up by Claude Code's file watcher, so running sessions should start sending without a restart. Test it: a user report (claude-code issue 44631) says active sessions can strip hooks from settings.json.
  - Managed settings can block the app's hooks: `allowedHttpHookUrls`, `httpHookAllowedEnvVars`, `allowManagedHooksOnly`.
  - PostToolUse carries `duration_ms`, and its `tool_response` can be very large. Read it fast and keep only the fields the world uses.
- Which sessions reach the app: the desktop docs say "The desktop app reads the same settings files as the CLI." Verified live: a Code-tab session fired David's `~/.claude/settings.json` PostToolUse hook. Editor extensions host Claude Code too. SSH sessions read the remote machine's settings, cloud sessions run elsewhere, and Cowork reportedly runs no settings hooks (user bug reports, no official doc), so none of those reach the app.
- Measured on David's PC: a POST to a closed port on 127.0.0.1 fails in 1 to 5 ms. Use `127.0.0.1` in the hook URL, not `localhost`.
- David's `~/.claude/settings.json` has four hooks of his own (herdr agent state and config backup on SessionStart, the voice gate, hud-track) and no old visualizer hooks. The installer must leave them alone.
- Old Claude Visualizer hooks are command hooks that run `hook.js` from a `claude-visualizer` folder, as the old README set them up; that script posted to port 8765. Match on that, show the entries, and remove them only on a yes.
- The app's own entries: one per event below, each `{"type": "http", "url": "http://127.0.0.1:<port>/prompt-is-prologue/v1/hook", "timeout": 1, "headers": {"x-prologue-key": "<key>"}}`, with the port and key from `listener.json`. Find them by that path, so a port change can rewrite them.
- Events the world handles: UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied, Notification, Elicitation, ElicitationResult, SubagentStart, SubagentStop, PreCompact, PostCompact, Stop, StopFailure, SessionEnd.
- Tauri notes. Checked in step 1: `additionalBrowserArgs` with the autoplay flag lets sound start without a click, and it replaces wry's default arguments, so they're carried over; the ticker's `blob:` worker runs under the CSP (`worker-src blob:`); the page only counts as hidden when the webview is hidden. Still to do: set `withGlobalTauri` so `web/` can listen for the app's events without an npm package, and have `web/` pick the live source when `window.__TAURI__` exists (step 3). Full screen may need Tauri's window call instead of the page's. Linux has no tray click events (menu only). On Mac the icon should be a template image, and App Nap may slow a hidden app; check there. Windows uninstall cleanup can run from an NSIS pre-uninstall hook.
- Wiring: `main.js` creates `DemoSource`. Phase 2 adds a live source (for example `src/live.js`) fed by the Tauri listener, with demo as a tray choice. The web layer stays framework-free so the same files ship in the app and on the demo page.
- Guard needed: the scene's `boatFor()` creates a boat for any moment that names a traveler, including `traveler:gone` or a toll for a session it never drew. Harmless in the demo; live, it could fire a sun burst for a boat that never appeared.
- `src-tauri/` follows `workspace/lightcut`'s setup. Rendering in WebView2 on Windows is checked (step 1); WebKitGTK on Linux and WKWebView on Mac are untested.
- Background timers: inside WebView2 the worker ticker held 20 ticks a second for 6.5 minutes with the page hidden (step 1).

## Verified (2026-10-15)

- `node --test "web/test/*.test.js"`: 8 pass.
- Levels before and after the limiter: peaks into the limiter −9 dB at 1x and −5.6 to −8.7 dB at 16x, nothing at the −2 dB threshold, no ceiling hits, 32-voice cap holds, 0 out-of-key notes. Default volume sits about 10 dB under streaming music, on purpose.
- Note pulses reach the picture and the breath value tracks the pad.
- With the Browser pane hidden, the worker ticker held 20 updates a second and notes kept scheduling.
- Headless Chrome at 1920x1080 on the HD 530: old visualizer 176% of one core and 73% GPU; first-pass Sea 27% and 26% (at 1000 px); poster Sea about 18.5% and 4.5% at full 1920 px. Not re-measured after the last tweaks, which add no meaningful work. (The HD 530 has since left the PC; see step 1.)
- Stills and forced frames: the birth beats, every time of day, waiting rings, a resting boat, subagent twinkles, departure into the sun, newborns side by side, calm streaks (7 a minute at zero energy), shapes swapping after about 5 minutes. Clean console.

## Not verified

- Sound by ear. Levels and key are measured; only David can judge the music.
- Live motion in a visible window. The Claude Browser pane was hidden during work, so checks used stills and forced frames. David has watched it and approved.
- Firefox, Safari, Linux, phones, and the Tauri webviews on Mac and Linux. WebView2 on Windows is checked (step 1).
- Sound by ear in the app window when hidden or minimized. David approved it by ear with the window open (2026-10-15).

## Decisions made while building

- Typography is a system font stack for now; the real typeface is a release-phase decision.
- No "glue" compressor: the browser's compressor adds about +7 dB of make-up gain. Master is trim (2), limiter at −2 dB, soft clip.
- The day palette borrows the mood of "Awake" but deliberately has no converging road, so it isn't a copy of the artwork.
- The demo uses seed 207 and paces about 500 tool calls an hour across about three sessions. Demo speed isn't remembered between visits; volume and surf are.
