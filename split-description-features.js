/**
 * One-off script: Split the combined Description column into
 * separate "Description" and "Features and Benefits" columns.
 *
 * Usage: node split-description-features.js
 */
const path = require('path');
const io = require('./pipeline/io');

const INPUT = './runs/jegs-ebay-mar-20-02/raw/JEGS_eBay_Mar19_export.xlsx';
const SHEET = 'JEGS eBay Mar 15';
const OUTPUT = './runs/jegs-ebay-mar-20-02/raw/JEGS_eBay_Mar19_export_split.json';

function splitDesc(desc) {
  if (!desc) return { description: '', features: [] };
  const match = desc.match(/^([\s\S]*?)\n\nFeatures:\n([\s\S]*)$/);
  if (!match) return { description: desc.trim(), features: [] };
  return {
    description: match[1].trim(),
    features: match[2]
      .split(/\n/)
      .map(l => l.replace(/^\d+\.\s*/, '').trim())
      .filter(l => l.length > 0),
  };
}

const rows = io.readFile(path.resolve(INPUT), { sheet: SHEET });
console.log(`Read ${rows.length} rows from ${INPUT}`);

const result = rows.map(row => {
  const { description, features } = splitDesc(row.Description);
  return {
    ...row,
    Description: description,
    'Features and Benefits': features,
  };
});

io.writeFile(result, path.resolve(OUTPUT));
console.log(`Written ${result.length} rows to ${OUTPUT}`);
console.log(`Sample features count: ${result[0]['Features and Benefits'].length}`);
