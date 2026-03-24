/**
 * transforms/download-posters.js — First-class pipeline transform for poster downloads
 *
 * Config:
 *   {
 *     apiUrl: 'http://localhost:3006/lab/ebay-poster/image/',
 *     attrsMode: 'Full',
 *     concurrency: 5,
 *     maxConcurrency: 10,
 *     maxRetries: 3
 *   }
 *
 * Input: array of normalized product rows
 * Output: same rows with added `posterPath` field (relative path to PNG)
 */

const fs   = require('fs');
const path = require('path');
const { downloadAll } = require('../pipeline/poster-downloader');

/**
 * @param {Array<Object>} rows - Normalized product rows
 * @param {Object} config - Transform config
 * @param {string} [config.apiUrl] - Poster API base URL
 * @param {string} [config.attrsMode] - 'Full' or 'Small'
 * @param {number} [config.concurrency=5] - Parallel download count
 * @param {number} [config.maxConcurrency] - Upscale cap (default: concurrency × 2)
 * @param {number} [config.maxRetries=3] - Retry limit per item
 * @param {Object} context - Engine context
 * @param {string} context.runDir - Absolute path to run directory
 * @param {function} [context.onEvent] - Event callback for progress
 */
async function downloadPosters(rows, config = {}, context = {}) {
  const runDir = context.runDir;

  if (!runDir) {
    throw new Error('download-posters transform requires runDir in context');
  }

  const outputDir = config.outputFilename
    ? path.resolve(runDir, config.outputFilename)
    : path.join(runDir, 'posters');

  // Rotate existing output directory: posters -> posters_last
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

  const concurrency = config.concurrency || 5;

  const { results, failures, summary } = await downloadAll(rows, {
    concurrency,
    maxConcurrency: config.maxConcurrency || concurrency * 2,
    maxRetries:     config.maxRetries ?? 3,
    timeout:        config.timeout || 30000,
    outputDir,
    apiUrl:    config.apiUrl || 'http://localhost:3006/lab/ebay-poster/image/',
    attrsMode: config.attrsMode || 'Full',
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

  // Map results back: adjust posterPath to be relative to runDir
  return results.map(r => {
    if (r.posterPath) {
      return { ...r, posterPath: path.relative(runDir, path.join(outputDir, '..', r.posterPath)) };
    }
    return r;
  });
}

module.exports = downloadPosters;
