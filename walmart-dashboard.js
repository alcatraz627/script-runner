#!/usr/bin/env node
/**
 * walmart-dashboard.js
 * Picks N random rows from the Walmart Excel and generates a self-contained
 * HTML product dashboard, then opens it in the default browser.
 *
 * Usage: node walmart-dashboard.js [--count N] [--seed S] [--out file.html]
 */

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FILE = path.join(process.env.HOME, 'Downloads', 'export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx');
const TOTAL_ROWS = 1252;

const args = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const COUNT = parseInt(getArg('--count', '10'));
const SEED = parseInt(getArg('--seed', String(Date.now())));
const OUT = getArg('--out', path.join(__dirname, 'walmart-dashboard.html'));

// Seeded random (mulberry32)
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 0xFFFFFFFF; };
}

// Reservoir sampling (picks COUNT random rows in one pass)
function reservoirSample(n, total, rng) {
  const indices = new Set();
  // Pick N random 1-based row indices
  const pool = [];
  for (let i = 1; i <= total; i++) pool.push(i);
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  pool.slice(0, n).forEach(r => indices.add(r));
  return indices;
}

function parseImageFromAttrs(attrStr) {
  if (!attrStr) return null;
  const parts = attrStr.split('|').map(s => s.trim());
  const imgPart = parts.find(p => p.startsWith('image_url:'));
  if (!imgPart) return null;
  const urls = imgPart.replace('image_url:', '').trim().split(/\s+/).filter(u => u.startsWith('http'));
  return urls[0] || null;
}

