# Prompt Is Prologue: the plan

Locked 2026-10-15. Phase 1 (Sea and demo mode in the browser) is built and approved. Phase 2's six open choices were settled with David on 2026-10-15, and he approved its build order below the same day. Current state is in `HANDOFF.md`.

## What it is

A small app that sits in your tray. Click it and a window opens onto a living Tycho-style scene with music, both driven by what Claude is doing. Each session is a journey: the scene moves slowly forward while Claude works, busy stretches look and sound busy, and quiet stretches breathe. It works on Windows, Mac and Linux.

It replaces Claude Visualizer. The GitHub repo gets renamed, which keeps your stars, and old links redirect automatically.

## What changes from the old version

| Old | New |
| --- | --- |
| Open a terminal, start a server, open a browser tab | Tray icon, click to open |
| Hand-edit 9 hook entries in settings.json | The app connects itself to Claude Code on first run |
| One sunset scene | Four vibes, each with its own matched sound |
| Notes fire at random times, then silence | An idle pad that swells and fades, with tool sounds layered on top |
| Scene looks the same at minute 1 and hour 3 | The scene travels and changes over the session |
| Analytics and token dashboard | Removed. The art is the point; whirr-spend covers the numbers |
| Open to your network and to any website | Only your own computer can talk to it, and it needs a secret key |
| Saves everything Claude touches to disk forever | Saves nothing |
| Felt heavy on your system | Has a performance budget and pauses when hidden |

## The four vibes

Built in code, using your references for energy and feel only. Nothing is copied from Tycho's work. Working names, yours to change:

1. **Road.** Flat shapes, deep blue sky, a cream sun and striped earth. As the session goes on, the road moves toward the horizon and the bands slowly shift color.
2. **Dune.** Pink and cyan duotone, with light streaks across a dark sky. Streaks could be subagents, and sand ripples could speed up when Claude is busy.
3. **Sun.** A huge hazy gradient sun over dark hills and a beach, with film grain. This is closest to the current look. The sun rises or sets across the session.
4. **Sea.** A dusk sky with pink clouds over dark moving water. The water gets rougher when Claude is busy and glassy when it's quiet.

Each vibe has its own sound, designed with it: its own palette of tones, its own pad, its own reverb space. Key and tempo stay mostly fixed within a vibe.

## How the sound works

Three layers:

1. **The idle pad.** A slow swell-and-fade bed that is always there, quietly, and suits everything above it.
2. **Tool phrases.** Short phrases when Claude reads, edits, runs commands and so on, in key and in time with the vibe.
3. **Moments.** A few special cues: a session starting, a subagent heading out, compaction, and a gentle, clearly different sound when Claude is waiting on you.

The mix gets a limiter on the master and a cap on how many notes can ring at once, so a burst of parallel tool calls can't clip or pile up.

### Where the sounds come from: your call

The tool phrases have to fire instantly and land in key, so those are made in code either way. The question is the pad and the instrument tone:

- **Option A: all synthesized.** Everything is made in code, the download stays tiny and there are no rights questions. A lot is possible here: warm filtered pads, tape wobble, chorus, noise beds. Of the two, this is the easier one to ship.
- **Option B: Suno hybrid.** For each vibe, generate one piece in Suno and split it into stems. The pad stem becomes the idle bed, after you tune it and cut clean loop points in REAPER. A few single notes from the keys stem become the instrument the tool phrases play, so the bed and the notes are literally the same instrument and can't clash. It's richer and more "real", but it's REAPER work, and Suno only follows a requested key loosely. Before shipping Suno audio in a public repo, check what your Suno plan allows. The code can stay MIT while the audio files carry their own terms.

## How Claude's work drives the scene

Claude Code now reports far more than it did in March: 33 kinds of events instead of the 9 we use. The ones that matter here:

- A **prompt** from you starts a new leg of the journey.
- **Tool calls** feed the busy/quiet energy that drives motion and sound.
- **Subagents** appear and leave as their own elements, like streaks, figures or boats depending on the vibe.
- **Waiting on you** gets a visual and sound cue.
- **Compaction** is a natural scene change, like nightfall and a fresh dawn.
- **Errors and rate limits** get something subtle, never alarming.

Claude Code now measures each tool's run time itself, so timings no longer include the time Claude spent waiting for you to approve something.

## How it's built

- **One rule holds it together:** all the art and sound live in one plain web layer with no framework. The app is a thin shell around it. The exact same code runs inside the app and on the demo web page.
- **The app:** Tauri, the same thing lightcut is built on. It has a real tray icon on all three systems, needs no Node install for anyone using it, and starts quietly at login so it's always in the tray. Tauri is lighter than Electron, but not lighter than a browser tab. What actually fixes "heavy" is the frame budget and pausing when hidden.
- **The listener:** the app itself receives Claude's events, only from your own computer, and only with a secret key made at install.
- **Connecting to Claude:** on first run the app adds its own hook entries to Claude Code's settings file. It leaves any hooks you already have alone and shows you exactly what it added. Uninstalling, or Disconnect in the tray menu, removes exactly those entries and nothing else.
- **Never slows Claude down:** Claude waits for the app's answer on every event, so the app answers first and draws after. Each hook gives up after a second, so an app that's stuck costs Claude at most a second per event, and when the app is closed Claude's attempt fails in about 5 milliseconds (measured on David's PC). One detail: Claude Code can't send its session-start event this way, so the app doesn't depend on it. A new traveler appears on the first event from a session it hasn't seen yet.
- **Which sessions show up:** Claude Code on this computer, whether it runs in a terminal, in the Claude app's Code tab or in an editor. Cowork, SSH and cloud sessions don't, because they don't use this computer's Claude settings.
- **The art:** drawn live in code, using a GPU canvas where it helps, with a frame budget. It pauses fully when the window is hidden.

