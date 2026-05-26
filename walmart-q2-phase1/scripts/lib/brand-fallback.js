/**
 * Brand-fallback consensus — R2.7 (run-scoped 2026-05-12).
 *
 * When `brandMapping[mpn]` is missing for a specific MPN, but other MPNs of
 * the same source-brand string ARE mapped, borrow the consensus brandCode.
 *
 * Strategy:
 *   1. Group brand-mapping entries by inputBrand string
 *   2. For each source brand, compute the modal (most-common) brandCode
 *   3. Lookup: given a source brand string, return the consensus code or null
 *
 * R0.1 not violated: the borrowed code traces to a real source entry, just
 * for a different MPN of the same brand. Source label transparently records
 * this: `derived(brandMapping.consensus({source.Brand})→brand-fallback)`.
 */
'use strict';

const FALLBACK_VERSION = '1.0.0';

function buildConsensusMap(brandMap) {
  const byBrand = new Map(); // inputBrand → Map(code → count)
  for (const bm of Object.values(brandMap)) {
    if (!bm.inputBrand || !bm.brandCode) continue;
    if (!byBrand.has(bm.inputBrand)) byBrand.set(bm.inputBrand, new Map());
    const codes = byBrand.get(bm.inputBrand);
    codes.set(bm.brandCode, (codes.get(bm.brandCode) || 0) + 1);
  }
  const consensus = new Map(); // inputBrand → { code, support, total, multiCode }
  for (const [brand, codes] of byBrand) {
    const entries = [...codes.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, c]) => s + c, 0);
    consensus.set(brand, {
      code: entries[0][0],
      support: entries[0][1],
      total,
      multiCode: entries.length > 1,
      allCodes: entries.map(([c, n]) => ({ code: c, count: n })),
    });
  }
  return consensus;
}

function getFallbackCode(consensusMap, sourceBrand) {
  if (!sourceBrand) return null;
  return consensusMap.get(sourceBrand) || null;
}

// Tests
const TESTS = [
  {
    label: 'simple consensus — all MPNs of a brand share the same code',
    brandMap: { '1': { inputBrand: 'Foo', brandCode: 'AAAA' }, '2': { inputBrand: 'Foo', brandCode: 'AAAA' } },
    lookups: [{ brand: 'Foo', expectedCode: 'AAAA', expectedMultiCode: false }],
  },
  {
    label: 'mixed codes — modal wins, multiCode flag set',
    brandMap: {
      '1': { inputBrand: 'Bar', brandCode: 'AAAA' },
      '2': { inputBrand: 'Bar', brandCode: 'AAAA' },
      '3': { inputBrand: 'Bar', brandCode: 'BBBB' },
    },
    lookups: [{ brand: 'Bar', expectedCode: 'AAAA', expectedMultiCode: true }],
  },
  {
    label: 'unknown brand returns null',
    brandMap: { '1': { inputBrand: 'Foo', brandCode: 'AAAA' } },
    lookups: [{ brand: 'Baz', expectedCode: null }],
  },
];

function runTests() {
  let pass = 0, fail = 0;
  for (const t of TESTS) {
    const cmap = buildConsensusMap(t.brandMap);
    for (const lookup of t.lookups) {
      const got = getFallbackCode(cmap, lookup.brand);
      const expectedCode = lookup.expectedCode;
      const ok = (got === null && expectedCode === null) || (got && got.code === expectedCode && (lookup.expectedMultiCode === undefined || got.multiCode === lookup.expectedMultiCode));
      if (ok) { console.log(`  ✓ ${t.label}`); pass++; }
      else { console.log(`  ✗ ${t.label} — got=${JSON.stringify(got)} expected=${expectedCode}`); fail++; }
    }
  }
  console.log(`\nResult: ${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

if (require.main === module && process.argv.includes('--test')) runTests();

module.exports = { buildConsensusMap, getFallbackCode, FALLBACK_VERSION };
