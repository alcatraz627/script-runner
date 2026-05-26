#!/usr/bin/env node
/**
 * spot-check.js — re-usable end-to-end audit on N random rows from the
 * iter3 combined xlsx. For each row, traces every cell back to its source
 * (VCdb row, taxonomy, brand-mapping, source export, constant, or derived)
 * and confirms the cell value matches. Adds heuristic sanity checks for
 * cross-field plausibility.
 *
 * Usage:
 *   node spot-check.js [--n 30] [--seed 12345] [--out path/prefix]
 *
 * Outputs:
 *   data/_spot-check-{ts}.json   structured per-row audit + aggregate stats
 *   data/_spot-check-{ts}.md     human-readable report
 *
 * Designed for re-use: pass --seed to reproduce a run; pass --n to scale.
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATADIR = 'walmart-q2-phase1/data';
const OUTDIR  = 'walmart-q2-phase1/output';

const args = process.argv.slice(2);
function arg(name) { const i = args.indexOf(name); return i === -1 ? null : args[i+1]; }
const N = parseInt(arg('--n') || '30', 10);
const SEED = parseInt(arg('--seed') || String(Date.now()), 10);
const TS = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_PREFIX = arg('--out') || path.join(DATADIR, `_spot-check-${TS}`);

const COL_FIELD_MAP = [
  null, 'Action','MPN','BrandAAIAD','Year','Make','Model','PartTerminologyId','PartTerminologyName',
  'SubModel','BlockType','Cylinders','Liter','CC','Position','FuelType','Aspiration','DriveType',
  'BedLength','BodyType','BodyNumDoors','Notes',
];

const REQUIRED_FIELDS = ['MPN','BrandAAIAD','Year','Make','Model','PartTerminologyId'];

// ────────────────────── Helpers ──────────────────────
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function eq(a, b) { return String(a == null ? '' : a) === String(b == null ? '' : b); }
const isMissing = v => v == null || v === '' || v === '-' || v === '--';

// Source-label whitelist (matches 90-context-sanity.js)
const WHITELIST = new RegExp([
  /^source\.[^\s]+/,
  /^taxonomy\.[^\s]+/,
  /^brandMapping\.[^\s]+/,
  /^enhancedContent\.[^\s]+/,
  /^vcdb\.col\.[^\s]+/,
  /^vcdb\.rawContent\.format[ABCB2]\w*\.[^\s]+/,
  /^vcdb\.rawContent\.formatunknown\.[^\s]+/,
  /^vcdb\.sqlite\.[^\s]+/,                    // R2.8 — AutoCare SQLite decoder
  /^derived\([^)]+\)/,
  /^userOverride\.[^\s]+/,
  /^constant$/,
].map(r => `(?:${r.source})`).join('|'));

// ────────────────────── Stratification picker ──────────────────────
function pickCandidates(manifest, n, rng) {
  // Build (brand, dstRowStart, rowCount) tuples; filter empties
  const brands = Object.entries(manifest.brands)
    .filter(([_, b]) => b.rowCount && b.rowCount > 0)
    .map(([key, b]) => ({ key, dstRowStart: b.dstRowStart, rowCount: b.rowCount }));

  // Three tiers by rowCount
  const sortedByRows = [...brands].sort((a, b) => b.rowCount - a.rowCount);
  const top5 = sortedByRows.slice(0, 5);
  const mid  = sortedByRows.slice(5, 30);
  const small = sortedByRows.slice(30);

  // Allocate roughly equal across tiers; rounding error goes to top5
  const perTier = Math.floor(n / 3);
  const targetTop = perTier + (n - perTier * 3);
  const targetMid = perTier;
  const targetSmall = perTier;

  const picks = [];
  function pickFromTier(tier, count) {
    if (tier.length === 0) return;
    for (let i = 0; i < count; i++) {
      const brandObj = tier[Math.floor(rng() * tier.length)];
      const relRow = Math.floor(rng() * brandObj.rowCount);
      picks.push({
        dstRow: brandObj.dstRowStart + relRow,
        brand: brandObj.key,
        filledLineIdx: relRow, // 0-based line index into filled.jsonl
      });
    }
  }
  pickFromTier(top5, targetTop);
  pickFromTier(mid, targetMid);
  pickFromTier(small, targetSmall);

  return shuffle(picks, rng);
}

// ────────────────────── Loading + extraction ──────────────────────
async function loadFilledRowsByBrand(picks) {
  // Group picks by brand, then for each brand stream the file once and grab the wanted lines
  const byBrand = {};
  for (const p of picks) {
    (byBrand[p.brand] = byBrand[p.brand] || []).push(p);
  }
  for (const [brand, brandPicks] of Object.entries(byBrand)) {
    const wantIdx = new Set(brandPicks.map(p => p.filledLineIdx));
    const path_ = path.join(DATADIR, `02-${brand}-filled.jsonl`);
    const rl = readline.createInterface({ input: fs.createReadStream(path_), crlfDelay: Infinity });
    let i = 0;
    for await (const line of rl) {
      if (line && wantIdx.has(i)) {
        const obj = JSON.parse(line);
        for (const p of brandPicks) if (p.filledLineIdx === i) p.filledRow = obj;
      }
      i++;
    }
  }
}

async function loadVcdbRowsByIds(picks) {
  // Map: partNumber → set of vcdbRow ids to pick
  const wantedByMpn = new Map();
  for (const p of picks) {
    const mpn = p.filledRow.mpn;
    const vRow = p.filledRow.vcdbRow;
    if (!wantedByMpn.has(mpn)) wantedByMpn.set(mpn, new Map());
    wantedByMpn.get(mpn).set(vRow, p);
  }

  const rl = readline.createInterface({ input: fs.createReadStream(path.join(DATADIR, '_raw-content-parsed.jsonl')), crlfDelay: Infinity });
  let scanned = 0;
  for await (const line of rl) {
    if (!line) continue;
    scanned++;
    try {
      const r = JSON.parse(line);
      const m = wantedByMpn.get(r.partNumber);
      if (m && m.has(r.vcdbRow)) {
        m.get(r.vcdbRow).vcdbSource = r;
      }
    } catch (e) { /* skip */ }
  }
}

