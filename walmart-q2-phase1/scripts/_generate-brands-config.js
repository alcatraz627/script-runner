#!/usr/bin/env node
/**
 * _generate-brands-config.js — produce brands-iter3.config.js from
 * _brand-discovery.json. One entry per brand discovered in the source export.
 *
 * Brand key derivation: snake_case of brand string with non-word chars
 * collapsed (e.g., "Peak & Herculiner" → "peak_herculiner",
 * "AC/DC" → "ac_dc"). Empty / "unknown" / pure-number brands are skipped
 * with a logged reason.
 *
 * Output: walmart-q2-phase1/scripts/brands-iter3.config.js (overwrites)
 *         walmart-q2-phase1/data/_iter3-config-anomalies.json (skipped + dupes)
 */
'use strict';
const fs = require('fs');

const SRC = 'walmart-q2-phase1/data/_brand-discovery.json';
const OUT = 'walmart-q2-phase1/scripts/brands-iter3.config.js';
const ANOM = 'walmart-q2-phase1/data/_iter3-config-anomalies.json';

function brandToKey(brand) {
  return brand.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
function regexEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const data = JSON.parse(fs.readFileSync(SRC));
const config = {};
const anomalies = { skipped: [], duplicateKeys: [] };
const seenKey = new Map();

for (const b of data.brands) {
  const brand = b.brand;
  if (!brand || brand.toLowerCase() === 'unknown') {
    anomalies.skipped.push({ brand, reason: 'empty or "unknown"' });
    continue;
  }
  const key = brandToKey(brand);
  if (!key) { anomalies.skipped.push({ brand, reason: 'key reduces to empty' }); continue; }
  if (/^\d+$/.test(key)) { anomalies.skipped.push({ brand, reason: 'pure-numeric key' }); continue; }

  if (seenKey.has(key)) {
    // Two distinct source brand strings → same snake_case key. Log + skip the dup;
    // the regex on the first one will still match if patterns overlap, but we want explicit.
    anomalies.duplicateKeys.push({ brand, key, conflictsWith: seenKey.get(key) });
    continue;
  }
  seenKey.set(key, brand);

  config[key] = {
    sourceBrandRegex: new RegExp('^' + regexEscape(brand) + '$', 'i').source,
    outputBrandString: brand,
    stats: { mpnCount: b.mpnCount, vcdbFitmentRows: b.vcdbFitmentRows, dropRate: b.dropRate },
  };
}

const lines = [
  `/**`,
  ` * brands-iter3.config.js — auto-generated from _brand-discovery.json.`,
  ` * ${Object.keys(config).length} brand entries from ${data.totalBrands} discovered.`,
  ` * Hand-edit only the iter1-fixtures (acdelco/dorman/holley/dayco) if they need overrides.`,
  ` */`,
  `'use strict';`,
  `module.exports = {`,
];
for (const [key, cfg] of Object.entries(config)) {
  lines.push(`  ${JSON.stringify(key)}: {`);
  lines.push(`    sourceBrandRegex: new RegExp(${JSON.stringify(cfg.sourceBrandRegex)}, 'i'),`);
  lines.push(`    outputBrandString: ${JSON.stringify(cfg.outputBrandString)},`);
  lines.push(`    stats: ${JSON.stringify(cfg.stats)},`);
  lines.push(`  },`);
}
lines.push('};');
fs.writeFileSync(OUT, lines.join('\n') + '\n');
fs.writeFileSync(ANOM, JSON.stringify(anomalies, null, 2));

console.log(`Wrote ${Object.keys(config).length} brand entries → ${OUT}`);
console.log(`Skipped: ${anomalies.skipped.length}, duplicate keys: ${anomalies.duplicateKeys.length}`);
if (anomalies.skipped.length) anomalies.skipped.slice(0, 5).forEach(a => console.log(`  skipped: "${a.brand}" — ${a.reason}`));
if (anomalies.duplicateKeys.length) anomalies.duplicateKeys.slice(0, 5).forEach(a => console.log(`  dup key "${a.key}": "${a.brand}" conflicts with "${a.conflictsWith}"`));
