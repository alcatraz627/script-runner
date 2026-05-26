#!/usr/bin/env node
/**
 * 20-fill.js — Q2 Phase 1, brand-parameterized
 *   node 20-fill.js --brand <brandKey> [--limit N]
 *   node 20-fill.js --brand all
 *
 * Joins source MPNs (01-{brand}-source.json) with the materialized VCdb
 * lookup (_raw-content-parsed.jsonl). For each matched VCdb row:
 *   - Year is run through lib/year-encode.js → N row-emissions per VCdb row
 *   - Every Q2 field is resolved via lib/source-priority.js → { value, source }
 *   - Required-col gate dropped here (R0.2)
 *   - Unknown-format VCdb rows dropped (T4)
 *
 * Output: 02-{brand}-filled.jsonl  (JSONL because row count is large)
 *         02-{brand}-filled.meta.json (R2.5 sidecar)
 *         02-{brand}-dropped.jsonl (per-row drop reasons)
 *         02-{brand}-dropped-mpn.jsonl (per-MPN — entire MPN had 0 emissions)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const FILL_VERSION = '1.0.0';
const BRANDS = require('./brands.config.js');
const { encodeYearField } = require('./lib/year-encode.js');
const { resolveAllFields } = require('./lib/source-priority.js');
const { normalizeMpn, wasNormalized } = require('./lib/mpn-normalize.js');
const { buildConsensusMap, getFallbackCode } = require('./lib/brand-fallback.js');
const { VcdbSqliteDecoder } = require('./lib/vcdb-sqlite-decoder.js');

const VCDB_JSONL = 'walmart-q2-phase1/data/_raw-content-parsed.jsonl';
const OUTDIR = 'walmart-q2-phase1/data';

const args = process.argv.slice(2);
function arg(name) { const i = args.indexOf(name); return i === -1 ? null : args[i+1]; }
const brandArg = (arg('--brand') || '').toLowerCase();
const limit = arg('--limit') ? parseInt(arg('--limit'), 10) : Infinity;
if (!brandArg) { console.error('Usage: 20-fill.js --brand <key|all> [--limit N]'); process.exit(1); }
const brandKeys = brandArg === 'all' ? Object.keys(BRANDS) : [brandArg];
for (const k of brandKeys) if (!BRANDS[k]) { console.error(`Unknown brand "${k}"`); process.exit(1); }

const REQUIRED_FIELDS = ['MPN', 'BrandAAIAD', 'Year', 'Make', 'Model', 'PartTerminologyId'];
const Q2_FIELDS = [
  'Action','MPN','BrandAAIAD','Year','Make','Model','PartTerminologyId','PartTerminologyName',
  'SubModel','BlockType','Cylinders','Liter','CC','Position','FuelType','Aspiration',
  'DriveType','BedLength','BodyType','BodyNumDoors','Notes',
];

const sha256File = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// Load indices once (R0.4: re-read at start of stage)
const taxonomy = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'taxonomy-by-mpn.json')));
const brandMap = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'brand-mapping-by-mpn.json')));
const brandConsensus = buildConsensusMap(brandMap); // R2.7 fallback lookup

// R2.8 — AutoCare VCdb SQLite decoder (authoritative)
const VCDB_SQLITE = process.env.HOME + '/Downloads/vcdb.sqlite';
const vcdbDb = new VcdbSqliteDecoder(VCDB_SQLITE);

// R2.12 — Year corrections (manual patches) + plausibility filter [1900,2030]
const yearCorrections = (() => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(OUTDIR, '_year-corrections.json')));
    // Index by "brand|mpn" → array of {fromYear, toYear}. Token-level patches
    // handle comma-list inputs (e.g., "2006, 2067" → patch each "2067" token).
    const map = new Map();
    for (const c of data.corrections || []) {
      const k = `${c.brand}|${c.mpn}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push({ fromYear: String(c.fromYear), toYear: String(c.toYear) });
    }
    console.log(`[year-corrections] loaded ${data.corrections?.length || 0} patches across ${map.size} (brand,MPN) keys`);
    return map;
  } catch (e) { return new Map(); }
})();
function isYearPlausibleStr(yearStr) {
  const m = yearStr && yearStr.match(/^(\d{4})(?:-(\d{4}))?$/);
  if (!m) return false;
  const start = +m[1], end = m[2] ? +m[2] : +m[1];
  return start >= 1900 && end <= 2030;
}

// Build VCdb-by-MPN streaming: we need a per-MPN bucket. Stream into memory grouped by MPN.
// 445MB JSONL → ~600MB in-memory; node default heap is enough for our 433K rows.
async function loadVcdbByMpn() {
  const map = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(VCDB_JSONL), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      if (!map.has(r.partNumber)) map.set(r.partNumber, []);
      map.get(r.partNumber).push(r);
    } catch (e) { /* skip malformed */ }
    n++;
  }
  return { map, scannedRows: n };
}