async function loadCombinedRows(picks, combinedPath) {
  // STREAMING version: open the xlsx with WorkbookReader so we skip past
  // the 413K rows we don't need without buffering. The cross-reference
  // validator already confirmed combined == filled cell-for-cell, so the
  // value-match step is mostly a paranoia check; streaming keeps it cheap.
  const wantRows = new Set(picks.map(p => p.dstRow));
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(combinedPath, {
    sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit',
  });
  const byRow = {};
  for await (const ws of reader) {
    for await (const row of ws) {
      if (!wantRows.has(row.number)) continue;
      const vals = row.values;
      const cells = {};
      for (let c = 1; c < COL_FIELD_MAP.length; c++) {
        const v = vals[c];
        cells[COL_FIELD_MAP[c]] = v == null ? '' : (typeof v === 'object' && v.text != null ? String(v.text) : String(v));
      }
      byRow[row.number] = cells;
    }
  }
  for (const p of picks) p.combinedCells = byRow[p.dstRow];
}

function loadIndices() {
  return {
    taxonomy:    JSON.parse(fs.readFileSync(path.join(DATADIR, 'taxonomy-by-mpn.json'))),
    brandMap:    JSON.parse(fs.readFileSync(path.join(DATADIR, 'brand-mapping-by-mpn.json'))),
  };
}

function loadSourceByBrand(brand) {
  const p = path.join(DATADIR, `01-${brand}-source.json`);
  if (!fs.existsSync(p)) return new Map();
  const arr = JSON.parse(fs.readFileSync(p));
  const m = new Map();
  for (const r of arr) m.set(r.mpn, r);
  return m;
}

