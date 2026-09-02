#!/usr/bin/env node
/**
 * 04-validate.js
 *
 * Flags where the flat sheet lost data or holds a wrong value, by rebuilding
 * the expected answer from the raw source grid instead of reusing the builder's
 * helpers. A shared helper that is wrong would otherwise pass both build and
 * verify, which is the blind spot 02 has.
 *
 * Reports FAIL (wrong or missing) and WARN (worth a human look) separately.
 * Ends with 30 stratified spot checks, chosen to hit edges rather than the top
 * of the file. See ../docs/PLAN.md for the transform rules being checked.
 *
 * Usage:
 *   node aep-catalog-v9/scripts/04-validate.js
 *   node aep-catalog-v9/scripts/04-validate.js --spots 30 --verbose
 *   node aep-catalog-v9/scripts/04-validate.js --json report.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const SCHEMA = require('./schema');

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

const SRC_FILE = arg('--src', '/Users/alcatraz627/Downloads/AEP Catalog V9 - Fitment Data.xlsx');
const OUT_FILE = path.resolve(arg('--out', path.resolve(__dirname, '../output/AEP-Catalog-V9-Flat.xlsx')));
const { EXCEL_CELL_LIMIT, SECTION_MARKER } = SCHEMA;

const EXPECTED_HEADERS = SCHEMA.HEADERS;

/** Output column -> Catalog column it must equal verbatim. */
const PASSTHROUGH = Object.fromEntries(SCHEMA.PASSTHROUGH.map((c) => [c, c]));

const FITMENT_KEYS = SCHEMA.FITMENT_KEYS;
const VEHICLE_COLS = SCHEMA.VEHICLE_FIELDS;

const SPOTS = Number(arg('--spots', 30));
const VERBOSE = argv.includes('--verbose');
const JSON_OUT = arg('--json', null);

// ── Findings ──────────────────────────────────────────────────────────────────

const findings = [];
const counts = { pass: 0, warn: 0, fail: 0 };

function record(level, group, label, detail, examples) {
  if (level === 'pass') { counts.pass++; } else { counts[level]++; }
  findings.push({ level, group, label, detail, examples: examples || [] });
}
const ok = (g, l, d) => record('pass', g, l, d);
const warn = (g, l, d, ex) => record('warn', g, l, d, ex);
const fail = (g, l, d, ex) => record('fail', g, l, d, ex);

/** Assert-style: emit pass, or fail with up to 5 offending examples. */
function expect(group, label, bad, detail, level = 'fail') {
  if (!bad.length) ok(group, label, detail);
  else record(level, group, label, `${bad.length} offending — ${detail}`, bad.slice(0, 5));
}

// ── Source, read as a raw grid so no header-keyed assumption is inherited ──────

const raw = (wb, name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: null, blankrows: true });
const s = (v) => (v === null || v === undefined ? '' : String(v));
const t = (v) => s(v).trim();

const srcWb = XLSX.readFile(SRC_FILE, { cellDates: false });
const catGrid = raw(srcWb, 'Catalog');
const fitGrid = raw(srcWb, 'Fitment');
const nfGrid = raw(srcWb, 'Not Found');

const catHead = catGrid[0].map(s);
const fitHead = fitGrid[0].map(s);
const nfHead = nfGrid[0].map(s);
const idx = (head, name) => head.indexOf(name);

/** Grid row -> object, keyed by that sheet's own header text. */
function rowObj(head, row) {
  const o = {};
  head.forEach((h, i) => { o[h] = row ? row[i] : null; });
  return o;
}

// Rebuild the source model from the grid, tracking the physical row number so a
// finding can point at a spreadsheet row the human can open.
const statusCol = idx(catHead, 'Status');
const efCol = idx(catHead, 'ENGINE FAMILY');
const itemCol = idx(catHead, 'ITEM');

const srcSections = [];
const srcRows = [];
let band = null;
for (let r = 1; r < catGrid.length; r++) {
  const row = catGrid[r];
  if (!row || row.every((c) => t(c) === '')) continue;
  if (t(row[statusCol]) === SECTION_MARKER) {
    band = t(row[efCol]);
    srcSections.push({ excelRow: r + 1, label: band, rawLabel: s(row[efCol]) });
    continue;
  }
  srcRows.push({ excelRow: r + 1, band, item: t(row[itemCol]), rawItem: s(row[itemCol]), o: rowObj(catHead, row) });
}

const srcFit = [];
for (let r = 1; r < fitGrid.length; r++) {
  const row = fitGrid[r];
  if (!row || row.every((c) => t(c) === '')) continue;
  const o = rowObj(fitHead, row);
  srcFit.push({ excelRow: r + 1, item: t(o.ITEM), o, hasVehicle: !VEHICLE_COLS.every((c) => t(o[c]) === '') });
}

const srcNf = [];
for (let r = 1; r < nfGrid.length; r++) {
  const row = nfGrid[r];
  if (!row || row.every((c) => t(c) === '')) continue;
  const o = rowObj(nfHead, row);
  srcNf.push({ excelRow: r + 1, item: t(o.ITEM), reason: t(o.Reason), o });
}

const srcFitBy = new Map();
for (const f of srcFit) { if (!srcFitBy.has(f.item)) srcFitBy.set(f.item, []); srcFitBy.get(f.item).push(f); }
const srcRowBy = new Map(srcRows.map((r) => [r.item, r]));
const srcNfBy = new Map(srcNf.map((r) => [r.item, r]));

