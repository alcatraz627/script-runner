#!/usr/bin/env node
/**
 * 70-quality-audit-v5.js
 *
 * Per-cell quality verdict for v5 ACDelco + Dorman filled JSON.
 * Categories: ✅ good · 🟡 ambiguous · 🔴 bad · ⚪ empty (honest)
 *
 * Output: data/_quality-v5.json + stdout summary
 */
'use strict';
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', 'data');
const A_FILLED = JSON.parse(fs.readFileSync(path.join(D, '02-acdelco-filled.json'), 'utf8'))
  .filter(r => !r.missingMeasure);
const D_FILLED = JSON.parse(fs.readFileSync(path.join(D, '02-dorman-filled.json'), 'utf8'))
  .filter(r => !r.missingMeasure);
const H_FILLED = JSON.parse(fs.readFileSync(path.join(D, '02-holley-filled.json'), 'utf8'))
  .filter(r => !r.missingMeasure);

// Walmart vocab samples for text-vocab columns
const COLOR_VOCAB = new Set(['black','white','gray','grey','red','blue','green','yellow','silver','gold','clear','natural','brown','orange','multicolor']);
const MATERIAL_VOCAB = ['steel','aluminum','brass','copper','cast iron','plastic','rubber','ceramic','polymer','polypropylene','foam','epdm','nylon','silicone','reinforced rubber','multi'];
const FINISH_VOCAB = ['painted','plain','coated','e-coated','natural','chrome','satin','matte','polished','anodized','zinc','black oxide','powder','high-gloss','brushed chrome','turned ground'];
const KNOWN_MAKES = new Set(['acura','audi','bmw','buick','cadillac','chevrolet','chrysler','dodge','eagle','fiat','ford','gmc','genesis','honda','hummer','hyundai','infiniti','isuzu','jaguar','jeep','kia','land rover','lexus','lincoln','mazda','mercedes','mercury','mini','mitsubishi','nissan','oldsmobile','plymouth','pontiac','porsche','ram','saab','saturn','scion','smart','subaru','suzuki','tesla','toyota','volkswagen','volvo','vw']);

// Heuristic: VCdb-style leftover detection
const hasVcdbLeak = s => /\|\s*Liter:/i.test(s) || /\|\s*SubModel:/i.test(s) || /\|\s*Aspiration:/i.test(s);
const hasUiBleed  = s => /Read more|Guaranteed to Fit|Quantity needed per/i.test(s);
const isAllUpper  = s => /^[A-Z][A-Z0-9\s\-]+$/.test(s) && /[A-Z]{3,}/.test(s);
const startsLowercase = s => /^[a-z]/.test(s);