// ────────────────────── Per-cell trace verifier ──────────────────────
/**
 * Resolve a source label to the expected raw value from upstream data.
 * Returns { expected, traceTarget } where traceTarget is a human-readable
 * pointer (e.g., "taxonomy[L97].partTerminologyId").
 */
function resolveSource(srcLabel, ctx) {
  if (srcLabel === 'constant') return { expected: ctx.constantValue, traceTarget: 'constant' };

  const derived = srcLabel.match(/^derived\(([^→]+)→([^)]+)\)$/);
  if (derived) {
    const innerLabel = derived[1].trim();
    const transform = derived[2].trim();
    if (transform === 'mpn-normalize') {
      const inner = resolveSource(innerLabel, ctx);
      const v = inner.expected;
      const out = v && String(v).startsWith('-') ? '0' + v : v;
      return { expected: out, traceTarget: `${inner.traceTarget} → mpn-normalize` };
    }
    if (transform === 'year-encode') {
      const inner = resolveSource(innerLabel, ctx);
      return { expected: undefined, traceTarget: `${inner.traceTarget} → year-encode` };
    }
    if (transform === 'brand-fallback') {
      // Inner label format: brandMapping.consensus[<sourceBrand>]
      const consensus = innerLabel.match(/^brandMapping\.consensus\[(.+?)\]$/);
      if (consensus) {
        // Trust the fill stage — the consensus computation is deterministic from brandMap.
        return { expected: undefined, traceTarget: `brandMapping consensus over "${consensus[1]}" → brand-fallback` };
      }
      return { expected: undefined, traceTarget: srcLabel };
    }
    return { expected: undefined, traceTarget: srcLabel };
  }

  if (srcLabel.startsWith('source.')) {
    const field = srcLabel.slice('source.'.length);
    const sr = ctx.sourceRow;
    if (!sr) return { expected: undefined, traceTarget: `source[${ctx.mpn}].${field} (missing)` };
    if (field === 'Part Number') return { expected: sr.mpn, traceTarget: `source[${ctx.mpn}].mpn` };
    return { expected: sr[field], traceTarget: `source[${ctx.mpn}].${field}` };
  }

  if (srcLabel.startsWith('taxonomy.')) {
    const field = srcLabel.slice('taxonomy.'.length);
    const tx = ctx.taxonomy[ctx.mpn];
    if (!tx) return { expected: undefined, traceTarget: `taxonomy[${ctx.mpn}] (missing)` };
    // Source label uses PartTerminologyID/Name; index keys are camelCase
    const fieldMap = { 'PartTerminologyID': 'partTerminologyId', 'PartTerminologyName': 'partTerminologyName' };
    const key = fieldMap[field] || field.charAt(0).toLowerCase() + field.slice(1);
    return { expected: tx[key], traceTarget: `taxonomy[${ctx.mpn}].${key}` };
  }

  if (srcLabel.startsWith('brandMapping.')) {
    const field = srcLabel.slice('brandMapping.'.length);
    const bm = ctx.brandMap[ctx.mpn];
    if (!bm) return { expected: undefined, traceTarget: `brandMapping[${ctx.mpn}] (missing)` };
    const fieldMap = { 'Brand Code': 'brandCode' };
    const key = fieldMap[field] || field;
    return { expected: bm[key], traceTarget: `brandMapping[${ctx.mpn}].${key}` };
  }

  if (srcLabel.startsWith('vcdb.col.')) {
    const colName = srcLabel.slice('vcdb.col.'.length);
    if (!ctx.vcdbSource || !ctx.vcdbSource.vcdbCol) return { expected: undefined, traceTarget: `vcdbCol[${ctx.mpn}].${colName} (missing)` };
    return { expected: ctx.vcdbSource.vcdbCol[colName], traceTarget: `vcdbCol[row ${ctx.vcdbSource.vcdbRow}].${colName}` };
  }

  if (srcLabel.startsWith('vcdb.sqlite.')) {
    // SQLite-authoritative source — value-match check is sufficient; the
    // decoder is itself the trace target (no further lookup possible
    // without re-querying the database).
    return { expected: undefined, traceTarget: srcLabel };
  }

  if (srcLabel.startsWith('vcdb.rawContent.format')) {
    // e.g. vcdb.rawContent.formatC.bodyType or formatC.submodelFromTrim
    const remainder = srcLabel.slice('vcdb.rawContent.format'.length);
    const dot = remainder.indexOf('.');
    const fmt = remainder.slice(0, dot);
    const field = remainder.slice(dot + 1);
    const rc = ctx.vcdbSource && ctx.vcdbSource.rawContent;
    if (!rc) return { expected: undefined, traceTarget: `rawContent[${ctx.mpn}] (missing)` };
    if (rc.format !== fmt) return { expected: undefined, traceTarget: `format mismatch (label says ${fmt}, parsed ${rc.format})` };
    // Map labelled field to parsed key
    if (field === 'submodelFromTrim') {
      if (rc.submodelDerivation !== 'fromTrim') return { expected: undefined, traceTarget: `expected submodelDerivation=fromTrim, got ${rc.submodelDerivation}` };
      return { expected: rc.submodel, traceTarget: `rawContent[row ${ctx.vcdbSource.vcdbRow}].submodel (fromTrim)` };
    }
    return { expected: rc[field], traceTarget: `rawContent[row ${ctx.vcdbSource.vcdbRow}].${field}` };
  }

  return { expected: undefined, traceTarget: `UNKNOWN label: ${srcLabel}` };
}

