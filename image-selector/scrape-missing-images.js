#!/usr/bin/env node
/**
 * scrape-missing-images.js
 *
 * Finds images for SKUs that have none in the normalized pipeline output by
 * probing JEGS CDN URLs directly (no browser required — avoids Cloudflare).
 *
 * URL pattern: https://www.jegs.com/images/photos/500/555/555-{part-number}.jpg
 *              https://www.jegs.com/images/photos/500/555/555-{part-number}_1.jpg  (etc.)
 *
 * Usage:
 *   node image-selector/scrape-missing-images.js [--run-dir <path>] [--out <file>]
 *
 * Defaults:
 *   --run-dir  ../runs/jegs-ebay-final
 *   --out      image-selector/image-patches.json
 *
 * After running:
 *   node image-selector/upsert-images.js image-selector/image-patches.json \
 *     --dataset jegs-final-images --run-dir runs/jegs-ebay-final
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const runDir = path.resolve(getArg('--run-dir') || path.join(__dirname, '../runs/jegs-ebay-final'));
const outFile = path.resolve(getArg('--out') || path.join(__dirname, 'image-patches.json'));

const normalizeFile = path.join(runDir, 'data', 'normalize.json');
if (!fs.existsSync(normalizeFile)) {
  console.error('Normalize output not found:', normalizeFile);
  process.exit(1);
}

const items = JSON.parse(fs.readFileSync(normalizeFile, 'utf8'));
const missing = items.filter(r => !r.Images || r.Images === '');
console.log(`\nFound ${missing.length} items with empty Images field\n`);

if (missing.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

const CDN_BASE = 'https://www.jegs.com/images/photos/500/555';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36';
const MAX_IMAGES = 8; // check main + up to 7 numbered variants

function headOk(url) {
  return new Promise(resolve => {
    const req = https.request(url, { method: 'HEAD', headers: { 'User-Agent': UA } }, res => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.setTimeout(8000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function findImages(sku) {
  const partNum = sku.replace(/^555-/, '');
  const skuBase = `555-${partNum}`;
  const images = [];

  // Check main image + numbered variants
  for (let i = 0; i <= MAX_IMAGES; i++) {
    const filename = i === 0 ? `${skuBase}.jpg` : `${skuBase}_${i}.jpg`;
    const url = `${CDN_BASE}/${filename}`;
    const ok = await headOk(url);
    if (ok) {
      images.push(url);
    } else if (i > 0) {
      // Numbering is sequential; stop at first gap after finding some
      if (images.length > 0) break;
      // If no main image found, stop early
      if (i === 1) break;
    }
  }

  return images;
}

(async () => {
  const patches = {};
  let found = 0;
  let notFound = 0;

  for (let i = 0; i < missing.length; i++) {
    const row = missing[i];
    const sku = row['Part Number'];

    process.stdout.write(`[${i + 1}/${missing.length}] ${sku.padEnd(15)} `);

    const images = await findImages(sku);

    if (images.length > 0) {
      patches[sku] = images;
      found++;
      console.log(`✓ ${images.length} image(s) — ${images[0].slice(-40)}`);
    } else {
      notFound++;
      console.log(`✗ not found on JEGS CDN`);
    }
  }

  console.log(`\n────────────────────────────────────────`);
  console.log(`  Found:     ${found} / ${missing.length}`);
  console.log(`  Not found: ${notFound}`);
  console.log(`────────────────────────────────────────\n`);

  if (Object.keys(patches).length > 0) {
    fs.writeFileSync(outFile, JSON.stringify(patches, null, 2));
    console.log(`Patches written to: ${outFile}`);
    console.log(`\nNext step:`);
    console.log(`  node image-selector/upsert-images.js ${path.relative(process.cwd(), outFile)} --dataset jegs-final-images --run-dir runs/jegs-ebay-final`);
  } else {
    console.log('No patches to write — no images found on CDN.');
  }
})();
