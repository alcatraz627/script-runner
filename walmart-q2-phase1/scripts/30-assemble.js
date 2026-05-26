#!/usr/bin/env node
/**
 * 30-assemble.js — Q2 Phase 1, brand-parameterized
 *   node 30-assemble.js --brand <brandKey> [--version v1]
 *   node 30-assemble.js --brand all
 *
 * Clones the template (preserves all cell styling — green/orange fills,
 * borders, bold headers) and strips the broken external defined name
 * `PTs_LIST` → `[1]Hidden_product_content_and_sit'!$A$50` before writing.
 *
 * Without the strip, ExcelJS reads the workbook, drops the external-link parts
 * during write, but keeps the `[1]`-prefixed `<definedName>` in workbook.xml.
 * Excel then sees a dangling external reference and shows "the file has
 * problems, attempting recovery".
 *
 * After clone+strip: row 4 (the template's sample TEST_MPN row) is overwritten
 * with the first data emission; subsequent rows append. Headers + merges +
 * dropdowns + cell styling are preserved exactly.
 */
'use strict';
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const ASSEMBLER_VERSION = '1.2.0';
const BRANDS = require('./brands.config.js');
const TEMPLATE = 'walmart-q2-phase1/input/walmart-q2-phase1-template-20260511.xlsx';
const DATADIR = 'walmart-q2-phase1/data';
const OUTDIR  = 'walmart-q2-phase1/output';
const COL_FIELD_MAP = [
  null, 'Action','MPN','BrandAAIAD','Year','Make','Model','PartTerminologyId','PartTerminologyName',
  'SubModel','BlockType','Cylinders','Liter','CC','Position','FuelType','Aspiration','DriveType',
  'BedLength','BodyType','BodyNumDoors','Notes',
];

const args = process.argv.slice(2);
function arg(name) { const i = args.indexOf(name); return i === -1 ? null : args[i+1]; }
const brandArg = (arg('--brand') || '').toLowerCase();
const versionTag = arg('--version') || 'v1';
if (!brandArg) { console.error('Usage: 30-assemble.js --brand <key|all> [--version v1]'); process.exit(1); }
const brandKeys = brandArg === 'all' ? Object.keys(BRANDS) : [brandArg];
for (const k of brandKeys) if (!BRANDS[k]) { console.error(`Unknown brand "${k}"`); process.exit(1); }

const sha256File = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// Template metadata recreated verbatim from the input template probe.
const COL_DEFS = [
  // [index, header, flagRow1, descriptionRow2, internalField, width]
  [ 1, 'Action(A or D)',                       'Optional',  "Action to ADD ('A') or DELETE ('D'). (Blank) Default is add. ",                                  'Action',              12.33],
  [ 2, 'Manufacturer Part Number (MPN)',       'Required',  'Manufacturer part number submitted during Walmart item set up.',                                 'MPN',                 29.33],
  [ 3, 'BrandAAIAD',                           'Required',  'AAIA Brand ID Provided by the AutoCare Assocation',                                              'BrandAAIAD',          11],
  [ 4, 'Year(YYYY)/Year Range (YYYY-YYYY)',    'Required',  'Year as 2019 or Year as range 2016-2019',                                                        'Year',                31.16],
  [ 5, 'Make',                                 'Required',  'Make Name from downloadable vehicle list',                                                       'Make',                8.83],
  [ 6, 'Model',                                'Required',  'Model Name from Downloadable Vehicle List',                                                      'Model',               8.33],
  [ 7, 'Part Terminology Id',                  'Required',  'Part Terminology ID from PCDB',                                                                  'PartTerminologyId',   17],
  [ 8, 'Part Terminology Name',                'Optional - only recommended if part compatitiliby dependent (If blank assumed it will fit all configurations)', 'Part Terminology Name from Part Type List', 'PartTerminologyName', 20.33],
  [ 9, 'SubModel',                             'Optional - only recommended if part compatitiliby dependent (If blank assumed it will fit all configurations)', 'Submodel Name from Vehicle List',           'SubModel',            10],
  [10, 'BlockType',                            'Optional - only recommended if part compatitiliby dependent (If blank assumed it will fit all configurations)', 'BlockType from Vehicle List example L',     'BlockType',           10],
  [11, 'Cylinders',                            'Optional - only recommended if part compatitiliby dependent (If blank assumed it will fit all configurations)', 'Numerical Values only Not alphanumeric (No Decimals i.e. 4, 6, etc)', 'Cylinders', 10],
  [12, 'Liter',                                'Optional - only recommended if part compatitiliby dependent (If blank assumed it will fit all configurations)', 'Numerical Values only Not alphanumeric (Has to be decimals i.e 2.0, 3.0, etc)', 'Liter', 10],
  [13, 'CC',                                   'Optional - only recommended if part compatitiliby dependent (If blank assumed it will fit all configurations)', 'Numerical Values only Not alphanumeric (No Decimals)', 'CC', 10],
  [14, 'Position',                             'Optional - only recommended if part compatitiliby dependent (If blank assumed it will fit all configurations)', 'i.e. front, rear, front passenger, etc',    'Position',            10],
  [15, 'FuelType',                             'Optional - only recommended if part compatitiliby dependent (If blank assumed it will fit all configurations)', 'Gas, Diesel, Flex Fuel, etc',               'FuelType',            8.5],
  [16, 'Aspiration',                           'Optional - only recommended if part compatitiliby dependent (If blank assumed it will fit all configurations)', 'Natural, Turbocharged, Supercharged, etc',  'Aspiration',          15],
  [17, 'DriveType',                            'Optional - only recommended if part compatitiliby dependent (If blank assumed it will fit all configurations)', 'FWD, RWD, 4WD, AWD, 4x4, 4x2, etc',         'DriveType',           9],
  [18, 'Bed Length',                           'Optional - only recommended if part compatitiliby dependent (If blank assumed it will fit all configurations)', 'Typically Length in inches (Has to be decimal i.e. 60.0, 60.2, etc)', 'BedLength', 12],
  [19, 'BodyType',                             'Optional (Drop Down)',        'Please provide inputs based on extended attribute header selected',              'BodyType',            12],
  [20, 'BodyNumDoors',                         'Optional (Drop Down)',        'Please provide inputs based on extended attribute header selected',              'BodyNumDoors',        14.83],
  [21, 'Notes',                                'Optional',                    'Any other notes to display to customer as text. ',                               'Notes',               10.66],
];

