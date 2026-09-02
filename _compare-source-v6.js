#!/usr/bin/env node
/**
 * Compare original source Enhancement export vs v6 loadsheet output.
 * For each row, determines what data EXISTS in source (top-level + parsed attributes)
 * and what is MISSING in v6, accounting for ALL attribute-to-column mappings.
 *
 * Usage: node _compare-source-v6.js
 */

const ExcelJS = require('exceljs');
const path = require('path');

const SOURCE = path.join(process.env.HOME, 'Downloads', 'export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx');
const V6     = path.join(__dirname, 'walmart-loadsheet-filled-v9.xlsx');

// ─── Attribute parsing (mirrors fill-walmart-loadsheet.js) ───────────────────

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

function firstAttr(attrMap, ...keys) {
  for (const k of keys) {
    const v = attrMap.get(k);
    if (v && v.trim()) return v.trim();
  }
  return '';
}

function parseLeadingNumber(str) {
  if (!str) return '';
  const m = String(str).match(/^[\s]*([\d]+\.?\d*)/);
  return m ? parseFloat(m[1]) : '';
}

// ─── Define the complete source→loadsheet mapping ────────────────────────────
// Each entry: { name, colNums, resolve(src, attrMap) → truthy if source has data }

const MAPPINGS = [
  { name: 'SKU / Product ID / MPN', colNums: [4, 7, 27],
    resolve: (src) => src['Part Number'] },

  { name: 'Product Name (Title)', colNums: [8],
    resolve: (src) => src['Title'] },

  { name: 'Brand / Manufacturer', colNums: [9, 49],
    resolve: (src) => src['Brand'] },

  { name: 'Selling Price', colNums: [10],
    resolve: (_, a) => a.get('price') },

  { name: 'Shipping Weight', colNums: [11],
    resolve: (_, a) => firstAttr(a, 'shipping_weight', 'weight') },

  { name: 'Site Description', colNums: [12],
    resolve: (src) => src['Description'] },

  { name: 'Key Features (FAB)', colNums: [13, 14, 15, 16],
    resolve: (src) => src['Features & Benefits'] },

  { name: 'Main Image URL', colNums: [17],
    resolve: (_, a) => {
      const raw = a.get('image_url') || '';
      return raw.split(/\s+/).filter(u => u.startsWith('http'))[0] || '';
    }},

  { name: 'Secondary Image URL', colNums: [19],
    resolve: (_, a) => {
      const raw = a.get('image_url') || '';
      return raw.split(/\s+/).filter(u => u.startsWith('http'))[1] || '';
    }},

  { name: 'Prop 65 Warning', colNums: [23, 43],
    resolve: (_, a) => a.get('california_prop_65_warning') },

  { name: 'Part Type', colNums: [24],
    resolve: (src, a) => src['Part Type'] || firstAttr(a, 'automotive_specialty_part_type', 'sub_type', 'category', 'part_type') },

  { name: 'Condition', colNums: [25],
    resolve: (_, a) => a.get('condition') || a.get('remanufactured') || 'New' },  // always has a value

  { name: 'Has Written Warranty', colNums: [26],
    resolve: (_, a) => a.get('has_written_warranty') },

  { name: 'UPC', colNums: [2, 90, 91],
    resolve: (_, a) => {
      const raw = (a.get('upc') || a.get('gtin') || '').trim();
      if (!raw || /not\s*applicable|n\/a/i.test(raw)) return '';
      const digits = raw.replace(/\D/g, '');
      return digits.length >= 8 ? digits : '';
    }},

  { name: 'Net Content', colNums: [28, 29, 52],
    resolve: (_, a) => a.get('volume') || a.get('size') || a.get('volume_capacity') || '' },

  { name: 'Additional Features', colNums: [33],
    resolve: (_, a) => firstAttr(a, 'feature', 'note', 'application_summary', 'key_feature', 'feature_benefit', 'fitnote', 'compatibility', 'duty_type') },

  { name: 'Depth', colNums: [34, 35],
    resolve: (_, a) => firstAttr(a, 'package_depth', 'length') },

  { name: 'Height', colNums: [36, 37],
    resolve: (_, a) => firstAttr(a, 'package_height', 'height') },

  { name: 'Weight (assembled)', colNums: [38, 39],
    resolve: (_, a) => firstAttr(a, 'weight') },

  { name: 'Width', colNums: [40, 41],
    resolve: (_, a) => firstAttr(a, 'package_width', 'width') },

  { name: 'Auto Parts Division', colNums: [42],
    resolve: (_, a) => a.get('automotive_part_division') },

  { name: 'Color', colNums: [44],
    resolve: (_, a) => firstAttr(a, 'color', 'color_finish', 'hose_color', 'caliper_color') },

  { name: 'Assembled Dimensions', colNums: [46],
    resolve: (_, a) => firstAttr(a, 'dimensions', 'dimension') || (firstAttr(a, 'package_depth') && firstAttr(a, 'package_height') && firstAttr(a, 'package_width') ? 'computed' : '') },

  { name: 'Finish', colNums: [47],
    resolve: (_, a) => firstAttr(a, 'finish', 'rotor_finish') },

  { name: 'Items Included', colNums: [48],
    resolve: (_, a) => firstAttr(a, 'item_included', 'include', 'package_content', 'items_included') ||
      ['hardware_included', 'mounting_hardware_included', 'gasket_included'].some(k => /^yes|oui/i.test(a.get(k) || '')) },

  { name: 'Material', colNums: [50],
    resolve: (_, a) => firstAttr(a, 'material', 'hose_material', 'pad_material', 'rotor_material', 'disc_material', 'brake_pad_material') },

  { name: 'Model Number', colNums: [51],
    resolve: (_, a) => firstAttr(a, 'manufacturer_s_part_number', 'model_number', 'model', 'vendor_part_number') },

  { name: 'Number of Pieces', colNums: [53],
    resolve: (_, a) => firstAttr(a, 'number_of_piece', 'number_of_pieces') },

  { name: 'Size', colNums: [59],
    resolve: (_, a) => firstAttr(a, 'size', 'tire_size', 'thread_size') ||
      (a.get('section_width') && a.get('aspect_ratio') && a.get('wheel_diameter') ? 'computed' : '') },

  { name: 'Warranty Text', colNums: [67],
    resolve: (_, a) => firstAttr(a, 'warranty', 'manufacturer_warranty', 'warranty_information') },

  { name: 'Electronics Indicator', colNums: [77],
    resolve: (src) => /\b(ignition|sensor|relay|switch|module|ecu|ecm|actuator|solenoid|coil|alternator|starter|motor|controller|electronic|electrical|wiring|harness|fuse|circuit|bulb|led|light|lamp)\b/i.test(src['Part Type'] || '') ||
      /\b(ignition|sensor|relay|switch|module|ecu|ecm|actuator|solenoid|coil|alternator|starter|motor|controller|electronic|electrical|wiring|harness|fuse|circuit|bulb|led|light|lamp)\b/i.test(src['Title'] || '') },

  { name: 'Fulfillment Lag Time', colNums: [80],
    resolve: (_, a) => firstAttr(a, 'anticipated_ship_out_time', 'lead_time') },
];

