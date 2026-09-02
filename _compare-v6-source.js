#!/usr/bin/env node
/**
 * Compare source Enhancement export vs v6 loadsheet output.
 * For each of the 94 loadsheet columns, count how many rows have data in source
 * but are empty in v6 — i.e., data that was "lost" in the mapping.
 */

const ExcelJS = require('exceljs');
const path = require('path');

const SOURCE = path.join(process.env.HOME, 'Downloads', 'export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx');
const V6     = path.join(process.env.HOME, 'Code/Versable/scripts/walmart-loadsheet-filled-v6.xlsx');

async function readSourceRows() {
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(SOURCE, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore',
  });
  const rows = [];
  let headers = null;
  for await (const ws of workbook) {
    if (ws.id != 1) { for await (const _ of ws) {} continue; }
    for await (const row of ws) {
      const vals = row.values.slice(1);
      if (!headers) {
        headers = vals.map(v => (v && typeof v === 'object' && v.text) ? v.text : String(v ?? ''));
        continue;
      }
      const obj = {};
      headers.forEach((h, i) => {
        let v = vals[i];
        if (v && typeof v === 'object' && v.text) v = v.text;
        if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
        obj[h] = v ?? null;
      });
      rows.push(obj);
    }
  }
  return { headers, rows };
}

async function readV6Rows() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(V6);
  const ws = wb.getWorksheet('Product Content And Site Exp');
  if (!ws) throw new Error('Sheet not found');

  // Row 5 has column headers/spec names
  const headerRow = ws.getRow(5);
  const colHeaders = [];
  for (let c = 1; c <= 94; c++) {
    colHeaders[c] = String(headerRow.getCell(c).value || `col_${c}`);
  }

  // Data starts at row 6
  const rows = [];
  for (let r = 6; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = {};
    let hasData = false;
    for (let c = 1; c <= 94; c++) {
      const v = row.getCell(c).value;
      obj[c] = v;
      if (v !== null && v !== undefined && String(v).trim() !== '') hasData = true;
    }
    if (!hasData) break; // stop at first fully empty row
    rows.push(obj);
  }
  return { colHeaders, rows };
}

// Map source column names to loadsheet column numbers (from fill-walmart-loadsheet.js)
const SOURCE_TO_LOADSHEET = {
  'Part Number': [4, 7, 27],
  'Title': [8],
  'Brand': [9, 49],
  'Description': [12],
  'Part Type': [24],
  'Features & Benefits': [13, 14, 15, 16],
  'attributes': 'special', // parsed into many columns
};

