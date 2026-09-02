#!/usr/bin/env node
// Second pass: section→row assignment, fitment row quality, JSON size vs Excel cell cap.
const XLSX = require('xlsx');
const SRC = '/Users/alcatraz627/Downloads/AEP Catalog V9 - Fitment Data.xlsx';
const wb = XLSX.readFile(SRC, { cellDates: true });
const sheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null, raw: true, blankrows: false });
const cat = sheet('Catalog'), fit = sheet('Fitment');

// --- section forward-fill ---
let current = null, before = 0;
const assigned = [];
for (const r of cat) {
  if (r['Status'] === '— section —') { current = String(r['ENGINE FAMILY']).trim(); continue; }
  if (current === null) before++;
  assigned.push({ item: String(r['ITEM']).trim(), ef: String(r['ENGINE FAMILY'] ?? '').trim(), section: current });
}
console.log('rows before first section marker:', before);
const byEF = new Map();
for (const a of assigned) {
  if (!byEF.has(a.ef)) byEF.set(a.ef, new Set());
  byEF.get(a.ef).add(a.section);
}
const multi = [...byEF.entries()].filter(([, s]) => s.size > 1);
console.log('ENGINE FAMILY values mapping to >1 section:', multi.length, JSON.stringify(multi.slice(0, 5).map(([k, s]) => [k, [...s]])));
console.log('distinct sections used:', new Set(assigned.map(a => a.section)).size);
const secCount = assigned.reduce((a, x) => { a[x.section] = (a[x.section] || 0) + 1; return a; }, {});
console.log('rows per section:', JSON.stringify(secCount, null, 1));
console.log('\nENGINE FAMILY -> section map (all):');
for (const [ef, s] of byEF) console.log(`  ${JSON.stringify(ef)} -> ${[...s][0]}`);

// --- fitment row quality ---
const vehCols = ['Years', 'Make', 'Model', 'Trim / Body', 'Engine', 'Options'];
const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const emptyFit = fit.filter(r => vehCols.every(c => blank(r[c])));
console.log('\nfitment rows with ALL vehicle fields blank:', emptyFit.length);
if (emptyFit.length) console.log(JSON.stringify(emptyFit.slice(0, 4), null, 1));
for (const c of vehCols) console.log(`  blank ${c}:`, fit.filter(r => blank(r[c])).length, '/', fit.length);
console.log('Years type sample:', JSON.stringify([...new Set(fit.map(r => typeof r['Years']))]));
console.log('Years sample values:', JSON.stringify([...new Set(fit.map(r => r['Years']))].slice(0, 12)));

// --- exact dup fitment rows per item ---
const fitBy = new Map();
for (const r of fit) { const k = String(r['ITEM']).trim(); (fitBy.get(k) || fitBy.set(k, []).get(k)).push(r); }
let dupRows = 0;
for (const [, rows] of fitBy) {
  const seen = new Set();
  for (const r of rows) { const sig = vehCols.map(c => String(r[c] ?? '')).join('|'); if (seen.has(sig)) dupRows++; seen.add(sig); }
}
console.log('duplicate (item + vehicle-signature) fitment rows:', dupRows);

// --- JSON payload size per item ---
let maxLen = 0, maxItem = null, over = 0;
const lens = [];
for (const [k, rows] of fitBy) {
  const payload = rows.map(r => ({ years: r['Years'], make: r['Make'], model: r['Model'], trim: r['Trim / Body'], engine: r['Engine'], options: r['Options'] || undefined }));
  const s = JSON.stringify(payload);
  lens.push(s.length);
  if (s.length > maxLen) { maxLen = s.length; maxItem = k; }
  if (s.length > 32767) over++;
}
lens.sort((a, b) => a - b);
console.log('\nfitment JSON len: min', lens[0], 'median', lens[Math.floor(lens.length / 2)], 'max', maxLen, `(item ${maxItem})`, 'over 32767:', over);

// --- text col max lengths across catalog ---
const cols = Object.keys(cat[0]);
console.log('\ncatalog col max lengths:');
for (const c of cols) {
  const m = Math.max(...cat.map(r => String(r[c] ?? '').length));
  console.log(`  ${c}: ${m}`);
}
