/**
 * transforms/cc30-sideload-part-types.js
 *
 * Applies manual overrides and product patches from JSON sideload files:
 * - Part Type overrides: fills in Part Type when empty
 * - Image overrides: fills in Image when empty (e.g. sourced from older runs)
 * - Product patches: fills empty original_title, fit_type, appends extra attributes
 * - fit_type promotion: adds fit_type as "Part Fitment" in final_attributes
 *
 * All sideload files live in the run directory and survive pipeline re-runs.
 *
 * @description Apply sideload overrides: Part Type, Image, product patches, fit_type→final_attributes
 * @config {{ file, patchFile, imageFile }} sideload JSON paths (relative to run dir or absolute)
 * @inputOutput Reads Part Number; writes Part Type, Image, original_title, fit_type, raw_attributes, final_attributes
 */

const fs = require('fs');
const path = require('path');

function resolveFile(file, runDir) {
  return path.isAbsolute(file) ? file : path.resolve(runDir, file);
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

module.exports = async function sideloadPartTypes(rows, config = {}, { runDir, onEvent } = {}) {
  const pnField = config.pnField || 'Part Number';

  // ── Load sideload files ────────────────────────────────────────────────────
  const overridesPath = resolveFile(config.file || 'part-type-overrides.json', runDir);
  const overridesData = loadJson(overridesPath);
  if (!overridesData) throw new Error(`Sideload file not found: ${overridesPath}`);
  const overrides = overridesData.overrides || {};

  const patchPath = resolveFile(config.patchFile || 'product-patches.json', runDir);
  const patchData = loadJson(patchPath);
  const patches = patchData ? (patchData.patches || {}) : {};

  const imagePath = resolveFile(config.imageFile || 'image-overrides.json', runDir);
  const imageData = loadJson(imagePath);
  const imageOverrides = imageData ? (imageData.overrides || {}) : {};

  // ── Counters ───────────────────────────────────────────────────────────────
  let ptApplied = 0, ptSkippedEmpty = 0, ptSkippedExisting = 0;
  let imgApplied = 0, imgSkippedExisting = 0;
  let patchApplied = 0;
  let fitPromoted = 0;

  const result = rows.map(row => {
    const pn = String(row[pnField] || '').trim();
    let updated = { ...row };

    // ── Part Type override ─────────────────────────────────────────────────
    const override = overrides[pn];
    if (override) {
      const currentPT = (row['Part Type'] || '').trim();
      if (currentPT) {
        ptSkippedExisting++;
      } else {
        const newPT = (override.partType || '').trim();
        if (!newPT) {
          ptSkippedEmpty++;
        } else {
          updated['Part Type'] = newPT;
          ptApplied++;
        }
      }
    }

    // ── Image override ─────────────────────────────────────────────────────
    const imgEntry = imageOverrides[pn];
    if (imgEntry) {
      if ((row['Image'] || '').trim()) {
        imgSkippedExisting++;
      } else {
        updated['Image'] = imgEntry.image;
        imgApplied++;
      }
    }

    // ── Product patch ──────────────────────────────────────────────────────
    const patch = patches[pn];
    if (patch) {
      let patched = false;

      if (patch.original_title && !(row.original_title || '').trim()) {
        updated.original_title = patch.original_title;
        patched = true;
      }

      if (patch.fit_type && !(row.fit_type || '').trim()) {
        updated.fit_type = patch.fit_type;
        patched = true;
      }

      if (patch.extra_raw_attributes && patch.extra_raw_attributes.length > 0) {
        const existing = new Set((row.raw_attributes || []).map(a => a.key));
        const newAttrs = patch.extra_raw_attributes.filter(a => !existing.has(a.key));
        if (newAttrs.length > 0) {
          updated.raw_attributes = [...(row.raw_attributes || []), ...newAttrs];
          patched = true;
        }
      }

      if (patch.extra_final_attributes && patch.extra_final_attributes.length > 0) {
        const existing = new Set((row.final_attributes || []).map(a => a.key));
        const newAttrs = patch.extra_final_attributes.filter(a => !existing.has(a.key));
        if (newAttrs.length > 0) {
          updated.final_attributes = [...(row.final_attributes || []), ...newAttrs];
          patched = true;
        }
      }

      if (patched) patchApplied++;
    }

    // ── Promote fit_type → final_attributes as "Part Fitment" ──────────────
    const fitType = (updated.fit_type || '').trim();
    if (fitType) {
      const finalAttrs = updated.final_attributes || [];
      const hasFitment = finalAttrs.some(a => a.key === 'Part Fitment');
      if (!hasFitment) {
        updated.final_attributes = [...finalAttrs, { key: 'Part Fitment', value: fitType }];
        fitPromoted++;
      }
    }

    return updated;
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  const dataPNs = new Set(rows.map(r => String(r[pnField] || '').trim()));
  let ptNotFound = 0;
  for (const pn of Object.keys(overrides)) {
    if (!dataPNs.has(pn)) ptNotFound++;
  }

  const parts = [
    `Part Type: ${ptApplied} applied, ${ptSkippedEmpty} empty, ${ptSkippedExisting} existing, ${ptNotFound} not in data`,
  ];
  if (Object.keys(imageOverrides).length > 0) {
    parts.push(`Image: ${imgApplied} applied, ${imgSkippedExisting} existing`);
  }
  if (Object.keys(patches).length > 0) {
    parts.push(`Patches: ${patchApplied} products`);
  }
  parts.push(`fit_type→final_attributes: ${fitPromoted} promoted`);

  onEvent && onEvent({ type: 'info', message: parts.join(' | ') });

  return result;
};
