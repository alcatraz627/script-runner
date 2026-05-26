#!/usr/bin/env node
/**
 * fill-walmart-loadsheet.js
 * Maps Walmart enhancement Excel → Walmart Loadsheet template.
 *
 * Source:   ~/Downloads/export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_*.xlsx
 * Template: ~/Downloads/Walmart Loadhseet Mar 30.xlsx
 * Output:   ./walmart-loadsheet-filled-<date>.xlsx
 *
 * Sheet written: "Product Content And Site Exp"
 * Data starts at row 6 (rows 1–5 are header/spec rows preserved from template).
 *
 * Usage:
 *   node fill-walmart-loadsheet.js [--limit N]   # --limit for test runs
 *   node fill-walmart-loadsheet.js               # full 1252-row run
 */

'use strict';

const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');

const SOURCE   = path.join(process.env.HOME, 'Downloads', 'export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx');
const TEMPLATE = path.join(process.env.HOME, 'Downloads', 'Walmart Loadhseet Mar 30.xlsx');

// Auto-increment version: scan for existing walmart-loadsheet-filled-vN.xlsx files
function nextVersion() {
  const existing = fs.readdirSync(__dirname)
    .map(f => { const m = f.match(/^walmart-loadsheet-filled-v(\d+)\.xlsx$/); return m ? parseInt(m[1]) : 0; });
  return (existing.length ? Math.max(...existing) : 0) + 1;
}
const VERSION = nextVersion();
const OUT     = path.join(__dirname, `walmart-loadsheet-filled-v${VERSION}.xlsx`);

const args  = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i !== -1 ? parseInt(args[i + 1]) : Infinity; })();

// ─── Unicode normalizer ───────────────────────────────────────────────────────

/**
 * Normalize non-ASCII typographic characters to clean ASCII equivalents.
 * Applied to every string value before writing to the loadsheet.
 *
 * Targets:
 *   U+2011  non-breaking hyphen ‑  → -    (HIGH: breaks vehicle model search)
 *   U+2013  en dash –              → -
 *   U+2014  em dash —              → " - "
 *   U+2019  smart apostrophe '     → '
 *   U+2018  smart open quote '     → '
 *   U+201C  smart open quote "     → "
 *   U+201D  smart close quote "    → "
 *   U+00A0  non-breaking space     → ' '
 *   U+2026  ellipsis …             → ...
 */
function normalizeText(v) {
  if (typeof v !== 'string') return v;
  return v
    .replace(/\u2011/g, '-')       // non-breaking hyphen
    .replace(/\u2013/g, '-')       // en dash
    .replace(/\u2014/g, ' - ')     // em dash
    .replace(/[\u2018\u2019]/g, "'") // smart single quotes
    .replace(/[\u201C\u201D]/g, '"') // smart double quotes
    .replace(/\u00A0/g, ' ')       // non-breaking space
    .replace(/\u2026/g, '...');    // ellipsis character
}

// ─── Attribute helpers ───────────────────────────────────────────────────────

/** Parse pipe-separated "key: value | key: value" → Map<key, value>.
 *  For image_url, accumulates all values (space-separated) since the source
 *  stores multiple image_url entries as separate pipe-delimited pairs. */
function parseAttrs(raw) {
  const map = new Map();
  if (!raw) return map;
  for (const part of raw.split('|')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const k = part.slice(0, colon).trim().toLowerCase().replace(/\s+/g, '_');
    const v = part.slice(colon + 1).trim();
    if (!k || !v) continue;
    if (k === 'image_url' && map.has('image_url')) {
      map.set('image_url', map.get('image_url') + ' ' + v);
    } else {
      map.set(k, v);
    }
  }
  return map;
}

/** Resolve a single image URL token to an absolute https URL.
 *  - JEGS relative paths: /images/mini_100/… → https://www.jegs.com/images/photos/500/…
 *  - Protocol-relative: //static.summitracing.com/… → https://static.summitracing.com/…
 *  - Already absolute https URLs pass through unchanged. */
function resolveImageUrl(u) {
  if (u.startsWith('/images/mini_')) {
    return 'https://www.jegs.com' + u.replace('/images/mini_100/', '/images/photos/500/');
  }
  if (u.startsWith('/images/')) {
    return 'https://www.jegs.com' + u;
  }
  if (u.startsWith('//')) {
    return 'https:' + u;
  }
  return u;
}

