#!/usr/bin/env node
/**
 * fix-boilerplate-descriptions.js
 * Rewrites descriptions (and empty FAB) for items whose description
 * starts with "eBay " — scraped boilerplate from new SKUs that had
 * no match in the old run.
 *
 * Patches normalize.json and raw.json in place.
 * Usage: node image-selector/fix-boilerplate-descriptions.js [run-id] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const runId  = process.argv[2] || 'jegs-ebay-final';
const DRY_RUN = process.argv.includes('--dry-run');
const runDir  = path.resolve(__dirname, `../runs/${runId}/data`);

const NORMALIZE_PATH = path.join(runDir, 'normalize.json');
const RAW_PATH       = path.join(runDir, 'raw.json');
const OUTPUT_PATH    = path.join(__dirname, `datasets/fixed-descriptions-${runId}.json`);

const MODEL      = 'claude-haiku-4-5-20251001';
const BATCH_SIZE = 5; // small — descriptions are longer output

const SYSTEM_PROMPT = `You are a copywriter for JEGS, a performance automotive parts retailer.
Your job is to rewrite raw scraped eBay product text into clean, professional product listings.

Input per item: partNumber, partType, title, rawText (scraped eBay boilerplate containing real specs).

Output rules:
- "description": 3-5 sentences. Start with "The JEGS [Part Type] ...". Lead with what it does and why it matters. Include key specs from the rawText. No "eBay" mentions. MINIMUM 500 characters — write fully, do not truncate early.
- "features": Array of exactly 5 bullet strings. Each: one concrete benefit tied to a spec. Start with the spec/feature name, then explain the benefit. No generic puffery. No "eBay" mentions.

Return ONLY a JSON array, no markdown fences, no explanation:
[{"partNumber":"...","description":"...","features":["...","...","...","...","..."]}]`;

async function rewriteBatch(client, batch) {
  const input = batch.map(item => ({
    partNumber: item['Part Number'],
    partType:   item['Part Type'],
    title:      item['Title'],
    rawText:    item['Description'],
  }));

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 4096,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: JSON.stringify(input, null, 2) }],
  });

  const text = response.content[0].text.trim()
    .replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('JSON parse failed. Raw:\n', text.slice(0, 500));
    throw new Error(`Batch parse error: ${e.message}`);
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }
  if (!fs.existsSync(NORMALIZE_PATH)) { console.error(`Not found: ${NORMALIZE_PATH}`); process.exit(1); }

  const normalize = JSON.parse(fs.readFileSync(NORMALIZE_PATH, 'utf8'));

  // Detect items to rewrite:
  // 1. Descriptions starting with "eBay " (original boilerplate, first run)
  // 2. --regen flag: re-run items from a previous output file (to fix short descriptions etc.)
  const regenPath = OUTPUT_PATH;
  const REGEN     = process.argv.includes('--regen') && fs.existsSync(regenPath);

  let targets;
  if (REGEN) {
    const prevResults = JSON.parse(fs.readFileSync(regenPath, 'utf8'));
    const prevPNs = new Set(prevResults.map(r => r.partNumber));
    targets = normalize.filter(item => prevPNs.has(item['Part Number']));
    console.log(`--regen mode: re-processing ${targets.length} items from previous run`);
  } else {
    targets = normalize.filter(item =>
      /^eBay\s/i.test((item['Description'] || '').trim())
    );
  }

  console.log(`\nRun: ${runId}`);
  console.log(`Boilerplate items found: ${targets.length}`);
  console.log(`Model: ${MODEL}\n`);

  if (targets.length === 0) { console.log('Nothing to fix.'); return; }

  const workList = DRY_RUN ? targets.slice(0, 2) : targets;
  const client   = new Anthropic({ apiKey });
  const results  = [];

  const totalBatches = Math.ceil(workList.length / BATCH_SIZE);
  for (let i = 0; i < workList.length; i += BATCH_SIZE) {
    const batch    = workList.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`Batch ${batchNum}/${totalBatches} (${batch.map(x => x['Part Number']).join(', ')})...`);

    try {
      const batchResults = await rewriteBatch(client, batch);
      results.push(...batchResults);
      process.stdout.write(` ✓\n`);
    } catch (e) {
      process.stdout.write(` ✗ ${e.message}\n`);
    }
  }

  if (DRY_RUN) {
    console.log('\n─── DRY RUN OUTPUT ───────────────────────────────');
    for (const r of results) {
      console.log(`\n${r.partNumber}:`);
      console.log(`  Description: ${r.description}`);
      console.log(`  Features:`);
      (r.features || []).forEach(f => console.log(`    - ${f}`));
    }
    return;
  }

  // Save results for reference
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  // ─── Patch normalize.json ───────────────────────────────────────────────────
  const normMap = new Map(normalize.map(item => [item['Part Number'], item]));
  let normPatched = 0;
  for (const r of results) {
    const item = normMap.get(r.partNumber);
    if (!item) { console.warn(`  warn: ${r.partNumber} not found in normalize.json`); continue; }
    if (r.description) item['Description'] = r.description;
    if (r.features && r.features.length > 0) item['Features & Benefits'] = r.features;
    normPatched++;
  }
  fs.writeFileSync(NORMALIZE_PATH, JSON.stringify(normalize, null, 2));
  console.log(`\nnormalize.json  →  ${normPatched} items patched`);

  // ─── Patch raw.json ─────────────────────────────────────────────────────────
  if (fs.existsSync(RAW_PATH)) {
    const raw    = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
    const rawMap = new Map(raw.map(item => [item['SKU'] || item['Part Number'], item]));
    let rawPatched = 0;

    for (const r of results) {
      // raw.json SKU may be without "555-" prefix — try both
      const item = rawMap.get(r.partNumber) || rawMap.get(r.partNumber.replace('555-', ''));
      if (!item) { console.warn(`  warn: ${r.partNumber} not found in raw.json`); continue; }
      if (r.description) item['Description'] = r.description;
      // raw.json uses "Features and Benefits" (no &)
      if (r.features && r.features.length > 0) item['Features and Benefits'] = r.features;
      rawPatched++;
    }
    fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2));
    console.log(`raw.json        →  ${rawPatched} items patched`);
  }

  console.log(`\nSaved to: ${OUTPUT_PATH}`);

  // Print summary of what was written
  console.log('\n─── Results ─────────────────────────────────────');
  for (const r of results) {
    console.log(`\n${r.partNumber}: ${r.description?.slice(0, 100)}...`);
  }
  console.log('\nDone.\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
