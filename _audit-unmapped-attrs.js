#!/usr/bin/env node
/**
 * Audit: which source attribute keys are NOT mapped to any v6 loadsheet column?
 * Parses every row's pipe-delimited attributes, inventories all keys,
 * then checks which keys the fill script actually references.
 */

const ExcelJS = require('exceljs');
const path = require('path');

const SOURCE = path.join(process.env.HOME, 'Downloads', 'export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx');
const V6     = path.join(__dirname, 'walmart-loadsheet-filled-v6.xlsx');

function parseAttrs(raw) {
  const map = new Map();
  if (!raw) return map;
  for (const part of String(raw).split('|')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const k = part.slice(0, colon).trim().toLowerCase().replace(/\s+/g, '_');
    const v = part.slice(colon + 1).trim();
    if (k && v) map.set(k, v);
  }
  return map;
}

// Keys the fill script explicitly uses (from reading fill-walmart-loadsheet.js)
const MAPPED_KEYS = new Set([
  'image_url',
  'price',
  'shipping_weight', 'weight',
  'package_depth', 'length', 'package_height', 'height', 'package_width', 'width',
  'dimensions', 'dimension',
  'automotive_part_division',
  'california_prop_65_warning',
  'has_written_warranty',
  'warranty', 'manufacturer_warranty', 'warranty_information',
  'color', 'color_finish', 'hose_color', 'caliper_color',
  'finish', 'rotor_finish',
  'material', 'housing_material', 'blade_material', 'construction', 'gasket_material',
  'lens_material', 'hose_material', 'pad_material',
  'manufacturer_s_part_number', 'model_number', 'model', 'vendor_part_number',
  'number_of_piece', 'number_of_pieces',
  'size', 'tire_size', 'thread_size',
  'section_width', 'aspect_ratio', 'wheel_diameter',
  'condition', 'remanufactured',
  'upc', 'upc_code', 'barcode',
  'anticipated_ship_out_time', 'lead_time',
  'automotive_specialty_part_type', 'sub_type', 'category', 'part_type',
  // net content
  'net_content', 'fluid_ounces', 'volume', 'capacity',
  // items included (boolean keys)
  'mounting_hardware_included', 'gaskets_included', 'hardware_included',
  'instructions_included', 'o-ring_included', 'seals_included',
  'bolts_included', 'clamps_included', 'fittings_included',
  // fitment (intentionally skipped)
  'fit_type', 'fitment_type',
  // mount location (intentionally skipped)
  'mount_location', 'mounting_location',
]);

async function readSourceRows() {
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(SOURCE, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore',
  });
  const rows = [];
  let headers = null;
  for await (const ws of workbook) {
    if (ws.id != 1) { for await (const _ of ws) {} continue; }
    for await (const row of ws) {
      const vals = row.values.slice(1);
      if (!headers) {
        headers = vals.map(v => (v && typeof v === 'object' && v.text) ? v.text : String(v ?? ''));
        continue;
      }
      const obj = {};
      headers.forEach((h, i) => {
        let v = vals[i];
        if (v && typeof v === 'object' && v.text) v = v.text;
        if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
        obj[h] = v ?? null;
      });
      rows.push(obj);
    }
  }
  return rows;
}

async function main() {
  console.log('Reading source...');
  const rows = await readSourceRows();
  console.log(`  ${rows.length} rows\n`);

  // Inventory all attribute keys with counts and sample values
  const keyStats = new Map(); // key → { count, sampleValue, sampleRow }

  for (let i = 0; i < rows.length; i++) {
    const attrMap = parseAttrs(rows[i]['attributes']);
    for (const [k, v] of attrMap) {
      if (!keyStats.has(k)) {
        keyStats.set(k, { count: 0, sampleValue: v, sampleRow: i + 1 });
      }
      keyStats.get(k).count++;
    }
  }

  // Sort by count desc
  const sorted = [...keyStats.entries()].sort((a, b) => b[1].count - a[1].count);

  // Classify each key
  const unmapped = [];
  const mapped = [];
  const skippedIntentionally = [];

  for (const [key, stats] of sorted) {
    if (MAPPED_KEYS.has(key)) {
      mapped.push({ key, ...stats });
    } else if (/fitment|fit_type|vehicle|mount_location|compatible/.test(key)) {
      skippedIntentionally.push({ key, ...stats });
    } else {
      unmapped.push({ key, ...stats });
    }
  }

  console.log(`=== ATTRIBUTE KEY INVENTORY ===`);
  console.log(`Total unique keys: ${sorted.length}`);
  console.log(`Mapped to loadsheet: ${mapped.length}`);
  console.log(`Skipped (fitment): ${skippedIntentionally.length}`);
  console.log(`UNMAPPED (potential drops): ${unmapped.length}\n`);

  console.log('=== UNMAPPED ATTRIBUTE KEYS (potential data loss) ===');
  console.log('Key                              | Rows  | Fill%  | Sample Value');
  console.log('---------------------------------|-------|--------|------------------------------------------');
  for (const { key, count, sampleValue } of unmapped) {
    const pct = ((count / rows.length) * 100).toFixed(1);
    const sample = String(sampleValue).slice(0, 42);
    console.log(`${key.padEnd(32)} | ${String(count).padStart(5)} | ${pct.padStart(5)}% | ${sample}`);
  }

  console.log('\n=== MAPPED ATTRIBUTE KEYS (confirmed in v6) ===');
  console.log('Key                              | Rows  | Fill%');
  console.log('---------------------------------|-------|-------');
  for (const { key, count } of mapped) {
    const pct = ((count / rows.length) * 100).toFixed(1);
    console.log(`${key.padEnd(32)} | ${String(count).padStart(5)} | ${pct.padStart(5)}%`);
  }

  if (skippedIntentionally.length > 0) {
    console.log('\n=== INTENTIONALLY SKIPPED (fitment) ===');
    console.log('Key                              | Rows  | Fill%');
    console.log('---------------------------------|-------|-------');
    for (const { key, count } of skippedIntentionally) {
      const pct = ((count / rows.length) * 100).toFixed(1);
      console.log(`${key.padEnd(32)} | ${String(count).padStart(5)} | ${pct.padStart(5)}%`);
    }
  }

  // Summary: total unmapped cell values
  const totalUnmappedCells = unmapped.reduce((sum, u) => sum + u.count, 0);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Unmapped keys: ${unmapped.length}`);
  console.log(`Total unmapped cell values: ${totalUnmappedCells}`);
  console.log(`High-coverage unmapped (>10%): ${unmapped.filter(u => u.count / rows.length > 0.1).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
