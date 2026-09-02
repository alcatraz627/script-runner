#!/usr/bin/env node
/**
 * Sample the actual source values that are being dropped in v6.
 * Shows what parseLeadingNumber / parseNetContent fail on.
 */
const ExcelJS = require('exceljs');
const path = require('path');

const SOURCE = path.join(process.env.HOME, 'Downloads', 'export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx');
const V6     = path.join(__dirname, 'walmart-loadsheet-filled-v9.xlsx');

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

async function readV6Rows() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(V6);
  const ws = wb.getWorksheet('Product Content And Site Exp');
  if (!ws) throw new Error('Sheet not found');
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
  return rows;
}

function isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

async function main() {
  const srcRows = await readSourceRows();
  const v6Rows = await readV6Rows();
  const rowCount = Math.min(srcRows.length, v6Rows.length);

  // Collect dropped values per field
  const drops = {
    'Net Content': { col: 28, samples: [] },
    'Shipping Weight': { col: 11, samples: [] },
    'Depth': { col: 34, samples: [] },
    'Height': { col: 36, samples: [] },
    'Assembled Dimensions': { col: 46, samples: [] },
    'Number of Pieces': { col: 53, samples: [] },
    'Width': { col: 40, samples: [] },
  };

  for (let i = 0; i < rowCount; i++) {
    const src = srcRows[i];
    const v6 = v6Rows[i];
    const a = parseAttrs(src['attributes']);
    const pn = String(src['Part Number'] || '?').slice(0, 20);

    // Net Content — source keys: volume, size, volume_capacity, net_content, fluid_ounces, capacity
    const ncRaw = a.get('net_content') || a.get('fluid_ounces') || a.get('volume') || a.get('size') || a.get('volume_capacity') || a.get('capacity') || '';
    if (ncRaw && isEmpty(v6[28])) {
      drops['Net Content'].samples.push({ row: i+1, pn, value: ncRaw.slice(0, 80) });
    }

    // Shipping Weight
    const swRaw = firstAttr(a, 'shipping_weight', 'weight');
    if (swRaw && isEmpty(v6[11])) {
      drops['Shipping Weight'].samples.push({ row: i+1, pn, value: swRaw.slice(0, 80) });
    }

    // Depth
    const dRaw = firstAttr(a, 'package_depth', 'length');
    if (dRaw && isEmpty(v6[34])) {
      drops['Depth'].samples.push({ row: i+1, pn, value: dRaw.slice(0, 80) });
    }

    // Height
    const hRaw = firstAttr(a, 'package_height', 'height');
    if (hRaw && isEmpty(v6[36])) {
      drops['Height'].samples.push({ row: i+1, pn, value: hRaw.slice(0, 80) });
    }

    // Assembled Dimensions
    const dimRaw = firstAttr(a, 'dimensions', 'dimension');
    const hasParts = firstAttr(a, 'package_depth') && firstAttr(a, 'package_height') && firstAttr(a, 'package_width');
    const asmSrc = dimRaw || (hasParts ? 'computed' : '');
    if (asmSrc && isEmpty(v6[46])) {
      drops['Assembled Dimensions'].samples.push({ row: i+1, pn, value: (dimRaw || `D=${firstAttr(a,'package_depth')} H=${firstAttr(a,'package_height')} W=${firstAttr(a,'package_width')}`).slice(0, 80) });
    }

    // Number of Pieces
    const npRaw = firstAttr(a, 'number_of_piece', 'number_of_pieces');
    if (npRaw && isEmpty(v6[53])) {
      drops['Number of Pieces'].samples.push({ row: i+1, pn, value: npRaw.slice(0, 80) });
    }
  }

  // Print per-field samples
  for (const [field, data] of Object.entries(drops)) {
    if (data.samples.length === 0) continue;
    console.log(`\n=== ${field} — ${data.samples.length} drops (col ${data.col}) ===`);

    // Group by unique value patterns
    const patterns = {};
    for (const s of data.samples) {
      // Normalize to pattern
      const norm = s.value.replace(/[\d.]+/g, 'N').replace(/\s+/g, ' ').trim();
      if (!patterns[norm]) patterns[norm] = { count: 0, example: s.value, rows: [] };
      patterns[norm].count++;
      if (patterns[norm].rows.length < 3) patterns[norm].rows.push(s.row);
    }
    const sorted = Object.entries(patterns).sort((a, b) => b[1].count - a[1].count);
    console.log('Pattern (numbers→N)             | Count | Example Value                         | Sample Rows');
    console.log('--------------------------------|-------|---------------------------------------|------------');
    for (const [pat, info] of sorted.slice(0, 15)) {
      console.log(`${pat.slice(0, 31).padEnd(31)} | ${String(info.count).padStart(5)} | ${info.example.slice(0, 37).padEnd(37)} | ${info.rows.join(', ')}`);
    }
  }

  // Also check: what attribute keys exist in source but are NOT used by the fill script at all?
  // Focus on keys with >5% coverage
  const FILL_USED_KEYS = new Set([
    'image_url', 'price', 'shipping_weight', 'weight',
    'package_depth', 'length', 'package_height', 'height', 'package_width', 'width',
    'dimensions', 'dimension', 'automotive_part_division',
    'california_prop_65_warning', 'has_written_warranty',
    'warranty', 'manufacturer_warranty', 'warranty_information',
    'color', 'color_finish', 'hose_color', 'caliper_color',
    'finish', 'rotor_finish',
    'material', 'hose_material', 'pad_material', 'rotor_material',
    'disc_material', 'brake_pad_material', 'friction_material_composition',
    'system_material', 'muffler_material', 'media_material',
    'manufacturer_s_part_number', 'model_number', 'model', 'vendor_part_number',
    'number_of_piece', 'number_of_pieces',
    'size', 'tire_size', 'thread_size', 'section_width', 'aspect_ratio', 'wheel_diameter',
    'condition', 'remanufactured',
    'upc', 'gtin',
    'anticipated_ship_out_time', 'lead_time',
    'automotive_specialty_part_type', 'sub_type', 'category', 'part_type',
    'net_content', 'fluid_ounces', 'volume', 'capacity', 'volume_capacity',
    'mounting_hardware_included', 'gaskets_included', 'hardware_included',
    'instructions_included', 'o-ring_included', 'seals_included',
    'bolts_included', 'clamps_included', 'fittings_included',
    'item_included', 'include', 'package_content', 'items_included',
    'hardware_included', 'mounting_hardware_included', 'gasket_included',
    'shim_included', 'pad_shim_included', 'abutment_clip_included',
    'brake_lubricant_included', 'electronic_wear_sensor_included',
    'pad_wear_sensor_included', 'wiring_harness_included',
    'hose_adapter_included', 'hose_clamp_included', 'hose_clamp_cover_included',
    'mounting_bracket_included', 'pulley_included', 'sending_unit_included',
    'fuel_pressure_regulator_included', 'bracket_included', 'bushing_included',
    'gasket_or_seal_included', 'brake_pads_included', 'fitting_included',
    'feature', 'note', 'application_summary', 'key_feature',
    'feature_benefit', 'fitnote', 'compatibility', 'duty_type',
    'fit_type', 'fitment_type',
    'mount_location', 'mounting_location',
  ]);

  // Count all attr keys
  const keyCounts = new Map();
  for (const src of srcRows) {
    const a = parseAttrs(src['attributes']);
    for (const k of a.keys()) {
      keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
    }
  }

  const highCovUnmapped = [...keyCounts.entries()]
    .filter(([k, c]) => !FILL_USED_KEYS.has(k) && c / srcRows.length > 0.01)
    .sort((a, b) => b[1] - a[1]);

  if (highCovUnmapped.length > 0) {
    console.log(`\n=== UNMAPPED ATTRIBUTE KEYS WITH >1% COVERAGE ===`);
    console.log('Key                              | Rows  | Coverage | Sample');
    console.log('---------------------------------|-------|----------|-------');
    for (const [k, c] of highCovUnmapped.slice(0, 30)) {
      const pct = ((c / srcRows.length) * 100).toFixed(1);
      // Get a sample value
      let sample = '';
      for (const src of srcRows) {
        const a = parseAttrs(src['attributes']);
        if (a.has(k)) { sample = a.get(k).slice(0, 40); break; }
      }
      console.log(`${k.padEnd(32)} | ${String(c).padStart(5)} | ${pct.padStart(7)}% | ${sample}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
