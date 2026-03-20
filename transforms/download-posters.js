/**
 * transforms/download-posters.js — First-class pipeline transform for poster downloads
 *
 * Config:
 *   { apiUrl: 'http://localhost:3006/lab/ebay-poster/image/', attrsMode: 'Full' }
 *
 * Input: array of normalized product rows
 * Output: same rows with added `posterPath` field (relative path to PNG)
 */

const fs   = require('fs');
const path = require('path');

/** Strip control characters and invisible Unicode that can corrupt image text rendering. */
function sanitize(text) {
  if (!text) return text;
  return text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[\u2000-\u200D\u2028-\u202F]/g, ' ')
    .replace(/[\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {Array<Object>} rows - Normalized product rows
 * @param {Object} config - Transform config
 * @param {string} [config.apiUrl] - Poster API base URL
 * @param {string} [config.attrsMode] - 'Full' or 'Small'
 * @param {Object} context - Engine context
 * @param {string} context.runDir - Absolute path to run directory
 * @param {function} [context.onEvent] - Event callback for progress
 */
async function downloadPosters(rows, config = {}, context = {}) {
  const apiUrl    = config.apiUrl || 'http://localhost:3006/lab/ebay-poster/image/';
  const attrsMode = config.attrsMode || 'Full';
  const runDir    = context.runDir;

  if (!runDir) {
    throw new Error('download-posters transform requires runDir in context');
  }

  const outputDir = config.outputFilename
    ? path.resolve(runDir, config.outputFilename)
    : path.join(runDir, 'posters');

  // Rotate existing output directory: posters -> posters_last
  // This preserves the previous run's images as a backup for comparison
  if (fs.existsSync(outputDir)) {
    const lastDir = outputDir + '_last';
    if (fs.existsSync(lastDir)) {
      fs.rmSync(lastDir, { recursive: true });
    }
    fs.renameSync(outputDir, lastDir);
    if (context.onEvent) {
      context.onEvent({ type: 'step-progress', message: `Rotated existing ${path.basename(outputDir)}/ to ${path.basename(lastDir)}/` });
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });
  if (context.onEvent) {
    context.onEvent({ type: 'step-progress', message: `Created ${path.basename(outputDir)}/` });
  }

  const results = [];
  let success = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    const pn = item['Part Number'];

    try {
      let showcaseImage = item.Images || '';
      if (showcaseImage.endsWith('.webp')) showcaseImage = showcaseImage.replace(/\.webp$/i, '.png');
      if (showcaseImage === '...') showcaseImage = '';

      const payload = {
        font:          'Inter',
        bannerImage:   '/ebay-banner-assets/jegs-banner.png',
        showcaseImage,
        title:         sanitize(item['Title']),
        partNumber:    pn,
        scaleFactor:   3,
        partType:      sanitize(item['Part Type']),
        brand:         sanitize(item['Brand']),
        description:   sanitize(item['Description']),
        attributes:    (item[`Attributes ${attrsMode}`] || []).map(([n, v]) => [sanitize(n), sanitize(v)]),
        fab:           (item['Features & Benefits'] || []).map(f => sanitize(f)),
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(apiUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'node-fetch' },
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const buf = Buffer.from(await response.arrayBuffer());
      const outFile = path.join(outputDir, `${pn}.png`);
      fs.writeFileSync(outFile, buf);

      const posterPath = path.relative(runDir, outFile);
      results.push({ ...item, posterPath });
      success++;

      if (context.onEvent) {
        context.onEvent({
          type: 'step-progress',
          message: `[${i + 1}/${rows.length}] Downloaded poster for ${pn} (${(buf.length / 1024).toFixed(1)}KB)`,
          progress: { current: i + 1, total: rows.length, success, failed },
        });
      }
    } catch (err) {
      failed++;
      results.push({ ...item, posterPath: null, posterError: err.message });

      if (context.onEvent) {
        context.onEvent({
          type: 'step-progress',
          message: `[${i + 1}/${rows.length}] Failed poster for ${pn}: ${err.message}`,
          progress: { current: i + 1, total: rows.length, success, failed },
        });
      }
    }
  }

  return results;
}

module.exports = downloadPosters;