// ── Output, read back off disk ────────────────────────────────────────────────

if (!fs.existsSync(OUT_FILE)) {
  console.error(`output not found: ${OUT_FILE}\nrun build-aep-flat-sheet.js first`);
  process.exit(2);
}
const outWb = XLSX.readFile(OUT_FILE, { cellDates: false });
const outName = outWb.SheetNames[0];
const outGrid = raw(outWb, outName);
const outHead = outGrid[0].map(s);
const outRows = [];
for (let r = 1; r < outGrid.length; r++) {
  const row = outGrid[r];
  if (!row || row.every((c) => t(c) === '')) continue;
  outRows.push({ excelRow: r + 1, o: rowObj(outHead, row) });
}
const outBy = new Map(outRows.map((r) => [t(r.o.ITEM), r]));

console.log(`\nvalidating ${OUT_FILE}`);
console.log(`against    ${SRC_FILE}\n`);

// ── (a) Structural ────────────────────────────────────────────────────────────

const G = 'structural';
expect(G, 'exactly one sheet', outWb.SheetNames.length === 1 ? [] : outWb.SheetNames, `sheets: ${outWb.SheetNames.join(', ')}`);
expect(G, 'header row 1 matches the declared 23 columns',
  JSON.stringify(outHead) === JSON.stringify(EXPECTED_HEADERS) ? [] : [{ got: outHead }],
  `${outHead.length} columns`);
expect(G, 'no blank header cell', outHead.map((h, i) => (t(h) === '' ? `col ${i + 1}` : null)).filter(Boolean),
  'a blank header becomes "Unnamed: N" and is dropped on upload');
expect(G, 'no duplicate header name',
  outHead.filter((h, i) => outHead.indexOf(h) !== i),
  'pandas renames a duplicate to "X.1", silently changing the column name');
expect(G, 'no header with stray whitespace', outHead.filter((h) => h !== h.trim()),
  'leading or trailing spaces make column mapping fail on an exact-match lookup');
expect(G, 'every row has all 23 cells populated or blank, none ragged',
  outRows.filter((r) => Object.keys(r.o).length !== EXPECTED_HEADERS.length).map((r) => r.excelRow),
  'ragged rows break positional readers');

// ── (b) Completeness / data loss ──────────────────────────────────────────────

const C = 'completeness';
expect(C, 'row count equals source catalog data rows',
  outRows.length === srcRows.length ? [] : [{ out: outRows.length, src: srcRows.length }],
  `${outRows.length} out vs ${srcRows.length} source`);

const missingItems = srcRows.filter((r) => !outBy.has(r.item)).map((r) => `${r.item} (source row ${r.excelRow})`);
expect(C, 'every source catalog part reached the output', missingItems, 'a part present in Catalog with no output row');

const extraItems = [...outBy.keys()].filter((i) => !srcRowBy.has(i));
expect(C, 'no invented parts in the output', extraItems, 'an output part not present in the source Catalog');

// Every source Fitment row must be accounted for: an entry, or a note.
let accountedEntries = 0;
const unaccountedFitment = [];
for (const [item, rows] of srcFitBy) {
  const outRow = outBy.get(item);
  if (!outRow) { unaccountedFitment.push(`${item}: ${rows.length} fitment rows, no output row`); continue; }
  let parsed = [];
  try { parsed = JSON.parse(t(outRow.o.Fitment) || '[]'); } catch { /* reported in value sanity */ }
  const vehicles = rows.filter((r) => r.hasVehicle);
  const notes = rows.filter((r) => !r.hasVehicle);
  accountedEntries += parsed.length;
  if (parsed.length !== vehicles.length) {
    unaccountedFitment.push(`${item}: ${vehicles.length} vehicle rows in source, ${parsed.length} entries out`);
  }
  for (const n of notes) {
    const noteText = t(n.o.Options);
    if (noteText === '') {
      unaccountedFitment.push(`${item} (source Fitment row ${n.excelRow}): row has no vehicle AND no Options text, so it left no trace`);
    } else if (!t(outRow.o['Fitment Note']).includes(noteText)) {
      unaccountedFitment.push(`${item} (source Fitment row ${n.excelRow}): note text absent from Fitment Note`);
    }
  }
}
expect(C, 'every source fitment row is an entry or a note', unaccountedFitment,
  `${srcFit.length} source rows, ${accountedEntries} entries emitted`);

const missingReasons = srcNf.filter((r) => {
  const o = outBy.get(r.item);
  return !o || t(o.o['Not Found Reason']) !== r.reason;
}).map((r) => `${r.item} (Not Found row ${r.excelRow})`);
expect(C, 'every Not Found reason folded in verbatim', missingReasons, `${srcNf.length} reasons in source`);

// Per-column non-empty parity for the straight copies.
const fillDrift = [];
for (const [outCol, srcCol] of Object.entries(PASSTHROUGH)) {
  const srcFilled = srcRows.filter((r) => t(r.o[srcCol]) !== '').length;
  const outFilled = outRows.filter((r) => t(r.o[outCol]) !== '').length;
  if (srcFilled !== outFilled) fillDrift.push(`${outCol}: source ${srcFilled} filled, output ${outFilled}`);
}
expect(C, 'per-column fill counts unchanged for copied columns', fillDrift,
  `${Object.keys(PASSTHROUGH).length} columns compared`);

