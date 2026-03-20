#!/usr/bin/env node
/**
 * pipeline/download-posters.js — Download poster PNGs from the local eBay poster API
 *
 * Usage:
 *   node pipeline/download-posters.js --data <file.json> --out <dir> [options]
 *
 * Options:
 *   --data <file>       Normalized pipeline JSON (required)
 *   --out <dir>         Output directory for PNGs (default: ./posters next to data file)
 *   --api <url>         Poster API base URL (default: http://localhost:3006/lab/ebay-poster/image/)
 *   --attrs <full|small>  Attribute set to use (default: full)
 *   --start <n>         Start index (default: 0)
 *   --end <n>           End index inclusive (default: last)
 *   --retry             Retry only previously failed items
 */

const fs   = require('fs');
const path = require('path');

const args    = process.argv.slice(2);
const get     = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has     = flag => args.includes(flag);

const dataArg    = get('--data');
const outArg     = get('--out');
const apiUrl     = get('--api') || 'http://localhost:3006/lab/ebay-poster/image/';
const attrsMode  = (get('--attrs') || 'full').toLowerCase() === 'small' ? 'Small' : 'Full';
const startIdx   = parseInt(get('--start') || '0', 10);
const endIdx     = get('--end') ? parseInt(get('--end'), 10) : null;
const onlyRetry  = has('--retry');

if (!dataArg) {
  console.error('Usage: node pipeline/download-posters.js --data <file.json> --out <dir>');
  process.exit(1);
}

const dataPath     = path.resolve(dataArg);
const outputDir    = path.resolve(outArg || path.join(path.dirname(dataPath), '../posters'));
const failuresFile = path.join(outputDir, '.download-failures.json');

const SPINNER = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

function sanitize(text) {
  if (!text) return text;
  return text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[\u2000-\u200D\u2028-\u202F]/g, ' ')
    .replace(/[\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
    console.log(`\nDownloading ${items.length} posters (${startIdx}–${end}) → ${outputDir}\n`);
  }

  let success = 0, failed = 0;
  const failedParts = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const pn   = item['Part Number'];
    const num  = (onlyRetry ? i : startIdx + i) + 1;
    let spinnerInterval;

    try {
      let showcaseImage = item.Images || '';
      if (showcaseImage.endsWith('.webp')) showcaseImage = showcaseImage.replace(/\.webp$/i, '.png');
      if (showcaseImage === '...') showcaseImage = '';

      const payload = {
        font:          'Inter',
        bannerImage:   '/ebay-banner-assets/jegs-banner.png',
        showcaseImage,
        title:         sanitize(item['Title']),
        partNumber:    pn,
        scaleFactor:   3,
        partType:      sanitize(item['Part Type']),
        brand:         sanitize(item['Brand']),
        description:   sanitize(item['Description']),
        attributes:    (item[`Attributes ${attrsMode}`] || []).map(([n, v]) => [sanitize(n), sanitize(v)]),
        fab:           (item['Features & Benefits'] || []).map(f => sanitize(f)),
      };

      let frame = 0;
      spinnerInterval = setInterval(() => {
        process.stdout.write(`\r${SPINNER[frame++ % SPINNER.length]} [${num}/${items.length}] ${pn}...`);
      }, 100);

      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 30000);

      let response;
      try {
        response = await fetch(apiUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'node-fetch' },
          body:    JSON.stringify(payload),
          signal:  controller.signal,
        });
        clearTimeout(timeout);
      } catch (e) {
        clearTimeout(timeout);
        throw e;
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const buf     = Buffer.from(await response.arrayBuffer());
      const outFile = path.join(outputDir, `${pn}.png`);
      fs.writeFileSync(outFile, buf);

      clearInterval(spinnerInterval);
      process.stdout.write(`\r✓ [${num}/${items.length}] ${pn} (${(buf.length / 1024).toFixed(1)}KB)\n`);
      success++;
    } catch (e) {
      clearInterval(spinnerInterval);
      process.stdout.write(`\r✗ [${num}/${items.length}] ${pn} — ${e?.message || e}\n`);
      failed++;
      failedParts.push(pn);
    }
  }

  if (failedParts.length) {
    fs.writeFileSync(failuresFile, JSON.stringify({ failed: failedParts }, null, 2));
    console.log(`\nFailed parts saved → ${failuresFile}`);
  } else if (fs.existsSync(failuresFile)) {
    fs.unlinkSync(failuresFile);
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  ✓ ${success}  ✗ ${failed}  of ${items.length}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (failed) {
    console.log(`\nRetry with: node pipeline/download-posters.js --data ${dataArg} --out ${outputDir} --retry`);
  }

  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('\n✗', e.message); process.exit(1); });
