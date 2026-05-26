#!/usr/bin/env node
/**
 * spot-check-parts.js — part-stratified spot-check (250 MPNs, 1-10 rows each).
 *
 * Differences vs spot-check.js:
 *   - Samples by PART (MPN), not by ROW. Default 250 MPNs.
 *   - Per-MPN row count is uniformly random in [1, 10].
 *   - Brand-round-robin: each brand gets one MPN before any brand gets two.
 *   - Produces a per-MPN summary AND cross-cutting analyses (failure
 *     hotspots by brand, format, source-label).
 *
 * Usage:
 *   node spot-check-parts.js [--parts 250] [--max-rows 10] [--seed S]
 *                            [--manifest-version v5]
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATADIR = 'walmart-q2-phase1/data';

const args = process.argv.slice(2);
function arg(name) { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; }
const N_PARTS = parseInt(arg('--parts') || '250', 10);
const MAX_ROWS_PER_PART = parseInt(arg('--max-rows') || '10', 10);
const SEED = parseInt(arg('--seed') || String(Date.now()), 10);
const MANIFEST_VERSION = arg('--manifest-version') || 'v5';
const TS = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_PREFIX = arg('--out') || path.join(DATADIR, `_spot-check-parts-${TS}`);

const COL_FIELD_MAP = [
  null, 'Action','MPN','BrandAAIAD','Year','Make','Model','PartTerminologyId','PartTerminologyName',
  'SubModel','BlockType','Cylinders','Liter','CC','Position','FuelType','Aspiration','DriveType',
  'BedLength','BodyType','BodyNumDoors','Notes',
];

const REQUIRED_FIELDS = ['MPN','BrandAAIAD','Year','Make','Model','PartTerminologyId'];

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
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function eq(a, b) { return String(a == null ? '' : a) === String(b == null ? '' : b); }
const isMissing = v => v == null || v === '' || v === '-' || v === '--';

const WHITELIST = new RegExp([
  /^source\.[^\s]+/,
  /^taxonomy\.[^\s]+/,
  /^brandMapping\.[^\s]+/,
  /^enhancedContent\.[^\s]+/,
  /^vcdb\.col\.[^\s]+/,
  /^vcdb\.rawContent\.format[ABCB2]\w*\.[^\s]+/,
  /^vcdb\.rawContent\.formatunknown\.[^\s]+/,
  /^vcdb\.sqlite\.[^\s]+/,
  /^derived\([^)]+\)/,
  /^userOverride\.[^\s]+/,
  /^constant$/,
].map(r => `(?:${r.source})`).join('|'));

// ─────────────────── Sampling ───────────────────
/**
 * Round-robin part picker: each brand gets one MPN before any brand gets two.
 * Ensures even brand coverage across N picks.
 */
function pickPartsRoundRobin(filledMpnsByBrand, n, rng) {
  const brands = Object.keys(filledMpnsByBrand).filter(b => filledMpnsByBrand[b].length > 0);
  const remaining = new Map(brands.map(b => [b, shuffle(filledMpnsByBrand[b], rng).slice()]));
  const picked = [];
  while (picked.length < n) {
    let advanced = false;
    for (const b of brands) {
      if (picked.length >= n) break;
      const arr = remaining.get(b);
      if (arr.length > 0) {
        picked.push({ brand: b, mpn: arr.pop() });
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  return picked;
}

// ─────────────────── Trace resolver (mirrors spot-check.js) ───────────────────
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
      return { expected: undefined, traceTarget: `${innerLabel} → year-encode` };
    }
    if (transform === 'brand-fallback') {
      const m = innerLabel.match(/^brandMapping\.consensus\[(.+?)\]$/);
      if (m) return { expected: undefined, traceTarget: `brandMapping consensus(${m[1]}) → brand-fallback` };
    }
    if (transform === 'year-encode' && innerLabel.startsWith('userOverride.year-corrections')) {
      // R2.12 patched year — same skip-trace treatment as year-encode
      return { expected: undefined, traceTarget: `${innerLabel} → year-encode (R2.12 patched)` };
    }
    if (transform === 'cc') {
      // derived(vcdb.sqlite.EngineBase[id].CID×16.387→cc) — CID is in inner label
      return { expected: undefined, traceTarget: `${innerLabel} → cc (CID×16.387)` };
    }
    return { expected: undefined, traceTarget: srcLabel };
  }

  if (srcLabel.startsWith('vcdb.sqlite.')) return { expected: undefined, traceTarget: srcLabel };
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
    if (!ctx.vcdbSource || !ctx.vcdbSource.vcdbCol) return { expected: undefined, traceTarget: 'vcdbCol (missing)' };
    return { expected: ctx.vcdbSource.vcdbCol[colName], traceTarget: `vcdbCol.${colName}` };
  }
  if (srcLabel.startsWith('vcdb.rawContent.format')) {
    return { expected: undefined, traceTarget: srcLabel };
  }
  return { expected: undefined, traceTarget: `UNKNOWN: ${srcLabel}` };
}

