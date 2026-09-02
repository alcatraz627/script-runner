#!/usr/bin/env node
/**
 * build-aep-flat-sheet.js
 *
 * One shot: reads the three-sheet AEP catalog workbook, writes one flat sheet,
 * then reads that sheet back off disk and verifies it. Exits non-zero if any
 * check fails, so it is safe to chain.
 *
 * Everything worth changing for a new drop is in the CONFIG block below.
 * Why each transformation is safe: docs/PLAN.md
 *
 * Usage:
 *   node aep-catalog-v9/build-aep-flat-sheet.js
 *   node aep-catalog-v9/build-aep-flat-sheet.js --src <in.xlsx> --out <out.xlsx>
 *   node aep-catalog-v9/build-aep-flat-sheet.js --limit 3 --dry     # sample, no write
 *   node aep-catalog-v9/build-aep-flat-sheet.js --no-verify
 */

'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const { spawnSync } = require('child_process');
const SCHEMA = require('./scripts/schema');

// ── CONFIG ────────────────────────────────────────────────────────────────────

const CONFIG = {
  // Files
  SRC_FILE: '/Users/alcatraz627/Downloads/AEP Catalog V9 - Fitment Data.xlsx',
  OUT_FILE: path.resolve(__dirname, 'output/AEP-Catalog-V9-Flat.xlsx'),

  // Source sheets
  SHEET_CATALOG: 'Catalog',
  SHEET_FITMENT: 'Fitment',
  SHEET_NOT_FOUND: 'Not Found',

  // Everything about the output SHAPE lives in scripts/schema.js, so the
  // builder, both verifiers and the ingest probe cannot drift apart.
  ...SCHEMA,

  SECTION_STATUS_COL: 'Status',
  SECTION_LABEL_COL: 'ENGINE FAMILY',
  NOT_FOUND_REASON_COL: 'Reason',
};

/** The sidecar always sits beside the xlsx that was actually written. */
const sidecarFor = (xlsxPath) => xlsxPath.replace(/\.xlsx$/i, '.json');

const COLUMNS = SCHEMA.COLUMNS;
const PASSTHROUGH = SCHEMA.PASSTHROUGH;

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const hasFlag = (f) => args.includes(f);

const SRC = getArg('--src') || CONFIG.SRC_FILE;
const OUT = getArg('--out') || CONFIG.OUT_FILE;
const LIMIT = getArg('--limit') ? Number(getArg('--limit')) : null;
const DRY = hasFlag('--dry');
const SKIP_VERIFY = hasFlag('--no-verify');

// ── Helpers ───────────────────────────────────────────────────────────────────

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const isBlank = (v) => str(v) === '';

function readSheet(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`sheet "${name}" not found. present: ${wb.SheetNames.join(', ')}`);
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: false, blankrows: false });
}

const isSection = (row) => str(row[CONFIG.SECTION_STATUS_COL]) === CONFIG.SECTION_MARKER;
const carriesNoVehicle = (row) => CONFIG.VEHICLE_FIELDS.every((c) => isBlank(row[c]));

function fitmentDict(row) {
  const d = {};
  for (const [srcCol, key] of CONFIG.FITMENT_FIELDS) {
    const v = str(row[srcCol]);
    if (v !== '') d[key] = v;
  }
  return d;
}

// ── Build ─────────────────────────────────────────────────────────────────────

function build() {
  const wb = XLSX.readFile(SRC, { cellDates: false });
  const catalog = readSheet(wb, CONFIG.SHEET_CATALOG);
  const fitment = readSheet(wb, CONFIG.SHEET_FITMENT);
  const notFound = readSheet(wb, CONFIG.SHEET_NOT_FOUND);

  const fitByItem = new Map();
  for (const r of fitment) {
    const k = str(r[CONFIG.JOIN_KEY]);
    if (!fitByItem.has(k)) fitByItem.set(k, []);
    fitByItem.get(k).push(r);
  }

  const reasonByItem = new Map(notFound.map((r) => [str(r[CONFIG.JOIN_KEY]), str(r[CONFIG.NOT_FOUND_REASON_COL])]));

  const stats = {
    catalogRows: catalog.length, sectionRows: 0, dataRows: 0,
    fitmentRowsSeen: 0, fitmentEntries: 0, withFitment: 0,
    noteOnly: 0, withReason: 0, duplicateItems: [], orphanFitment: [], ghostRows: [],
    maxCell: 0, maxCellWhere: null,
  };

  let group = null;
  const seen = new Set();
  const out = [];

  for (const src of catalog) {
    if (isSection(src)) { group = str(src[CONFIG.SECTION_LABEL_COL]); stats.sectionRows++; continue; }
    stats.dataRows++;

    const item = str(src[CONFIG.JOIN_KEY]);
    if (seen.has(item)) stats.duplicateItems.push(item);
    seen.add(item);

    const rows = fitByItem.get(item) || [];
    stats.fitmentRowsSeen += rows.length;

    const dicts = rows.filter((r) => !carriesNoVehicle(r)).map(fitmentDict);
    const noteRows = rows.filter(carriesNoVehicle);
    const note = noteRows.map((r) => str(r.Options)).filter(Boolean).join(' | ');
    const reason = reasonByItem.get(item) || '';

    // A row with no vehicle AND no Options text is in neither bucket, so it
    // would leave the sheet without a trace. None exist today; fail loudly if
    // a future drop introduces one.
    for (const nr of noteRows) if (isBlank(nr.Options)) stats.ghostRows.push(`${item}: fitment row with no vehicle and no Options`);

    if (dicts.length) stats.withFitment++;
    stats.fitmentEntries += dicts.length;
    if (note) stats.noteOnly++;
    if (reason) stats.withReason++;

    const rec = { [CONFIG.GROUP_COL]: group || '' };
    for (const c of PASSTHROUGH) rec[c] = str(src[c]);
    rec[CONFIG.NOT_FOUND_OUT_COL] = reason;
    rec.Vehicles = isBlank(src.Vehicles) ? null : Number(str(src.Vehicles));
    rec[CONFIG.FITMENT_COUNT_COL] = dicts.length;
    rec[CONFIG.FITMENT_NOTE_COL] = note;
    rec[CONFIG.FITMENT_JSON_COL] = JSON.stringify(dicts);

    for (const c of COLUMNS) {
      const len = String(rec[c.key] ?? '').length;
      if (len > stats.maxCell) { stats.maxCell = len; stats.maxCellWhere = `${item}.${c.key}`; }
    }

    out.push(rec);
    if (LIMIT && out.length >= LIMIT) break;
  }

  if (!LIMIT) for (const k of fitByItem.keys()) if (!seen.has(k)) stats.orphanFitment.push(k);

  return { out, stats };
}

