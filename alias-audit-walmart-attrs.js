#!/usr/bin/env node
/**
 * alias-audit-walmart-attrs.js
 * Streams the enhancement Excel, collects every attribute key with
 * diverse sample values and co-occurrence data, then emits a full
 * alias / semantic-duplicate report.
 *
 * Output: alias-audit-report.md  (also printed to stdout)
 */
'use strict';

const ExcelJS = require('exceljs');
const fs      = require('fs');
const path    = require('path');

const SOURCE = path.join(process.env.HOME, 'Downloads',
  'export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx');
const OUT = path.join(__dirname, 'alias-audit-report.md');

const TOTAL_ROWS = 1252;

// ── Collect stats ────────────────────────────────────────────────────────────

async function collect() {
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(SOURCE, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore',
  });

  // key → { count, values: Map<normalised-value, rawSample> }
  const stats   = new Map();
  let headers   = null;

  for await (const ws of workbook) {
    if (ws.id != 1) { for await (const _ of ws) {} continue; }
    for await (const row of ws) {
      const vals = row.values.slice(1);
      if (!headers) {
        headers = vals.map(v => (v && typeof v === 'object' && v.text) ? v.text : String(v ?? ''));
        continue;
      }
      const attrIdx = headers.indexOf('attributes');
      const raw = vals[attrIdx];
      const attrStr = (raw && typeof raw === 'object' && raw.text) ? raw.text : String(raw || '');

      for (const part of attrStr.split('|')) {
        const colon = part.indexOf(':');
        if (colon === -1) continue;
        const k = part.slice(0, colon).trim().toLowerCase().replace(/\s+/g, '_');
        const v = part.slice(colon + 1).trim();
        if (!k || !v) continue;

        if (!stats.has(k)) stats.set(k, { count: 0, values: new Map() });
        const s = stats.get(k);
        s.count++;
        // Keep up to 5 diverse samples (use normalised lowercase as dedup key)
        const norm = v.toLowerCase().slice(0, 40);
        if (s.values.size < 5 && !s.values.has(norm)) s.values.set(norm, v.slice(0, 80));
      }
    }
  }

  return stats;
}

// ── Semantic group definitions ────────────────────────────────────────────────