function makeProvenanceCell(value, source) { return { value: String(value), source }; }

function fillOneVcdbRow(srcRow, vcdbRow, q2Indices) {
  // Resolve all rawContent + col-based fields
  const resolved = resolveAllFields(vcdbRow.vcdbCol, vcdbRow.rawContent);

  // Determine raw Year value (from vcdb.col preferred per R1.5 — pre-encode)
  let rawYear = vcdbRow.vcdbCol['Year ID'] || vcdbRow.rawContent.year || vcdbRow.rawContent.yearList || '';

  // R2.12 step 1: apply year corrections (manual patches for upstream typos like
  // prenco/36-8062/2067 → 2007). Token-level substitution so it works on
  // comma-lists like "2006, 2067" (becomes "2006, 2007").
  let yearSourceLabel = 'derived(vcdb.col.Year ID→year-encode)';
  const corrKey = `${srcRow.brand}|${srcRow.mpn}`;
  const patches = yearCorrections.get(corrKey);
  if (patches && patches.length && rawYear) {
    const tokens = String(rawYear).split(/\s*,\s*/);
    let applied = false;
    const appliedPairs = [];
    for (let i = 0; i < tokens.length; i++) {
      for (const p of patches) {
        if (tokens[i] === p.fromYear) {
          tokens[i] = p.toYear;
          appliedPairs.push(`${p.fromYear}→${p.toYear}`);
          applied = true;
        }
      }
    }
    if (applied) {
      rawYear = tokens.join(', ');
      yearSourceLabel = `derived(userOverride.year-corrections[${corrKey};${appliedPairs.join(',')}]→year-encode)`;
    }
  }

  let yearStrings = encodeYearField(rawYear, { brand: srcRow.brand, mpn: srcRow.mpn, vcdbRow: vcdbRow.vcdbRow });

  // R2.12 step 2: filter implausible years (outside 1900-2030).
  const preFilter = yearStrings.slice();
  yearStrings = yearStrings.filter(isYearPlausibleStr);
  const allYearsFiltered = preFilter.length > 0 && yearStrings.length === 0;
  if (allYearsFiltered) {
    // Return a special marker so the caller logs the drop reason precisely.
    return { emissions: [], allYearsFiltered: true, originalYear: rawYear, encodedYears: preFilter };
  }

  // Build emission(s) — one xlsx row per yearString.
  const emissions = [];
  for (const yearStr of yearStrings) {
    const cells = {};

    cells.Action = makeProvenanceCell('A', 'constant');
    // R2.6 MPN normalization: prepend "0" to leading-dash MPNs (Holley
    // carb data has -3310S where canonical is 0-3310S). Internal join key
    // against VCdb is unchanged; only the output cell value gets the fix.
    if (wasNormalized(srcRow.mpn)) {
      cells.MPN = makeProvenanceCell(normalizeMpn(srcRow.mpn), 'derived(source.Part Number→mpn-normalize)');
    } else {
      cells.MPN = makeProvenanceCell(srcRow.mpn, 'source.Part Number');
    }

    // Brand AAIA: prefer direct brand-mapping entry; fall back to
    // consensus brandCode from other MPNs of the same source brand (R2.7).
    const bm = q2Indices.brandMap[srcRow.mpn];
    if (bm && bm.brandCode) {
      cells.BrandAAIAD = makeProvenanceCell(bm.brandCode, 'brandMapping.Brand Code');
    } else {
      const fallback = getFallbackCode(q2Indices.brandConsensus, srcRow.brand);
      if (fallback && fallback.code) {
        cells.BrandAAIAD = makeProvenanceCell(
          fallback.code,
          `derived(brandMapping.consensus[${srcRow.brand}]→brand-fallback)`
        );
      }
    }

    // Year override: resolved.Year may differ from yearStr (yearStr is the encoded run)
    cells.Year = makeProvenanceCell(yearStr, yearSourceLabel);
    if (resolved.Make) cells.Make = resolved.Make;
    if (resolved.Model) cells.Model = resolved.Model;

    // Part Terminology from taxonomy
    const tx = q2Indices.taxonomy[srcRow.mpn];
    if (tx && tx.partTerminologyId) {
      cells.PartTerminologyId = makeProvenanceCell(tx.partTerminologyId, 'taxonomy.PartTerminologyID');
    }
    if (tx && tx.partTerminologyName) {
      cells.PartTerminologyName = makeProvenanceCell(tx.partTerminologyName, 'taxonomy.PartTerminologyName');
    }

    // ── R2.8 SQLite-authoritative decoders (overrides parser-derived values) ──
    const v = vcdbRow.vcdbCol;
    const yearId = v['Year ID'], makeId = v['Make ID'], modelId = v['Model ID'], submodelId = v['SubModel ID'];
    const ebId = v['EngineBase ID'];

    // SubModel: SQLite-decoded (replaces the FK-id-as-name problem)
    if (submodelId) {
      const subName = q2Indices.vcdbDb.subModel(submodelId);
      if (subName) cells.SubModel = makeProvenanceCell(subName, `vcdb.sqlite.SubModel[${submodelId}]`);
    }

    // EngineBase decoded: Liter, CC, Cylinders, BlockType — authoritative
    if (ebId) {
      const eb = q2Indices.vcdbDb.engineBase(ebId);
      if (eb) {
        if (eb.Liter && eb.Liter !== '-')          cells.Liter      = makeProvenanceCell(eb.Liter,      `vcdb.sqlite.EngineBase[${ebId}].Liter`);
        if (eb.CC && eb.CC !== '-')                cells.CC         = makeProvenanceCell(eb.CC,         `vcdb.sqlite.EngineBase[${ebId}].CC`);
        if (eb.Cylinders && eb.Cylinders !== '-')  cells.Cylinders  = makeProvenanceCell(eb.Cylinders,  `vcdb.sqlite.EngineBase[${ebId}].Cylinders`);
        if (eb.BlockType && eb.BlockType !== '-')  cells.BlockType  = makeProvenanceCell(eb.BlockType,  `vcdb.sqlite.EngineBase[${ebId}].BlockType`);
      }
    }

    // Vehicle-traversal cols (R2.8 + R2.9): unanimous OR 2/3 supermajority across matching VCdb vehicles.
    // The decoder lib treats <67% modal as "conflict" → leaves blank.
    const isAccepted = (r) => r && r.value && (r.agreement === 'unanimous' || r.agreement === 'supermajority');
    if (yearId && makeId && modelId && submodelId) {
      const dt = q2Indices.vcdbDb.driveType(yearId, makeId, modelId, submodelId);
      if (isAccepted(dt)) cells.DriveType = makeProvenanceCell(dt.value, `vcdb.sqlite.DriveType[via Vehicle{${yearId},${makeId},${modelId},${submodelId}};${dt.agreement}@${dt.modalPct||100}]`);

      const bl = q2Indices.vcdbDb.bedLength(yearId, makeId, modelId, submodelId);
      if (isAccepted(bl) && bl.value !== 'N/A' && bl.value !== 'N/R') {
        cells.BedLength = makeProvenanceCell(bl.value, `vcdb.sqlite.BedLength[via Vehicle{${yearId},${makeId},${modelId},${submodelId}};${bl.agreement}@${bl.modalPct||100}]`);
      }

      const bt = q2Indices.vcdbDb.bodyType(yearId, makeId, modelId, submodelId);
      if (isAccepted(bt)) cells.BodyType = makeProvenanceCell(bt.value, `vcdb.sqlite.BodyType[via Vehicle{${yearId},${makeId},${modelId},${submodelId}};${bt.agreement}@${bt.modalPct||100}]`);

      const bnd = q2Indices.vcdbDb.bodyNumDoors(yearId, makeId, modelId, submodelId);
      if (isAccepted(bnd) && bnd.value !== 'U/K') {
        cells.BodyNumDoors = makeProvenanceCell(bnd.value, `vcdb.sqlite.BodyNumDoors[via Vehicle{${yearId},${makeId},${modelId},${submodelId}};${bnd.agreement}@${bnd.modalPct||100}]`);
      }

      const ft = q2Indices.vcdbDb.fuelType(yearId, makeId, modelId, submodelId);
      if (isAccepted(ft)) cells.FuelType = makeProvenanceCell(ft.value, `vcdb.sqlite.FuelType[via EngineConfig{${yearId},${makeId},${modelId},${submodelId}};${ft.agreement}@${ft.modalPct||100}]`);

      const asp = q2Indices.vcdbDb.aspiration(yearId, makeId, modelId, submodelId);
      if (isAccepted(asp) && asp.value !== '-') {
        cells.Aspiration = makeProvenanceCell(asp.value, `vcdb.sqlite.Aspiration[via EngineConfig{${yearId},${makeId},${modelId},${submodelId}};${asp.agreement}@${asp.modalPct||100}]`);
      }
    }

    // R2.10 — Fill CC from EngineBase CID when CC was "-" (1 cubic inch = 16.387 cc).
    // Only fires when CC is missing AND CID is populated; deterministic mechanical conversion.
    if (!cells.CC && ebId) {
      const eb = q2Indices.vcdbDb.engineBase(ebId);
      if (eb && eb.CID && eb.CID !== '-' && /^\d+$/.test(eb.CID)) {
        const ccDerived = Math.round(parseInt(eb.CID, 10) * 16.387);
        cells.CC = makeProvenanceCell(String(ccDerived), `derived(vcdb.sqlite.EngineBase[${ebId}].CID×16.387→cc)`);
      }
    }

    // ── Parser-derived values as FALLBACK for any cell the SQLite decoder
    //    couldn't resolve (e.g., Position, which has no SQLite table) ──
    for (const f of ['Position']) {
      if (resolved[f] && !cells[f]) cells[f] = resolved[f];
    }

    emissions.push({
      mpn: srcRow.mpn,
      brand: srcRow.brand,
      vcdbRow: vcdbRow.vcdbRow,
      format: vcdbRow.rawContent.format,
      cells,
    });
  }
  return { emissions, allYearsFiltered: false };
}

