#!/usr/bin/env node
/**
 * coverage-stats.js
 * For ACDelco rows in the source enhancement export, compute coverage stats
 * across every reference workbook.
 *
 * Outputs:
 *   data/_coverage.json   (machine-readable)
 *   stdout summary        (human-readable)
 *
 * No data loaded into LLM context — only summary printed.
 */

'use strict';
const ExcelJS = require('exceljs');
const fs      = require('fs');
const path    = require('path');

const HOME = process.env.HOME;
const SOURCE     = `${HOME}/Downloads/export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx`;
const BRAND_MAP  = `${HOME}/Downloads/Walmart Reference/Walmart_Brand Mapping_vf.xlsx`;
const ENHANCED   = `${HOME}/Downloads/Walmart Reference/Walmart_Enhanced Content_vf.xlsx`;
const TAXONOMY   = `${HOME}/Downloads/Walmart Reference/Walmart_Taxonomy Mapping_vf.xlsx`;
const FULLSCRAPE = `${HOME}/Downloads/Walmart Reference/Walmart_Full Scrape_ vf.xlsx`;
const OUT        = path.join(__dirname, '..', 'data', '_coverage.json');

const norm = v => String(v ?? '').trim();

async function streamRows(file, onRow, sheetName = null) {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(file, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore'
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
    if (sheetName) break;
    break; // first sheet only by default
  }
}

