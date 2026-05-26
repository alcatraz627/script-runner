#!/usr/bin/env node
/**
 * _deep-data-review.js — focused investigations for each notable the user
 * asked about. Produces one JSON + console-printed sections.
 *
 *   1. Duplication illusion — stats + examples
 *   3. SubModel "20" — DB ID or real value?
 *   4. SubModel-from-Trim — examples + risk of wrong values
 *   5. Borrowed AAIA codes — full details (MagnaFlow, ABC)
 *   6. Year encoding — confirm non-contiguous joins behave
 *  15. Market-specific Make names — structural reason
 *  17. Liter off-by-decimal — magnitude
 *  21. Universal-fit MPNs — pull up cases, hunt for salvageable ones
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { encodeYearField } = require('./lib/year-encode.js');

const DATADIR = 'walmart-q2-phase1/data';

function loadIndex(name) { return JSON.parse(fs.readFileSync(path.join(DATADIR, name))); }

(async () => {
  const out = { generatedAt: new Date().toISOString() };

  // ============ #6 Year encoding sanity ============
  console.log('═════════ #6 Year encoding non-contiguous sanity ═════════');
  const yearCases = [
    '1971, 1972, 1975, 1977, 1978',
    '1971-1972, 1975, 1977-1978',
    '1980, 1982, 1984, 1986, 1988',
    '2010-2012, 2015-2017, 2020',
  ];
  out.yearEncodingCheck = [];
  for (const c of yearCases) {
    const result = encodeYearField(c);
    console.log(`  "${c}"  →  ${JSON.stringify(result)}`);
    out.yearEncodingCheck.push({ input: c, result });
  }

  // Now scan actual data: how many emitted rows came from a comma-list source?
  let totalYearCells = 0, singleYearCells = 0, rangeYearCells = 0;
  // Sample non-contiguous expansions seen in real data
  const sampleEmittedYears = new Set();
  // (We can't tell from output alone whether a row was part of a non-contig list,
  // but we can confirm the encoded forms are well-shaped.)

  // ============ #3 SubModel "20" — DB ID or real value? ============
  console.log('\n═════════ #3 SubModel — distribution + the "20" mystery ═════════');
  // Scan the materialized VCdb to see what VCdb's SubModel ID vs Name actually carry
  const submodelStats = { distinct: new Map(), numericOnly: new Map(), nonNumeric: new Map() };
  // Also: when SubModel Name = "20", what does VCdb's `SubModel ID` say?
  const subModelAlignment = { matchesSubModelId: 0, differsFromSubModelId: 0, samples: [] };
  let vcdbScanned = 0;
  {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(DATADIR, '_raw-content-parsed.jsonl')), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        vcdbScanned++;
        const sm = r.vcdbCol['SubModel Name'];
        const smId = r.vcdbCol['SubModel ID'];
        if (sm) {
          submodelStats.distinct.set(sm, (submodelStats.distinct.get(sm) || 0) + 1);
          if (/^\d+$/.test(sm)) submodelStats.numericOnly.set(sm, (submodelStats.numericOnly.get(sm) || 0) + 1);
          else submodelStats.nonNumeric.set(sm, (submodelStats.nonNumeric.get(sm) || 0) + 1);
          // Alignment check
          if (sm === smId) subModelAlignment.matchesSubModelId++;
          else subModelAlignment.differsFromSubModelId++;
          if (sm === '20' && subModelAlignment.samples.length < 8) {
            subModelAlignment.samples.push({ mpn: r.partNumber, make: r.vcdbCol['Make Name'], model: r.vcdbCol['Model Name'], year: r.vcdbCol['Year ID'], subModelName: sm, subModelId: smId });
          }
        }
      } catch (e) {}
    }
  }
  const numericTotal = [...submodelStats.numericOnly.values()].reduce((s,c)=>s+c,0);
  const nonNumericTotal = [...submodelStats.nonNumeric.values()].reduce((s,c)=>s+c,0);
  const grandTotal = numericTotal + nonNumericTotal;
  console.log(`VCdb rows scanned: ${vcdbScanned}`);
  console.log(`SubModel Name populated: ${grandTotal} rows  (${(grandTotal / vcdbScanned * 100).toFixed(1)}%)`);
  console.log(`  numeric-only values: ${numericTotal}  (${(numericTotal / grandTotal * 100).toFixed(1)}%)`);
  console.log(`  non-numeric values:  ${nonNumericTotal}`);
  console.log(`Alignment of SubModel Name vs SubModel ID:`);
  console.log(`  same value:    ${subModelAlignment.matchesSubModelId}`);
  console.log(`  different:     ${subModelAlignment.differsFromSubModelId}`);
  console.log('\nTop 10 numeric-only SubModel values:');
  [...submodelStats.numericOnly.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([k,v]) => console.log(`  ${String(k).padEnd(6)}  ${v} rows`));
  console.log('\nTop 10 non-numeric SubModel values:');
  [...submodelStats.nonNumeric.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([k,v]) => console.log(`  ${String(k).padEnd(20)}  ${v} rows`));
  console.log('\nSample "SubModel Name = 20" rows (with SubModel ID for comparison):');
  for (const s of subModelAlignment.samples) {
    console.log(`  ${s.year} ${s.make} ${s.model}  — Name="${s.subModelName}"  ID="${s.subModelId}"  (mpn=${s.mpn})`);
  }
  out.submodelInvestigation = {
    vcdbScanned, grandTotal,
    numericOnlyCount: numericTotal, nonNumericCount: nonNumericTotal,
    nameMatchesId: subModelAlignment.matchesSubModelId,
    nameDiffersFromId: subModelAlignment.differsFromSubModelId,
    topNumeric: [...submodelStats.numericOnly.entries()].sort((a,b)=>b[1]-a[1]).slice(0,30),
    topNonNumeric: [...submodelStats.nonNumeric.entries()].sort((a,b)=>b[1]-a[1]).slice(0,30),
    samples_subModel_eq_20: subModelAlignment.samples,
  };

  // Count how many SHIPPED rows have numeric-only SubModel
  let shippedNumericSubmodel = 0, shippedTotalRows = 0, shippedWithSubmodel = 0;
  const numericSubmodelShipSamples = [];
  // also for #4 from-trim
  const fromTrimSamples = [];
  let fromTrimShipped = 0;
  // and the brand-fallback in xlsx for #5
  const fallbackSamples = [];
  // and unusual makes for #15
  const unusualMakes = new Map();
  // and Liter accuracy (#17) - need to find rows where we shipped Liter, see distribution
  const literOddities = [];
  let literShipped = 0;

  const BRANDS = require('./brands.config.js');
  for (const brand of Object.keys(BRANDS)) {
    const fp = path.join(DATADIR, `02-${brand}-filled.jsonl`);
    if (!fs.existsSync(fp) || fs.statSync(fp).size === 0) continue;
    const rl = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        shippedTotalRows++;
        const sm = r.cells.SubModel?.value;
        if (sm) {
          shippedWithSubmodel++;
          if (/^\d+$/.test(sm)) {
            shippedNumericSubmodel++;
            if (numericSubmodelShipSamples.length < 12) numericSubmodelShipSamples.push({ brand, mpn: r.mpn, year: r.cells.Year?.value, make: r.cells.Make?.value, model: r.cells.Model?.value, sm, src: r.cells.SubModel?.source });
          }
        }
        if (r.cells.SubModel?.source?.includes('submodelFromTrim')) {
          fromTrimShipped++;
          if (fromTrimSamples.length < 25) fromTrimSamples.push({ brand, mpn: r.mpn, year: r.cells.Year?.value, make: r.cells.Make?.value, model: r.cells.Model?.value, sm, format: r.format });
        }
        if (r.cells.BrandAAIAD?.source?.includes('brand-fallback')) {
          if (fallbackSamples.length < 20) fallbackSamples.push({ brand, mpn: r.mpn, brandAAIAD: r.cells.BrandAAIAD?.value, srcLabel: r.cells.BrandAAIAD?.source });
        }
        const make = r.cells.Make?.value;
        if (make) {
          // Build set of "unusual" makes — heavy-duty, market-specific
          const lc = make.toLowerCase();
          if (/(lobo|sterling truck|freightliner|kenworth|peterbilt|international|mack|hino|isuzu commercial|workhorse|gillig|prevost|setra|new flyer|blue bird|thomas built|crown)/.test(lc)) {
            unusualMakes.set(make, (unusualMakes.get(make) || 0) + 1);
          }
        }
        const liter = r.cells.Liter?.value;
        if (liter) {
          literShipped++;
          const L = parseFloat(liter);
          if (Number.isFinite(L)) {
            // Flag the >10L territory; spot-check Sterling/heavy-duty rows
            if (L >= 10 && literOddities.length < 15) literOddities.push({ brand, mpn: r.mpn, make: r.cells.Make?.value, model: r.cells.Model?.value, year: r.cells.Year?.value, liter, src: r.cells.Liter?.source });
          }
        }
      } catch (e) {}
    }
  }
  out.shippedSubmodelStats = {
    totalRows: shippedTotalRows, withSubmodel: shippedWithSubmodel,
    numericSubmodel: shippedNumericSubmodel,
    samples: numericSubmodelShipSamples,
  };
  out.fromTrimSamples = fromTrimSamples;
  out.fallbackSamples = fallbackSamples;
  out.unusualMakes = [...unusualMakes.entries()].sort((a,b)=>b[1]-a[1]);
  out.literOddities = literOddities;

  console.log('\n═════════ #3 SubModel numeric-only in SHIPPED rows ═════════');
  console.log(`Shipped rows with SubModel:        ${shippedWithSubmodel}`);
  console.log(`Of those, numeric-only values:     ${shippedNumericSubmodel}  (${(shippedNumericSubmodel/shippedWithSubmodel*100).toFixed(1)}%)`);
  console.log('Sample numeric-only SubModel cells in ship:');
  numericSubmodelShipSamples.slice(0,8).forEach(s => console.log(`  ${s.brand.padEnd(14)} ${s.year} ${s.make} ${s.model}  sm="${s.sm}"  src=${s.src}`));

  console.log('\n═════════ #4 SubModel-from-Trim samples (heuristic) ═════════');
  console.log(`Shipped rows with from-trim submodel: ${fromTrimShipped}`);
  console.log('Sample derivations:');
  fromTrimSamples.slice(0,15).forEach(s => console.log(`  ${s.brand.padEnd(14)} ${s.year} ${s.make} ${s.model}  →  sm="${s.sm}"`));

  console.log('\n═════════ #5 Brand-fallback samples (MagnaFlow + ABC) ═════════');
  console.log(`Total rows using brand-fallback in shipped data: ${fallbackSamples.length >= 20 ? '20+' : fallbackSamples.length} (samples capped at 20)`);
  fallbackSamples.slice(0,10).forEach(s => console.log(`  ${s.brand.padEnd(12)} mpn=${s.mpn.padEnd(16)} → ${s.brandAAIAD}  (${s.srcLabel})`));

  console.log('\n═════════ #15 Market-specific / heavy-duty Makes ═════════');
  console.log(`Distinct unusual makes: ${unusualMakes.size}`);
  [...unusualMakes.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k.padEnd(22)} ${v} rows`));

  console.log('\n═════════ #17 Liter ≥ 10L outliers ═════════');
  literOddities.slice(0,10).forEach(s => console.log(`  ${s.year} ${s.make} ${s.model}  Liter=${s.liter}  (${s.brand}/${s.mpn})  src=${s.src}`));

  // ============ #2 Duplication examples ============
  console.log('\n═════════ #2 Duplication — top examples ═════════');
  // Build (MPN, Year, Make, Model) → count
  const tupleCount = new Map();
  for (const brand of Object.keys(BRANDS)) {
    const fp = path.join(DATADIR, `02-${brand}-filled.jsonl`);
    if (!fs.existsSync(fp) || fs.statSync(fp).size === 0) continue;
    const rl = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        const key = `${r.mpn}|${r.cells.Year?.value}|${r.cells.Make?.value}|${r.cells.Model?.value}`;
        tupleCount.set(key, (tupleCount.get(key) || 0) + 1);
      } catch (e) {}
    }
  }
  const top = [...tupleCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
  console.log('Top 10 tuples by repeat count:');
  top.forEach(([k,c]) => console.log(`  ×${String(c).padStart(3)}   ${k}`));
  out.duplicationTop = top.map(([k,c]) => ({ tuple: k, repeats: c }));

  // ============ #21 Universal-fit MPNs — salvageable? ============
  console.log('\n═════════ #21 Universal-fit MPNs — full list with part types ═════════');
  // From dropped-mpn-manifest
  const dropMan = JSON.parse(fs.readFileSync(path.join(DATADIR, '_dropped-mpn-manifest-v3.json')));
  // Group by partType (across all brands) to see if any pattern emerges
  const byPartType = new Map();
  const allDropped = [];
  for (const [brand, info] of Object.entries(dropMan.perBrand)) {
    const fp = path.join(DATADIR, `02-${brand}-dropped-mpn.jsonl`);
    if (!fs.existsSync(fp)) continue;
    const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
    for (const l of lines) {
      try {
        const o = JSON.parse(l);
        if (o.reason && !o.reason.includes('no VCdb match')) continue; // only the universal-fit ones
        allDropped.push({ brand, ...o });
        const pt = o.partType || '(unknown)';
        if (!byPartType.has(pt)) byPartType.set(pt, []);
        byPartType.get(pt).push({ brand, mpn: o.mpn });
      } catch (e) {}
    }
  }
  console.log(`Universal-fit MPNs: ${allDropped.length}`);
  console.log(`Distinct part types: ${byPartType.size}`);
  console.log('\nTop 20 part types among universal-fit drops:');
  [...byPartType.entries()].sort((a,b)=>b[1].length - a[1].length).slice(0, 20).forEach(([pt, arr]) => {
    console.log(`  ${String(arr.length).padStart(4)}  ${pt}`);
  });
  // Look for SUSPICIOUS part types — things that SHOULD have vehicle fitment
  const suspiciousPatterns = /headlight|tail light|brake|spark plug|alternator|starter|water pump|radiator|oil pan|transmission|engine|cylinder|piston|carburetor|fuel pump|filter|belt|wheel|hub|axle|tire|caliper|rotor|control arm|strut|shock|suspension|fender|bumper|hood|window|mirror|wiper blade|wiper arm/i;
  const suspicious = allDropped.filter(d => d.partType && suspiciousPatterns.test(d.partType));
  console.log(`\nPotentially-salvageable part types (suggests vehicle-specific):  ${suspicious.length}`);
  // Group these by brand+partType
  const susByBrand = new Map();
  for (const s of suspicious) {
    const key = `${s.brand}/${s.partType}`;
    if (!susByBrand.has(key)) susByBrand.set(key, []);
    susByBrand.get(key).push(s.mpn);
  }
  console.log('Top suspicious groups (brand / partType):');
  [...susByBrand.entries()].sort((a,b)=>b[1].length - a[1].length).slice(0, 15).forEach(([k, mpns]) => {
    console.log(`  ${String(mpns.length).padStart(3)}  ${k}    e.g., ${mpns.slice(0,3).join(', ')}`);
  });
  out.universalFitInvestigation = {
    totalDropped: allDropped.length,
    distinctPartTypes: byPartType.size,
    topPartTypes: [...byPartType.entries()].sort((a,b)=>b[1].length - a[1].length).slice(0,30).map(([pt, arr]) => ({ partType: pt, count: arr.length })),
    suspiciousCount: suspicious.length,
    suspiciousGroups: [...susByBrand.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,30).map(([k, mpns]) => ({ groupKey: k, count: mpns.length, sampleMpns: mpns.slice(0,5) })),
  };

  fs.writeFileSync(path.join(DATADIR, '_deep-data-review.json'), JSON.stringify(out, null, 2));
  console.log('\nWrote walmart-q2-phase1/data/_deep-data-review.json');
})().catch(e => { console.error(e); process.exit(1); });
