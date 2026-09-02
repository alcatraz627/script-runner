/**
 * transforms/cc30-sideload-enhanced-content.js
 *
 * Injects LLM-generated content fields (Title, Description, Features & Benefits)
 * from an existing enhanced run's data file into the current pipeline rows.
 *
 * Use this when the current run is a raw cc30 pipeline (no enhance-content step)
 * but you need poster-ready content that already exists from a prior enhanced run.
 *
 * @config {string} sourceFile  Path to the enhanced run's JSON data file
 *                              (absolute, or relative to CWD)
 * @config {string[]} [fields]  Fields to copy (default: Title, Description, Features & Benefits)
 * @config {boolean} [overwrite] If true, overwrite existing non-empty values (default: false)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DEFAULT_FIELDS = ['Title', 'Description', 'Features & Benefits'];

module.exports = async function cc30SideloadEnhancedContent(rows, config = {}, context = {}) {
  const emit = context.onEvent || (() => {});

  if (!config.sourceFile) throw new Error('cc30-sideload-enhanced-content: config.sourceFile is required');

  const sourcePath = path.resolve(config.sourceFile);
  if (!fs.existsSync(sourcePath)) throw new Error(`Source file not found: ${sourcePath}`);

  const fields    = config.fields || DEFAULT_FIELDS;
  const overwrite = config.overwrite === true;

  emit({ type: 'info', message: `Loading enhanced content from: ${path.basename(sourcePath)}` });

  const sourceData = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const sourceMap  = new Map(sourceData.map(r => [String(r['Part Number'] || '').trim(), r]));

  emit({ type: 'info', message: `  ${sourceData.length} source rows, matching on Part Number` });

  let matched = 0, filled = 0, missing = 0;

  const result = rows.map(row => {
    const pn  = String(row['Part Number'] || '').trim();
    const src = sourceMap.get(pn);
    if (!src) { missing++; return row; }

    matched++;
    const out = { ...row };

    for (const field of fields) {
      const srcVal = src[field];
      const hasVal = srcVal != null && String(srcVal).trim().length > 0;
      const rowEmpty = row[field] == null || String(row[field] || '').trim().length === 0;

      if (hasVal && (rowEmpty || overwrite)) {
        out[field] = srcVal;
        filled++;
      }
    }

    return out;
  });

  emit({
    type: 'info',
    message: [
      `Enhanced content sideloaded: ${matched} rows matched`,
      `  Fields filled: ${filled}  (${fields.join(', ')})`,
      `  Unmatched (no source row): ${missing}`,
    ].join('\n'),
  });

  return result;
};