## The order of work

1. **Hear it first.** Demo mode, which plays a fake Claude session, plus the **Sea** vibe finished: scene, matched sound, idle pad, moments, travelers and the journey. All of it runs in a plain browser page, with no app shell yet. You hear the direction within days, and this is where we find out if it feels right. Measure what made the old one heavy before building the look.
2. **Make it an app.** The Tauri shell, tray icon, start at login, secure listener, the automatic hook setup and uninstall, and the removal of the old server, analytics and logging. The step-by-step order is in the next section.
3. **The other three vibes:** Road, Dune and Sun.
4. **Release.** Rename the repo, write a new README with a short video at the top (with sound), add a LICENSE file and topics, set up builds for all three systems, and launch the demo web page. The demo page is the phase 1 build, so it costs almost nothing extra. The repo name loses the word "claude", which is what people search for, so "Claude Code" stays in the description and topics.

Each phase ends with something you can open and hear.

## Phase 2: the build order

Ordered by risk, so the step most likely to change the plan comes first. Each step ends with a check, and the next step waits until it passes. Everything is built and checked on David's PC (Windows) first.

1. **The app window.** A bare Tauri app, set up like lightcut, that opens the existing `web/` files unchanged. On David's PC, check four things: the poster Sea draws correctly, it stays inside the graphics budget (the browser tab used about 5% of the HD 530), the music keeps time when the window is hidden, and sound can start without a click. *Done when* all four pass. If one fails, it goes back to David before anything else, because music from the tray and starting at login depend on it.
2. **The listener.** The app listens only on this computer (127.0.0.1), on one fixed port, and takes an event only if it carries the secret key made on first run. It answers a plain OK with nothing in it right away, from its own thread so a busy scene can't hold Claude up, and only then hands the event to the scene. It never answers with anything Claude could read as an instruction. It keeps only what the scene uses (which session, which event, which tool, how long it took) and drops the rest, including your prompts, file contents and command output. Nothing about Claude's work is written to disk. If something else is using the port, the app moves to a free one and updates its own hook entries. *Done when* a test sender makes boats appear, requests without the key or from a web page are refused, and the answer comes back within a few milliseconds even for a huge tool result.
3. **The live scene.** `web/src/live.js` turns those events into the same shape the demo produces, so the world doesn't change. Add the guard from `HANDOFF.md` so a goodbye for a boat that was never drawn doesn't fire a sun burst. Play demo turns itself off when a real session shows up, and is unavailable while real boats are on the water. The demo web page keeps working with no app around it. *Done when* new tests for the live events pass, and events sent through the listener look and sound like the demo.
4. **Connecting to Claude Code.** On first run the app backs up `~/.claude/settings.json`, then adds one entry for each of the 16 events the world uses, each with a one second limit and the key. SessionStart isn't one of them, since it can't send to the app. Every other hook stays exactly as it is (David has four of his own). A small panel over the scene lists what was added in plain words, with OK and Undo. If old Claude Visualizer hooks are there, the same panel lists them and offers to remove them. Disconnect removes exactly the app's own entries, found by an address only this app uses. If the settings file can't be read, the app changes nothing and says so. On Windows the uninstaller disconnects too. *Done when* real sessions in a terminal and in the Code tab show up as boats without being restarted, the entries survive while sessions are running, and Disconnect leaves the file the way it was. (Changed with David on 2026-10-18: the entries are in only while the app runs. See "Connecting" below.)
5. **The tray app.** The sun icon, and the menu from the phase 2 decisions below. On Windows a click opens the window and a right-click shows the menu. The window remembers its size and spot; double-click for full screen, Esc to leave. Closing it only hides it: drawing stops, the world and music keep going, and the music fades once the last boat has sailed home. Only one copy runs, and opening it again shows the window. It starts at login, quietly in the tray, and the menu switch turns that off. *Done when* David can close the window and still hear Claude work, and after a restart the sun is in the tray without him doing anything.
6. **Remove the old Claude Visualizer.** Delete `server.js`, `hook.js`, `lib/` (analytics and tokens), `public/`, `start.bat`, `start.vbs` and the `npm start` script. The README gets a short note that the app is being rebuilt; the real README comes with the release. *Done when* nothing left in the repo listens on the network or saves Claude's activity.
7. **Check it all.** Tests pass. Graphics and processor use are measured inside the app on the HD 530, with the window open and closed. Claude isn't slowed: tool calls are timed with the app running, closed and frozen (frozen costs at most the one second limit per event). Nothing about Claude's work is on disk. Then a real working session in a terminal and in the Code tab while David watches and listens. *Done when* David says it feels right.
8. **Mac and Linux.** The code is written for all three systems from step 1, but building and testing on Mac and Linux needs those machines or GitHub's free build machines, and those need the branch pushed. David decides which when we get here. Linux is last: its tray icons can only show a menu, and some Linux desktops need an add-on before they show tray icons at all.