// Dropdown list source for cols 19/20 — matches the template's data validation.
const EXT_ATTR_LIST = '"CylinderHeadType, EngineDesignation, BodyType, BodyNumDoors"';

async function readEmissions(jsonlPath) {
  const out = [];
  const rl = readline.createInterface({ input: fs.createReadStream(jsonlPath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* skip malformed */ }
  }
  return out;
}

async function cloneTemplateAndStripBadDefinedNames() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);
  // Strip ALL workbook-level defined names — Q2 Phase 1 needs none of them
  // and the template's PTs_LIST points to an external workbook that ExcelJS
  // can't preserve, causing Excel to flag corruption on open.
  try {
    // wb.definedNames.model is an Array of { name, ranges }, not a Map.
    if (wb.definedNames && Array.isArray(wb.definedNames.model) && typeof wb.definedNames.remove === 'function') {
      const names = wb.definedNames.model.map(d => d.name);
      for (const n of names) wb.definedNames.remove(n);
    }
    // Belt-and-braces: clear the raw model arrays too.
    if (wb.definedNames && Array.isArray(wb.definedNames.model)) wb.definedNames.model.length = 0;
    if (wb.model && Array.isArray(wb.model.definedNames)) wb.model.definedNames.length = 0;
  } catch (e) { /* non-fatal — write will succeed or fail downstream */ }
  const ws = wb.getWorksheet('Phase 1');
  if (!ws) throw new Error('Template missing "Phase 1" sheet');
  return { wb, ws };
}

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });

  for (const brand of brandKeys) {
    const filledPath = path.join(DATADIR, `02-${brand}-filled.jsonl`);
    if (!fs.existsSync(filledPath)) { console.warn(`[${brand}] no filled JSONL — skipping`); continue; }
    const emissions = await readEmissions(filledPath);
    console.log(`[${brand}] loaded ${emissions.length} emissions`);

    const { wb, ws } = await cloneTemplateAndStripBadDefinedNames();

    // Overwrite the template's sample row (row 4) onward with real data.
    // Cell-level styling on row 4 is preserved by exceljs and will be
    // re-applied to subsequent rows when we set values.
    let rowIdx = 4;
    for (const emission of emissions) {
      const row = ws.getRow(rowIdx);
      for (let c = 1; c < COL_FIELD_MAP.length; c++) {
        const fieldName = COL_FIELD_MAP[c];
        const cellData = emission.cells[fieldName];
        row.getCell(c).value = cellData ? String(cellData.value) : '';
      }
      row.commit();
      rowIdx++;
    }

    const outPath = path.join(OUTDIR, `walmart-loadsheet-${brand}-q2p1-${versionTag}.xlsx`);
    await wb.xlsx.writeFile(outPath);

    // Post-process: ExcelJS's definedNames API doesn't actually remove entries
    // before write — the model survives somewhere internal. So we strip them
    // by editing workbook.xml directly in the zip. This is the only path that
    // reliably eliminates the broken external reference that triggers Excel's
    // recovery dialog.
    {
      const zipBuf = fs.readFileSync(outPath);
      const zip = await JSZip.loadAsync(zipBuf);
      const workbookFile = zip.file('xl/workbook.xml');
      let xml = await workbookFile.async('string');
      const before = xml;
      xml = xml.replace(/<definedNames>[\s\S]*?<\/definedNames>/g, '');
      if (xml !== before) {
        zip.file('xl/workbook.xml', xml);
        const newBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        fs.writeFileSync(outPath, newBuf);
      }
    }

    const meta = {
      assembler: { script: '30-assemble.js', version: ASSEMBLER_VERSION },
      brand,
      versionTag,
      generatedAt: new Date().toISOString(),
      input: { path: filledPath, sha256: sha256File(filledPath), rowCount: emissions.length },
      output: { path: outPath, sha256: sha256File(outPath), bytes: fs.statSync(outPath).size, dataRowCount: emissions.length },
      colMap: Object.fromEntries(COL_DEFS.map(d => [d[0], d[4]])),
      note: 'Built from scratch (not template clone) to avoid external defined-name corruption.',
    };
    fs.writeFileSync(outPath.replace(/\.xlsx$/, '.meta.json'), JSON.stringify(meta, null, 2));

    console.log(`[${brand}] → ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)}KB, ${emissions.length} data rows)`);
  }
})().catch(e => { console.error(e); process.exit(1); });