// Which source columns are deliberately absent from the output.
const catDropped = catHead.filter((h) => t(h) !== '' && !EXPECTED_HEADERS.includes(h) && h !== 'Vehicles');
const fitDropped = fitHead.filter((h) => t(h) !== '' && !['ITEM', 'Years', 'Make', 'Model', 'Trim / Body', 'Engine', 'Options'].includes(h));
const nfDropped = nfHead.filter((h) => t(h) !== '' && h !== 'Reason' && !EXPECTED_HEADERS.includes(h));
if (catDropped.length) warn(C, 'Catalog columns not carried to the output', catDropped.join(', '), catDropped);
else ok(C, 'no Catalog column dropped', 'all 18 accounted for');

// Fitment's item-level columns are dropped on the claim that they duplicate Catalog. Prove it.
const dupClaim = [['Reference', 'ALTERNATE REFERENCE'], ['Searched As', 'Searched As'], ['Source Site', 'Source Site'],
  ['Part Number (site)', 'Part Number (site)'], ['Product Title', 'Product Title'], ['Source URL', 'Source URL']];
const claimBreaks = [];
for (const [fitCol, catCol] of dupClaim) {
  for (const [item, rows] of srcFitBy) {
    const cat = srcRowBy.get(item);
    if (!cat) continue;
    for (const fr of rows) {
      if (t(fr.o[fitCol]) !== t(cat.o[catCol])) {
        claimBreaks.push(`${item} row ${fr.excelRow}: Fitment.${fitCol}=${JSON.stringify(t(fr.o[fitCol]))} vs Catalog.${catCol}=${JSON.stringify(t(cat.o[catCol]))}`);
      }
    }
  }
}
expect(C, 'dropped Fitment columns really do duplicate Catalog', claimBreaks,
  'if these differ, dropping them lost per-vehicle information', 'fail');

if (fitDropped.length) warn(C, 'Fitment columns dropped as duplicates', fitDropped.join(', '), fitDropped);
if (nfDropped.length) ok(C, 'Not Found columns dropped as duplicates of Catalog', nfDropped.join(', '));


// Spec 9: a source column in no declared bucket is a new column nobody decided
// about, which is how a future drop loses data quietly.
const fate = SCHEMA.SOURCE_COLUMN_FATE;
const catAccounted = new Set([...fate.Catalog.copied, ...fate.Catalog.transformed, 'ENGINE FAMILY', 'Status']);
const fitAccounted = new Set([...fate.Fitment.joinKey, ...fate.Fitment.becomesDictKey, ...Object.keys(fate.Fitment.redundantWithCatalog)]);
const nfAccounted = new Set([...Object.keys(fate['Not Found'].foldedIn), ...fate['Not Found'].redundantWithCatalog]);
expect(C, 'every Catalog column has a declared fate', catHead.filter((h) => t(h) && !catAccounted.has(h)),
  'an unaccounted source column would be dropped without anyone deciding to');
expect(C, 'every Fitment column has a declared fate', fitHead.filter((h) => t(h) && !fitAccounted.has(h)), '');
expect(C, 'every Not Found column has a declared fate', nfHead.filter((h) => t(h) && !nfAccounted.has(h)), '');

// Spec 13: the row ledger must balance exactly, which is what closes the ghost row.
const vehRows = srcFit.filter((f) => f.hasVehicle).length;
const noteRows = srcFit.filter((f) => !f.hasVehicle && t(f.o.Options) !== '').length;
const ghostRows = srcFit.filter((f) => !f.hasVehicle && t(f.o.Options) === '');
expect(C, 'fitment row ledger balances', vehRows + noteRows + ghostRows.length === srcFit.length ? [] : [{ vehRows, noteRows, ghost: ghostRows.length, total: srcFit.length }],
  `${vehRows} vehicle + ${noteRows} note + ${ghostRows.length} ghost = ${srcFit.length}`);
expect(C, 'no fitment row is vehicle-blank AND options-blank',
  ghostRows.map((f) => `Fitment row ${f.excelRow} (${f.item})`),
  'such a row lands in neither bucket and leaves the sheet with no trace');

// Spec 11: the Not Found sheet's shared columns must match Catalog raw, not trimmed.
const nfRawDiffs = [];
for (const n of srcNf) {
  const c = srcRowBy.get(n.item); if (!c) continue;
  for (const col of fate['Not Found'].redundantWithCatalog) {
    if (s(n.o[col]) !== s(c.o[col])) nfRawDiffs.push(`${n.item} ${col}`);
  }
}
expect(C, 'Not Found shared columns match Catalog byte for byte', nfRawDiffs, `${srcNf.length} rows x 9 columns, raw`);

// ── (c) Referential integrity against the source ──────────────────────────────

const R = 'integrity';

// OEM GROUP recomputed from physical row order, not from the builder's helper.
const groupWrong = [];
for (const sr of srcRows) {
  const o = outBy.get(sr.item);
  if (!o) continue;
  if (t(o.o['OEM GROUP']) !== sr.band) {
    groupWrong.push(`${sr.item} (source row ${sr.excelRow}): expected band ${JSON.stringify(sr.band)}, got ${JSON.stringify(t(o.o['OEM GROUP']))}`);
  }
}
expect(R, 'OEM GROUP equals the band physically above the row', groupWrong,
  `${srcSections.length} bands, recomputed by row order`);

