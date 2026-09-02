#!/usr/bin/env node
/**
 * query-vcdb.js — Interactive VCDB SQLite query tool
 *
 * Provides helper queries to cross-reference Walmart product fitment data
 * against the VCDB vehicle database.
 *
 * Usage:
 *   node query-vcdb.js                          # interactive REPL
 *   node query-vcdb.js --query "SELECT ..."     # run one SQL query
 *   node query-vcdb.js --lookup "2019 Ford F-150"   # look up vehicle(s)
 *   node query-vcdb.js --make Ford              # list all Ford models
 *   node query-vcdb.js --validate FILE.json     # validate fitment strings from a JSON file
 *   node query-vcdb.js --stats                  # print DB overview
 *   node query-vcdb.js --walmart FILE.xlsx [N]  # validate fitment from Walmart enhancement Excel
 */
'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const readline = require('readline');
const fs = require('fs');

const VCDB_PATH = '/Users/alcatraz627/Code/Versable/enhancement-product/backend/vcdb.sqlite';
const db = new Database(VCDB_PATH, { readonly: true });

// ─── Prepared queries ───────────────────────────────────────────────────────

/**
 * Lookup vehicles matching year + make + model (all optional).
 * Returns matching BaseVehicle + submodels + vehicle type.
 */
function lookupVehicles({ year, make, model, submodel } = {}) {
  let sql = `
    SELECT
      bv.YearID           AS year,
      ma.MakeName         AS make,
      mo.ModelName        AS model,
      sm.SubModelName     AS submodel,
      vt.VehicleTypeName  AS vehicle_type,
      v.VehicleID
    FROM Vehicle v
    JOIN BaseVehicle bv ON v.BaseVehicleID = bv.BaseVehicleID
    JOIN Make        ma ON bv.MakeID       = ma.MakeID
    JOIN Model       mo ON bv.ModelID      = mo.ModelID
    LEFT JOIN SubModel  sm ON v.SubmodelID  = sm.SubmodelID
    LEFT JOIN VehicleType vt ON mo.VehicleTypeID = vt.VehicleTypeID
    WHERE 1=1
  `;
  const params = [];
  if (year)     { sql += ' AND bv.YearID = ?';                params.push(Number(year)); }
  if (make)     { sql += ' AND ma.MakeName LIKE ?';           params.push(`%${make}%`); }
  if (model)    { sql += ' AND mo.ModelName LIKE ?';          params.push(`%${model}%`); }
  if (submodel) { sql += ' AND sm.SubModelName LIKE ?';       params.push(`%${submodel}%`); }
  sql += ' ORDER BY bv.YearID DESC, ma.MakeName, mo.ModelName LIMIT 50';
  return db.prepare(sql).all(...params);
}

/**
 * Strip engine specs from the tail of a model string.
 * e.g. "Ram 1500 Laramie 5.7L 8cyl" → "Ram 1500 Laramie"
 *      "F-150 XLT 2.7L 6cyl" → "F-150 XLT"
 */
function stripEngineSpec(str) {
  return str
    .replace(/\s+\d+\.\d+L\s+\d+cyl.*$/i, '')   // "5.7L 8cyl ..."
    .replace(/\s+\d+\.\d+L.*$/i, '')              // "3.5L ..."
    .replace(/\s+[-L]\s*$/i, '')                  // trailing "- L" for cc-less models
    .trim();
}

/**
 * Find best VCDB model match for a make+model string.
 * Uses progressive prefix shortening to handle appended submodel names.
 * Returns { model, submodel, matchedWords } or null.
 */
function findBestModel(make, modelStr) {
  const words = modelStr.split(/\s+/);
  // Try from longest prefix down to 1 word
  for (let len = words.length; len >= 1; len--) {
    const candidate = words.slice(0, len).join(' ');
    const row = db.prepare(`
      SELECT mo.ModelName
      FROM Model mo
      JOIN BaseVehicle bv ON bv.ModelID = mo.ModelID
      JOIN Make ma ON bv.MakeID = ma.MakeID
      WHERE ma.MakeName LIKE ? AND mo.ModelName = ?
      LIMIT 1
    `).get(`%${make}%`, candidate);
    if (row) {
      const remaining = words.slice(len).join(' ');
      return { model: row.ModelName, submodel: remaining || null, matchedWords: len };
    }
  }
  // Fallback: LIKE match on first 2 words
  if (words.length >= 1) {
    const prefix = words.slice(0, Math.min(2, words.length)).join(' ');
    const row = db.prepare(`
      SELECT mo.ModelName
      FROM Model mo
      JOIN BaseVehicle bv ON bv.ModelID = mo.ModelID
      JOIN Make ma ON bv.MakeID = ma.MakeID
      WHERE ma.MakeName LIKE ? AND mo.ModelName LIKE ?
      ORDER BY LENGTH(mo.ModelName) ASC LIMIT 1
    `).get(`%${make}%`, `${prefix}%`);
    if (row) return { model: row.ModelName, submodel: null, matchedWords: 0 };
  }
  return null;
}