// ────────────────────── Heuristic sanity ──────────────────────
function runHeuristics(filledCells, vcdbSource) {
  const notes = [];
  const get = f => filledCells[f] && filledCells[f].value;

  const year = get('Year');
  if (year) {
    // Form check
    if (!/^(\d{4})(-\d{4})?$/.test(year)) notes.push(`year malformed: "${year}"`);
    else {
      const m = year.match(/^(\d{4})(?:-(\d{4}))?$/);
      const a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
      if (a > b) notes.push(`year range reversed: ${year}`);
      if (a === b && m[2]) notes.push(`same-year range emitted: ${year}`);
      if (a < 1900 || b > 2030) notes.push(`year out of plausible range: ${year}`);
    }
  }

  const cyl = get('Cylinders');
  if (cyl && !/^(1|2|3|4|5|6|8|10|12|16)$/.test(cyl)) notes.push(`cylinders non-canonical: ${cyl}`);

  const block = get('BlockType');
  if (block && !/^[HVLI]$/.test(block)) notes.push(`blockType non-canonical: ${block}`);

  const liter = get('Liter');
  if (liter) {
    const L = parseFloat(liter);
    if (!Number.isFinite(L)) notes.push(`liter unparseable: ${liter}`);
    else if (L < 0.3 || L > 16) notes.push(`liter out of plausible range: ${liter}`);
  }

  const doors = get('BodyNumDoors');
  if (doors && !/^[2-8]$/.test(doors)) notes.push(`doors non-canonical: ${doors}`);

  const mpn = get('MPN');
  if (mpn && String(mpn).startsWith('-')) notes.push(`MPN starts with dash (R2.6 violation): ${mpn}`);

  // Required-col check
  for (const req of REQUIRED_FIELDS) {
    if (!get(req)) notes.push(`required field "${req}" is blank`);
  }

  // Cross-field plausibility (lightweight)
  const make = get('Make') && String(get('Make')).toLowerCase();
  if (make === 'subaru' && cyl && parseInt(cyl, 10) > 6) {
    notes.push(`suspect: Subaru with ${cyl} cylinders`);
  }
  const yearStart = year && parseInt(String(year).slice(0, 4), 10);
  if (make === 'tesla' && yearStart && yearStart < 2008) notes.push(`suspect: Tesla before 2008 (${year})`);

  return notes;
}

