#!/usr/bin/env node
/**
 * sweep-loadsheet.js
 * Cross-references the latest filled v3 loadsheet against source attribute data.
 * Reports: fill rates for ALL 94 columns, gaps with available source data, and
 * columns that could be auto-inferred.
 *
 * Usage: node sweep-loadsheet.js [--sample N]
 */
'use strict';

const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');

const SOURCE   = path.join(process.env.HOME, 'Downloads', 'export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx');
const FILLED   = path.join(__dirname, (() => {
  const files = fs.readdirSync(__dirname)
    .filter(f => /^walmart-loadsheet-filled-v\d+\.xlsx$/.test(f))
    .sort((a, b) => {
      const n = f => parseInt(f.match(/v(\d+)/)[1]);
      return n(b) - n(a);
    });
  return files[0];
})());

const args = process.argv.slice(2);
const SAMPLE = parseInt(args[args.indexOf('--sample') + 1] || '40');

// ─── Load column map from filled file ────────────────────────────────────────

async function loadColHeaders() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILLED);
  const ws = wb.getWorksheet('Product Content And Site Exp');
  const human = {}, api = {};
  ws.getRow(4).eachCell({ includeEmpty: true }, (c, i) => { human[i] = String(c.value || ''); });
  ws.getRow(5).eachCell({ includeEmpty: true }, (c, i) => { api[i]   = String(c.value || ''); });
  return { ws, human, api };
}

// ─── Stream source rows ───────────────────────────────────────────────────────