const bandTally = srcRows.reduce((a, r) => { a[r.band] = (a[r.band] || 0) + 1; return a; }, {});
const outTally = outRows.reduce((a, r) => { const g = t(r.o['OEM GROUP']); a[g] = (a[g] || 0) + 1; return a; }, {});
expect(R, `${srcSections.length} distinct OEM GROUP values in the output`,
  new Set(outRows.map((r) => t(r.o['OEM GROUP']))).size === srcSections.length ? [] : [...new Set(outRows.map((r) => t(r.o['OEM GROUP'])))],
  `${new Set(outRows.map((r) => t(r.o['OEM GROUP']))).size} groups`);
expect(R, 'zero data rows precede the first band', srcRows.filter((r) => r.band === null).map((r) => r.excelRow),
  'a row above the first band would forward-fill to null');
const famToGroup = new Map();
for (const r of outRows) { const f = t(r.o['ENGINE FAMILY']); if (!famToGroup.has(f)) famToGroup.set(f, new Set()); famToGroup.get(f).add(t(r.o['OEM GROUP'])); }
expect(R, 'every ENGINE FAMILY maps to exactly one OEM GROUP',
  [...famToGroup.entries()].filter(([, g]) => g.size > 1).map(([f, g]) => `${f}: ${[...g].join(', ')}`),
  `${famToGroup.size} distinct families`);
expect(R, 'rows per band unchanged',
  JSON.stringify(bandTally) === JSON.stringify(outTally) ? [] : [{ src: bandTally, out: outTally }],
  JSON.stringify(outTally));

// Every copied column, value by value.
const cellDiffs = [];
for (const sr of srcRows) {
  const o = outBy.get(sr.item);
  if (!o) continue;
  for (const [outCol, srcCol] of Object.entries(PASSTHROUGH)) {
    if (t(sr.o[srcCol]) !== t(o.o[outCol])) {
      cellDiffs.push(`${sr.item} row ${sr.excelRow} ${outCol}: src=${JSON.stringify(t(sr.o[srcCol])).slice(0, 60)} out=${JSON.stringify(t(o.o[outCol])).slice(0, 60)}`);
    }
  }
}
expect(R, 'every copied cell matches its source cell', cellDiffs, `${srcRows.length} rows x ${Object.keys(PASSTHROUGH).length} columns`);

// Absolute, not comparative. Every comparison in this file applies t() to both
// sides, so a builder that stopped trimming would still compare equal. Asserting
// the output is already trim-clean is the only non-circular way to see it.
const untrimmedCells = [];
for (const r of outRows) for (const [k, v] of Object.entries(r.o)) {
  const val = s(v);
  if (val !== val.trim()) untrimmedCells.push(`row ${r.excelRow} ${k}=${JSON.stringify(val.slice(0, 40))}`);
}
expect(R, 'no output cell carries leading or trailing whitespace', untrimmedCells,
  'the builder is expected to normalise padding; padding in the output means it stopped');

// Raw source-to-output diffs, counted separately from the trimmed comparison so
// the normalisation is visible rather than absorbed.
let rawDiffCount = 0;
for (const sr of srcRows) {
  const o = outBy.get(sr.item); if (!o) continue;
  for (const [outCol, srcCol] of Object.entries(PASSTHROUGH)) if (s(sr.o[srcCol]) !== s(o.o[outCol])) rawDiffCount++;
}
if (rawDiffCount) warn(R, 'cells that differ from source before trimming', `${rawDiffCount} cells, all padding-only (the check above proves the output side is clean)`);
else ok(R, 'output matches source byte for byte, no normalisation applied', '');

// Trimming changed a value's content, not just its padding.
const trimmedAway = [];
for (const sr of srcRows) {
  for (const srcCol of Object.values(PASSTHROUGH)) {
    const v = s(sr.o[srcCol]);
    if (v !== v.trim() && v.trim() !== '') trimmedAway.push(`${sr.item} ${srcCol}: ${JSON.stringify(v)}`);
  }
}
if (trimmedAway.length) warn(R, 'source values carried padding that trimming removed', `${trimmedAway.length} cells, content preserved`, trimmedAway.slice(0, 5));
else ok(R, 'no source value had padding to lose', '');

// Join-key hygiene: whitespace or case variants would silently mis-join.
const norm = (x) => x.replace(/\s+/g, ' ').trim().toUpperCase();
const byNorm = new Map();
for (const sr of srcRows) { const k = norm(sr.item); if (!byNorm.has(k)) byNorm.set(k, []); byNorm.get(k).push(sr.item); }
const nearDupes = [...byNorm.entries()].filter(([, v]) => new Set(v).size > 1).map(([k, v]) => `${k}: ${[...new Set(v)].join(' | ')}`);
expect(R, 'no two parts collide after whitespace and case folding', nearDupes,
  'near-duplicate keys mean the fitment join could attach to the wrong part', 'warn');

const exactDupes = srcRows.map((r) => r.item).filter((v, i, a) => a.indexOf(v) !== i);
expect(R, 'ITEM unique in the source catalog', [...new Set(exactDupes)], 'a duplicate key fans the join out');

