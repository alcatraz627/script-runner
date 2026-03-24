#!/usr/bin/env node
/**
 * review-server.js
 *
 * Lightweight backend for the combined review dashboard.
 * Serves the HTML and persists review state to changes.json.
 *
 * Usage:
 *   node review-server.js [--port 3459] [--state changes.json]
 *
 * API:
 *   GET  /              → serves combined-review.html
 *   GET  /api/state     → returns current state JSON
 *   POST /api/state     → saves full state JSON
 *   POST /api/export    → writes selections.json + approved.json to datasets/
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const PORT      = parseInt(getArg('--port') || '3459');
const STATE_FILE = path.resolve(getArg('--state') || path.join(__dirname, 'datasets/attr-gaps-final/changes.json'));
const HTML_FILE  = path.join(__dirname, 'combined-review.html');

// Ensure state directory exists
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  return null;
}

function saveState(data) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }

  try {
    if (req.url === '/' && req.method === 'GET') {
      if (!fs.existsSync(HTML_FILE)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('combined-review.html not found. Run generate-combined-dashboard.js first.');
      }
      res.writeHead(200, { 'Content-Type': 'text/html', ...cors });
      return res.end(fs.readFileSync(HTML_FILE));
    }

    if (req.url === '/api/state' && req.method === 'GET') {
      const state = loadState();
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      return res.end(JSON.stringify(state));
    }

    if (req.url === '/api/state' && req.method === 'POST') {
      const body = await readBody(req);
      const data = JSON.parse(body);
      saveState(data);
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      return res.end(JSON.stringify({ ok: true, saved: Object.keys(data).length }));
    }

    if (req.url === '/api/export' && req.method === 'POST') {
      const body = await readBody(req);
      const { selections, approved } = JSON.parse(body);
      const outDir = path.dirname(STATE_FILE);
      if (selections) fs.writeFileSync(path.join(outDir, 'selections.json'), JSON.stringify(selections, null, 2));
      if (approved)   fs.writeFileSync(path.join(outDir, 'approved.json'), JSON.stringify(approved, null, 2));
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      return res.end(JSON.stringify({ ok: true, dir: outDir }));
    }

    res.writeHead(404, { 'Content-Type': 'text/plain', ...cors });
    res.end('Not found');
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`\n  Review server running at http://localhost:${PORT}`);
  console.log(`  State file: ${STATE_FILE}`);
  console.log(`  HTML file:  ${HTML_FILE}\n`);
});
