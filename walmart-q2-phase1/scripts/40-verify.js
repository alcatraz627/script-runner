#!/usr/bin/env node
/**
 * 40-verify.js — Excel readback verifier (R1.3).
 *   node 40-verify.js --brand <key|all> [--version v1]
 *
 * Re-opens each per-brand xlsx, walks every data cell (rows 4..N+3, cols 1..21),
 * compares to the corresponding 02-{brand}-filled.jsonl entry. 0 mismatches
 * required; non-zero → hard fail per R1.3.
 *
 * Output: data/_audit-verify-{brand}.json (mismatch report + counts)
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const BRANDS = require('./brands.config.js');
const DATADIR = 'walmart-q2-phase1/data';
const OUTDIR  = 'walmart-q2-phase1/output';

const args = process.argv.slice(2);
function arg(name) { const i = args.indexOf(name); return i === -1 ? null : args[i+1]; }
const brandArg = (arg('--brand') || '').toLowerCase();
const versionTag = arg('--version') || 'v1';
if (!brandArg) { console.error('Usage: 40-verify.js --brand <key|all> [--version v1]'); process.exit(1); }
const brandKeys = brandArg === 'all' ? Object.keys(BRANDS) : [brandArg];

const COL_FIELD_MAP = [
  null, 'Action','MPN','BrandAAIAD','Year','Make','Model','PartTerminologyId','PartTerminologyName',
  'SubModel','BlockType','Cylinders','Liter','CC','Position','FuelType','Aspiration','DriveType',
  'BedLength','BodyType','BodyNumDoors','Notes',
];

async function loadFilledJsonl(p) {
  const out = [];
  const rl = readline.createInterface({ input: fs.createReadStream(p), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* skip */ }
  }
  return out;
}

(async () => {
  let anyFail = false;
  for (const brand of brandKeys) {
    const xlsxPath = path.join(OUTDIR, `walmart-loadsheet-${brand}-q2p1-${versionTag}.xlsx`);
    const filledPath = path.join(DATADIR, `02-${brand}-filled.jsonl`);
    if (!fs.existsSync(xlsxPath)) { console.warn(`[${brand}] no xlsx — skipping`); continue; }
    const emissions = await loadFilledJsonl(filledPath);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsxPath);
    const ws = wb.getWorksheet('Phase 1');
    if (!ws) { console.error(`[${brand}] xlsx missing "Phase 1" sheet`); process.exit(1); }

    const mismatches = [];
    let compared = 0, dataRows = 0;
    for (let i = 0; i < emissions.length; i++) {
      const rowIdx = 4 + i;
      const expected = emissions[i];
      const row = ws.getRow(rowIdx);
      dataRows++;
      for (let c = 1; c < COL_FIELD_MAP.length; c++) {
        const fieldName = COL_FIELD_MAP[c];
        const expVal = expected.cells[fieldName] ? String(expected.cells[fieldName].value) : '';
        const gotRaw = row.getCell(c).value;
        const gotVal = gotRaw == null ? '' : String(gotRaw);
        compared++;
        if (expVal !== gotVal) {
          if (mismatches.length < 50) mismatches.push({ rowIdx, col: c, field: fieldName, expected: expVal, got: gotVal });
        }
      }
    }
    // Sanity: xlsx should have exactly emissions.length data rows
    const lastDataRow = 3 + emissions.length;
    const overflowRow = ws.getRow(lastDataRow + 1).values.slice(1);
    const hasOverflow = overflowRow.some(v => v !== null && v !== '' && v !== undefined);

    const report = {
      brand, xlsxPath, filledPath, versionTag,
      cellsCompared: compared,
      dataRows,
      mismatches: mismatches.length,
      mismatchSamples: mismatches.slice(0, 20),
      overflow: hasOverflow,
      verifiedAt: new Date().toISOString(),
    };
    const auditPath = path.join(DATADIR, `_audit-verify-${brand}.json`);
    fs.writeFileSync(auditPath, JSON.stringify(report, null, 2));

    const ok = mismatches.length === 0 && !hasOverflow;
    console.log(`[${brand}] ${ok ? '✓' : '✗'}  dataRows=${dataRows}  cells=${compared}  mismatches=${mismatches.length}  overflow=${hasOverflow}`);
    if (!ok) {
      anyFail = true;
      if (mismatches.length) console.log(`  first mismatch:`, mismatches[0]);
    }
  }
  process.exit(anyFail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