const orphanFit = [...srcFitBy.keys()].filter((k) => !srcRowBy.has(k));
expect(R, 'no fitment row references a part absent from the catalog', orphanFit, `${srcFitBy.size} distinct parts in Fitment`);

// Fitment Count against the source, per item.
const countWrong = [];
for (const r of outRows) {
  const item = t(r.o.ITEM);
  const expectN = (srcFitBy.get(item) || []).filter((f) => f.hasVehicle).length;
  const got = Number(t(r.o['Fitment Count']));
  if (got !== expectN) countWrong.push(`${item}: Fitment Count=${got}, source vehicle rows=${expectN}`);
}
expect(R, 'Fitment Count equals the source vehicle-row count', countWrong, `${outRows.length} rows`);

// Entry-by-entry equality for a full comparison, not just counts.
const entryDiffs = [];
for (const r of outRows) {
  const item = t(r.o.ITEM);
  let parsed;
  try { parsed = JSON.parse(t(r.o.Fitment) || '[]'); } catch { continue; }
  const expectRows = (srcFitBy.get(item) || []).filter((f) => f.hasVehicle);
  for (let i = 0; i < Math.min(parsed.length, expectRows.length); i++) {
    const want = { years: t(expectRows[i].o.Years), make: t(expectRows[i].o.Make), model: t(expectRows[i].o.Model), trim: t(expectRows[i].o['Trim / Body']), engine: t(expectRows[i].o.Engine), options: t(expectRows[i].o.Options) };
    for (const k of FITMENT_KEYS) {
      const got = t(parsed[i][k] ?? '');
      if (got !== want[k]) entryDiffs.push(`${item}[${i}].${k}: src=${JSON.stringify(want[k]).slice(0, 50)} out=${JSON.stringify(got).slice(0, 50)}`);
    }
  }
}
expect(R, 'every fitment entry matches its source row field by field', entryDiffs,
  `${accountedEntries} entries compared across all ${FITMENT_KEYS.length} fields`);

// Order preservation: entries must follow source row order (years descending here).
const orderBreaks = [];
for (const r of outRows) {
  const item = t(r.o.ITEM);
  let parsed; try { parsed = JSON.parse(t(r.o.Fitment) || '[]'); } catch { continue; }
  const expectRows = (srcFitBy.get(item) || []).filter((f) => f.hasVehicle);
  const a = parsed.map((e) => [e.years || '', e.make || '', e.model || ''].join('|'));
  const b = expectRows.map((f) => [t(f.o.Years), t(f.o.Make), t(f.o.Model)].join('|'));
  if (JSON.stringify(a) !== JSON.stringify(b)) orderBreaks.push(item);
}
expect(R, 'fitment entry order follows the source sheet order', orderBreaks,
  'reordering would break any downstream that treats entry 0 as the newest');

// Spec 21: assert note TEXT, not a count. Comparing note-carrying output ROWS to
// source ROWS mixes units and only passes because each sentinel item has one row.
const noteTextWrong = [];
for (const r of outRows) {
  const item = t(r.o.ITEM);
  const expectNote = (srcFitBy.get(item) || []).filter((f) => !f.hasVehicle).map((f) => t(f.o.Options)).filter(Boolean).join(' | ');
  if (t(r.o['Fitment Note']) !== expectNote) noteTextWrong.push(`${item}: expected ${JSON.stringify(expectNote)}, got ${JSON.stringify(t(r.o['Fitment Note']))}`);
}
expect(R, 'Fitment Note equals the joined Options of that item\'s vehicle-blank rows', noteTextWrong,
  'compares text per item, not row counts');
const noteItemSet = new Set(outRows.filter((r) => t(r.o['Fitment Note'])).map((r) => t(r.o.ITEM)));
const srcNoteItemSet = new Set(srcFit.filter((f) => !f.hasVehicle && t(f.o.Options)).map((f) => f.item));
expect(R, 'the set of items carrying a note matches the source',
  [...srcNoteItemSet].filter((i) => !noteItemSet.has(i)).concat([...noteItemSet].filter((i) => !srcNoteItemSet.has(i))), '');
expect(R, 'every noted row has an empty Fitment and a zero count',
  outRows.filter((r) => t(r.o['Fitment Note']) && (t(r.o.Fitment) !== '[]' || t(r.o['Fitment Count']) !== '0')).map((r) => t(r.o.ITEM)), '');

// ── (d) Value sanity ─────────────────────────────────────────────────────────

const V = 'values';
const POISON = ['[object Object]', 'undefined', 'null', 'NaN', 'Invalid Date', '#REF!', '#N/A', '#VALUE!'];
const poisoned = [];
for (const r of outRows) for (const [k, v] of Object.entries(r.o)) {
  const val = t(v);
  if (POISON.includes(val) || val.includes('[object Object]')) poisoned.push(`row ${r.excelRow} ${k}=${JSON.stringify(val)}`);
}
expect(V, 'no serialization poison in any cell', poisoned, `checked ${outRows.length * EXPECTED_HEADERS.length} cells`);

