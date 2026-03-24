/**
 * pipeline/poster-downloader.js — Shared parallel download engine for poster generation
 *
 * Provides concurrent downloads with adaptive throttling and retry logic.
 * Used by both `pipeline/download-posters.js` (standalone) and
 * `transforms/download-posters.js` (pipeline transform).
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
 * Build the API payload for a single item.
 * @param {Object} item - Normalized product row
 * @param {string} attrsMode - 'Full' or 'Small'
 */
function buildPayload(item, attrsMode) {
  let showcaseImage = item.Images || '';
  if (showcaseImage.endsWith('.webp')) showcaseImage = showcaseImage.replace(/\.webp$/i, '.png');
  if (showcaseImage === '...') showcaseImage = '';

  return {
    font:          'Inter',
    bannerImage:   '/ebay-banner-assets/jegs-banner.png',
    showcaseImage,
    title:         sanitize(item['Title']),
    partNumber:    item['Part Number'],
    scaleFactor:   3,
    partType:      sanitize(item['Part Type']),
    brand:         sanitize(item['Brand']),
    description:   sanitize(item['Description']),
    // Cap at 5 attrs — poster template has limited space; slice before sanitize to avoid wasted work.
    attributes:    (item[`Attributes ${attrsMode}`] || []).slice(0, 5).map(([n, v]) => [sanitize(n), sanitize(v)]),
    fab:           (item['Features & Benefits'] || []).map(f => sanitize(f)),
  };
}

/**
 * Download a single poster image.
 * @returns {Promise<Buffer>} The image buffer
 */