function isMissingRequired(emission) {
  const missing = [];
  for (const f of REQUIRED_FIELDS) {
    if (!emission.cells[f] || !emission.cells[f].value) missing.push(f);
  }
  return missing;
}

(async () => {
  console.log('Loading VCdb JSONL into memory (one-time, ~10s)...');
  const t0 = Date.now();
  const { map: vcdbByMpn, scannedRows } = await loadVcdbByMpn();
  console.log(`  ${scannedRows} rows, ${vcdbByMpn.size} distinct MPNs, ${((Date.now() - t0)/1000).toFixed(1)}s\n`);

  const q2Indices = { taxonomy, brandMap, brandConsensus, vcdbDb };

  for (const brand of brandKeys) {
    console.log(`\n${'─'.repeat(70)}\nBrand: ${brand}\n${'─'.repeat(70)}`);
    const srcPath = path.join(OUTDIR, `01-${brand}-source.json`);
    const srcRows = JSON.parse(fs.readFileSync(srcPath));
    const limitedSrc = limit < srcRows.length ? srcRows.slice(0, limit) : srcRows;
    console.log(`Source MPNs: ${limitedSrc.length}${limit < srcRows.length ? ` (limited from ${srcRows.length})` : ''}`);

    const filledPath = path.join(OUTDIR, `02-${brand}-filled.jsonl`);
    const droppedRowPath = path.join(OUTDIR, `02-${brand}-dropped.jsonl`);
    const droppedMpnPath = path.join(OUTDIR, `02-${brand}-dropped-mpn.jsonl`);
    const filledOut = fs.createWriteStream(filledPath);
    const droppedRowOut = fs.createWriteStream(droppedRowPath);
    const droppedMpnOut = fs.createWriteStream(droppedMpnPath);

    let emitted = 0, droppedRows = 0, droppedMpns = 0, skippedUnknownFormat = 0;
    let mpnsWithMatches = 0;
    const formatEmitCounts = {};

    for (const srcRow of limitedSrc) {
      const vcdbRows = vcdbByMpn.get(srcRow.mpn) || [];
      if (vcdbRows.length === 0) {
        droppedMpns++;
        droppedMpnOut.write(JSON.stringify({ mpn: srcRow.mpn, brand, partType: srcRow.partType, reason: 'no VCdb match (likely universal-fit or aftermarket part)' }) + '\n');
        continue;
      }
      mpnsWithMatches++;
      let mpnEmissions = 0;
      for (const vcdbRow of vcdbRows) {
        if (vcdbRow.rawContent.format === 'unknown') {
          skippedUnknownFormat++;
          droppedRowOut.write(JSON.stringify({ mpn: srcRow.mpn, brand, vcdbRow: vcdbRow.vcdbRow, reason: 'unknown raw content format' }) + '\n');
          continue;
        }
        const result = fillOneVcdbRow(srcRow, vcdbRow, q2Indices);
        if (result.allYearsFiltered) {
          droppedRows++;
          droppedRowOut.write(JSON.stringify({ mpn: srcRow.mpn, brand, vcdbRow: vcdbRow.vcdbRow, reason: 'R2.12 year filter: implausible year', originalYear: result.originalYear, encodedYears: result.encodedYears }) + '\n');
          continue;
        }
        for (const e of result.emissions) {
          const miss = isMissingRequired(e);
          if (miss.length) {
            droppedRows++;
            droppedRowOut.write(JSON.stringify({ mpn: srcRow.mpn, brand, vcdbRow: vcdbRow.vcdbRow, reason: 'missing required: ' + miss.join(','), partial: { Year: e.cells.Year?.value, Make: e.cells.Make?.value, Model: e.cells.Model?.value } }) + '\n');
            continue;
          }
          filledOut.write(JSON.stringify(e) + '\n');
          emitted++;
          mpnEmissions++;
          formatEmitCounts[e.format] = (formatEmitCounts[e.format] || 0) + 1;
        }
      }
      if (mpnEmissions === 0) {
        droppedMpns++;
        droppedMpnOut.write(JSON.stringify({ mpn: srcRow.mpn, brand, partType: srcRow.partType, vcdbMatchCount: vcdbRows.length, reason: 'all VCdb matches failed required-col gate or were unknown-format' }) + '\n');
      }
    }
    filledOut.end(); droppedRowOut.end(); droppedMpnOut.end();
    await Promise.all([
      new Promise(r => filledOut.on('close', r)),
      new Promise(r => droppedRowOut.on('close', r)),
      new Promise(r => droppedMpnOut.on('close', r)),
    ]);

    // Sidecar meta
    const meta = {
      fill: { script: '20-fill.js', version: FILL_VERSION },
      brand,
      limit: limit === Infinity ? null : limit,
      generatedAt: new Date().toISOString(),
      stats: {
        sourceMpns: limitedSrc.length,
        mpnsWithVcdbMatches: mpnsWithMatches,
        emittedRows: emitted,
        droppedRows,
        droppedMpns,
        skippedUnknownFormat,
        formatEmitCounts,
      },
      outputs: {
        filled: { path: filledPath, sha256: sha256File(filledPath), bytes: fs.statSync(filledPath).size },
        droppedRows: { path: droppedRowPath, sha256: sha256File(droppedRowPath), bytes: fs.statSync(droppedRowPath).size },
        droppedMpns: { path: droppedMpnPath, sha256: sha256File(droppedMpnPath), bytes: fs.statSync(droppedMpnPath).size },
      },
    };
    fs.writeFileSync(path.join(OUTDIR, `02-${brand}-filled.meta.json`), JSON.stringify(meta, null, 2));

    console.log(`Source MPNs:        ${limitedSrc.length}`);
    console.log(`MPNs w/ VCdb match: ${mpnsWithMatches}  (dropped MPNs: ${droppedMpns})`);
    console.log(`Emitted rows:       ${emitted}`);
    console.log(`Dropped rows:       ${droppedRows} (missing required)`);
    console.log(`Skipped unknown:    ${skippedUnknownFormat}`);
    console.log(`Format emit counts: ${JSON.stringify(formatEmitCounts)}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
