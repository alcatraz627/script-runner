const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT        = 3458;
const DIR         = __dirname;
const DATASETS_DIR = path.join(DIR, 'datasets');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript',
  '.json': 'application/json',
  '.css':  'text/css',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

/** List available datasets by scanning datasets/ directory */
function listDatasets() {
  if (!fs.existsSync(DATASETS_DIR)) return [];
  return fs.readdirSync(DATASETS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const dataFile = path.join(DATASETS_DIR, d.name, 'data.json');
      let itemCount = 0;
      try {
        const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        itemCount = Array.isArray(data) ? data.length : 0;
      } catch {}
      return {
        id: d.name,
        name: d.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        itemCount,
      };
    })
    .filter(d => d.itemCount > 0);
}

/** Resolve a safe path within datasets/ */
function datasetPath(id, file) {
  const p = path.join(DATASETS_DIR, id, file);
  if (!p.startsWith(DATASETS_DIR + path.sep)) return null;
  return p;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];

  // ── API: list datasets ──
  if (url === '/api/datasets' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(listDatasets()));
    return;
  }

  // ── API: dataset data ──
  const dataMatch = url.match(/^\/api\/datasets\/([^/]+)\/data$/);
  if (dataMatch && req.method === 'GET') {
    const file = datasetPath(dataMatch[1], 'data.json');
    if (!file || !fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"Dataset not found"}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    fs.createReadStream(file).pipe(res);
    return;
  }

  // ── API: selections (GET / POST) ──
  const selMatch = url.match(/^\/api\/datasets\/([^/]+)\/selections$/);
  if (selMatch) {
    const file = datasetPath(selMatch[1], 'selections.json');
    if (!file) { res.writeHead(404); res.end('not found'); return; }

    if (req.method === 'GET') {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      }
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          fs.writeFileSync(file, JSON.stringify(data, null, 2));
          console.log(`[${selMatch[1]}] saved ${Object.keys(data).length} selections`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('bad json: ' + e.message);
        }
      });
      return;
    }
  }

  // ── Static files ──
  let urlPath = url;
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(DIR, urlPath);

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
  const ds = listDatasets();
  console.log(`\n  Image Selector`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  ${ds.length} dataset(s): ${ds.map(d => d.id + ' (' + d.itemCount + ')').join(', ')}\n`);
});
