#!/usr/bin/env node
/**
 * text-audit-10rows.js
 * Audits 10 sample rows from v4.xlsx for:
 *  1. Non-standard / suspect characters (non-ASCII, smart quotes, encoding artifacts)
 *  2. Capitalization inconsistencies across repeated fields
 *  3. Measurement unit inconsistencies (mixed abbreviations)
 */
'use strict';

const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');

const FILLED = path.join(__dirname, (() => {
  const files = fs.readdirSync(__dirname)
    .filter(f => /^walmart-loadsheet-filled-v\d+\.xlsx$/.test(f))
    .sort((a, b) => {
      const n = f => parseInt(f.match(/v(\d+)/)[1]);
      return n(b) - n(a);
    });
  return files[0];
})());

const SPOT_IDXS = [0, 22, 34, 99, 250, 299, 580, 699, 900, 1099];

// ─── Non-standard character detection ────────────────────────────────────────

const SUSPECT_CHARS = [
  { re: /[\u2018\u2019]/g,  label: 'smart single quote',   fix: "'" },
  { re: /[\u201c\u201d]/g,  label: 'smart double quote',   fix: '"' },
  { re: /\u2013/g,          label: 'en dash',              fix: '-' },
  { re: /\u2014/g,          label: 'em dash',              fix: '--' },
  { re: /\u2026/g,          label: 'ellipsis char',        fix: '...' },
  { re: /\u00a0/g,          label: 'non-breaking space',   fix: ' ' },
  { re: /\u00ae/g,          label: 'registered ®',         fix: '(R)' },
  { re: /\u2122/g,          label: 'trademark ™',          fix: '(TM)' },
  { re: /\u00b0/g,          label: 'degree °',             fix: 'deg' },
  { re: /[^\x00-\x7F]/g,   label: 'non-ASCII',            fix: '?' },
];

function findSuspectChars(str) {
  if (!str) return [];
  const hits = [];
  for (const { re, label, fix } of SUSPECT_CHARS) {
    const matches = [...String(str).matchAll(new RegExp(re.source, 'g'))];
    if (matches.length) {
      // get context around first occurrence
      const idx = matches[0].index;
      const ctx = str.slice(Math.max(0, idx - 15), idx + 20).replace(/\n/g, '↵');
      hits.push({ label, count: matches.length, ctx, fix });
    }
  }
  return hits;
}

// ─── Capitalization checks ────────────────────────────────────────────────────

// Check if string looks like it has inconsistent casing for a "label" field
// (should be Title Case or Sentence case, not ALL CAPS or all lowercase)
function capIssues(str) {
  if (!str || str.length < 4) return [];
  const issues = [];
  // ALL CAPS words that aren't abbreviations (length > 4)
  const allCapsWords = [...str.matchAll(/\b([A-Z]{5,})\b/g)]
    .map(m => m[1])
    .filter(w => !['JEGS', 'OAT', 'DOHC', 'SOHC', 'MSRP', 'VCDB', 'HTML', 'ISBN'].includes(w));
  if (allCapsWords.length) issues.push({ type: 'ALL_CAPS_WORD', words: [...new Set(allCapsWords)].slice(0, 4) });

  // Sentence that starts with lowercase after a period+space
  const lcAfterPeriod = str.match(/\.\s+[a-z]/);
  if (lcAfterPeriod) issues.push({ type: 'LOWERCASE_AFTER_PERIOD', at: lcAfterPeriod[0] });

  return issues;
}

// ─── Unit inconsistency detection ────────────────────────────────────────────