/** Extract first and second HTTP URL from the image_url attribute value.
 *  Resolves relative JEGS paths and protocol-relative URLs before filtering.
 *  Only marks image_url as consumed if at least one valid URL was found. */
function parseImageUrls(attrMap, consumed) {
  const raw = attrMap.get('image_url') || '';
  const urls = raw.split(/\s+/)
    .map(resolveImageUrl)
    .filter(u => u.startsWith('https://'));
  if (urls.length > 0 && consumed) consumed.add('image_url');
  return { main: urls[0] || '', secondary: urls[1] || '' };
}


/** Extract a leading number from a string like "16.00", ".37", "52.25 in", "27.2 Lb (12.3kg)" */
function parseLeadingNumber(str) {
  if (!str) return '';
  const m = String(str).match(/^[\s]*([\d]*\.?\d+)/);
  return m ? parseFloat(m[1]) : '';
}

/** Pick first non-empty value from a list of attrMap keys */
function firstAttr(attrMap, ...keys) {
  for (const k of keys) {
    const v = attrMap.get(k);
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/** Like firstAttr, but records which key was actually consumed into a Set.
 *  Unused fallback keys remain untracked and flow to the catch-all. */
function firstAttrTracked(attrMap, consumed, ...keys) {
  for (const k of keys) {
    const v = attrMap.get(k);
    if (v && v.trim()) {
      consumed.add(k);
      return v.trim();
    }
  }
  return '';
}

/** Normalize a warranty value to readable text (e.g. "24 Months" → "24 Months") */
function parseWarranty(attrMap, consumed) {
  return consumed
    ? firstAttrTracked(attrMap, consumed, 'warranty', 'manufacturer_warranty', 'warranty_information')
    : firstAttr(attrMap, 'warranty', 'manufacturer_warranty', 'warranty_information');
}

/**
 * Build Additional Features (col 33) from multiple attr keys + catch-all.
 * Phase 1: Explicit high-priority keys (values only, no label prefix).
 * Phase 2: Catch-all for any remaining unmapped keys (with "Key: Value" labels).
 * Joins distinct non-empty values with "; ", capped at 4000 chars.
 */
function parseAdditionalFeatures(attrMap, dynamicConsumed = new Set()) {
  // Priority keys — values only (no label prefix)
  const PRIORITY_KEYS = [
    'feature', 'note', 'application_summary', 'key_feature',
    'feature_benefit', 'fitnote', 'compatibility', 'duty_type',
    // Phase 2 additions
    'line', 'sery', 'recommended_use', 'placement_on_vehicle', 'location',
    'interchange_part_number', 'oem_interchange_number', 'alternate_inventory_number',
    'country_of_origin', 'country_of_origin_primary',
    'summit_racing_part_number', 'ebay_id_epid', 'currency',
    'part_number', 'availability',
    'harmonized_tariff_code_schedule_b', 'harmonized_tariff_code_hts',
  ];
  const seen = new Set();
  const parts = [];
  const consumed = new Set(PRIORITY_KEYS);

  for (const k of PRIORITY_KEYS) {
    const v = (attrMap.get(k) || '').trim();
    if (v && !seen.has(v)) { seen.add(v); parts.push(v); }
  }

  // Explicitly skipped keys — fitment (per user request), pricing (per user request), image URLs
  // All other column-mapped keys are tracked dynamically via dynamicConsumed — if a parser
  // actually uses a key, it goes into dynamicConsumed and is excluded here. If a fallback key
  // is NOT used by its parser, it flows through to the catch-all instead of being silently dropped.
  const SKIP_KEYS = new Set([
    'vehicle_fitment_type', 'vehicle_make', 'vehicle_model', 'vehicle_year',
    'vehicle_type', 'part_fitment', 'fit', 'fit_type', 'fitment_type',
    'vehicle_fitment', 'compatible_vehicle', 'compatible_vehicles',
    'price', 'image_url',
  ]);

  // Catch-all: iterate remaining attrMap keys
  for (const [k, v] of attrMap) {
    if (consumed.has(k) || SKIP_KEYS.has(k) || dynamicConsumed.has(k)) continue;
    // Skip fitment-like keys by pattern
    if (/^vehicle_|fitment|compatible_vehicle/.test(k)) continue;
    const val = v.trim();
    if (val && !seen.has(val)) {
      seen.add(val);
      // Label with human-readable key name
      const label = k.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      parts.push(`${label}: ${val}`);
    }
  }

  const joined = parts.join('; ');
  return joined.length > 4000 ? joined.slice(0, 3997) + '…' : joined;
}

/**
 * Build Items Included (col 48) from item-value keys and boolean *_included keys.
 * Priority:
 *  1. item_included / include / package_content — direct textual descriptions
 *  2. Collect all *_included boolean keys where value is "Yes" / "Oui"
 *     e.g. "hardware_included=Yes" → "Hardware: Yes"
 */
function parseItemsIncluded(attrMap, consumed) {
  // First: direct item-list descriptions
  const directKeys = ['item_included', 'include', 'package_content', 'items_included'];
  const direct = consumed
    ? firstAttrTracked(attrMap, consumed, ...directKeys)
    : firstAttr(attrMap, ...directKeys);
  if (direct) return direct.slice(0, 200);

  // Second: collect boolean *_included keys that are "Yes"
  const BOOL_KEYS = [
    'hardware_included', 'mounting_hardware_included', 'gasket_included',
    'shim_included', 'pad_shim_included', 'abutment_clip_included',
    'brake_lubricant_included', 'electronic_wear_sensor_included',
    'pad_wear_sensor_included', 'wiring_harness_included',
    'hose_adapter_included', 'hose_clamp_included', 'hose_clamp_cover_included',
    'mounting_bracket_included', 'pulley_included', 'sending_unit_included',
    'fuel_pressure_regulator_included', 'bracket_included', 'bushing_included',
    'gasket_or_seal_included', 'brake_pads_included', 'fitting_included',
  ];
  const yeses = [];
  for (const k of BOOL_KEYS) {
    const v = (attrMap.get(k) || '').trim();
    if (/^yes|oui/i.test(v)) {
      yeses.push(k.replace(/_included$/, '').split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' '));
      if (consumed) consumed.add(k);
    }
  }
  return yeses.length ? yeses.join(', ') : '';
}

/**
 * Parse net content from size/volume/volume_capacity attributes.
 * Returns { measure: number, unit: string } for fluid products, or null.
 * e.g. "1.00 quart" → { measure: 1, unit: 'qt' }
 *      "1 gal"      → { measure: 1, unit: 'gal' }
 */
function parseNetContent(attrMap) {
  const VOLUME_PATTERN = /^([\d.]+)\s*(qt|quarts?|gal|gallons?|oz|ounces?|liters?|litres?|L\b|ml|mL|fl\.?\s*oz)/i;
  const UNIT_MAP = {
    qt: 'qt', quart: 'qt', quarts: 'qt',
    gal: 'gal', gallon: 'gal', gallons: 'gal',
    oz: 'oz', ounce: 'oz', ounces: 'oz',
    liter: 'L', liters: 'L', litre: 'L', litres: 'L', l: 'L',
    ml: 'mL', ml_: 'mL',
    'fl oz': 'fl oz', 'fl.oz': 'fl oz', 'fl. oz': 'fl oz',
  };
  const raw = attrMap.get('volume') || attrMap.get('size') || attrMap.get('volume_capacity') || '';
  const m = String(raw).match(VOLUME_PATTERN);
  if (!m) return null;
  const unitKey = m[2].toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
  const unit = UNIT_MAP[unitKey] || m[2];
  return { measure: parseFloat(m[1]), unit, raw: String(raw).trim() };
}

// Electronics terms for inferring col 77 (Product is or Contains an Electronic Component)
const ELECTRONIC_TERMS = /\b(ignition|sensor|relay|switch|module|ecu|ecm|actuator|solenoid|coil|alternator|starter|motor|controller|electronic|electrical|wiring|harness|fuse|circuit|bulb|led|light|lamp)\b/i;

/**
 * Build Material (col 50) from generic + product-specific material keys.
 * Joins all non-empty material values, semicolon-separated, deduped.
 */
function parseMaterial(attrMap, consumed) {
  const MATERIAL_KEYS = [
    'material', 'hose_material', 'pad_material', 'rotor_material',
    'disc_material', 'brake_pad_material', 'friction_material_composition',
    'system_material', 'muffler_material', 'media_material',
  ];
  const seen = new Set();
  const parts = [];
  for (const k of MATERIAL_KEYS) {
    const v = (attrMap.get(k) || '').trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      parts.push(v);
      if (consumed) consumed.add(k);
    }
  }
  const joined = parts.join('; ');
  return joined.slice(0, 1000);
}