/**
 * Parse a free-form fitment string like "2019 Ford F-150" or "2005, 2006 Dodge Ram 1500"
 * into year(s), make, model tokens and validate each against VCDB.
 * Handles:
 *  - Year prefix: "2019 Ford F-150"
 *  - Multi-year prefix: "2005, 2006, 2008 Dodge Ram 1500"
 *  - Year-less: "Ford F-150" or "Jeep Wrangler JK"
 *  - Appended engine specs: "Ram 1500 Laramie 5.7L 8cyl"
 *  - Appended submodel: "F-150 XLT"
 */
function parseFitmentString(str) {
  const lines = str.split(/\n|;/).map(s => s.trim()).filter(Boolean);
  const results = [];

  for (const line of lines) {
    // Match year prefix(es) optionally at start
    const yearMatch = line.match(/^((?:\d{4}(?:,\s*)?)+)\s+(.+)$/);
    const years = yearMatch ? yearMatch[1].match(/\d{4}/g).map(Number) : [];
    const rest  = yearMatch ? yearMatch[2].trim() : line.trim();

    // Strip trailing engine spec before make/model parsing
    const restClean = stripEngineSpec(rest);

    // Try splitting rest into make + model using exact make lookup
    const makeRow = db.prepare(`
      SELECT MakeID, MakeName FROM Make
      WHERE ? LIKE MakeName || '%'
      ORDER BY LENGTH(MakeName) DESC LIMIT 1
    `).get(restClean);

    let make = null, rawModel = null;
    if (makeRow) {
      make     = makeRow.MakeName;
      rawModel = restClean.slice(make.length).trim();
    } else {
      // fallback: first word = make, rest = model
      const parts = restClean.split(/\s+/);
      make     = parts[0];
      rawModel = parts.slice(1).join(' ');
    }

    // Progressive model prefix matching to strip submodel/extra tokens
    const modelMatch = rawModel ? findBestModel(make, rawModel) : null;
    const model    = modelMatch ? modelMatch.model    : rawModel;
    const submodel = modelMatch ? modelMatch.submodel : null;

    // Validate against VCDB
    let found = 0;
    const yearsToCheck = years.length > 0 ? years : [null]; // null = any year
    for (const y of yearsToCheck) {
      const r = lookupVehicles({ year: y, make, model });
      found += r.length;
    }
    results.push({ raw: line, years, make, model, submodel, found });
  }
  return results;
}

/**
 * List all models for a make (optionally filtered by year).
 */
function listModels({ make, year } = {}) {
  let sql = `
    SELECT DISTINCT mo.ModelName, MIN(bv.YearID) AS first_year, MAX(bv.YearID) AS last_year,
      vt.VehicleTypeName AS vehicle_type, COUNT(*) AS variant_count
    FROM BaseVehicle bv
    JOIN Make  ma ON bv.MakeID  = ma.MakeID
    JOIN Model mo ON bv.ModelID = mo.ModelID
    LEFT JOIN VehicleType vt ON mo.VehicleTypeID = vt.VehicleTypeID
    WHERE ma.MakeName LIKE ?
  `;
  const params = [`%${make || ''}%`];
  if (year) { sql += ' AND bv.YearID = ?'; params.push(Number(year)); }
  sql += ' GROUP BY mo.ModelName ORDER BY mo.ModelName';
  return db.prepare(sql).all(...params);
}

/**
 * Print DB statistics.
 */
