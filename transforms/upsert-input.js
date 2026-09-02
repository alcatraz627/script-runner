/**
 * transforms/upsert-input.js
 *
 * Merges a secondary Excel file into the primary input stream by SKU.
 *
 * For each row in the stream:
 *   - If the upsert file has a matching SKU, product columns from the upsert
 *     file overwrite the original (new file wins on conflicts).
 * Any SKUs in the upsert file not present in the original are appended.
 *
 * Config:
 *   file        {string}   Path to the upsert .xlsx file (relative to run dir, or absolute)
 *   skuField    {string}   Column name for SKU key — default: "SKU"
 *   sheet       {string}   Sheet name to read — default: first sheet
 *
 * Columns carried over from upsert file (product data only — metadata skipped):
 *   SKU, eBay Listing Title, eBay Item URL, Images (pipe-separated),
 *   Image Count, Category Hierarchy, Description,
 *   Fitment / Compatibility, Item Specifics (JSON)
 *
 * Columns intentionally dropped from upsert file (validation metadata):
 *   Source Product URL, Reference Title, Search Strategy, Validation Status,
 *   Matched SKU, Matched Fields, Validation Notes, Seller
 */

const path = require('path');
const XLSX  = require('xlsx');

const PRODUCT_COLUMNS = new Set([
  'SKU',
  'eBay Listing Title',
  'eBay Item URL',
  'Images (pipe-separated)',
  'Image Count',
  'Category Hierarchy',
  'Description',
  'Fitment / Compatibility',
  'Item Specifics (JSON)',
]);

/**
 * Read an xlsx file and return rows as plain objects.
 * Uses the first sheet unless config.sheet is specified.
 */
function readXlsx(filePath, sheetName) {
  const wb = XLSX.readFile(filePath);
  const name = sheetName || wb.SheetNames[0];
  const ws   = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found in ${filePath}`);
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

module.exports = async function upsertInput(rows, config = {}, { runDir, onEvent } = {}) {
  const skuField = config.skuField || 'SKU';

  if (!config.file) throw new Error('upsert-input: config.file is required');

  const filePath = path.isAbsolute(config.file)
    ? config.file
    : path.resolve(runDir, config.file);

  onEvent && onEvent({ type: 'info', message: `Reading upsert file: ${filePath}` });

  const upsertRows = readXlsx(filePath, config.sheet);

  // Build SKU → product-columns-only object from upsert file
  const upsertBySku = new Map();
  for (const row of upsertRows) {
    const sku = String(row[skuField] || '').trim();
    if (!sku) continue;
    const patch = {};
    for (const col of PRODUCT_COLUMNS) {
      if (col in row) patch[col] = row[col];
    }
    upsertBySku.set(sku, patch);
  }

  onEvent && onEvent({ type: 'info', message: `Upsert file: ${upsertBySku.size} SKUs loaded` });

  // Merge upsert data into existing rows (upsert wins on overlap)
  const seenSkus = new Set();
  const merged = rows.map(row => {
    const sku = String(row[skuField] || '').trim();
    seenSkus.add(sku);
    const patch = upsertBySku.get(sku);
    return patch ? { ...row, ...patch } : row;
  });

  // Append SKUs from upsert file not present in original
  let appended = 0;
  for (const [sku, patch] of upsertBySku) {
    if (!seenSkus.has(sku)) {
      merged.push(patch);
      appended++;
    }
  }

  const updated = merged.length - rows.length - appended;
  onEvent && onEvent({
    type: 'info',
    message: `Upsert complete — ${upsertBySku.size} in upsert file, `
      + `${merged.length - appended} original rows (${rows.length - (rows.length - upsertBySku.size + appended)} updated), `
      + `${appended} new SKUs appended. Total: ${merged.length} rows`,
  });

  return merged;
};
