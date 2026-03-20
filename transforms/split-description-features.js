/**
 * transforms/split-description-features.js
 *
 * Splits a combined Description column (description + "\n\nFeatures:\n" + numbered list)
 * into separate "Description" and "Features and Benefits" fields.
 *
 * Input format (in Description column):
 *   "Some description text\n\nFeatures:\n1. Feature one\n2. Feature two"
 *
 * Output: same row with Description trimmed and "Features and Benefits" as string[].
 */

/** Split a combined description string at the "Features:" boundary.
 *  Returns { description, features[] } where features are the numbered
 *  list items with leading numbers stripped. */
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

module.exports = async function splitDescriptionFeatures(rows, _config = {}) {
  return rows.map(row => {
    const { description, features } = splitDesc(row.Description);
    const out = {
      ...row,
      Description: description,
    };
    // Only overwrite Features and Benefits if the split actually extracted features;
    // otherwise preserve whatever was already in the row (e.g. from the Excel import).
    if (features.length > 0) {
      out['Features and Benefits'] = features;
    }
    return out;
  });
};

module.exports.splitDesc = splitDesc;