function printStats() {
  const stats = {
    vehicles:  db.prepare('SELECT COUNT(*) AS n FROM Vehicle').get().n,
    base:      db.prepare('SELECT COUNT(*) AS n FROM BaseVehicle').get().n,
    makes:     db.prepare('SELECT COUNT(*) AS n FROM Make').get().n,
    models:    db.prepare('SELECT COUNT(*) AS n FROM Model').get().n,
    submodels: db.prepare('SELECT COUNT(*) AS n FROM SubModel').get().n,
    year_min:  db.prepare('SELECT MIN(YearID) AS n FROM BaseVehicle').get().n,
    year_max:  db.prepare('SELECT MAX(YearID) AS n FROM BaseVehicle').get().n,
  };
  console.log('\n═══════════════════════════════════════════');
  console.log('  VCDB Database Statistics');
  console.log('═══════════════════════════════════════════');
  console.log(`  Vehicles (full):     ${stats.vehicles.toLocaleString()}`);
  console.log(`  Base vehicles:       ${stats.base.toLocaleString()}`);
  console.log(`  Makes:               ${stats.makes}`);
  console.log(`  Models:              ${stats.models.toLocaleString()}`);
  console.log(`  Submodels:           ${stats.submodels.toLocaleString()}`);
  console.log(`  Year range:          ${stats.year_min} – ${stats.year_max}`);
  console.log('═══════════════════════════════════════════\n');

  const topMakes = db.prepare(`
    SELECT ma.MakeName, COUNT(DISTINCT bv.ModelID) AS model_count
    FROM BaseVehicle bv JOIN Make ma ON bv.MakeID = ma.MakeID
    GROUP BY ma.MakeName ORDER BY model_count DESC LIMIT 10
  `).all();
  console.log('  Top 10 makes by model count:');
  topMakes.forEach(r => console.log(`    ${r.MakeName.padEnd(20)} ${r.model_count} models`));
  console.log();
}

/**
 * Validate fitment data from Walmart enhancement Excel file.
 * Streams rows, parses the fitment column, validates against VCDB.
 */
async function validateWalmartFitment(file, limit = 20) {
  const ExcelJS = require('exceljs');
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, { sharedStrings: 'cache', hyperlinks: 'ignore', worksheets: 'emit' });

  const FITMENT_COL = 7;  // 1-indexed: col G = fitment
  const PART_COL    = 2;  // col B = Part Number
  const TYPE_COL    = 3;  // col C = Part Type

  let rowCount = 0, checked = 0;

  reader.on('worksheet', ws => {
    ws.on('row', row => {
      if (row.number === 1) return; // skip header
      if (checked >= limit) return;

      const partNum = row.getCell(PART_COL).value;
      const partType = row.getCell(TYPE_COL).value;
      const fitmentRaw = row.getCell(FITMENT_COL).value;
      rowCount++;

      if (!fitmentRaw || String(fitmentRaw).trim().length < 5) return;
      checked++;

      const fitStr = String(fitmentRaw);
      const lines = fitStr.split('\n').slice(0, 5); // first 5 fitment lines
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`Row ${row.number} | ${partNum} | ${partType}`);

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parsed = parseFitmentString(trimmed);
        for (const p of parsed) {
          const status = p.found > 0 ? `✓ ${p.found}` : '✗ miss';
          const parsed_info = `${p.make || '?'} / ${p.model || '?'}${p.submodel ? ` [${p.submodel}]` : ''}`;
          console.log(`  ${status.padEnd(8)} parsed: ${parsed_info.padEnd(35)} | ${p.raw.slice(0, 60)}`);
          if (p.found === 0 && p.make) {
            // Try relaxed model match (search older years too)
            const relaxed = db.prepare(`
              SELECT DISTINCT mo.ModelName FROM Model mo
              JOIN BaseVehicle bv ON bv.ModelID = mo.ModelID
              JOIN Make ma ON bv.MakeID = ma.MakeID
              WHERE ma.MakeName LIKE ? AND mo.ModelName LIKE ?
              ORDER BY mo.ModelName LIMIT 5
            `).all(`%${p.make}%`, `${(p.model || '').split(' ')[0]}%`);
            if (relaxed.length) console.log(`    → Closest VCDB models: ${relaxed.map(r => r.ModelName).join(', ')}`);
          }
        }
      }
    });
    ws.on('end', () => {});
  });

  await new Promise((resolve, reject) => {
    reader.on('end', resolve);
    reader.on('error', reject);
    reader.read();
  });

  console.log(`\n✓ Checked ${checked} rows with fitment data out of ${rowCount} total rows`);
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--stats')) {
  printStats();
  process.exit(0);
}

if (args.includes('--query')) {
  const idx = args.indexOf('--query');
  const sql = args[idx + 1];
  if (!sql) { console.error('Usage: --query "SELECT ..."'); process.exit(1); }
  try {
    const rows = db.prepare(sql).all();
    console.table(rows);
  } catch (e) {
    console.error(e.message);
  }
  process.exit(0);
}

