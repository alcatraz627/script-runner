#!/usr/bin/env node
/**
 * pipeline/preview.js — Serve any pipeline data file in the dashboard
 *
 * Usage:
 *   node pipeline/preview.js --data <file.json> [--port <n>] [--fields <json>]
 *
 * The dashboard auto-detects common field names (Part Number, Title, Images, etc.)
 * Override with --fields: '{"sku":"SKU","title":"Product Name","image":"Photo URL"}'
 *
 * Field detection order (first match wins):
 *   sku:   Part Number, SKU, sku, id, ID
 *   title: Title, title, name, Name, Product Name
 *   image: Images, Main Image, image, Image URL
 *   desc:  Description, description, desc
 *   cat:   Part Type, Category, category, Type
 *   specs: Attributes Full, Attributes Small, item_specifics, attributes
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const args      = process.argv.slice(2);
const get       = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

const dataArg   = get('--data');
const port      = parseInt(get('--port') || '3458');
const fieldsArg = get('--fields');

if (!dataArg) {
  console.error('Usage: node pipeline/preview.js --data <file.json> [--port <n>]');
  process.exit(1);
}

const dataPath   = path.resolve(dataArg);
const dashDir    = path.resolve(__dirname, '../preview-dashboard');
const SEL_FILE   = path.join(dashDir, 'selections.json');

// ── Auto-map any JSON row shape to the dashboard schema ──────────────────────
// Detects common field names (Part Number, Title, Images, etc.) from the first row
// and maps them to the dashboard's expected schema. This allows the preview to work
// with any pipeline output format without manual field configuration.
function autoMap(rows, fieldOverrides = {}) {
  if (!rows.length) return rows;
  const keys = Object.keys(rows[0]);
  const find  = (...candidates) =>
    fieldOverrides[candidates[0]] ||
    candidates.find(c => keys.find(k => k.toLowerCase() === c.toLowerCase())) &&
    keys.find(k => candidates.some(c => k.toLowerCase() === c.toLowerCase()));

  const skuKey   = find('Part Number', 'SKU', 'sku', 'id', 'ID');
  const titleKey = find('Title', 'title', 'name', 'Name', 'Product Name');
  const imageKey = find('Images', 'Main Image', 'image', 'Image URL', 'Photo');
  const descKey  = find('Description', 'description', 'desc');
  const catKey   = find('Part Type', 'Category', 'category', 'Type');
  const specsKey = find('Attributes Full', 'Attributes Small', 'item_specifics', 'attributes');

  return rows.map(r => {
    const imgVal = imageKey ? r[imageKey] : '';
    const imgs   = imgVal ? [String(imgVal)] : [];

    // Build item_specifics from [key,val] arrays or objects
    let item_specifics = null;
    const rawSpecs = specsKey ? r[specsKey] : null;
    if (Array.isArray(rawSpecs) && rawSpecs.length && Array.isArray(rawSpecs[0])) {
      item_specifics = JSON.stringify(Object.fromEntries(rawSpecs));
    } else if (rawSpecs && typeof rawSpecs === 'object') {
      item_specifics = JSON.stringify(rawSpecs);
    } else if (typeof rawSpecs === 'string') {
      item_specifics = rawSpecs;
    }

    const desc = descKey ? String(r[descKey] || '') : '';
    const fab  = r['Features & Benefits'];
    const fullDesc = [
      desc,
      Array.isArray(fab) && fab.length ? 'Features:\n' + fab.map((f, i) => `${i+1}. ${f}`).join('\n') : '',
    ].filter(Boolean).join('\n\n');

    return {
      sku:            skuKey   ? String(r[skuKey]   || '') : JSON.stringify(r).slice(0, 30),
      title:          titleKey ? String(r[titleKey] || '') : '',
      ebay_title:     titleKey ? String(r[titleKey] || '') : '',
      url:            r.url || r.URL || null,
      images:         imgVal ? String(imgVal) : '',
      image_count:    imgs.length,
      category:       catKey ? String(r[catKey] || '') : '',
      description:    fullDesc,
      fitment:        r.fitment || r.Fitment || null,
      item_specifics,
      _imgs:          imgs,
      _imgs_all:      imgs,
    };
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.json': 'application/json',         '.css': 'text/css',
  '.png':  'image/png',                '.ico': 'image/x-icon',
};

function loadSelections() {
  try { return JSON.parse(fs.readFileSync(SEL_FILE, 'utf8')); } catch { return {}; }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve mapped data
  if (req.url === '/data.json' && req.method === 'GET') {
    const raw  = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const mapped = autoMap(raw, fieldsArg ? JSON.parse(fieldsArg) : {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mapped));
    return;
  }

  if (req.url === '/api/selections' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(loadSelections()));
    return;
  }

  if (req.url === '/api/selections' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        fs.writeFileSync(SEL_FILE, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400); res.end(e.message);
      }
    });
    return;
  }

  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(dashDir, urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
    const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  const rows = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  console.log(`\n  Preview: ${path.basename(dataArg)} (${rows.length} rows)`);
  console.log(`  → http://localhost:${port}\n`);
});
