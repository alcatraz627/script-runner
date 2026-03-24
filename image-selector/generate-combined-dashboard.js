#!/usr/bin/env node
/**
 * generate-combined-dashboard.js
 *
 * Generates a self-contained HTML dashboard that combines:
 * - Image selection (thumbnail grid, click to select main image)
 * - Attribute review (vertical list, edit/delete, fitment separation)
 * - Feedback notes per item
 * - Server-backed persistence via review-server.js
 *
 * Usage:
 *   node generate-combined-dashboard.js [--attrs <path>] [--images <path>] [--output <path>] [--pre-approved <path>]
 */

const fs   = require('fs');
const path = require('path');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const attrsPath       = getArg('--attrs')        || path.join(__dirname, 'datasets/attr-gaps-final/all-attributes.json');
const imagesPath      = getArg('--images')       || path.join(__dirname, 'datasets/jegs-final-images/data.json');
const preApprovedPath = getArg('--pre-approved')  || null;
const outputPath      = getArg('--output')        || path.join(__dirname, 'combined-review.html');

if (!fs.existsSync(attrsPath))  { console.error('Attrs not found:', attrsPath); process.exit(1); }
if (!fs.existsSync(imagesPath)) { console.error('Images not found:', imagesPath); process.exit(1); }

const attrData  = JSON.parse(fs.readFileSync(attrsPath, 'utf8'));
const imageData = JSON.parse(fs.readFileSync(imagesPath, 'utf8'));

let preApproved = {};
if (preApprovedPath && fs.existsSync(preApprovedPath)) {
  preApproved = JSON.parse(fs.readFileSync(preApprovedPath, 'utf8'));
  console.log(`Loaded ${Object.keys(preApproved).length} pre-approved SKUs from ${preApprovedPath}`);
}

// Static blacklist base paths (extension-agnostic matching)
const BLOCKED_BASES = new Set([
  'https://i.ebayimg.com/00/s/MTIzM1gxNjAw/z/l94AAeSwhLdo2FOA/$_1',
  'https://i.ebayimg.com/images/g/1VEAAOSwBahVcLz8/s-l1600',
  'https://i.ebayimg.com/images/g/DOcAAOSw8NplLtwK/s-l1600',
  'https://i.ebayimg.com/images/g/DnkAAeSwAKtpgwkt/s-l1600',
  'https://i.ebayimg.com/images/g/Eq8AAeSwWthplcJ8/s-l1600',
  'https://i.ebayimg.com/images/g/gm8AAeSwQgBplcJ8/s-l1600',
  'https://i.ebayimg.com/images/g/rBQAAeSwlJVplcJ8/s-l1600',
  'pics.ebaystatic.com/aw/pics/nextGenVit/imgNoImg',
]);
function stripExt(url) { return url.replace(/\.[^.?]+(\?.*)?$/, ''); }
function isStaticBlocked(url) { return BLOCKED_BASES.has(stripExt(url)); }

// Auto-detect stock/storefront images: URLs appearing in 4+ different SKUs
const imageBySku = new Map();
for (const img of imageData) imageBySku.set(img.sku, img);

const urlSkuCount = {};
for (const img of imageData) {
  for (const u of img._imgs) {
    if (!urlSkuCount[u]) urlSkuCount[u] = 0;
    urlSkuCount[u]++;
  }
}
const stockImages = new Set(Object.entries(urlSkuCount).filter(([, c]) => c >= 4).map(([u]) => u));
console.log(`Stock images detected (in 4+ SKUs): ${stockImages.size}`);

// Merge attr + image data, filtering blocked + stock images
const merged = attrData.map(a => {
  const img = imageBySku.get(a.sku);
  const rawImgs = img ? img._imgs : [];
  const filteredImgs = rawImgs.filter(u => !isStaticBlocked(u) && !stockImages.has(u) && !u.includes('/thumbs/'));
  return {
    ...a,
    images: filteredImgs,
    ebayUrl: img ? img.url : '',
  };
});

let blockedCount = 0;
for (const m of merged) {
  const img = imageBySku.get(m.sku);
  if (img) blockedCount += img._imgs.length - m.images.length;
}

