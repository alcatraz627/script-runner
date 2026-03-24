#!/usr/bin/env node
/**
 * pipeline/download-posters.js — Download poster PNGs from the local eBay poster API
 *
 * Usage:
 *   node pipeline/download-posters.js --data <file.json> --out <dir> [options]
 *
 * Options:
 *   --data <file>           Normalized pipeline JSON (required)
 *   --out <dir>             Output directory for PNGs (default: ./posters next to data file)
 *   --api <url>             Poster API base URL (default: http://localhost:3006/lab/ebay-poster/image/)
 *   --attrs <full|small>    Attribute set to use (default: full)
 *   --start <n>             Start index (default: 0)
 *   --end <n>               End index inclusive (default: last)
 *   --retry                 Retry only previously failed items
 *   --concurrency <n>       Parallel download count (default: 5)
 *   --max-concurrency <n>   Upscale cap (default: concurrency × 2)
 *   --max-retries <n>       Retry limit per item (default: 3)
 */

const fs   = require('fs');
const path = require('path');
const { downloadAll } = require('./poster-downloader');

const args    = process.argv.slice(2);
const get     = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has     = flag => args.includes(flag);

const dataArg        = get('--data');
const outArg         = get('--out');
const apiUrl         = get('--api') || 'http://localhost:3006/lab/ebay-poster/image/';
const attrsMode      = (get('--attrs') || 'full').toLowerCase() === 'small' ? 'Small' : 'Full';
const startIdx       = parseInt(get('--start') || '0', 10);
const endIdx         = get('--end') ? parseInt(get('--end'), 10) : null;
const onlyRetry      = has('--retry');
const concurrency    = parseInt(get('--concurrency') || '5', 10);
const maxConcurrency = get('--max-concurrency') ? parseInt(get('--max-concurrency'), 10) : concurrency * 2;
const maxRetries     = parseInt(get('--max-retries') || '3', 10);

if (!dataArg) {
  console.error('Usage: node pipeline/download-posters.js --data <file.json> --out <dir>');
  process.exit(1);
}

const dataPath     = path.resolve(dataArg);
const outputDir    = path.resolve(outArg || path.join(path.dirname(dataPath), '../posters'));
const failuresFile = path.join(outputDir, '.download-failures.json');

const SPINNER = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

function loadFailures() {
  try { return JSON.parse(fs.readFileSync(failuresFile, 'utf8')); } catch { return { failed: [] }; }
}

async function main() {
  // Rotate existing posters directory: posters → posters_last
  if (fs.existsSync(outputDir) && !onlyRetry) {
    const lastDir = outputDir.replace(/\/?$/, '_last');
    if (fs.existsSync(lastDir)) {
      fs.rmSync(lastDir, { recursive: true });
    }
    fs.renameSync(outputDir, lastDir);
    console.log(`Rotated: ${path.basename(outputDir)} → ${path.basename(lastDir)}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  let items;

  if (onlyRetry) {
    const failures = loadFailures();
    if (!failures.failed.length) { console.log('No failed items to retry.'); process.exit(0); }
    items = data.filter(r => failures.failed.includes(r['Part Number']));
    console.log(`\nRetrying ${items.length} failed items...\n`);
  } else {
    const end = endIdx ?? data.length - 1;
    items = data.slice(startIdx, end + 1);
    console.log(`\nDownloading ${items.length} posters (${startIdx}–${end}) → ${outputDir}`);
  }

  console.log(`Concurrency: ${concurrency} (max: ${maxConcurrency}), retries: ${maxRetries}\n`);

  // Progress display
  let spinFrame = 0;
  const spinInterval = setInterval(() => {
    spinFrame = (spinFrame + 1) % SPINNER.length;
  }, 100);

  let lastLine = '';
  function onProgress({ current, total, success, failed, retrying, concurrency: c }) {
    const line = `${SPINNER[spinFrame]} [${current}/${total}] ✓${success} ✗${failed} ↻${retrying} ⫽${c}`;
    if (line !== lastLine) {
      process.stdout.write(`\r${line}   `);
      lastLine = line;
    }
  }

  const progressInterval = setInterval(() => {
    // Re-render spinner frame even if counts haven't changed
    if (lastLine) process.stdout.write(`\r${lastLine.replace(/^./, SPINNER[spinFrame])}   `);
  }, 100);

  const { results, failures, summary } = await downloadAll(items, {
    concurrency,
    maxConcurrency,
    maxRetries,
    timeout: 30000,
    outputDir,
    apiUrl,
    attrsMode,
    onProgress,
  });

  clearInterval(spinInterval);
  clearInterval(progressInterval);
  process.stdout.write('\r' + ' '.repeat(60) + '\r'); // clear progress line

  // Print per-item results
  for (const r of results) {
    const pn = r['Part Number'];
    if (r.posterPath) {
      const kb = r.posterSize ? `(${(r.posterSize / 1024).toFixed(1)}KB)` : '';
      console.log(`✓ ${pn} ${kb}`);
    } else {
      console.log(`✗ ${pn} — ${r.posterError}`);
    }
  }

  // Write failures file
  if (failures) {
    fs.writeFileSync(failuresFile, JSON.stringify(failures, null, 2));
    console.log(`\nFailed parts saved → ${failuresFile}`);
  } else if (fs.existsSync(failuresFile)) {
    fs.unlinkSync(failuresFile);
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  ✓ ${summary.success}  ✗ ${summary.failed}  of ${summary.total}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (summary.failed) {
    console.log(`\nRetry with: node pipeline/download-posters.js --data ${dataArg} --out ${outputDir} --retry`);
  }

  process.exit(summary.failed ? 1 : 0);
}

main().catch(e => { console.error('\n✗', e.message); process.exit(1); });
