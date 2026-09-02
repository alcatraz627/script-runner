/**
 * transforms/cc30-download-posters.js — Poster download for cc30-enhanced data format
 *
 * Wraps the shared poster-downloader engine with a custom buildPayload
 * that maps cc30 field names/shapes to the poster API's expected format.
 *
 * Config:
 *   {
 *     apiUrl: 'http://localhost:3006/lab/ebay-poster/image/',
 *     concurrency: 5,
 *     maxConcurrency: 10,
 *     maxRetries: 3,
 *     timeout: 30000,
 *     filter: '_is_newer',   // optional: only process rows where row[filter] is truthy
 *     outputDir: 'posters_diff',  // optional: override output subfolder (default: 'posters')
 *   }
 *
 * Input:  cc30-enhanced rows (Image, final_attributes: [{key,value}], FAB as string)
 * Output: same rows with added `posterPath` field
 */

const fs   = require('fs');
const path = require('path');
const { downloadAll, sanitize } = require('../pipeline/poster-downloader');

/**
 * Build poster API payload from cc30-enhanced data shape.
 */
function buildCc30Payload(item) {
  let showcaseImage = item.Image || '';
  if (showcaseImage.endsWith('.webp')) showcaseImage = showcaseImage.replace(/\.webp$/i, '.png');

  // final_attributes: [{key, value}, ...] → [[name, value], ...], capped at 5
  const attrs = (Array.isArray(item.final_attributes) ? item.final_attributes : [])
    .slice(0, 5)
    .map(a => [sanitize(a.key || a.Key), sanitize(String(a.value || a.Value || ''))]);

  // Features & Benefits: "- bullet1\n- bullet2\n..." → ["bullet1", "bullet2", ...]
  const fabStr = item['Features & Benefits'] || '';
  const fab = fabStr
    .split('\n')
    .map(line => line.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)
    .map(f => sanitize(f));

  return {
    font:          'Inter',
    bannerImage:   '/ebay-banner-assets/jegs-banner.png',
    showcaseImage,
    title:         sanitize(item.Title),
    partNumber:    item['Part Number'],
    scaleFactor:   3,
    partType:      sanitize(item['Part Type']),
    brand:         sanitize(item.Brand),
    description:   sanitize(item.Description),
    attributes:    attrs,
    fab,
  };
}

async function cc30DownloadPosters(rows, config = {}, context = {}) {
  const runDir = context.runDir;
  if (!runDir) throw new Error('cc30-download-posters requires runDir in context');

  // ── Optional row filter (e.g. only process rows marked _is_newer) ──────────
  let rowsToProcess = rows;
  if (config.filter) {
    rowsToProcess = rows.filter(r => r[config.filter]);
    if (context.onEvent) {
      context.onEvent({
        type: 'info',
        message: `Filter '${config.filter}': ${rowsToProcess.length}/${rows.length} rows selected for poster generation`,
      });
    }
  }

  // ── Output directory: config.outputDir > config.outputFilename > 'posters' ─
  const outputDir = config.outputDir
    ? path.resolve(runDir, config.outputDir)
    : config.outputFilename
      ? path.resolve(runDir, config.outputFilename)
      : path.join(runDir, 'posters');

  // Rotate existing output directory
  if (fs.existsSync(outputDir)) {
    const lastDir = outputDir + '_last';
    if (fs.existsSync(lastDir)) fs.rmSync(lastDir, { recursive: true });
    fs.renameSync(outputDir, lastDir);
    if (context.onEvent) {
      context.onEvent({ type: 'step-progress', message: `Rotated ${path.basename(outputDir)}/ → ${path.basename(lastDir)}/` });
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const concurrency = config.concurrency || 5;

  const { results, failures, summary } = await downloadAll(rowsToProcess, {
    concurrency,
    maxConcurrency: config.maxConcurrency || concurrency * 2,
    maxRetries:     config.maxRetries ?? 3,
    timeout:        config.timeout || 30000,
    outputDir,
    apiUrl:       config.apiUrl || 'http://localhost:3006/lab/ebay-poster/image/',
    buildPayload: buildCc30Payload,
    onProgress({ current, total, success, failed, retrying, concurrency: c, lastItem }) {
      if (context.onEvent) {
        let msg = `[${current}/${total}] ✓ ${success} done`;
        if (failed > 0) msg += `  ✗ ${failed} failed`;
        if (retrying > 0) msg += `  ↻ ${retrying} retrying`;
        if (lastItem) {
          const sizeKB = lastItem.size ? `${(lastItem.size / 1024).toFixed(0)}KB` : '';
          const dur = lastItem.durationMs ? `${(lastItem.durationMs / 1000).toFixed(1)}s` : '';
          const retryNote = lastItem.attempt > 0 ? ` (retry ${lastItem.attempt})` : '';
          msg += `  │ ${lastItem.partNumber}.png ${sizeKB} ${dur}${retryNote}`;
        }
        context.onEvent({
          type: 'step-progress',
          message: msg.trim(),
          progress: { current, total, success, failed },
        });
      }
    },
    onEvent: context.onEvent || null,
  });

  // Build a map of processed results by Part Number
  const processedMap = new Map(
    results.map(r => [r['Part Number'], r])
  );

  // Return ALL original rows, merging posterPath only for processed ones
  return rows.map(row => {
    const processed = processedMap.get(row['Part Number']);
    if (processed && processed.posterPath) {
      return { ...row, posterPath: path.relative(runDir, path.join(outputDir, '..', processed.posterPath)) };
    }
    return row;
  });
}

module.exports = cc30DownloadPosters;