const UNIT_GROUPS = [
  { name: 'length',  variants: ['inches', 'inch', 'in.', '"', ' in '],  canonical: 'in' },
  { name: 'length',  variants: ['feet', 'foot', 'ft.'],                  canonical: 'ft' },
  { name: 'weight',  variants: ['pounds', 'pound', 'lbs.', ' lb '],      canonical: 'lbs' },
  { name: 'weight',  variants: ['ounces', 'ounce', 'oz.'],               canonical: 'oz' },
  { name: 'volume',  variants: ['quarts', 'quart', ' qt '],              canonical: 'qt' },
  { name: 'volume',  variants: ['gallons', 'gallon', ' gal '],           canonical: 'gal' },
  { name: 'volume',  variants: ['liters', 'liter', 'litres', 'litre'],   canonical: 'L' },
  { name: 'volume',  variants: ['milliliters', 'millilitres', 'ml'],     canonical: 'mL' },
  { name: 'torque',  variants: ['ft-lb', 'ft-lbs', 'ft. lbs', 'ft.lbs'],canonical: 'ft-lb' },
];

function findUnitIssues(str) {
  if (!str) return [];
  const lower = str.toLowerCase();
  const issues = [];
  for (const { name, variants, canonical } of UNIT_GROUPS) {
    for (const v of variants) {
      if (lower.includes(v.toLowerCase())) {
        const idx = lower.indexOf(v.toLowerCase());
        const ctx = str.slice(Math.max(0, idx - 10), idx + v.length + 15);
        issues.push({ unitGroup: name, found: v.trim(), canonical, ctx });
      }
    }
  }
  return issues;
}

// ─── Column names we care about ───────────────────────────────────────────────

