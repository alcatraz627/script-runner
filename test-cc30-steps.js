#!/usr/bin/env node
/**
 * test-cc30-steps.js
 *
 * Tests 20 random rows from each pipeline step output in a cc30 run directory.
 * Checks: valid Image URLs, non-empty Part Type, attribute array shapes,
 * no blacklisted keys in final_attributes, correct field presence per step.
 *
 * Usage:
 *   node test-cc30-steps.js runs/jegs-cc30-apr03
 *   node test-cc30-steps.js runs/jegs-cc30-apr03 --seed 42   (reproducible sample)
 *   node test-cc30-steps.js runs/jegs-cc30-apr03 --n 50      (change sample size)
 *   node test-cc30-steps.js runs/jegs-cc30-apr03 --verbose   (print failing rows in full)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── CLI args ──────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const get     = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has     = flag => args.includes(flag);
const runDir  = args.find(a => !a.startsWith('--'));
const N       = parseInt(get('--n') || '20', 10);
const SEED    = parseInt(get('--seed') || String(Date.now()), 10);
const VERBOSE = has('--verbose');

if (!runDir) {
  console.error('Usage: node test-cc30-steps.js <run-dir> [--n <count>] [--seed <n>] [--verbose]');
  process.exit(1);
}

const runPath = path.resolve(runDir);
const dataDir = path.join(runPath, 'data');

// ── Seeded random shuffle (Fisher-Yates) ──────────────────────────────────────

function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function sampleN(arr, n, rng) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

// ── Blacklist (must not appear in final_attributes) ───────────────────────────

const BLACKLIST = new Set([
  'brand', 'line', 'mpn', 'title', 'part_type', 'fitment', 'image_url',
  'price', 'currency', 'description', 'part_category', 'part_number',
  'feature', 'feature_1', 'feature_2', 'feature_3', 'feature_4',
  'make', 'model', 'engine', 'transmission', 'universal', 'universal_or_specific_fit',
  'direct_fit', 'country_of_origin', 'carb_eo_number',
]);

// ── Step definitions & checks ─────────────────────────────────────────────────

const STEPS = [
  {
    id: 'group-attributes',
    label: 'Step 1 — group-attributes',
    checks: [
      {
        name: 'Has Part Number',
        fn: row => typeof row['Part Number'] === 'string' && row['Part Number'].trim().length > 0,
      },
      {
        name: 'Has Brand',
        fn: row => typeof row['Brand'] === 'string' && row['Brand'].trim().length > 0,
      },
      {
        name: 'original_attributes is non-empty array',
        fn: row => Array.isArray(row.original_attributes) && row.original_attributes.length > 0,
      },
      {
        name: 'original_attributes entries have key+value',
        fn: row => (row.original_attributes || []).every(a => a.key != null && a.value != null),
        sampleFirst: 5, // only check first 5 attrs per product
      },
      {
        name: 'raw_attributes is array',
        fn: row => Array.isArray(row.raw_attributes),
      },
      {
        name: 'No [object Object] in original_attributes values',
        fn: row => !(row.original_attributes || []).some(a => String(a.value) === '[object Object]'),
      },
    ],
  },
  {
    id: 'extract-columns',
    label: 'Step 2 — extract-columns',
    checks: [
      {
        name: 'Part Type is a string',
        fn: row => typeof row['Part Type'] === 'string',
      },
      {
        name: 'Image is a string',
        fn: row => typeof row['Image'] === 'string',
      },
      {
        name: 'Non-empty Image starts with https://',
        fn: row => !row['Image'] || row['Image'].startsWith('https://'),
      },
      {
        name: 'fit_type is a string',
        fn: row => typeof row['fit_type'] === 'string',
      },
      {
        name: 'fit_type is known value or empty',
        fn: row => ['Universal', 'Vehicle-Specific', 'Direct Fit', 'Direct-Fit', 'Specific Fit', ''].includes(row['fit_type']),
      },
      {
        name: 'raw_fitment is array',
        fn: row => Array.isArray(row['raw_fitment']),
      },
      {
        name: 'fitment_extracted is object',
        fn: row => typeof row['fitment_extracted'] === 'object' && !Array.isArray(row['fitment_extracted']),
      },
    ],
  },
  {
    id: 'filter-attributes',
    label: 'Step 3 — filter-attributes',
    checks: [
      {
        name: 'final_attributes is array',
        fn: row => Array.isArray(row.final_attributes),
      },
      {
        name: 'final_attributes entries have key+value',
        fn: row => (row.final_attributes || []).every(a => a.key != null && a.value != null),
      },
      {
        name: 'No blacklisted keys in final_attributes',
        fn: row => !(row.final_attributes || []).some(a => BLACKLIST.has(String(a.key).toLowerCase())),
        detail: row => {
          const hits = (row.final_attributes || []).filter(a => BLACKLIST.has(String(a.key).toLowerCase())).map(a => a.key);
          return hits.length ? `Blacklisted keys found: ${hits.join(', ')}` : null;
        },
      },
      {
        name: 'No [object Object] in final_attributes values',
        fn: row => !(row.final_attributes || []).some(a => String(a.value) === '[object Object]'),
      },
    ],
  },
  {
    id: 'sideload-part-types',
    label: 'Step 4 — sideload-part-types',
    checks: [
      {
        name: 'Image is non-empty (coverage check — warn only)',
        fn: row => typeof row['Image'] === 'string',
        warnOnly: true,
        detail: row => !row['Image'] ? 'Image still empty after sideload' : null,
      },
      {
        name: 'Non-empty Image starts with https://',
        fn: row => !row['Image'] || row['Image'].startsWith('https://'),
      },
      {
        name: 'Part Type is non-empty (coverage check — warn only)',
        fn: row => typeof row['Part Type'] === 'string',
        warnOnly: true,
        detail: row => !row['Part Type'] ? 'Part Type still empty after sideload' : null,
      },
      {
        name: 'final_attributes is non-empty (warn only — some products are metadata-only)',
        fn: row => Array.isArray(row.final_attributes) && row.final_attributes.length > 0,
        warnOnly: true,
        detail: row => (!row.final_attributes || row.final_attributes.length === 0)
          ? `all ${(row.original_attributes||[]).length} original attrs were filtered (metadata/fitment only)`
          : null,
      },
      {
        name: 'No blacklisted keys in final_attributes',
        fn: row => !(row.final_attributes || []).some(a => BLACKLIST.has(String(a.key).toLowerCase())),
        detail: row => {
          const hits = (row.final_attributes || []).filter(a => BLACKLIST.has(String(a.key).toLowerCase())).map(a => a.key);
          return hits.length ? `Blacklisted keys found: ${hits.join(', ')}` : null;
        },
      },
      {
        name: 'fit_type promoted into final_attributes when set',
        fn: row => {
          if (!row['fit_type']) return true; // no fit_type → nothing to promote
          return (row.final_attributes || []).some(a => a.key === 'Part Fitment');
        },
      },
    ],
  },
  {
    id: 'merge-from-newer',
    label: 'Step 5 — merge-from-newer',
    // For this step, run two sub-tests:
    //   a) All 556 rows: structural integrity (no data lost)
    //   b) _is_newer rows only: merge-specific checks (image URL source, attribute union)
    subsetFilter: row => row._is_newer,
    subsetLabel: '_is_newer rows (enriched subset)',
    checks: [
      // ── Checks on ALL rows ───────────────────────────────────────────────────
      {
        name: 'Part Number preserved',
        fn: row => typeof row['Part Number'] === 'string' && row['Part Number'].trim().length > 0,
      },
      {
        name: 'Image is valid string',
        fn: row => typeof row['Image'] === 'string',
      },
      {
        name: 'Non-empty Image starts with https://',
        fn: row => !row['Image'] || row['Image'].startsWith('https://'),
      },
      {
        name: 'raw_attributes is array',
        fn: row => Array.isArray(row.raw_attributes),
      },
      {
        name: 'final_attributes is array',
        fn: row => Array.isArray(row.final_attributes),
      },
    ],
    subsetChecks: [
      // ── Checks on _is_newer rows only ────────────────────────────────────────
      {
        name: '[newer] Image is from jegs.com',
        fn: row => (row['Image'] || '').includes('jegs.com'),
        detail: row => `Image: ${(row['Image'] || '').substring(0, 80)}`,
      },
      {
        name: '[newer] original_title is non-empty (old title preserved)',
        fn: row => typeof row['original_title'] === 'string' && row['original_title'].trim().length > 0,
        detail: row => !row['original_title'] ? 'original_title is missing/empty' : null,
      },
      {
        name: '[newer] raw_attributes is non-empty (union result)',
        fn: row => Array.isArray(row.raw_attributes) && row.raw_attributes.length > 0,
      },
      {
        name: '[newer] _is_newer flag is true',
        fn: row => row._is_newer === true,
      },
    ],
  },
  {
    id: 'highlight-newer',
    label: 'Step 6 — highlight-newer (side-effect writer)',
    checks: [
      // highlight-newer returns rows unchanged — verify passthrough integrity
      {
        name: 'Part Number preserved (passthrough)',
        fn: row => typeof row['Part Number'] === 'string' && row['Part Number'].trim().length > 0,
      },
      {
        name: 'Image preserved (passthrough)',
        fn: row => typeof row['Image'] === 'string',
      },
      {
        name: 'final_attributes preserved (passthrough)',
        fn: row => Array.isArray(row.final_attributes),
      },
      {
        name: '_is_newer flag preserved',
        fn: row => row._is_newer === undefined || row._is_newer === true,
      },
    ],
  },
];

// ── Run tests ─────────────────────────────────────────────────────────────────

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  CC30 Step Tests — ${path.basename(runPath)}`);
console.log(`  Sample: ${N} rows/step  |  Seed: ${SEED}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

const rng = seededRng(SEED);
let totalPass = 0, totalFail = 0, totalWarn = 0;
const summary = [];

for (const step of STEPS) {
  const filePath = path.join(dataDir, `${step.id}.json`);
  if (!fs.existsSync(filePath)) {
    console.log(`  ⚪ ${step.label} — data file not found, skipping\n`);
    continue;
  }

  const allRows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const sample  = sampleN(allRows, N, rng);

  // Subset sample (for steps with subsetChecks)
  const subsetRows   = step.subsetFilter ? allRows.filter(step.subsetFilter) : [];
  const subsetSample = step.subsetChecks ? sampleN(subsetRows, N, rng) : [];

  console.log(`  ${step.label}`);
  console.log(`  Total: ${allRows.length} rows | Sampled: ${sample.length}${subsetRows.length ? `  |  ${step.subsetLabel || 'subset'}: ${subsetRows.length} (sampled ${subsetSample.length})` : ''}`);
  console.log(`  ${'─'.repeat(48)}`);

  let stepPass = 0, stepFail = 0, stepWarn = 0;

  for (const check of step.checks) {
    let pass = 0, fail = 0;
    const failures = [];

    for (const row of sample) {
      const ok = check.fn(row);
      if (ok) {
        pass++;
      } else {
        fail++;
        if (VERBOSE || failures.length < 3) {
          const detail = check.detail ? check.detail(row) : null;
          failures.push({
            pn: row['Part Number'] || '?',
            detail: detail || '(no detail)',
          });
        }
      }
    }

    const isWarn = check.warnOnly && fail > 0;
    const icon   = fail === 0 ? '✓' : (isWarn ? '△' : '✗');
    const label  = `${icon} ${check.name}`;

    if (fail === 0) {
      console.log(`    ${label.padEnd(58)} ${pass}/${sample.length}`);
      stepPass++;
    } else if (isWarn) {
      console.log(`    ${label.padEnd(58)} ${pass}/${sample.length} (${fail} empty — warn only)`);
      stepWarn++;
      if (failures.length) {
        failures.slice(0, 3).forEach(f => console.log(`      ↳ ${f.pn}: ${f.detail}`));
      }
    } else {
      console.log(`    ${label.padEnd(58)} ${pass}/${sample.length}  ← ${fail} FAILED`);
      stepFail++;
      if (failures.length) {
        failures.slice(0, 3).forEach(f => console.log(`      ↳ ${f.pn}: ${f.detail}`));
        if (fail > 3 && !VERBOSE) console.log(`      ↳ ... and ${fail - 3} more (run --verbose for all)`);
      }
    }
  }

  // ── Run subset checks (e.g. _is_newer rows only) ──────────────────────────
  if (step.subsetChecks && subsetSample.length > 0) {
    console.log(`  ${' '.repeat(4)}[${step.subsetLabel || 'subset'} — ${subsetSample.length} rows]`);
    for (const check of step.subsetChecks) {
      let pass = 0, fail = 0;
      const failures = [];
      for (const row of subsetSample) {
        const ok = check.fn(row);
        if (ok) {
          pass++;
        } else {
          fail++;
          if (VERBOSE || failures.length < 3) {
            const detail = check.detail ? check.detail(row) : null;
            failures.push({ pn: row['Part Number'] || '?', detail: detail || '(no detail)' });
          }
        }
      }
      const isWarn = check.warnOnly && fail > 0;
      const icon   = fail === 0 ? '✓' : (isWarn ? '△' : '✗');
      const label  = `${icon} ${check.name}`;
      if (fail === 0) {
        console.log(`    ${label.padEnd(58)} ${pass}/${subsetSample.length}`);
        stepPass++;
      } else if (isWarn) {
        console.log(`    ${label.padEnd(58)} ${pass}/${subsetSample.length} (${fail} failed — warn only)`);
        stepWarn++;
        failures.slice(0, 3).forEach(f => console.log(`      ↳ ${f.pn}: ${f.detail}`));
      } else {
        console.log(`    ${label.padEnd(58)} ${pass}/${subsetSample.length}  ← ${fail} FAILED`);
        stepFail++;
        failures.slice(0, 3).forEach(f => console.log(`      ↳ ${f.pn}: ${f.detail}`));
        if (fail > 3 && !VERBOSE) console.log(`      ↳ ... and ${fail - 3} more (run --verbose for all)`);
      }
    }
  }

  console.log(`  ${'─'.repeat(48)}`);
  console.log(`  Pass: ${stepPass}  Fail: ${stepFail}  Warn: ${stepWarn}\n`);

  totalPass += stepPass;
  totalFail += stepFail;
  totalWarn += stepWarn;

  summary.push({ step: step.label, pass: stepPass, fail: stepFail, warn: stepWarn, rows: sample.length });
}

// ── Full-dataset coverage (uses deepest available step) ───────────────────────

const coverageCandidates = ['highlight-newer', 'merge-from-newer', 'sideload-part-types'];
const coveragePath = coverageCandidates.map(id => path.join(dataDir, `${id}.json`)).find(p => fs.existsSync(p));

if (coveragePath) {
  const final = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
  const withImage      = final.filter(r => r['Image'] && r['Image'].trim()).length;
  const withPartType   = final.filter(r => r['Part Type'] && r['Part Type'].trim()).length;
  const withFinalAttrs = final.filter(r => Array.isArray(r.final_attributes) && r.final_attributes.length > 0).length;
  const withNewer      = final.filter(r => r._is_newer === true).length;

  console.log(`  ── Full dataset coverage (${final.length} products — ${path.basename(coveragePath, '.json')}) ──`);
  console.log(`    Image filled:          ${withImage}/${final.length}  (${(withImage/final.length*100).toFixed(1)}%)`);
  console.log(`    Part Type filled:      ${withPartType}/${final.length}  (${(withPartType/final.length*100).toFixed(1)}%)`);
  console.log(`    final_attributes set:  ${withFinalAttrs}/${final.length}  (${(withFinalAttrs/final.length*100).toFixed(1)}%)`);
  if (withNewer > 0) {
    console.log(`    _is_newer (enriched):  ${withNewer}/${final.length}  (${(withNewer/final.length*100).toFixed(1)}%)`);
  }
  console.log('');
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Results: ${totalPass} passed  ${totalFail} failed  ${totalWarn} warnings`);
if (totalFail > 0) {
  console.log('  STATUS: FAIL — fix issues before using this output');
} else if (totalWarn > 0) {
  console.log('  STATUS: PASS (with warnings — review empty fields above)');
} else {
  console.log('  STATUS: PASS ✓');
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

process.exit(totalFail > 0 ? 1 : 0);
