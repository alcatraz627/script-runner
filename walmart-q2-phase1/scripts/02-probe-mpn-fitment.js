#!/usr/bin/env node
/**
 * Cross-reference 5 sample MPNs against every available source:
 *   - source enhancement export
 *   - 5 reference workbooks (Brand Mapping, Enhanced Content, Taxonomy,
 *     VCdb Mapping, Full Scrape)
 *   - vf intermediate `02-{brand}-filled.json`
 *
 * For each MPN, report which sheets contain a row + which columns carry
 * fitment-relevant data (Year/Make/Model/SubModel/Cylinders/Liter/CC/
 * FuelType/Aspiration/DriveType/BodyType/BodyNumDoors/Position).
 *
 * Output: walmart-q2-phase1/data/_mpn-fitment-probe.json + console summary.
 *
 * Avoids string ops on compatibleCars — we want to find structured sources
 * for Q2 cols 4-21 (Year, Make, Model, engine, body).
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME;
const REF_DIR = `${HOME}/Downloads/Walmart Reference`;
const SOURCE_XLSX = `${HOME}/Downloads/export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx`;

// Toggle large workbooks via env: PROBE_LARGE=1 to include VCdb + Full Scrape.
// Default is fast (small refs only).
const INCLUDE_LARGE = process.env.PROBE_LARGE === '1';
const REFS = {
  brandMapping: `${REF_DIR}/Walmart_Brand Mapping_vf.xlsx`,
  enhancedContent: `${REF_DIR}/Walmart_Enhanced Content_vf.xlsx`,
  taxonomy: `${REF_DIR}/Walmart_Taxonomy Mapping_vf.xlsx`,
  ...(INCLUDE_LARGE ? {
    vcdbMapping: `${REF_DIR}/Walmart_VCdb Mapping_vf.xlsx`,
    fullScrape: `${REF_DIR}/Walmart_Full Scrape_ vf.xlsx`,
  } : {}),
};

const MPNS = [
  { brand: 'acdelco', mpn: 'L97' },
  { brand: 'dorman', mpn: '639-033' },
  { brand: 'holley', mpn: '302-3BK' },
  { brand: 'dayco', mpn: '95172' },
  // pick a 5th — Dorman has the richest fitment data per vf; pick one with deep fitment
  { brand: 'dorman', mpn: '903-103' },
];

// Headers we care about (case-insensitive, partial match)
const FITMENT_KEYS = [
  'mpn', 'manufacturer', 'part number', 'part_number',
  'year', 'make', 'model', 'submodel', 'sub_model', 'sub model',
  'blocktype', 'block_type', 'block type',
  'cylinder', 'liter', 'liters', 'displacement', 'cc',
  'position', 'mount',
  'fuel', 'aspiration',
  'drive', 'drivetype', 'drive_type', 'drive type',
  'bed', 'body', 'doors', 'door',
  'brand', 'aaia', 'part term', 'partterm', 'terminology', 'pcdb',
  'category', 'subcategory', 'sub category', 'spec product type', 'product type',
];

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text);
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.result != null) return String(v.result);
    if (v.formula) return `[formula]`;
    if (v.hyperlink) return String(v.hyperlink);
  }
  return String(v);
}

function looksFitmentish(headerName) {
  if (!headerName) return false;
  const lc = String(headerName).toLowerCase();
  return FITMENT_KEYS.some(k => lc.includes(k));
}

async function findMpnRowsInWorkbook(wbPath, mpns) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(wbPath);
  const results = {};
  wb.eachSheet((ws) => {
    // Find headers — try row 1, fall back to row 2
    let headerRow = 1;
    let headers = ws.getRow(1).values.slice(1).map(cellText);
    if (headers.filter(Boolean).length < 2) {
      headerRow = 2;
      headers = ws.getRow(2).values.slice(1).map(cellText);
    }

    // Find MPN column
    const mpnColIdx = headers.findIndex(h => /^(manufacturer.*part.*number|part.*number|mpn|partnumber)$/i.test((h || '').trim()));
    if (mpnColIdx < 0) return;

    const fitmentColIdxs = headers
      .map((h, i) => looksFitmentish(h) ? i : -1)
      .filter(i => i >= 0);

    const matches = {};
    for (let r = headerRow + 1; r <= ws.actualRowCount; r++) {
      const row = ws.getRow(r);
      const cellMpn = cellText(row.getCell(mpnColIdx + 1).value).trim();
      const hit = mpns.find(m => m.mpn === cellMpn);
      if (!hit) continue;
      if (!matches[hit.mpn]) matches[hit.mpn] = [];
      const row_summary = {};
      for (const ci of fitmentColIdxs) {
        const val = cellText(row.getCell(ci + 1).value).trim();
        if (val) row_summary[headers[ci]] = val;
      }
      matches[hit.mpn].push({ row: r, fields: row_summary });
    }

    if (Object.keys(matches).length) {
      results[ws.name] = {
        headerRow,
        headers,
        fitmentColIdxs: fitmentColIdxs.map(i => ({ idx: i + 1, name: headers[i] })),
        matches,
      };
    }
  });
  return results;
}

(async () => {
  const report = { probedAt: new Date().toISOString(), mpns: MPNS, sources: {} };
  const allFiles = { source: SOURCE_XLSX, ...REFS };

  for (const [label, fp] of Object.entries(allFiles)) {
    if (!fs.existsSync(fp)) {
      report.sources[label] = { error: 'missing', path: fp };
      console.log(`[skip] ${label}: ${fp} (missing)`);
      continue;
    }
    const sizeMB = (fs.statSync(fp).size / 1024 / 1024).toFixed(1);
    const t0 = Date.now();
    console.log(`[scan] ${label}: ${path.basename(fp)} (${sizeMB}MB) ...`);
    try {
      const res = await findMpnRowsInWorkbook(fp, MPNS);
      report.sources[label] = { path: fp, sheets: res };
      console.log(`       done in ${((Date.now() - t0) / 1000).toFixed(1)}s · sheets w/ matches=${Object.keys(res).length}`);
    } catch (e) {
      report.sources[label] = { error: e.message, path: fp };
      console.log(`       error: ${e.message}`);
    }
    // Incremental write so we don't lose data on long runs
    const OUT_INC = 'walmart-q2-phase1/data/_mpn-fitment-probe.json';
    fs.mkdirSync(path.dirname(OUT_INC), { recursive: true });
    fs.writeFileSync(OUT_INC, JSON.stringify(report, null, 2));
  }

  // Also pull from vf-filled JSON
  report.sources.vfFilled = { sheets: {} };
  for (const { brand, mpn } of MPNS) {
    try {
      const f = JSON.parse(fs.readFileSync(`walmart-vf/data/02-${brand}-filled.json`));
      const row = f.find(r => r.mpn === mpn);
      if (row && row.cells) {
        const cells = {};
        for (const [k, v] of Object.entries(row.cells)) {
          if (v && v.value) cells[k] = { value: String(v.value).slice(0, 200), source: v.source };
        }
        if (!report.sources.vfFilled.sheets[brand]) report.sources.vfFilled.sheets[brand] = { matches: {} };
        report.sources.vfFilled.sheets[brand].matches[mpn] = [{ row: null, fields: cells }];
      }
    } catch (e) { /* skip */ }
  }

  const OUT = 'walmart-q2-phase1/data/_mpn-fitment-probe.json';
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\nWrote: ${OUT}`);

  // Concise summary table
  console.log('\n=== AVAILABILITY MATRIX ===\n');
  console.log('MPN'.padEnd(12), 'Source'.padEnd(18), 'Sheet'.padEnd(34), 'fitment-ish cols (#)');
  console.log('-'.repeat(90));
  for (const m of MPNS) {
    for (const [srcName, src] of Object.entries(report.sources)) {
      if (!src.sheets) continue;
      for (const [shName, sh] of Object.entries(src.sheets)) {
        if (sh.matches && sh.matches[m.mpn]) {
          const fieldCount = Object.keys(sh.matches[m.mpn][0].fields || {}).length;
          console.log(m.mpn.padEnd(12), srcName.padEnd(18), shName.slice(0,33).padEnd(34), fieldCount);
        }
      }
    }
  }
  console.log('');
})().catch(e => { console.error(e); process.exit(1); });
