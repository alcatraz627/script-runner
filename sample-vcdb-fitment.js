#!/usr/bin/env node
/**
 * sample-vcdb-fitment.js
 *
 * One-off: reads VCDB fitment Excel, picks 5 random product URLs,
 * and writes a hierarchical markdown report of their fitment data.
 *
 * Usage:
 *   node sample-vcdb-fitment.js [--seed 42] [--count 5] [--out fitment-sample.md]
 */

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const INPUT = path.join(
  process.env.HOME,
  'Downloads',
  'Versable Sample Item List_marketplace_extracts_v6_1_cc32_VCDB.xlsx'
);

// CLI args
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : def;
};
const SAMPLE_COUNT = parseInt(getArg('--count', '5'), 10);
const SEED = parseInt(getArg('--seed', String(Date.now())), 10);
const OUT_FILE = getArg('--out', path.join(__dirname, 'fitment-sample.md'));

// Seeded shuffle (Fisher-Yates with LCG)
function seededShuffle(arr, seed) {
  let s = seed >>> 0;
  const lcg = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(lcg() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function main() {
  console.log(`Reading: ${INPUT}`);
  console.log(`Seed: ${SEED}  Count: ${SAMPLE_COUNT}`);

  // ── Pass 1: collect all unique URLs (streaming) ────────────────────────────
  const urlSet = new Set();
  {
    // ExcelJS streaming reader
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(INPUT, {
      entries: 'emit',
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      styles: 'ignore',
      worksheets: 'emit',
    });

    let headerRead = false;
    let urlColIdx = -1;

    await new Promise((resolve, reject) => {
      reader.on('worksheet', (ws) => {
        const isTarget = ws.id == 1; // WorkbookReader emits ws.id as string
        ws.on('row', (row) => {
          if (!isTarget) return;
          if (!headerRead) {
            const vals = row.values; // 1-indexed
            for (let i = 1; i < vals.length; i++) {
              if (vals[i] === 'url') { urlColIdx = i; break; }
            }
            headerRead = true;
            return;
          }
          const urlVal = row.getCell(urlColIdx).value;
          if (urlVal) urlSet.add(String(urlVal));
        });
      });

      reader.on('end', resolve);
      reader.on('error', reject);
      reader.read();
    });
  }

  const allUrls = [...urlSet];
  console.log(`Unique URLs found: ${allUrls.length}`);

  // Pick 5 random URLs
  const picked = seededShuffle(allUrls, SEED).slice(0, SAMPLE_COUNT);
  console.log(`Picked URLs:\n${picked.map((u, i) => `  ${i + 1}. ${u}`).join('\n')}`);
  const pickedSet = new Set(picked);

  // ── Pass 2: collect rows only for picked URLs (streaming) ──────────────────
  // Structure: url → { meta, fitments: [] }
  //   fitment: { MakeName, ModelName, Years, SubModelName, Liter, CID, Cylinders, BlockType, raw_fitment }
  const byUrl = {};
  for (const url of picked) {
    byUrl[url] = { url, brand: null, mpn: null, fitments: [] };
  }

  {
    const reader2 = new ExcelJS.stream.xlsx.WorkbookReader(INPUT, {
      entries: 'emit',
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      styles: 'ignore',
      worksheets: 'emit',
    });

    let headers = [];

    await new Promise((resolve, reject) => {
      reader2.on('worksheet', (ws) => {
        const isTarget = ws.id == 1; // WorkbookReader emits ws.id as string
        ws.on('row', (row) => {
          if (!isTarget) return;
          const vals = row.values; // 1-indexed
          if (headers.length === 0) {
            for (let i = 1; i < vals.length; i++) {
              headers[i] = vals[i];
            }
            return;
          }

          const get = (col) => {
            const idx = headers.indexOf(col);
            if (idx === -1) return null;
            const v = row.getCell(idx).value;
            return v !== null && v !== undefined ? String(v) : null;
          };

          const url = get('url');
          if (!url || !pickedSet.has(url)) return;

          const entry = byUrl[url];
          entry.brand = entry.brand || get('productbrand');
          entry.mpn = entry.mpn || get('mpn');

          entry.fitments.push({
            MakeName: get('MakeName'),
            ModelName: get('ModelName'),
            Years: get('Years'),
            SubModelName: get('SubModelName'),
            Liter: get('Liter'),
            CID: get('CID'),
            Cylinders: get('Cylinders'),
            BlockType: get('BlockType'),
            raw_fitment: get('raw_fitment'),
            match_status: get('match_status'),
          });
        });
      });

      reader2.on('end', resolve);
      reader2.on('error', reject);
      reader2.read();
    });
  }

  // ── Build hierarchy ────────────────────────────────────────────────────────
  // url → Make → Model → Year → SubModel → Set<"Liter CID Cyl BlockType">
  function buildTree(fitments) {
    const tree = {}; // Make → Model → Year → SubModel → engines[]
    for (const f of fitments) {
      const make = f.MakeName || 'Unknown Make';
      const model = f.ModelName || 'Unknown Model';
      const year = f.Years || '????';
      const sub = f.SubModelName || '(base)';
      const engine = [
        f.Liter ? `${f.Liter}L` : null,
        f.CID && f.CID !== '-' ? `${f.CID}ci` : null,
        f.Cylinders ? `${f.Cylinders}-cyl` : null,
        f.BlockType ? `${f.BlockType}-block` : null,
      ].filter(Boolean).join(' / ') || 'N/A';

      tree[make] ??= {};
      tree[make][model] ??= {};
      tree[make][model][year] ??= {};
      tree[make][model][year][sub] ??= new Set();
      tree[make][model][year][sub].add(engine);
    }
    return tree;
  }

  // ── Render markdown ────────────────────────────────────────────────────────
  const lines = [];
  lines.push('# VCDB Fitment Sample Report');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 10)}  `);
  lines.push(`**Seed:** ${SEED}  `);
  lines.push(`**Products sampled:** ${SAMPLE_COUNT} of ${allUrls.length} unique URLs`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (let i = 0; i < picked.length; i++) {
    const url = picked[i];
    const entry = byUrl[url];
    const tree = buildTree(entry.fitments);

    lines.push(`## ${i + 1}. ${entry.brand || 'Unknown Brand'} — \`${entry.mpn || 'N/A'}\``);
    lines.push('');
    lines.push(`**URL:** <${url}>  `);
    lines.push(`**Fitment rows:** ${entry.fitments.length}`);
    lines.push('');

    const makes = Object.keys(tree).sort();
    for (const make of makes) {
      lines.push(`### ${make}`);
      lines.push('');

      const models = Object.keys(tree[make]).sort();
      for (const model of models) {
        lines.push(`#### ${model}`);
        lines.push('');

        // Collect all years, sort numerically
        const years = Object.keys(tree[make][model]).sort((a, b) => Number(a) - Number(b));

        // Build a compact year-range table
        // Group consecutive years that share the exact same submodel+engine combos
        // For readability, just list year rows in a table
        lines.push('| Year | Sub-Model | Engine |');
        lines.push('|------|-----------|--------|');

        for (const year of years) {
          const subs = Object.keys(tree[make][model][year]).sort();
          for (const sub of subs) {
            const engines = [...tree[make][model][year][sub]].sort();
            for (let ei = 0; ei < engines.length; ei++) {
              const yearCell = ei === 0 && sub === subs[0] ? year : '';
              const subCell = ei === 0 ? sub : '';
              lines.push(`| ${yearCell} | ${subCell} | ${engines[ei]} |`);
            }
          }
        }
        lines.push('');
      }
    }

    lines.push('---');
    lines.push('');
  }

  fs.writeFileSync(OUT_FILE, lines.join('\n'), 'utf8');
  console.log(`\nWritten: ${OUT_FILE}`);
  console.log(`Lines: ${lines.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
