#!/usr/bin/env node
/**
 * build-missing-measure-research.js
 *
 * Reads the proposal CSV; for every part type whose `proposed_key` is empty
 * (i.e. no measure/unit found in source attributes OR scrape), expands to
 * one row PER MPN and emits a research CSV with everything the user needs
 * to scrape/research the part externally:
 *   mpn, partType, brand, title, source_id, scrape_image_url,
 *   sample_listing_urls (from scrape), known_keys_summary, suggestion
 *
 * Streams Walmart_Full Scrape_ vf.xlsx once (only for the relevant MPNs) to
 * pick up the `url` column which the slim index doesn't carry.
 *
 * Output: walmart-vf/output/missing-measure-research.csv
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// v8: brand-parameterized
const BRANDS = require('./brands.config.js');
const args = process.argv.slice(2);
const brandKey = (args[args.indexOf('--brand') + 1] || '').toLowerCase();
const cfg = BRANDS[brandKey];
if (!cfg) { console.error(`Unknown --brand "${brandKey}"`); process.exit(1); }

const HOME = process.env.HOME;
const SOURCE     = `${HOME}/Downloads/export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx`;
const FULLSCRAPE = `${HOME}/Downloads/Walmart Reference/Walmart_Full Scrape_ vf.xlsx`;
const PROPOSAL   = path.join(__dirname, '..', 'output', `measure-unit-proposals-${brandKey}.csv`);
const SCRAPE_IDX = path.join(__dirname, '..', 'data', `fullscrape-by-mpn-${brandKey}.json`);
const OUT        = path.join(__dirname, '..', 'output', `missing-measure-research-${brandKey}.csv`);

const norm = v => String(v ?? '').trim();

function parseCsv(text) {
  // simple parser — our writer escapes ", and uses commas. Fields may be quoted.
  const rows = [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const cells = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else {
        if (ch === ',') { cells.push(cur); cur = ''; }
        else if (ch === '"' && cur === '') q = true;
        else cur += ch;
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}
const csvEscape = s => {
  if (s == null) return '';
  s = String(s);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
};

(async () => {
  // 1. Read proposal CSV; collect part types with NO proposed_key
  const proposalRows = parseCsv(fs.readFileSync(PROPOSAL, 'utf8'));
  const header = proposalRows[0];
  const idx = {};
  header.forEach((h, i) => idx[h] = i);
  const PROPOSED_IDX = idx['proposed_key'];

  const missingPartTypes = new Map(); // partType -> mpns
  for (const r of proposalRows.slice(1)) {
    if (!r[PROPOSED_IDX]) {
      const pt   = r[idx['partType']];
      const mpns = r[idx['mpns']].split('|').filter(Boolean);
      missingPartTypes.set(pt, mpns);
    }
  }
  const missingMpns = new Set();
  missingPartTypes.forEach(mpns => mpns.forEach(m => missingMpns.add(m)));
  console.log(`Part types missing measure: ${missingPartTypes.size}`);
  console.log(`MPNs missing measure: ${missingMpns.size}`);

  // 2. Load source rows for those MPNs (Title, attributes, id, etc.)
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(SOURCE, {
    worksheets:'emit', sharedStrings:'cache', hyperlinks:'ignore', styles:'ignore'
  });
  const sourceByMpn = {};
  for await (const ws of wb) {
    let n = 0, headers = null;
    for await (const row of ws) {
      const vals = row.values.slice(1).map(v => (v && v.text) || v);
      if (n === 0) headers = vals.map(norm);
      else {
        const obj = {}; headers.forEach((h, i) => obj[h] = vals[i]);
        const mpn = norm(obj['Part Number']);
        if (missingMpns.has(mpn)) {
          sourceByMpn[mpn] = obj;
        }
      }
      n++;
    }
    break;
  }

  // 3. Stream Full Scrape, pull URLs per MPN (only for missingMpns)
  const scrapeUrls = {}; // mpn -> Set of urls
  const scrapeImages = {}; // mpn -> array of image urls
  const wb2 = new ExcelJS.stream.xlsx.WorkbookReader(FULLSCRAPE, {
    worksheets:'emit', sharedStrings:'cache', hyperlinks:'ignore', styles:'ignore'
  });
  for await (const ws of wb2) {
    let n = 0, idx2 = null;
    for await (const row of ws) {
      const vals = row.values.slice(1).map(v => (v && v.text) || v);
      if (n === 0) {
        idx2 = {};
        vals.forEach((h, i) => { idx2[norm(h)] = i; });
      } else {
        const brand = norm(vals[idx2['productbrand']]);
        if (!cfg.sourceBrandRegex.test(brand)) { n++; continue; }
        const mpn = norm(vals[idx2['mpn']]);
        if (!missingMpns.has(mpn)) { n++; continue; }
        const url = norm(vals[idx2['url']]);
        const key = norm(vals[idx2['key']]);
        if (url) {
          if (!scrapeUrls[mpn]) scrapeUrls[mpn] = new Set();
          scrapeUrls[mpn].add(url);
        }
        if (key === 'image_url') {
          const v = norm(vals[idx2['value']]);
          if (v) {
            if (!scrapeImages[mpn]) scrapeImages[mpn] = [];
            if (!scrapeImages[mpn].includes(v)) scrapeImages[mpn].push(v);
          }
        }
      }
      n++;
    }
    break;
  }

  // 4. Load slim scrape index for keys list
  const scrapeIdx = JSON.parse(fs.readFileSync(SCRAPE_IDX, 'utf8'));

  // 5. Compose per-MPN research rows
  const out = [['mpn', 'partType', 'brand', 'source_title', 'oem_or_alt_numbers',
                'scrape_image_url', 'sample_listing_urls', 'source_attr_key_count',
                'scrape_key_count', 'suggested_search_query', 'measure', 'unit', 'notes']];

  for (const [pt, mpns] of [...missingPartTypes].sort()) {
    for (const mpn of mpns) {
      const src = sourceByMpn[mpn] || {};
      const scrape = scrapeIdx[mpn] || { byKey: {} };
      const attrText = String(src.attributes || '');
      const attrKeys = (attrText.match(/[a-z_]+\s*:/gi) || []).length;

      // Collect OEM / alternate numbers if known
      const oemAlts = [];
      const oemMatch = attrText.match(/oem_interchange_number:\s*([^|]+)/i);
      if (oemMatch) oemAlts.push('oem=' + oemMatch[1].trim());
      const altMatch = attrText.match(/alternate_inventory_number:\s*([^|]+)/i);
      if (altMatch) oemAlts.push('alt=' + altMatch[1].trim());
      // Pull from scrape too
      ['part_number', 'replace_part_number', 'interchange_part_number'].forEach(k => {
        if (scrape.byKey[k]?.[0]?.value) oemAlts.push(k + '=' + scrape.byKey[k][0].value);
      });

      const urls = [...(scrapeUrls[mpn] || [])].slice(0, 5);
      const img  = scrapeImages[mpn]?.[0] || '';

      out.push([
        mpn,
        pt,
        norm(src.Brand) || cfg.outputBrandString,
        norm(src.Title || src.title || ''),
        oemAlts.join(' | '),
        img,
        urls.join('\n'),
        attrKeys,
        Object.keys(scrape.byKey).length,
        `${cfg.outputBrandString} ${mpn} ${pt} dimensions specifications`,
        '', '', ''
      ]);
    }
  }

  fs.writeFileSync(OUT, out.map(r => r.map(csvEscape).join(',')).join('\n'));

  console.log(`\nWrote → ${OUT}`);
  console.log(`Rows: ${out.length - 1}`);
  console.log(`\nMPNs (sorted by part type):`);
  const grouped = {};
  for (const [pt, mpns] of missingPartTypes) {
    grouped[pt] = mpns;
  }
  Object.entries(grouped).sort().forEach(([pt, mpns]) => {
    console.log(`  ${pt}`);
    mpns.forEach(m => {
      const t = sourceByMpn[m] ? norm(sourceByMpn[m].Title || '').slice(0, 80) : '<not in source>';
      const urls = (scrapeUrls[m] || new Set()).size;
      console.log(`    ${m.padEnd(16)}  urls=${urls}  ${t}`);
    });
  });
})().catch(e => { console.error(e); process.exit(1); });
