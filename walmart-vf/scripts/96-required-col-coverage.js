#!/usr/bin/env node
/**
 * 96-required-col-coverage.js — for the FINAL CONSOLIDATION step,
 * compute coverage per "Required" column (Walmart's row 2 banner) across
 * all 4 brands' shipped rows. Reports which cols are genuinely useless
 * to gate on (0% coverage = always missing → would drop everything).
 *
 *   Required tier per Walmart row-2 banner:
 *     "Required to sell"            cols 5-11
 *     "Required to be visible"      cols 12-31
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const TPL = process.env.HOME + '/Downloads/Walmart Loadhseet Mar 30.xlsx';
const SHEET = 'Product Content And Site Exp';
const BRANDS = require('./brands.config.js');
const OUTDIR = path.join(__dirname, '..', 'output');

(async () => {
  // Read template labels + tier
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TPL);
  const ws = wb.getWorksheet(SHEET);
  const labels = {}, tier = {};
  for (let c = 1; c <= 94; c++) {
    labels[c] = String(ws.getRow(4).getCell(c).value || '').trim();
    const banner = String(ws.getRow(2).getCell(c).value || '').trim();
    tier[c] = /Required to sell/i.test(banner) ? 'REQUIRED-SELL'
            : /Required for the item to be visible/i.test(banner) ? 'REQUIRED-VISIBLE'
            : null;
  }

  // Read latest xlsx per brand
  const latest = {};
  for (const b of Object.keys(BRANDS)) {
    const rx = new RegExp(`^walmart-loadsheet-${b}-vf-v(\\d+)\\.xlsx$`);
    const versions = fs.readdirSync(OUTDIR)
      .map(f => { const m = f.match(rx); return m ? { f, n: parseInt(m[1]) } : null; })
      .filter(Boolean).sort((a, b) => b.n - a.n);
    latest[b] = versions[0]?.f;
  }

  // Aggregate coverage
  const rowsPerBrand = {};
  for (const b of Object.keys(BRANDS)) {
    if (!latest[b]) continue;
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readFile(path.join(OUTDIR, latest[b]));
    const ws2 = wb2.getWorksheet(SHEET);
    const rows = [];
    for (let r = 6; r <= ws2.rowCount; r++) {
      const row = [];
      for (let c = 1; c <= 94; c++) {
        const v = ws2.getRow(r).getCell(c).value;
        row.push(v == null ? '' : (v.text != null ? v.text : String(v)));
      }
      rows.push(row);
    }
    rowsPerBrand[b] = rows;
  }

  const totalRows = Object.values(rowsPerBrand).reduce((s, rs) => s + rs.length, 0);

  // Per-col coverage (only Required cols)
  console.log(`Total shipped rows across 4 brands: ${totalRows}\n`);
  console.log(`${'Col'.padStart(3)}  ${'Tier'.padEnd(18)}  ${'Label'.padEnd(40)}  ${'Coverage'.padStart(14)}  ${'Per-brand'.padEnd(40)}`);
  console.log('─'.repeat(140));
  const drops = { '0%': [], 'partial': [], '100%': [] };
  for (let c = 5; c <= 31; c++) {
    if (!tier[c]) continue;
    let total = 0, filled = 0;
    const perBrand = {};
    for (const [b, rows] of Object.entries(rowsPerBrand)) {
      let bf = 0;
      for (const r of rows) { total++; if (String(r[c-1]).trim()) { filled++; bf++; } }
      perBrand[b] = `${bf}/${rows.length}`;
    }
    const pct = total ? Math.round(filled / total * 100) : 0;
    const bucket = pct === 0 ? '0%' : pct === 100 ? '100%' : 'partial';
    drops[bucket].push({ c, label: labels[c], pct });
    const perBrandStr = Object.entries(perBrand).map(([b,s]) => b.slice(0,3) + ':' + s).join(' ');
    console.log(`${String(c).padStart(3)}  ${tier[c].padEnd(18)}  ${labels[c].slice(0,40).padEnd(40)}  ${(filled+'/'+total+' ('+pct+'%)').padStart(14)}  ${perBrandStr}`);
  }

  console.log(`\n📊 Bucket summary:`);
  console.log(`  100% covered (safe to gate on):    ${drops['100%'].length} cols`);
  console.log(`  partial (will drop some rows):     ${drops['partial'].length} cols`);
  console.log(`  0% covered (would drop all rows):  ${drops['0%'].length} cols`);
  if (drops['0%'].length) {
    console.log(`\n🚫 0% cols (gating on these = drop ALL rows):`);
    drops['0%'].forEach(d => console.log(`     col ${d.c}: ${d.label}`));
  }
  if (drops['partial'].length) {
    console.log(`\n⚠️  partial cols (gating drops some rows; sorted by drop rate):`);
    drops['partial'].sort((a,b) => a.pct - b.pct).forEach(d => console.log(`     col ${d.c} (${d.pct}%): ${d.label}`));
  }
})().catch(e => { console.error(e); process.exit(1); });