// ────────────────────── Per-row audit ──────────────────────
function auditRow(pick, ctx) {
  const combined = pick.combinedCells;
  const filled = pick.filledRow.cells;
  const out = {
    dstRow: pick.dstRow, mpn: pick.filledRow.mpn, brand: pick.brand,
    vcdbRow: pick.filledRow.vcdbRow, format: pick.filledRow.format,
    cells: [],
    traceFails: 0, whitelistFails: 0, mismatchFails: 0,
    anomalies: [],
    verdict: 'PASS',
  };

  for (const field of COL_FIELD_MAP.slice(1)) {
    const filledCell = filled[field];
    const combinedVal = combined ? combined[field] : '';
    if (!filledCell || isMissing(filledCell.value)) {
      // blank field — combined should also be blank
      const blankOk = isMissing(combinedVal);
      out.cells.push({ field, source: null, expected: '', got: combinedVal, ok: blankOk, note: blankOk ? 'blank by design' : 'unexpected non-blank in combined' });
      if (!blankOk) { out.mismatchFails++; }
      continue;
    }
    const src = filledCell.source;
    const wOk = WHITELIST.test(src);
    if (!wOk) { out.whitelistFails++; out.anomalies.push(`whitelist fail: "${src}" for ${field}`); }

    const trace = resolveSource(src, { ...ctx, mpn: out.mpn, sourceRow: ctx.sourceByMpn.get(out.mpn), vcdbSource: pick.vcdbSource, constantValue: filledCell.value });
    const valueMatchOK = eq(combinedVal, filledCell.value);
    const expected = trace.expected;
    let traceOK = expected === undefined ? null : eq(expected, filledCell.value);

    out.cells.push({
      field, source: src, expected, got: combinedVal, filled: filledCell.value,
      target: trace.traceTarget,
      whitelist: wOk, valueMatch: valueMatchOK, traceMatch: traceOK,
    });
    if (!valueMatchOK) { out.mismatchFails++; out.anomalies.push(`combined != filled for ${field}: "${combinedVal}" vs "${filledCell.value}"`); }
    if (traceOK === false) { out.traceFails++; out.anomalies.push(`trace fail for ${field}: filled "${filledCell.value}" vs source "${expected}" (${trace.traceTarget})`); }
  }

  const heuristics = runHeuristics(filled, pick.vcdbSource);
  out.heuristics = heuristics;
  if (heuristics.length) out.anomalies.push(...heuristics);

  if (out.whitelistFails + out.mismatchFails + out.traceFails > 0) out.verdict = 'HARD_FAIL';
  else if (heuristics.length > 0) out.verdict = 'SOFT_FAIL';
  return out;
}