/**
 * Resolve Condition (col 25) from the condition attribute.
 * Maps free-text values to Walmart-accepted: "New" | "Remanufactured" | "Used"
 * Only marks keys as consumed if they contributed to the result.
 */
function parseCondition(attrMap, consumed) {
  const raw = (attrMap.get('condition') || '').toLowerCase();
  if (raw && consumed) consumed.add('condition');
  if (!raw) return 'New'; // safe default
  if (/^used|pre.?own|pre-own/i.test(raw)) return 'Used';
  if (/^yes$/i.test(attrMap.get('remanufactured') || '')) {
    if (consumed) consumed.add('remanufactured');
    return 'Remanufactured';
  }
  return 'New';
}

/**
 * Resolve Vehicle Fitment Type (col 31).
 * Use attribute value when available; fall back to presence of fitment text.
 * Walmart accepts: "Vehicle Specific" | "Universal"
 */
function parseFitmentType(attrMap, hasVehicles) {
  const raw = firstAttr(attrMap, 'vehicle_fitment_type', 'part_fitment', 'fitment_type', 'fit', 'universal_fitment');
  if (raw) {
    const lower = raw.toLowerCase();
    if (/universal|all\s*vehicle|non.specific/i.test(lower)) return 'Universal';
    if (/specific|direct\s*fit|vehicle\s*specific/i.test(lower)) return 'Vehicle Specific';
  }
  return hasVehicles ? 'Vehicle Specific' : 'Universal';
}