// ─── Read source ─────────────────────────────────────────────────────────────

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

// ─── Read v6 ─────────────────────────────────────────────────────────────────

async function readV6Rows() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(V6);
  const ws = wb.getWorksheet('Product Content And Site Exp');
  if (!ws) throw new Error('Sheet not found');

  const headerRow = ws.getRow(5);
  const colHeaders = [];
  for (let c = 1; c <= 94; c++) {
    colHeaders[c] = String(headerRow.getCell(c).value || `col_${c}`);
  }

  const rows = [];
  for (let r = 6; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = {};
    let hasData = false;
    for (let c = 1; c <= 94; c++) {
      const v = row.getCell(c).value;
      obj[c] = v;
      if (v !== null && v !== undefined && String(v).trim() !== '') hasData = true;
    }
    if (!hasData) break;
    rows.push(obj);
  }
  return { colHeaders, rows };
}

function isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Reading source...');
  const srcRows = await readSourceRows();
  console.log(`  Source: ${srcRows.length} rows`);

  console.log('Reading v6...');
  const v6 = await readV6Rows();
  console.log(`  V6: ${v6.rows.length} rows\n`);

  const rowCount = Math.min(srcRows.length, v6.rows.length);

  // ─── Per-mapping aggregate stats ───────────────────────────────────────────
  // For each mapping: count rows where source has data but v6 primary col is empty
  const mappingStats = MAPPINGS.map(m => ({
    name: m.name,
    colNums: m.colNums,
    sourceHas: 0,    // rows where source has data for this field
    v6Has: 0,        // rows where v6 has data in the primary column
    dropped: 0,      // rows where source has data but v6 doesn't
  }));

  // ─── Per-row stats ─────────────────────────────────────────────────────────
  const rowStats = []; // { row, partNumber, totalMapped, totalDropped, drops: string[] }

  for (let i = 0; i < rowCount; i++) {
    const src = srcRows[i];
    const v6Row = v6.rows[i];
    const attrMap = parseAttrs(src['attributes']);

    let totalMapped = 0;
    let totalDropped = 0;
    const drops = [];

    for (let mi = 0; mi < MAPPINGS.length; mi++) {
      const m = MAPPINGS[mi];
      const sourceVal = m.resolve(src, attrMap);
      const hasSource = sourceVal && String(sourceVal).trim() !== '' && sourceVal !== false;

      if (!hasSource) continue;
      mappingStats[mi].sourceHas++;
      totalMapped++;

      // Check if v6 has data in the primary column (first colNum)
      const primaryCol = m.colNums[0];
      const v6Val = v6Row[primaryCol];
      const hasV6 = !isEmpty(v6Val);

      if (hasV6) {
        mappingStats[mi].v6Has++;
      } else {
        mappingStats[mi].dropped++;
        totalDropped++;
        drops.push(m.name);
      }
    }

    rowStats.push({
      row: i + 1,
      partNumber: String(src['Part Number'] || '?').slice(0, 20),
      totalMapped,
      totalDropped,
      drops,
    });
  }

  // ─── Report 1: Per-field drop summary ──────────────────────────────────────
  console.log('=== PER-FIELD DROP SUMMARY (Source has data → V6 missing) ===');
  console.log('Field                          | Src Has | V6 Has | Dropped | Drop%');
  console.log('-------------------------------|---------|--------|---------|------');
  // Sort by dropped desc
  const sortedStats = [...mappingStats].sort((a, b) => b.dropped - a.dropped);
  for (const s of sortedStats) {
    if (s.sourceHas === 0 && s.dropped === 0) continue;
    const pct = s.sourceHas > 0 ? ((s.dropped / s.sourceHas) * 100).toFixed(1) : '0.0';
    console.log(
      `${s.name.padEnd(30)} | ${String(s.sourceHas).padStart(7)} | ${String(s.v6Has).padStart(6)} | ${String(s.dropped).padStart(7)} | ${pct.padStart(5)}%`
    );
  }

  // ─── Report 2: Per-row drop count distribution ─────────────────────────────
  console.log('\n=== PER-ROW DROP COUNT DISTRIBUTION ===');
  const hist = {};
  for (const r of rowStats) {
    hist[r.totalDropped] = (hist[r.totalDropped] || 0) + 1;
  }
  console.log('Drops | Rows  | Bar');
  console.log('------|-------|' + '-'.repeat(50));
  for (const [drops, count] of Object.entries(hist).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const bar = '█'.repeat(Math.ceil(count / 20));
    console.log(`${String(drops).padStart(5)} | ${String(count).padStart(5)} | ${bar}`);
  }

  // ─── Report 3: Rows with drops (excluding price & condition which are expected) ───
  const EXPECTED_DROPS = new Set(['Selling Price', 'Condition']);
  console.log('\n=== ROWS WITH UNEXPECTED DROPS (excluding price) ===');
  console.log('Row  | Part Number          | Mapped | Dropped | Drop Details');
  console.log('-----|----------------------|--------|---------|------------------------------------------');

  const unexpectedDropRows = rowStats
    .map(r => ({
      ...r,
      unexpectedDrops: r.drops.filter(d => !EXPECTED_DROPS.has(d)),
    }))
    .filter(r => r.unexpectedDrops.length > 0)
    .sort((a, b) => b.unexpectedDrops.length - a.unexpectedDrops.length);

  // Show top 30 worst rows
  for (const r of unexpectedDropRows.slice(0, 30)) {
    const details = r.unexpectedDrops.join(', ').slice(0, 42);
    console.log(
      `${String(r.row).padStart(4)} | ${r.partNumber.padEnd(20)} | ${String(r.totalMapped).padStart(6)} | ${String(r.unexpectedDrops.length).padStart(7)} | ${details}`
    );
  }
  if (unexpectedDropRows.length > 30) {
    console.log(`  ... and ${unexpectedDropRows.length - 30} more rows with unexpected drops`);
  }

  // ─── Report 4: Summary ─────────────────────────────────────────────────────
  const totalUnexpected = unexpectedDropRows.reduce((sum, r) => sum + r.unexpectedDrops.length, 0);
  console.log('\n=== SUMMARY ===');
  console.log(`Total rows compared: ${rowCount}`);
  console.log(`Rows with 0 unexpected drops: ${rowCount - unexpectedDropRows.length}`);
  console.log(`Rows with unexpected drops: ${unexpectedDropRows.length}`);
  console.log(`Total unexpected drop instances: ${totalUnexpected}`);
  console.log(`\nMost common unexpected drops:`);
  const dropCounts = {};
  for (const r of unexpectedDropRows) {
    for (const d of r.unexpectedDrops) {
      dropCounts[d] = (dropCounts[d] || 0) + 1;
    }
  }
  const sortedDrops = Object.entries(dropCounts).sort((a, b) => b[1] - a[1]);
  for (const [field, count] of sortedDrops) {
    console.log(`  ${field}: ${count} rows (${((count / rowCount) * 100).toFixed(1)}%)`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
