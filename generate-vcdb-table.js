#!/usr/bin/env node
/**
 * generate-vcdb-table.js
 *
 * Reads the VCDB Excel (streaming), picks N random product URLs (reproducible
 * with --seed), collects ALL their raw rows, and writes a self-contained HTML
 * file with a sortable/searchable/filterable table + per-row checkbox & notes
 * persisted in localStorage.
 *
 * Usage:
 *   node generate-vcdb-table.js [--seed N] [--count N] [--out vcdb-table.html]
 *
 * Re-run with same seed to reproduce the same sample.
 */

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const INPUT = path.join(
  process.env.HOME,
  'Downloads',
  'Versable Sample Item List_marketplace_extracts_v6_1_cc32_VCDB.xlsx'
);

const args = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
const SAMPLE_COUNT = parseInt(getArg('--count', '5'), 10);
const SEED = parseInt(getArg('--seed', String(Date.now())), 10);
const OUT_FILE = getArg('--out', path.join(__dirname, 'vcdb-table.html'));

function seededShuffle(arr, seed) {
  let s = seed >>> 0;
  const lcg = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(lcg() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function streamRows(targetUrls, onRow) {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(INPUT, {
    entries: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit',
  });
  let headers = null;
  const urlSet = new Set(targetUrls);

  await new Promise((resolve, reject) => {
    reader.on('worksheet', (ws) => {
      ws.on('row', (row) => {
        if (ws.id != 1) return;
        const vals = row.values; // 1-indexed sparse array
        if (!headers) {
          headers = [];
          for (let i = 1; i < vals.length; i++) headers[i] = vals[i];
          return;
        }
        const get = (col) => {
          const idx = headers.indexOf(col);
          const v = idx !== -1 ? row.getCell(idx).value : null;
          if (v === null || v === undefined) return null;
          // Unwrap rich text / hyperlink objects
          if (typeof v === 'object' && v.richText) return v.richText.map(r => r.text).join('');
          if (typeof v === 'object' && v.text) return String(v.text);
          return String(v);
        };
        const url = get('url');
        if (!url || !urlSet.has(url)) return;
        const obj = {};
        for (let i = 1; i < headers.length; i++) {
          if (headers[i]) obj[headers[i]] = get(headers[i]);
        }
        onRow(obj);
      });
    });
    reader.on('end', resolve);
    reader.on('error', reject);
    reader.read();
  });
  return headers.filter(Boolean);
}

// ── Pass 1: collect unique URLs ──────────────────────────────────────────────
async function collectUrls() {
  const urlSet = new Set();
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(INPUT, {
    entries: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit',
  });
  let urlColIdx = -1, headerRead = false;
  await new Promise((resolve, reject) => {
    reader.on('worksheet', (ws) => {
      ws.on('row', (row) => {
        if (ws.id != 1) return;
        const vals = row.values;
        if (!headerRead) {
          for (let i = 1; i < vals.length; i++) if (vals[i] === 'url') { urlColIdx = i; break; }
          headerRead = true;
          return;
        }
        const v = row.getCell(urlColIdx).value;
        if (v) urlSet.add(typeof v === 'object' ? (v.text || JSON.stringify(v)) : String(v));
      });
    });
    reader.on('end', resolve);
    reader.on('error', reject);
    reader.read();
  });
  return [...urlSet];
}

// ── HTML generation ──────────────────────────────────────────────────────────
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(rows, headers, meta) {
  // Columns to show truncated (long text)
  const TRUNCATE_COLS = new Set(['raw_fitment', 'raw_match_json', 'error']);
  // Columns where we render as link
  const LINK_COLS = new Set(['url']);

  const colsJson = JSON.stringify(headers);
  const rowsJson = JSON.stringify(rows);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VCDB Fitment Table — ${meta.count} products</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    --bg: #0f0f12; --surface: #18181c; --border: #2a2a32;
    --text: #e4e4ef; --muted: #7a7a8e; --accent: #6366f1;
    --accent-dim: #3d3f7a; --row-hover: #1e1e28; --row-checked: #1a1a30;
    --tag-bg: #252530; --warn: #f59e0b; --mark-bg: rgba(99,102,241,0.22);
    --tag-full-bg:#1a3a1a; --tag-full-bd:#2a6a2a; --tag-full-tx:#6deb6d;
    --tag-partial-bg:#2a2a10; --tag-partial-bd:#5a5a20; --tag-partial-tx:#c8c840;
    --tag-none-bg:#3a1a1a; --tag-none-bd:#6a2a2a; --tag-none-tx:#eb6d6d;
    --modal-scrim: rgba(0,0,0,.6);
  }
  :root.light {
    --bg: #f5f5fa; --surface: #ffffff; --border: #d4d4e0;
    --text: #18182a; --muted: #6060780; --accent: #4547c9;
    --accent-dim: #eaeafb; --row-hover: #f0f0f8; --row-checked: #e8e8fb;
    --tag-bg: #eeeef6; --warn: #c27a00; --mark-bg: rgba(69,71,201,0.15);
    --tag-full-bg:#e4f7e4; --tag-full-bd:#7dc87d; --tag-full-tx:#1a5c1a;
    --tag-partial-bg:#fdf8da; --tag-partial-bd:#b0a820; --tag-partial-tx:#635900;
    --tag-none-bg:#fde8e8; --tag-none-bd:#d08080; --tag-none-tx:#8b1a1a;
    --modal-scrim: rgba(0,0,0,.35);
  }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: 'Geist', 'Inter', system-ui, sans-serif;
    font-size: 13px; transition: background 0.2s, color 0.2s;
    display: flex; flex-direction: column; height: 100dvh; overflow: hidden; }

  /* ── Top bar — flex item, not sticky (sticky breaks child sticky) ── */
  #topbar { flex-shrink: 0; z-index: 100; background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 10px 14px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  #topbar h1 { margin: 0; font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; }
  #topbar .meta { font-size: 11px; color: var(--muted); white-space: nowrap; }
  #search { flex: 1; min-width: 180px; max-width: 320px; padding: 5px 10px; background: var(--bg);
    border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; outline: none; }
  #search:focus { border-color: var(--accent); }
  #search::placeholder { color: var(--muted); }
  .col-filter-wrap { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
  #count-badge { font-size: 11px; color: var(--muted); white-space: nowrap; }
  #export-btn { padding: 5px 12px; background: var(--accent-dim); border: 1px solid var(--accent);
    color: var(--text); border-radius: 6px; font-size: 12px; cursor: pointer; white-space: nowrap; }
  #export-btn:hover { background: var(--accent); }
  #clear-checked { padding: 5px 10px; background: transparent; border: 1px solid var(--border);
    color: var(--muted); border-radius: 6px; font-size: 12px; cursor: pointer; }
  #clear-checked:hover { border-color: var(--warn); color: var(--warn); }

  /* ── Table wrapper — owns the scroll, so thead sticky works ── */
  #table-wrap { flex: 1; overflow: auto; min-height: 0; }
  table { border-collapse: collapse; width: max-content; min-width: 100%; }

  /* ── Header — sticky to #table-wrap's viewport (top: 0) ── */
  thead th { position: sticky; top: 0; background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 7px 10px; text-align: left; font-size: 11px; font-weight: 600; color: var(--muted);
    white-space: nowrap; cursor: pointer; user-select: none; z-index: 10; }
  thead th:first-child, thead th:nth-child(2) { cursor: default; }
  thead th:first-child { width: 36px; text-align: center; }
  thead th.sort-asc::after { content: ' ▲'; color: var(--accent); }
  thead th.sort-desc::after { content: ' ▼'; color: var(--accent); }
  thead th:hover:not(:first-child):not(:nth-child(2)) { color: var(--text); background: var(--row-hover); }

  /* ── Rows ── */
  tbody tr { border-bottom: 1px solid var(--border); transition: background 0.1s; }
  tbody tr:hover { background: var(--row-hover); }
  tbody tr.checked { background: var(--row-checked); }
  /* default: clip overflow */
  tbody td { padding: 6px 10px; vertical-align: top; white-space: nowrap; max-width: 260px;
    overflow: hidden; text-overflow: ellipsis; font-size: 12px; cursor: pointer; }
  tbody td:hover:not(.check-col):not(.notes-col) { color: var(--accent); }
  tbody td.truncatable { max-width: 200px; }
  tbody td.truncatable:hover { text-decoration: underline dotted; }
  /* wrap mode */
  body.wrap-cells tbody td:not(.check-col):not(.notes-col) {
    white-space: normal; max-width: 400px; overflow: visible; text-overflow: unset; word-break: break-word; }

  /* ── Pagination ── */
  #pagination { flex-shrink: 0; background: var(--surface); border-top: 1px solid var(--border);
    padding: 7px 14px; display: flex; gap: 10px; align-items: center; font-size: 12px; flex-wrap: wrap; }
  #pagination .pg-info { color: var(--muted); white-space: nowrap; }
  #pagination .pg-info strong { color: var(--text); }
  .pg-btn { padding: 3px 9px; background: transparent; border: 1px solid var(--border);
    color: var(--text); border-radius: 5px; font-size: 12px; cursor: pointer; }
  .pg-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .pg-btn:disabled { opacity: 0.35; cursor: default; }
  .pg-btn.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); font-weight: 600; }
  #pg-jump { width: 48px; padding: 3px 6px; background: var(--bg); border: 1px solid var(--border);
    color: var(--text); border-radius: 5px; font-size: 12px; text-align: center; outline: none; }
  #pg-jump:focus { border-color: var(--accent); }
  #pg-size { padding: 3px 6px; background: var(--bg); border: 1px solid var(--border);
    color: var(--text); border-radius: 5px; font-size: 12px; outline: none; cursor: pointer; }
  #pg-size:focus { border-color: var(--accent); }

  /* ── Checkbox column ── */
  td.check-col { text-align: center; width: 36px; vertical-align: middle; }
  input[type=checkbox] { width: 14px; height: 14px; accent-color: var(--accent); cursor: pointer; }

  /* ── Notes ── */
  td.notes-col { min-width: 180px; max-width: 240px; white-space: normal; }
  .notes-input { width: 100%; background: transparent; border: none; border-bottom: 1px dashed var(--border);
    color: var(--text); font-size: 11px; padding: 2px 4px; outline: none; resize: none; min-height: 22px;
    font-family: inherit; overflow: hidden; }
  .notes-input:focus { border-bottom-color: var(--accent); background: var(--surface); border-radius: 3px; }

  /* ── Tags ── */
  .url-link { color: var(--accent); text-decoration: none; font-size: 11px; }
  .url-link:hover { text-decoration: underline; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px;
    background: var(--tag-bg); border: 1px solid var(--border); margin: 1px; }
  .tag.full    { background: var(--tag-full-bg);    border-color: var(--tag-full-bd);    color: var(--tag-full-tx); }
  .tag.partial { background: var(--tag-partial-bg); border-color: var(--tag-partial-bd); color: var(--tag-partial-tx); }
  .tag.none    { background: var(--tag-none-bg);    border-color: var(--tag-none-bd);    color: var(--tag-none-tx); }

  /* ── Empty state ── */
  #empty { display: none; padding: 40px; text-align: center; color: var(--muted); font-size: 14px; }

  /* ── Modal for full cell value ── */
  #modal-overlay { display: none; position: fixed; inset: 0; background: var(--modal-scrim); z-index: 1000; align-items: center; justify-content: center; }
  #modal-overlay.open { display: flex; }
  #modal-box { background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    max-width: 700px; width: 90vw; max-height: 80vh; overflow-y: auto; padding: 20px; position: relative; }
  #modal-box h3 { margin: 0 0 10px; font-size: 13px; color: var(--muted); }
  #modal-content { font-size: 12px; white-space: pre-wrap; word-break: break-word; line-height: 1.6; color: var(--text); }
  #modal-close { position: absolute; top: 12px; right: 14px; background: none; border: none;
    color: var(--muted); font-size: 18px; cursor: pointer; padding: 0; }
  #modal-close:hover { color: var(--text); }

  /* ── Highlight ── */
  mark { background: var(--mark-bg); color: var(--text); border-radius: 2px; padding: 0 1px; }

  /* ── Theme toggle ── */
  #theme-toggle { padding: 5px 9px; background: transparent; border: 1px solid var(--border);
    color: var(--muted); border-radius: 6px; font-size: 13px; cursor: pointer; line-height: 1; }
  #theme-toggle:hover { border-color: var(--accent); color: var(--text); }

  /* ── Filter inputs ── */
  .col-filter-wrap { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
  .col-filter-input { background: var(--bg); border: 1px solid var(--border); color: var(--text);
    font-size: 12px; padding: 4px 8px; border-radius: 6px; outline: none; width: 130px; font-family: inherit; }
  .col-filter-input:focus { border-color: var(--accent); }
  .col-filter-input::placeholder { color: var(--muted); font-style: italic; }
</style>
</head>
<body>

<div id="topbar">
  <h1>VCDB Fitment</h1>
  <span class="meta">seed: ${meta.seed} &nbsp;|&nbsp; ${meta.count} products &nbsp;|&nbsp; ${rows.length} rows</span>
  <input id="search" type="text" placeholder="Search all columns..." autocomplete="off" spellcheck="false">
  <div class="col-filter-wrap" id="filter-dropdowns"></div>
  <span id="count-badge"></span>
  <button id="wrap-toggle" title="Toggle cell wrapping">⇔ Wrap</button>
  <button id="clear-checked">Clear checked</button>
  <button id="export-btn">Export checked CSV</button>
  <button id="theme-toggle" title="Toggle light/dark mode">☀</button>
</div>

<div id="table-wrap">
  <table id="main-table">
    <thead id="thead"></thead>
    <tbody id="tbody"></tbody>
  </table>
  <div id="empty">No rows match your filters.</div>
</div>

<div id="pagination">
  <button class="pg-btn" id="pg-first" title="First page">«</button>
  <button class="pg-btn" id="pg-prev">‹ Prev</button>
  <div id="pg-pages" style="display:flex;gap:4px;"></div>
  <button class="pg-btn" id="pg-next">Next ›</button>
  <button class="pg-btn" id="pg-last" title="Last page">»</button>
  <span class="pg-info" id="pg-info"></span>
  <label style="color:var(--muted);font-size:11px;">Page <input id="pg-jump" type="number" min="1" value="1"> of <span id="pg-total"></span></label>
  <label style="color:var(--muted);font-size:11px;">Rows/page
    <select id="pg-size">
      <option value="20" selected>20</option>
      <option value="50">50</option>
      <option value="100">100</option>
      <option value="250">250</option>
    </select>
  </label>
</div>

<div id="modal-overlay">
  <div id="modal-box">
    <button id="modal-close">✕</button>
    <h3 id="modal-title"></h3>
    <pre id="modal-content"></pre>
  </div>
</div>

<script>
const COLS = ${colsJson};
const ROWS = ${rowsJson};
const TRUNCATE = new Set(${JSON.stringify([...TRUNCATE_COLS])});
const LINK = new Set(${JSON.stringify([...LINK_COLS])});
const FILTERABLE = ['productbrand', 'MakeName', 'ModelName', 'match_status', 'status', 'SubModelName', 'Liter', 'BlockType', 'Cylinders'];

// ── State ──────────────────────────────────────────────────────────────────
let sortCol = null, sortDir = 1;
let searchTerm = '';
let colFilters = {};  // col → value
const noteTimers = {};  // key → debounce timer id
const LS_KEY = 'vcdb_table_v1';
let currentPage = 1;
let pageSize = 20;

function lsGet() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function lsSet(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

// stable row key (url + row index in original array)
function rowKey(row, idx) { return (row.url || '') + '::' + idx; }

// ── Build header ───────────────────────────────────────────────────────────
const thead = document.getElementById('thead');
const trHead = document.createElement('tr');
// checkbox col
const thCk = document.createElement('th');
thCk.innerHTML = '<input type="checkbox" id="select-all" title="Select all visible">';
trHead.appendChild(thCk);
// notes col
const thNotes = document.createElement('th');
thNotes.textContent = 'Notes';
trHead.appendChild(thNotes);

COLS.forEach((col, ci) => {
  const th = document.createElement('th');
  th.textContent = col;
  th.dataset.col = col;
  th.addEventListener('click', () => {
    if (sortCol === col) sortDir = -sortDir;
    else { sortCol = col; sortDir = 1; }
    render();
  });
  trHead.appendChild(th);
});
thead.appendChild(trHead);

// ── Build filter inputs with datalist suggestions ──────────────────────────
const filterWrap = document.getElementById('filter-dropdowns');
FILTERABLE.forEach(col => {
  const vals = [...new Set(ROWS.map(r => r[col]).filter(v => v !== null && v !== ''))].sort();
  if (vals.length < 2) return;

  const dlId = 'dl-' + col.replace(/[^a-zA-Z0-9]/g, '_');
  const dl = document.createElement('datalist');
  dl.id = dlId;
  vals.forEach(v => { const opt = document.createElement('option'); opt.value = v; dl.appendChild(opt); });
  document.body.appendChild(dl);

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'col-filter-input';
  inp.placeholder = col;
  inp.setAttribute('list', dlId);
  inp.dataset.col = col;

  let filterTimer;
  inp.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { colFilters[col] = inp.value.trim(); currentPage = 1; render(); }, 160);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { inp.value = ''; colFilters[col] = ''; currentPage = 1; render(); }
  });
  filterWrap.appendChild(inp);
});

