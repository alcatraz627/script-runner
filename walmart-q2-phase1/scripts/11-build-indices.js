#!/usr/bin/env node
/**
 * 11-build-indices.js — Q2 Phase 1
 *
 * Re-derive the three brand-agnostic MPN lookup indices from the reference
 * workbooks. Per Q4 decision (2026-05-11): no carry-over from vf, re-derive
 * to avoid stale-data risk.
 *
 * Outputs (under walmart-q2-phase1/data/):
 *   brand-mapping-by-mpn.json
 *   enhanced-content-by-mpn.json
 *   taxonomy-by-mpn.json
 *
 * Each file gets a sidecar .meta.json per R2.5 with input sha256, generation
 * timestamp, parser version, row counts.
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INDEX_BUILDER_VERSION = '1.0.0';
const HOME = process.env.HOME;
const REF = `${HOME}/Downloads/Walmart Reference`;
const OUTDIR = 'walmart-q2-phase1/data';

const norm = v => String(v ?? '').trim();
const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

async function streamFirstSheet(file, onRow, sheetName = null) {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(file, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore',
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

function writeWithMeta(outName, data, inputFile) {
  const outPath = path.join(OUTDIR, outName);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  const meta = {
    builder: { script: '11-build-indices.js', version: INDEX_BUILDER_VERSION },
    input: { path: inputFile, sizeBytes: fs.statSync(inputFile).size, sha256: sha256(inputFile) },
    output: { path: outPath, sizeBytes: fs.statSync(outPath).size, sha256: sha256(outPath), mpnCount: Object.keys(data).length },
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(outPath.replace(/\.json$/, '.meta.json'), JSON.stringify(meta, null, 2));
}

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });

  // 1) Brand Mapping
  const brandFile = `${REF}/Walmart_Brand Mapping_vf.xlsx`;
  console.log(`[1/3] Brand Mapping: ${path.basename(brandFile)} (${(fs.statSync(brandFile).size / 1024).toFixed(0)}KB)`);
  const brandIdx = {};
  await streamFirstSheet(brandFile, (r) => {
    const mpn = norm(r['Part Number']);
    if (!mpn) return;
    brandIdx[mpn] = {
      mpn,
      inputBrand: norm(r['Input Brand']),
      mapped:     String(r['Mapped?']) === 'true' || r['Mapped?'] === true,
      method:     norm(r['Match Method']),
      confidence: norm(r['Match Confidence']),
      parentCode: norm(r['Parent Company Code']),
      brandCode:  norm(r['Brand Code']),
    };
  });
  writeWithMeta('brand-mapping-by-mpn.json', brandIdx, brandFile);
  console.log(`      → ${Object.keys(brandIdx).length} MPNs`);

  // 2) Enhanced Content
  const enhFile = `${REF}/Walmart_Enhanced Content_vf.xlsx`;
  console.log(`[2/3] Enhanced Content: ${path.basename(enhFile)} (${(fs.statSync(enhFile).size / 1024).toFixed(0)}KB)`);
  const enhIdx = {};
  await streamFirstSheet(enhFile, (r) => {
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
  writeWithMeta('enhanced-content-by-mpn.json', enhIdx, enhFile);
  console.log(`      → ${Object.keys(enhIdx).length} MPNs`);

  // 3) Taxonomy (PCdb Mapping sheet — same choice as vf)
  const taxFile = `${REF}/Walmart_Taxonomy Mapping_vf.xlsx`;
  console.log(`[3/3] Taxonomy: ${path.basename(taxFile)} (${(fs.statSync(taxFile).size / 1024).toFixed(0)}KB)`);
  const taxIdx = {};
  await streamFirstSheet(taxFile, (r) => {
    const mpn = norm(r['Part Number']);
    if (!mpn) return;
    taxIdx[mpn] = {
      mpn,
      brand:               norm(r['Brand']),
      categoryId:          norm(r['CategoryID']),
      categoryName:        norm(r['CategoryName']),
      subCategoryId:       norm(r['SubCategoryID']),
      subCategoryName:     norm(r['SubCategoryName']),
      partTerminologyId:   norm(r['PartTerminologyID']),
      partTerminologyName: norm(r['PartTerminologyName']),
    };
  }, 'PCdb Mapping');
  writeWithMeta('taxonomy-by-mpn.json', taxIdx, taxFile);
  console.log(`      → ${Object.keys(taxIdx).length} MPNs`);

  // Verify against vf for sanity (warn-only; expected to match since inputs unchanged)
  console.log('\nSanity diff vs vf indices (warn-only):');
  for (const name of ['brand-mapping-by-mpn.json', 'enhanced-content-by-mpn.json', 'taxonomy-by-mpn.json']) {
    const vfPath = `walmart-vf/data/${name}`;
    const newPath = path.join(OUTDIR, name);
    if (!fs.existsSync(vfPath)) { console.log(`  ${name}: no vf baseline to compare`); continue; }
    const vfSha = sha256(vfPath);
    const newSha = sha256(newPath);
    console.log(`  ${name}: ${vfSha === newSha ? '✓ byte-identical to vf' : `Δ differs (vf=${vfSha.slice(0,12)}, new=${newSha.slice(0,12)})`}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
