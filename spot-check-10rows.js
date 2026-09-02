#!/usr/bin/env node
/**
 * spot-check-10rows.js
 * Renders a detailed side-by-side: source attrs vs every loadsheet column
 * for 10 hand-picked rows. Outputs an HTML report.
 */
'use strict';

const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');

const SOURCE = path.join(process.env.HOME, 'Downloads', 'export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx');
const FILLED = path.join(__dirname, (() => {
  const files = fs.readdirSync(__dirname)
    .filter(f => /^walmart-loadsheet-filled-v\d+\.xlsx$/.test(f))
    .sort((a, b) => {
      const n = f => parseInt(f.match(/v(\d+)/)[1]);
      return n(b) - n(a);
    });
  return files[0];
})());

// Pick rows that exercise different features:
//  0 → simple kit, universal fitment, shim kit
// 22 → antifreeze (fluid, net content)
// 34 → ECU (electronics indicator)
// 99 → engine coolant gallon, fluid
// 250 → disc brake pad, items included / material
// 299 → brake rotor, fitment multi-year
// 580 → remanufactured condition (search)
// 699 → spare tire, tire size
// 900 → something with warranty
// 1099 → wiper blade
const SPOT_IDXS = [0, 22, 34, 99, 250, 299, 580, 699, 900, 1099];

async function loadColHeaders() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILLED);
  const ws = wb.getWorksheet('Product Content And Site Exp');
  const human = {}, api = {};
  ws.getRow(4).eachCell({ includeEmpty: true }, (c, i) => { human[i] = String(c.value || ''); });
  ws.getRow(5).eachCell({ includeEmpty: true }, (c, i) => { api[i]   = String(c.value || ''); });
  return { ws, human, api };
}

async function streamSource() {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(SOURCE, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore',
  });
  const rows = [];
  let headers = null;
  reader.on('worksheet', ws => {
    ws.on('row', row => {
      const vals = row.values.slice(1);
      if (!headers) { headers = vals.map(v => String(v ?? '')); return; }
      const obj = {};
      headers.forEach((h, i) => {
        let v = vals[i];
        if (v && typeof v === 'object' && v.text) v = v.text;
        if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
        obj[h] = v ?? null;
      });
      obj._attrs = new Map();
      if (obj.attributes) {
        for (const part of String(obj.attributes).split('|')) {
          const c = part.indexOf(':');
          if (c === -1) continue;
          const k = part.slice(0, c).trim().toLowerCase().replace(/\s+/g, '_');
          const v = part.slice(c + 1).trim();
          if (k && v) obj._attrs.set(k, v);
        }
      }
      rows.push(obj);
    });
  });
  await new Promise((resolve, reject) => {
    reader.on('end', resolve);
    reader.on('error', reject);
    reader.read();
  });
  return rows;
}

