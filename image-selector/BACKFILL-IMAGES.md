# Backfill Missing Product Images

## Problem

162 SKUs in the JEGS eBay dataset have no product images because the source Excel mapped multiple products to single eBay listings. The scraper captured the seller's storefront gallery photos instead of product-specific images. These stock images were detected and stripped (any image URL appearing in 4+ different SKUs).

## Goal

For each SKU with missing images, find the real product photo from jegs.com and patch it into the dataset.

## Step-by-Step Instructions

### 1. Identify SKUs with missing images

```bash
cd /Users/alcatraz627/Code/Versable/scripts/image-selector
node -e "
const data = require('./datasets/jegs-final-images/data.json');
const missing = data.filter(d => d._imgs.length === 0).map(d => ({ sku: d.sku, title: d.title }));
require('fs').writeFileSync('missing-images.json', JSON.stringify(missing, null, 2));
console.log(missing.length + ' SKUs need images');
"
```

### 2. Get images from jegs.com

The JEGS product page URL pattern is:
```
https://www.jegs.com/i/JEGS/555/{PART_NUMBER}/10002/-1
```
Where `{PART_NUMBER}` is the SKU without the `555-` prefix (e.g., SKU `555-92123` → part number `92123`).

For each SKU in `missing-images.json`:
1. Open the JEGS product page
2. Find the main product image. It's typically in an `og:image` meta tag or the first `<img>` in the product gallery. The URL format is usually `https://www.jegs.com/images/product/...` or hosted on a CDN.
3. Right-click → Copy image address

If jegs.com blocks automated access (returns 403), use one of these approaches:
- **Puppeteer/Playwright**: Launch a real browser instance. Navigate to each URL, wait for page load, extract `document.querySelector('meta[property="og:image"]').content` or the first product gallery image `src`.
- **Manual browser**: Open each URL, copy image address. For 127 items this takes ~30 min.
- **eBay search**: Search `site:ebay.com JEGS {part_number}` — some may have individual listings with real photos.
- **Google Shopping**: Search `JEGS {part_number}` — Google Shopping results often have product thumbnails that link to full-size images.

### 3. Create a patches file

Format: `image-patches.json`
```json
{
  "555-92123": "https://www.jegs.com/images/product/555/92123/92123.jpg",
  "555-78756": ["https://img1.jpg", "https://img2.jpg"],
  "555-91159": "https://single-image-url.jpg"
}
```

Single string or array of strings both work. First image becomes the main/showcase image.

### 4. Run the upsert script

```bash
node upsert-images.js image-patches.json --dataset jegs-final-images --run-dir ../runs/jegs-ebay-final
```

This patches three files:
- `datasets/jegs-final-images/data.json` — image selector dataset
- `datasets/attr-gaps-final/changes.json` — dashboard review state (sets mainImage)
- `runs/jegs-ebay-final/data/raw.json` — pipeline source data (Images pipe-separated + Main Image)

### 5. Rebuild the dashboard

```bash
node generate-combined-dashboard.js --pre-approved datasets/attr-gaps/approved.json
```

Then restart the server if running:
```bash
lsof -ti:3459 | xargs kill 2>/dev/null; node review-server.js &
```

### 6. Verify

Open http://localhost:3459 and filter by "Unselected" to confirm patched items now show images.

## Affected SKUs Summary

- **Total missing**: ~127 SKUs (after stock image filtering)
- **Root cause**: 28 shared eBay listing URLs mapping to 162 SKUs total
- **Largest group**: 67 SKUs all pointed to eBay listing `117008784933`
- **Stock detection rule**: any image URL appearing in 4+ different SKUs is auto-stripped

## Puppeteer Script Sketch

If writing an automated scraper:

```javascript
const puppeteer = require('puppeteer');
const fs = require('fs');

const missing = JSON.parse(fs.readFileSync('missing-images.json', 'utf8'));
const patches = {};

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...');

for (const { sku } of missing) {
  const partNum = sku.replace('555-', '');
  const url = `https://www.jegs.com/i/JEGS/555/${partNum}/10002/-1`;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    const imgUrl = await page.$eval(
      'meta[property="og:image"]',
      el => el.content
    ).catch(() => null);
    if (imgUrl) {
      patches[sku] = imgUrl;
      console.log(`${sku}: ${imgUrl}`);
    } else {
      console.log(`${sku}: no og:image found`);
    }
  } catch (e) {
    console.log(`${sku}: failed - ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 1500)); // polite delay
}

await browser.close();
fs.writeFileSync('image-patches.json', JSON.stringify(patches, null, 2));
console.log(`\nPatches written: ${Object.keys(patches).length}`);
```

Install puppeteer first: `npm install puppeteer`
