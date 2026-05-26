#!/usr/bin/env node
/**
 * 80-spot-check-random.js — pick 5 random shipped rows per brand,
 * print every cell with judge() verdict from 70-quality-audit-v5.js logic.
 *
 * Output: stdout (pipe into gum render externally if desired) +
 *         data/_spot-check-{N}rows-{date}.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const BRANDS = require('./brands.config.js');

const D = path.join(__dirname, '..', 'data');
const SAMPLES_PER_BRAND = 5;
const SEED = parseInt(process.argv[process.argv.indexOf('--seed') + 1]) || Date.now() % 100000;

// Inline judge() — same logic as 70-quality-audit-v5.js
const COLOR_VOCAB = new Set(['black','white','gray','grey','red','blue','green','yellow','silver','gold','clear','natural','brown','orange','multicolor','beige','tan','pink','purple']);
const MATERIAL_VOCAB = ['steel','aluminum','brass','copper','cast iron','plastic','rubber','ceramic','polymer','polypropylene','foam','epdm','nylon','silicone','reinforced rubber','multi','zinc','composite','nitrile'];
const FINISH_VOCAB = ['painted','plain','coated','e-coated','natural','chrome','satin','matte','polished','anodized','zinc','black oxide','powder','high-gloss','brushed chrome','turned ground','smooth'];
const KNOWN_MAKES = new Set(['acura','audi','bmw','buick','cadillac','chevrolet','chrysler','dodge','eagle','fiat','ford','gmc','genesis','honda','hummer','hyundai','infiniti','isuzu','jaguar','jeep','kia','land rover','lexus','lincoln','mazda','mercedes','mercury','mini','mitsubishi','nissan','oldsmobile','plymouth','pontiac','porsche','ram','saab','saturn','scion','smart','subaru','suzuki','tesla','toyota','volkswagen','volvo','vw']);
const hasVcdbLeak = s => /\|\s*Liter:/i.test(s) || /\|\s*SubModel:/i.test(s) || /\|\s*Aspiration:/i.test(s);
const hasUiBleed  = s => /Read more|Guaranteed to Fit|Quantity needed per/i.test(s);
const isAllUpper  = s => /^[A-Z][A-Z0-9\s\-]+$/.test(s) && /[A-Z]{3,}/.test(s);

function judge(colName, cellValue, mpn) {
  const v = String(cellValue ?? '').trim();
  if (!v) return { verdict: '⚪', reason: 'empty' };
  switch (colName) {
    case 'sku': case 'productId': case 'manufacturerPartNumber':
      return v === mpn ? { verdict: '✅', reason: 'matches MPN' } : { verdict: '🔴', reason: 'mismatch' };
    case 'specProductType': case 'productIdType': case 'vehicleCategory':
    case 'manufacturer': case 'brand':
      return { verdict: '✅', reason: 'constant' };
    case 'aaiaBrandID':
      return /^[A-Z0-9]{4}$/.test(v) ? { verdict: '✅', reason: '4-char code' } : { verdict: '🔴', reason: 'wrong shape' };
    case 'partTerminologyID':
      return /^\d+$/.test(v) ? { verdict: '✅', reason: 'numeric' } : { verdict: '🔴', reason: 'non-numeric' };
    case 'condition':
      return ['New','Used','Refurbished','Open Box','Remanufactured'].includes(v) ? { verdict: '✅', reason: 'in vocab' } : { verdict: '🟡', reason: 'unknown' };
    case 'has_written_warranty':
      return ['Yes','No'].includes(v) ? { verdict: '✅', reason: 'binary' } : { verdict: '🟡', reason: 'unexpected' };
    case 'measure': case 'ShippingWeight':
    case 'assembledLength_measure': case 'assembledHeight_measure':
    case 'assembledWeight_measure': case 'assembledWidth_measure':
      return /^-?\d+(\.\d+)?$/.test(v) ? { verdict: '✅', reason: 'numeric' } : { verdict: '🔴', reason: 'non-numeric' };
    case 'unit': case 'assembledLength_unit': case 'assembledHeight_unit':
    case 'assembledWeight_unit': case 'assembledWidth_unit':
      if (['in','mm','cm','ft','lbs','oz','kg','g','W','V','A','Hz','CCA','Ah','°C','°F','Ω'].includes(v)) return { verdict: '✅', reason: 'standard unit' };
      if (['w','v','a'].includes(v)) return { verdict: '🔴', reason: `physics-unit lowercased` };
      return { verdict: '🟡', reason: `non-standard unit '${v}'` };
    case 'vehicle_fitment_type':
      return ['Universal','Specific'].includes(v) ? { verdict: '✅', reason: 'in vocab' } : { verdict: '🔴', reason: 'invalid' };
    case 'color':
      if (COLOR_VOCAB.has(v.toLowerCase())) return { verdict: '✅', reason: 'in vocab' };
      if (/Hose|Cap|Plug|Cover|Bracket|Filter$/i.test(v)) return { verdict: '🔴', reason: 'noun suffix' };
      return { verdict: '🟡', reason: `non-vocab '${v}'` };
    case 'material': {
      const lc = v.toLowerCase();
      if (MATERIAL_VOCAB.some(m => lc.includes(m))) return { verdict: '✅', reason: 'matches vocab' };
      return { verdict: '🟡', reason: 'unfamiliar material' };
    }
    case 'finish': {
      const lc = v.toLowerCase();
      if (FINISH_VOCAB.some(f => lc.includes(f))) return { verdict: '✅', reason: 'matches vocab' };
      return { verdict: '🟡', reason: 'unfamiliar finish' };
    }
    case 'vehicleMake': {
      const tokens = v.split(/;\s*/);
      const allKnown = tokens.every(t => KNOWN_MAKES.has(t.toLowerCase()));
      if (!allKnown) return { verdict: '🔴', reason: `unknown make in '${v}'` };
      const lcSet = new Set(tokens.map(t => t.toLowerCase()));
      if (lcSet.size < tokens.length) return { verdict: '🔴', reason: 'case-duplicates' };
      return { verdict: '✅', reason: `${tokens.length} known make(s)` };
    }
    case 'vehicleModel':
      if (v === mpn) return { verdict: '🔴', reason: 'equals MPN' };
      if (/^[A-Z][A-Z0-9\-]+$/.test(v) && v.length === mpn.length) return { verdict: '🔴', reason: 'MPN-shaped' };
      if (isAllUpper(v)) return { verdict: '🟡', reason: 'all-caps' };
      return { verdict: '✅', reason: 'looks valid' };
    case 'compatibleCars':
      if (hasVcdbLeak(v)) return { verdict: '🔴', reason: 'VCdb leak' };
      if (hasUiBleed(v))  return { verdict: '🔴', reason: 'UI bleed' };
      if (/^Fits select:/i.test(v)) return { verdict: '🔴', reason: 'Fits select: prefix' };
      if (v.length < 30 && !/\(\d{4}/.test(v)) return { verdict: '🟡', reason: 'short / no year' };
      return { verdict: '✅', reason: 'clean format' };
    case 'dimensions':
      return /\d.+x.+\d/.test(v) ? { verdict: '✅', reason: 'L x W x H' } : { verdict: '🟡', reason: 'unexpected' };
    case 'modelNumber': {
      if (v === mpn) return { verdict: '🟡', reason: 'MPN fallback' };
      if (/^1\d{8,9}$/.test(v)) return { verdict: '🔴', reason: 'Walmart-internal' };
      if (/^[A-Za-z\d]+:\w+$/.test(v)) return { verdict: '🔴', reason: 'colon-catalog' };
      if (/,/.test(v)) return { verdict: '🔴', reason: 'comma-separated' };
      if (/^AC[A-Z0-9]/i.test(v) && v.length > mpn.length) return { verdict: '🟡', reason: 'AC-prefix' };
      return { verdict: '✅', reason: 'clean OE-style' };
    }
    case 'pieceCount':
      return /^\d+$/.test(v) ? { verdict: '✅', reason: 'integer' } : { verdict: '🔴', reason: 'non-int' };
    case 'items_included':
      if (v.length < 3 || /^\d+$/.test(v)) return { verdict: '🔴', reason: 'junk' };
      if (/ONLY PART REFERENCE/i.test(v))  return { verdict: '🔴', reason: 'GM diagram-noise' };
      return { verdict: '✅', reason: 'sensible' };
    case 'features':
      return v.length < 100 ? { verdict: '🟡', reason: 'too short' } : { verdict: '✅', reason: `${v.length} chars` };
    case 'warrantyText':
      return v.length < 8 ? { verdict: '🟡', reason: 'brief' } : { verdict: '✅', reason: 'descriptive' };
    case 'vehicle_mount_location':
      return { verdict: '✅', reason: 'present' };
    case 'mainImageUrl': case 'productSecondaryImageURL':
      return /^https?:\/\//i.test(v) ? { verdict: '✅', reason: 'valid URL' } : { verdict: '🟡', reason: 'non-URL' };
    case 'automotivePartsDivision': case 'prop65WarningText':
    case 'netContentStatement': case 'occasion':
      return { verdict: '⚪', reason: 'intentionally skipped' };
    default:
      return { verdict: '🟡', reason: 'unclassified' };
  }
}

