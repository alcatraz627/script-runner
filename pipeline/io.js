#!/usr/bin/env node
/**
 * pipeline/io.js — Universal data import/export
 *
 * CLI:
 *   node pipeline/io.js --from <file> --to <file> [--sheet <name>] [--limit <n>] [--slice <start,end>]
 *   node pipeline/io.js --from <file> --list-sheets
 *
 * API:
 *   const io = require('./pipeline/io');
 *   const rows = io.readFile('data.xlsx', { sheet: 'Sheet1', limit: 100 });
 *   io.writeFile(rows, 'output.json');
 */

const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');

// ── Read any file → array of row objects ──────────────────────────────────────
// Supports JSON arrays, XLSX/XLS (via SheetJS), and CSV.
// Options: sheet (for xlsx), limit (cap rows), slice (start,end inclusive).
function readFile(filePath, opts = {}) {
  const abs = path.resolve(filePath);
  const ext = path.extname(abs).toLowerCase();
  let rows;

  if (ext === '.json') {
    let content = fs.readFileSync(abs, 'utf8');
    content = content.replace(/:\s*NaN\s*([,}])/g, ': null$1');
    rows = JSON.parse(content);
    if (!Array.isArray(rows)) throw new Error(`JSON file must contain an array: ${filePath}`);
  } else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
    const wb = XLSX.readFile(abs);
    const sheetName = opts.sheet || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    if (!ws) throw new Error(`Sheet "${sheetName}" not found. Available: ${wb.SheetNames.join(', ')}`);
    rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  } else {
    throw new Error(`Unsupported input format: ${ext}`);
  }

  if (opts.slice) {
    const [start, end] = String(opts.slice).split(',').map(Number);
    rows = rows.slice(start, end + 1);
  } else if (opts.limit) {
    rows = rows.slice(0, parseInt(opts.limit));
  }

  return rows;
}

// ── Flatten array-valued fields into strings for spreadsheet export ──────────
// Excel cell limit: 32,767 characters. Truncate with marker if exceeded.
const EXCEL_CELL_LIMIT = 32000; // leave margin for safety

function truncateCell(str) {
  if (typeof str === 'string' && str.length > EXCEL_CELL_LIMIT) {
    return str.substring(0, EXCEL_CELL_LIMIT) + '… [TRUNCATED]';
  }
  return str;
}

function flattenArrayFields(rows) {
  return rows.map(row => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (v == null) { out[k] = v; continue; }
      if (Array.isArray(v)) {
        if (v.length === 0) { out[k] = ''; continue; }
        let str;
        if (Array.isArray(v[0])) {
          // Array of pairs: [[k,v], ...] → "k: v\nk: v"
          str = v.map(pair => pair.join(': ')).join('\n');
        } else if (typeof v[0] === 'object' && v[0] !== null) {
          // Array of objects → JSON string
          str = JSON.stringify(v);
        } else {
          // Array of primitives → newline-joined
          str = v.join('\n');
        }
        out[k] = truncateCell(str);
      } else if (typeof v === 'object') {
        // Plain object → JSON string
        out[k] = truncateCell(JSON.stringify(v));
      } else {
        out[k] = v;
      }
    }
    return out;
  });
}

// ── Write array of row objects → file ────────────────────────────────────────
function writeFile(rows, filePath, opts = {}) {
  const abs = path.resolve(filePath);
  const ext = path.extname(abs).toLowerCase();
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  if (ext === '.json') {
    fs.writeFileSync(abs, JSON.stringify(rows, null, 2), 'utf8');
  } else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
    const flat = flattenArrayFields(rows);
    const ws = XLSX.utils.json_to_sheet(flat);
    if (ext === '.csv') {
      fs.writeFileSync(abs, XLSX.utils.sheet_to_csv(ws), 'utf8');
    } else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, opts.sheet || 'Data');
      if (opts.colWidths) ws['!cols'] = opts.colWidths;
      XLSX.writeFile(wb, abs);
    }
  } else {
    throw new Error(`Unsupported output format: ${ext}`);
  }

  return abs;
}

// ── List sheets in an xlsx file ───────────────────────────────────────────────
function listSheets(filePath) {
  const wb = XLSX.readFile(path.resolve(filePath));
  return wb.SheetNames;
}

module.exports = { readFile, writeFile, listSheets };

// ── CLI ───────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const get  = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

  const from  = get('--from');
  const to    = get('--to');
  const sheet = get('--sheet');
  const limit = get('--limit');
  const slice = get('--slice');

  if (!from) {
    console.error('Usage: node pipeline/io.js --from <file> [--to <file>] [--sheet <name>] [--limit <n>] [--slice <start,end>]');
    console.error('       node pipeline/io.js --from <file> --list-sheets');
    process.exit(1);
  }

  if (args.includes('--list-sheets')) {
    console.log('Sheets:', listSheets(from).join(', '));
    process.exit(0);
  }

  if (!to) { console.error('--to is required'); process.exit(1); }

  const rows = readFile(from, { sheet, limit, slice });
  console.log(`✓ Read ${rows.length} rows from ${from}`);
  writeFile(rows, to, { sheet });
  console.log(`✓ Written to ${to}`);
}