(async () => {
  // 1. ACDelco MPNs from source
  const acMpns = new Set();
  const acRows = [];
  await streamRows(SOURCE, (r) => {
    if (/^acdelco$/i.test(norm(r.Brand))) {
      const mpn = norm(r['Part Number']);
      acMpns.add(mpn);
      acRows.push({ mpn, partType: norm(r['Part Type']), title: norm(r['Title']),
                    hasFitment: !!norm(r['fitment']), hasFAB: !!norm(r['Features & Benefits']),
                    hasAttrs: !!norm(r['attributes']) });
    }
  });

  // 2. Brand Mapping coverage for ACDelco MPNs
  const bm = { hits: 0, byMapped: { true: 0, false: 0 }, byConfidence: {},
               brandCodeFilled: 0, parentCodeFilled: 0, sample: [] };
  const bmHitMpns = new Set();
  await streamRows(BRAND_MAP, (r) => {
    const mpn = norm(r['Part Number']);
    if (acMpns.has(mpn)) {
      bm.hits++;
      bmHitMpns.add(mpn);
      const mapped = String(r['Mapped?']);
      const conf   = norm(r['Match Confidence']);
      bm.byMapped[mapped] = (bm.byMapped[mapped] || 0) + 1;
      bm.byConfidence[conf] = (bm.byConfidence[conf] || 0) + 1;
      if (norm(r['Brand Code']))          bm.brandCodeFilled++;
      if (norm(r['Parent Company Code'])) bm.parentCodeFilled++;
      if (bm.sample.length < 5)
        bm.sample.push({ mpn, mapped, conf, brand: norm(r['Brand Code']),
                         parent: norm(r['Parent Company Code']),
                         method: norm(r['Match Method']),
                         inputBrand: norm(r['Input Brand']) });
    }
  });

  // 3. Enhanced Content coverage
  const ec = { hits: 0, missingTitle: 0, missingDesc: 0, missingFAB: 0, sample: [] };
  const ecHitMpns = new Set();
  await streamRows(ENHANCED, (r) => {
    const mpn = norm(r['Part Number']);
    if (acMpns.has(mpn)) {
      ec.hits++;
      ecHitMpns.add(mpn);
      if (!norm(r['Title']))                ec.missingTitle++;
      if (!norm(r['Description']))          ec.missingDesc++;
      if (!norm(r['Features and Benefits'])) ec.missingFAB++;
      if (ec.sample.length < 3)
        ec.sample.push({ mpn, hasTitle: !!norm(r['Title']),
                         hasDesc: !!norm(r['Description']),
                         hasFAB:  !!norm(r['Features and Benefits']) });
    }
  });

  // 4. Taxonomy coverage (PCdb sheet)
  const tax = { hits: 0, sample: [], partTermIdFilled: 0, partTermNameFilled: 0,
                distinctPartTermNames: new Set() };
  const taxHitMpns = new Set();
  await streamRows(TAXONOMY, (r) => {
    const mpn = norm(r['Part Number']);
    if (acMpns.has(mpn)) {
      tax.hits++;
      taxHitMpns.add(mpn);
      if (norm(r['PartTerminologyID']))   tax.partTermIdFilled++;
      const ptn = norm(r['PartTerminologyName']);
      if (ptn) { tax.partTermNameFilled++; tax.distinctPartTermNames.add(ptn); }
      if (tax.sample.length < 5)
        tax.sample.push({ mpn, cat: norm(r['CategoryName']), sub: norm(r['SubCategoryName']),
                          partTerm: ptn, partTermId: norm(r['PartTerminologyID']) });
    }
  }, 'PCdb Mapping');
  tax.distinctPartTermNames = [...tax.distinctPartTermNames];

  // 5. Full Scrape ACDelco — pull part_fitment + vehicle_fitment_type values per mpn
  const fs5 = { mpnsWithPartFitment: {}, mpnsWithVehicleFitmentType: {},
                mpnsWithFitment: 0, allKeysPerMpn: {} };
  await streamRows(FULLSCRAPE, (r) => {
    const brand = norm(r['productbrand']);
    if (!/^acdelco$/i.test(brand)) return;
    const mpn = norm(r['mpn']);
    const key = norm(r['key']);
    const val = norm(r['value']);
    if (!fs5.allKeysPerMpn[mpn]) fs5.allKeysPerMpn[mpn] = new Set();
    fs5.allKeysPerMpn[mpn].add(key);
    if (key === 'part_fitment')          fs5.mpnsWithPartFitment[mpn]          = val;
    if (key === 'vehicle_fitment_type')  fs5.mpnsWithVehicleFitmentType[mpn]   = val;
  });
  for (const mpn of Object.keys(fs5.allKeysPerMpn)) {
    if (fs5.allKeysPerMpn[mpn].has('fitment')) fs5.mpnsWithFitment++;
    fs5.allKeysPerMpn[mpn] = [...fs5.allKeysPerMpn[mpn]].sort();
  }

  // Compose
  const out = {
    acdelcoTotal: acMpns.size,
    sourcePartTypes: [...new Set(acRows.map(r => r.partType))].sort(),
    brandMapping: {
      hits: bm.hits, missing: acMpns.size - bmHitMpns.size,
      byMapped: bm.byMapped, byConfidence: bm.byConfidence,
      brandCodeFilled: bm.brandCodeFilled, parentCodeFilled: bm.parentCodeFilled,
      sample: bm.sample
    },
    enhancedContent: {
      hits: ec.hits, missing: acMpns.size - ecHitMpns.size,
      missingTitle: ec.missingTitle, missingDesc: ec.missingDesc, missingFAB: ec.missingFAB,
      sample: ec.sample
    },
    taxonomy: {
      hits: tax.hits, missing: acMpns.size - taxHitMpns.size,
      partTermIdFilled: tax.partTermIdFilled,
      distinctPartTermNames: tax.distinctPartTermNames,
      sample: tax.sample
    },
    fullScrape: {
      partFitmentMpns: Object.keys(fs5.mpnsWithPartFitment).length,
      partFitmentValues: fs5.mpnsWithPartFitment,
      vehicleFitmentTypeMpns: Object.keys(fs5.mpnsWithVehicleFitmentType).length,
      vehicleFitmentTypeValues: fs5.mpnsWithVehicleFitmentType,
      mpnsWithFitmentKey: fs5.mpnsWithFitment,
      mpnsInScrapeNotInSource: [...Object.keys(fs5.allKeysPerMpn)].filter(m => !acMpns.has(m))
    }
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  // Stdout summary
  console.log(`ACDelco MPNs in source: ${acMpns.size}\n`);

  console.log(`─── Brand Mapping ───`);
  console.log(`  hits=${out.brandMapping.hits}  missing=${out.brandMapping.missing}`);
  console.log(`  Mapped? counts:    ${JSON.stringify(out.brandMapping.byMapped)}`);
  console.log(`  Confidence counts: ${JSON.stringify(out.brandMapping.byConfidence)}`);
  console.log(`  Brand Code filled: ${out.brandMapping.brandCodeFilled}/${out.brandMapping.hits}`);
  console.log(`  Sample:`);
  out.brandMapping.sample.forEach(s => console.log(`    ${JSON.stringify(s)}`));

  console.log(`\n─── Enhanced Content ───`);
  console.log(`  hits=${out.enhancedContent.hits}  missing=${out.enhancedContent.missing}`);
  console.log(`  missingTitle=${out.enhancedContent.missingTitle}  missingDesc=${out.enhancedContent.missingDesc}  missingFAB=${out.enhancedContent.missingFAB}`);

  console.log(`\n─── Taxonomy (PCdb) ───`);
  console.log(`  hits=${out.taxonomy.hits}  missing=${out.taxonomy.missing}`);
  console.log(`  PartTerminologyID filled: ${out.taxonomy.partTermIdFilled}`);
  console.log(`  Distinct PartTerminologyNames among ACDelco: ${out.taxonomy.distinctPartTermNames.length}`);
  console.log(`    ${out.taxonomy.distinctPartTermNames.slice(0, 20).join(' | ')}${out.taxonomy.distinctPartTermNames.length > 20 ? ' …' : ''}`);

  console.log(`\n─── Full Scrape ───`);
  console.log(`  ACDelco MPNs with key=part_fitment:         ${out.fullScrape.partFitmentMpns}`);
  console.log(`    values: ${JSON.stringify(out.fullScrape.partFitmentValues)}`);
  console.log(`  ACDelco MPNs with key=vehicle_fitment_type: ${out.fullScrape.vehicleFitmentTypeMpns}`);
  console.log(`    values (top 10): ${JSON.stringify(Object.entries(out.fullScrape.vehicleFitmentTypeValues).slice(0,10))}`);
  console.log(`  ACDelco MPNs with key=fitment (long list):  ${out.fullScrape.mpnsWithFitmentKey}`);
  console.log(`  ACDelco MPNs in scrape but NOT in source:   ${out.fullScrape.mpnsInScrapeNotInSource.length}`);
  console.log(`    -> ${out.fullScrape.mpnsInScrapeNotInSource.slice(0,20).join(', ')}`);

  console.log(`\n─── Source Part Types (${out.sourcePartTypes.length}) ───`);
  out.sourcePartTypes.forEach(p => console.log(`  • ${p}`));

  console.log(`\nWrote → ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