// ── Write ─────────────────────────────────────────────────────────────────────

async function write(rows, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(CONFIG.OUT_SHEET_NAME);
  ws.columns = COLUMNS.map((c) => ({ header: c.key, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) ws.addRow(r);
  await wb.xlsx.writeFile(dest);
  fs.writeFileSync(sidecarFor(dest), JSON.stringify(rows, null, 1));
}

// ── Verify ────────────────────────────────────────────────────────────────────

/**
 * Verification is delegated on purpose. An inline check that reused this file's
 * own `str`, `isSection` and `carriesNoVehicle` was mutation-proven to pass all
 * 18 of its checks on knowingly broken output, because it recomputed the source
 * side with the same broken helper. 04-validate rebuilds the expectation from
 * the raw source grid and shares no helper with the builder.
 */
function verify(dest) {
  const validator = path.resolve(__dirname, 'scripts/04-validate.js');
  const r = spawnSync(process.execPath, [validator, '--src', SRC, '--out', dest], { stdio: 'inherit' });
  return r.status === 0 ? [] : ['04-validate reported failures'];
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const { out, stats } = build();

  console.log('source     :', SRC);
  console.log('catalog    :', stats.catalogRows, 'rows =', stats.sectionRows, 'section +', stats.dataRows, 'data');
  console.log('items      :', out.length, '| duplicate keys:', stats.duplicateItems.length);
  console.log('fitment    :', stats.fitmentRowsSeen, 'source rows ->', stats.fitmentEntries, 'entries on', stats.withFitment, 'items');
  console.log('note-only  :', stats.noteOnly, '| reasons:', stats.withReason, '| orphans:', stats.orphanFitment.length, '| ghost rows:', stats.ghostRows.length);
  console.log('max cell   :', stats.maxCell, `chars (${stats.maxCellWhere}) / limit ${CONFIG.EXCEL_CELL_LIMIT}`);

  if (stats.duplicateItems.length) { console.error('FAIL: duplicate join keys:', stats.duplicateItems.slice(0, 10)); process.exit(1); }
  if (stats.orphanFitment.length) { console.error('FAIL: fitment items with no catalog row:', stats.orphanFitment.slice(0, 10)); process.exit(1); }
  if (stats.ghostRows.length) { console.error('FAIL: fitment rows that would vanish:', stats.ghostRows.slice(0, 10)); process.exit(1); }
  // Hard-exit rather than truncate: a truncated JSON array is invalid JSON, which is
  // worse than a loud failure. This deliberately diverges from pipeline/io.js.
  if (stats.maxCell > CONFIG.EXCEL_CELL_LIMIT) { console.error(`FAIL: cell over the Excel limit at ${stats.maxCellWhere}`); process.exit(1); }

  if (DRY) {
    console.log('\n--- dry run, first row field by field ---');
    for (const c of COLUMNS) {
      const v = out[0][c.key];
      console.log(`  ${c.key.padEnd(22)} ${String(typeof v).padEnd(8)} ${JSON.stringify(v).slice(0, 140)}`);
    }
    return;
  }

  await write(out, OUT);
  console.log('\nwrote      :', OUT);
  console.log('sidecar    :', sidecarFor(OUT));

  if (SKIP_VERIFY) return;
  const failures = verify(OUT);
  if (failures.length) { console.error('failed:', failures.join(' · ')); process.exit(1); }
})();