// Per-cell verdict function
function judge(colName, cellValue, mpn, row) {
  const v = String(cellValue ?? '').trim();
  if (!v) return { verdict: '⚪', reason: 'empty' };

  switch (colName) {
    // Constants / identifiers — always good if present
    case 'sku': case 'productId': case 'manufacturerPartNumber':
      return { verdict: v === mpn ? '✅' : '🔴', reason: v === mpn ? 'matches MPN' : 'mismatch' };
    case 'specProductType': case 'productIdType': case 'vehicleCategory':
    case 'manufacturer': case 'brand':
      return { verdict: '✅', reason: 'constant' };
    case 'aaiaBrandID':
      return /^[A-Z0-9]{4}$/.test(v) ? { verdict: '✅', reason: '4-char code' } : { verdict: '🔴', reason: 'wrong shape' };
    case 'partTerminologyID':
      return /^\d+$/.test(v) ? { verdict: '✅', reason: 'numeric ID' } : { verdict: '🔴', reason: 'non-numeric' };
    case 'condition':
      return ['New','Used','Refurbished','Open Box'].some(c => v === c)
        ? { verdict: '✅', reason: 'in vocab' }
        : { verdict: '🟡', reason: 'unknown condition value' };

    case 'has_written_warranty':
      return ['Yes','No'].includes(v) ? { verdict: '✅', reason: 'binary' } : { verdict: '🟡', reason: 'unexpected' };

    // Numeric (measure / dimensions)
    case 'measure': case 'ShippingWeight':
    case 'assembledLength_measure': case 'assembledHeight_measure':
    case 'assembledWeight_measure': case 'assembledWidth_measure':
      if (!/^-?\d+(\.\d+)?$/.test(v)) return { verdict: '🔴', reason: 'non-numeric' };
      return { verdict: '✅', reason: 'numeric' };

    // Unit columns
    case 'unit': case 'assembledLength_unit': case 'assembledHeight_unit':
    case 'assembledWeight_unit': case 'assembledWidth_unit':
      if (['in','mm','cm','ft','lbs','oz','kg','g','W','V','A','Hz','CCA','Ah','°C','°F'].includes(v)) {
        return { verdict: '✅', reason: 'standard unit' };
      }
      // physics-unit lowercase regression detector
      if (['w','v','a'].includes(v)) return { verdict: '🔴', reason: `physics-unit lowercased ('${v}' should be uppercase)` };
      return { verdict: '🟡', reason: `non-standard unit '${v}'` };

    // Vehicle Fitment Type
    case 'vehicle_fitment_type':
      return ['Universal','Specific'].includes(v)
        ? { verdict: '✅', reason: 'in vocab' }
        : { verdict: '🔴', reason: 'invalid value' };

    // Color
    case 'color':
      if (COLOR_VOCAB.has(v.toLowerCase())) return { verdict: '✅', reason: 'in vocab' };
      // multi-token like "Steel/Polypropylene/Foam" or "Black Hose"
      if (/Hose|Cap|Plug|Cover|Bracket|Filter$/i.test(v)) return { verdict: '🔴', reason: 'noun suffix not stripped' };
      return { verdict: '🟡', reason: `non-vocab '${v}'` };

    // Material
    case 'material': {
      const lc = v.toLowerCase();
      if (MATERIAL_VOCAB.some(m => lc.includes(m))) return { verdict: '✅', reason: 'matches Walmart material' };
      if (startsLowercase(v)) return { verdict: '🟡', reason: 'lowercase material' };
      return { verdict: '🟡', reason: 'unfamiliar material term' };
    }

    // Finish
    case 'finish': {
      const lc = v.toLowerCase();
      if (FINISH_VOCAB.some(f => lc.includes(f))) return { verdict: '✅', reason: 'matches Walmart finish' };
      return { verdict: '🟡', reason: 'unfamiliar finish term' };
    }

    // Vehicle Make / Model
    case 'vehicleMake': {
      const tokens = v.split(/;\s*/);
      const allKnown = tokens.every(t => KNOWN_MAKES.has(t.toLowerCase()));
      if (!allKnown) return { verdict: '🔴', reason: `unknown make in '${v}'` };
      // Check for case duplicates (toyota; TOYOTA)
      const lcSet = new Set(tokens.map(t => t.toLowerCase()));
      if (lcSet.size < tokens.length) return { verdict: '🔴', reason: 'case-duplicates' };
      return { verdict: '✅', reason: `${tokens.length} known makes` };
    }
    case 'vehicleModel':
      if (v === mpn) return { verdict: '🔴', reason: 'equals MPN' };
      if (/^[A-Z][A-Z0-9\-]+$/.test(v) && v.length === mpn.length) return { verdict: '🔴', reason: 'MPN-shaped' };
      if (isAllUpper(v)) return { verdict: '🟡', reason: 'all-caps (should title-case)' };
      return { verdict: '✅', reason: 'looks like a vehicle model' };

    // compatibleCars
    case 'compatibleCars':
      if (hasVcdbLeak(v)) return { verdict: '🔴', reason: 'VCdb leak (| Liter: present)' };
      if (hasUiBleed(v))  return { verdict: '🔴', reason: 'UI bleed (Read more / Guaranteed to Fit)' };
      if (/^Fits select:/i.test(v)) return { verdict: '🔴', reason: 'Fits select: prefix' };
      if (v.length < 30 && !/\(\d{4}/.test(v)) return { verdict: '🟡', reason: 'short / no year-range' };
      return { verdict: '✅', reason: 'clean Make-Model-Year format' };

    // dimensions
    case 'dimensions':
      if (/\d.+x.+\d/.test(v)) return { verdict: '✅', reason: 'has L x W x H pattern' };
      return { verdict: '🟡', reason: 'unexpected format' };

    // modelNumber
    case 'modelNumber': {
      if (v === mpn) return { verdict: '🟡', reason: 'MPN fallback (no clean OE)' };
      if (/^1\d{8,9}$/.test(v)) return { verdict: '🔴', reason: 'Walmart-internal looking' };
      if (/^[A-Za-z]+:\w+$/.test(v)) return { verdict: '🔴', reason: 'colon-catalog code' };
      if (/,/.test(v)) return { verdict: '🔴', reason: 'comma-separated dual values' };
      if (/^AC[A-Z0-9]/i.test(v) && v.length > mpn.length) return { verdict: '🟡', reason: 'AC-prefix distributor SKU' };
      return { verdict: '✅', reason: 'clean OE-style number' };
    }

    // pieceCount
    case 'pieceCount':
      return /^\d+$/.test(v) ? { verdict: '✅', reason: 'integer' } : { verdict: '🔴', reason: 'non-integer' };

    // items_included
    case 'items_included':
      if (v.length < 3 || /^\d+$/.test(v)) return { verdict: '🔴', reason: 'junk' };
      if (/ONLY PART REFERENCE/i.test(v))  return { verdict: '🔴', reason: 'GM diagram-noise' };
      return { verdict: '✅', reason: 'sensible inclusion list' };

    // features
    case 'features':
      if (v.length < 100) return { verdict: '🟡', reason: 'too short for Features' };
      return { verdict: '✅', reason: `${v.length} chars of content` };

    // warrantyText
    case 'warrantyText':
      if (v.length < 8) return { verdict: '🟡', reason: 'very brief' };
      return { verdict: '✅', reason: 'descriptive' };

    case 'vehicle_mount_location':
      return { verdict: '✅', reason: 'present' };

    // v8: image URL columns
    case 'mainImageUrl': case 'productSecondaryImageURL':
      if (/^https?:\/\//i.test(v)) return { verdict: '✅', reason: 'valid URL' };
      return { verdict: '🟡', reason: 'non-URL value' };

    // skipped intentionally
    case 'automotivePartsDivision': case 'prop65WarningText':
    case 'netContentStatement': case 'occasion':
      return { verdict: '⚪', reason: 'intentionally skipped' };

    default:
      return { verdict: '🟡', reason: 'unclassified column' };
  }
}

function auditBrand(name, filled) {
  const colKeys = Object.keys(filled[0].cells);
  const brandReport = { brand: name, totalRows: filled.length, perColumn: {} };
  for (const col of colKeys) {
    const stats = { good: 0, ambiguous: 0, bad: 0, empty: 0, badExamples: [], ambExamples: [] };
    for (const row of filled) {
      const cell = row.cells[col];
      const v = cell?.value ?? '';
      const j = judge(col, v, row.mpn, row);
      if (j.verdict === '✅') stats.good++;
      else if (j.verdict === '🟡') { stats.ambiguous++; if (stats.ambExamples.length < 3) stats.ambExamples.push({ mpn: row.mpn, val: String(v).slice(0, 70), reason: j.reason }); }
      else if (j.verdict === '🔴') { stats.bad++;       if (stats.badExamples.length < 3) stats.badExamples.push({ mpn: row.mpn, val: String(v).slice(0, 70), reason: j.reason }); }
      else                         stats.empty++;
    }
    brandReport.perColumn[col] = stats;
  }
  return brandReport;
}

const reportA = auditBrand('ACDelco', A_FILLED);
const reportD = auditBrand('Dorman',  D_FILLED);
const reportH = auditBrand('Holley',  H_FILLED);
const out = { acdelco: reportA, dorman: reportD, holley: reportH };

const OUT = path.join(D, '_quality-v5.json');
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

// Compact summary on stdout
function summarize(r) {
  console.log(`\n═══ ${r.brand}  (${r.totalRows} rows) ═══`);
  console.log(`${'col'.padEnd(30)} ${'good'.padStart(5)} ${'amb'.padStart(5)} ${'bad'.padStart(5)} ${'empty'.padStart(6)}`);
  for (const [col, s] of Object.entries(r.perColumn)) {
    console.log(`${col.padEnd(30)} ${String(s.good).padStart(5)} ${String(s.ambiguous).padStart(5)} ${String(s.bad).padStart(5)} ${String(s.empty).padStart(6)}`);
  }
  const totals = Object.values(r.perColumn).reduce((acc, s) => ({
    good: acc.good + s.good, amb: acc.amb + s.ambiguous, bad: acc.bad + s.bad, empty: acc.empty + s.empty
  }), { good: 0, amb: 0, bad: 0, empty: 0 });
  const cellTotal = totals.good + totals.amb + totals.bad + totals.empty;
  console.log(`\nTotal cells: ${cellTotal}`);
  console.log(`  ✅ good:      ${totals.good}  (${(totals.good/cellTotal*100).toFixed(1)}%)`);
  console.log(`  🟡 ambiguous: ${totals.amb}   (${(totals.amb/cellTotal*100).toFixed(1)}%)`);
  console.log(`  🔴 bad:       ${totals.bad}   (${(totals.bad/cellTotal*100).toFixed(1)}%)`);
  console.log(`  ⚪ empty:     ${totals.empty} (${(totals.empty/cellTotal*100).toFixed(1)}%)`);
}
summarize(reportA);
summarize(reportD);
summarize(reportH);
console.log(`\nWrote → ${OUT}`);