function runHeuristics(filledCells) {
  const notes = [];
  const get = f => filledCells[f] && filledCells[f].value;
  const year = get('Year');
  if (year) {
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
  for (const req of REQUIRED_FIELDS) {
    if (!get(req)) notes.push(`required field "${req}" is blank`);
  }
  if (cyl === '4' && liter && parseFloat(liter) > 6.0) notes.push(`4-cyl with >6L (possible VCdb quirk): ${liter}L`);
  return notes;
}

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
      const blankOk = isMissing(combinedVal);
      out.cells.push({ field, source: null, expected: '', got: combinedVal, ok: blankOk });
      if (!blankOk) out.mismatchFails++;
      continue;
    }
    const src = filledCell.source;
    const wOk = WHITELIST.test(src);
    if (!wOk) { out.whitelistFails++; out.anomalies.push(`whitelist fail: "${src}"`); }
    const trace = resolveSource(src, { ...ctx, mpn: out.mpn, sourceRow: ctx.sourceByMpn.get(out.mpn), vcdbSource: pick.vcdbSource, constantValue: filledCell.value });
    const valueMatchOK = eq(combinedVal, filledCell.value);
    let traceOK = trace.expected === undefined ? null : eq(trace.expected, filledCell.value);
    out.cells.push({ field, source: src, expected: trace.expected, got: combinedVal, filled: filledCell.value, target: trace.traceTarget, whitelist: wOk, valueMatch: valueMatchOK, traceMatch: traceOK });
    if (!valueMatchOK) { out.mismatchFails++; out.anomalies.push(`combined != filled for ${field}`); }
    if (traceOK === false) { out.traceFails++; out.anomalies.push(`trace fail for ${field}`); }
  }
  const h = runHeuristics(filled);
  out.heuristics = h;
  if (h.length) out.anomalies.push(...h);
  if (out.whitelistFails + out.mismatchFails + out.traceFails > 0) out.verdict = 'HARD_FAIL';
  else if (h.length) out.verdict = 'SOFT_FAIL';
  return out;
}

