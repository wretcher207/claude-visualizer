# Claude Visualizer

A real-time ambient visualizer for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) tool events. Watch Claude think, search, edit, and build — rendered as a living, breathing composition inspired by [Tycho](https://tychomusic.com/)'s visual aesthetic.

**Zero dependencies. Pure Node.js + vanilla HTML/CSS/JS.**

![Claude Visualizer](https://img.shields.io/badge/node-%3E%3D18-brightgreen) ![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue) ![License MIT](https://img.shields.io/badge/license-MIT-orange)

## What It Does

- **Ambient canvas** — A warm, sunset-inspired scene with a pulsating sun, rotating halo rings, floating geometric shapes, drifting atmospheric layers, and particle effects — all combined from 5 custom artwork compositions
- **Reactive blooms** — When Claude uses a tool, particles burst from the sun. Each tool type has its own color
- **Generative music** — Optional ambient audio in F# major pentatonic. Each tool triggers a melodic phrase with reverb and delay. Inspired by Tycho's "A Walk"
- **Technical sidebar** — Every tool call logged in real time: inputs, outputs, duration, sequence numbers. Expandable cards show the full details
- **Customizable display** — Settings panel lets you toggle: smart summaries, live timers, session stats, result previews, MCP server labels, sequence numbers, working directory, and result size badges
- **Settings persist** — Your display preferences save to localStorage

## Quick Start

### 1. Clone and start the server

```bash
git clone https://github.com/wretcher207/claude-visualizer.git
cd claude-visualizer
npm start
```

The server runs at `http://localhost:8765`. Open it in your browser.

### 2. Add the hook to Claude Code

Add this to your Claude Code settings file (`~/.claude/settings.json`):

**macOS / Linux:**
```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-visualizer/hook.js" }] }],
    "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-visualizer/hook.js" }] }],
    "PostToolUseFailure": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-visualizer/hook.js" }] }],
    "Notification": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-visualizer/hook.js" }] }],
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-visualizer/hook.js" }] }],
    "SubagentStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-visualizer/hook.js" }] }],
    "SubagentStop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-visualizer/hook.js" }] }],
    "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-visualizer/hook.js" }] }],
    "SessionEnd": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-visualizer/hook.js" }] }]
  }
}
```

**Windows:**
```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\path\\to\\claude-visualizer\\hook.js\"" }] }],
    "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\path\\to\\claude-visualizer\\hook.js\"" }] }],
    "PostToolUseFailure": [{ "matcher": "", "hooks": [{ "type": "command", "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\path\\to\\claude-visualizer\\hook.js\"" }] }],
    "Notification": [{ "matcher": "", "hooks": [{ "type": "command", "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\path\\to\\claude-visualizer\\hook.js\"" }] }],
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\path\\to\\claude-visualizer\\hook.js\"" }] }],
    "SubagentStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\path\\to\\claude-visualizer\\hook.js\"" }] }],
    "SubagentStop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\path\\to\\claude-visualizer\\hook.js\"" }] }],
    "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\path\\to\\claude-visualizer\\hook.js\"" }] }],
    "SessionEnd": [{ "matcher": "", "hooks": [{ "type": "command", "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\path\\to\\claude-visualizer\\hook.js\"" }] }]
  }
}
```

Replace the paths with wherever you cloned the repo.

> **Note:** If you already have hooks in your settings.json, add the visualizer entries alongside them in each event array.

### 3. Use Claude Code normally

Open Claude Code in any terminal. Every tool call will appear in the visualizer in real time.

## Auto-Start on Login (Windows)

Copy `start.vbs` to your Startup folder so the server launches automatically:

```
copy start.vbs "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Claude Visualizer.vbs"
```

## Features

### Display Settings

Click the gear icon in the sidebar to toggle:

| Setting | Description | Default |
|---------|-------------|---------|
| Smart Summaries | Parsed, readable tool descriptions | On |
| Live Timer | Real-time counter while tools run | On |
| Session Stats | Tool count and timing in header | On |
| Result Size | Line and character count badges | On |
| Sequence Numbers | Tool call numbering (#1, #2...) | On |
| MCP Server Labels | Show which MCP server a tool uses | On |
| Result Previews | First-line result summaries | On |
| Working Directory | Show the active project path | Off |

### Tool Colors

Each tool type has a distinct warm color:

| Tool | Color |
|------|-------|
| Read | Amber |
| Edit | Burnt Sienna |
| Write | Deep Orange |
| Bash | Forest Green |
| Glob | Dusty Gold |
| Grep | Bronze |
| Agent | Golden |

### Audio

Click "Enable Audio" for generative ambient music in F# major pentatonic. Each tool type triggers a different melodic pattern (arpeggios, chords, pulses, blooms) with warm reverb and delay. Everything harmonizes because pentatonic scales have no dissonance.

## How It Works

```
Claude Code ──hook event──> hook.js ──HTTP POST──> server.js ──SSE──> browser
                (stdin)              (localhost:8765)         (EventSource)
```

1. **Claude Code hooks** fire on every tool event (configured in `settings.json`)
2. **hook.js** reads the JSON from stdin and POSTs it to the local server. Hard 1500ms timeout — never blocks Claude
3. **server.js** enriches the event (UUID, timestamp, duration tracking) and broadcasts via Server-Sent Events
4. **The browser** renders the ambient canvas + sidebar in real time

## Architecture

```
claude-visualizer/
  server.js       — HTTP server (SSE + static files + event intake)
  hook.js         — Tiny resilient hook script called by Claude Code
  package.json    — No dependencies, just metadata
  start.bat       — Windows launcher
  start.vbs       — Silent Windows auto-start wrapper
  public/
    index.html    — Page structure with background composition layers
    style.css     — Full styling: artwork layers, sidebar, animations
    canvas.js     — Animated canvas: particles, geometry, bloom effects
    audio.js      — Generative F# pentatonic ambient music engine
    app.js        — SSE client, settings system, event card rendering
```

## Requirements

- **Node.js 18+** (uses `crypto.randomUUID()`)
- **Claude Code** with hooks support
- A modern browser (Chrome, Firefox, Edge, Safari)

## License

MIT
