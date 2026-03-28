#!/usr/bin/env node
'use strict';

// This script is called by Claude Code on every hook event.
// It reads the JSON payload from stdin and POSTs it to the visualizer server.
//
// CRITICAL: This must NEVER block Claude Code. All errors exit silently.
// The 1500ms hard timeout ensures we die before the 2000ms hook timeout.

const http = require('http');

// Hard safety net: exit no matter what after 1500ms
setTimeout(() => process.exit(0), 1500);

let input = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => { input += chunk; });

process.stdin.on('end', () => {
  if (!input.trim()) process.exit(0);

  // Validate it's parseable JSON before forwarding
  try { JSON.parse(input); } catch { process.exit(0); }

  const req = http.request({
    hostname: '127.0.0.1',
    port: 8765,
    path: '/event',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(input),
    },
    timeout: 1200,
  }, (res) => {
    // Don't care about the response body, just drain it and exit
    res.resume();
    res.on('end', () => process.exit(0));
  });

  req.on('error', () => process.exit(0));    // Server not running? That's fine.
  req.on('timeout', () => { req.destroy(); process.exit(0); });

  req.write(input);
  req.end();
});

process.stdin.on('error', () => process.exit(0));
