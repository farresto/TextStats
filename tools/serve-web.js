#!/usr/bin/env node
'use strict';

// Serves dist-web/ on http://localhost:8080 to try the website locally
// (opening index.html directly from disk does not work: browsers block workers on file://).
// Usage: node tools/serve-web.js [dir] [port]

const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist-web'));
const PORT = Number(process.argv[3] || process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.gz': 'application/octet-stream', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(DIR, p);
    if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`TextStats website: http://localhost:${PORT}/  (press Ctrl+C to stop)`));