const badJson = [], badShape = [], emptyVals = [];
for (const r of outRows) {
  const rawCell = t(r.o.Fitment);
  if (rawCell === '') { badJson.push(`row ${r.excelRow} ${t(r.o.ITEM)}: Fitment cell is empty, expected at least []`); continue; }
  let parsed;
  try { parsed = JSON.parse(rawCell); } catch (e) { badJson.push(`row ${r.excelRow} ${t(r.o.ITEM)}: ${e.message}`); continue; }
  if (!Array.isArray(parsed)) { badShape.push(`${t(r.o.ITEM)}: not an array`); continue; }
  parsed.forEach((e, i) => {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) { badShape.push(`${t(r.o.ITEM)}[${i}]: not an object`); return; }
    for (const [k, v] of Object.entries(e)) {
      if (!FITMENT_KEYS.includes(k)) badShape.push(`${t(r.o.ITEM)}[${i}]: unexpected key ${k}`);
      if (typeof v !== 'string') badShape.push(`${t(r.o.ITEM)}[${i}].${k}: ${typeof v}, expected string`);
      else if (v.trim() === '') emptyVals.push(`${t(r.o.ITEM)}[${i}].${k} is empty`);
    }
  });
}
expect(V, 'every Fitment cell parses as JSON', badJson, `${outRows.length} cells`);
expect(V, 'every entry is a flat object of known string keys', badShape, `allowed keys: ${FITMENT_KEYS.join(', ')}`);
expect(V, 'no empty-string values inside an entry', emptyVals, 'blank fields must be omitted, not emitted as "" (documented contract, and it bloats the payload)');

expect(V, 'Fitment Count is a non-negative integer',
  outRows.filter((r) => !/^\d+$/.test(t(r.o['Fitment Count']))).map((r) => `${t(r.o.ITEM)}=${t(r.o['Fitment Count'])}`),
  'a NaN or blank here breaks numeric filters');

expect(V, 'Vehicles is numeric or blank',
  outRows.filter((r) => { const v = t(r.o.Vehicles); return v !== '' && !/^\d+$/.test(v); }).map((r) => `${t(r.o.ITEM)}=${t(r.o.Vehicles)}`),
  'Number() on a non-numeric string writes NaN into the cell');

const vehVsCount = outRows.filter((r) => {
  const v = t(r.o.Vehicles);
  return v !== '' && Number(v) !== Number(t(r.o['Fitment Count']));
}).map((r) => `${t(r.o.ITEM)}: Vehicles=${t(r.o.Vehicles)} Fitment Count=${t(r.o['Fitment Count'])}`);
expect(V, "supplier's Vehicles count agrees with the recomputed one", vehVsCount,
  'a disagreement means the supplier count or our aggregation is wrong', 'warn');

const statuses = [...new Set(outRows.map((r) => t(r.o.Status)))];
expect(V, 'Status holds only the two expected values', statuses.filter((x) => !['Found', 'Not found'].includes(x)),
  `found: ${statuses.join(', ')}`);

const reasonMismatch = outRows.filter((r) => (t(r.o['Not Found Reason']) !== '') !== (t(r.o.Status) === 'Not found'))
  .map((r) => `${t(r.o.ITEM)}: Status=${t(r.o.Status)} reason=${t(r.o['Not Found Reason']) ? 'set' : 'empty'}`);
expect(V, 'Not Found Reason is set exactly when Status is "Not found"', reasonMismatch, '');

const fitVsStatus = outRows.filter((r) => t(r.o.Status) === 'Not found' && Number(t(r.o['Fitment Count'])) > 0)
  .map((r) => t(r.o.ITEM));
expect(V, 'no "Not found" part carries fitment', fitVsStatus, 'a part with no OEM hit should have no vehicle data');