const GROUPS = [
  {
    name: 'Part Number / SKU / ID',
    loadsheetCol: 'col 27 MPN, col 2 External Product ID',
    keys: ['part_number', 'mpn', 'manufacturer_s_part_number', 'model_number',
           'model', 'vendor_part_number', 'oem_interchange_number',
           'interchange_part_number', 'oe_oem_part_number', 'other_part_number',
           'replace_oe_number', 'summit_racing_part_number', 'alternate_inventory_number',
           'retailer_id', 'vmrs_code', 'unspsc', 'industrial_description',
           'cross_reference_napa', 'mfr_code', 'superseded_part_number',
           'ebay_id_epid', 'gtin'],
  },
  {
    name: 'Product Line / Series / Type Name',
    loadsheetCol: 'col 33 Additional Features (or no direct target)',
    keys: ['line', 'sery', 'style', 'type', 'sub_type', 'series',
           'grade_type', 'class', 'duty_type', 'specialty_part',
           'part_name', 'part_category', 'part', 'category'],
  },
  {
    name: 'Part / Product Type (Automotive)',
    loadsheetCol: 'col 24 Automotive Specialty Part Type',
    keys: ['part_type', 'automotive_specialty_part_type', 'automotive_wiper_blade_design',
           'sub_type', 'category', 'part_category', 'part'],
  },
  {
    name: 'Warranty',
    loadsheetCol: 'col 67 Warranty Text',
    keys: ['warranty', 'manufacturer_warranty', 'warranty_information',
           'has_written_warranty'],
  },
  {
    name: 'Vehicle Fitment Type',
    loadsheetCol: 'col 31 Vehicle Fitment Type',
    keys: ['vehicle_fitment_type', 'part_fitment', 'fitment_type',
           'fit', 'universal_fitment', 'recommended_use'],
  },
  {
    name: 'Vehicle Mount / Position on Vehicle',
    loadsheetCol: 'col 65 Vehicle Mount Location',
    keys: ['vehicle_mount_location', 'placement_on_vehicle', 'position',
           'location', 'exit_location'],
  },
  {
    name: 'Package / Assembled Dimensions',
    loadsheetCol: 'cols 34-41 Assembled Product Depth/Height/Weight/Width',
    keys: ['package_depth', 'package_height', 'package_width',
           'length', 'height', 'width',
           'length_in', 'width_in', 'height_in',
           'outside_circumference', 'centerline_length',
           'end_1_inside_diameter', 'end_2_inside_diameter',
           'outside_diameter', 'inside_diameter',
           'outer_diameter_top', 'outer_diameter_bottom',
           'effective_length', 'top_width', 'thread_size',
           'outer_diameter', 'diameter_interior'],
  },
  {
    name: 'Weight',
    loadsheetCol: 'col 11 Shipping Weight, col 38-39 Assembled Weight',
    keys: ['weight', 'shipping_weight'],
  },
  {
    name: 'Color',
    loadsheetCol: 'col 44 Color',
    keys: ['color', 'color_family', 'color_finish', 'hose_color',
           'caliper_color', 'housing_color', 'lens_color'],
  },
  {
    name: 'Material',
    loadsheetCol: 'col 50 Material',
    keys: ['material', 'hose_material', 'media_material', 'pad_material',
           'rotor_material', 'brake_pad_material', 'disc_material',
           'friction_material_composition', 'friction_material_name', 'brake_pad_construction'],
  },
  {
    name: 'Finish / Surface Treatment',
    loadsheetCol: 'col 47 Finish',
    keys: ['finish', 'rotor_finish', 'surface_type'],
  },
  {
    name: 'Country of Origin',
    loadsheetCol: '(no direct loadsheet column)',
    keys: ['country_of_origin', 'country_of_origin_primary'],
  },
  {
    name: 'Feature / Note / Application Text',
    loadsheetCol: 'col 33 Additional Features',
    keys: ['feature', 'key_feature', 'feature_benefit', 'note',
           'application_summary', 'compatibility', 'fitnote',
           'performance_part', 'genuine_oem'],
  },
  {
    name: 'Items / Hardware Included',
    loadsheetCol: 'col 48 Items Included',
    keys: ['items_included', 'item_included', 'include', 'package_content',
           'hardware_included', 'mounting_hardware_included',
           'gasket_included', 'shim_included', 'pad_shim_included',
           'abutment_clip_included', 'brake_lubricant_included',
           'electronic_wear_sensor_included', 'pad_wear_sensor_included',
           'wiring_harness_included', 'hose_adapter_included',
           'hose_clamp_included', 'hose_clamp_cover_included',
           'mounting_bracket_included', 'pulley_included',
           'sending_unit_included', 'fuel_pressure_regulator_included'],
  },
  {
    name: 'Vehicle Make',
    loadsheetCol: 'col 63 Vehicle Make',
    keys: ['vehicle_make', 'make', 'compatible_make_s'],
  },
  {
    name: 'Vehicle Model',
    loadsheetCol: 'col 64 Vehicle Model',
    keys: ['vehicle_model', 'compatible_model_s'],
  },
  {
    name: 'Quantity / Pack Count',
    loadsheetCol: 'col 22 Multipack Qty, col 53 Number of Pieces',
    keys: ['quantity', 'quantity_sold', 'number_of_piece', 'number_of_pieces',
           'outlet_quantity', 'inlet_quantity', 'count_per_pack'],
  },
  {
    name: 'Size / Dimensions (single value)',
    loadsheetCol: 'col 59 Size, col 46 Dimensions',
    keys: ['size', 'dimensions', 'tire_size', 'wheel_diameter',
           'section_width', 'aspect_ratio', 'tire_diameter',
           'angle', 'pressure_min', 'pressure_max'],
  },
  {
    name: 'Tire / Wheel Attributes',
    loadsheetCol: 'col 33 Additional Features or col 59 Size',
    keys: ['tire_size', 'wheel_diameter', 'section_width', 'aspect_ratio',
           'tire_diameter', 'tread_depth', 'load_index', 'speed_index',
           'tire_construction', 'tire_weather_usage', 'sidewall_style',
           'max_load_single_lbs', 'maximum_recommended_wheel_width',
           'minimum_recommended_wheel_width', 'run_flat_technology',
           'studdable_winter_tire', 'stiff_sidewall', 'asymmetrical_tread_pattern',
           'severe_snow_rated_3pmsf', 'directional', 'dot_approved',
           'tube_required', 'outside_circumference', 'pressure_max', 'pressure_min'],
  },
  {
    name: 'Brake-Specific Attributes',
    loadsheetCol: 'col 33 Additional Features / col 50 Material',
    keys: ['rotor_style', 'rotor_material', 'rotor_finish', 'front_rotor_construction',
           'disc_material', 'disc_diameter', 'disc_design',
           'pad_material', 'brake_pad_material', 'brake_pad_construction',
           'friction_material_composition', 'friction_material_name',
           'caliper_type', 'caliper_color', 'for_use_with_stock_caliper',
           'intended_for_street_use', 'brake_lubricant_included',
           'electronic_wear_sensor_included', 'pad_wear_sensor_included',
           'abutment_clip_included', 'shim_included', 'pad_shim_included',
           'numberof_lugs', 'number_of_lugs'],
  },
  {
    name: 'Fuel / Pump Attributes',
    loadsheetCol: 'col 33 Additional Features',
    keys: ['fuel_pump_type', 'fuel_pressure_regulator_included',
           'flow_rate', 'flow_rate_min', 'sending_unit_included',
           'voltage'],
  },
  {
    name: 'Hose Attributes',
    loadsheetCol: 'col 33 Additional Features / col 50 Material',
    keys: ['hose_material', 'hose_color', 'hose_type', 'hose_adapter_included',
           'hose_clamp_included', 'hose_clamp_cover_included',
           'end_1_inside_diameter', 'end_2_inside_diameter', 'centerline_length'],
  },
  {
    name: 'Condition / Remanufactured',
    loadsheetCol: 'col 25 Condition',
    keys: ['condition', 'remanufactured', 'genuine_oem'],
  },
  {
    name: 'Prop 65 / Compliance',
    loadsheetCol: 'col 23 Is Prop 65 Required, col 43 Prop 65 Text',
    keys: ['california_prop_65_warning'],
  },
  {
    name: 'Shipping / Logistics',
    loadsheetCol: 'col 11 Shipping Weight',
    keys: ['shipping_weight', 'shipping', 'return', 'estimated_ship_date',
           'anticipated_ship_out_time', 'availability', 'rec_use'],
  },
  {
    name: 'Pricing',
    loadsheetCol: 'col 10 Selling Price',
    keys: ['price', 'currency', 'price_currency', 'core_charge', 'msrp'],
  },
  {
    name: 'Automotive Parts Division',
    loadsheetCol: 'col 42 Automotive Parts Division',
    keys: ['automotive_part_division', 'part_fitment'],
  },
];