const AUDIT_COLS = {
   8: 'Product Name',
  12: 'Site Description',
  13: 'Key Feature 1',
  14: 'Key Feature 2',
  15: 'Key Feature 3',
  16: 'Key Feature 4',
  33: 'Additional Features',
  44: 'Color',
  47: 'Finish',
  48: 'Items Included',
  50: 'Material',
  51: 'Model Number',
  59: 'Size',
  63: 'Vehicle Make',
  64: 'Vehicle Model',
  67: 'Warranty Text',
  77: 'Electronics Indicator',
  80: 'Fulfillment Lag Time',
};

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILLED);
  const ws = wb.getWorksheet('Product Content And Site Exp');

  const results = [];

  for (const idx of SPOT_IDXS) {
    const sheetRow = ws.getRow(6 + idx);
    const partNum = String(sheetRow.getCell(4).value || `row${idx+1}`);
    const partType = String(sheetRow.getCell(24).value || '');

    const colAudits = [];

    for (const [colStr, colName] of Object.entries(AUDIT_COLS)) {
      const c = parseInt(colStr);
      const raw = sheetRow.getCell(c).value;
      if (raw == null || raw === '') continue;
      const str = String(raw);

      const suspects = findSuspectChars(str);
      const caps     = capIssues(str);
      const units    = findUnitIssues(str);

      if (suspects.length || caps.length || units.length) {
        colAudits.push({ col: c, colName, value: str.slice(0, 200), suspects, caps, units });
      }
    }

    results.push({ idx, partNum, partType, colAudits });
  }

  // ─── Text output ──────────────────────────────────────────────────────────

  let hasIssues = false;
  for (const { idx, partNum, partType, colAudits } of results) {
    if (!colAudits.length) {
      console.log(`\n  Row ${idx+1} [${partNum}] — ${partType.slice(0,40)} — ✓ clean`);
      continue;
    }
    hasIssues = true;
    console.log(`\n  Row ${idx+1} [${partNum}] — ${partType.slice(0,40)}`);
    for (const { col, colName, value, suspects, caps, units } of colAudits) {
      console.log(`    [${String(col).padStart(2)}] ${colName}`);
      console.log(`         Value: ${value.slice(0,100).replace(/\n/g,'↵')}`);
      for (const s of suspects) {
        console.log(`         ⚠ NON-STD CHAR: ${s.label} (×${s.count}) near: "${s.ctx}" → suggest: ${s.fix}`);
      }
      for (const c of caps) {
        if (c.type === 'ALL_CAPS_WORD') console.log(`         ⚠ CAPS: Words fully uppercase: ${c.words.join(', ')}`);
        if (c.type === 'LOWERCASE_AFTER_PERIOD') console.log(`         ⚠ CAPS: lowercase after period: "${c.at}"`);
      }
      for (const u of units) {
        console.log(`         ⚠ UNIT: "${u.found}" in "${u.ctx.trim()}" — canonical form is "${u.canonical}"`);
      }
    }
  }

  if (!hasIssues) console.log('\n  All 10 rows: no issues found.');

  // ─── Cross-row consistency: same field, multiple values ──────────────────

  console.log('\n\n═══ Cross-row field consistency ═══');

  // Units used across all size values
  const sizeVals = [];
  const conditionVals = new Map();
  const fitmentTypeVals = new Map();

  for (const idx of SPOT_IDXS) {
    const row = ws.getRow(6 + idx);
    const size = row.getCell(59).value;
    const cond = row.getCell(25).value;
    const fitType = row.getCell(31).value;
    if (size) sizeVals.push({ idx: idx+1, val: String(size) });
    if (cond) conditionVals.set(String(cond), (conditionVals.get(String(cond))||0)+1);
    if (fitType) fitmentTypeVals.set(String(fitType), (fitmentTypeVals.get(String(fitType))||0)+1);
  }

  console.log('\n  Size values (col 59):');
  if (sizeVals.length) {
    for (const { idx, val } of sizeVals) console.log(`    Row ${idx}: "${val}"`);
  } else {
    console.log('    (none in sample)');
  }

  console.log('\n  Condition distribution (col 25):');
  for (const [k, v] of conditionVals) console.log(`    "${k}": ${v} rows`);

  console.log('\n  Fitment type distribution (col 31):');
  for (const [k, v] of fitmentTypeVals) console.log(`    "${k}": ${v} rows`);

  // Scan ALL rows for unit variant usage
  console.log('\n\n═══ Full dataset unit variant scan (all 1,252 rows) ═══');
  const unitTally = {};
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn <= 5) return;
    for (const c of [12, 13, 14, 15, 16, 33, 48, 50, 59, 67]) {
      const str = String(row.getCell(c).value || '');
      if (!str) continue;
      for (const { name, variants, canonical } of UNIT_GROUPS) {
        for (const v of variants) {
          if (str.toLowerCase().includes(v.toLowerCase())) {
            const key = `${name}/${v.trim()}`;
            unitTally[key] = (unitTally[key]||0) + 1;
          }
        }
      }
    }
  });

  if (Object.keys(unitTally).length) {
    const grouped = {};
    for (const [key, cnt] of Object.entries(unitTally)) {
      const [group, variant] = key.split('/');
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push({ variant, cnt });
    }
    for (const [group, entries] of Object.entries(grouped)) {
      console.log(`\n  ${group}:`);
      entries.sort((a,b) => b.cnt - a.cnt);
      for (const { variant, cnt } of entries) {
        console.log(`    "${variant}" — ${cnt} rows`);
      }
    }
  } else {
    console.log('  No non-canonical unit variants found.');
  }

  // Full non-ASCII scan
  console.log('\n\n═══ Non-ASCII character scan (all 1,252 rows, text cols) ═══');
  const charTally = {};
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn <= 5) return;
    for (const c of [8, 12, 13, 14, 15, 16, 33, 48, 67]) {
      const str = String(row.getCell(c).value || '');
      for (const ch of str) {
        if (ch.charCodeAt(0) > 127) {
          const code = `U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')}`;
          charTally[code] = charTally[code] || { ch, count: 0, example: '' };
          charTally[code].count++;
          if (!charTally[code].example) {
            const idx2 = str.indexOf(ch);
            charTally[code].example = str.slice(Math.max(0,idx2-10), idx2+15).replace(/\n/g,'↵');
          }
        }
      }
    }
  });

  const charEntries = Object.entries(charTally).sort((a,b) => b[1].count - a[1].count);
  if (charEntries.length) {
    for (const [code, { ch, count, example }] of charEntries) {
      // find label
      const label = SUSPECT_CHARS.find(s => ch.match(new RegExp(s.re.source)))?.label || 'other non-ASCII';
      console.log(`  ${code} '${ch}' (${label}) — ${count}× — e.g.: "${example}"`);
    }
  } else {
    console.log('  ✓ No non-ASCII characters found in text columns.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