async function main() {
  console.log('Reading source...');
  const src = await readSourceRows();
  console.log(`  Source: ${src.rows.length} rows, ${src.headers.length} columns`);
  console.log(`  Source columns: ${src.headers.join(', ')}`);

  console.log('\nReading v6...');
  const v6 = await readV6Rows();
  console.log(`  V6: ${v6.rows.length} rows, 94 columns`);

  // --- Per-column fill rate comparison ---
  // For v6: count non-empty cells per column
  const v6Fill = {};
  for (let c = 1; c <= 94; c++) {
    v6Fill[c] = { filled: 0, empty: 0, header: v6.colHeaders[c] };
  }
  for (const row of v6.rows) {
    for (let c = 1; c <= 94; c++) {
      const v = row[c];
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        v6Fill[c].filled++;
      } else {
        v6Fill[c].empty++;
      }
    }
  }

  // For source: count non-empty cells per column
  const srcFill = {};
  for (const h of src.headers) {
    srcFill[h] = { filled: 0, empty: 0 };
  }
  for (const row of src.rows) {
    for (const h of src.headers) {
      const v = row[h];
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        srcFill[h].filled++;
      } else {
        srcFill[h].empty++;
      }
    }
  }

  // --- Print source column fill rates ---
  console.log('\n=== SOURCE COLUMN FILL RATES ===');
  console.log('Column | Filled | Empty | Fill%');
  console.log('-------|--------|-------|------');
  for (const h of src.headers) {
    const s = srcFill[h];
    const pct = ((s.filled / src.rows.length) * 100).toFixed(1);
    console.log(`${h.slice(0, 30).padEnd(30)} | ${String(s.filled).padStart(6)} | ${String(s.empty).padStart(5)} | ${pct}%`);
  }

  // --- Print v6 column fill rates ---
  console.log('\n=== V6 LOADSHEET COLUMN FILL RATES ===');
  console.log('Col# | Header                         | Filled | Empty | Fill%');
  console.log('-----|--------------------------------|--------|-------|------');
  for (let c = 1; c <= 94; c++) {
    const f = v6Fill[c];
    const pct = v6.rows.length > 0 ? ((f.filled / v6.rows.length) * 100).toFixed(1) : '0.0';
    console.log(`${String(c).padStart(4)} | ${String(f.header).slice(0, 30).padEnd(30)} | ${String(f.filled).padStart(6)} | ${String(f.empty).padStart(5)} | ${pct}%`);
  }

  // --- Per-row analysis: how many of the 94 cols are empty in v6? ---
  console.log('\n=== PER-ROW EMPTY COLUMN COUNT IN V6 ===');
  const emptyCounts = [];
  for (let i = 0; i < v6.rows.length; i++) {
    let empty = 0;
    for (let c = 1; c <= 94; c++) {
      const v = v6.rows[i][c];
      if (v === null || v === undefined || String(v).trim() === '') empty++;
    }
    emptyCounts.push({ row: i + 1, partNumber: v6.rows[i][4] || '?', empty });
  }

  // Histogram
  const hist = {};
  for (const { empty } of emptyCounts) {
    const bucket = Math.floor(empty / 10) * 10;
    const label = `${bucket}-${bucket + 9}`;
    hist[label] = (hist[label] || 0) + 1;
  }
  console.log('\nEmpty columns per row (histogram):');
  console.log('Range    | Count | Bar');
  console.log('---------|-------|' + '-'.repeat(40));
  for (const [range, count] of Object.entries(hist).sort()) {
    const bar = '█'.repeat(Math.ceil(count / 10));
    console.log(`${range.padEnd(8)} | ${String(count).padStart(5)} | ${bar}`);
  }

  // Top 10 worst rows
  emptyCounts.sort((a, b) => b.empty - a.empty);
  console.log('\nTop 10 rows with most empty columns:');
  console.log('Row  | Part Number          | Empty/94');
  console.log('-----|----------------------|---------');
  for (const { row, partNumber, empty } of emptyCounts.slice(0, 10)) {
    console.log(`${String(row).padStart(4)} | ${String(partNumber).slice(0, 20).padEnd(20)} | ${empty}/94`);
  }

  // Compare v5 if exists
  const V5 = path.join(process.env.HOME, 'Code/Versable/scripts/walmart-loadsheet-filled-v5.xlsx');
  const fs = require('fs');
  if (fs.existsSync(V5)) {
    console.log('\n=== V5 vs V6 COLUMN FILL COMPARISON ===');
    const wb5 = new ExcelJS.Workbook();
    await wb5.xlsx.readFile(V5);
    const ws5 = wb5.getWorksheet('Product Content And Site Exp');
    if (ws5) {
      const v5Counts = {};
      for (let c = 1; c <= 94; c++) v5Counts[c] = 0;
      let v5RowCount = 0;
      for (let r = 6; r <= ws5.rowCount; r++) {
        const row = ws5.getRow(r);
        let hasData = false;
        for (let c = 1; c <= 94; c++) {
          const v = row.getCell(c).value;
          if (v !== null && v !== undefined && String(v).trim() !== '') {
            hasData = true;
            v5Counts[c]++;
          }
        }
        if (!hasData) break;
        v5RowCount++;
      }

      console.log(`V5: ${v5RowCount} rows`);
      console.log('Col# | Header                         | V5 Fill | V6 Fill | Delta');
      console.log('-----|--------------------------------|---------|---------|------');
      for (let c = 1; c <= 94; c++) {
        const v5f = v5Counts[c];
        const v6f = v6Fill[c].filled;
        const delta = v6f - v5f;
        if (delta !== 0 || v5f > 0 || v6f > 0) {
          const marker = delta < 0 ? ' ← LOST' : delta > 0 ? ' ← GAINED' : '';
          console.log(`${String(c).padStart(4)} | ${String(v6Fill[c].header).slice(0, 30).padEnd(30)} | ${String(v5f).padStart(7)} | ${String(v6f).padStart(7)} | ${delta >= 0 ? '+' : ''}${delta}${marker}`);
        }
      }
    }
  }

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
