#!/usr/bin/env node
/**
 * Materialize parsed VCdb Raw Content for ALL rows into a downstream-consumable
 * lookup. Implements R2.4 / R2.5 of validation-rules.claude.md:
 *   - one parsed record per VCdb row, written to JSONL (streamable + greppable)
 *   - sidecar .meta.json with input sha256, parser version, generatedAt,
 *     row counts, format distribution, per-field coverage
 *   - deterministic: same input + same parser version → byte-identical output
 *
 * Input:  ~/Downloads/Walmart Reference/Walmart_VCdb Mapping_vf.xlsx
 * Output: walmart-q2-phase1/data/_raw-content-parsed.jsonl
 *         walmart-q2-phase1/data/_raw-content-parsed.meta.json
 *
 * Downstream stages MUST read the JSONL — never the original xlsx.
 *
 * Usage: node 04b-materialize-raw-content.js
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { PARSER_VERSION } = require('./lib/raw-content-parser.js');
const HOME = process.env.HOME;
const VCDB = `${HOME}/Downloads/Walmart Reference/Walmart_VCdb Mapping_vf.xlsx`;
const OUT_JSONL = 'walmart-q2-phase1/data/_raw-content-parsed.jsonl';
const OUT_META = 'walmart-q2-phase1/data/_raw-content-parsed.meta.json';

// Reuse the parser from 04-extract-raw-content.js by inlining it. (Keeping
// extraction logic in one place across two scripts would be cleaner; inlining
// guarantees the materialized artifact is self-contained for this run.)
const { parseRawContent } = require('./lib/raw-content-parser.js');

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text);
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.result != null) return String(v.result);
  }
  return String(v);
}

function sha256File(p) {
  const buf = fs.readFileSync(p);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

(async () => {
  console.log(`Materializing Raw Content from: ${VCDB}`);
  const inputSize = fs.statSync(VCDB).size;
  const inputSha = sha256File(VCDB);
  console.log(`  size=${(inputSize / 1024 / 1024).toFixed(1)}MB  sha256=${inputSha.slice(0, 16)}...`);

  fs.mkdirSync(path.dirname(OUT_JSONL), { recursive: true });
  const out = fs.createWriteStream(OUT_JSONL, { encoding: 'utf8' });

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(VCDB, {
    sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit',
  });

  const FIELDS = ['year','make','model','submodel','trim','liter','cc','cid','cylinders','blockType','aspiration','fuelType','bodyType','bodyNumDoors','position','fitmentNotes','yearList'];
  const formatCount = {};
  const fieldCount = Object.fromEntries(FIELDS.map(f => [f, 0]));
  const submodelFromTrimCount = { yes: 0, no: 0 };
  let totalRows = 0;
  const t0 = Date.now();

  for await (const ws of reader) {
    let headers = null;
    let mpnCol = -1, rawCol = -1;
    // Capture full row → object for the downstream lookup. We keep all VCdb
    // structured columns AS WELL — fill stage uses source-priority rule to
    // pick between vcdb.col.X and vcdb.rawContent.X.
    for await (const row of ws) {
      if (!headers) {
        headers = row.values.slice(1).map(cellText);
        mpnCol = headers.findIndex(h => /^part number$/i.test((h||'').trim()));
        rawCol = headers.findIndex(h => /^raw content$/i.test((h||'').trim()));
        if (mpnCol < 0 || rawCol < 0) {
          console.error('Header parse failed:', headers);
          process.exit(1);
        }
        console.log(`Headers OK. mpnCol=${mpnCol+1} rawCol=${rawCol+1}`);
        continue;
      }
      totalRows++;
      const vals = row.values;
      const mpn = cellText(vals[mpnCol + 1]).trim();
      const raw = cellText(vals[rawCol + 1]).trim();

      // Build VCdb structured cols snapshot (named map)
      const vcdbCol = {};
      for (let i = 0; i < headers.length; i++) {
        const v = cellText(vals[i + 1]).trim();
        if (v) vcdbCol[headers[i]] = v;
      }

      const parsed = parseRawContent(raw);

      // Coverage counters
      formatCount[parsed.format] = (formatCount[parsed.format] || 0) + 1;
      for (const f of FIELDS) if (parsed[f]) fieldCount[f]++;
      if (parsed.submodelDerivation === 'fromTrim') submodelFromTrimCount.yes++;
      else if (parsed.submodel) submodelFromTrimCount.no++;

      const record = {
        vcdbRow: row.number,
        partNumber: mpn,
        vcdbCol,
        rawContent: parsed,
      };
      out.write(JSON.stringify(record) + '\n');

      if (totalRows % 50000 === 0) {
        const dt = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`  ${totalRows} rows · ${dt}s · ${(totalRows / (Date.now() - t0) * 1000).toFixed(0)} rows/s`);
      }
    }
  }
  out.end();
  await new Promise(r => out.on('close', r));

  const outSize = fs.statSync(OUT_JSONL).size;
  const outSha = sha256File(OUT_JSONL);

  const meta = {
    parser: { script: '04b-materialize-raw-content.js', version: PARSER_VERSION },
    input: { path: VCDB, sizeBytes: inputSize, sha256: inputSha },
    output: { path: OUT_JSONL, sizeBytes: outSize, sha256: outSha, rowCount: totalRows },
    generatedAt: new Date().toISOString(),
    durationSeconds: ((Date.now() - t0) / 1000),
    stats: {
      formatCount,
      fieldCoverage: Object.fromEntries(
        Object.entries(fieldCount).map(([f, c]) => [f, { count: c, pct: +((c / totalRows) * 100).toFixed(2) }])
      ),
      submodelDerivation: submodelFromTrimCount,
    },
  };
  fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2));

  console.log(`\n${'='.repeat(70)}\nDone in ${meta.durationSeconds.toFixed(1)}s`);
  console.log(`JSONL: ${OUT_JSONL}  (${(outSize / 1024 / 1024).toFixed(1)}MB, ${totalRows} rows)`);
  console.log(`Meta:  ${OUT_META}`);
  console.log(`Format distribution: ${JSON.stringify(formatCount)}`);
  console.log(`Submodel derivation: directly-extracted=${submodelFromTrimCount.no}, from-trim-heuristic=${submodelFromTrimCount.yes}`);
})().catch(e => { console.error(e); process.exit(1); });
