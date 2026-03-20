#!/usr/bin/env node
/**
 * pipeline/deploy-preview.js — Build & deploy a static preview to Vercel
 *
 * Usage:
 *   node pipeline/deploy-preview.js --data <file.json> [--title "My Preview"] [--prod]
 *
 * Builds a static folder with baked data, then deploys via Vercel CLI.
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args    = process.argv.slice(2);
const get     = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has     = flag => args.includes(flag);

const dataArg = get('--data');
const title   = get('--title');
const prod    = has('--prod');
const noDeploy = has('--no-deploy');

if (!dataArg) {
  console.error('Usage: node pipeline/deploy-preview.js --data <file.json> [--title "My Preview"] [--prod] [--no-deploy]');
  process.exit(1);
}

const dataPath = path.resolve(dataArg);
const dashDir  = path.resolve(__dirname, '../preview-dashboard');
const outDir   = path.resolve(__dirname, '../_deploy');

// ── Reuse autoMap from preview.js ────────────────────────────────────────────
function autoMap(rows) {
  if (!rows.length) return rows;
  const keys = Object.keys(rows[0]);
  const find = (...candidates) =>
    keys.find(k => candidates.some(c => k.toLowerCase() === c.toLowerCase()));

  const skuKey   = find('Part Number', 'SKU', 'sku', 'id', 'ID');
  const titleKey = find('Title', 'title', 'name', 'Name', 'Product Name');
  const imageKey = find('Images', 'Main Image', 'image', 'Image URL', 'Photo');
  const descKey  = find('Description', 'description', 'desc');
  const catKey   = find('Part Type', 'Category', 'category', 'Type');
  const specsKey = find('Attributes Full', 'Attributes Small', 'item_specifics', 'attributes');

  return rows.map(r => {
    const imgVal = imageKey ? r[imageKey] : '';
    const imgs   = imgVal ? [String(imgVal)] : [];

    let item_specifics = null;
    const rawSpecs = specsKey ? r[specsKey] : null;
    if (Array.isArray(rawSpecs) && rawSpecs.length && Array.isArray(rawSpecs[0])) {
      item_specifics = JSON.stringify(Object.fromEntries(rawSpecs));
    } else if (rawSpecs && typeof rawSpecs === 'object') {
      item_specifics = JSON.stringify(rawSpecs);
    } else if (typeof rawSpecs === 'string') {
      item_specifics = rawSpecs;
    }

    const desc = descKey ? String(r[descKey] || '') : '';
    const fab  = r['Features & Benefits'];
    const fullDesc = [
      desc,
      Array.isArray(fab) && fab.length ? 'Features:\n' + fab.map((f, i) => `${i+1}. ${f}`).join('\n') : '',
    ].filter(Boolean).join('\n\n');

    return {
      sku:            skuKey   ? String(r[skuKey]   || '') : JSON.stringify(r).slice(0, 30),
      title:          titleKey ? String(r[titleKey] || '') : '',
      ebay_title:     titleKey ? String(r[titleKey] || '') : '',
      url:            r.url || r.URL || null,
      images:         imgVal ? String(imgVal) : '',
      image_count:    imgs.length,
      category:       catKey ? String(r[catKey] || '') : '',
      description:    fullDesc,
      fitment:        r.fitment || r.Fitment || null,
      item_specifics,
      _imgs:          imgs,
      _imgs_all:      imgs,
    };
  });
}

// ── Build ────────────────────────────────────────────────────────────────────
// Creates a static copy of the preview dashboard with the data baked in.
// The .vercel directory is preserved across rebuilds to avoid re-prompting
// for Vercel project linking on each deploy.
console.log('\n  Building static preview...');

// Clean output dir but preserve .vercel config (avoids re-prompting on every deploy)
if (fs.existsSync(outDir)) {
  for (const entry of fs.readdirSync(outDir)) {
    if (entry === '.vercel') continue;
    const p = path.join(outDir, entry);
    fs.rmSync(p, { recursive: true });
  }
} else {
  fs.mkdirSync(outDir, { recursive: true });
}

// Read & transform data
const raw    = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const mapped = autoMap(raw);
fs.writeFileSync(path.join(outDir, 'data.json'), JSON.stringify(mapped));
console.log(`  ✓ ${mapped.length} rows baked into data.json`);

// Copy index.html (optionally patch title)
let html = fs.readFileSync(path.join(dashDir, 'index.html'), 'utf8');
if (title) {
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  // Also patch the visible h1 if present
  html = html.replace(
    /(<h1[^>]*>)[^<]*(<\/h1>)/,
    `$1${title}$2`
  );
}
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log('  ✓ index.html copied');

// Empty selections (localStorage will handle it on Vercel)
fs.writeFileSync(path.join(outDir, 'selections.json'), '{}');

console.log(`  ✓ Output: _deploy/\n`);

// ── Deploy ───────────────────────────────────────────────────────────────────
if (noDeploy) {
  console.log('  Skipped deploy (--no-deploy). Run manually:');
  console.log(`  npx vercel ${prod ? '--prod ' : ''}${outDir}\n`);
  process.exit(0);
}

try {
  const flags = prod ? '--prod' : '';
  console.log(`  Deploying to Vercel${prod ? ' (production)' : ' (preview)'}...`);
  execSync(`npx vercel ${flags} ${outDir}`, { stdio: 'inherit' });
} catch (e) {
  console.error('\n  Deploy failed. You can deploy manually:');
  console.error(`  npx vercel ${prod ? '--prod ' : ''}${outDir}\n`);
  process.exit(1);
}
