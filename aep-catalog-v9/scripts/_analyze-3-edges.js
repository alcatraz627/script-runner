#!/usr/bin/env node
// Third pass: edge-case rows (Vehicles=0 with fitment, blank Make/Years), Not Found col parity.
const XLSX = require('xlsx');
const SRC = '/Users/alcatraz627/Downloads/AEP Catalog V9 - Fitment Data.xlsx';
const wb = XLSX.readFile(SRC, { cellDates: true });
const sheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null, raw: true, blankrows: false });
const cat = sheet('Catalog'), fit = sheet('Fitment'), nf = sheet('Not Found');

const fitBy = new Map();
for (const r of fit) { const k = String(r['ITEM']).trim(); if (!fitBy.has(k)) fitBy.set(k, []); fitBy.get(k).push(r); }

console.log('=== the 4 Vehicles-mismatch items ===');
for (const k of ['47DPCAMRT', '37773-P8B-305AEP', '26250-2E031', '24900-3C158']) {
  console.log(k, JSON.stringify(fitBy.get(k), null, 1));
}

console.log('\n=== fitment rows with blank Make (first 6) ===');
console.log(JSON.stringify(fit.filter(r => !r['Make']).slice(0, 6), null, 1));

console.log('\n=== fitment rows with blank Years (first 4) ===');
console.log(JSON.stringify(fit.filter(r => !r['Years']).slice(0, 4), null, 1));

// Not Found: do its 9 shared cols exactly equal Catalog's?
const shared = ['ENGINE FAMILY', 'PART CATEGORY', 'DESCRIPTION', 'PURCHASE DESCRIPTION', 'FEATURES AND BENEFITS', 'NOTES', 'ALTERNATE REFERENCE', 'PRIMARY COO'];
const catBy = new Map(cat.filter(r => r['Status'] !== '— section —').map(r => [String(r['ITEM']).trim(), r]));
let same = 0; const diffs = [];
for (const r of nf) {
  const c = catBy.get(String(r['ITEM']).trim()); if (!c) continue;
  const bad = shared.filter(col => String(r[col] ?? '').trim() !== String(c[col] ?? '').trim());
  if (bad.length) diffs.push({ item: r['ITEM'], bad }); else same++;
}
console.log('\nNotFound rows whose shared cols match Catalog exactly:', same, 'differing:', diffs.length);
console.log(JSON.stringify(diffs.slice(0, 5), null, 1));

console.log('\nNotFound Reason full distinct values + counts:');
const t = nf.reduce((a, r) => { a[r['Reason']] = (a[r['Reason']] || 0) + 1; return a; }, {});
Object.entries(t).forEach(([k, v]) => console.log(`  [${v}] ${k}`));