function parseTokenTotal(usage) {
  if (!usage) return 0;
  const m = usage.match(/'total':\s*(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

function parseAttrs(attrStr) {
  if (!attrStr) return [];
  return attrStr.split('|').map(s => s.trim()).filter(s => s && !s.startsWith('image_url:') && !s.startsWith('price:') && !s.startsWith('upc:'));
}

async function run() {
  console.log(`Seed: ${SEED} | Sampling ${COUNT} rows…`);
  const rng = makeRng(SEED);
  const targetRows = reservoirSample(COUNT, TOTAL_ROWS, rng);

  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(FILE, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore',
  });

  const rows = [];
  let headers = null;
  let dataRowNum = 0;

  for await (const ws of workbook) {
    if (ws.id != 1) { for await (const _ of ws) {} continue; }
    for await (const row of ws) {
      const vals = row.values.slice(1);
      if (!headers) {
        headers = vals.map(v => (v && typeof v === 'object' && v.text) ? v.text : String(v ?? ''));
        continue;
      }
      dataRowNum++;
      if (!targetRows.has(dataRowNum)) continue;
      const obj = { _row: dataRowNum };
      headers.forEach((h, i) => {
        let v = vals[i];
        if (v && typeof v === 'object' && v.text) v = v.text;
        if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
        obj[h] = v ?? null;
      });
      rows.push(obj);
    }
  }

  // Sort by row number for consistent display
  rows.sort((a, b) => a._row - b._row);

  // Build HTML
  const cards = rows.map(r => {
    const img = parseImageFromAttrs(r['attributes']);
    const tokens = parseTokenTotal(r['$token_usage']);
    const attrs = parseAttrs(r['attributes']).slice(0, 12);
    const fab = (r['Features & Benefits'] || '').split('\n').filter(Boolean);
    const fitLines = (r['fitment'] || '').split('\n').filter(Boolean);

    const imgTag = img
      ? `<div class="img-wrap"><img src="${img}" onerror="this.closest('.img-wrap').innerHTML='<div class=no-img>No Image</div>'" loading="lazy"/></div>`
      : `<div class="img-wrap"><div class="no-img">No Image</div></div>`;

    const attrBadges = attrs.map(a => {
      const [k, ...rest] = a.split(':');
      return `<span class="badge"><span class="badge-key">${k.trim()}</span><span class="badge-val">${rest.join(':').trim()}</span></span>`;
    }).join('');

    const fabItems = fab.map(f => `<li>${f.replace(/^\d+\.\s*/, '')}</li>`).join('');
    const fitItems = fitLines.slice(0, 5).map(f => `<li>${f}</li>`).join('');
    const fitMore = fitLines.length > 5 ? `<li class="more">+${fitLines.length - 5} more…</li>` : '';

    const tokenChip = tokens > 0
      ? `<span class="token-chip">${(tokens / 1000).toFixed(1)}k tokens</span>`
      : `<span class="token-chip zero">0 tokens</span>`;

    return `
<article class="card" data-row="${r._row}">
  <div class="card-left">
    ${imgTag}
    <div class="meta">
      <span class="row-num">#${r._row}</span>
      ${tokenChip}
    </div>
  </div>
  <div class="card-body">
    <header class="card-header">
      <div class="brand-type"><span class="brand">${r['Brand'] || '—'}</span><span class="sep">·</span><span class="type">${r['Part Type'] || '—'}</span></div>
      <div class="pn">${r['Part Number'] || '—'}</div>
    </header>

    <h2 class="title-enhanced">${r['Title'] || ''}</h2>
    <p class="title-orig">Original: ${r['title'] || ''}</p>

    <p class="desc">${(r['Description'] || '').slice(0, 350)}${(r['Description'] || '').length > 350 ? '…' : ''}</p>

    <section class="section">
      <h3>Features &amp; Benefits</h3>
      <ol class="fab-list">${fabItems}</ol>
    </section>

    ${attrs.length ? `<section class="section attrs"><h3>Attributes</h3><div class="badge-wrap">${attrBadges}</div></section>` : ''}

    ${fitLines.length ? `<section class="section fitment"><h3>Fitment (${fitLines.length} vehicles)</h3><ul class="fit-list">${fitItems}${fitMore}</ul></section>` : ''}
  </div>
</article>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Walmart Enhancement — ${COUNT} Random Products</title>
<style>
  :root {
    --bg: #0e0e10; --surface: #18181b; --surface2: #27272a;
    --border: #3f3f46; --text: #e4e4e7; --muted: #71717a;
    --accent: #3b82f6; --green: #22c55e; --yellow: #eab308;
    --radius: 10px; --font: 'Inter', system-ui, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; line-height: 1.5; }
  .top-bar { background: var(--surface); border-bottom: 1px solid var(--border); padding: 14px 24px; display: flex; align-items: center; gap: 12px; position: sticky; top: 0; z-index: 10; }
  .top-bar h1 { font-size: 15px; font-weight: 600; color: var(--text); }
  .top-bar .subtitle { font-size: 12px; color: var(--muted); }
  .seed-info { margin-left: auto; font-size: 11px; color: var(--muted); font-family: monospace; }
  .feed { max-width: 1000px; margin: 0 auto; padding: 24px 16px; display: flex; flex-direction: column; gap: 20px; }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); display: flex; gap: 0; overflow: hidden; }
  .card:hover { border-color: var(--accent); }

  .card-left { width: 180px; min-width: 180px; display: flex; flex-direction: column; background: var(--surface2); }
  .img-wrap { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 160px; }
  .img-wrap img { width: 100%; height: 180px; object-fit: contain; padding: 8px; }
  .no-img { color: var(--muted); font-size: 12px; text-align: center; padding: 16px; }
  .meta { padding: 8px 10px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); }
  .row-num { font-size: 11px; color: var(--muted); font-family: monospace; }
  .token-chip { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #1d4ed8; color: #bfdbfe; font-family: monospace; }
  .token-chip.zero { background: var(--surface2); color: var(--muted); }

  .card-body { flex: 1; padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .brand-type { display: flex; align-items: center; gap: 6px; }
  .brand { font-weight: 600; color: var(--accent); font-size: 13px; }
  .sep { color: var(--muted); }
  .type { color: var(--muted); font-size: 13px; }
  .pn { font-family: monospace; font-size: 12px; background: var(--surface2); border: 1px solid var(--border); padding: 2px 8px; border-radius: 4px; white-space: nowrap; }

  .title-enhanced { font-size: 14px; font-weight: 600; line-height: 1.4; }
  .title-orig { font-size: 11px; color: var(--muted); font-style: italic; }
  .desc { font-size: 13px; color: #a1a1aa; line-height: 1.6; }

  .section h3 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 6px; }
  .fab-list { padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
  .fab-list li { font-size: 12.5px; color: #d4d4d8; }

  .badge-wrap { display: flex; flex-wrap: wrap; gap: 5px; }
  .badge { display: inline-flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; font-size: 11px; }
  .badge-key { background: var(--surface2); color: var(--muted); padding: 2px 6px; }
  .badge-val { background: var(--bg); color: var(--text); padding: 2px 7px; }

  .fit-list { list-style: none; display: flex; flex-direction: column; gap: 2px; }
  .fit-list li { font-size: 11.5px; color: #a1a1aa; }
  .fit-list li::before { content: "→ "; color: var(--muted); }
  .fit-list .more { color: var(--muted); font-style: italic; }
  .fit-list .more::before { content: ""; }

  @media (max-width: 640px) {
    .card { flex-direction: column; }
    .card-left { width: 100%; min-width: unset; flex-direction: row; }
    .img-wrap { min-height: 120px; }
  }
</style>
</head>
<body>
<div class="top-bar">
  <div>
    <h1>Walmart Enhancement — ${COUNT} Random Products</h1>
    <div class="subtitle">export_Walmart Scrape Organized v3 3 30 26 (Enhancement) · 1,252 total rows</div>
  </div>
  <div class="seed-info">seed: ${SEED}</div>
</div>
<div class="feed">
${cards}
</div>
</body>
</html>`;

  fs.writeFileSync(OUT, html);
  console.log(`✓ Written: ${OUT}`);
  execSync(`open "${OUT}"`);
  console.log('✓ Opened in browser');
}

run().catch(err => { console.error(err); process.exit(1); });
