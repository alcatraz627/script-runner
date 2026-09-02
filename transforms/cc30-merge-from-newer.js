/**
 * transforms/cc30-merge-from-newer.js
 *
 * Enriches the base 556-product cc30 dataset with data from a newer cc30 Excel
 * extraction covering a subset of those products (e.g. the 140 no-image items).
 *
 * Merge rules (per overlapping product):
 *   - Image:          newer wins if newer has a non-empty image
 *   - original_title: OLD wins — user intent is to keep original titles
 *   - raw_attributes: UNION — newer keys take priority; old-only keys appended
 *   - final_attributes: UNION — same strategy
 *   - fit_type:        newer wins if non-empty, else keep old
 *   - Part Type:       old wins if already set; newer fills only if old is empty
 *
 * Marks merged products with `_is_newer: true` (used by highlight + poster steps).
 *
 * @config {string}  newerFile   Path to the newer cc30 Excel file (absolute or relative to CWD)
 * @config {string}  [sheet]     Sheet name in the newer file (default: 'Extracted Rows')
 * @config {Object}  [groupConfig] Override grouping config if newer file uses different column names
 */

'use strict';

const path = require('path');
const XLSX = require('xlsx');

// cc30 pipeline step functions — called inline to process the newer file
const cc30Group  = require('./cc30-group-attributes');
const cc30Extract = require('./cc30-extract-columns');
const cc30Filter  = require('./cc30-filter-attributes');

const DEFAULT_GROUP_CONFIG = {
  columnMap: { productbrand: 'Brand', mpn: 'Part Number', site: 'brand_site' },
  discardColumns: ['confidence', 'match_mode', 'page_type', 'status'],
  groupBy: 'Input Row',
};

module.exports = async function cc30MergeFromNewer(rows, config = {}, context = {}) {
  const emit = context.onEvent || (() => {});

  // ── 1. Load and pipeline-process the newer file ───────────────────────────

  const newerFilePath = config.newerFile
    ? path.resolve(config.newerFile)
    : null;

  if (!newerFilePath) throw new Error('cc30-merge-from-newer: config.newerFile is required');

  const sheetName = config.sheet || 'Extracted Rows';
  emit({ type: 'info', message: `Loading newer file: ${path.basename(newerFilePath)}` });

  const wb = XLSX.readFile(newerFilePath);
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found in newer file`);

  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  emit({ type: 'info', message: `  ${rawRows.length} flat rows loaded` });

  const groupCfg = config.groupConfig || DEFAULT_GROUP_CONFIG;
  const grouped   = await cc30Group(rawRows, groupCfg);
  const extracted = await cc30Extract(grouped, {}, {});
  const filtered  = await cc30Filter(extracted, {}, {});

  emit({ type: 'info', message: `  Newer file processed: ${filtered.length} products` });

  // ── 2. Build Part Number → newer product lookup ───────────────────────────

  const newerMap = new Map(filtered.map(p => [String(p['Part Number'] || '').trim(), p]));

  // ── 3. Merge into base rows ───────────────────────────────────────────────

  let merged = 0, imageUpdated = 0, attrsMerged = 0, titleKept = 0;

  const result = rows.map(row => {
    const pn = String(row['Part Number'] || '').trim();
    const newer = newerMap.get(pn);
    if (!newer) return row;  // no newer data for this product — pass through unchanged

    merged++;
    const out = { ...row };

    // ── Image: newer wins if non-empty ──────────────────────────────────────
    const newerImage = (newer.Image || '').trim();
    if (newerImage) {
      out.Image = newerImage;
      imageUpdated++;
    }

    // ── original_title: KEEP OLD — newer is intentionally ignored ───────────
    // If old is empty, fall back to newer (best-effort)
    if (!(row.original_title || '').trim() && (newer.original_title || '').trim()) {
      out.original_title = newer.original_title;
    } else if ((row.original_title || '').trim()) {
      titleKept++;
    }

    // ── Part Type: old wins if set; newer fills gaps only ───────────────────
    if (!(row['Part Type'] || '').trim() && (newer['Part Type'] || '').trim()) {
      out['Part Type'] = newer['Part Type'];
    }

    // ── fit_type: newer wins if non-empty ───────────────────────────────────
    if ((newer.fit_type || '').trim()) {
      out.fit_type = newer.fit_type;
    }

    // ── raw_attributes: union ────────────────────────────────────────────────
    const newerRawKeys = new Set((newer.raw_attributes || []).map(a => String(a.key || '')));
    const oldOnlyRaw   = (row.raw_attributes || []).filter(a => !newerRawKeys.has(String(a.key || '')));
    out.raw_attributes = [
      ...(newer.raw_attributes || []),
      ...oldOnlyRaw,
    ];

    // ── final_attributes: union ───────────────────────────────────────────────
    const newerFinalKeys = new Set((newer.final_attributes || []).map(a => String(a.key || '')));
    const oldOnlyFinal   = (row.final_attributes || []).filter(a => !newerFinalKeys.has(String(a.key || '')));
    out.final_attributes = [
      ...(newer.final_attributes || []),
      ...oldOnlyFinal,
    ];

    if (oldOnlyRaw.length > 0 || oldOnlyFinal.length > 0) attrsMerged++;

    // ── Mark as enriched ─────────────────────────────────────────────────────
    out._is_newer = true;

    return out;
  });

  emit({
    type: 'info',
    message: [
      `Merge complete: ${merged} products enriched from newer file`,
      `  Image updated: ${imageUpdated}`,
      `  Titles kept from old: ${titleKept}`,
      `  Attribute unions (preserved old-only keys): ${attrsMerged}`,
      `  Untouched (not in newer file): ${rows.length - merged}`,
    ].join('\n'),
  });

  return result;
};
