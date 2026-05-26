#!/usr/bin/env node
/**
 * 51-triage-extra-cols.js
 *
 * For each of the 13 "recommended to improve search and browse" cols (42-54)
 * in the Walmart loadsheet template, audit availability across:
 *   1. v9 walmart-loadsheet-filled-v9.xlsx (the prior pipeline's output)
 *   2. source.attributes (already in 01-acdelco-source.json)
 *   3. Full Scrape (fullscrape-by-mpn-acdelco.json)
 *   4. Enhanced Content (enhanced-content-by-mpn.json)
 *
 * For each column:
 *   - count of ACDelco MPNs with a value, per source
 *   - 5 sample (mpn → value) pairs from the strongest source
 *   - heuristic verdict: does the value make qualitative sense for that column?
 *
 * No data into Claude context — only summary printed.
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', 'data');
const SCRIPTS_ROOT = path.join(__dirname, '..', '..');
const V9 = path.join(SCRIPTS_ROOT, 'walmart-loadsheet-filled-v9.xlsx');

const SOURCE = JSON.parse(fs.readFileSync(path.join(D, '01-acdelco-source.json'), 'utf8'));
const SCRAPE = JSON.parse(fs.readFileSync(path.join(D, 'fullscrape-by-mpn-acdelco.json'), 'utf8'));
const ENH    = JSON.parse(fs.readFileSync(path.join(D, 'enhanced-content-by-mpn.json'), 'utf8'));
const ACDELCO_MPNS = new Set(SOURCE.map(r => r.mpn));

// Column inventory we're auditing (col # → {label, attrKeys, scrapeKeys, sanityCheck})
const TARGETS = [
  { col: 42, label: 'Automotive Parts Division',    attrKeys: ['automotive_part_division','automotive_parts_division','part_division','division'],
                                                    scrapeKeys: ['automotive_part_division','automotive_parts_division','division','sub_type'],
                                                    sanity: v => /^[A-Za-z &/-]{3,80}$/.test(v) ? 'plausible category text' : 'check format' },
  { col: 43, label: 'California Prop 65 Warning Text', attrKeys: ['prop_65_warning','prop65_warning','prop_65_warning_text','california_prop_65','prop65','prop_65'],
                                                    scrapeKeys: ['prop_65_warning','prop65_warning','prop_65_warning_text','california_prop_65','prop_65','prop65'],
                                                    sanity: v => /warn|prop|cancer|reproduct/i.test(v) ? 'looks like a Prop 65 statement' : 'unrelated' },
  { col: 44, label: 'Color',                        attrKeys: ['color','color_finish','bulb_color','frame_color','hose_color','caliper_color'],
                                                    scrapeKeys: ['color','color_finish','bulb_color'],
                                                    sanity: v => /^[A-Za-z][A-Za-z /-]{1,40}$/.test(v) ? 'plausible color name' : 'odd token' },
  { col: 45, label: 'Compatible Vehicles (+)',      attrKeys: [], scrapeKeys: ['compatible_make_s','compatible_model_s','fitment','fitment_compatible','compatible_with'],
                                                    sanity: v => /\d{4}|chevrolet|ford|gm|chrysler|toyota|honda|jeep|cadillac|buick|gmc/i.test(v) ? 'mentions year/make' : 'no vehicle reference' },
  { col: 46, label: 'Dimensions (free text)',       attrKeys: ['dimensions','overall_dimensions','package_dimensions'],
                                                    scrapeKeys: ['dimensions','overall_dimensions','package_dimensions'],
                                                    sanity: v => /\d.*(in|mm|cm|x|×)/i.test(v) ? 'looks dimensional' : 'no measurement tokens' },
  { col: 47, label: 'Finish',                       attrKeys: ['finish','finish_type','surface_finish','coating'],
                                                    scrapeKeys: ['finish','finish_type','surface_finish','coating'],
                                                    sanity: v => /chrome|paint|powder|black|polish|anod|coat|nickel|zinc|raw|unfin/i.test(v) ? 'finish-like term' : 'odd' },
  { col: 48, label: 'Items Included (+)',           attrKeys: ['items_included','part_included','what_is_included','contents','kit_contents','includes'],
                                                    scrapeKeys: ['items_included','part_included','what_is_included','contents','kit_contents','includes'],
                                                    sanity: v => /\d|kit|set|piece|bolt|gasket|seal|with|includ/i.test(v) ? 'plausible inclusion list' : 'unclear' },
  { col: 49, label: 'Manufacturer Name',            attrKeys: ['manufacturer','manufacturer_name','brand','manufacturer_s_part_number'],
                                                    scrapeKeys: ['manufacturer','manufacturer_name','brand'],
                                                    sanity: v => /^[A-Za-z &-]{2,40}$/.test(v) ? 'plausible mfr name' : 'check format' },
  { col: 50, label: 'Material (+)',                 attrKeys: ['material','primary_material','body_material','casing_material','casting_material','outer_sleeve_material','frame_material'],
                                                    scrapeKeys: ['material','primary_material','body_material','casting_material','outer_sleeve_material'],
                                                    sanity: v => /steel|aluminum|brass|rubber|plastic|polymer|copper|cast|alloy|epdm|silicone|nitrile|nylon|ceramic/i.test(v) ? 'material term' : 'odd' },
  { col: 51, label: 'Model Number',                 attrKeys: ['model_number','oe_part_number','oem_part_number','oem_interchange_number','part_number','alternate_inventory_number'],
                                                    scrapeKeys: ['model_number','oe_part_number','oem_part_number','part_number'],
                                                    sanity: v => /^[A-Za-z0-9-]{3,30}$/.test(v) ? 'plausible model/part #' : 'check format' },
  { col: 52, label: 'Net Content Statement',        attrKeys: ['net_content','net_contents','net_quantity','quantity','quantity_per_pack'],
                                                    scrapeKeys: ['net_content','quantity','quantity_per_pack'],
                                                    sanity: v => /\d/.test(v) ? 'has numeric content' : 'no number' },
  { col: 53, label: 'Number of Pieces',             attrKeys: ['piece_count','number_of_pieces','quantity','count','pack_quantity','pack_size'],
                                                    scrapeKeys: ['piece_count','number_of_pieces','quantity'],
                                                    sanity: v => /^\d+$/.test(String(v).trim()) ? 'integer count' : 'non-integer' },
  { col: 54, label: 'Occasion (+)',                 attrKeys: [], scrapeKeys: [],
                                                    sanity: () => 'irrelevant for auto parts' },
];

const COL = (c) => c; // for clarity

// 1) Read v9, build mpn → row of cols 42-54
async function readV9() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(V9);
  const ws = wb.getWorksheet('Product Content And Site Exp');
  const out = {};
  for (let r = 6; r <= ws.rowCount; r++) {
    const mpn = ws.getRow(r).getCell(27).value;
    const mpnStr = mpn == null ? '' : (mpn.text != null ? mpn.text : String(mpn));
    if (!ACDELCO_MPNS.has(mpnStr)) continue;
    const cells = {};
    for (let c = 42; c <= 54; c++) {
      const v = ws.getRow(r).getCell(c).value;
      cells[c] = v == null ? '' : (v.text != null ? v.text : String(v));
    }
    out[mpnStr] = cells;
  }
  return out;
}

(async () => {
  const v9 = await readV9();

  console.log(`v9 ACDelco rows found: ${Object.keys(v9).length} of ${ACDELCO_MPNS.size}\n`);

  for (const t of TARGETS) {
    console.log(`──── col ${t.col}: ${t.label} ────`);

    // From v9 (existing fill)
    const v9Filled = Object.entries(v9).filter(([m, cells]) => String(cells[t.col]).trim() !== '');
    console.log(`  v9 filled:      ${v9Filled.length} / ${ACDELCO_MPNS.size}`);
    if (v9Filled.length) {
      const sample = v9Filled.slice(0, 5);
      sample.forEach(([m, c]) => {
        const v = String(c[t.col]).slice(0, 70);
        const verdict = t.sanity(v);
        console.log(`     ${m.padEnd(15)} "${v}"  [${verdict}]`);
      });
    }

    // From source.attributes
    const srcHits = [];
    for (const r of SOURCE) {
      for (const k of t.attrKeys) {
        if (r.attributes[k]) { srcHits.push({ mpn: r.mpn, key: k, val: r.attributes[k] }); break; }
      }
    }
    console.log(`  source.attrs:   ${srcHits.length} / ${SOURCE.length}`);
    if (srcHits.length) {
      srcHits.slice(0, 5).forEach(h => {
        const v = String(h.val).slice(0, 70);
        const verdict = t.sanity(v);
        console.log(`     ${h.mpn.padEnd(15)} ${h.key}=${v}  [${verdict}]`);
      });
    }

    // From scrape
    const scrapeHits = [];
    for (const mpn of ACDELCO_MPNS) {
      const e = SCRAPE[mpn];
      if (!e) continue;
      for (const k of t.scrapeKeys) {
        if (e.byKey[k]?.[0]?.value) { scrapeHits.push({ mpn, key: k, val: e.byKey[k][0].value }); break; }
      }
    }
    console.log(`  scrape:         ${scrapeHits.length} / ${ACDELCO_MPNS.size}`);
    if (scrapeHits.length) {
      scrapeHits.slice(0, 5).forEach(h => {
        const v = String(h.val).slice(0, 70);
        const verdict = t.sanity(v);
        console.log(`     ${h.mpn.padEnd(15)} ${h.key}=${v}  [${verdict}]`);
      });
    }

    console.log('');
  }

  // ─── Bonus: scan source attributes for any other keys we're not currently using ───
  console.log(`\n${'─'.repeat(78)}\nBONUS: top source.attributes keys we're NOT using yet\n${'─'.repeat(78)}`);
  const allKeysCount = {};
  for (const r of SOURCE) {
    for (const k of Object.keys(r.attributes)) {
      allKeysCount[k] = (allKeysCount[k] || 0) + 1;
    }
  }
  const usedKeys = new Set([
    'wattage','voltage','length_in','length','length_mm','height_in','height','height_mm',
    'weight_lb','weight','weight_kg','weight_oz','width_in','width','width_mm',
    'thickness_in','thickness_mm','overall_cable_length',
    ...TARGETS.flatMap(t => t.attrKeys),
    'oem_interchange_number','alternate_inventory_number','upc','mpn'
  ]);
  const candidates = Object.entries(allKeysCount)
    .filter(([k]) => !usedKeys.has(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);
  candidates.forEach(([k, c]) => {
    // sample one value
    const samp = SOURCE.find(r => r.attributes[k]);
    console.log(`  ${String(c).padStart(3)} mpns  ${k.padEnd(35)} sample: ${String(samp?.attributes[k] || '').slice(0, 60)}`);
  });
})().catch(e => { console.error(e); process.exit(1); });