// seeded random (Mulberry32)
function mulberry32(a) {
  return function() { let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function pickRandom(arr, n, rand) {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length; i++) {
    const idx = Math.floor(rand() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

const rand = mulberry32(SEED);
console.log(`Seed: ${SEED}`);

const samples = {};
for (const brandKey of Object.keys(BRANDS)) {
  const filled = JSON.parse(fs.readFileSync(path.join(D, `02-${brandKey}-filled.json`), 'utf8'))
    .filter(r => !r.missingMeasure);
  const picks = pickRandom(filled, SAMPLES_PER_BRAND, rand);
  samples[brandKey] = picks.map(r => ({
    mpn: r.mpn,
    partType: r.partType,
    isScrapeOnly: r.isScrapeOnly,
    cells: r.cells,
    verdicts: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, judge(k, v?.value, r.mpn)])),
  }));
}

fs.writeFileSync(path.join(D, '_spot-check-20rows.json'), JSON.stringify({ seed: SEED, samples }, null, 2));

// Print per-row summary
for (const [brandKey, picks] of Object.entries(samples)) {
  const cfg = BRANDS[brandKey];
  for (const row of picks) {
    console.log(`\n══════════════════════════════════════════════════════════════════════════════`);
    console.log(`  ${cfg.outputBrandString} · ${row.mpn} · ${row.partType}${row.isScrapeOnly ? ' (SCRAPE-ONLY)' : ''}`);
    console.log(`══════════════════════════════════════════════════════════════════════════════`);
    let goodN = 0, ambN = 0, badN = 0, emptyN = 0;
    for (const [k, v] of Object.entries(row.verdicts)) {
      if (v.verdict === '✅') goodN++;
      else if (v.verdict === '🟡') ambN++;
      else if (v.verdict === '🔴') badN++;
      else emptyN++;
    }
    console.log(`  Summary: ${goodN}✅ / ${ambN}🟡 / ${badN}🔴 / ${emptyN}⚪`);
    console.log(`  Cell-by-cell:`);
    for (const [k, vJ] of Object.entries(row.verdicts)) {
      const cell = row.cells[k];
      const valDisp = (cell?.value ?? '') === '' ? '<EMPTY>' : String(cell.value).slice(0, 80);
      console.log(`    ${vJ.verdict} ${k.padEnd(28)} ${valDisp.padEnd(82)} :: ${vJ.reason}`);
    }
  }
}
console.log(`\nWrote → ${path.join(D, '_spot-check-20rows.json')}`);