function cell(v) {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

function trunc(s, n=80) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function esc(s) {
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

async function main() {
  const [{ ws, human, api }, sourceRows] = await Promise.all([
    loadColHeaders(),
    streamSource(),
  ]);

  const rows = [];

  for (const idx of SPOT_IDXS) {
    const src = sourceRows[idx];
    if (!src) continue;
    const sheetRow = ws.getRow(6 + idx);

    // Gather all filled columns
    const filled = [];
    for (let c = 1; c <= 94; c++) {
      const v = cell(sheetRow.getCell(c).value);
      const hdr = (human[c] || api[c] || `col${c}`).replace(/\(\+\)/g,'').trim();
      if (v) filled.push({ col: c, hdr, val: v });
    }

    // Gather all source attrs (sorted by key)
    const attrs = [];
    src._attrs.forEach((v, k) => attrs.push({ k, v }));
    attrs.sort((a,b) => a.k.localeCompare(b.k));

    // Direct columns
    const directCols = {
      'Part Number': src['Part Number'],
      'Part Type':   src['Part Type'],
      'Brand':       src['Brand'],
      'Title':       src['Title'],
    };

    rows.push({ idx, src, filled, attrs, directCols });
  }

  // ─── Build HTML ───────────────────────────────────────────────────────────

  const rowsHtml = rows.map(({ idx, src, filled, attrs, directCols }) => {
    const filledHtml = filled.map(({ col, hdr, val }) => {
      // highlight new v4 cols
      const isNew = [28, 29, 52, 77, 80].includes(col);
      const badge = isNew ? `<span class="badge badge-purple">v4</span>` : '';
      return `<tr>
        <td class="col-num">[${String(col).padStart(2)}]</td>
        <td class="col-name">${esc(hdr)} ${badge}</td>
        <td class="col-val">${esc(trunc(val, 120))}</td>
      </tr>`;
    }).join('');

    const attrsHtml = attrs.map(({ k, v }) =>
      `<tr><td class="attr-key-cell">${esc(k)}</td><td class="attr-val-cell">${esc(trunc(v, 100))}</td></tr>`
    ).join('');

    const directHtml = Object.entries(directCols).map(([k, v]) =>
      `<tr><td class="attr-key-cell">${esc(k)}</td><td class="attr-val-cell">${esc(trunc(String(v||''), 100))}</td></tr>`
    ).join('');

    return `
<div class="row-card">
  <div class="row-header">
    <span class="row-num">Row ${idx + 1}</span>
    <span class="part-num">${esc(src['Part Number'] || '—')}</span>
    <span class="part-type">${esc(String(src['Part Type'] || '').slice(0, 60))}</span>
    <span class="brand">${esc(String(src['Brand'] || ''))}</span>
  </div>
  <div class="row-body">
    <div class="panel">
      <div class="panel-header">Source Data</div>
      <table class="data-table">
        <thead><tr><th>Direct Column</th><th>Value</th></tr></thead>
        <tbody>${directHtml}</tbody>
      </table>
      ${attrs.length ? `
      <table class="data-table mt2">
        <thead><tr><th>Attribute Key</th><th>Value</th></tr></thead>
        <tbody>${attrsHtml}</tbody>
      </table>` : '<p class="no-attrs">No parsed attributes</p>'}
    </div>
    <div class="panel">
      <div class="panel-header">Loadsheet Output (${filled.length} cols filled)</div>
      <table class="data-table">
        <thead><tr><th>#</th><th>Column</th><th>Value</th></tr></thead>
        <tbody>${filledHtml || '<tr><td colspan="3" class="empty-msg">No columns filled</td></tr>'}</tbody>
      </table>
    </div>
  </div>
</div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spot Check — 10 Rows — v4.xlsx</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {
  --bg:        #0f172a;
  --surface:   #1e293b;
  --border:    #334155;
  --muted:     #0f172a;
  --text:      #e2e8f0;
  --text-sub:  #94a3b8;
  --text-dim:  #64748b;
  --text-dim2: #475569;
  --row-hover: #263347;
  --attr-bg:   rgba(14,165,233,0.05);
  --accent:    #7dd3fc;
  --accent-h:  #38bdf8;
  --attr-val:  #cbd5e1;
  --badge-bg:  #3b0764;
  --badge-fg:  #d8b4fe;
}
.light {
  --bg:        #f8fafc;
  --surface:   #ffffff;
  --border:    #e2e8f0;
  --muted:     #f1f5f9;
  --text:      #0f172a;
  --text-sub:  #475569;
  --text-dim:  #94a3b8;
  --text-dim2: #94a3b8;
  --row-hover: #f1f5f9;
  --attr-bg:   rgba(14,165,233,0.06);
  --accent:    #0284c7;
  --accent-h:  #0369a1;
  --attr-val:  #334155;
  --badge-bg:  #ede9fe;
  --badge-fg:  #6d28d9;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); font-size: 13px; transition: background 0.15s, color 0.15s; }
.header { background: var(--bg); border-bottom: 1px solid var(--border); padding: 16px 24px; position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 16px; }
.header-text { flex: 1; }
.header h1 { font-size: 16px; font-weight: 700; color: var(--text); }
.header p { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
.toggle-btn {
  display: flex; align-items: center; gap: 6px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 6px; padding: 6px 10px; cursor: pointer;
  font-size: 12px; font-family: 'Inter', sans-serif; color: var(--text-sub);
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.toggle-btn:hover { border-color: var(--accent); color: var(--accent); }
.toggle-btn svg { flex-shrink: 0; }
.container { max-width: 1600px; margin: 0 auto; padding: 24px; display: flex; flex-direction: column; gap: 24px; }
.row-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.row-header { background: var(--muted); border-bottom: 1px solid var(--border); padding: 10px 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.row-num { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text-dim); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; }
.part-num { font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: var(--accent); font-weight: 500; }
.part-type { font-size: 13px; color: var(--text); }
.brand { font-size: 12px; color: var(--text-sub); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; }
.row-body { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
.panel { padding: 0; border-right: 1px solid var(--border); }
.panel:last-child { border-right: none; }
.panel-header { padding: 8px 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim); background: var(--surface); border-bottom: 1px solid var(--border); }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th { padding: 6px 10px; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-dim2); border-bottom: 1px solid var(--border); background: var(--muted); text-align: left; }
.data-table td { padding: 5px 10px; border-bottom: 1px solid var(--border); vertical-align: top; word-break: break-word; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: var(--row-hover); }
.col-num { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text-dim); width: 36px; white-space: nowrap; }
.col-name { color: var(--text-sub); width: 220px; font-size: 12px; }
.col-val { color: var(--text); font-size: 12px; }
.attr-key-cell { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--accent); background: var(--attr-bg); width: 220px; }
.attr-val-cell { color: var(--attr-val); font-size: 12px; }
.badge { display: inline-flex; align-items: center; padding: 0 5px; border-radius: 9999px; font-size: 10px; font-weight: 700; }
.badge-purple { background: var(--badge-bg); color: var(--badge-fg); margin-left: 4px; }
.mt2 { margin-top: 8px; }
.no-attrs { padding: 8px 12px; color: var(--text-dim); font-size: 12px; font-style: italic; }
.empty-msg { padding: 8px; color: var(--text-dim); font-style: italic; text-align: center; }
.toc { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; }
.toc ul { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; }
.toc li a { color: var(--accent); font-size: 12px; text-decoration: none; }
.toc li a:hover { text-decoration: underline; color: var(--accent-h); }
</style>
</head>
<body>
<div class="header">
  <div class="header-text">
    <h1>Spot Check — 10 Sample Rows — walmart-loadsheet-filled-v4.xlsx</h1>
    <p>Source: ${path.basename(SOURCE)} · 1,252 rows · Generated 2026-03-30</p>
  </div>
  <button class="toggle-btn" id="theme-toggle" onclick="toggleTheme()" title="Toggle light/dark mode">
    <svg id="theme-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
    <span id="theme-label">Light mode</span>
  </button>
</div>
<script>
const MOON = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
const SUN  = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  document.getElementById('theme-label').textContent = isLight ? 'Dark mode' : 'Light mode';
  document.getElementById('theme-icon').innerHTML = isLight ? SUN : MOON;
  try { localStorage.setItem('theme', isLight ? 'light' : 'dark'); } catch(e) {}
}
(function() {
  try {
    if (localStorage.getItem('theme') === 'light') {
      document.body.classList.add('light');
      document.getElementById('theme-label').textContent = 'Dark mode';
      document.getElementById('theme-icon').innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    }
  } catch(e) {}
})();
</script>
<div class="container">
  <div class="toc">
    <ul>
      ${rows.map(({ idx, src }) =>
        `<li><a href="#row-${idx+1}">Row ${idx+1}: ${esc(String(src['Part Number']||''))} — ${esc(String(src['Part Type']||'').slice(0,40))}</a></li>`
      ).join('')}
    </ul>
  </div>
  ${rows.map(({ idx, src, filled, attrs, directCols }) => {
    // rebuild inner HTML with anchor
    const filledHtml2 = filled.map(({ col, hdr, val }) => {
      const isNew = [28, 29, 52, 77, 80].includes(col);
      const badge = isNew ? `<span class="badge badge-purple">v4</span>` : '';
      return `<tr><td class="col-num">[${String(col).padStart(2)}]</td><td class="col-name">${esc(hdr)} ${badge}</td><td class="col-val">${esc(trunc(val, 120))}</td></tr>`;
    }).join('');
    const attrsHtml2 = attrs.map(({ k, v }) =>
      `<tr><td class="attr-key-cell">${esc(k)}</td><td class="attr-val-cell">${esc(trunc(v, 100))}</td></tr>`
    ).join('');
    const directHtml2 = Object.entries(directCols).map(([k, v]) =>
      `<tr><td class="attr-key-cell">${esc(k)}</td><td class="attr-val-cell">${esc(trunc(String(v||''), 100))}</td></tr>`
    ).join('');
    return `
<div class="row-card" id="row-${idx+1}">
  <div class="row-header">
    <span class="row-num">Row ${idx + 1}</span>
    <span class="part-num">${esc(src['Part Number'] || '—')}</span>
    <span class="part-type">${esc(String(src['Part Type'] || '').slice(0, 60))}</span>
    <span class="brand">${esc(String(src['Brand'] || ''))}</span>
  </div>
  <div class="row-body">
    <div class="panel">
      <div class="panel-header">Source Data (${attrs.length} attrs)</div>
      <table class="data-table">
        <thead><tr><th>Direct Column</th><th>Value</th></tr></thead>
        <tbody>${directHtml2}</tbody>
      </table>
      ${attrs.length ? `
      <table class="data-table mt2">
        <thead><tr><th>Attribute Key</th><th>Value</th></tr></thead>
        <tbody>${attrsHtml2}</tbody>
      </table>` : '<p class="no-attrs">No parsed attributes</p>'}
    </div>
    <div class="panel">
      <div class="panel-header">Loadsheet Output (${filled.length} cols filled)</div>
      <table class="data-table">
        <thead><tr><th>#</th><th>Column</th><th>Value</th></tr></thead>
        <tbody>${filledHtml2 || '<tr><td colspan="3" class="empty-msg">No columns filled</td></tr>'}</tbody>
      </table>
    </div>
  </div>
</div>`;
  }).join('\n')}
</div>
</body>
</html>`;

  const outFile = path.join(__dirname, 'spot-check-10rows.html');
  fs.writeFileSync(outFile, html);
  console.log(`Written: ${outFile}`);

  // Print text summary
  console.log(`\nRows checked: ${rows.map(r => r.idx + 1).join(', ')}`);
  for (const { idx, src, filled } of rows) {
    console.log(`  Row ${idx+1} (${src['Part Number']}) — ${String(src['Part Type']||'').slice(0,40)} → ${filled.length} cols filled`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
