/**
 * transforms/jegs-export-normalize.js
 *
 * Normalizes the newer JEGS eBay export format (Mar 18+) into the standard
 * pipeline shape. This schema differs from the Mar 07/17 format:
 *
 *   Mar 07/17 schema            Mar 18+ schema
 *   ─────────────────────────   ─────────────────────────────
 *   Part Number                 SKU
 *   Title                       eBay Listing Title
 *   Part Type                   Category Hierarchy
 *   attributes_essential (str)  Item Specifics (JSON) — flat object
 *   attributes_complete  (str)  (same field, no separate full/small)
 *   Features & Benefits         (not present)
 *   Main Image                  Main Image
 *   Images (pipe-separated)     Images (pipe-separated)
 *   Brand                       (not present — use config.brand)
 *   Description                 Description
 *                               Fitment / Compatibility
 *
 * Config: { brand: 'JEGS' }
 */

const { extractFirstImage } = require('./jegs-normalize');

// Known stock/placeholder eBay image URL base paths (extension-agnostic).
// Keep in sync with image-selector/prepare-image-dataset.js BLOCKED_BASES.
const BLOCKED_IMAGE_BASES = new Set([
  'https://i.ebayimg.com/00/s/MTIzM1gxNjAw/z/l94AAeSwhLdo2FOA/$_1',
  'https://i.ebayimg.com/images/g/1VEAAOSwBahVcLz8/s-l1600',
  'https://i.ebayimg.com/images/g/DOcAAOSw8NplLtwK/s-l1600', // storefront gallery — 92 SKUs
  'https://i.ebayimg.com/images/g/DnkAAeSwAKtpgwkt/s-l1600',
  'https://i.ebayimg.com/images/g/Eq8AAeSwWthplcJ8/s-l1600',
  'https://i.ebayimg.com/images/g/gm8AAeSwQgBplcJ8/s-l1600',
  'https://i.ebayimg.com/images/g/rBQAAeSwlJVplcJ8/s-l1600',
  'pics.ebaystatic.com/aw/pics/nextGenVit/imgNoImg',
]);

function stripExt(url) { return url.replace(/\.[^.?]+(\?.*)?$/, ''); }
function isBlockedImage(url) { return url && BLOCKED_IMAGE_BASES.has(stripExt(url)); }

/** Parse the "Item Specifics (JSON)" column, which may be a JSON string of
 *  a flat object, an array of [name, value] pairs, or an array of {name, value}
 *  objects. Normalizes all formats to [[name, value], ...]. */
function parseItemSpecifics(jsonStr) {
  if (!jsonStr) return [];
  try {
    const obj = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    if (Array.isArray(obj)) {
      // Already [[name, value], ...] or [{name,value}]
      return obj.map(e => Array.isArray(e) ? e : [e.name, e.value]);
    }
    return Object.entries(obj);
  } catch {
    return [];
  }
}

function transformRow(row, config = {}) {
  const brand = config.brand || 'JEGS';
  const specs = parseItemSpecifics(row['Item Specifics (JSON)']);

  return {
    'Part Number':         row['SKU'] || '',
    // Prefer explicit 'Part Type' if sideloaded (e.g. via sideload-part-types.js);
    // fall back to 'Category Hierarchy' which contains raw eBay breadcrumbs.
    'Part Type':           row['Part Type'] || row['Category Hierarchy'] || '',
    'Description':         row['Description'] || '',
    'Title':               (row['eBay Listing Title'] || row['Original Title'] || '').replace(/\{\{brand\}\}/gi, brand),
    'Attributes Small':    specs,
    'Attributes Full':     specs,
    'Features & Benefits': row['Features and Benefits'] || [],
    // Prefer curated Main Image; reject it if it's a known blocked/stock URL.
    // Fall back to extractFirstImage for runs that skip the image-selector dashboard,
    // then reject that too if it resolves to a blocked URL.
    'Images':              (isBlockedImage(row['Main Image']) ? '' : (row['Main Image'] || '')) ||
                           (isBlockedImage(extractFirstImage(row['Images (pipe-separated)'])) ? '' : extractFirstImage(row['Images (pipe-separated)'])) || '',
    'Brand':               brand,
    'Fitment':             row['Fitment / Compatibility'] || '',
  };
}

module.exports = async function jegsExportNormalize(rows, config = {}) {
  const results = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      results.push(transformRow(rows[i], config));
    } catch (e) {
      console.error(`  ✗ Row ${i + 1} (${rows[i]?.['SKU'] || '?'}): ${e.message}`);
    }
  }
  return results;
};

module.exports.transformRow         = transformRow;
module.exports.parseItemSpecifics   = parseItemSpecifics;