## Costs to know about now

- **Unsigned builds:** builds made on your own machine show no warnings, but unsigned copies people download do. Windows shows a blue "Windows protected your PC" box (More info, then Run anyway). On a Mac the first open is blocked until they click Open Anyway in System Settings, Privacy & Security. Signing removes both: the Mac side is Apple's developer program at $99 a year, and the Windows price gets checked at release. Decided: ship unsigned with plain install steps, and decide on signing at release.
- **Linux:** the Linux build is its own small job, and graphics there can be weaker. It's doable, but it's the last one we polish.
- **A demo web page** on Netlify, where people hear it in the browser before installing anything, is probably the biggest single thing for traction. It costs little because demo mode already exists by then.

## Decisions made (2026-10-15)

- **Default vibe:** Sea.
- **Character:** each vibe has its own. Some flow and breathe, some are steady and rhythmic. There's no switch.
- **One scene for the whole day.** Every running session is its own traveler in the same landscape, and subagents are smaller companions that head out from it and come back. Each vibe needs its own version of a traveler (a figure on the road, a light on the water, and so on).
- **The journey moves by how much work Claude has done,** not by clock time. An idle hour moves nothing; a busy ten minutes covers ground.
- **Compaction rests the traveler.** That traveler dims and rests, then a fresh one sets out from the same spot.
- **Day and night belong to the landscape** and follow total work across all sessions: busy days carry toward dusk, and dawn returns after you've been idle a while. Each traveler moves by its own work; the landscape moves by everyone's.
- **Idle fade:** a traveler with no activity for 20 minutes fades out. Adjustable.
- **Sound:** synthesized to start. Suno pads stay an option for later. Note choices must stay inside each vibe's palette and the Tycho direction: warm, unhurried, no harsh intervals, nothing that sounds like a notification.
- **Setup:** the app adds its own hooks to Claude Code on first run, shows exactly what it changed, and removes them cleanly on uninstall.

- **Flow vs pulse:** Sea and Sun flow and breathe. Road and Dune are steady and rhythmic.
- **Travelers per vibe:**
  - **Sea:** each session is a small boat light on the water, and subagents are smaller lights that drift off and return.
  - **Road:** small figures walking toward the horizon.
  - **Dune:** a figure on the ridge, and subagents are the light streaks.
  - **Sun:** silhouettes on the beach.
- **Demo web page:** part of the first release.

### Phase 2 (settled with David 2026-10-15)

- **Clicking the tray icon:** on Windows it opens a normal window that remembers its size and spot, and right-click shows the menu. On Mac and Linux a click shows the menu, with Open at the top, because that's how those systems work. Double-click the window for full screen, Esc to leave.
- **Music with the window closed:** it keeps playing from the tray. Once the last boat has sailed home (20 minutes after Claude goes quiet), the music fades out, and it comes back when Claude starts working again. Sound can start by itself after login without the window being opened.
- **Tray menu:** Open, Mute, Play demo, Start at login, Disconnect from Claude Code, Quit. No Pause, since Mute and closing the window cover it. Disconnect is how Mac and Linux users remove the hooks, because those systems have no uninstaller.
- **Tray icon:** the sun, a disc with one ring. The Mac menu bar gets a one-color version.
- **Old Claude Visualizer hooks:** the app finds them, shows them, and removes them only if the person says yes. David's own settings have none.
- **Demo in the app:** it stays in the tray menu and turns itself off when a real Claude session shows up, so fake boats never mix with real work.
- **Signing:** ship unsigned with plain install steps, and decide at release.

### Live and demo (settled with David 2026-10-18)

- **Going live resets the day.** When a real session shows up while the demo is playing, the demo's boats sail home and the sky rolls on through dusk and night to a fresh dawn, over about 2 to 3 minutes, so the light only ever shows real work. A demo that has barely begun just settles back to dawn.
- **The app window opens on the sea.** No start screen in the app: the empty sea at dawn with no music, until Claude's first session brings boats and music. The demo moves to the tray menu in step 5.
- **While live, the bar shows only Surf, Mute, volume and Full.** The Demo tag and the speed buttons come back for the demo.

### Connecting (settled with David 2026-10-18)

- **The hooks are in only while the app runs.** It adds them when it starts and takes them out when it quits. Whenever its hooks can't reach the app, Claude Code puts a "hook error" note on every tool call in every session, so a closed app must leave none behind. If the app ever dies without quitting, the notes show until it runs again.
- **The panel lists what was added, in plain words,** as a dark card in the middle of the scene, with Undo and OK. It shows the first time, and again after the person reconnects. Undo keeps the app out of the settings until they connect again.
- **The uninstaller** runs the app with `--disconnect`. Wired now, tested at release.