// Fitment attribute names — these get separated into their own column
const FITMENT_NAMES = new Set([
  'Fits', 'Application', 'Compatibility', 'Fitment', 'Vehicle Fitment',
  'Models', 'Model', 'Fits Year', 'Application Year Range', 'Fits Model',
  'Engine Compatibility', 'Position', 'Carburetor Fitment',
  'Fuel Compatibility', 'Fits Engine', 'Fits Coil Diameter', 'Fits Roll Bar',
  'Fits Tubing', 'Torch Compatibility', 'Transmission Fitment', 'Engine Fitment',
  'Engine Displacement', 'Muffler Compatibility', 'Press Compatibility',
  'Placement on Vehicle',
  'Engine Type', 'Transmission Type', 'Transmission', 'Axle Type',
  'Side', 'Brake Type', 'Lug Pattern',
]);

// ─── Browser script ───
const browserScript = `
const DATA = __DATA_PLACEHOLDER__;
const PRE_APPROVED = __PRE_APPROVED_PLACEHOLDER__;
const FITMENT_NAMES = new Set(__FITMENT_NAMES__);
const API_BASE = window.location.origin;
const PAGE_SIZE = 20;
let currentPage = 1;

const EBAY_META = new Set([
  "eBay Product ID (ePID)", "Manufacturer Part Number",
  "California Prop 65 Warning", "Brand", "UPC", "MPN",
  "Sub Type", "Part Type", "Notes", "Part Category",
  "Part Fitment", "Product Line", "Package Depth",
  "Package Height", "Package Width", "Shipping Weight",
  "Country of Origin", "Item Width", "Item Length", "Item Diameter",
  "Type", "Made in USA", "Dimensions",
]);

const dataMap = {};
for (const item of DATA) dataMap[item.sku] = item;

function splitAttrs(attrs, fitOverrides) {
  var overrides = fitOverrides || {};
  const spec = [], fit = [];
  for (const a of attrs) {
    // Check per-SKU override first, then default FITMENT_NAMES
    if (overrides[a[0]] === "fit" || (overrides[a[0]] === undefined && FITMENT_NAMES.has(a[0]))) fit.push(a);
    else spec.push(a);
  }
  return { spec, fit };
}

function buildDefault() {
  const s = {};
  for (const item of DATA) {
    const pre = PRE_APPROVED[item.sku];
    const attrs = pre ? JSON.parse(JSON.stringify(pre)) : JSON.parse(JSON.stringify(item.attrs));
    s[item.sku] = {
      approved: pre ? true : (item.flagCount === 0 && item.attrs.length > 0),
      rejected: false,
      attrs: attrs,
      mainImage: item.images.length > 0 ? item.images[0] : null,
      feedback: "",
      fitOverrides: {},
    };
  }
  return s;
}

let state = null;
let saveTimeout = null;

async function loadState() {
  try {
    const res = await fetch(API_BASE + "/api/state");
    const saved = await res.json();
    if (saved && Object.keys(saved).length > 0) {
      const def = buildDefault();
      for (const sku of Object.keys(def)) {
        if (!saved[sku]) saved[sku] = def[sku];
        else {
          if (saved[sku].feedback === undefined) saved[sku].feedback = "";
          if (saved[sku].mainImage === undefined) saved[sku].mainImage = def[sku].mainImage;
          if (saved[sku].fitOverrides === undefined) saved[sku].fitOverrides = {};
        }
      }
      return saved;
    }
  } catch(e) { console.warn("No server state, using defaults", e); }
  return buildDefault();
}

function save() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(function() {
    fetch(API_BASE + "/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(function(e) { console.error("Save failed:", e); });
  }, 500);
}

function esc(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function updateStats() {
  const total = DATA.length;
  const approved = DATA.filter(function(i) { return state[i.sku].approved; }).length;
  const rejected = DATA.filter(function(i) { return state[i.sku].rejected; }).length;
  const withImg = DATA.filter(function(i) { return state[i.sku].mainImage; }).length;
  const withAttrs = DATA.filter(function(i) { return state[i.sku].attrs.length > 0; }).length;
  const withFeedback = DATA.filter(function(i) { return state[i.sku].feedback; }).length;
  document.getElementById("stats").innerHTML =
    '<span class="stat stat-b"><b>'+total+'</b> total</span>' +
    '<span class="stat stat-g"><b>'+approved+'</b> approved</span>' +
    '<span class="stat stat-r"><b>'+rejected+'</b> rejected</span>' +
    '<span class="stat stat-y"><b>'+withImg+'</b> images</span>' +
    '<span class="stat"><b>'+withAttrs+'</b> attrs</span>' +
    '<span class="stat stat-f"><b>'+withFeedback+'</b> feedback</span>';
}

function getFiltered() {
  var q = document.getElementById("search").value.toLowerCase();
  var src = document.getElementById("filterSource").value;
  var status = document.getElementById("filterStatus").value;
  return DATA.filter(function(item) {
    if (q && !item.sku.toLowerCase().includes(q) && !(item.title||"").toLowerCase().includes(q) && !(item.partType||"").toLowerCase().includes(q)) return false;
    if (src !== "all" && item.source !== src) return false;
    var s = state[item.sku];
    if (status === "approved" && !s.approved) return false;
    if (status === "pending" && s.approved) return false;
    if (status === "has-image" && !s.mainImage) return false;
    if (status === "no-image" && !s.mainImage) return false;
    if (status === "has-feedback" && !s.feedback) return false;
    return true;
  });
}

function renderPagination(totalItems) {
  var totalPages = Math.ceil(totalItems / PAGE_SIZE);
  if (currentPage > totalPages) currentPage = totalPages || 1;
  var pgEl = document.getElementById("pagination");
  if (totalPages <= 1) { pgEl.innerHTML = ""; return; }
  var html = '<span class="pg-info">' + totalItems + ' items, page ' + currentPage + '/' + totalPages + '</span>';
  html += '<button class="pg-btn" data-action="pg-first" ' + (currentPage===1?"disabled":"") + '>\\u00ab</button>';
  html += '<button class="pg-btn" data-action="pg-prev" ' + (currentPage===1?"disabled":"") + '>\\u2039</button>';
  var start = Math.max(1, currentPage - 3);
  var end = Math.min(totalPages, start + 6);
  for (var p = start; p <= end; p++) {
    html += '<button class="pg-btn' + (p===currentPage?' active':'') + '" data-action="pg-go" data-page="'+p+'">' + p + '</button>';
  }
  html += '<button class="pg-btn" data-action="pg-next" ' + (currentPage===totalPages?"disabled":"") + '>\\u203a</button>';
  html += '<button class="pg-btn" data-action="pg-last" data-page="'+totalPages+'" ' + (currentPage===totalPages?"disabled":"") + '>\\u00bb</button>';
  pgEl.innerHTML = html;
}

function render() {
  var filtered = getFiltered();
  renderPagination(filtered.length);
  var startIdx = (currentPage - 1) * PAGE_SIZE;
  var pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);
  var container = document.getElementById("itemList");
  container.innerHTML = "";

  for (var fi = 0; fi < pageItems.length; fi++) {
    var item = pageItems[fi];
    var s = state[item.sku];
    var el = document.createElement("div");
    el.className = "item" + (s.approved ? " approved" : "") + (s.rejected ? " rejected" : "");
    el.dataset.sku = item.sku;

    var imgs = item.images || [];

    // Thumbnail grid (4-wide) wrapped in a column container
    var imgHtml = '<div class="img-col">';
    imgHtml += '<div class="img-grid">';
    for (var ii = 0; ii < imgs.length; ii++) {
      var isSelected = (s.mainImage === imgs[ii]);
      imgHtml += '<div class="thumb' + (isSelected ? ' selected' : '') + '" data-action="select-img" data-sku="' + item.sku + '" data-url="' + esc(imgs[ii]) + '">' +
        '<img src="' + esc(imgs[ii]) + '" loading="lazy" />' +
        '<button class="preview-btn" data-action="preview-img" data-sku="' + item.sku + '" data-url="' + esc(imgs[ii]) + '" title="Preview full size">\\ud83d\\udc41</button>' +
        '</div>';
    }
    if (imgs.length === 0) imgHtml += '<div class="no-img">No images</div>';
    imgHtml += '</div>';

    // Info column
    var featsHtml = "";
    if (item.features && item.features.length > 0) {
      featsHtml = '<div class="info-feats">';
      for (var fi2 = 0; fi2 < Math.min(item.features.length, 4); fi2++) {
        featsHtml += '<div class="feat-tag" title="' + esc(item.features[fi2]) + '">\\u2022 ' + esc(item.features[fi2]) + '</div>';
      }
      if (item.features.length > 4) featsHtml += '<div class="feat-tag dim">+' + (item.features.length - 4) + ' more</div>';
      featsHtml += '</div>';
    }

    var infoHtml = '<div class="info-col">' +
      '<div class="info-sku">' + esc(item.sku) + '</div>' +
      '<div class="info-meta"><span class="info-brand">JEGS</span> \\u2022 <span class="info-type">' + esc(item.partType) + '</span></div>' +
      '<div class="info-title">' + esc(item.title) + '</div>' +
      '<div class="info-desc">' + esc(item.description) + '</div>' +
      featsHtml +
      '</div>';

    // Split attrs into spec + fitment (using per-SKU overrides)
    var split = splitAttrs(s.attrs, s.fitOverrides);

    // Spec attrs (vertical list)
    var attrHtml = '<div class="attrs-col"><div class="col-label">Attributes</div>';
    if (split.spec.length > 0) {
      attrHtml += '<div class="attr-vlist">';
      for (var ai = 0; ai < split.spec.length; ai++) {
        attrHtml += '<div class="attr-row">' +
          '<span class="attr-name">' + esc(split.spec[ai][0]) + '</span>' +
          '<span class="attr-val" contenteditable="true" data-action="edit-attr" data-sku="' + item.sku + '" data-idx="' + ai + '" data-col="spec">' + esc(split.spec[ai][1]) + '</span>' +
          '<span class="attr-actions">' +
          '<span class="attr-move" data-action="move-to-fit" data-sku="' + item.sku + '" data-attr-name="' + esc(split.spec[ai][0]) + '" title="Move to Fitment">\\u2192 fit</span>' +
          '<span class="attr-x" data-action="del-attr" data-sku="' + item.sku + '" data-attr-name="' + esc(split.spec[ai][0]) + '">\\u00d7</span>' +
          '</span></div>';
      }
      attrHtml += '</div>';
    } else {
      attrHtml += '<div class="no-attrs">No attributes</div>';
    }
    attrHtml += '<span class="attr-add" data-action="add-attr" data-sku="' + item.sku + '">+ add attribute</span>';
    // Feedback textarea
    attrHtml += '<div class="feedback-wrap"><div class="col-label" style="margin-top:8px">Feedback</div>' +
      '<textarea class="feedback-input" data-action="edit-feedback" data-sku="' + item.sku + '" placeholder="Notes for review...">' + esc(s.feedback || "") + '</textarea></div>';
    attrHtml += '</div>';

    // Fitment column
    var fitHtml = '<div class="fit-col"><div class="col-label">Fitment</div>';
    if (split.fit.length > 0) {
      fitHtml += '<div class="attr-vlist">';
      for (var fi3 = 0; fi3 < split.fit.length; fi3++) {
        fitHtml += '<div class="attr-row">' +
          '<span class="attr-name">' + esc(split.fit[fi3][0]) + '</span>' +
          '<span class="attr-val" contenteditable="true" data-action="edit-attr" data-sku="' + item.sku + '" data-idx="' + fi3 + '" data-col="fit">' + esc(split.fit[fi3][1]) + '</span>' +
          '<span class="attr-actions">' +
          '<span class="attr-move" data-action="move-to-spec" data-sku="' + item.sku + '" data-attr-name="' + esc(split.fit[fi3][0]) + '" title="Move to Attributes">\\u2190 attr</span>' +
          '<span class="attr-x" data-action="del-attr" data-sku="' + item.sku + '" data-attr-name="' + esc(split.fit[fi3][0]) + '">\\u00d7</span>' +
          '</span></div>';
      }
      fitHtml += '</div>';
    } else {
      fitHtml += '<div class="no-attrs">No fitment data</div>';
    }
    fitHtml += '</div>';

    // Add approve toggle below images, then close img-col wrapper
    imgHtml += '<div class="approve-toggle' + (s.approved ? ' on' : '') + '" data-action="toggle-approve" data-sku="' + item.sku + '">' +
      (s.approved ? '\\u2713 Approved' : 'Approve') + '</div>';
    imgHtml += '</div>'; // close img-col

    el.innerHTML =
      imgHtml + infoHtml + attrHtml + fitHtml +
      '<div class="reset-btn" data-action="reset-row" data-sku="' + item.sku + '" title="Reset this row">\\u21ba</div>';

    container.appendChild(el);
  }
  updateStats();
}

// ─── Event delegation ───
document.addEventListener("click", function(e) {
  var t = e.target.closest("[data-action]");
  if (!t) return;
  var action = t.dataset.action;
  var sku = t.dataset.sku;

  switch (action) {
    case "toggle-approve": {
      state[sku].approved = !state[sku].approved;
      state[sku].rejected = !state[sku].approved;
      save(); render();
      break;
    }
    case "select-img": {
      var url = t.dataset.url;
      if (!url && t.closest("[data-url]")) url = t.closest("[data-url]").dataset.url;
      if (!url) return;
      state[sku].mainImage = (state[sku].mainImage === url) ? null : url;
      save(); render();
      break;
    }
    case "preview-img": {
      var pUrl = t.dataset.url;
      if (!pUrl) return;
      e.stopPropagation();
      document.getElementById("lbImg").src = pUrl;
      document.getElementById("lightbox").classList.add("show");
      break;
    }
    case "del-attr": {
      var attrName = t.dataset.attrName;
      state[sku].attrs = state[sku].attrs.filter(function(a) { return a[0] !== attrName; });
      delete state[sku].fitOverrides[attrName];
      save(); render();
      break;
    }
    case "move-to-fit": {
      state[sku].fitOverrides[t.dataset.attrName] = "fit";
      save(); render();
      break;
    }
    case "move-to-spec": {
      state[sku].fitOverrides[t.dataset.attrName] = "spec";
      save(); render();
      break;
    }
    case "add-attr": {
      var name = prompt("Attribute name:");
      if (!name) return;
      var value = prompt("Value:");
      if (value === null) return;
      state[sku].attrs.push([name.trim(), value.trim()]);
      save(); render();
      break;
    }
    case "reset-row": {
      var item = dataMap[sku];
      if (!item) return;
      var pre = PRE_APPROVED[sku];
      state[sku] = {
        approved: pre ? true : (item.flagCount === 0 && item.attrs.length > 0),
        rejected: false,
        attrs: pre ? JSON.parse(JSON.stringify(pre)) : JSON.parse(JSON.stringify(item.attrs)),
        mainImage: item.images.length > 0 ? item.images[0] : null,
        feedback: "",
        fitOverrides: {},
      };
      save(); render();
      break;
    }
    case "pg-first": { currentPage = 1; render(); window.scrollTo(0,0); break; }
    case "pg-prev":  { currentPage = Math.max(1, currentPage - 1); render(); window.scrollTo(0,0); break; }
    case "pg-next":  { currentPage++; render(); window.scrollTo(0,0); break; }
    case "pg-last":
    case "pg-go":    { currentPage = parseInt(t.dataset.page); render(); window.scrollTo(0,0); break; }
  }
});

// (checkbox change handler removed — approve toggle is now a click action)

// Attr value edit on blur
document.addEventListener("focusout", function(e) {
  var ds = e.target.dataset;
  if (!ds || !ds.action) return;
  if (ds.action === "edit-attr") {
    var sku = ds.sku;
    var col = ds.col;
    var idx = parseInt(ds.idx);
    // Rebuild from split
    var split = splitAttrs(state[sku].attrs, state[sku].fitOverrides);
    var list = col === "fit" ? split.fit : split.spec;
    if (list[idx]) list[idx][1] = e.target.textContent.trim();
    state[sku].attrs = split.spec.concat(split.fit);
    save();
  }
  if (ds.action === "edit-feedback") {
    state[ds.sku].feedback = e.target.value.trim();
    save();
  }
});

// Also save feedback on input (debounced via save())
document.addEventListener("input", function(e) {
  if (e.target.dataset && e.target.dataset.action === "edit-feedback") {
    state[e.target.dataset.sku].feedback = e.target.value;
    save();
  }
});

function selectAllVisible() {
  var filtered = getFiltered();
  for (var i = 0; i < filtered.length; i++) {
    state[filtered[i].sku].approved = true;
    state[filtered[i].sku].rejected = false;
  }
  save(); render();
}

function deselectAllVisible() {
  var filtered = getFiltered();
  for (var i = 0; i < filtered.length; i++) {
    state[filtered[i].sku].approved = false;
    state[filtered[i].sku].rejected = false;
  }
  save(); render();
}

function bulkApproveClean() {
  for (var i = 0; i < DATA.length; i++) {
    var item = DATA[i];
    if (item.flagCount === 0 && state[item.sku].attrs.length > 0) {
      state[item.sku].approved = true;
      state[item.sku].rejected = false;
    }
  }
  save(); render();
}

function stripMeta() {
  var n = 0;
  for (var i = 0; i < DATA.length; i++) {
    var s = state[DATA[i].sku];
    var before = s.attrs.length;
    s.attrs = s.attrs.filter(function(a) { return !EBAY_META.has(a[0]); });
    n += before - s.attrs.length;
  }
  save(); render();
  alert("Stripped " + n + " metadata attributes");
}

function resetAll() {
  if (!confirm("Reset everything?")) return;
  var def = buildDefault();
  for (var sku in def) state[sku] = def[sku];
  save(); render();
}

function doExport() {
  var imgSel = {}, attrSel = {};
  for (var i = 0; i < DATA.length; i++) {
    var s = state[DATA[i].sku];
    if (s.mainImage) imgSel[DATA[i].sku] = s.mainImage;
    if (s.approved && s.attrs.length > 0) attrSel[DATA[i].sku] = s.attrs;
  }
  fetch(API_BASE + "/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selections: imgSel, approved: attrSel }),
  }).then(function(r) { return r.json(); })
    .then(function(d) { alert("Exported to " + d.dir + "\\nselections.json: " + Object.keys(imgSel).length + " images\\napproved.json: " + Object.keys(attrSel).length + " attrs"); })
    .catch(function(e) { alert("Export failed: " + e); });
}

document.getElementById("search").addEventListener("input", function() { currentPage = 1; render(); });
document.getElementById("filterSource").addEventListener("change", function() { currentPage = 1; render(); });
document.getElementById("filterStatus").addEventListener("change", function() { currentPage = 1; render(); });

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") {
    document.getElementById("lightbox").classList.remove("show");
  }
});

// Thumbnail clicks are handled via data-action="select-img" delegation above

// Init
(async function() {
  state = await loadState();
  render();
  document.getElementById("loading").style.display = "none";
})();
`;

