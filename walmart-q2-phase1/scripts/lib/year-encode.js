/**
 * Walmart Q2 Phase 1 — Year encoder.
 *
 * Converts a VCdb year string (single year, range, comma-list, or mix) into
 * an array of Walmart-template-compliant year strings. Locked spec (R2.2):
 *   - Run of length 1 → single year, e.g. "1966"  (NEVER "1966-1966")
 *   - Run of length ≥ 2 → range "min-max", e.g. "1985-1986" or "1977-1981"
 *
 * Each returned string becomes one xlsx row when paired with a (MPN, Make,
 * Model, ...) tuple — full explosion per R2.1.
 *
 * Test fixtures live at the bottom; run with `node year-encode.js --test`.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ENCODER_VERSION = '1.0.0';
const ANOMALY_FILE = 'walmart-q2-phase1/data/_year-encode-anomalies.jsonl';

// Match patterns we accept:
//   YYYY           single year
//   YYYY-YYYY      range
//   comma-list of either, optionally with spaces
const TOKEN_RE = /^\d{4}(?:-\d{4})?$/;

/**
 * Parse a raw year string into a sorted, deduped int array.
 * Returns null when the input doesn't match any known pattern (caller logs
 * to anomalies file).
 */
function expandTokensToYears(raw) {
  const cleaned = String(raw).trim();
  if (!cleaned) return [];
  const tokens = cleaned.split(/\s*,\s*/);
  const years = new Set();
  for (const tok of tokens) {
    if (!TOKEN_RE.test(tok)) return null; // unknown pattern
    if (tok.includes('-')) {
      const [a, b] = tok.split('-').map(n => parseInt(n, 10));
      if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return null;
      for (let y = a; y <= b; y++) years.add(y);
    } else {
      years.add(parseInt(tok, 10));
    }
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * Group sorted ints into runs of consecutive values.
 * [1977, 1978, 1979, 1980, 1981] → [[1977, 1981]]
 * [1977, 1979, 1981, 1982]       → [[1977, 1977], [1979, 1979], [1981, 1982]]
 */
function groupConsecutive(years) {
  if (!years.length) return [];
  const runs = [];
  let start = years[0], prev = years[0];
  for (let i = 1; i < years.length; i++) {
    if (years[i] === prev + 1) { prev = years[i]; continue; }
    runs.push([start, prev]);
    start = years[i];
    prev = years[i];
  }
  runs.push([start, prev]);
  return runs;
}

/**
 * Public API: encode a raw year string into an array of Walmart-compliant
 * year strings, one per output row.
 */
function encodeYearField(raw, context) {
  const years = expandTokensToYears(raw);
  if (years === null) {
    logAnomaly(raw, context);
    return [];
  }
  if (years.length === 0) return [];
  const runs = groupConsecutive(years);
  return runs.map(([a, b]) => a === b ? String(a) : `${a}-${b}`);
}

function logAnomaly(raw, context) {
  const entry = { ts: new Date().toISOString(), input: raw, ...(context || {}) };
  try {
    fs.mkdirSync(path.dirname(ANOMALY_FILE), { recursive: true });
    fs.appendFileSync(ANOMALY_FILE, JSON.stringify(entry) + '\n');
  } catch (e) {
    // Don't break pipeline on log failure; surface to stderr instead.
    process.stderr.write(`[year-encode] anomaly log write failed: ${e.message}\n`);
  }
}

// ────────────────────── Test fixtures ──────────────────────

const FIXTURES = [
  // [input, expected, label]
  ['1966',                                  ['1966'],                          'single year'],
  ['1977, 1978, 1979, 1980, 1981',          ['1977-1981'],                     'contiguous list → range'],
  ['1983, 1985, 1986',                      ['1983', '1985-1986'],             'gap + contiguous (user spec)'],
  ['1977, 1979, 1981, 1982',                ['1977', '1979', '1981-1982'],     'multiple gaps (user spec)'],
  ['2006, 2018-2019',                       ['2006', '2018-2019'],             'mixed single + range'],
  ['2007-2011, 2013-2019',                  ['2007-2011', '2013-2019'],        'two ranges with gap'],
  ['1993, 1995-1998',                       ['1993', '1995-1998'],             'single + range (format A)'],
  ['1977-1977',                             ['1977'],                          'same-year range collapses'],
  ['',                                      [],                                'empty'],
  ['  2020  ',                              ['2020'],                          'whitespace tolerance'],
  ['2019, 2020, 2020, 2021',                ['2019-2021'],                     'dedup duplicate years'],
];

const ANOMALY_FIXTURES = [
  'not a year',
  '99',
  '20XX',
  '1977-',
  '1980-1970',          // reversed range
];

function runTests() {
  let pass = 0, fail = 0;
  console.log('Year-encode test fixtures:\n');
  for (const [input, expected, label] of FIXTURES) {
    const got = encodeYearField(input);
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    console.log(`  ${ok ? '✓' : '✗'}  ${label.padEnd(38)}  in=${JSON.stringify(input).padEnd(35)} got=${JSON.stringify(got)}`);
    if (!ok) console.log(`     expected: ${JSON.stringify(expected)}`);
    ok ? pass++ : fail++;
  }
  console.log('\nAnomaly fixtures (each should return [] and log):');
  for (const input of ANOMALY_FIXTURES) {
    const got = encodeYearField(input, { test: true });
    const ok = Array.isArray(got) && got.length === 0;
    console.log(`  ${ok ? '✓' : '✗'}  in=${JSON.stringify(input).padEnd(20)} got=${JSON.stringify(got)}`);
    ok ? pass++ : fail++;
  }
  console.log(`\nResult: ${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

if (require.main === module && process.argv.includes('--test')) {
  runTests();
}

module.exports = { encodeYearField, expandTokensToYears, groupConsecutive, ENCODER_VERSION };
