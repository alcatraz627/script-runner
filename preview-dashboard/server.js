const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT       = 3457;
const DIR        = __dirname;
const SEL_FILE   = path.join(DIR, 'selections.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript',
  '.json': 'application/json',
  '.css':  'text/css',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

function loadSelections() {
  try { return JSON.parse(fs.readFileSync(SEL_FILE, 'utf8')); }
  catch { return {}; }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── API: GET selections ──
  if (req.url === '/api/selections' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(loadSelections()));
    return;
  }

  // ── API: POST selections ──
  if (req.url === '/api/selections' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        fs.writeFileSync(SEL_FILE, JSON.stringify(data, null, 2));
        console.log(`[selections] saved ${Object.keys(data).length} entries`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('bad json: ' + e.message);
      }
    });
    return;
  }

  // ── Static files ──
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(DIR, urlPath);

  // Safety: prevent path traversal
  if (!filePath.startsWith(DIR + path.sep) && filePath !== DIR) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  JEGS eBay Scrape viewer`);
  console.log(`  → http://localhost:${PORT}\n`);
});
