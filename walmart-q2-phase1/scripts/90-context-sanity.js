#!/usr/bin/env node
/**
 * 90-context-sanity.js — R1.4 + R1.5 audit.
 *
 * Walks every cell in 02-{brand}-filled.jsonl and verifies:
 *   - cell shape is { value, source } (R1.4)
 *   - source matches the whitelist (R1.5)
 *   - source-priority audit (R2.6/R1.5): no Liter/CC/Cylinders cell sourced from vcdb.col.Liter (FK-encoded)
 *
 * Plus run-rule audits added 2026-05-12:
 *   - 0 cells where MPN starts with "-" (R2.6 post-fix)
 *   - 0 cells where Year matches /^(\d{4})-\1$/ (R2.2 same-year-range)
 *
 * Output: data/_audit-context-sanity-{brand}.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const BRANDS = require('./brands.config.js');
const DATADIR = 'walmart-q2-phase1/data';

const args = process.argv.slice(2);
function arg(name) { const i = args.indexOf(name); return i === -1 ? null : args[i+1]; }
const brandArg = (arg('--brand') || '').toLowerCase();
if (!brandArg) { console.error('Usage: 90-context-sanity.js --brand <key|all>'); process.exit(1); }
const brandKeys = brandArg === 'all' ? Object.keys(BRANDS) : [brandArg];

// Whitelist regex per R1.5
const SOURCE_WHITELIST = new RegExp([
  /^source\.[^\s]+/,                          // source.<colName>
  /^taxonomy\.[^\s]+/,                        // taxonomy.<field>
  /^brandMapping\.[^\s]+/,                    // brandMapping.<field>
  /^enhancedContent\.[^\s]+/,                 // enhancedContent.<field>
  /^fullscrape\.[^\s]+/,                      // fullscrape.<field>
  /^vcdb\.col\.[^\s]+/,                       // vcdb.col.<columnName>
  /^vcdb\.rawContent\.format[ABCB2]\w*\.[^\s]+/,  // vcdb.rawContent.formatX.<field>
  /^vcdb\.rawContent\.formatunknown\.[^\s]+/, // unlikely but allowed
  /^vcdb\.sqlite\.[^\s]+/,                    // R2.8 — AutoCare SQLite decoder (authoritative)
  /^derived\([^)]+\)/,                         // derived(<expr>)  — includes brand-fallback (R2.7) and year-encode + mpn-normalize
  /^userOverride\.[^\s]+/,                    // userOverride.<file>:<key>
  /^constant$/,                                // constant
].map(re => `(?:${re.source})`).join('|'));

// Fields where vcdb.col.Liter source label is explicitly forbidden (priority rule)
const FORBIDDEN_VCDB_COL_LITER = /^vcdb\.col\.Liter$/;

(async () => {
  let anyFail = false;
  for (const brand of brandKeys) {
    const filledPath = path.join(DATADIR, `02-${brand}-filled.jsonl`);
    if (!fs.existsSync(filledPath)) { console.warn(`[${brand}] no filled jsonl`); continue; }

    const rl = readline.createInterface({ input: fs.createReadStream(filledPath), crlfDelay: Infinity });
    let rows = 0, cells = 0;
    const v = {
      whitelistViolations: [],
      missingSource: [],
      forbiddenVcdbColLiter: [],
      dashMpns: [],
      sameYearRanges: [],
      sourceLabelHistogram: {},
    };
    for await (const line of rl) {
      if (!line) continue;
      const r = JSON.parse(line);
      rows++;
      for (const [field, cell] of Object.entries(r.cells)) {
        cells++;
        // R1.4: shape + source
        if (!cell || typeof cell.value === 'undefined' || cell.source == null || cell.source === '') {
          if (v.missingSource.length < 20) v.missingSource.push({ row: r.vcdbRow, mpn: r.mpn, field });
          continue;
        }
        // R1.5: whitelist
        if (!SOURCE_WHITELIST.test(cell.source)) {
          if (v.whitelistViolations.length < 20) v.whitelistViolations.push({ row: r.vcdbRow, mpn: r.mpn, field, source: cell.source });
        }
        v.sourceLabelHistogram[cell.source] = (v.sourceLabelHistogram[cell.source] || 0) + 1;

        // Priority rule: never accept vcdb.col.Liter as Liter source
        if (field === 'Liter' && FORBIDDEN_VCDB_COL_LITER.test(cell.source)) {
          if (v.forbiddenVcdbColLiter.length < 20) v.forbiddenVcdbColLiter.push({ row: r.vcdbRow, mpn: r.mpn, source: cell.source });
        }
        // R2.6 post-fix: MPN must not start with "-"
        if (field === 'MPN' && String(cell.value).startsWith('-')) {
          if (v.dashMpns.length < 20) v.dashMpns.push({ row: r.vcdbRow, mpn: cell.value });
        }
        // R2.2 sanity: Year must not be `YYYY-YYYY` with same start and end
        if (field === 'Year') {
          const m = String(cell.value).match(/^(\d{4})-(\d{4})$/);
          if (m && m[1] === m[2]) {
            if (v.sameYearRanges.length < 20) v.sameYearRanges.push({ row: r.vcdbRow, mpn: r.mpn, year: cell.value });
          }
        }
      }
    }
    const ok = v.whitelistViolations.length === 0 &&
               v.missingSource.length === 0 &&
               v.forbiddenVcdbColLiter.length === 0 &&
               v.dashMpns.length === 0 &&
               v.sameYearRanges.length === 0;
    const auditPath = path.join(DATADIR, `_audit-context-sanity-${brand}.json`);
    fs.writeFileSync(auditPath, JSON.stringify({ brand, rows, cells, ok, ...v }, null, 2));
    console.log(`[${brand}] ${ok ? '✓' : '✗'} rows=${rows} cells=${cells}  whitelist=${v.whitelistViolations.length}  missingSrc=${v.missingSource.length}  forbiddenLiter=${v.forbiddenVcdbColLiter.length}  dashMpns=${v.dashMpns.length}  sameYearRanges=${v.sameYearRanges.length}`);
    if (!ok) {
      anyFail = true;
      if (v.whitelistViolations.length) console.log('  whitelist sample:', v.whitelistViolations[0]);
      if (v.missingSource.length) console.log('  missing-source sample:', v.missingSource[0]);
      if (v.forbiddenVcdbColLiter.length) console.log('  forbidden-liter sample:', v.forbiddenVcdbColLiter[0]);
      if (v.dashMpns.length) console.log('  dash-mpn sample:', v.dashMpns[0]);
      if (v.sameYearRanges.length) console.log('  same-year-range sample:', v.sameYearRanges[0]);
    }
  }
  process.exit(anyFail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
