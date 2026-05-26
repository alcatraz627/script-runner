/**
 * MPN normalizer — Q2 Phase 1.
 *
 * Source data and VCdb both carry some MPNs with a stripped leading "0",
 * surfacing as `-3310S` instead of `0-3310S`. User-verified that the
 * canonical Holley part numbers do begin with `0-`; the dash-only form is
 * an upstream typo. We correct it at OUTPUT time only — the internal join
 * key against VCdb stays as-is, so we don't have to re-materialize 433K rows.
 *
 * Rule (R2.6, run-scoped 2026-05-11):
 *   - If MPN starts with "-", prepend "0".
 *   - All other MPNs pass through unchanged.
 *
 * Source label for normalized values: `derived(source.Part Number→mpn-normalize)`.
 * Deterministic, no I/O, no LLM logic — matches the R1.5 whitelist's `derived.<expr>` category.
 *
 * Pre/post-fix audit: post-fix, no output MPN cell should start with `-`.
 */
'use strict';

const NORMALIZER_VERSION = '1.0.0';

function normalizeMpn(raw) {
  if (raw == null) return raw;
  const s = String(raw);
  if (s.startsWith('-')) return '0' + s;
  return s;
}

function wasNormalized(raw) {
  return raw != null && String(raw).startsWith('-');
}

// ────────────────────── Tests ──────────────────────
const FIXTURES = [
  ['-3310S',   '0-3310S',  'leading dash → prepend 0'],
  ['-7448',    '0-7448',   'leading dash, short'],
  ['-80573S',  '0-80573S', 'leading dash, long'],
  ['L97',      'L97',      'no leading dash → pass through'],
  ['903-615RS','903-615RS','dash in middle → pass through'],
  ['639-033',  '639-033',  'dash in middle, short'],
  ['',         '',         'empty pass through'],
  ['0-3310S',  '0-3310S',  'already corrected → idempotent'],
];

function runTests() {
  let pass = 0, fail = 0;
  for (const [input, expected, label] of FIXTURES) {
    const got = normalizeMpn(input);
    const ok = got === expected;
    console.log(`  ${ok ? '✓' : '✗'}  ${label.padEnd(38)}  in=${JSON.stringify(input).padEnd(14)} got=${JSON.stringify(got)}`);
    if (!ok) console.log(`     expected: ${JSON.stringify(expected)}`);
    ok ? pass++ : fail++;
  }
  console.log(`\nResult: ${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

if (require.main === module && process.argv.includes('--test')) runTests();

module.exports = { normalizeMpn, wasNormalized, NORMALIZER_VERSION };