if (args.includes('--lookup')) {
  const idx = args.indexOf('--lookup');
  const str = args[idx + 1];
  if (!str) { console.error('Usage: --lookup "2019 Ford F-150"'); process.exit(1); }
  const parsed = parseFitmentString(str);
  for (const p of parsed) {
    console.log(`\nParsed: year=${p.years.join(',')} make="${p.make}" model="${p.model}"`);
    if (p.found > 0) {
      const rows = lookupVehicles({ year: p.years[0], make: p.make, model: p.model });
      console.table(rows.slice(0, 10));
    } else {
      console.log('  ✗ No VCDB matches found');
      if (p.make) {
        const relaxed = lookupVehicles({ make: p.make });
        const models = [...new Set(relaxed.map(r => r.model))].slice(0, 10);
        console.log(`  Known ${p.make} models: ${models.join(', ')}`);
      }
    }
  }
  process.exit(0);
}

if (args.includes('--make')) {
  const idx = args.indexOf('--make');
  const make = args[idx + 1];
  const yearArg = args[idx + 2];
  const rows = listModels({ make, year: yearArg });
  console.log(`\nModels for "${make}"${yearArg ? ` in ${yearArg}` : ''}: ${rows.length} results\n`);
  console.table(rows);
  process.exit(0);
}

if (args.includes('--validate')) {
  const idx = args.indexOf('--validate');
  const file = args[idx + 1];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = Array.isArray(data) ? data : Object.values(data);
  let checked = 0;
  for (const item of items.slice(0, 20)) {
    const fitment = item.fitment || item.Fitment || item['Compatible Vehicles'] || '';
    if (!fitment) continue;
    checked++;
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`${item['Part Number'] || item.sku || ''}`);
    const parsed = parseFitmentString(String(fitment));
    for (const p of parsed.slice(0, 5)) {
      const status = p.found > 0 ? `✓ ${p.found}` : '✗ miss';
      console.log(`  ${status.padEnd(10)} ${p.raw.slice(0, 80)}`);
    }
  }
  console.log(`\n✓ Validated ${checked} items`);
  process.exit(0);
}

if (args.includes('--walmart')) {
  const idx = args.indexOf('--walmart');
  const file = args[idx + 1];
  const limit = parseInt(args[idx + 2] || '20');
  if (!file) { console.error('Usage: --walmart FILE.xlsx [limit]'); process.exit(1); }
  validateWalmartFitment(file, limit).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
  // (async, don't fall through)
  return;
}

// ─── Interactive REPL ───────────────────────────────────────────────────────

console.log('\n╔═══════════════════════════════════════════════════╗');
console.log('║  VCDB Interactive Query Tool                      ║');
console.log('╠═══════════════════════════════════════════════════╣');
console.log('║  Commands:                                         ║');
console.log('║    .stats              DB overview                 ║');
console.log('║    .lookup <str>       Parse + validate fitment    ║');
console.log('║    .make <make> [yr]   List models for a make      ║');
console.log('║    .vehicles <yr> <make> <model>  Find vehicles    ║');
console.log('║    Any SQL statement   Direct query                ║');
console.log('║    .exit               Quit                        ║');
console.log('╚═══════════════════════════════════════════════════╝\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'vcdb> ' });
rl.prompt();

rl.on('line', line => {
  const input = line.trim();
  if (!input) { rl.prompt(); return; }

  try {
    if (input === '.exit' || input === '.quit') { rl.close(); db.close(); process.exit(0); }
    else if (input === '.stats') { printStats(); }
    else if (input.startsWith('.lookup ')) {
      const str = input.slice(8);
      const parsed = parseFitmentString(str);
      for (const p of parsed) {
        console.log(`\nParsed: years=[${p.years.join(', ')}] make="${p.make}" model="${p.model}"`);
        const rows = lookupVehicles({ year: p.years[0], make: p.make, model: p.model });
        if (rows.length) console.table(rows.slice(0, 15));
        else console.log('  ✗ No matches. Try .make to list known models.');
      }
    }
    else if (input.startsWith('.make ')) {
      const parts = input.slice(6).split(' ');
      const make = parts[0], year = parts[1];
      const rows = listModels({ make, year });
      console.log(`\n${rows.length} model(s) for "${make}":`);
      console.table(rows);
    }
    else if (input.startsWith('.vehicles ')) {
      const parts = input.slice(10).split(' ');
      const [year, make, ...modelParts] = parts;
      const rows = lookupVehicles({ year, make, model: modelParts.join(' ') });
      console.table(rows);
    }
    else if (/^select/i.test(input)) {
      const rows = db.prepare(input).all();
      console.table(rows);
      console.log(`  ${rows.length} row(s)`);
    }
    else {
      console.log('  Unknown command. Try .stats, .lookup, .make, .vehicles, SELECT ..., or .exit');
    }
  } catch (e) {
    console.error(`  Error: ${e.message}`);
  }

  rl.prompt();
});

rl.on('close', () => { db.close(); process.exit(0); });