// ── Report builder ────────────────────────────────────────────────────────────

function buildReport(stats) {
  const lines = [];
  lines.push('# Walmart Attribute Alias Audit Report');
  lines.push(`**Source rows:** ${TOTAL_ROWS} | **Generated:** ${new Date().toISOString().slice(0,10)}\n`);
  lines.push('Each group shows attribute keys that encode the same semantic data.');
  lines.push('Coverage = % of rows where the key appears (>100% means multiple per row).\n');
  lines.push('---\n');

  // Track which keys we've covered
  const coveredKeys = new Set();

  for (const group of GROUPS) {
    const presentKeys = group.keys.filter(k => stats.has(k));
    if (presentKeys.length === 0) continue;

    lines.push(`## ${group.name}`);
    lines.push(`**Loadsheet target:** ${group.loadsheetCol}`);
    lines.push(`**Keys in dataset:** ${presentKeys.length} of ${group.keys.length} defined\n`);

    lines.push('| Key | Coverage | Sample values |');
    lines.push('|-----|----------|---------------|');

    for (const k of presentKeys) {
      const s = stats.get(k);
      const pct = ((s.count / TOTAL_ROWS) * 100).toFixed(1);
      const samples = [...s.values.values()].join(' · ');
      lines.push(`| \`${k}\` | ${pct}% (${s.count}) | ${samples} |`);
      coveredKeys.add(k);
    }

    const absentKeys = group.keys.filter(k => !stats.has(k));
    if (absentKeys.length > 0) {
      lines.push(`\n*Not present in dataset: ${absentKeys.map(k => `\`${k}\``).join(', ')}*`);
    }
    lines.push('');
  }

  // Uncategorised keys
  const uncovered = [...stats.entries()]
    .filter(([k]) => !coveredKeys.has(k))
    .sort((a, b) => b[1].count - a[1].count);

  if (uncovered.length > 0) {
    lines.push('## Uncategorised Keys (no group assigned)');
    lines.push('| Key | Coverage | Sample values |');
    lines.push('|-----|----------|---------------|');
    for (const [k, s] of uncovered) {
      const pct = ((s.count / TOTAL_ROWS) * 100).toFixed(1);
      const samples = [...s.values.values()].join(' · ');
      lines.push(`| \`${k}\` | ${pct}% (${s.count}) | ${samples} |`);
    }
    lines.push('');
  }

  // Consolidation recommendations
  lines.push('---\n');
  lines.push('## Consolidation Recommendations\n');
  lines.push('These are the highest-value aliases to collapse in the fill script:\n');

  const recs = [
    { priority: '★★★', field: 'Vehicle Mount Location (col 65)',
      reason: '`placement_on_vehicle` (12.7%) and `position` (5.7%) alias `vehicle_mount_location` (7.3%). Combine all three — net coverage ~18%.',
      action: 'Add `placement_on_vehicle` + `position` to `firstAttr` fallback chain — **already done in v2**.' },
    { priority: '★★★', field: 'Items Included (col 48)',
      reason: '20+ "X_included" boolean keys (hardware_included, gasket_included, shim_included, etc.) plus item_included, include, package_content all describe what\'s in the box.',
      action: 'Collect all `*_included` keys where value is "Yes" or "No" and build a human-readable list: e.g. "Hardware: Yes, Gasket: Yes, Shim: No".' },
    { priority: '★★★', field: 'Material (col 50)',
      reason: '`hose_material`, `pad_material`, `rotor_material`, `disc_material`, `brake_pad_material`, `friction_material_composition` are all material-type values.',
      action: 'Build a merged material string from all material-type keys present, semicolon-joined.' },
    { priority: '★★', field: 'Additional Features (col 33)',
      reason: '`feature`, `note`, `application_summary`, `key_feature`, `feature_benefit`, `compatibility`, `fitnote` all carry freeform feature text.',
      action: 'Already combining some — add `fitnote` and `compatibility` to the merge list.' },
    { priority: '★★', field: 'Model Number (col 51)',
      reason: '`model`, `model_number`, `manufacturer_s_part_number`, `vendor_part_number` all describe identifiers that could fill Model Number.',
      action: 'Current fallback chain is `manufacturer_s_part_number` → `model_number` → `model`. Add `vendor_part_number` at end.' },
    { priority: '★★', field: 'Size / Dimensions (cols 46, 59)',
      reason: '`size`, `dimensions` are distinct but `tire_size`, `wheel_diameter`, `thread_size`, `section_width` are all size-type values for specific product categories.',
      action: 'For tires: build a compound string from section_width + aspect_ratio + wheel_diameter. For other products: fall back to `thread_size` or `outside_diameter`.' },
    { priority: '★', field: 'Product Line (col 33 Additional Features)',
      reason: '`line` (49.9%), `sery` (18.9%), `style` (10.6%), `type` (52%), `sub_type` (21%) all describe the product line/series name.',
      action: 'Add these as supplemental content to col 33 Additional Features with a "Series: X" prefix.' },
    { priority: '★', field: 'Country of Origin',
      reason: '`country_of_origin` (49.8%) and `country_of_origin_primary` (22.5%) are aliases. No loadsheet column, but useful for compliance notes.',
      action: 'No action needed unless a Prop 65 / compliance column is added.' },
  ];

  for (const r of recs) {
    lines.push(`### ${r.priority} ${r.field}`);
    lines.push(`**Why:** ${r.reason}`);
    lines.push(`**Action:** ${r.action}\n`);
  }

  return lines.join('\n');
}

async function main() {
  console.log('Streaming source data…');
  const stats = await collect();
  console.log(`  → ${stats.size} unique attribute keys found`);

  const report = buildReport(stats);
  fs.writeFileSync(OUT, report);
  console.log(`\n✓ Report written to ${OUT}`);
  // Also print to stdout
  console.log('\n' + report);
}

main().catch(err => { console.error(err); process.exit(1); });
