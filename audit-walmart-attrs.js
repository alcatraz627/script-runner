#!/usr/bin/env node
/**
 * audit-walmart-attrs.js
 * Streams the enhancement Excel and collects all unique attribute keys,
 * their frequency, and sample values. Shows which are already mapped
 * and which could fill empty loadsheet columns.
 */
'use strict';

const ExcelJS = require('exceljs');
const path    = require('path');

const SOURCE = path.join(process.env.HOME, 'Downloads', 'export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx');

// Keys already mapped in fill script
const ALREADY_MAPPED = new Set([
  'image_url', 'price', 'color', 'color_family', 'dimensions',
  'finish', 'items_included', 'material', 'manufacturer_s_part_number',
  'model_number', 'size',
]);

async function audit() {
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(SOURCE, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore',
  });

  const keyStats = new Map(); // key → { count, samples: Set }
  let headers = null;
  let total = 0;

  for await (const ws of workbook) {
    if (ws.id != 1) { for await (const _ of ws) {} continue; }
    for await (const row of ws) {
      const vals = row.values.slice(1);
      if (!headers) {
        headers = vals.map(v => (v && typeof v === 'object' && v.text) ? v.text : String(v ?? ''));
        continue;
      }
      total++;
      const attrIdx = headers.indexOf('attributes');
      const raw = vals[attrIdx];
      const attrStr = (raw && typeof raw === 'object' && raw.text) ? raw.text : String(raw || '');

      for (const part of attrStr.split('|')) {
        const colon = part.indexOf(':');
        if (colon === -1) continue;
        const k = part.slice(0, colon).trim().toLowerCase().replace(/\s+/g, '_');
        const v = part.slice(colon + 1).trim();
        if (!k || !v) continue;
        if (!keyStats.has(k)) keyStats.set(k, { count: 0, samples: [] });
        const s = keyStats.get(k);
        s.count++;
        if (s.samples.length < 3) s.samples.push(v.slice(0, 60));
      }
    }
  }

  // Sort by frequency desc
  const sorted = [...keyStats.entries()].sort((a, b) => b[1].count - a[1].count);

  console.log(`Total rows: ${total}\n`);
  console.log('─'.repeat(80));
  console.log('ALL ATTRIBUTE KEYS (by frequency):');
  console.log('─'.repeat(80));

  const unmapped = [];
  const mapped   = [];

  for (const [k, { count, samples }] of sorted) {
    const pct    = ((count / total) * 100).toFixed(1);
    const status = ALREADY_MAPPED.has(k) ? '[MAPPED]' : '[  --  ]';
    const line   = `${status} ${pct.padStart(5)}% (${String(count).padStart(4)}) ${k.padEnd(45)} → ${samples[0] || ''}`;
    console.log(line);
    if (!ALREADY_MAPPED.has(k)) unmapped.push({ k, count, pct, samples });
    else mapped.push({ k, count, pct });
  }

  console.log('\n' + '─'.repeat(80));
  console.log(`UNMAPPED keys (${unmapped.length} total):`);
  console.log('─'.repeat(80));
  for (const { k, count, pct, samples } of unmapped) {
    console.log(`\n  ${k} — ${pct}% of rows (${count})`);
    samples.forEach(s => console.log(`    e.g. "${s}"`));
  }

  console.log('\n✓ Done');
}

audit().catch(err => { console.error(err); process.exit(1); });