/** Extract UPC if it looks valid (numeric, not "Not Applicable" / "N/A").
 *  Only marks the key as consumed if a valid UPC was extracted. */
function parseUpc(attrMap, consumed) {
  for (const key of ['upc', 'gtin']) {
    const raw = (attrMap.get(key) || '').trim();
    if (!raw || /not\s*applicable|n\/a|does\s*not\s*apply/i.test(raw)) continue;
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 8) {
      if (consumed) consumed.add(key);
      return digits;
    }
  }
  return '';
}

// ─── Fitment helpers ─────────────────────────────────────────────────────────

/**
 * Parse fitment lines like "2019 Freightliner Sprinter 3500 Base 3.0L 6cyl"
 * Returns { makes, models, years, compatibleCars }
 */
function parseFitment(raw) {
  if (!raw) return { makes: '', models: '', years: '', compatibleCars: '' };

  const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
  const makeSet  = new Set();
  const modelSet = new Set();
  const yearSet  = new Set();
  const cars     = [];

  for (const line of lines) {
    // Try to match "YEAR MAKE MODEL..."
    // Year: 4-digit number at start, possibly "YEAR1, YEAR2, YEAR3 Make Model"
    // Handle comma-separated year prefix: "2005, 2006, 2008 Dodge Ram 1500 ..."
    const commaYearMatch = line.match(/^([\d,\s]+)\s+(.+)$/);
    if (commaYearMatch) {
      const yearsPart = commaYearMatch[1];
      const rest      = commaYearMatch[2].trim();
      const ys = yearsPart.split(',').map(y => y.trim()).filter(y => /^\d{4}$/.test(y));
      if (ys.length > 0) {
        ys.forEach(y => yearSet.add(y));
        // Split rest into make + model (first word = make unless two-word like "Mercedes-Benz")
        const tokens = rest.split(/\s+/);
        const make   = tokens[0];
        const model  = tokens.slice(1, 3).join(' ').replace(/\s*([\d.]+L.*|[\d]+cyl.*)$/, '').trim();
        if (make)  makeSet.add(make);
        if (model) modelSet.add(model);
        ys.forEach(y => cars.push(`${make} ${model} ${y}`));
        continue;
      }
    }
    // Single-year line: "2019 Ford F-150 ..."
    const singleMatch = line.match(/^(\d{4})\s+(.+)$/);
    if (singleMatch) {
      const year   = singleMatch[1];
      const tokens = singleMatch[2].split(/\s+/);
      const make   = tokens[0];
      const model  = tokens.slice(1, 3).join(' ').replace(/\s*([\d.]+L.*|[\d]+cyl.*)$/, '').trim();
      yearSet.add(year);
      if (make)  makeSet.add(make);
      if (model) modelSet.add(model);
      cars.push(`${make} ${model} ${year}`);
    }
  }

  // Build semicolon lists; deduplicate and cap at 4000 chars
  let compatibleCars = [...new Set(cars)].join('; ');
  if (compatibleCars.length > 4000) compatibleCars = compatibleCars.slice(0, 3997) + '…';

  return {
    makes:          [...makeSet].join('; ').slice(0, 4000),
    models:         [...modelSet].join('; ').slice(0, 4000),
    years:          [...yearSet].join('; ').slice(0, 500),
    compatibleCars,
  };
}

