'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8765;
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOG_DIR = path.join(__dirname, 'logs');

// Max POST body size (1 MB) — prevents memory abuse
const MAX_BODY_SIZE = 1024 * 1024;

// Ensure logs directory exists
fs.mkdirSync(LOG_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// SSE client management
// ---------------------------------------------------------------------------
const sseClients = new Set();

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

// SSE heartbeat — keeps connections alive through proxies/firewalls
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(': keepalive\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}, 30000);

// ---------------------------------------------------------------------------
// Tool duration tracking
// ---------------------------------------------------------------------------
const pendingTools = new Map();

// Sweep stale entries every 5 minutes (tools that never got a PostToolUse)
setInterval(() => {
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  for (const [id, startTime] of pendingTools) {
    if (startTime < fiveMinAgo) pendingTools.delete(id);
  }
}, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// JSONL event logging (one file per day, async to avoid blocking)
// ---------------------------------------------------------------------------
function logEvent(event) {
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(LOG_DIR, `events-${date}.jsonl`);
  fs.appendFile(file, JSON.stringify(event) + '\n', () => {});
}

// ---------------------------------------------------------------------------
// Flatten tool_response into a readable string
// Claude Code sends tool_response in various formats:
//   - Array of objects: [{ type: "text", text: "..." }]
//   - Object with stdout/stderr: { stdout: "...", stderr: "..." }
//   - Plain string
// We normalize it to a string for display.
// ---------------------------------------------------------------------------
function flattenToolResponse(resp) {
  if (resp == null) return null;
  if (typeof resp === 'string') return resp;

  // Array format (MCP tools): [{ type: "text", text: "..." }]
  if (Array.isArray(resp)) {
    return resp
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && item.text) return item.text;
        return JSON.stringify(item);
      })
      .join('\n');
  }

  // Object format (Bash): { stdout, stderr, ... }
  if (typeof resp === 'object') {
    if ('stdout' in resp || 'stderr' in resp) {
      const parts = [];
      if (resp.stdout) parts.push(resp.stdout);
      if (resp.stderr) parts.push('[stderr] ' + resp.stderr);
      return parts.join('\n') || '(no output)';
    }
    return JSON.stringify(resp, null, 2);
  }

  return String(resp);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

// POST /event — receives hook payloads from hook.js
function handleEvent(req, res) {
  let body = '';
  let size = 0;

  req.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) {
      req.destroy();
      return;
    }
    body += chunk;
  });

  req.on('end', () => {
    try {
      const raw = JSON.parse(body);

      // Build a clean event object with all discovered fields
      const event = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        event: raw.hook_event_name || 'unknown',
        session_id: raw.session_id || null,
        tool_name: raw.tool_name || null,
        tool_input: raw.tool_input || null,
        // FIX: Claude sends "tool_response", not "tool_result"
        tool_result: flattenToolResponse(raw.tool_response) || null,
        tool_use_id: raw.tool_use_id || null,
        cwd: raw.cwd || null,
        transcript_path: raw.transcript_path || null,
        // Additional fields from raw payloads
        permission_mode: raw.permission_mode || null,
        agent_id: raw.agent_id || null,
        agent_type: raw.agent_type || null,
        error: raw.error || null,
        is_interrupt: raw.is_interrupt ?? null,  // ?? preserves false
      };

      // Duration tracking: pair PreToolUse with PostToolUse
      if (event.event === 'PreToolUse' && event.tool_use_id) {
        pendingTools.set(event.tool_use_id, Date.now());
      }
      if ((event.event === 'PostToolUse' || event.event === 'PostToolUseFailure') && event.tool_use_id) {
        const start = pendingTools.get(event.tool_use_id);
        if (start) {
          event.duration_ms = Date.now() - start;
          pendingTools.delete(event.tool_use_id);
        }
      }
      if (event.event === 'SessionStart') {
        pendingTools.clear();
      }

      broadcast(event);
      logEvent(event);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"ok":false,"error":"invalid JSON"}');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
}

// GET /stream — SSE endpoint for browser clients
function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(': connected\n\n');
  sseClients.add(res);
  req.on('close', () => { sseClients.delete(res); });
}

// GET /* — static file serving from public/
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function handleStatic(req, res) {
  let urlPath = new URL(req.url, 'http://localhost').pathname;
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.resolve(PUBLIC_DIR, '.' + urlPath);

  // Prevent path traversal attacks
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/event') return handleEvent(req, res);
  // FIX: use pathname comparison so SSE reconnects with query params still work
  if (req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/stream') return handleSSE(req, res);
  return handleStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Claude Visualizer running at http://localhost:${PORT}`);
});

// Friendly error if port is already in use
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Another instance may be running.`);
    console.error('To fix: close the other instance, or run:');
    console.error(`  netstat -ano | findstr :${PORT}`);
    console.error('  taskkill /PID <pid> /F\n');
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

// Graceful shutdown
function shutdown() {
  for (const client of sseClients) {
    try { client.end(); } catch {}
  }
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
