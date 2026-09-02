#!/usr/bin/env node
// Deeper analysis: group rows, key coverage, cardinality, blank/dup patterns.
const XLSX = require('xlsx');
const SRC = '/Users/alcatraz627/Downloads/AEP Catalog V9 - Fitment Data.xlsx';
const wb = XLSX.readFile(SRC, { cellDates: true });

const sheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null, raw: true, blankrows: false });
const cat = sheet('Catalog');
const fit = sheet('Fitment');
const nf = sheet('Not Found');

console.log('counts', { cat: cat.length, fit: fit.length, notFound: nf.length });

// --- 1. Identify group/section rows in Catalog ---
const catCols = Object.keys(cat[0]);
const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';
const sectionRows = [];
const dataRows = [];
for (const r of cat) {
  const filled = catCols.filter(c => !isBlank(r[c]));
  if (r['Status'] === '— section —') sectionRows.push({ r, filled });
  else dataRows.push(r);
}
console.log('\nsection rows (Status === "— section —"):', sectionRows.length);
console.log('their non-blank cols set:', JSON.stringify([...new Set(sectionRows.flatMap(s => s.filled))]));
console.log('section labels:', JSON.stringify(sectionRows.map(s => s.r['ENGINE FAMILY'])));

// Any other suspicious rows: only ENGINE FAMILY filled and no ITEM
const otherSparse = dataRows.filter(r => isBlank(r['ITEM']));
console.log('\ndata rows with blank ITEM:', otherSparse.length);
if (otherSparse.length) console.log(JSON.stringify(otherSparse.slice(0, 5), null, 1));

// --- 2. Status value distribution ---
const tally = (arr, f) => arr.reduce((a, r) => { const k = String(f(r)); a[k] = (a[k] || 0) + 1; return a; }, {});
console.log('\nCatalog Status distribution:', tally(dataRows, r => r['Status']));
console.log('Catalog Search Column distribution:', tally(dataRows, r => r['Search Column']));
console.log('Catalog Source Site distribution:', tally(dataRows, r => r['Source Site']));

// --- 3. ITEM key: duplicates within Catalog ---
const catByItem = new Map();
for (const r of dataRows) {
  const k = String(r['ITEM'] ?? '').trim();
  if (!catByItem.has(k)) catByItem.set(k, []);
  catByItem.get(k).push(r);
}
const dupItems = [...catByItem.entries()].filter(([, v]) => v.length > 1);
console.log('\nCatalog distinct ITEM:', catByItem.size, 'dup ITEM keys:', dupItems.length);
console.log('dup examples:', JSON.stringify(dupItems.slice(0, 5).map(([k, v]) => [k, v.length])));

// --- 4. Fitment key coverage ---
const fitByItem = new Map();
for (const r of fit) {
  const k = String(r['ITEM'] ?? '').trim();
  if (!fitByItem.has(k)) fitByItem.set(k, []);
  fitByItem.get(k).push(r);
}
console.log('\nFitment distinct ITEM:', fitByItem.size);
const fitKeys = new Set(fitByItem.keys());
const catKeys = new Set(catByItem.keys());
const fitNotInCat = [...fitKeys].filter(k => !catKeys.has(k));
const catNotInFit = [...catKeys].filter(k => !fitKeys.has(k));
console.log('Fitment ITEMs NOT in Catalog:', fitNotInCat.length, JSON.stringify(fitNotInCat.slice(0, 10)));
console.log('Catalog ITEMs with NO fitment:', catNotInFit.length);
// break that down by Status
console.log('  ...by Status:', tally(catNotInFit.flatMap(k => catByItem.get(k)), r => r['Status']));

// fitment rows per item stats
const sizes = [...fitByItem.values()].map(v => v.length).sort((a, b) => a - b);
console.log('fitment rows/item: min', sizes[0], 'median', sizes[Math.floor(sizes.length / 2)], 'max', sizes[sizes.length - 1]);

// --- 5. Does Catalog dup ITEM + Fitment join blow up? check a dup item ---
if (dupItems.length) {
  const [k, v] = dupItems[0];
  console.log('\ndup item detail', k, 'catalog rows:', v.length, 'fitment rows:', (fitByItem.get(k) || []).length);
  console.log(JSON.stringify(v.map(r => ({ ef: r['ENGINE FAMILY'], pc: r['PART CATEGORY'], desc: r['DESCRIPTION'], ar: r['ALTERNATE REFERENCE'], site: r['Source Site'] })), null, 1));
}

// --- 6. Do catalog-level scrape cols agree with fitment cols? ---
const overlapCols = ['Searched As', 'Source Site', 'Part Number (site)', 'Product Title', 'Source URL'];
let agree = 0, disagree = 0; const disagreeEx = [];
for (const [k, rows] of catByItem) {
  const f = fitByItem.get(k); if (!f) continue;
  for (const cr of rows) {
    const bad = overlapCols.filter(c => String(cr[c] ?? '').trim() !== String(f[0][c] ?? '').trim());
    if (bad.length) { disagree++; if (disagreeEx.length < 3) disagreeEx.push({ k, bad: bad.map(c => [c, cr[c], f[0][c]]) }); }
    else agree++;
  }
}
console.log('\ncatalog vs fitment[0] scrape-col agreement:', { agree, disagree });
console.log(JSON.stringify(disagreeEx, null, 1));

// --- 7. Not Found relationship ---
const nfKeys = new Set(nf.map(r => String(r['ITEM'] ?? '').trim()));
console.log('\nNotFound distinct ITEM:', nfKeys.size, 'rows:', nf.length);
console.log('NotFound ITEMs present in Catalog:', [...nfKeys].filter(k => catKeys.has(k)).length);
console.log('NotFound ITEMs absent from Catalog:', [...nfKeys].filter(k => !catKeys.has(k)).length);
const catNotFoundStatus = dataRows.filter(r => r['Status'] !== 'Found');
console.log('Catalog rows Status!=Found:', catNotFoundStatus.length);
console.log('  of those, present in NotFound sheet:', catNotFoundStatus.filter(r => nfKeys.has(String(r['ITEM']).trim())).length);
// Reason distribution (truncate)
console.log('\nNotFound Reason samples:');
[...new Set(nf.map(r => String(r['Reason'] ?? '').slice(0, 90)))].slice(0, 12).forEach(s => console.log('  -', s));
console.log('distinct full Reason values:', new Set(nf.map(r => r['Reason'])).size);

// --- 8. Year Range / Vehicles cols on Catalog ---
console.log('\nCatalog Vehicles sample:', JSON.stringify(dataRows.slice(0, 5).map(r => [r['ITEM'], r['Vehicles'], r['Year Range']])));
// does Vehicles == count of fitment rows?
let vMatch = 0, vMiss = 0; const vEx = [];
for (const r of dataRows) {
  const k = String(r['ITEM']).trim(); const f = fitByItem.get(k); if (!f) continue;
  if (Number(r['Vehicles']) === f.length) vMatch++; else { vMiss++; if (vEx.length < 5) vEx.push([k, r['Vehicles'], f.length]); }
}
console.log('Vehicles === fitment row count:', { vMatch, vMiss }, JSON.stringify(vEx));
