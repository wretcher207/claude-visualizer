# Handoff

Status 2026-10-18: phase 1 done and approved. Phase 2 step 1, the app window, passed its checks on 2026-10-15 (results below; check 3's truly hidden case was proven in a test copy that hides the webview, and the bare app needs that call in step 5). Phase 2 steps 2 and 3, the listener and the live scene, are built and passed their checks on David's PC on 2026-10-18 (see their sections below). Step 4, connecting to Claude Code, starts when David says go. The branch is on GitHub up to `b994cb1` (pushed with David's approval in a workspace backup sweep); everything after that is committed locally only.

Changed 2026-10-18: David dropped the mail bottles idea. Prologue is only an ambient visualizer of Claude sessions (prompts, tool calls, subagents, waiting, compaction). No email features; `workspace/inbox-watcher` is a separate project and nothing here connects to it.

## Start here (fresh chat)

1. Read `AGENTS.md` (rules), `PLAN.md` (the locked plan and every product decision), then this file.
2. The next job is step 4 of "Phase 2: the build order" in `PLAN.md` (connecting to Claude Code), when David says go. Its notes are under "For step 4" in "Phase 2 step 2: the listener"; step 5's are at the end of "Phase 2 step 3" and in "Phase 2 step 1".
3. To see the current state: double-click `web/open-demo.cmd` (or run `node web/serve.cjs`) and open http://127.0.0.1:5178/web/, then click once. In the Claude app, the workspace launch config has a `prologue` preview entry. 16x runs a day in minutes; D opens the debug panel with a time-of-day slider. The app itself opens on the empty sea; `node src-tauri/tools/send-test-events.mjs session` brings boats.
4. To run the app: `npm install` once, then `npm run tauri build -- --no-bundle` and open `src-tauri/target/release/prompt-is-prologue.exe`. It listens for Claude on 127.0.0.1:47207, but until step 4 connects the hooks, only `node src-tauri/tools/send-test-events.mjs session` sends it anything.

## Where things stand

- Branch `prompt-is-prologue`, from `main` at `ee9a4de`. On GitHub up to `b994cb1`; later commits (the mail-bottles removal and phase 2 step 2) are local only. The repo is public: push only when David says so.
- Phase 1 of `PLAN.md` is built in `web/`: the world model (`src/world.js`), the seeded demo day (`src/demo.js`), the shared audio engine (`src/audio/`), and the Sea vibe (`src/sea/`). Zero dependencies, no build step.
- Phase 2 step 1 is built in `src-tauri/`: a bare Tauri app that opens `web/` unchanged. The root `package.json` gained `@tauri-apps/cli` as a devDependency and a `tauri` script; `.gitignore` gained `src-tauri/target/` and `src-tauri/gen/`.
- Phase 2 step 2 is built: `src-tauri/src/listener.rs` (the listener, with its tests), `web/src/live.js` plus a few lines in `web/src/main.js` (live events go to the world, and the first one turns the demo off), and `src-tauri/tools/send-test-events.mjs` (the test sender). `src-tauri/Cargo.toml` gained `serde`, `serde_json` and `getrandom`, all already in the lockfile through Tauri, so nothing new was downloaded.
- Phase 2 step 3 is built: `Sources` in `web/src/live.js` (demo or real work, and the rules between them), `world.newDay()`, the app's no-start-screen live mode, the never-drawn boat guard in `scene.js`, and `web/test/live.test.js`.
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

## Phase 2 step 2: the listener (checked 2026-10-18)

What's built:

- `src-tauri/src/listener.rs`, started from the app's setup. It listens on 127.0.0.1 port 47207 (only this computer), at `/prompt-is-prologue/hook`, and takes a POST only when it carries the key in an `X-Prologue-Key` header. The key (64 hex characters) is made on first run and saved with the port in `%APPDATA%\com.deadpixeldesign.promptisprologue\listener.json`; step 4 writes the hook entries from that file. The identifier names this folder too, like the WebView2 one, so settle it before release. If something else holds the port, the app moves to a free one and saves that.
- Refused with an empty answer, and never passed on: no key or a wrong one (401), anything carrying a browser's `Origin` or `Sec-Fetch-*` header (403), a `Host` other than 127.0.0.1 or localhost on that port (403), any other path (404) or method (405, which covers CORS preflights), no length (411), chunked bodies (501), bodies over 64 MB (413), headers over 16 KB (431).
- One thread accepts, one thread per request reads and answers (at most 64 at once, 2 s read timeout), and one hand-off thread trims the events and passes them to the page as `claude-hook` events, in the order they arrived. The answer is `200` with an empty body, sent as soon as the body is in and before any parsing, so the scene can't slow Claude down.
- Only these fields pass: `session_id`, `hook_event_name` (one of the 16 events the world uses), `tool_name`, `agent_id`, `agent_type`, `duration_ms`, `is_interrupt`, `notification_type`, `error`, `trigger` and `reason`, the last four only as short lowercase codes, so error text (which can hold command output) never passes. A Notification whose message mentions permission becomes `notification_type: "permission_prompt"`, since that's all the world asks of the message. `cwd` is dropped (nothing used it). Everything else (prompts, tool input and output, messages, transcript paths) is skipped by the parser and never reaches the page.
- `tauri.conf.json` sets `withGlobalTauri`, so `web/src/live.js` listens through `window.__TAURI__` with no npm package.
- Web side: live events go to `world.handle` like demo events. The first one sets `state.live`: the demo stops, any demo boats sail home into the sun, world time runs at 1x whatever the speed buttons say, and `ui.start()` runs, so the intro goes and the music starts with no click. The demo web page (no Tauri) is unchanged: checked headless, it stays in demo mode with a clean console.

What Claude Code actually sends (a probe server with Claude Code 2.1.296, 2026-10-18): a `POST` from `axios/1.15.2` with `Content-Type: application/json`, a `Content-Length` (never chunked), `Host: 127.0.0.1:<port>`, `Connection: keep-alive`, and the configured headers. No `Origin` or `Sec-Fetch-*`. Payloads now also carry a `prompt_id` (dropped).

The checks, on David's PC with a test copy (debug port, built in `src-tauri/target/test`). All passed:

1. **Boats appear.** The test sender replayed six demo minutes at 8x as live events (155 events, three sessions): three boats came out of the sun, the intro went away, sound started by itself (AudioContext `running`) and the demo never ran (`demo.cursor` 0). Clean console from a fresh load.
2. **Refusals.** All 9 of the sender's bad requests were refused (no key, wrong key, `Origin`, `Sec-Fetch-Mode`, CORS preflight, wrong host, wrong path, GET, chunked), and none reached the page. From real web pages in Chromium (`http://127.0.0.1:5178` and `https://example.com`), even with the key handed to the page: the request with the key header died at the browser's preflight, and the blind no-cors and beacon posts reached the listener and were refused. No event arrived.
3. **Privacy.** 13 events, one of each kind, with a marker in every private field: none of it reached the page, only the 11 fields above. After all the tests, nothing in the app's two folders held a marker or a test session id; the only file the app writes is `listener.json`.
4. **Speed.** Answer times with a keep-alive Node client like Claude's: small events about 1 to 2 ms (the first request of a run up to 20 ms), a 1 MB tool result about 3 ms, and a 16 MB one 20 to 60 ms, which is the time to move 16 MB over this PC's loopback (a bare Node server here was no faster). With the page frozen for 5 s, 2,507 events were answered at a 1 ms median, and all of them reached the page once it woke.

For step 3: done (see "Phase 2 step 3"). One note stands: live events that arrive before the page has loaded are lost, since nothing is listening yet. Harmless at app start.

For step 4:

- The hook entries take the port and key from `listener.json`, and must be rewritten when the port moves.
- The port fallback can't tell "something else holds 47207" from "another copy of this app does". A second copy moves to a free port and saves it, which would take the hooks from the first. Step 5's single instance fixes it; until then, don't run two copies.
- `claude -p` on this PC couldn't sign in on 2026-10-18 ("OAuth session expired and could not be refreshed"), so step 4's real-session check needs David to sign the CLI in again, or uses Code tab sessions.

Test tools: `node src-tauri/tools/send-test-events.mjs session|refusals|timing|private` (it reads `listener.json`). The DevTools and browser helpers used for these checks are with step 1's harness, in its `step2/` folder. `src-tauri/target/test` holds the test builds (1.4 GB); delete it any time.

## Phase 2 step 3: the live scene (checked 2026-10-18)

David's choices for this step are in `PLAN.md` under "Live and demo".

What's built:

- `web/src/live.js` now holds `Sources`, which decides where the world's events come from. `playDemo(now)` refuses while real boats are on the water (any traveler whose id doesn't start with `demo-`) and starts a fresh demo day, clearing the world's memory of earlier demo boats so they set out from the sun again. `live(evt, now)` turns the demo off first: its boats sail home (`demo-off`), and if the demo moved the day along, `world.newDay(now)` starts a new one. `pump(now)` plays the demo only while it's on.
- `world.newDay(now)` is the one way a new day starts (the 45-minute quiet dawn uses it too). In `main.js` the light rolls on through night to dawn only if it has left dawn (shown phase above 0.08, `DAWN_HOLD`); a younger day just settles back. That also changed the quiet-dawn case on purpose: a day that had barely begun used to roll through a whole day and night in 3.5 minutes.
- `main.js`: the demo page's click (and `?autostart`) plays the demo as before. In the app there's no start screen: the world starts at load in live mode, the intro is hidden, and sound starts with the first real event. World time runs at 1x whenever the demo is off. `window.prologue.playDemo()` is what step 5's tray item will call; it returns false while real boats are out.
- `ui.js` and `styles.css`: `openLive()` hides the intro, and `setLive()` puts a `live` class on the body that hides the Demo tag and the speed buttons.
- `scene.js`: a boat that never made it onto the screen (it came and went while the page was hidden) is removed quietly on its goodbye, with no sun burst, and a toll never creates a boat.
- `web/test/live.test.js`: a full demo day passed through a copy of the listener's field list gives the world exactly the same moments as the raw demo (it fails if a field the world needs is dropped), plus the demo rules (off on the first real event and a new day after its boats leave, no demo while real boats are out, a quiet real boat fading frees the demo, a replayed demo starts fresh) and no listening on the demo page. 14 tests pass.

The checks, on David's PC with a test copy. All passed:

1. **Opening.** The app opens on the empty sea at dawn: no start screen, Demo tag and speed buttons hidden, no sound, no boats, clean console.
2. **Real work.** Test events brought three boats and started the music by themselves. `playDemo()` was refused while they were out. After their SessionEnds it played, with the tag and speeds back.
3. **The hand-over.** A real event 33 demo minutes in (shown light 0.26): the demo turned off, its three boats sailed home, the real boat was born, and the light rolled from day through dusk and night (moon and stars) to dawn in about 2.5 minutes. With the demo only seconds in (light 0.005), it settled back to dawn with no roll.
4. **Hidden window.** With the page made to think it was hidden, a session that arrived and ended left the scene's boat count where it started (it went up by one and back down), so nothing plays when the window comes back. The real hidden case needs step 5's `Webview::hide`.
5. **The demo page.** In Chromium with no app: the start screen shows, a click plays the demo at 16x with three boats, the tag and speeds show, sound runs, clean console.
6. **Console after events.** In the app, one of each kind of event (prompt, tool, permission, subagent, compaction, failure, goodbye) logged no errors, warnings or rejections, and sound was running afterward.

For step 4: unchanged from step 2's list above.

For step 5:

- The tray's Play demo calls `prologue.playDemo()`. There's no stop-demo control yet (`Sources.stopDemo` exists). Decide whether the menu item toggles.
- The music still plays after the last real boat sails home; the fade-out once the last boat is gone is step 5's.
- The first boat after the app opens arrives silently: sound starts on that first event, and the sound engine ignores moments until it's ready (the same in step 2). Worth fixing with step 5's "music comes back" work, keeping events in order.
- World time in live mode is the pump's running total, capped at a second per tick, so after the PC sleeps, boats from before it stay until 20 awake minutes pass, and the quiet dawn waits 45. Worth basing live time on the wall clock in step 5 or 7.

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
- The app's own entries: one per event below, each `{"type": "http", "url": "http://127.0.0.1:<port>/<a path only this app uses>", "timeout": 1, "headers": {"<key header>": "<key>"}}`. Find them by that path, so a port change can rewrite them.
- Events the world handles: UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied, Notification, Elicitation, ElicitationResult, SubagentStart, SubagentStop, PreCompact, PostCompact, Stop, StopFailure, SessionEnd.
- Tauri notes. Checked in step 1: `additionalBrowserArgs` with the autoplay flag lets sound start without a click, and it replaces wry's default arguments, so they're carried over; the ticker's `blob:` worker runs under the CSP (`worker-src blob:`); the page only counts as hidden when the webview is hidden. Done in step 2: `withGlobalTauri` is set, and `web/src/live.js` listens when `window.__TAURI__` exists. Full screen may need Tauri's window call instead of the page's. Linux has no tray click events (menu only). On Mac the icon should be a template image, and App Nap may slow a hidden app; check there. Windows uninstall cleanup can run from an NSIS pre-uninstall hook.
- Wiring: `main.js` creates `DemoSource` and `Sources` (`src/live.js`), which feeds the world from the demo or, in the app, from Claude. Demo as a tray choice comes with step 5. The web layer stays framework-free so the same files ship in the app and on the demo page.
- Guard (done in step 3): the scene's `boatFor()` creates a boat for any moment that names a traveler. A goodbye for a boat that was never drawn, and a toll for a boat that doesn't exist, no longer do.
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
- A real Claude Code event reaching the app. The probe saw two real requests (UserPromptSubmit and SessionEnd) on a separate test server, but every event the app itself has taken came from the test sender imitating Claude's client. A real PreToolUse or PostToolUse with a real tool result has never been seen, because the CLI couldn't sign in. That's step 4's check.
- The listener on Mac and Linux: the private (0600) key file, the config folders the test sender assumes there, and how binding the port behaves.
- The moment the first live event starts the music by itself, by ear. Only David can judge whether it feels right.
- The demo-to-live hand-over by ear: the demo boats' departure sounds and the sunrise cue as a real boat is born. Checked in pictures and numbers only.
- The never-drawn boat guard with a really hidden webview. It was checked by making the page think it was hidden; step 5 hides the webview for real.

## Decisions made while building

- Typography is a system font stack for now; the real typeface is a release-phase decision.
- No "glue" compressor: the browser's compressor adds about +7 dB of make-up gain. Master is trim (2), limiter at −2 dB, soft clip.
- The day palette borrows the mood of "Awake" but deliberately has no converging road, so it isn't a copy of the artwork.
- The demo uses seed 207 and paces about 500 tool calls an hour across about three sessions. Demo speed isn't remembered between visits; volume and surf are.
