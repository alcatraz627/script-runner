#!/usr/bin/env node
/**
 * _explore-universes.js — what if we drop the source-export shortlist?
 *
 * Compares the MPN universes across our 5 reference data sources + source
 * export, and quantifies the "expanded ship" if we used brand-mapping or
 * taxonomy or VCdb as the universe instead.
 *
 * Output: console + walmart-q2-phase1/data/_universe-overlap.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATADIR = 'walmart-q2-phase1/data';

(async () => {
  // Load each universe as a Set<mpn>
  const taxonomy = JSON.parse(fs.readFileSync(path.join(DATADIR, 'taxonomy-by-mpn.json')));
  const brandMap = JSON.parse(fs.readFileSync(path.join(DATADIR, 'brand-mapping-by-mpn.json')));
  const enhanced = JSON.parse(fs.readFileSync(path.join(DATADIR, 'enhanced-content-by-mpn.json')));

  const taxMpns   = new Set(Object.keys(taxonomy));
  const brandMpns = new Set(Object.keys(brandMap));
  const enhMpns   = new Set(Object.keys(enhanced));

  // Source export MPNs: scan our 01-{brand}-source.json files
  const srcMpns = new Set();
  for (const f of fs.readdirSync(DATADIR)) {
    if (!/^01-.+-source\.json$/.test(f)) continue;
    const arr = JSON.parse(fs.readFileSync(path.join(DATADIR, f)));
    for (const r of arr) if (r.mpn) srcMpns.add(r.mpn);
  }

  // VCdb MPNs: from materialized JSONL
  const vcdbMpns = new Set();
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(DATADIR, '_raw-content-parsed.jsonl')), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try { vcdbMpns.add(JSON.parse(line).partNumber); } catch (e) {}
  }

  console.log('Universe sizes:');
  console.log(`  source export:    ${srcMpns.size}`);
  console.log(`  VCdb:             ${vcdbMpns.size}`);
  console.log(`  Brand Mapping:    ${brandMpns.size}`);
  console.log(`  Taxonomy:         ${taxMpns.size}`);
  console.log(`  Enhanced Content: ${enhMpns.size}`);

  function intersect(a, b) { return new Set([...a].filter(x => b.has(x))); }
  function diff(a, b) { return new Set([...a].filter(x => !b.has(x))); }
  function union(...sets) { const r = new Set(); for (const s of sets) for (const x of s) r.add(x); return r; }

  console.log('\nOverlaps with source export:');
  console.log(`  VCdb ∩ source:      ${intersect(vcdbMpns, srcMpns).size}  (vs |source|=${srcMpns.size}, |VCdb|=${vcdbMpns.size})`);
  console.log(`  Brand ∩ source:     ${intersect(brandMpns, srcMpns).size}`);
  console.log(`  Tax   ∩ source:     ${intersect(taxMpns, srcMpns).size}`);
  console.log(`  Enh   ∩ source:     ${intersect(enhMpns, srcMpns).size}`);

  console.log('\nMPNs IN VCdb but NOT in source (would be added if expanded):');
  const vcdbMinusSrc = diff(vcdbMpns, srcMpns);
  console.log(`  count: ${vcdbMinusSrc.size}`);
  // For these, do they have brand-mapping + taxonomy coverage?
  let bothCovered = 0, brandOnly = 0, taxOnly = 0, neither = 0;
  for (const m of vcdbMinusSrc) {
    const hasBrand = brandMpns.has(m);
    const hasTax = taxMpns.has(m);
    if (hasBrand && hasTax) bothCovered++;
    else if (hasBrand) brandOnly++;
    else if (hasTax) taxOnly++;
    else neither++;
  }
  console.log(`    brand+tax covered: ${bothCovered}  (could ship — all required cols possible)`);
  console.log(`    brand only:        ${brandOnly}`);
  console.log(`    tax only:          ${taxOnly}`);
  console.log(`    neither:           ${neither}  (couldn't ship — no Brand AAIA or Part Term)`);

  // Sample some "addable" MPNs
  const addable = [...vcdbMinusSrc].filter(m => brandMpns.has(m) && taxMpns.has(m));
  console.log(`\n  Sample of ${Math.min(15, addable.length)} addable MPNs:`);
  for (const m of addable.slice(0, 15)) {
    const bm = brandMap[m], tx = taxonomy[m];
    console.log(`    ${m.padEnd(18)} brand="${bm.inputBrand}" code=${bm.brandCode}  part="${tx.partTerminologyName}"`);
  }

  console.log('\nIf we expanded the universe to ALL VCdb MPNs:');
  console.log(`  Current ship MPNs: 689`);
  console.log(`  Potential add:     ${bothCovered} (with brand+tax coverage)`);
  console.log(`  Potential ship:    ${689 + bothCovered}`);
  console.log('  (Estimating rows: depends on per-MPN VCdb row count for the addable ones — see report)');

  // Per addable MPN: how many VCdb rows? (re-scan briefly)
  const addableSet = new Set(addable);
  const perMpnRowCount = new Map();
  const rl2 = readline.createInterface({ input: fs.createReadStream(path.join(DATADIR, '_raw-content-parsed.jsonl')), crlfDelay: Infinity });
  for await (const line of rl2) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      if (addableSet.has(r.partNumber)) perMpnRowCount.set(r.partNumber, (perMpnRowCount.get(r.partNumber) || 0) + 1);
    } catch (e) {}
  }
  const totalAddableRows = [...perMpnRowCount.values()].reduce((a, b) => a + b, 0);
  console.log(`  Total addable fitment rows: ${totalAddableRows}`);
  const topAddable = [...perMpnRowCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log('\n  Top 10 addable MPNs by row count:');
  for (const [m, c] of topAddable) {
    const bm = brandMap[m], tx = taxonomy[m];
    console.log(`    ${String(c).padStart(6)}  ${m.padEnd(18)} brand="${bm.inputBrand}"  part="${tx.partTerminologyName}"`);
  }

  // The flip-side: source MPNs we've already dropped (no VCdb)
  console.log('\nFlip-side: source MPNs without VCdb match (dropped today):');
  const srcMinusVcdb = diff(srcMpns, vcdbMpns);
  console.log(`  count: ${srcMinusVcdb.size}`);
  let dropBrandOnly = 0, dropTaxOnly = 0, dropBoth = 0;
  for (const m of srcMinusVcdb) {
    const hasBrand = brandMpns.has(m), hasTax = taxMpns.has(m);
    if (hasBrand && hasTax) dropBoth++;
    else if (hasBrand) dropBrandOnly++;
    else if (hasTax) dropTaxOnly++;
  }
  console.log(`    have brand+tax but no VCdb: ${dropBoth} (truly universal-fit; no fitment data exists for them)`);

  const report = {
    generatedAt: new Date().toISOString(),
    universes: {
      sourceExport: srcMpns.size,
      vcdb: vcdbMpns.size,
      brandMapping: brandMpns.size,
      taxonomy: taxMpns.size,
      enhancedContent: enhMpns.size,
    },
    expansionScenario_AllVcdb: {
      currentShipMpns: 689,
      addableMpns: bothCovered,
      addableRows: totalAddableRows,
      potentialTotalMpns: 689 + bothCovered,
      sampleAddable: addable.slice(0, 50).map(m => ({
        mpn: m, brand: brandMap[m].inputBrand, brandCode: brandMap[m].brandCode,
        partType: taxonomy[m].partTerminologyName, rowCount: perMpnRowCount.get(m),
      })),
    },
  };
  fs.writeFileSync(path.join(DATADIR, '_universe-overlap.json'), JSON.stringify(report, null, 2));
  console.log('\nWrote: walmart-q2-phase1/data/_universe-overlap.json');
})().catch(e => { console.error(e); process.exit(1); });