const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JEGS Review Dashboard — ${merged.length} items</title>
<style>
  :root {
    --bg: #f8f9fa; --surface: #fff; --surface2: #f1f3f5;
    --text: #212529; --dim: #868e96; --accent: #228be6;
    --green: #2b8a3e; --red: #c92a2a; --yellow: #e67700;
    --border: #dee2e6; --pin-gold: #f59f00;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); font-size: 14px; }

  /* Header */
  .header { position: sticky; top: 0; z-index: 100; background: var(--surface); border-bottom: 1px solid var(--border); padding: 8px 16px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .header h1 { font-size: 16px; font-weight: 700; white-space: nowrap; }
  .stats { display: flex; gap: 14px; font-size: 12px; }
  .stat b { margin-right: 2px; }
  .stat-g b { color: var(--green); }
  .stat-r b { color: var(--red); }
  .stat-y b { color: var(--yellow); }
  .stat-b b { color: var(--accent); }
  .stat-f b { color: #9c36b5; }

  /* Controls */
  .controls { position: sticky; top: 42px; z-index: 99; padding: 8px 16px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  input[type="text"], select { background: var(--surface2); border: 1px solid var(--border); color: var(--text); padding: 5px 10px; border-radius: 4px; font-size: 12px; }
  input[type="text"] { width: 240px; }
  .btn { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .btn:hover { background: var(--surface2); }
  .btn-p { background: var(--accent); color: #fff; border-color: var(--accent); }
  .btn-p:hover { opacity: 0.9; }
  .spacer { flex: 1; }
  #loading { text-align: center; padding: 40px; color: var(--dim); font-size: 16px; }

  /* Pagination */
  .pagination { position: sticky; top: 82px; z-index: 98; background: var(--bg); display: flex; gap: 4px; align-items: center; justify-content: center; padding: 8px 16px; border-bottom: 1px solid var(--border); }
  .pg-btn { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 13px; min-width: 32px; }
  .pg-btn:hover:not(:disabled) { background: var(--surface2); }
  .pg-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .pg-btn:disabled { opacity: 0.3; cursor: default; }
  .pg-info { font-size: 12px; color: var(--dim); margin-right: 8px; }

  /* Item rows */
  .items { padding: 8px 16px; }
  .item { display: flex; gap: 14px; padding: 12px 8px; border-bottom: 1px solid var(--border); align-items: flex-start; }
  .item.approved { background: #ebfbee; }
  .item.rejected { opacity: 0.3; }
  .approve-toggle { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 12px; border-radius: 6px; cursor: pointer; font-size: 15px; font-weight: 700; border: 1px solid var(--border); background: var(--surface2); color: var(--dim); user-select: none; width: 100%; }
  .approve-toggle:hover { border-color: var(--accent); color: var(--accent); }
  .approve-toggle.on { background: var(--green); color: #fff; border-color: var(--green); }
  .approve-toggle.on:hover { background: #237032; }

  /* Thumbnail grid */
  .img-col { flex-shrink: 0; width: 360px; display: flex; flex-direction: column; gap: 6px; }
  .img-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
  .thumb { position: relative; aspect-ratio: 1; background: var(--surface2); border: 2px solid transparent; border-radius: 4px; overflow: hidden; cursor: pointer; }
  .thumb.selected { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(34,139,230,0.3); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .preview-btn { position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.5); border: none; color: #ccc; font-size: 16px; cursor: pointer; border-radius: 3px; padding: 2px 5px; line-height: 1; display: none; }
  .thumb:hover .preview-btn { display: block; }
  .preview-btn:hover { color: #fff; background: rgba(0,0,0,0.75); }
  .no-img { grid-column: 1/-1; color: var(--dim); font-size: 12px; text-align: center; padding: 20px 0; }

  /* Info column */
  .info-col { flex: 0 0 240px; min-width: 0; }
  .info-sku { font-family: monospace; font-size: 14px; font-weight: 700; }
  .info-meta { font-size: 12px; color: var(--dim); margin-top: 2px; }
  .info-title { font-size: 13px; margin-top: 4px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .info-desc { font-size: 12px; color: var(--dim); margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.35; }
  .info-feats { margin-top: 6px; }
  .feat-tag { font-size: 11px; color: #495057; line-height: 1.4; }
  .feat-tag.dim { color: var(--dim); }

  /* Column labels */
  .col-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--dim); font-weight: 700; margin-bottom: 4px; }

  /* Attrs column — vertical list */
  .attrs-col { flex: 1; min-width: 180px; }
  .fit-col { flex: 0 0 180px; min-width: 0; }
  .fit-col .attr-row { flex-direction: column; gap: 1px; }
  .fit-col .attr-row .attr-name { min-width: unset; }
  .fit-col .attr-row .attr-actions { position: absolute; top: 0; right: 0; display: flex; gap: 2px; }
  .fit-col .attr-row { position: relative; padding-right: 56px; border-bottom: 1px solid var(--border); padding-bottom: 4px; margin-bottom: 2px; }
  .attr-vlist { display: flex; flex-direction: column; gap: 3px; }
  .attr-row { display: flex; align-items: baseline; gap: 6px; font-size: 14px; line-height: 1.4; padding: 2px 0; }
  .attr-name { color: var(--dim); font-weight: 600; white-space: nowrap; min-width: 70px; font-size: 12px; }
  .attr-val { flex: 1; min-width: 0; }
  .attr-val[contenteditable]:focus { outline: 1px solid var(--accent); border-radius: 2px; padding: 1px 3px; }
  .attr-x { cursor: pointer; color: var(--red); opacity: 0.25; font-size: 20px; font-weight: bold; line-height: 1; padding: 4px 6px; border-radius: 3px; }
  .attr-x:hover { opacity: 1; background: #fff5f5; }
  .attr-actions { display: flex; gap: 2px; align-items: center; flex-shrink: 0; }
  .attr-move { cursor: pointer; color: var(--accent); opacity: 0.35; font-size: 12px; padding: 3px 5px; border-radius: 3px; white-space: nowrap; }
  .attr-move:hover { opacity: 1; background: #e7f5ff; }
  .attr-add { display: inline-block; margin-top: 4px; border: 1px dashed var(--border); background: none; padding: 3px 12px; border-radius: 4px; font-size: 12px; color: var(--dim); cursor: pointer; }
  .attr-add:hover { border-color: var(--green); color: var(--green); }
  .no-attrs { color: var(--dim); font-size: 12px; font-style: italic; padding: 4px 0; }

  /* Feedback */
  .feedback-input { width: 100%; min-height: 36px; background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; font-size: 12px; font-family: inherit; color: var(--text); resize: vertical; }
  .feedback-input:focus { outline: 1px solid var(--accent); border-color: var(--accent); }

  /* Reset btn */
  .reset-btn { cursor: pointer; color: var(--dim); opacity: 0.3; font-size: 18px; flex-shrink: 0; padding-top: 4px; }
  .reset-btn:hover { opacity: 1; color: var(--red); }

  /* Lightbox */
  .lightbox { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 2000; justify-content: center; align-items: center; cursor: zoom-out; }
  .lightbox.show { display: flex; }
  .lightbox img { max-width: 90vw; max-height: 90vh; object-fit: contain; }
</style>
</head>
<body>

<div class="header">
  <h1>JEGS Review Dashboard</h1>
  <div class="stats" id="stats"></div>
</div>

<div class="controls">
  <input type="text" id="search" placeholder="Search SKU, title, part type..." />
  <select id="filterSource">
    <option value="all">All sources</option>
    <option value="excel">Excel attrs</option>
    <option value="extracted">Extracted attrs</option>
    <option value="none">No attrs</option>
  </select>
  <select id="filterStatus">
    <option value="all">All</option>
    <option value="approved">Selected / Approved</option>
    <option value="pending">Unselected</option>
    <option value="has-image">Image selected</option>
    <option value="no-image">No image selected</option>
    <option value="has-feedback">Has feedback</option>
  </select>
  <span class="spacer"></span>
  <button class="btn" onclick="selectAllVisible()">Select all</button>
  <button class="btn" onclick="deselectAllVisible()">Deselect all</button>
  <button class="btn" onclick="bulkApproveClean()">Approve clean</button>
  <button class="btn" onclick="stripMeta()">Strip metadata</button>
  <button class="btn btn-p" onclick="doExport()">Export to files</button>
  <button class="btn" onclick="resetAll()" style="color:var(--red)">Reset all</button>
</div>

<div id="loading">Loading state...</div>
<div class="pagination" id="pagination"></div>
<div class="items" id="itemList"></div>
<div class="pagination" id="paginationBottom"></div>

<div class="lightbox" id="lightbox" onclick="this.classList.remove('show')">
  <img id="lbImg" />
</div>

<script>
__SCRIPT_PLACEHOLDER__
</script>
</body>
</html>`;

// Inject data
const finalScript = browserScript
  .replace('__DATA_PLACEHOLDER__', JSON.stringify(merged))
  .replace('__PRE_APPROVED_PLACEHOLDER__', JSON.stringify(preApproved))
  .replace('__FITMENT_NAMES__', JSON.stringify([...FITMENT_NAMES]));

const finalHtml = htmlTemplate.replace('__SCRIPT_PLACEHOLDER__', finalScript);

fs.writeFileSync(outputPath, finalHtml);

console.log('\n=== Combined Dashboard Generated ===');
console.log('Items: ' + merged.length);
console.log('With images: ' + merged.filter(m => m.images.length > 0).length);
console.log('Images blocked: ' + blockedCount);
console.log('With attrs: ' + merged.filter(m => m.attrs.length > 0).length);
console.log('Pre-approved: ' + Object.keys(preApproved).length);
console.log('Output: ' + outputPath);
console.log('\nStart: node review-server.js');
console.log('Open:  http://localhost:3459');
