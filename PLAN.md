# Prompt Is Prologue: the plan

Locked 2026-10-15. Every decision is made and the plan has been reviewed. Phase 1 (Sea and demo mode in the browser) was built 2026-10-15 and is waiting on David's listen; see `HANDOFF.md`.

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
- **Connecting to Claude:** on first run the app adds its own hook entries to Claude Code's settings file. It leaves any hooks you already have alone and shows you exactly what it added. Uninstalling removes exactly those entries and nothing else.
- **Never slows Claude down:** each hook gives up after about a second. If the app is closed or stuck, the event is simply dropped. One detail: Claude Code can't send its session-start event this way, so the app doesn't depend on it. A new traveler appears on the first event from a session it hasn't seen yet.
- **The art:** drawn live in code, using a GPU canvas where it helps, with a frame budget. It pauses fully when the window is hidden.

## The order of work

1. **Hear it first.** Demo mode, which plays a fake Claude session, plus the **Sea** vibe finished: scene, matched sound, idle pad, moments, travelers and the journey. All of it runs in a plain browser page, with no app shell yet. You hear the direction within days, and this is where we find out if it feels right. Measure what made the old one heavy before building the look.
2. **Make it an app.** The Tauri shell, tray icon, start at login, secure listener, the automatic hook setup and uninstall, and the removal of the old server, analytics and logging.
3. **The other three vibes:** Road, Dune and Sun.
4. **Release.** Rename the repo, write a new README with a short video at the top (with sound), add a LICENSE file and topics, set up builds for all three systems, and launch the demo web page. The demo page is the phase 1 build, so it costs almost nothing extra. The repo name loses the word "claude", which is what people search for, so "Claude Code" stays in the description and topics.

Each phase ends with something you can open and hear.

## Costs to know about now

- **Mac:** a Mac app that isn't signed through Apple's developer program ($99 a year) shows scary warnings when people open it. We can ship unsigned with clear instructions at first, and decide later.
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
