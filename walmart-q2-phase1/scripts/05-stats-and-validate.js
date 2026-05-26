#!/usr/bin/env node
/**
 * Comprehensive stats + sanity validation on _raw-content-parsed.jsonl.
 *
 * Streams the JSONL line-by-line so it works on the 465MB file without RAM blowup.
 * Produces both human-readable console output and a JSON report at
 * data/_stats-validation.json.
 */
'use strict';
const readline = require('readline');
const fs = require('fs');

const SRC = 'walmart-q2-phase1/data/_raw-content-parsed.jsonl';
const OUT = 'walmart-q2-phase1/data/_stats-validation.json';

const CANONICAL_CYLINDERS = new Set(['1','2','3','4','5','6','8','10','12','16']);
const CANONICAL_BLOCK = new Set(['H','V','L','I']);
const CANONICAL_DOORS = new Set(['2','3','4','5']);

function pct(n, t) { return t === 0 ? '0.0%' : ((n / t) * 100).toFixed(2) + '%'; }
function topN(map, n = 15) {
  return [...map.entries()].sort((a,b) => b[1] - a[1]).slice(0, n);
}

(async () => {
  if (!fs.existsSync(SRC)) { console.error('Missing:', SRC); process.exit(1); }

  // Aggregators
  const mpnRowCount = new Map();
  const mpnFormats = new Map();              // mpn → Set of formats used
  const yearCount = new Map();
  const makeCount = new Map();
  const modelCount = new Map();
  const fuelTypeCount = new Map();
  const blockTypeCount = new Map();
  const cylindersCount = new Map();
  const bodyTypeCount = new Map();
  const bodyDoorsCount = new Map();
  const positionCount = new Map();
  const aspirationCount = new Map();
  const submodelCount = new Map();
  const formatCount = new Map();

  // Anomaly buckets (keep first 20 samples each)
  const anomalies = {
    yearOutOfRange: [],
    literOutlier: [],
    cylindersNonCanonical: [],
    blockTypeNonCanonical: [],
    doorsNonCanonical: [],
    makeWithoutModel: [],
    modelWithoutMake: [],
    unknownFormat: [],
    longPosition: [],
    formatAMultiYear: [],   // format A rows with comma+dash mixed yearList
  };
  function pushAnomaly(bucket, sample) {
    if (anomalies[bucket].length < 20) anomalies[bucket].push(sample);
  }

  let n = 0, populatedFitment = 0;
  const t0 = Date.now();
  const rl = readline.createInterface({ input: fs.createReadStream(SRC), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) continue;
    n++;
    const r = JSON.parse(line);
    const rc = r.rawContent || {};
    const mpn = r.partNumber || '';

    mpnRowCount.set(mpn, (mpnRowCount.get(mpn) || 0) + 1);
    if (!mpnFormats.has(mpn)) mpnFormats.set(mpn, new Set());
    mpnFormats.get(mpn).add(rc.format);
    formatCount.set(rc.format, (formatCount.get(rc.format) || 0) + 1);

    if (rc.format === 'unknown') {
      pushAnomaly('unknownFormat', { vcdbRow: r.vcdbRow, mpn, raw: rc.rawContent });
    }

    // Counts
    if (rc.year) {
      yearCount.set(rc.year, (yearCount.get(rc.year) || 0) + 1);
      const y = parseInt(rc.year, 10);
      if (Number.isFinite(y) && (y < 1900 || y > 2030)) {
        pushAnomaly('yearOutOfRange', { vcdbRow: r.vcdbRow, mpn, year: rc.year });
      }
    }
    if (rc.make) makeCount.set(rc.make, (makeCount.get(rc.make) || 0) + 1);
    if (rc.model) modelCount.set(rc.model, (modelCount.get(rc.model) || 0) + 1);
    if (rc.fuelType) fuelTypeCount.set(rc.fuelType, (fuelTypeCount.get(rc.fuelType) || 0) + 1);
    if (rc.blockType) {
      blockTypeCount.set(rc.blockType, (blockTypeCount.get(rc.blockType) || 0) + 1);
      if (!CANONICAL_BLOCK.has(rc.blockType)) {
        pushAnomaly('blockTypeNonCanonical', { vcdbRow: r.vcdbRow, mpn, blockType: rc.blockType });
      }
    }
    if (rc.cylinders) {
      cylindersCount.set(rc.cylinders, (cylindersCount.get(rc.cylinders) || 0) + 1);
      if (!CANONICAL_CYLINDERS.has(rc.cylinders)) {
        pushAnomaly('cylindersNonCanonical', { vcdbRow: r.vcdbRow, mpn, cylinders: rc.cylinders });
      }
    }
    if (rc.bodyType) bodyTypeCount.set(rc.bodyType, (bodyTypeCount.get(rc.bodyType) || 0) + 1);
    if (rc.bodyNumDoors) {
      bodyDoorsCount.set(rc.bodyNumDoors, (bodyDoorsCount.get(rc.bodyNumDoors) || 0) + 1);
      if (!CANONICAL_DOORS.has(rc.bodyNumDoors)) {
        pushAnomaly('doorsNonCanonical', { vcdbRow: r.vcdbRow, mpn, doors: rc.bodyNumDoors });
      }
    }
    if (rc.position) {
      positionCount.set(rc.position, (positionCount.get(rc.position) || 0) + 1);
      if (rc.position.length > 30) {
        pushAnomaly('longPosition', { vcdbRow: r.vcdbRow, mpn, position: rc.position });
      }
    }
    if (rc.aspiration) aspirationCount.set(rc.aspiration, (aspirationCount.get(rc.aspiration) || 0) + 1);
    if (rc.submodel) submodelCount.set(rc.submodel, (submodelCount.get(rc.submodel) || 0) + 1);

    // Liter outliers
    if (rc.liter) {
      const L = parseFloat(rc.liter);
      if (Number.isFinite(L) && (L < 0.3 || L > 10)) {
        pushAnomaly('literOutlier', { vcdbRow: r.vcdbRow, mpn, liter: rc.liter });
      }
    }

    // Make/Model consistency
    if (rc.make && !rc.model) {
      pushAnomaly('makeWithoutModel', { vcdbRow: r.vcdbRow, mpn, make: rc.make, raw: rc.rawContent });
    } else if (rc.model && !rc.make) {
      pushAnomaly('modelWithoutMake', { vcdbRow: r.vcdbRow, mpn, model: rc.model, raw: rc.rawContent });
    }

    // Format A: yearList with mixed commas + dashes (e.g., "1993, 1995-1998")
    if (rc.format === 'A' && rc.yearList && rc.yearList.includes(',') && rc.yearList.includes('-')) {
      pushAnomaly('formatAMultiYear', { vcdbRow: r.vcdbRow, mpn, yearList: rc.yearList });
    }

    if (rc.year || rc.make || rc.model) populatedFitment++;
  }

  const duration = ((Date.now() - t0) / 1000).toFixed(1);

  // MPN cardinality stats
  const mpnRowCounts = [...mpnRowCount.values()].sort((a,b) => b - a);
  const mpnStats = {
    distinctMpns: mpnRowCount.size,
    medianRowsPerMpn: mpnRowCounts[Math.floor(mpnRowCounts.length / 2)] || 0,
    maxRowsPerMpn: mpnRowCounts[0] || 0,
    minRowsPerMpn: mpnRowCounts[mpnRowCounts.length - 1] || 0,
    p95RowsPerMpn: mpnRowCounts[Math.floor(mpnRowCounts.length * 0.05)] || 0,
    p99RowsPerMpn: mpnRowCounts[Math.floor(mpnRowCounts.length * 0.01)] || 0,
  };

  // MPNs using mixed formats
  const mixedFormatMpns = [];
  for (const [mpn, fmts] of mpnFormats.entries()) {
    if (fmts.size > 1) mixedFormatMpns.push({ mpn, formats: [...fmts] });
  }

  // Years span
  const yearKeys = [...yearCount.keys()].map(y => parseInt(y,10)).filter(y => Number.isFinite(y)).sort((a,b) => a-b);
  const yearSpan = { min: yearKeys[0], max: yearKeys[yearKeys.length - 1], distinctYears: yearCount.size };

  // Cross-check vs vf-shipped 166 MPNs
  let vfMpns = [];
  try {
    const filledBrands = ['acdelco','dorman','holley','dayco'];
    for (const b of filledBrands) {
      const f = JSON.parse(fs.readFileSync(`walmart-vf/data/02-${b}-filled.json`));
      for (const row of f) {
        if (!row.dropReasons || row.dropReasons.length === 0) {
          vfMpns.push({ brand: b, mpn: row.mpn });
        }
      }
    }
  } catch (e) { /* skip */ }

  const vfMpnSet = new Set(vfMpns.map(x => x.mpn));
  const vcdbMpnSet = new Set(mpnRowCount.keys());
  const inBothCount = [...vfMpnSet].filter(m => vcdbMpnSet.has(m)).length;
  const vfMissingFromVcdb = vfMpns.filter(x => !vcdbMpnSet.has(x.mpn));

  // Build report
  const report = {
    generatedAt: new Date().toISOString(),
    inputFile: SRC,
    totalRows: n,
    populatedFitmentRows: populatedFitment,
    durationSeconds: +duration,
    mpnStats,
    yearSpan,
    formatCount: Object.fromEntries(formatCount),
    topMakes: topN(makeCount, 20),
    topModels: topN(modelCount, 20),
    topPositions: topN(positionCount, 15),
    fuelTypes: Object.fromEntries(fuelTypeCount),
    blockTypes: Object.fromEntries(blockTypeCount),
    cylinders: Object.fromEntries(cylindersCount),
    bodyTypes: Object.fromEntries(bodyTypeCount),
    bodyDoors: Object.fromEntries(bodyDoorsCount),
    aspirations: Object.fromEntries(aspirationCount),
    mixedFormatMpns: { count: mixedFormatMpns.length, sample: mixedFormatMpns.slice(0, 10) },
    anomalies,
    vfCrossCheck: {
      vfShippedMpnCount: vfMpnSet.size,
      vcdbMpnCount: vcdbMpnSet.size,
      vfMpnsAlsoInVcdb: inBothCount,
      vfMpnsMissingFromVcdb: { count: vfMissingFromVcdb.length, sample: vfMissingFromVcdb.slice(0, 20) },
    },
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  // Console summary
  const line = '─'.repeat(70);
  console.log(`\n${line}\nStats + validation — ${n} rows, ${duration}s\n${line}\n`);
  console.log(`MPN cardinality:    distinct=${mpnStats.distinctMpns}  median rows/MPN=${mpnStats.medianRowsPerMpn}  max=${mpnStats.maxRowsPerMpn}  p95=${mpnStats.p95RowsPerMpn}`);
  console.log(`Year span:          ${yearSpan.min} → ${yearSpan.max}  (${yearSpan.distinctYears} distinct years)`);
  console.log(`Format distribution: ${JSON.stringify(Object.fromEntries(formatCount))}`);
  console.log(`Populated-fitment:  ${populatedFitment} / ${n} (${pct(populatedFitment, n)})`);

  console.log(`\nTop 10 Makes:`);
  topN(makeCount, 10).forEach(([k,v]) => console.log(`  ${String(v).padStart(7)}  ${k}`));

  console.log(`\nCylinders distribution:`);
  [...cylindersCount.entries()].sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([k,v]) => console.log(`  ${k.padStart(3)}: ${v}${CANONICAL_CYLINDERS.has(k) ? '' : ' ⚠ NON-CANONICAL'}`));

  console.log(`\nBlockType: ${JSON.stringify(Object.fromEntries(blockTypeCount))}`);
  console.log(`FuelType: ${JSON.stringify(Object.fromEntries(fuelTypeCount))}`);
  console.log(`BodyDoors: ${JSON.stringify(Object.fromEntries(bodyDoorsCount))}`);
  console.log(`Aspirations: ${JSON.stringify(Object.fromEntries(aspirationCount))}`);
  console.log(`BodyTypes (top 10): ${JSON.stringify(topN(bodyTypeCount, 10))}`);

  console.log(`\nAnomalies (counts before clipping):`);
  for (const [k, v] of Object.entries(anomalies)) console.log(`  ${k}: ${v.length}${v.length === 20 ? '+' : ''} samples retained`);

  console.log(`\nMixed-format MPNs: ${mixedFormatMpns.length}`);

  console.log(`\nVF cross-check:`);
  console.log(`  vf-shipped MPNs: ${vfMpnSet.size}`);
  console.log(`  in VCdb too:     ${inBothCount}  (${pct(inBothCount, vfMpnSet.size)})`);
  console.log(`  NOT in VCdb:     ${vfMissingFromVcdb.length}  ← these would have to be dropped from Q2 Phase 1`);
  if (vfMissingFromVcdb.length) {
    console.log(`  sample:          ${vfMissingFromVcdb.slice(0, 8).map(x => `${x.brand}:${x.mpn}`).join(', ')}`);
  }

  console.log(`\nFull report: ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