// ── Render ─────────────────────────────────────────────────────────────────
const tbody = document.getElementById('tbody');
const emptyEl = document.getElementById('empty');
const countBadge = document.getElementById('count-badge');

function highlight(str, term) {
  if (!term || !str) return escHtml(str);
  const re = new RegExp('(' + term.replace(/[.*+?^{}()|[\\]\\\\$]/g, '\\\\$&') + ')', 'gi');
  return escHtml(str).replace(re, '<mark>$1</mark>');
}

function escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function matchStatusTag(val) {
  const cls = val === 'full' ? 'full' : val === 'partial' ? 'partial' : val ? 'none' : '';
  return '<span class="tag ' + cls + '">' + escHtml(val) + '</span>';
}

function render() {
  const saved = lsGet();
  const term = searchTerm.toLowerCase();

  // Filter — col filters use case-insensitive partial match
  let filtered = ROWS.map((r, i) => ({ r, i })).filter(({ r }) => {
    for (const [col, val] of Object.entries(colFilters)) {
      if (val && !(r[col] || '').toLowerCase().includes(val.toLowerCase())) return false;
    }
    if (term) {
      const haystack = COLS.map(c => r[c] || '').join(' ').toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  // Sort
  if (sortCol) {
    filtered.sort((a, b) => {
      const av = a.r[sortCol] || '', bv = b.r[sortCol] || '';
      const an = parseFloat(av), bn = parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
  }

  // Update sort indicators
  document.querySelectorAll('thead th[data-col]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === sortCol) th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  const pageSlice = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Re-render only the current page
  tbody.innerHTML = '';
  pageSlice.forEach(({ r, i }) => {
    const key = rowKey(r, i);
    const saved_row = saved[key] || {};
    const tr = document.createElement('tr');
    tr.dataset.key = key;
    if (saved_row.checked) tr.classList.add('checked');

    // checkbox
    const tdCk = document.createElement('td');
    tdCk.className = 'check-col';
    const ck = document.createElement('input');
    ck.type = 'checkbox';
    ck.checked = !!saved_row.checked;
    ck.addEventListener('change', () => {
      const s = lsGet(); s[key] = s[key] || {}; s[key].checked = ck.checked;
      lsSet(s); tr.classList.toggle('checked', ck.checked);
    });
    tdCk.appendChild(ck);
    tr.appendChild(tdCk);

    // notes
    const tdN = document.createElement('td');
    tdN.className = 'notes-col';
    const ta = document.createElement('textarea');
    ta.className = 'notes-input'; ta.rows = 1; ta.placeholder = '…';
    ta.value = saved_row.notes || '';
    ta.addEventListener('click', (e) => e.stopPropagation());
    ta.addEventListener('input', () => {
      ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
      clearTimeout(noteTimers[key]);
      noteTimers[key] = setTimeout(() => {
        const s = lsGet(); s[key] = s[key] || {}; s[key].notes = ta.value; lsSet(s);
      }, 400);
    });
    if (ta.value) { ta.style.height = 'auto'; setTimeout(() => { ta.style.height = ta.scrollHeight + 'px'; }, 0); }
    tdN.appendChild(ta);
    tr.appendChild(tdN);

    // data cells
    COLS.forEach(col => {
      const td = document.createElement('td');
      const val = r[col];
      const displayVal = val !== null && val !== undefined ? String(val) : '';

      if (col === 'match_status') {
        td.innerHTML = matchStatusTag(val);
        // still clickable for search
        td.addEventListener('click', () => setCellSearch(displayVal));
      } else if (LINK.has(col) && val) {
        const shortLabel = val.replace(new RegExp('.*/i/'), '').replace(new RegExp('/10002.*'), '');
        td.innerHTML = '<span class="url-link">' + highlight(shortLabel, term) + '</span>';
        td.title = val + ' — middle-click to open';
        // left click = set search to the short label
        td.addEventListener('click', (e) => { e.preventDefault(); setCellSearch(shortLabel); });
        // middle click = open URL
        td.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); window.open(val, '_blank', 'noopener'); } });
      } else if (TRUNCATE.has(col) && val && val.length > 80) {
        td.className = 'truncatable';
        td.textContent = val.slice(0, 80) + '…';
        td.title = 'Click to expand — right-click to search';
        td.addEventListener('click', () => openModal(col, val));
        td.addEventListener('contextmenu', (e) => { e.preventDefault(); setCellSearch(displayVal); });
      } else {
        td.innerHTML = highlight(displayVal, term);
        td.addEventListener('click', () => setCellSearch(displayVal));
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  countBadge.textContent = total + ' / ' + ROWS.length + ' rows';
  emptyEl.style.display = total === 0 ? 'block' : 'none';
  renderPagination(total, totalPages);
}

// ── Cell-click search toggle ────────────────────────────────────────────────
const searchEl = document.getElementById('search');
function setCellSearch(val) {
  const trimmed = (val || '').trim();
  if (!trimmed) return;
  if (searchEl.value.trim() === trimmed) {
    searchEl.value = ''; searchTerm = '';
  } else {
    searchEl.value = trimmed; searchTerm = trimmed;
  }
  currentPage = 1;
  render();
}

// ── Pagination render ────────────────────────────────────────────────────────
function renderPagination(total, totalPages) {
  const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);

  document.getElementById('pg-info').innerHTML =
    'Showing <strong>' + start + '–' + end + '</strong> of <strong>' + total + '</strong>' +
    (total !== ROWS.length ? ' (filtered from ' + ROWS.length + ')' : ' rows');
  document.getElementById('pg-total').textContent = totalPages;
  document.getElementById('pg-jump').value = currentPage;

  document.getElementById('pg-first').disabled = currentPage <= 1;
  document.getElementById('pg-prev').disabled = currentPage <= 1;
  document.getElementById('pg-next').disabled = currentPage >= totalPages;
  document.getElementById('pg-last').disabled = currentPage >= totalPages;

  // Page number buttons (show window of 5 around current)
  const pgPages = document.getElementById('pg-pages');
  pgPages.innerHTML = '';
  const window_ = 2;
  const lo = Math.max(1, currentPage - window_);
  const hi = Math.min(totalPages, currentPage + window_);
  if (lo > 1) { addPageBtn(pgPages, 1); if (lo > 2) pgPages.insertAdjacentHTML('beforeend', '<span style="color:var(--muted);padding:0 2px">…</span>'); }
  for (let p = lo; p <= hi; p++) addPageBtn(pgPages, p);
  if (hi < totalPages) { if (hi < totalPages - 1) pgPages.insertAdjacentHTML('beforeend', '<span style="color:var(--muted);padding:0 2px">…</span>'); addPageBtn(pgPages, totalPages); }
}

function addPageBtn(container, p) {
  const btn = document.createElement('button');
  btn.className = 'pg-btn' + (p === currentPage ? ' active' : '');
  btn.textContent = p;
  btn.addEventListener('click', () => { currentPage = p; render(); });
  container.appendChild(btn);
}

// ── Select all ────────────────────────────────────────────────────────────
document.getElementById('select-all').addEventListener('change', (e) => {
  const s = lsGet();
  tbody.querySelectorAll('input[type=checkbox]').forEach((ck, idx) => {
    ck.checked = e.target.checked;
    const tr = ck.closest('tr');
    tr.classList.toggle('checked', e.target.checked);
    // find row key from order
    const trs = [...tbody.querySelectorAll('tr')];
    const rowIdx = trs.indexOf(tr);
    // re-derive key — we store rowKey on the row for speed
    const key = tr.dataset.key;
    if (key) { s[key] = s[key] || {}; s[key].checked = e.target.checked; }
  });
  lsSet(s);
});

// render already sets tr.dataset.key; no patch needed

// ── Search (debounced 220ms) ───────────────────────────────────────────────
let searchTimer;
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { searchTerm = e.target.value; currentPage = 1; render(); }, 220);
});

// ── Clear checked ─────────────────────────────────────────────────────────
document.getElementById('clear-checked').addEventListener('click', () => {
  if (!confirm('Clear all checked rows and notes?')) return;
  lsSet({});
  render();
});

// ── Export CSV ────────────────────────────────────────────────────────────
document.getElementById('export-btn').addEventListener('click', () => {
  const saved = lsGet();
  const checkedRows = ROWS.map((r, i) => ({ r, i })).filter(({ r, i }) => {
    const key = rowKey(r, i);
    return saved[key] && saved[key].checked;
  });
  if (!checkedRows.length) { alert('No rows checked.'); return; }
  const allCols = ['_notes', ...COLS];
  const lines = [allCols.map(c => '"' + c + '"').join(',')];
  checkedRows.forEach(({ r, i }) => {
    const key = rowKey(r, i);
    const notes = (saved[key] && saved[key].notes) || '';
    lines.push([notes, ...COLS.map(c => r[c] || '')].map(v =>
      '"' + String(v).replace(/"/g, '""') + '"'
    ).join(','));
  });
  const blob = new Blob([lines.join('\\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'vcdb-checked.csv' });
  a.click();
});

// ── Modal ─────────────────────────────────────────────────────────────────
const overlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalContent = document.getElementById('modal-content');

function openModal(colName, val) {
  modalTitle.textContent = colName;
  let display = val;
  try { display = JSON.stringify(JSON.parse(val), null, 2); } catch {}
  modalContent.textContent = display;
  overlay.classList.add('open');
}
document.getElementById('modal-close').addEventListener('click', () => overlay.classList.remove('open'));
overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.classList.remove('open'); });

// ── Wrap toggle ───────────────────────────────────────────────────────────
const wrapBtn = document.getElementById('wrap-toggle');
let wrapCells = localStorage.getItem('vcdb_wrap') === '1';
function applyWrap(on) {
  document.body.classList.toggle('wrap-cells', on);
  wrapBtn.style.color = on ? 'var(--accent)' : '';
  wrapBtn.style.borderColor = on ? 'var(--accent)' : '';
}
applyWrap(wrapCells);
wrapBtn.addEventListener('click', () => {
  wrapCells = !wrapCells;
  localStorage.setItem('vcdb_wrap', wrapCells ? '1' : '0');
  applyWrap(wrapCells);
});

// ── Theme toggle ──────────────────────────────────────────────────────────
const THEME_KEY = 'vcdb_theme';
function applyTheme(light) {
  document.documentElement.classList.toggle('light', light);
  document.getElementById('theme-toggle').textContent = light ? '☾' : '☀';
}
applyTheme(localStorage.getItem(THEME_KEY) === 'light');
document.getElementById('theme-toggle').addEventListener('click', () => {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
  document.getElementById('theme-toggle').textContent = isLight ? '☾' : '☀';
});

// ── Pagination controls ────────────────────────────────────────────────────
document.getElementById('pg-first').addEventListener('click', () => { currentPage = 1; render(); });
document.getElementById('pg-prev').addEventListener('click', () => { if (currentPage > 1) { currentPage--; render(); } });
document.getElementById('pg-next').addEventListener('click', () => { currentPage++; render(); });
document.getElementById('pg-last').addEventListener('click', () => {
  const total = ROWS.filter(r => {
    for (const [col, val] of Object.entries(colFilters)) if (val && !(r[col]||'').toLowerCase().includes(val.toLowerCase())) return false;
    if (searchTerm) { const h = COLS.map(c=>r[c]||'').join(' ').toLowerCase(); if (!h.includes(searchTerm)) return false; }
    return true;
  }).length;
  currentPage = Math.max(1, Math.ceil(total / pageSize)); render();
});
document.getElementById('pg-jump').addEventListener('change', (e) => {
  const p = parseInt(e.target.value, 10);
  if (!isNaN(p) && p >= 1) { currentPage = p; render(); }
});
document.getElementById('pg-size').addEventListener('change', (e) => {
  pageSize = parseInt(e.target.value, 10); currentPage = 1; render();
});

// ── Init ──────────────────────────────────────────────────────────────────
render();
</script>
</body>
</html>`;
}

async function main() {
  console.log(`Reading: ${INPUT}`);
  console.log(`Seed: ${SEED}  Count: ${SAMPLE_COUNT}`);

  // Pass 1: collect unique URLs
  const allUrls = await collectUrls();
  console.log(`Unique URLs: ${allUrls.length}`);

  const picked = seededShuffle(allUrls, SEED).slice(0, SAMPLE_COUNT);
  console.log(`Sampled:\n${picked.map((u, i) => `  ${i+1}. ${u}`).join('\n')}`);

  // Pass 2: collect all rows for picked URLs
  const rows = [];
  const headers = await streamRows(picked, (row) => rows.push(row));
  console.log(`Total rows collected: ${rows.length}`);

  // Build and write HTML
  const html = buildHtml(rows, headers, { seed: SEED, count: SAMPLE_COUNT });
  fs.writeFileSync(OUT_FILE, html, 'utf8');
  console.log(`\nWritten: ${OUT_FILE}  (${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
