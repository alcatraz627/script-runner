#!/usr/bin/env node
/**
 * spot-check-walmart.js
 * Samples N evenly-spaced rows from the Walmart Excel and prints a human-readable
 * spot-check report. Does NOT load the full file into memory.
 *
 * Usage:
 *   node spot-check-walmart.js [--count N] [--out report.md]
 *   Defaults: --count 10, prints to stdout
 */

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const FILE = path.join(process.env.HOME, 'Downloads', 'export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx');
const TOTAL_ROWS = 1252;

// Parse args
const args = process.argv.slice(2);
const countIdx = args.indexOf('--count');
const COUNT = countIdx !== -1 ? parseInt(args[countIdx + 1]) : 10;
const outIdx = args.indexOf('--out');
const OUT = outIdx !== -1 ? args[outIdx + 1] : null;

// Which rows to sample (1-based data rows, evenly spaced)
const step = Math.floor(TOTAL_ROWS / COUNT);
const targetRows = new Set();
for (let i = 0; i < COUNT; i++) {
  targetRows.add(1 + i * step); // row 1 = first data row
}

async function spotCheck() {
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(FILE, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
  });

  const rows = [];
  let headers = null;
  let dataRowNum = 0;

  for await (const ws of workbook) {
    if (ws.id != 1) {
      // drain non-target sheets to avoid stall
      for await (const _ of ws) {}
      continue;
    }

    for await (const row of ws) {
      const vals = row.values.slice(1);

      if (!headers) {
        headers = vals.map(v => (v && typeof v === 'object' && v.text) ? v.text : String(v ?? ''));
        continue;
      }

      dataRowNum++;
      if (!targetRows.has(dataRowNum)) continue;

      const obj = { _rowNum: dataRowNum };
      headers.forEach((h, i) => {
        let v = vals[i];
        if (v && typeof v === 'object' && v.text) v = v.text;
        if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
        obj[h] = v ?? null;
      });
      rows.push(obj);
    }
  }

  // Build report
  const lines = [];
  lines.push(`# Walmart Enhancement Spot-Check — ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`**File:** ${path.basename(FILE)}`);
  lines.push(`**Total rows:** ${TOTAL_ROWS} | **Sampled:** ${rows.length} (every ~${step} rows)\n`);
  lines.push('---\n');

  for (const row of rows) {
    lines.push(`## Row ${row._rowNum} — ${row['Part Number'] || '(no part#)'} | ${row['Part Type'] || ''}`);
    lines.push('');

    // Core identity
    lines.push(`**Brand:** ${row['Brand'] || '—'}`);
    lines.push(`**Original title:** ${row['title'] || '—'}`);
    lines.push(`**Enhanced Title:** ${row['Title'] || '—'}`);
    lines.push('');

    // Description
    const desc = row['Description'] || '';
    lines.push(`**Description** (${desc.length} chars):`);
    lines.push(`> ${desc.slice(0, 500)}${desc.length > 500 ? '…' : ''}`);
    lines.push('');

    // Features & Benefits
    const fab = row['Features & Benefits'] || '';
    lines.push(`**Features & Benefits** (${fab.length} chars):`);
    fab.split('\n').slice(0, 6).forEach(l => lines.push(`  ${l}`));
    if (fab.split('\n').length > 6) lines.push('  …');
    lines.push('');

    // Attributes (parse pipe-separated key:value)
    const attrRaw = row['attributes'] || '';
    const attrs = attrRaw.split('|').map(s => s.trim()).filter(Boolean);
    lines.push(`**Attributes** (${attrs.length} total):`);
    attrs.slice(0, 8).forEach(a => lines.push(`  • ${a}`));
    if (attrs.length > 8) lines.push(`  … +${attrs.length - 8} more`);
    lines.push('');

    // Fitment
    const fitment = row['fitment'] || '';
    if (fitment) {
      const fitLines = fitment.split('\n').filter(Boolean);
      lines.push(`**Fitment** (${fitLines.length} vehicles):`);
      fitLines.slice(0, 5).forEach(f => lines.push(`  ${f}`));
      if (fitLines.length > 5) lines.push(`  … +${fitLines.length - 5} more`);
    } else {
      lines.push('**Fitment:** (none)');
    }
    lines.push('');

    // Token usage
    lines.push(`**Token usage:** ${row['$token_usage'] || '—'}`);
    lines.push(`**Processed:** ${row['processed']}`);
    lines.push('\n---\n');
  }

  const report = lines.join('\n');

  if (OUT) {
    fs.writeFileSync(OUT, report);
    console.log(`✓ Report written to ${OUT}`);
  } else {
    console.log(report);
  }
}

spotCheck().catch(err => { console.error(err); process.exit(1); });