const badUrl = outRows.filter((r) => { const u = t(r.o['Source URL']); return u !== '' && !/^https?:\/\//.test(u); })
  .map((r) => `${t(r.o.ITEM)}=${t(r.o['Source URL']).slice(0, 40)}`);
expect(V, 'Source URL is a URL where present', badUrl, '');

const urlVsStatus = outRows.filter((r) => (t(r.o['Source URL']) !== '') !== (t(r.o.Status) === 'Found'))
  .map((r) => `${t(r.o.ITEM)}: Status=${t(r.o.Status)}`);
expect(V, 'a Source URL exists exactly on the "Found" rows', urlVsStatus, '', 'warn');

let maxCell = 0, maxWhere = null;
const overLimit = [];
for (const r of outRows) for (const [k, v] of Object.entries(r.o)) {
  const len = s(v).length;
  if (len > maxCell) { maxCell = len; maxWhere = `${t(r.o.ITEM)}.${k}`; }
  if (len > EXCEL_CELL_LIMIT) overLimit.push(`${t(r.o.ITEM)}.${k} = ${len} chars`);
}
expect(V, `no cell over the ${EXCEL_CELL_LIMIT} Excel limit`, overLimit, `largest is ${maxCell} at ${maxWhere}`);
if (maxCell > EXCEL_CELL_LIMIT * 0.8) warn(V, 'a cell is within 20% of the Excel limit', `${maxCell} at ${maxWhere}`);

const blankKey = outRows.filter((r) => t(r.o.ITEM) === '').map((r) => `row ${r.excelRow}`);
expect(V, 'no row with a blank ITEM', blankKey, 'the join key must be present on every row');

// ── (e) Enhancement-module readiness ─────────────────────────────────────────

const E = 'ingest-readiness';
expect(E, 'no header would be filtered as "Unnamed"', outHead.filter((h) => /^Unnamed:/.test(h) || t(h) === ''),
  'get_excel_file_headers drops these, losing the column with no error');
expect(E, 'sheet name is plain and single', outWb.SheetNames.length === 1 && /^[\w ]+$/.test(outName) ? [] : outWb.SheetNames,
  `sheet: ${outName}`);
const wideCols = outHead.filter((h) => h.length > 64);
expect(E, 'no header longer than 64 chars', wideCols, 'long names break some column-map UIs', 'warn');
const nonAscii = outHead.filter((h) => /[^\x20-\x7E]/.test(h));
expect(E, 'headers are printable ASCII', nonAscii, 'non-ASCII headers survive but complicate exact-match mapping', 'warn');
expect(E, 'row count is under the practical preview cap', outRows.length <= 100000 ? [] : [outRows.length], `${outRows.length} rows`);

const noteNotInSource = outRows.filter((r) => {
  const n = t(r.o['Fitment Note']);
  if (n === '') return false;
  const rows = srcFitBy.get(t(r.o.ITEM)) || [];
  return !rows.some((f) => t(f.o.Options) === n);
}).map((r) => t(r.o.ITEM));
expect(E, 'every Fitment Note traces to a source Options cell', noteNotInSource, '');

// ── Report ───────────────────────────────────────────────────────────────────

const byGroup = findings.reduce((a, f) => { (a[f.group] = a[f.group] || []).push(f); return a; }, {});
for (const [group, items] of Object.entries(byGroup)) {
  console.log(`${group}`);
  for (const f of items) {
    const mark = f.level === 'pass' ? 'ok  ' : f.level === 'warn' ? 'WARN' : 'FAIL';
    console.log(`  ${mark}  ${f.label}${f.detail ? '  — ' + f.detail : ''}`);
    if (f.level !== 'pass' || VERBOSE) for (const ex of f.examples) console.log(`          · ${typeof ex === 'string' ? ex : JSON.stringify(ex)}`);
  }
  console.log('');
}

// ── Spot checks: stratified so the sample hits edges, not the top of the file ─

console.log(`spot checks (${SPOTS}, stratified)\n`);

// Each stratum gets a cap, or a populous one (there are hundreds of odd-shaped
// Ford rows) crowds out the rest and the sample stops being stratified.
const picked = new Map();
const strataUsed = new Map();
const add = (item, why, cap = 2) => {
  if (!item || picked.size >= SPOTS || picked.has(item) || !outBy.has(item)) return;
  const used = strataUsed.get(why.split(' (')[0]) || 0;
  if (used >= cap) return;
  strataUsed.set(why.split(' (')[0], used + 1);
  picked.set(item, why);
};

// One per OEM GROUP, so every band is exercised.
for (const sec of srcSections) {
  const first = srcRows.find((r) => r.band === sec.label);
  if (first) add(first.item, `band ${sec.label}`, 1);
}
// Boundary rows.
add(srcRows[0].item, 'first catalog row');
add(srcRows[srcRows.length - 1].item, 'last catalog row');
// Fitment extremes.
const bySize = [...srcFitBy.entries()].map(([k, v]) => [k, v.filter((f) => f.hasVehicle).length]).sort((a, b) => b[1] - a[1]);
add(bySize[0]?.[0], `largest fitment (${bySize[0]?.[1]} rows)`);
const smallest = bySize.filter(([, n]) => n === 1)[0];
add(smallest?.[0], 'smallest non-empty fitment (1 row)');
// The no-vehicle sentinels.
for (const f of srcFit.filter((x) => !x.hasVehicle)) add(f.item, 'no-vehicle sentinel row', 4);
// One per distinct Not Found reason.
const seenReason = new Set();
for (const n of srcNf) { if (!seenReason.has(n.reason)) { seenReason.add(n.reason); add(n.item, `reason: ${n.reason.slice(0, 40)}`, 1); } }
// Fitment rows with a blank Make or blank Years, the odd-shaped scrapes.
for (const f of srcFit.filter((x) => x.hasVehicle && t(x.o.Make) === '')) add(f.item, 'fitment row with blank Make');
for (const f of srcFit.filter((x) => x.hasVehicle && t(x.o.Years) === '')) add(f.item, 'fitment row with blank Years');
// Longest text fields.
const longestDesc = [...srcRows].sort((a, b) => s(b.o.DESCRIPTION).length - s(a.o.DESCRIPTION).length)[0];
add(longestDesc?.item, 'longest DESCRIPTION');
add(maxWhere ? maxWhere.split('.')[0] : null, 'largest cell in the sheet');
// Awkward keys.
for (const r of srcRows.filter((x) => /\s/.test(x.item) || /[^\w.-]/.test(x.item))) add(r.item, 'ITEM with spaces or punctuation', 2);
// Where the supplier count disagrees with ours.
for (const r of outRows.filter((x) => { const v = t(x.o.Vehicles); return v !== '' && Number(v) !== Number(t(x.o['Fitment Count'])); })) add(t(r.o.ITEM), 'Vehicles disagrees with Fitment Count');
// Deterministic spread fill for whatever slots remain.
const step = Math.max(1, Math.floor(srcRows.length / SPOTS));
for (let i = 0; picked.size < SPOTS && i < srcRows.length; i += step) add(srcRows[i].item, 'evenly-spaced sample', SPOTS);
for (let i = 0; picked.size < SPOTS && i < srcRows.length; i++) add(srcRows[i].item, 'fill', SPOTS);

let spotFail = 0;
let n = 0;
for (const [item, why] of picked) {
  n++;
  const src = srcRowBy.get(item);
  const out = outBy.get(item);
  const sf = (srcFitBy.get(item) || []);
  const sfv = sf.filter((f) => f.hasVehicle);
  let parsed = []; let parseErr = null;
  try { parsed = JSON.parse(t(out.o.Fitment) || '[]'); } catch (e) { parseErr = e.message; }

  const problems = [];
  if (t(out.o['OEM GROUP']) !== src.band) problems.push(`OEM GROUP ${JSON.stringify(t(out.o['OEM GROUP']))} != band ${JSON.stringify(src.band)}`);
  for (const [oc, sc] of Object.entries(PASSTHROUGH)) if (t(src.o[sc]) !== t(out.o[oc])) problems.push(`${oc} differs`);
  if (parseErr) problems.push(`Fitment unparseable: ${parseErr}`);
  if (parsed.length !== sfv.length) problems.push(`entries ${parsed.length} != source vehicle rows ${sfv.length}`);
  if (Number(t(out.o['Fitment Count'])) !== parsed.length) problems.push('Fitment Count != entries');
  const nf = srcNfBy.get(item);
  if (nf && t(out.o['Not Found Reason']) !== nf.reason) problems.push('Not Found Reason differs');
  if (!nf && t(out.o['Not Found Reason']) !== '') problems.push('Not Found Reason set but item is not in the Not Found sheet');
  if (problems.length) spotFail++;

  const verdict = problems.length ? 'FAIL' : 'ok  ';
  console.log(`  ${String(n).padStart(2)}. ${verdict} ${item.padEnd(22)} src row ${String(src.excelRow).padStart(4)} -> out row ${String(out.excelRow).padStart(4)}   [${why}]`);
  console.log(`        group=${JSON.stringify(t(out.o['OEM GROUP']))} family=${JSON.stringify(t(out.o['ENGINE FAMILY']))} status=${JSON.stringify(t(out.o.Status))}`);
  console.log(`        vehicles=${JSON.stringify(t(out.o.Vehicles))} count=${t(out.o['Fitment Count'])} sourceRows=${sf.length} (${sfv.length} with a vehicle)`);
  if (t(out.o['Fitment Note'])) console.log(`        note=${JSON.stringify(t(out.o['Fitment Note']))}`);
  if (t(out.o['Not Found Reason'])) console.log(`        reason=${JSON.stringify(t(out.o['Not Found Reason']).slice(0, 70))}`);
  if (parsed.length) {
    console.log(`        entry[0] out=${JSON.stringify(parsed[0])}`);
    console.log(`                 src=${JSON.stringify({ years: t(sfv[0].o.Years), make: t(sfv[0].o.Make), model: t(sfv[0].o.Model), trim: t(sfv[0].o['Trim / Body']), engine: t(sfv[0].o.Engine), options: t(sfv[0].o.Options) })}`);
    const last = parsed.length - 1;
    if (last > 0) {
      console.log(`        entry[${last}] out=${JSON.stringify(parsed[last])}`);
      console.log(`                 src=${JSON.stringify({ years: t(sfv[last].o.Years), make: t(sfv[last].o.Make), model: t(sfv[last].o.Model), trim: t(sfv[last].o['Trim / Body']), engine: t(sfv[last].o.Engine), options: t(sfv[last].o.Options) })}`);
    }
  }
  for (const p of problems) console.log(`        !! ${p}`);
  console.log('');
}

// ── Summary ──────────────────────────────────────────────────────────────────

const withFitN = outRows.filter((r) => { try { return JSON.parse(t(r.o.Fitment) || '[]').length > 0; } catch { return false; } }).length;
const emptyFitN = outRows.length - withFitN;
const emptyNoReason = outRows.filter((r) => t(r.o.Fitment) === '[]' && t(r.o['Not Found Reason']) === '').length;
const fitAndReason = outRows.filter((r) => t(r.o.Fitment) !== '[]' && t(r.o['Not Found Reason']) !== '').length;
console.log('row-set split');
console.log(`  rows with fitment            ${withFitN}`);
console.log(`  rows with []                 ${emptyFitN}`);
console.log(`  rows with [] and no reason   ${emptyNoReason}   (the scrape-note sentinels: Status "Found", no vehicles published)`);
console.log(`  rows with fitment and reason ${fitAndReason}\n`);

console.log('─'.repeat(78));
console.log(`checks   ${counts.pass} pass · ${counts.warn} warn · ${counts.fail} fail`);
console.log(`spots    ${picked.size} checked · ${spotFail} with a problem`);
console.log(`source   ${srcRows.length} catalog parts · ${srcFit.length} fitment rows · ${srcNf.length} not-found rows`);
console.log(`output   ${outRows.length} rows · ${outHead.length} columns · largest cell ${maxCell} chars`);

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ counts, findings, spots: [...picked.entries()] }, null, 1));
  console.log(`report   ${path.resolve(JSON_OUT)}`);
}

if (counts.fail || spotFail) { console.log('\nVALIDATION FAILED'); process.exit(1); }
console.log(counts.warn ? '\nvalidation passed with warnings' : '\nvalidation passed');
