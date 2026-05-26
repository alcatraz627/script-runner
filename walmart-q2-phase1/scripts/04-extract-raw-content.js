#!/usr/bin/env node
/**
 * Extract structured fitment fields from VCdb "Raw Content" column.
 *
 * Three observed formats:
 *   A: "Buick Century (1977)" or "Buick LeSabre (1977-1981)"  — sparse
 *   B: "1999 CHRYSLER LHS | Liter: 3.5 | SubModel: BASE | Aspiration: NATURALLY ASPIRATED | CUI: 215 | Engine Type: V8 ( 3.5L / 215 )"
 *   C: "Year: 1990 | Make: Subaru | Model: Legacy | Trim: Base Sedan 4-Door | Engine: 2.2L 2212CC H4 GAS SOHC Naturally Aspirated | Notes: ..."
 *
 * For each parsed row emits: { year, make, model, submodel, trim,
 *   liter, cc, cid, cylinders, blockType, aspiration, fuelType,
 *   bodyType, bodyNumDoors, position, fitmentNotes, format }
 *
 * Then produces coverage stats: % rows where each field is populated, per brand.
 *
 * Usage:
 *   node 04-extract-raw-content.js
 *   node 04-extract-raw-content.js --probe   # only re-parse the 5 sample MPNs
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME;
const VCDB = `${HOME}/Downloads/Walmart Reference/Walmart_VCdb Mapping_vf.xlsx`;
const PROBE_MODE = process.argv.includes('--probe');

const SAMPLE_MPNS = new Set(['L97', '639-033', '302-3BK', '95172']);

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text);
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.result != null) return String(v.result);
  }
  return String(v);
}

// Parse formats A/B/C into a uniform shape.
function parseRawContent(raw) {
  if (!raw) return { format: 'empty' };
  const r = String(raw).trim();
  const out = { rawContent: r };

  // Format C: "Year: ... | Make: ... | Model: ..."
  if (/^Year:\s*\d/i.test(r)) {
    out.format = 'C';
    const parts = r.split('|').map(s => s.trim());
    const map = {};
    for (const p of parts) {
      const m = p.match(/^([^:]+):\s*(.+)$/);
      if (m) map[m[1].trim().toLowerCase()] = m[2].trim();
    }
    out.year = map.year || '';
    out.make = map.make || '';
    out.model = map.model || '';
    out.trim = map.trim || '';
    const engine = map.engine || '';
    // Engine: "2.2L 2212CC H4 GAS SOHC Naturally Aspirated"
    if (engine) {
      const lit = engine.match(/(\d+\.\d+)\s*L\b/i);          out.liter = lit ? lit[1] : '';
      const cc = engine.match(/(\d+)\s*CC\b/i);                out.cc = cc ? cc[1] : '';
      const cyl = engine.match(/\b([HVL])(\d+)\b/);            // "H4" "V8" "L6"
      if (cyl) { out.blockType = cyl[1]; out.cylinders = cyl[2]; }
      if (/GAS/i.test(engine)) out.fuelType = 'GAS';
      else if (/DIESEL/i.test(engine)) out.fuelType = 'DIESEL';
      else if (/FLEX/i.test(engine)) out.fuelType = 'FLEX FUEL';
      else if (/ELECTRIC/i.test(engine)) out.fuelType = 'ELECTRIC';
      if (/Turbocharged/i.test(engine)) out.aspiration = 'TURBOCHARGED';
      else if (/Supercharged/i.test(engine)) out.aspiration = 'SUPERCHARGED';
      else if (/Naturally\s+Aspirated/i.test(engine)) out.aspiration = 'NATURALLY ASPIRATED';
    }
    // Trim: "Base Sedan 4-Door" — try to extract body type + doors
    if (out.trim) {
      const doors = out.trim.match(/(\d+)[\s-]?door/i);
      if (doors) out.bodyNumDoors = doors[1];
      const bodyWords = ['Sedan','Coupe','Wagon','Hatchback','SUV','Convertible','Pickup','Truck','Van','Minivan','Crossover'];
      for (const w of bodyWords) {
        if (new RegExp('\\b' + w + '\\b', 'i').test(out.trim)) { out.bodyType = w; break; }
      }
      // submodel HEURISTIC: words before body type (e.g. "Base", "L", "LS").
      // Tag with provenance flag so downstream gets a distinct source label
      // (vcdb.rawContent.formatC.submodelFromTrim) — not the same trust level
      // as a directly-extracted field.
      const lc = out.trim.toLowerCase();
      const firstBody = bodyWords.find(w => lc.includes(w.toLowerCase()));
      if (firstBody) {
        const idx = lc.indexOf(firstBody.toLowerCase());
        const guess = out.trim.slice(0, idx).trim();
        if (guess) {
          out.submodel = guess;
          out.submodelDerivation = 'fromTrim'; // marker for source-label routing
        }
      }
    }
    if (map.notes) {
      out.fitmentNotes = map.notes;
      // Position is a single word/short phrase; stop at the next "Word:" key or end-of-segment punctuation.
      const posMatch = map.notes.match(/Position:\s*([^|;]*?)(?=\s+[A-Z][A-Za-z]+:|[|;]|$)/);
      if (posMatch && posMatch[1].trim()) out.position = posMatch[1].trim();
    }
    return out;
  }

  // Format B: "1999 CHRYSLER LHS | Liter: 3.5 | SubModel: BASE | ..."
  if (/^\d{4}\b/.test(r) && r.includes('|')) {
    out.format = 'B';
    const parts = r.split('|').map(s => s.trim());
    // head = "1999 CHRYSLER LHS"
    const head = parts.shift();
    const headM = head.match(/^(\d{4})\s+(\S+)\s+(.+)$/);
    if (headM) {
      out.year = headM[1];
      out.make = headM[2];
      out.model = headM[3];
    }
    for (const p of parts) {
      const m = p.match(/^([^:]+):\s*(.+)$/);
      if (!m) continue;
      const key = m[1].trim().toLowerCase();
      const val = m[2].trim();
      if (key === 'liter') out.liter = val;
      else if (key === 'submodel') out.submodel = val;
      else if (key === 'aspiration') out.aspiration = val.toUpperCase();
      else if (key === 'fitment notes') out.fitmentNotes = val;
      else if (key === 'cui') out.cid = val;
      else if (key === 'engine type') {
        // "V8 ( 4.6L / 283 )"
        const eng = val.match(/^([HVL])(\d+)/);
        if (eng) { out.blockType = eng[1]; out.cylinders = eng[2]; }
      }
      else if (key === 'engine vin' && val !== '-') out.engineVin = val;
    }
    return out;
  }

  // Format A: "Make Model (YYYY)" or "Make Model (YYYY-YYYY)" or "Make Model (YYYY, YYYY, ...)"
  if (/\(\d{4}/.test(r)) {
    out.format = 'A';
    const m = r.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (m) {
      const head = m[1].trim();
      const yearPart = m[2].trim();
      out.yearList = yearPart;
      // First word = make (heuristic)
      const headParts = head.split(/\s+/);
      out.make = headParts[0];
      out.model = headParts.slice(1).join(' ');
    }
    return out;
  }

  out.format = 'unknown';
  return out;
}

// Brand inference from MPN (matches vf brands.config logic loosely)
function inferBrand(brandName) {
  if (!brandName) return 'unknown';
  const lc = brandName.toLowerCase();
  if (lc.includes('acdelco') || lc.includes('ac delco')) return 'acdelco';
  if (lc.includes('dorman')) return 'dorman';
  if (lc.includes('holley')) return 'holley';
  if (lc.includes('dayco')) return 'dayco';
  return 'other';
}

(async () => {
  // Load brand-mapping to know each MPN's brand
  const brandByMpn = (() => {
    try { return JSON.parse(fs.readFileSync('walmart-vf/data/brand-mapping-by-mpn.json')); }
    catch { return {}; }
  })();

  console.log(`Streaming VCdb (Raw Content extraction)...`);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(VCDB, {
    sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit',
  });

  // Field-coverage counters per brand + overall
  const FIELDS = ['year','make','model','submodel','trim','liter','cc','cid','cylinders','blockType','aspiration','fuelType','bodyType','bodyNumDoors','position','fitmentNotes'];
  const coverage = {};
  const formatCount = {};
  let totalRows = 0;
  const sampleParsed = { L97: [], '639-033': [], '302-3BK': [], '95172': [] };

  for await (const ws of reader) {
    let headers = null;
    let mpnCol = -1, rawCol = -1;
    for await (const row of ws) {
      if (!headers) {
        headers = row.values.slice(1).map(cellText);
        mpnCol = headers.findIndex(h => /^part number$/i.test((h||'').trim()));
        rawCol = headers.findIndex(h => /^raw content$/i.test((h||'').trim()));
        if (mpnCol < 0 || rawCol < 0) {
          console.log(`Skip sheet ${ws.name} — missing required cols`);
          break;
        }
        console.log(`Headers OK. mpnCol=${mpnCol+1} rawCol=${rawCol+1}`);
        continue;
      }
      totalRows++;
      const mpn = cellText(row.values[mpnCol + 1]).trim();
      const raw = cellText(row.values[rawCol + 1]).trim();
      if (PROBE_MODE && !SAMPLE_MPNS.has(mpn)) continue;

      const brand = inferBrand(brandByMpn[mpn] && brandByMpn[mpn].brand);
      const parsed = parseRawContent(raw);
      formatCount[parsed.format] = (formatCount[parsed.format] || 0) + 1;

      // Coverage accounting
      for (const key of ['_all', brand]) {
        if (!coverage[key]) coverage[key] = { total: 0 };
        coverage[key].total++;
        for (const f of FIELDS) {
          if (parsed[f]) coverage[key][f] = (coverage[key][f] || 0) + 1;
        }
      }

      if (SAMPLE_MPNS.has(mpn) && sampleParsed[mpn].length < 3) {
        sampleParsed[mpn].push({ raw, parsed });
      }

      if (totalRows % 100000 === 0) console.log(`  scanned ${totalRows} rows...`);
    }
  }

  // Print coverage report
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Total rows scanned: ${totalRows}`);
  console.log(`Formats detected: ${JSON.stringify(formatCount)}`);
  console.log(`${'='.repeat(80)}\n`);

  const brands = Object.keys(coverage).sort();
  // Header
  console.log('Field'.padEnd(16), ...brands.map(b => b.padStart(11)));
  console.log('-'.repeat(16 + brands.length * 12));
  console.log('TOTAL ROWS'.padEnd(16), ...brands.map(b => String(coverage[b].total).padStart(11)));
  for (const f of FIELDS) {
    const cells = brands.map(b => {
      const c = coverage[b][f] || 0;
      const pct = ((c / coverage[b].total) * 100).toFixed(0) + '%';
      return `${c}/${pct}`.padStart(11);
    });
    console.log(f.padEnd(16), ...cells);
  }

  const report = { totalRows, formatCount, coverage, sampleParsed };
  const OUT = 'walmart-q2-phase1/data/_raw-content-coverage.json';
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\nWrote: ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
