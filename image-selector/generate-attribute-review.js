#!/usr/bin/env node
/**
 * generate-attribute-review.js
 *
 * Generates a self-contained HTML file for interactive attribute review.
 * No server needed — open the HTML file directly in a browser.
 *
 * Usage:
 *   node generate-attribute-review.js [--input <path>] [--output <path>]
 *
 * Defaults:
 *   --input  datasets/attr-gaps-final/all-attributes.json
 *   --output attribute-review.html (in project root)
 */

const fs   = require('fs');
const path = require('path');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const inputPath  = getArg('--input') || path.join(__dirname, 'datasets/attr-gaps-final/all-attributes.json');
const outputPath = getArg('--output') || path.join(__dirname, '..', 'attribute-review.html');

if (!fs.existsSync(inputPath)) {
  console.error('Input not found:', inputPath);
  console.error('Run review-all-attributes.js first.');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JEGS Attribute Review — ${data.length} items</title>
<style>
  :root {
    --bg: #fafafa; --surface: #fff; --surface2: #f3f4f6;
    --text: #1f2937; --text-dim: #6b7280; --accent: #3b82f6;
    --green: #16a34a; --yellow: #ca8a04; --red: #dc2626;
    --blue: #2563eb; --border: #e5e7eb;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); font-size: 13px; }

  /* Stats bar */
  .stats-bar { position: sticky; top: 0; z-index: 100; background: var(--surface); border-bottom: 1px solid var(--border); padding: 8px 16px; display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
  .stat { display: flex; align-items: baseline; gap: 4px; }
  .stat-num { font-size: 16px; font-weight: 700; }
  .stat-label { font-size: 11px; color: var(--text-dim); }
  .stat-green .stat-num { color: var(--green); }
  .stat-red .stat-num { color: var(--red); }
  .stat-yellow .stat-num { color: var(--yellow); }
  .stat-blue .stat-num { color: var(--blue); }

  /* Controls */
  .controls { padding: 8px 16px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  input[type="text"], select { background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 5px 10px; border-radius: 4px; font-size: 12px; }
  input[type="text"] { width: 200px; }
  select { cursor: pointer; }
  .btn { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: background 0.15s; }
  .btn:hover { background: var(--surface2); }
  .btn-green:hover { background: #dcfce7; color: var(--green); }
  .btn-red:hover { background: #fee2e2; color: var(--red); }
  .btn-blue { background: var(--blue); color: #fff; border-color: var(--blue); }
  .btn-blue:hover { background: #1d4ed8; }
  .spacer { flex: 1; }

  /* Table */
  .table-wrap { padding: 0 16px 40px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: var(--surface); position: sticky; top: 68px; z-index: 10; text-align: left; padding: 6px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; color: var(--text-dim); cursor: pointer; user-select: none; border-bottom: 2px solid var(--border); font-weight: 600; }
  th:hover { color: var(--text); }
  td { padding: 4px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; line-height: 1.3; }
  tr.flagged { background: #fef2f2; }
  tr.no-attrs { background: var(--surface2); }
  tr.approved { background: #f0fdf4; }
  tr.rejected { opacity: 0.35; }
  tr:hover { background: #f9fafb; }

  /* Source badges */
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; text-transform: uppercase; }
  .badge-excel { background: #dbeafe; color: var(--blue); }
  .badge-extracted { background: #dcfce7; color: var(--green); }
  .badge-none { background: var(--surface2); color: var(--text-dim); }

  /* Attributes display */
  .attr-list { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .attr-chip { display: inline-flex; align-items: center; gap: 3px; background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; padding: 2px 8px; font-size: 13px; max-width: 320px; }
  .attr-chip.flagged-chip { border-color: var(--red); background: #fef2f2; }
  .attr-name { color: var(--text-dim); font-weight: 600; flex-shrink: 0; white-space: nowrap; }
  .attr-value { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .attr-value[contenteditable] { cursor: text; min-width: 24px; }
  .attr-value[contenteditable]:focus { outline: 1px solid var(--accent); border-radius: 2px; white-space: normal; overflow: visible; max-width: none; }
  .attr-del { cursor: pointer; color: var(--red); font-size: 13px; opacity: 0.25; margin-left: 2px; flex-shrink: 0; }
  .attr-del:hover { opacity: 1; }
  .attr-add { cursor: pointer; background: transparent; border: 1px dashed var(--border); color: var(--text-dim); border-radius: 4px; padding: 2px 10px; font-size: 12px; }
  .attr-add:hover { border-color: var(--green); color: var(--green); }

  /* Flag tooltip */
  .flag-indicator { color: var(--red); font-size: 11px; margin-left: 2px; cursor: help; flex-shrink: 0; }

  /* Checkbox */
  .approve-cb { width: 16px; height: 16px; cursor: pointer; accent-color: var(--green); }

  /* SKU column */
  .sku { font-family: monospace; font-size: 13px; white-space: nowrap; }
  .part-type { font-size: 12px; color: var(--text-dim); }

  /* Description column */
  .desc-cell { font-size: 12px; color: var(--text-dim); max-width: 300px; }
  .desc-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 2px; }
  .desc-features { font-size: 11px; color: var(--text-dim); }
  .desc-features span { display: inline-block; background: #f0f9ff; border-radius: 3px; padding: 0 5px; margin: 1px 2px; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }

  /* Export overlay */
  .overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000; justify-content: center; align-items: center; }
  .overlay.show { display: flex; }
  .overlay-box { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; max-width: 500px; width: 90%; box-shadow: 0 8px 30px rgba(0,0,0,0.12); }
  .overlay-box h3 { margin-bottom: 8px; font-size: 15px; }
  .overlay-box textarea { width: 100%; height: 200px; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 8px; font-family: monospace; font-size: 12px; border-radius: 4px; margin-bottom: 10px; }
  .overlay-actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
</head>
<body>

<div class="stats-bar" id="statsBar"></div>

<div class="controls">
  <input type="text" id="search" placeholder="Search SKU or title..." />
  <select id="filterSource">
    <option value="all">All sources</option>
    <option value="excel">Excel only</option>
    <option value="extracted">Extracted only</option>
    <option value="none">No attrs</option>
  </select>
  <select id="filterStatus">
    <option value="all">All statuses</option>
    <option value="flagged">Flagged only</option>
    <option value="clean">Clean only</option>
    <option value="approved">Approved</option>
    <option value="rejected">Rejected</option>
  </select>
  <span class="spacer"></span>
  <button class="btn btn-green" onclick="bulkApproveClean()">Approve all clean</button>
  <button class="btn btn-red" onclick="bulkRejectFlagged()">Reject all flagged</button>
  <button class="btn" onclick="stripEbayMetadata()">Strip eBay metadata</button>
  <button class="btn btn-blue" onclick="showExport()">Export approved.json</button>
  <button class="btn" onclick="showImport()">Import</button>
  <button class="btn btn-red" onclick="resetAll()">Reset all</button>
</div>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th style="width:32px">✓</th>
        <th onclick="sortBy('sku')" style="width:100px">SKU</th>
        <th style="width:60px">Brand</th>
        <th onclick="sortBy('partType')" style="width:140px">Part Type</th>
        <th onclick="sortBy('source')" style="width:60px">Src</th>
        <th style="width:260px">Description & Features</th>
        <th>Attributes</th>
        <th onclick="sortBy('flagCount')" style="width:40px">!</th>
        <th style="width:32px"></th>
      </tr>
    </thead>
    <tbody id="tableBody"></tbody>
  </table>
</div>

<div class="overlay" id="exportOverlay">
  <div class="overlay-box">
    <h3>Export approved.json</h3>
    <p style="color:var(--text-dim);margin-bottom:12px;font-size:13px">Copy the JSON below or download it. Place the file at <code>image-selector/datasets/attr-gaps-final/approved.json</code></p>
    <textarea id="exportText" readonly></textarea>
    <div class="overlay-actions">
      <button class="btn" onclick="hideExport()">Close</button>
      <button class="btn" onclick="copyExport()">Copy</button>
      <button class="btn btn-blue" onclick="downloadExport()">Download</button>
    </div>
  </div>
</div>

<div class="overlay" id="importOverlay">
  <div class="overlay-box">
    <h3>Import previous review state</h3>
    <p style="color:var(--text-dim);margin-bottom:12px;font-size:13px">Paste a previously exported approved.json to restore approvals and edits.</p>
    <textarea id="importText" placeholder="Paste approved.json here..."></textarea>
    <div class="overlay-actions">
      <button class="btn" onclick="hideImport()">Cancel</button>
      <button class="btn btn-green" onclick="doImport()">Apply</button>
    </div>
  </div>
</div>

<script>
const ATTR_DATA = ${JSON.stringify(data)};

const EBAY_META_NAMES = new Set([
  'eBay Product ID (ePID)', 'Manufacturer Part Number',
  'California Prop 65 Warning', 'Brand', 'UPC', 'MPN',
  'Sub Type', 'Part Type', 'Notes', 'Part Category',
  'Part Fitment', 'Product Line', 'Package Depth',
  'Package Height', 'Package Width', 'Shipping Weight',
]);

// State: track approval and attribute edits per SKU
const STORAGE_KEY = 'attr-review-state';

// Build default state from data
function buildDefaultState() {
  const s = {};
  for (const item of ATTR_DATA) {
    s[item.sku] = {
      approved: item.flagCount === 0 && item.attrs.length > 0,
      rejected: false,
      attrs: JSON.parse(JSON.stringify(item.attrs)),
    };
  }
  return s;
}

// Load saved state from localStorage, falling back to defaults
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      const defaults = buildDefaultState();
      // Merge: use saved data for known SKUs, default for new ones
      for (const sku of Object.keys(defaults)) {
        if (!saved[sku]) saved[sku] = defaults[sku];
      }
      return saved;
    }
  } catch (e) { /* ignore */ }
  return buildDefaultState();
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function resetRow(sku) {
  const item = ATTR_DATA.find(i => i.sku === sku);
  if (!item) return;
  state[sku] = {
    approved: item.flagCount === 0 && item.attrs.length > 0,
    rejected: false,
    attrs: JSON.parse(JSON.stringify(item.attrs)),
  };
  saveState();
  render();
}

function resetAll() {
  if (!confirm('Reset all rows to original state? This clears all edits and approvals.')) return;
  const defaults = buildDefaultState();
  for (const sku of Object.keys(defaults)) state[sku] = defaults[sku];
  saveState();
  render();
}

const state = loadState();

let currentSort = { key: 'flagCount', dir: -1 };

function sortBy(key) {
  if (currentSort.key === key) currentSort.dir *= -1;
  else { currentSort.key = key; currentSort.dir = key === 'flagCount' ? -1 : 1; }
  render();
}

function getFiltered() {
  const search = document.getElementById('search').value.toLowerCase();
  const srcFilter = document.getElementById('filterSource').value;
  const statusFilter = document.getElementById('filterStatus').value;

  return ATTR_DATA.filter(item => {
    if (search && !item.sku.toLowerCase().includes(search) && !(item.title || '').toLowerCase().includes(search)) return false;
    if (srcFilter !== 'all' && item.source !== srcFilter) return false;
    if (statusFilter === 'flagged' && item.flagCount === 0) return false;
    if (statusFilter === 'clean' && (item.flagCount > 0 || item.attrs.length === 0)) return false;
    if (statusFilter === 'approved' && !state[item.sku].approved) return false;
    if (statusFilter === 'rejected' && !state[item.sku].rejected) return false;
    return true;
  }).sort((a, b) => {
    const av = a[currentSort.key] ?? '', bv = b[currentSort.key] ?? '';
    if (typeof av === 'number') return (av - bv) * currentSort.dir;
    return String(av).localeCompare(String(bv)) * currentSort.dir;
  });
}

function updateStats() {
  const total = ATTR_DATA.length;
  const flagged = ATTR_DATA.filter(i => i.flagCount > 0).length;
  const approved = ATTR_DATA.filter(i => state[i.sku].approved).length;
  const rejected = ATTR_DATA.filter(i => state[i.sku].rejected).length;
  const noAttrs = ATTR_DATA.filter(i => i.attrs.length === 0).length;
  const pending = total - approved - rejected;

  document.getElementById('statsBar').innerHTML =
    '<div class="stat stat-blue"><span class="stat-num">' + total + '</span><span class="stat-label">Total</span></div>' +
    '<div class="stat stat-red"><span class="stat-num">' + flagged + '</span><span class="stat-label">Flagged</span></div>' +
    '<div class="stat stat-green"><span class="stat-num">' + approved + '</span><span class="stat-label">Approved</span></div>' +
    '<div class="stat stat-red"><span class="stat-num">' + rejected + '</span><span class="stat-label">Rejected</span></div>' +
    '<div class="stat stat-yellow"><span class="stat-num">' + pending + '</span><span class="stat-label">Pending</span></div>' +
    '<div class="stat"><span class="stat-num">' + noAttrs + '</span><span class="stat-label">No attrs</span></div>';
}

function renderAttrChips(sku, item) {
  const s = state[sku];
  const flaggedNames = new Set(item.flags.map(f => f.name + '|||' + f.value));

  let html = '<div class="attr-list">';
  for (let i = 0; i < s.attrs.length; i++) {
    const [name, value] = s.attrs[i];
    const isFlagged = flaggedNames.has(name + '|||' + value);
    const flagInfo = isFlagged ? item.flags.find(f => f.name === name && f.value === value) : null;

    html += '<span class="attr-chip' + (isFlagged ? ' flagged-chip' : '') + '">';
    html += '<span class="attr-name">' + esc(name) + ':</span> ';
    html += '<span class="attr-value" contenteditable="true" data-sku="' + sku + '" data-idx="' + i + '" onblur="editAttr(this)">' + esc(value) + '</span>';
    if (flagInfo) html += '<span class="flag-indicator" title="' + esc(flagInfo.reason) + '">⚠</span>';
    html += '<span class="attr-del" onclick="delAttr(\\''+sku+'\\','+i+')" title="Remove">×</span>';
    html += '</span>';
  }
  html += '<span class="attr-add" onclick="addAttr(\\''+sku+'\\')">+ add</span>';
  html += '</div>';
  return html;
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function render() {
  const filtered = getFiltered();
  const tbody = document.getElementById('tableBody');
  const rows = [];

  for (const item of filtered) {
    const s = state[item.sku];
    let cls = '';
    if (s.rejected) cls = 'rejected';
    else if (s.approved) cls = 'approved';
    else if (item.flagCount > 0) cls = 'flagged';
    else if (item.attrs.length === 0) cls = 'no-attrs';

    const badgeClass = item.source === 'excel' ? 'badge-excel' : item.source === 'extracted' ? 'badge-extracted' : 'badge-none';

    // Description + features cell
    let descHtml = '<div class="desc-cell">';
    descHtml += '<div class="desc-text">' + esc(item.description || '') + '</div>';
    if (item.features && item.features.length > 0) {
      descHtml += '<div class="desc-features">';
      const maxFeats = Math.min(item.features.length, 3);
      for (let fi = 0; fi < maxFeats; fi++) {
        descHtml += '<span title="' + esc(item.features[fi]) + '">' + esc(item.features[fi]) + '</span>';
      }
      if (item.features.length > 3) descHtml += '<span>+' + (item.features.length - 3) + ' more</span>';
      descHtml += '</div>';
    }
    descHtml += '</div>';

    rows.push(
      '<tr class="' + cls + '" id="row-' + item.sku + '">' +
      '<td><input type="checkbox" class="approve-cb" data-sku="' + item.sku + '" ' +
        (s.approved ? 'checked' : '') + ' onchange="toggleApprove(this)" ' +
        'title="' + (s.approved ? 'Approved' : s.rejected ? 'Rejected' : 'Pending') + '"></td>' +
      '<td><span class="sku">' + esc(item.sku) + '</span></td>' +
      '<td style="font-size:12px">' + esc(item.brand || 'JEGS') + '</td>' +
      '<td><span class="part-type">' + esc(item.partType) + '</span></td>' +
      '<td><span class="badge ' + badgeClass + '">' + item.source + '</span></td>' +
      '<td>' + descHtml + '</td>' +
      '<td>' + renderAttrChips(item.sku, item) + '</td>' +
      '<td style="text-align:center">' + (item.flagCount > 0 ? '<span style="color:var(--red);font-weight:700">' + item.flagCount + '</span>' : '—') + '</td>' +
      '<td><span class="attr-del" onclick="resetRow(\\''+item.sku+'\\')\" title="Reset row" style="font-size:14px;opacity:0.4;cursor:pointer">↺</span></td>' +
      '</tr>'
    );
  }

  tbody.innerHTML = rows.join('');
  updateStats();
}

function toggleApprove(cb) {
  const sku = cb.dataset.sku;
  if (cb.checked) {
    state[sku].approved = true;
    state[sku].rejected = false;
  } else {
    state[sku].approved = false;
    state[sku].rejected = true;
  }
  saveState();
  render();
}

function editAttr(el) {
  const sku = el.dataset.sku;
  const idx = parseInt(el.dataset.idx);
  state[sku].attrs[idx][1] = el.textContent.trim();
  saveState();
}

function delAttr(sku, idx) {
  state[sku].attrs.splice(idx, 1);
  saveState();
  render();
}

function addAttr(sku) {
  const name = prompt('Attribute name:');
  if (!name) return;
  const value = prompt('Attribute value:');
  if (value === null) return;
  state[sku].attrs.push([name.trim(), value.trim()]);
  saveState();
  render();
}

function bulkApproveClean() {
  for (const item of ATTR_DATA) {
    if (item.flagCount === 0 && item.attrs.length > 0) {
      state[item.sku].approved = true;
      state[item.sku].rejected = false;
    }
  }
  saveState();
  render();
}

function bulkRejectFlagged() {
  for (const item of ATTR_DATA) {
    if (item.flagCount > 0) {
      state[item.sku].approved = false;
      state[item.sku].rejected = true;
    }
  }
  saveState();
  render();
}

function stripEbayMetadata() {
  let stripped = 0;
  for (const item of ATTR_DATA) {
    const s = state[item.sku];
    const before = s.attrs.length;
    s.attrs = s.attrs.filter(([name]) => !EBAY_META_NAMES.has(name));
    stripped += before - s.attrs.length;
  }
  saveState();
  alert('Stripped ' + stripped + ' eBay metadata attributes');
  render();
}

function buildApprovedJson() {
  const approved = {};
  for (const item of ATTR_DATA) {
    const s = state[item.sku];
    if (s.approved && s.attrs.length > 0) {
      approved[item.sku] = s.attrs;
    }
  }
  return approved;
}

function showExport() {
  const json = JSON.stringify(buildApprovedJson(), null, 2);
  document.getElementById('exportText').value = json;
  document.getElementById('exportOverlay').classList.add('show');
}

function hideExport() { document.getElementById('exportOverlay').classList.remove('show'); }

function copyExport() {
  const ta = document.getElementById('exportText');
  ta.select();
  navigator.clipboard.writeText(ta.value);
}

function downloadExport() {
  const blob = new Blob([document.getElementById('exportText').value], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'approved.json';
  a.click();
}

function showImport() { document.getElementById('importOverlay').classList.add('show'); }
function hideImport() { document.getElementById('importOverlay').classList.remove('show'); }

function doImport() {
  try {
    const data = JSON.parse(document.getElementById('importText').value);
    let count = 0;
    for (const [sku, attrs] of Object.entries(data)) {
      if (state[sku]) {
        state[sku].attrs = attrs;
        state[sku].approved = true;
        state[sku].rejected = false;
        count++;
      }
    }
    hideImport();
    saveState();
    render();
    alert('Imported ' + count + ' items');
  } catch (e) {
    alert('Invalid JSON: ' + e.message);
  }
}

// Event listeners
document.getElementById('search').addEventListener('input', render);
document.getElementById('filterSource').addEventListener('change', render);
document.getElementById('filterStatus').addEventListener('change', render);

// Initial render
render();
</script>
</body>
</html>`;

fs.writeFileSync(outputPath, html);
console.log(`\n=== Attribute Review HTML Generated ===`);
console.log(`Items: ${data.length}`);
console.log(`Flagged: ${data.filter(d => d.flagCount > 0).length}`);
console.log(`Output: ${outputPath}`);
console.log(`\nOpen in browser: open ${outputPath}`);