// ─── FAB helpers ─────────────────────────────────────────────────────────────

/** Parse "Features & Benefits" numbered bullets → array of plain strings */
function parseFab(raw) {
  if (!raw) return [];
  return raw.split('\n')
    .map(l => l.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

// ─── Source streaming ─────────────────────────────────────────────────────────

async function readSource() {
  console.log('Reading source Excel (streaming)…');
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(SOURCE, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore',
  });

  const rows    = [];
  let headers   = null;
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
      if (dataRowNum > LIMIT) continue; // still drain the rest
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

  console.log(`  → ${rows.length} rows read`);
  return rows;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Read source rows
  const sourceRows = await readSource();

  // 2. Load template
  console.log('Loading template…');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);

  const ws = wb.getWorksheet('Product Content And Site Exp');
  if (!ws) {
    console.error('ERROR: Could not find "Product Content And Site Exp" sheet in template');
    process.exit(1);
  }
  console.log(`  → Template sheet found, ${ws.rowCount} existing rows`);

  // 3. Clear existing data rows (rows 6+) to avoid stale template placeholder content
  const DATA_START_ROW = 6;
  const lastRow = ws.rowCount;
  for (let r = DATA_START_ROW; r <= lastRow; r++) {
    const row = ws.getRow(r);
    row.eachCell({ includeEmpty: true }, cell => { cell.value = null; });
    row.commit();
  }
  console.log(`  → Cleared ${lastRow - DATA_START_ROW + 1} existing rows from template`);

  // 4. Map each source row → loadsheet row (cols 1–94, data starts at spreadsheet row 6)
  let written = 0;
  for (const src of sourceRows) {
    const attrMap = parseAttrs(src['attributes']);
    // Dynamic consumption tracking — only keys actually used by a mapper are marked consumed.
    // Unused fallback keys flow to the catch-all in parseAdditionalFeatures.
    const dynamicConsumed = new Set();

    const { main: mainImg, secondary: secImg } = parseImageUrls(attrMap, dynamicConsumed);
    const fab      = parseFab(src['Features & Benefits']);
    // fitment columns skipped per user request (cols 30/31/45/63/64/66)

    // Build 94-element column array (1-indexed; index 0 unused)
    const cols = new Array(95).fill('');

    // --- Required / core identity ---
    cols[4]  = String(src['Part Number'] || '');           // SKU
    cols[5]  = 'Automotive Specialty Parts';               // Spec Product Type
    cols[6]  = 'Part Number';                              // Product ID Type
    cols[7]  = String(src['Part Number'] || '');           // Product ID
    cols[8]  = (src['Title'] || '').slice(0, 199);         // Product Name (max 199)
    cols[9]  = (src['Brand'] || '').slice(0, 60);          // Brand Name
    // col 10 Selling Price — removed per user request
    cols[12] = (src['Description'] || '').slice(0, 100000);// Site Description
    cols[17] = mainImg;                                    // Main Image URL
    cols[19] = secImg;                                     // Additional Image URL 1
    cols[22] = 1;                                          // Multipack Quantity
    cols[24] = (src['Part Type'] || '').slice(0, 250);     // Automotive Specialty Part Type
    cols[25] = parseCondition(attrMap, dynamicConsumed);   // Condition (from attr, not hardcoded)
    cols[27] = String(src['Part Number'] || '');           // Manufacturer Part Number
    // col 31 Vehicle Fitment Type — skipped

    // --- Key Features (cols 13–16, 4 bullet slots) ---
    for (let i = 0; i < Math.min(fab.length, 4); i++) {
      cols[13 + i] = fab[i] ? fab[i].slice(0, 10000) : '';
    }

    // cols 45/63/64/66 — fitment fields skipped per user request

    // --- UPC / external product ID ---
    const upc = parseUpc(attrMap, dynamicConsumed);
    if (upc) {
      cols[2]  = upc;              // External Product ID (col 2 = externalProductId)
      cols[91] = upc;              // External Product ID (duplicate slot col 91)
      cols[90] = 'UPC';            // External Product ID Type
    }

    // --- Shipping weight (col 11) — prefer shipping_weight, fallback to weight ---
    const shippingWtRaw = firstAttrTracked(attrMap, dynamicConsumed, 'shipping_weight', 'weight');
    const shippingWt = parseLeadingNumber(shippingWtRaw);
    if (shippingWt !== '') cols[11] = shippingWt;

    // --- Assembled product dimensions ---
    // Depth (col 34 measure, 35 unit)
    const depthRaw = firstAttrTracked(attrMap, dynamicConsumed, 'package_depth', 'length');
    const depthVal = parseLeadingNumber(depthRaw);
    if (depthVal !== '') { cols[34] = depthVal; cols[35] = 'in'; }

    // Height (col 36 measure, 37 unit)
    const heightRaw = firstAttrTracked(attrMap, dynamicConsumed, 'package_height', 'height');
    const heightVal = parseLeadingNumber(heightRaw);
    if (heightVal !== '') { cols[36] = heightVal; cols[37] = 'in'; }

    // Weight (col 38 measure, 39 unit) — prefer "weight" attr, fallback shipping_weight
    const rawWeight = firstAttrTracked(attrMap, dynamicConsumed, 'weight');
    const weightVal = parseLeadingNumber(rawWeight);
    if (weightVal !== '') {
      cols[38] = weightVal;
      cols[39] = /kg/i.test(rawWeight) ? 'kg' : 'lbs';
    }

    // Width (col 40 measure, 41 unit)
    const widthRaw = firstAttrTracked(attrMap, dynamicConsumed, 'package_width', 'width');
    const widthVal = parseLeadingNumber(widthRaw);
    if (widthVal !== '') { cols[40] = widthVal; cols[41] = 'in'; }

    // --- Vehicle Mount Location (col 65) ---
    const mountLoc = firstAttrTracked(attrMap, dynamicConsumed, 'vehicle_mount_location', 'mount_location', 'mounting_location');
    if (mountLoc) cols[65] = mountLoc.slice(0, 4000);

    // --- Automotive parts division ---
    if (attrMap.has('automotive_part_division')) {
      cols[42] = (attrMap.get('automotive_part_division') || '').slice(0, 250);
      dynamicConsumed.add('automotive_part_division');
    }

    // --- Prop 65 ---
    const prop65Text = (attrMap.get('california_prop_65_warning') || '').trim();
    if (prop65Text) {
      cols[23] = 'Yes';            // Is Prop 65 Warning Required
      cols[43] = prop65Text.slice(0, 5000); // Prop 65 Warning Text
      dynamicConsumed.add('california_prop_65_warning');
    }

    // --- Has written warranty ---
    const writtenWarranty = (attrMap.get('has_written_warranty') || '').trim();
    if (writtenWarranty) {
      cols[26] = writtenWarranty;
      dynamicConsumed.add('has_written_warranty');
    }

    // --- Warranty text ---
    const warrantyText = parseWarranty(attrMap, dynamicConsumed);
    if (warrantyText) cols[67] = warrantyText.slice(0, 20000);

    // --- Attribute-sourced fields ---
    cols[44] = firstAttrTracked(attrMap, dynamicConsumed, 'color', 'color_finish', 'hose_color', 'caliper_color').slice(0, 600);
    // Col 46: Assembled Product Dimensions — build "D × H × W in" from package attrs
    const dimDepth  = parseLeadingNumber(firstAttrTracked(attrMap, dynamicConsumed, 'package_depth'));
    const dimHeight = parseLeadingNumber(firstAttrTracked(attrMap, dynamicConsumed, 'package_height'));
    const dimWidth  = parseLeadingNumber(firstAttrTracked(attrMap, dynamicConsumed, 'package_width'));
    if (dimDepth !== '' && dimHeight !== '' && dimWidth !== '') {
      cols[46] = `${dimDepth} x ${dimHeight} x ${dimWidth} in`;
    } else {
      cols[46] = firstAttrTracked(attrMap, dynamicConsumed, 'dimensions', 'dimension').slice(0, 4000);
    }
    cols[47] = firstAttrTracked(attrMap, dynamicConsumed, 'finish', 'rotor_finish').slice(0, 400);
    cols[48] = parseItemsIncluded(attrMap, dynamicConsumed);
    cols[49] = (src['Brand'] || '').slice(0, 60);       // Manufacturer Name
    cols[50] = parseMaterial(attrMap, dynamicConsumed);
    cols[51] = firstAttrTracked(attrMap, dynamicConsumed, 'manufacturer_s_part_number', 'model_number', 'model', 'vendor_part_number').slice(0, 60);
    const rawPieces = firstAttrTracked(attrMap, dynamicConsumed, 'number_of_piece', 'number_of_pieces');
    const digitsOnly = rawPieces.replace(/\D/g, '');
    cols[53] = digitsOnly || rawPieces; // keep textual values like "Sold as Set", "Pair"
    // Size: prefer explicit size; for tires build compound "225/55R17" string; fallback to thread_size
    const tireSize = (() => {
      const sw = attrMap.get('section_width'), ar = attrMap.get('aspect_ratio'), wd = attrMap.get('wheel_diameter');
      if (sw && ar && wd) {
        dynamicConsumed.add('section_width');
        dynamicConsumed.add('aspect_ratio');
        dynamicConsumed.add('wheel_diameter');
        return `${sw.replace(/\D/g, '')}/${ar.replace(/\D/g, '')}R${wd.replace(/[^\d.]/g, '')}`;
      }
      return '';
    })();
    const sizeVal = firstAttrTracked(attrMap, dynamicConsumed, 'size', 'tire_size');
    const threadVal = sizeVal ? '' : firstAttrTracked(attrMap, dynamicConsumed, 'thread_size');
    cols[59] = (sizeVal || tireSize || threadVal).slice(0, 500);

    // --- Net Content (cols 28/29/52) — fluids only ---
    const netContent = parseNetContent(attrMap);
    if (netContent) {
      cols[28] = netContent.measure;          // Net Content Measure
      cols[29] = netContent.unit;             // Net Content Unit
      cols[52] = netContent.raw.slice(0, 500);// Net Content Statement (free text)
      // Mark net-content source keys as consumed only on success
      for (const k of ['volume', 'volume_capacity', 'capacity', 'net_content', 'fluid_ounces']) {
        if (attrMap.has(k)) dynamicConsumed.add(k);
      }
    }

    // --- Electronics Indicator (col 77) — infer from Part Type / Title ---
    if (ELECTRONIC_TERMS.test(src['Part Type'] || '') || ELECTRONIC_TERMS.test(src['Title'] || '')) {
      cols[77] = 'Yes';
    }

    // --- Fulfillment Lag Time (col 80) ---
    const lagTime = firstAttrTracked(attrMap, dynamicConsumed, 'anticipated_ship_out_time', 'lead_time');
    if (lagTime) cols[80] = lagTime.slice(0, 200);

    // --- Quantity (col 87) ---
    const qty = firstAttrTracked(attrMap, dynamicConsumed, 'quantity', 'quantity_sold');
    if (qty) cols[87] = qty.slice(0, 200);

    // --- Automotive specialty part type: supplement from attr chain if Part Type is missing ---
    if (!cols[24]) {
      cols[24] = firstAttrTracked(attrMap, dynamicConsumed, 'automotive_specialty_part_type', 'sub_type', 'category', 'part_type', 'type', 'part', 'part_category').slice(0, 250);
    }

    // --- Additional Features (col 33) — catch-all with dynamic consumption ---
    const addlFeatures = parseAdditionalFeatures(attrMap, dynamicConsumed);
    if (addlFeatures) cols[33] = addlFeatures;

    // --- Condition: remanufactured=Yes overrides whatever parseCondition returned ---
    if (/^yes$/i.test(attrMap.get('remanufactured') || '')) {
      cols[25] = 'Remanufactured';
      dynamicConsumed.add('remanufactured');
    }

    // --- Write to specific row position (row 6 + index) ---
    const targetRowNum = DATA_START_ROW + written;
    const targetRow = ws.getRow(targetRowNum);
    for (let c = 1; c <= 94; c++) {
      if (cols[c] !== '') targetRow.getCell(c).value = normalizeText(cols[c]);
    }
    targetRow.commit();
    written++;
  }

  console.log(`  → ${written} rows written`);

  // 4. Save
  console.log(`Saving to: ${OUT}`);
  await wb.xlsx.writeFile(OUT);
  console.log('✓ Done');
}

main().catch(err => { console.error(err); process.exit(1); });