// ─────────────────── Main ───────────────────
(async () => {
  const t0 = Date.now();
  const rng = makeRng(SEED);
  console.log(`Spot-check (parts mode): n=${N_PARTS}, maxRows=${MAX_ROWS_PER_PART}, seed=${SEED}`);

  const manifest = JSON.parse(fs.readFileSync(path.join(DATADIR, `_combined-manifest-${MANIFEST_VERSION}.json`)));
  const taxonomy = JSON.parse(fs.readFileSync(path.join(DATADIR, 'taxonomy-by-mpn.json')));
  const brandMap = JSON.parse(fs.readFileSync(path.join(DATADIR, 'brand-mapping-by-mpn.json')));

  // 1) Discover MPNs per brand by scanning filled.jsonl (also captures line-index → dstRow)
  console.log('Scanning filled JSONLs for MPN distribution...');
  const filledMpnsByBrand = {};
  const mpnLinesByBrandMpn = new Map(); // "brand|mpn" → [lineIdx, ...]
  for (const [brand, info] of Object.entries(manifest.brands)) {
    if (!info.filledPath || info.rowCount === 0) continue;
    filledMpnsByBrand[brand] = [];
    const seen = new Set();
    let lineIdx = 0;
    const rl = readline.createInterface({ input: fs.createReadStream(info.filledPath), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) { lineIdx++; continue; }
      try {
        const r = JSON.parse(line);
        const key = `${brand}|${r.mpn}`;
        if (!seen.has(r.mpn)) { filledMpnsByBrand[brand].push(r.mpn); seen.add(r.mpn); }
        if (!mpnLinesByBrandMpn.has(key)) mpnLinesByBrandMpn.set(key, []);
        mpnLinesByBrandMpn.get(key).push({ lineIdx, dstRow: info.dstRowStart + lineIdx });
      } catch (e) {}
      lineIdx++;
    }
  }
  const totalMpns = Object.values(filledMpnsByBrand).reduce((s, a) => s + a.length, 0);
  console.log(`Found ${totalMpns} distinct MPNs across ${Object.keys(filledMpnsByBrand).length} brands`);

  // 2) Pick N MPNs round-robin across brands
  const pickedParts = pickPartsRoundRobin(filledMpnsByBrand, N_PARTS, rng);
  console.log(`Picked ${pickedParts.length} MPNs across ${new Set(pickedParts.map(p => p.brand)).size} brands`);

  // 3) For each picked MPN, sample 1..MAX_ROWS_PER_PART rows
  const rowPicks = []; // [{ brand, mpn, lineIdx, dstRow }]
  for (const part of pickedParts) {
    const key = `${part.brand}|${part.mpn}`;
    const allLines = mpnLinesByBrandMpn.get(key);
    if (!allLines || allLines.length === 0) continue;
    const k = Math.max(1, Math.min(MAX_ROWS_PER_PART, Math.floor(rng() * MAX_ROWS_PER_PART) + 1));
    const sample = shuffle(allLines, rng).slice(0, Math.min(k, allLines.length));
    for (const ln of sample) rowPicks.push({ brand: part.brand, mpn: part.mpn, lineIdx: ln.lineIdx, dstRow: ln.dstRow });
  }
  console.log(`Sampled ${rowPicks.length} rows total (avg ${(rowPicks.length / pickedParts.length).toFixed(1)} per part)`);

  // 4) Load filled rows: group by brand, scan each brand once
  const wantedLineIdxByBrand = new Map();
  for (const p of rowPicks) {
    if (!wantedLineIdxByBrand.has(p.brand)) wantedLineIdxByBrand.set(p.brand, new Map());
    wantedLineIdxByBrand.get(p.brand).set(p.lineIdx, p);
  }
  for (const [brand, lineMap] of wantedLineIdxByBrand) {
    const fp = path.join(DATADIR, `02-${brand}-filled.jsonl`);
    const rl = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity });
    let i = 0;
    for await (const line of rl) {
      if (lineMap.has(i)) {
        try { lineMap.get(i).filledRow = JSON.parse(line); } catch (e) {}
      }
      i++;
    }
  }

  // 5) Load VCdb sources for the picks
  const wantedVcdbByMpn = new Map();
  for (const p of rowPicks) {
    const k = p.mpn;
    if (!wantedVcdbByMpn.has(k)) wantedVcdbByMpn.set(k, new Map());
    if (p.filledRow) wantedVcdbByMpn.get(k).set(p.filledRow.vcdbRow, p);
  }
  const rl2 = readline.createInterface({ input: fs.createReadStream(path.join(DATADIR, '_raw-content-parsed.jsonl')), crlfDelay: Infinity });
  for await (const line of rl2) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      const m = wantedVcdbByMpn.get(r.partNumber);
      if (m && m.has(r.vcdbRow)) m.get(r.vcdbRow).vcdbSource = r;
    } catch (e) {}
  }
  console.log('Loaded filled rows + VCdb sources');

  // 6) Stream the combined xlsx; extract just the wanted dst-rows
  const wantedDst = new Set(rowPicks.map(p => p.dstRow));
  const combinedByRow = {};
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(manifest.combined.path, {
    sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit',
  });
  for await (const ws of reader) {
    for await (const row of ws) {
      if (!wantedDst.has(row.number)) continue;
      const vals = row.values;
      const cells = {};
      for (let c = 1; c < COL_FIELD_MAP.length; c++) {
        const v = vals[c];
        cells[COL_FIELD_MAP[c]] = v == null ? '' : (typeof v === 'object' && v.text != null ? String(v.text) : String(v));
      }
      combinedByRow[row.number] = cells;
    }
  }
  for (const p of rowPicks) p.combinedCells = combinedByRow[p.dstRow];

  // 7) Load source-export entries per brand
  const sourceByMpn = new Map();
  for (const brand of new Set(rowPicks.map(p => p.brand))) {
    const sp = path.join(DATADIR, `01-${brand}-source.json`);
    if (!fs.existsSync(sp)) continue;
    for (const r of JSON.parse(fs.readFileSync(sp))) sourceByMpn.set(r.mpn, r);
  }

  // 8) Audit each row
  const audited = rowPicks.filter(p => p.filledRow).map(p => auditRow(p, { taxonomy, brandMap, sourceByMpn }));

  // 9) Aggregate
  const agg = {
    n_parts: pickedParts.length,
    n_rows: audited.length,
    seed: SEED, manifestVersion: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    durationSeconds: ((Date.now() - t0) / 1000),
    verdicts: { PASS: 0, SOFT_FAIL: 0, HARD_FAIL: 0 },
    totalMismatchFails: 0, totalTraceFails: 0, totalWhitelistFails: 0,
    formatMix: {}, brandsCovered: new Set(),
    perPart: {},
    sourceLabelHistogram: {},
    heuristicHistogram: {},
    failingMpns: new Set(),
  };
  for (const r of audited) {
    agg.verdicts[r.verdict]++;
    agg.totalMismatchFails += r.mismatchFails;
    agg.totalTraceFails += r.traceFails;
    agg.totalWhitelistFails += r.whitelistFails;
    agg.formatMix[r.format] = (agg.formatMix[r.format] || 0) + 1;
    agg.brandsCovered.add(r.brand);
    const key = `${r.brand}|${r.mpn}`;
    if (!agg.perPart[key]) agg.perPart[key] = { brand: r.brand, mpn: r.mpn, rows: 0, fail: 0, soft: 0 };
    agg.perPart[key].rows++;
    if (r.verdict === 'HARD_FAIL') { agg.perPart[key].fail++; agg.failingMpns.add(r.mpn); }
    else if (r.verdict === 'SOFT_FAIL') agg.perPart[key].soft++;
    for (const c of r.cells) {
      if (c.source) agg.sourceLabelHistogram[c.source] = (agg.sourceLabelHistogram[c.source] || 0) + 1;
    }
    for (const h of r.heuristics || []) {
      const key = h.split(':')[0];
      agg.heuristicHistogram[key] = (agg.heuristicHistogram[key] || 0) + 1;
    }
  }
  agg.brandsCovered = agg.brandsCovered.size;
  agg.failingMpns = [...agg.failingMpns];

  // 10) Write JSON + Markdown
  fs.writeFileSync(`${OUT_PREFIX}.json`, JSON.stringify({ ...agg, rows: audited }, null, 2));

  // Per-part summary
  const partsByBrand = {};
  for (const p of Object.values(agg.perPart)) {
    if (!partsByBrand[p.brand]) partsByBrand[p.brand] = [];
    partsByBrand[p.brand].push(p);
  }

  const md = [];
  md.push(`# Parts Spot-Check — ${agg.n_parts} MPNs, ${agg.n_rows} rows · seed ${SEED}`);
  md.push(``);
  md.push(`Generated: ${agg.generatedAt}  ·  Duration: ${agg.durationSeconds.toFixed(1)}s`);
  md.push(``);
  md.push(`## Aggregate`);
  md.push(`- Verdicts: **PASS=${agg.verdicts.PASS}**  SOFT=${agg.verdicts.SOFT_FAIL}  HARD=${agg.verdicts.HARD_FAIL}`);
  md.push(`- Mismatch / trace / whitelist failures: ${agg.totalMismatchFails} / ${agg.totalTraceFails} / ${agg.totalWhitelistFails}`);
  md.push(`- Brands covered: ${agg.brandsCovered}`);
  md.push(`- Format mix: ${JSON.stringify(agg.formatMix)}`);
  md.push(`- Avg rows per part: ${(agg.n_rows / agg.n_parts).toFixed(2)}`);
  md.push(``);
  md.push(`## Top source labels (most-used)`);
  const topSrc = Object.entries(agg.sourceLabelHistogram).sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [lbl, c] of topSrc) md.push(`- \`${lbl}\`  ×${c}`);
  md.push(``);
  if (Object.keys(agg.heuristicHistogram).length) {
    md.push(`## Heuristic violations`);
    for (const [k, c] of Object.entries(agg.heuristicHistogram).sort((a, b) => b[1] - a[1])) md.push(`- ${k}: ${c}`);
    md.push(``);
  }
  md.push(`## Per-brand pass summary`);
  md.push(`| Brand | MPNs sampled | Rows | PASS | SOFT | HARD |`);
  md.push(`|---|---|---|---|---|---|`);
  for (const [brand, parts] of Object.entries(partsByBrand).sort((a, b) => b[1].length - a[1].length)) {
    const totalRows = parts.reduce((s, p) => s + p.rows, 0);
    const fail = parts.reduce((s, p) => s + p.fail, 0);
    const soft = parts.reduce((s, p) => s + p.soft, 0);
    const pass = totalRows - fail - soft;
    md.push(`| ${brand} | ${parts.length} | ${totalRows} | ${pass} | ${soft} | ${fail} |`);
  }
  md.push(``);
  md.push(`## Failing MPNs (HARD_FAIL only)`);
  if (agg.failingMpns.length === 0) md.push(`*(none)*`);
  else for (const m of agg.failingMpns) md.push(`- ${m}`);
  md.push(``);

  // Sample of 10 row details
  md.push(`## 10 random sampled rows in detail`);
  const sampleRows = shuffle(audited, rng).slice(0, 10);
  for (const r of sampleRows) {
    const sigil = r.verdict === 'PASS' ? '✓' : r.verdict === 'SOFT_FAIL' ? '⚠' : '✗';
    md.push(``);
    md.push(`### ${sigil} ${r.mpn} (${r.brand}) — dstRow ${r.dstRow}`);
    md.push(`format=${r.format}  ·  verdict=${r.verdict}`);
    md.push(``);
    md.push(`| Field | Value | Source |`);
    md.push(`|---|---|---|`);
    for (const c of r.cells) {
      if (!c.got && !c.source) continue;
      const v = c.got === '' ? '*(blank)*' : `\`${String(c.got).slice(0, 60)}\``;
      md.push(`| ${c.field} | ${v} | \`${c.source || ''}\` |`);
    }
    if (r.anomalies.length) {
      md.push(``);
      md.push(`Anomalies:`);
      for (const a of r.anomalies) md.push(`- ${a}`);
    }
  }
  fs.writeFileSync(`${OUT_PREFIX}.md`, md.join('\n') + '\n');

  console.log(`\nWrote:`);
  console.log(`  ${OUT_PREFIX}.json`);
  console.log(`  ${OUT_PREFIX}.md`);
  console.log(`\nVerdicts: PASS=${agg.verdicts.PASS} SOFT=${agg.verdicts.SOFT_FAIL} HARD=${agg.verdicts.HARD_FAIL}`);
  console.log(`Total: ${agg.n_rows} rows · ${agg.n_parts} parts · ${agg.brandsCovered} brands`);
})().catch(e => { console.error(e); process.exit(1); });