async function streamSource() {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(SOURCE, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore',
  });
  const rows = [];
  let headers = null;

  reader.on('worksheet', ws => {
    ws.on('row', row => {
      const vals = row.values.slice(1);
      if (!headers) {
        headers = vals.map(v => String(v ?? ''));
        return;
      }
      const obj = {};
      headers.forEach((h, i) => {
        let v = vals[i];
        if (v && typeof v === 'object' && v.text) v = v.text;
        if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
        obj[h] = v ?? null;
      });
      // Pre-parse attributes into a Map
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
    ws.on('end', () => {});
  });

  await new Promise((resolve, reject) => {
    reader.on('end', resolve);
    reader.on('error', reject);
    reader.read();
  });
  return rows;
}

// ─── Main sweep ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`Sweeping: ${path.basename(FILLED)}`);
  console.log(`Source:   ${path.basename(SOURCE)}\n`);

  const [{ ws, human, api }, sourceRows] = await Promise.all([
    loadColHeaders(),
    streamSource(),
  ]);

  const TOTAL = sourceRows.length;

  // Count fills per column in the filled file
  const fillCounts = {};
  for (let c = 1; c <= 94; c++) fillCounts[c] = 0;

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum <= 5) return;
    for (let c = 1; c <= 94; c++) {
      const v = row.getCell(c).value;
      if (v !== null && v !== undefined && v !== '') fillCounts[c]++;
    }
  });

  // ─── 1. Full column fill rate table ────────────────────────────────────────
  console.log('═'.repeat(80));
  console.log('  ALL COLUMNS — Fill Rates');
  console.log('═'.repeat(80));
  for (let c = 1; c <= 94; c++) {
    const hdr  = human[c] || api[c] || `col${c}`;
    const pct  = ((fillCounts[c] / TOTAL) * 100).toFixed(1);
    const bar  = '█'.repeat(Math.round(fillCounts[c] / TOTAL * 20));
    const flag = fillCounts[c] === 0 ? ' ← EMPTY' : '';
    if (fillCounts[c] > 0 || hdr.trim()) {
      console.log(
        `  [${String(c).padStart(2)}] ${hdr.slice(0,35).padEnd(36)} ${String(fillCounts[c]).padStart(4)}/${TOTAL} (${pct.padStart(5)}%)  ${bar}${flag}`
      );
    }
  }

  // ─── 2. Gap analysis — what source data exists for empty/sparse columns ───
  console.log('\n' + '═'.repeat(80));
  console.log('  GAP ANALYSIS — Source Attribute Coverage for Unfilled/Sparse Columns');
  console.log('═'.repeat(80));

  // For each source row, check what attrs could fill missing/sparse cols
  const attrCoverage = {};   // attrKey → count
  const colAttrMap = {       // col → [attr keys to check]
    18:  ['image_url'],       // Additional Image URL (col 18 skipped, col 19 used)
    20:  ['count_per_pack', 'package_quantity', 'pack_quantity', 'pack_size'],
    21:  ['quantity', 'quantity_sold', 'count'],
    28:  ['volume', 'size'],  // Net Content measure
    32:  ['aaia_brand_id'],
    52:  ['volume', 'volume_capacity', 'size'],   // Net Content Statement
    55:  ['part_terminology_id', 'vmrs_code'],
    68:  ['warranty_url'],
    77:  ['electronics_indicator'],   // inferrable from part type
    80:  ['anticipated_ship_out_time', 'lead_time'],
    94:  ['msrp'],
  };

  // Count coverage of each candidate attr key
  sourceRows.forEach(r => {
    r._attrs.forEach((v, k) => {
      attrCoverage[k] = (attrCoverage[k] || 0) + 1;
    });
  });

  for (const [col, keys] of Object.entries(colAttrMap)) {
    const c = parseInt(col);
    const hdr = human[c] || api[c] || `col${c}`;
    const filled = fillCounts[c];
    const pct = ((filled / TOTAL) * 100).toFixed(1);

    const keyStats = keys.map(k => {
      const cnt = attrCoverage[k] || 0;
      return `${k} (${((cnt/TOTAL)*100).toFixed(1)}%)`;
    }).join(', ');

    console.log(`\n  [${String(c).padStart(2)}] ${hdr}`);
    console.log(`       Currently filled: ${filled}/${TOTAL} (${pct}%)`);
    console.log(`       Source keys:      ${keyStats}`);

    // Show samples of first matching key that has data
    for (const k of keys) {
      if (!attrCoverage[k]) continue;
      const samples = sourceRows
        .filter(r => r._attrs.get(k))
        .slice(0, 3)
        .map(r => r._attrs.get(k));
      if (samples.length) {
        console.log(`       Samples (${k}): ${samples.map(s => String(s).slice(0,40)).join(' | ')}`);
        break;
      }
    }
  }

  // ─── 3. Image URL gap — col 18 skipped ────────────────────────────────────
  let col18usable = 0, col18hasThird = 0;
  sourceRows.forEach(r => {
    const raw = r._attrs.get('image_url') || '';
    const urls = raw.split(/\s+/).filter(u => u.startsWith('http'));
    if (urls[1]) col18usable++;   // has a second URL to put in col 18
    if (urls[2]) col18hasThird++; // has a third URL for col 19
  });
  console.log(`\n  ─── Image URL Analysis ───`);
  console.log(`  Rows with ≥2 image URLs (col 18 + 19 fillable): ${col18usable}/${TOTAL}`);
  console.log(`  Rows with ≥3 image URLs (col 18 + 19 + extra):  ${col18hasThird}/${TOTAL}`);
  console.log(`  Currently: col 17=main, col 19=2nd. Col 18 is SKIPPED entirely.`);

  // ─── 4. Electronics indicator inference ───────────────────────────────────
  const ELECTRONIC_TERMS = /\b(ignition|sensor|relay|switch|module|ecu|ecm|actuator|solenoid|coil|alternator|starter|motor|controller|electronic|electrical|wiring|harness|fuse|circuit|bulb|led|light|lamp)\b/i;
  let inferElec = 0;
  sourceRows.forEach(r => {
    const partType = String(r['Part Type'] || '').toLowerCase();
    const title = String(r['Title'] || r['title'] || '').toLowerCase();
    if (ELECTRONIC_TERMS.test(partType) || ELECTRONIC_TERMS.test(title)) inferElec++;
  });
  console.log(`\n  ─── Electronics Indicator (col 77) Inference ───`);
  console.log(`  Rows inferrable as electronic from Part Type/Title: ${inferElec}/${TOTAL} (${((inferElec/TOTAL)*100).toFixed(1)}%)`);
  console.log(`  Currently: col 77 = 0 filled (always empty)`);

  // ─── 5. Net Content analysis for fluids ───────────────────────────────────
  const VOLUME_PATTERN = /^([\d.]+)\s*(qt|quart|gal|gallon|oz|ounce|liter|litre|L|ml|mL|fl\.?\s*oz)/i;
  let netContentFillable = 0;
  const netSamples = [];
  sourceRows.forEach(r => {
    const size = r._attrs.get('size') || r._attrs.get('volume') || r._attrs.get('volume_capacity') || '';
    const m = String(size).match(VOLUME_PATTERN);
    if (m) {
      netContentFillable++;
      if (netSamples.length < 4) netSamples.push(`"${size}" → measure=${m[1]}, unit=${m[2]}`);
    }
  });
  console.log(`\n  ─── Net Content (cols 28/29/52) Inference for Fluids ───`);
  console.log(`  Rows with parseable volume in size/volume attr: ${netContentFillable}/${TOTAL}`);
  netSamples.forEach(s => console.log(`    ${s}`));

  // ─── 6. Spot-check 5 rows: side-by-side source vs filled ─────────────────
  console.log('\n' + '═'.repeat(80));
  console.log('  ROW SPOT CHECK — Source Attrs vs Filled Columns (5 sampled rows)');
  console.log('═'.repeat(80));

  const SPOT_IDXS = [0, 99, 299, 699, 1099]; // data row indices (0-based)
  const CHECK_COLS = [2, 8, 9, 10, 11, 12, 17, 18, 19, 22, 24, 25, 31, 33, 44, 45, 47, 48, 50, 51, 59, 63, 64, 65, 66, 67];

  for (const idx of SPOT_IDXS) {
    const src = sourceRows[idx];
    if (!src) continue;
    const sheetRow = ws.getRow(6 + idx);
    console.log(`\n  ─── Source row ${idx + 1}: ${src['Part Number']} — ${String(src['Part Type'] || '').slice(0, 40)} ───`);

    for (const c of CHECK_COLS) {
      const hdr = (human[c] || api[c] || `col${c}`).slice(0, 30);
      const filled = sheetRow.getCell(c).value;
      const filledStr = filled != null ? String(filled).slice(0, 60) : '(empty)';
      const isEmpty = filled == null || filled === '';
      if (!isEmpty) {
        console.log(`    [${String(c).padStart(2)}] ${hdr.padEnd(32)} ✓ ${filledStr}`);
      } else {
        // Show what source attr was available but missed
        const missedAttr = findBestMissedAttr(src._attrs, c);
        if (missedAttr) {
          console.log(`    [${String(c).padStart(2)}] ${hdr.padEnd(32)} ✗ (empty) — src has: ${missedAttr}`);
        }
      }
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('  SUMMARY: Actionable Improvements');
  console.log('═'.repeat(80));
  console.log(`  1. Col 18 (Additional Image URL): Use 2nd URL from image_url — ${col18usable} rows fillable`);
  console.log(`  2. Cols 28/29 (Net Content): Parse volume from size/volume — ${netContentFillable} rows fillable`);
  console.log(`  3. Col 52 (Net Content Statement): Free-text size for fluids`);
  console.log(`  4. Col 77 (Electronics Indicator): Infer "Yes" from Part Type/Title — ${inferElec} rows`);
  console.log(`  5. Col 80 (Fulfillment Lag Time): ${attrCoverage['anticipated_ship_out_time'] || 0} rows have anticipated_ship_out_time attr`);
  console.log(`\n  Not worth adding (insufficient source coverage):`);
  console.log(`     Col 32 AAIA Brand ID: no data in source`);
  console.log(`     Col 55 Part Terminology ID: requires VCDB lookup table`);
  console.log(`     Col 68 Warranty URL: no URLs in source`);
  console.log(`     Col 94 MSRP: not in source (price is selling price)`);
  console.log(`     Cols 69-76 Variants/Swatch: not applicable to this catalog`);
  console.log(`     Cols 83-89 Fulfillment/Preorder: operational, not product data`);
}

function findBestMissedAttr(attrMap, col) {
  const MISSED_MAP = {
    18: ['image_url'],
    28: ['volume', 'size', 'volume_capacity'],
    29: ['volume', 'size'],
    52: ['volume', 'volume_capacity', 'size'],
    77: [],  // inferred, not from attrs
    80: ['anticipated_ship_out_time', 'lead_time'],
  };
  const keys = MISSED_MAP[col];
  if (!keys) return null;
  for (const k of keys) {
    const v = attrMap.get(k);
    if (v) return `${k}="${String(v).slice(0, 40)}"`;
  }
  return null;
}

main().catch(err => { console.error(err); process.exit(1); });
