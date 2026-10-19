#!/usr/bin/env node
'use strict';

// Dev server for the web layer. Zero dependencies, local machine only.
// Serves the repo root so /web/ (new) and /public/ (old) can be compared
// side by side. The real app (phase 2) replaces this with the Tauri shell.

const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5178;
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (pathname === '/') {
    res.writeHead(302, { Location: '/web/' });
    res.end();
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.resolve(ROOT, '.' + pathname);
  const rel = path.relative(ROOT, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Prompt Is Prologue dev server: http://${HOST}:${PORT}/web/`);
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.` : err.message);
  process.exit(1);
});