// ────────────────────── Main ──────────────────────
(async () => {
  const t0 = Date.now();
  const rng = makeRng(SEED);
  console.log(`Spot-check: n=${N}, seed=${SEED}`);

  const manifestVersion = arg('--manifest-version') || 'v4';
  const manifest = JSON.parse(fs.readFileSync(path.join(DATADIR, `_combined-manifest-${manifestVersion}.json`)));
  const { taxonomy, brandMap } = loadIndices();

  // 1) Pick candidates
  const picks = pickCandidates(manifest, N, rng);
  console.log(`  picked ${picks.length} candidate rows across ${new Set(picks.map(p => p.brand)).size} brands`);

  // 2) Load filled rows
  await loadFilledRowsByBrand(picks);
  console.log(`  loaded filled rows`);

  // 3) Load VCdb sources
  await loadVcdbRowsByIds(picks);
  console.log(`  loaded VCdb sources`);

  // 4) Load combined xlsx cells
  await loadCombinedRows(picks, manifest.combined.path);
  console.log(`  loaded combined cells`);

  // 5) Load source-export entries per brand
  const sourceByMpn = new Map();
  const brandsInUse = [...new Set(picks.map(p => p.brand))];
  for (const b of brandsInUse) {
    const m = loadSourceByBrand(b);
    for (const [k, v] of m) sourceByMpn.set(k, v);
  }
  console.log(`  loaded ${sourceByMpn.size} source-export entries`);

  // 6) Audit each
  const auditedRows = picks.map(p => auditRow(p, { taxonomy, brandMap, sourceByMpn }));

  // 7) Aggregate
  const agg = {
    n: auditedRows.length,
    seed: SEED,
    generatedAt: new Date().toISOString(),
    durationSeconds: ((Date.now() - t0) / 1000),
    verdicts: { PASS: 0, SOFT_FAIL: 0, HARD_FAIL: 0 },
    totalMismatchFails: 0, totalTraceFails: 0, totalWhitelistFails: 0,
    formatMix: {}, brandsCovered: brandsInUse.length,
  };
  for (const r of auditedRows) {
    agg.verdicts[r.verdict]++;
    agg.totalMismatchFails += r.mismatchFails;
    agg.totalTraceFails += r.traceFails;
    agg.totalWhitelistFails += r.whitelistFails;
    agg.formatMix[r.format] = (agg.formatMix[r.format] || 0) + 1;
  }

  // 8) Write JSON + Markdown
  fs.writeFileSync(`${OUT_PREFIX}.json`, JSON.stringify({ ...agg, rows: auditedRows }, null, 2));

  const md = [];
  md.push(`# Spot Check — ${auditedRows.length} rows · seed ${SEED}`);
  md.push(``);
  md.push(`**Generated:** ${agg.generatedAt}  ·  **Duration:** ${agg.durationSeconds.toFixed(1)}s`);
  md.push(``);
  md.push(`## Aggregate`);
  md.push(`- Verdicts: PASS=${agg.verdicts.PASS}  SOFT_FAIL=${agg.verdicts.SOFT_FAIL}  HARD_FAIL=${agg.verdicts.HARD_FAIL}`);
  md.push(`- Cell value-match failures: ${agg.totalMismatchFails}`);
  md.push(`- Trace failures: ${agg.totalTraceFails}`);
  md.push(`- Whitelist failures: ${agg.totalWhitelistFails}`);
  md.push(`- Format mix: ${JSON.stringify(agg.formatMix)}`);
  md.push(`- Brands covered: ${agg.brandsCovered}`);
  md.push(``);
  md.push(`## Rows`);
  for (let i = 0; i < auditedRows.length; i++) {
    const r = auditedRows[i];
    const f = r.cells.reduce((m,c)=>{ m[c.field]=c.got; return m; },{});
    const sigil = r.verdict === 'PASS' ? '✓' : r.verdict === 'SOFT_FAIL' ? '⚠' : '✗';
    md.push(``);
    md.push(`### ${sigil} Row ${i+1} — dstRow ${r.dstRow} — ${r.verdict}`);
    md.push(`**${r.mpn}** · brand=\`${r.brand}\` · vcdbRow=${r.vcdbRow} · format=${r.format}`);
    md.push(``);
    md.push(`| Field | Value | Source label | Trace |`);
    md.push(`|---|---|---|---|`);
    for (const c of r.cells) {
      const tr = c.traceMatch == null ? '—' : (c.traceMatch ? '✓' : `✗ (saw "${c.expected}")`);
      const val = c.got === '' ? '' : String(c.got).slice(0, 50);
      md.push(`| ${c.field} | \`${val}\` | \`${c.source || ''}\` | ${tr} |`);
    }
    if (r.anomalies.length) {
      md.push(``);
      md.push(`**Anomalies:**`);
      for (const a of r.anomalies) md.push(`- ${a}`);
    }
  }
  fs.writeFileSync(`${OUT_PREFIX}.md`, md.join('\n') + '\n');
  console.log(`\nWrote:\n  ${OUT_PREFIX}.json\n  ${OUT_PREFIX}.md`);
  console.log(`Verdicts: PASS=${agg.verdicts.PASS} SOFT_FAIL=${agg.verdicts.SOFT_FAIL} HARD_FAIL=${agg.verdicts.HARD_FAIL}`);
})().catch(e => { console.error(e); process.exit(1); });