async function downloadOne(item, { apiUrl, attrsMode, timeout, buildPayloadFn }) {
  const payload = buildPayloadFn
    ? buildPayloadFn(item)
    : buildPayload(item, attrsMode);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(apiUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'node-fetch' },
      body:    JSON.stringify(payload),
      signal:  controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

/**
 * Download all items with parallel concurrency, adaptive throttling, and retry.
 *
 * @param {Array<Object>} items - Product rows to download
 * @param {Object} opts
 * @param {number}   [opts.concurrency=5]       - Initial parallel limit
 * @param {number}   [opts.maxConcurrency]       - Upscale cap (default: concurrency * 2)
 * @param {number}   [opts.maxRetries=3]         - Per-item retry limit
 * @param {number}   [opts.timeout=30000]        - Per-request timeout ms
 * @param {string}   opts.outputDir              - Where to write PNGs
 * @param {string}   [opts.apiUrl]               - Poster API endpoint
 * @param {string}   [opts.attrsMode='Full']     - 'Full' or 'Small'
 * @param {function} [opts.buildPayload]         - Custom payload builder (item) => payload
 * @param {function} [opts.onProgress]           - Progress callback
 * @param {function} [opts.onEvent]              - Pipeline event emitter
 * @returns {Promise<{results: Array, failures: Object}>}
 */
async function downloadAll(items, opts = {}) {
  const concurrency    = opts.concurrency || 5;
  const maxConcurrency = opts.maxConcurrency || concurrency * 2;
  const maxRetries     = opts.maxRetries ?? 3;
  const timeout        = opts.timeout || 30000;
  const outputDir      = opts.outputDir;
  const apiUrl         = opts.apiUrl || 'http://localhost:3006/lab/ebay-poster/image/';
  const attrsMode      = opts.attrsMode || 'Full';
  const buildPayloadFn = opts.buildPayload || null;
  const onProgress     = opts.onProgress || (() => {});
  const onEvent        = opts.onEvent || null;

  // Adaptive throttling state
  let currentConcurrency   = concurrency;
  let consecutiveFailures  = 0;
  let consecutiveSuccesses = 0;

  // Results tracking
  let successCount = 0;
  let failedCount  = 0;
  let retryingCount = 0;
  const total      = items.length;
  const results    = new Array(items.length); // preserve order
  const retryQueue = []; // { item, index, attempt }
  const failureDetails = {}; // partNumber -> { error, attempts, lastAttempt }

  let lastItemInfo = null;

  function emitProgress() {
    onProgress({
      current: successCount + failedCount + retryingCount,
      total,
      success: successCount,
      failed: failedCount,
      retrying: retryQueue.length,
      concurrency: currentConcurrency,
      lastItem: lastItemInfo,
    });
  }

  function adjustConcurrency(succeeded) {
    if (succeeded) {
      consecutiveFailures = 0;
      consecutiveSuccesses++;
      // Scale up after 10 consecutive successes if we previously scaled down
      if (consecutiveSuccesses >= 10 && currentConcurrency < maxConcurrency) {
        currentConcurrency = Math.min(currentConcurrency * 2, maxConcurrency);
        consecutiveSuccesses = 0;
        if (onEvent) {
          onEvent({ type: 'step-progress', message: `Concurrency scaled up to ${currentConcurrency}` });
        }
      }
    } else {
      consecutiveSuccesses = 0;
      consecutiveFailures++;
      // Scale down after 3 consecutive failures
      if (consecutiveFailures >= 3) {
        currentConcurrency = Math.max(Math.floor(currentConcurrency / 2), 1);
        consecutiveFailures = 0;
        if (onEvent) {
          onEvent({ type: 'step-progress', message: `Concurrency scaled down to ${currentConcurrency}` });
        }
      }
    }
  }

  /**
   * Process a single item — download and write to disk.
   * @returns {Object} The result row (item + posterPath or posterError)
   */
  async function processItem(item, index, attempt = 0) {
    const pn = item['Part Number'];
    const prefix = attempt > 0 ? `[RETRY ${attempt}/${maxRetries}] ` : '';

    try {
      const t0 = Date.now();
      const buf = await downloadOne(item, { apiUrl, attrsMode, timeout, buildPayloadFn });
      const outFile = path.join(outputDir, `${pn}.png`);
      fs.writeFileSync(outFile, buf);

      successCount++;
      adjustConcurrency(true);
      lastItemInfo = { partNumber: pn, size: buf.length, durationMs: Date.now() - t0, attempt };
      emitProgress();

      return { ...item, posterPath: path.relative(outputDir + '/..', outFile), posterSize: buf.length };
    } catch (err) {
      adjustConcurrency(false);

      if (attempt < maxRetries) {
        retryQueue.push({ item, index, attempt: attempt + 1 });
        retryingCount++;
        lastItemInfo = { partNumber: pn, size: null, durationMs: null, attempt, error: err.message };
        emitProgress();
        return null; // will be filled by retry
      }

      // Final failure
      failedCount++;
      failureDetails[pn] = {
        error: err.message || String(err),
        attempts: attempt + 1,
        lastAttempt: new Date().toISOString(),
      };
      lastItemInfo = { partNumber: pn, size: null, durationMs: null, attempt, error: err.message };
      emitProgress();

      return { ...item, posterPath: null, posterError: err.message };
    }
  }

  /**
   * Semaphore-based concurrent queue processor.
   * Respects currentConcurrency which may change mid-run.
   */
  async function runQueue(tasks) {
    let active = 0;
    let taskIndex = 0;
    const taskResults = new Array(tasks.length);

    return new Promise((resolve) => {
      function tryDispatch() {
        while (active < currentConcurrency && taskIndex < tasks.length) {
          const idx = taskIndex++;
          const task = tasks[idx];
          active++;

          task().then((result) => {
            taskResults[idx] = result;
            active--;
            tryDispatch();
          });
        }
        if (active === 0 && taskIndex >= tasks.length) {
          resolve(taskResults);
        }
      }
      tryDispatch();
    });
  }

  // === Main pass ===
  const mainTasks = items.map((item, i) => () => processItem(item, i, 0));
  const mainResults = await runQueue(mainTasks);

  // Fill results from main pass
  for (let i = 0; i < mainResults.length; i++) {
    if (mainResults[i]) results[i] = mainResults[i];
  }

  // === Retry passes ===
  while (retryQueue.length > 0) {
    const batch = retryQueue.splice(0);
    retryingCount -= batch.length;

    if (onEvent) {
      onEvent({ type: 'step-progress', message: `Retrying ${batch.length} failed items...` });
    }

    const retryTasks = batch.map(({ item, index, attempt }) =>
      () => processItem(item, index, attempt)
    );
    const retryResults = await runQueue(retryTasks);

    // Fill results from retry pass
    for (let j = 0; j < batch.length; j++) {
      if (retryResults[j]) {
        results[batch[j].index] = retryResults[j];
      }
    }
  }

  // Build failures summary
  const failedParts = Object.keys(failureDetails);
  const failures = failedParts.length > 0
    ? { failed: failedParts, details: failureDetails }
    : null;

  return { results: results.filter(Boolean), failures, summary: { success: successCount, failed: failedCount, total } };
}

module.exports = { downloadAll, buildPayload, sanitize };
