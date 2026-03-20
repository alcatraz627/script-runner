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
    'Part Type':           row['Category Hierarchy'] || '',
    'Description':         row['Description'] || '',
    'Title':               (row['eBay Listing Title'] || row['Original Title'] || '').replace(/\{\{brand\}\}/gi, brand),
    'Attributes Small':    specs,
    'Attributes Full':     specs,
    'Features & Benefits': row['Features and Benefits'] || [],
    'Images':              row['Main Image'] || extractFirstImage(row['Images (pipe-separated)']) || '',
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
