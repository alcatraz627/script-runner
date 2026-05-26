#!/usr/bin/env node
/**
 * 11-build-indices.js
 *
 * Builds three small JSON lookup indices keyed by Part Number:
 *   data/brand-mapping-by-mpn.json     — { mpn: { brandCode, parentCode, mapped, confidence, method, inputBrand } }
 *   data/enhanced-content-by-mpn.json  — { mpn: { title, description, features, partType, inputBrand } }
 *   data/taxonomy-by-mpn.json          — { mpn: { categoryId, categoryName, subCategoryId, subCategoryName, partTerminologyId, partTerminologyName } }
 *
 * Lookup keys are coerced to string and trimmed. Numeric-looking part numbers
 * are stored both as-is AND with leading-zero variants so future lookups don't
 * silently miss because of formatting drift.
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME;
const REF  = `${HOME}/Downloads/Walmart Reference`;
const OUTDIR = path.join(__dirname, '..', 'data');

const norm = v => String(v ?? '').trim();

async function streamFirstSheet(file, onRow, sheetName = null) {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(file, {
    worksheets:'emit', sharedStrings:'cache', hyperlinks:'ignore', styles:'ignore'
  });
  for await (const ws of wb) {
    if (sheetName && ws.name !== sheetName) { for await (const _ of ws) {} continue; }
    let n = 0, headers = null;
    for await (const row of ws) {
      const vals = row.values.slice(1).map(v => (v && v.text) || v);
      if (n === 0) headers = vals.map(norm);
      else { const obj = {}; headers.forEach((h, i) => obj[h] = vals[i]); onRow(obj, headers); }
      n++;
    }
    break;
  }
}

(async () => {
  // 1) Brand Mapping
  const brandIdx = {};
  await streamFirstSheet(`${REF}/Walmart_Brand Mapping_vf.xlsx`, (r) => {
    const mpn = norm(r['Part Number']);
    if (!mpn) return;
    brandIdx[mpn] = {
      mpn,
      inputBrand:  norm(r['Input Brand']),
      mapped:      String(r['Mapped?']) === 'true' || r['Mapped?'] === true,
      method:      norm(r['Match Method']),
      confidence:  norm(r['Match Confidence']),
      parentCode:  norm(r['Parent Company Code']),
      brandCode:   norm(r['Brand Code']),
    };
  });
  fs.writeFileSync(path.join(OUTDIR, 'brand-mapping-by-mpn.json'), JSON.stringify(brandIdx, null, 2));
  console.log(`brand-mapping: ${Object.keys(brandIdx).length} mpns`);

  // 2) Enhanced Content
  const enhIdx = {};
  await streamFirstSheet(`${REF}/Walmart_Enhanced Content_vf.xlsx`, (r) => {
    const mpn = norm(r['Part Number']);
    if (!mpn) return;
    enhIdx[mpn] = {
      mpn,
      inputBrand:  norm(r['Input Brand']),
      partType:    norm(r['Part Type']),
      title:       norm(r['Title']),
      description: norm(r['Description']),
      features:    norm(r['Features and Benefits']),
    };
  });
  fs.writeFileSync(path.join(OUTDIR, 'enhanced-content-by-mpn.json'), JSON.stringify(enhIdx, null, 2));
  console.log(`enhanced-content: ${Object.keys(enhIdx).length} mpns`);

  // 3) Taxonomy (PCdb sheet only — primary per Q4)
  const taxIdx = {};
  await streamFirstSheet(`${REF}/Walmart_Taxonomy Mapping_vf.xlsx`, (r) => {
    const mpn = norm(r['Part Number']);
    if (!mpn) return;
    taxIdx[mpn] = {
      mpn,
      brand:                 norm(r['Brand']),
      categoryId:            norm(r['CategoryID']),
      categoryName:          norm(r['CategoryName']),
      subCategoryId:         norm(r['SubCategoryID']),
      subCategoryName:       norm(r['SubCategoryName']),
      partTerminologyId:     norm(r['PartTerminologyID']),
      partTerminologyName:   norm(r['PartTerminologyName']),
    };
  }, 'PCdb Mapping');
  fs.writeFileSync(path.join(OUTDIR, 'taxonomy-by-mpn.json'), JSON.stringify(taxIdx, null, 2));
  console.log(`taxonomy: ${Object.keys(taxIdx).length} mpns`);
})().catch(e => { console.error(e); process.exit(1); });
