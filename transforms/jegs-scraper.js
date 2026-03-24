/**
 * transforms/jegs-scraper.js — Agent-driven Puppeteer scraper for jegs.com
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OVERVIEW
 * ─────────────────────────────────────────────────────────────────────────────
 * This is a foundation scraper designed for AI-agent customization. It provides:
 *
 *   - Browser lifecycle management (launch, reuse, close)
 *   - Robust navigation with retry, timeout, and rate limiting
 *   - Extraction helpers for common patterns (text, attr, list, table)
 *   - Structured per-item error handling and progress reporting
 *   - Output merging: scraper results are merged onto existing rows
 *
 * HOW TO USE AS AN AGENT
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Implement `buildUrl(row)` to derive the JEGS product URL from a row.
 * 2. Implement `extractData(page, row)` to pull the fields you need.
 * 3. Adjust SCRAPER_CONFIG for rate limits, timeout, concurrency.
 * 4. Add this step to run.config.js:
 *      { "id": "scrape", "fn": "jegs-scraper", "name": "Scrape JEGS" }
 *
 * The transform reads rows, fetches each product page, calls extractData(),
 * and merges the result back onto the row. Failed rows pass through unchanged.
 *
 * STANDALONE USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 * The JegsScraper class can also be used directly (outside the pipeline):
 *
 *   const { JegsScraper } = require('./jegs-scraper');
 *   const scraper = new JegsScraper();
 *   await scraper.launch();
 *   const data = await scraper.scrapePage('https://www.jegs.com/i/JEGS/555/12345/-1');
 *   await scraper.close();
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const puppeteer = require('puppeteer');

// ── Configuration ─────────────────────────────────────────────────────────────

const SCRAPER_CONFIG = {
  // Base URL for JEGS product pages.
  // CUSTOMIZE: update if the URL pattern changes.
  baseUrl: 'https://www.jegs.com',

  // Milliseconds between requests to avoid rate-limiting.
  // Increase if you see 429s or CAPTCHAs.
  delayBetweenRequests: 1200,

  // Page navigation timeout in milliseconds.
  navigationTimeout: 20000,

  // Maximum retries per page before giving up.
  maxRetries: 2,

  // Puppeteer launch options. headless: false is useful for debugging.
  launchOptions: {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  },

  // User agent to send with requests.
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
};

// ── JegsScraper class ─────────────────────────────────────────────────────────

class JegsScraper {
  constructor(config = {}) {
    this.config  = { ...SCRAPER_CONFIG, ...config };
    this.browser = null;
    this.page    = null;
  }

  /**
   * Launch the browser. Call once before scraping.
   */
  async launch() {
    this.browser = await puppeteer.launch(this.config.launchOptions);
    this.page    = await this.browser.newPage();
    await this.page.setUserAgent(this.config.userAgent);
    await this.page.setViewport({ width: 1280, height: 900 });

    // Block images/fonts to speed up scraping. Remove if you need image URLs
    // that are only available via in-page rendering.
    await this.page.setRequestInterception(true);
    this.page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });
  }

  /**
   * Navigate to a URL with retry logic.
   *
   * @param {string} url
   * @param {Object} [opts]
   * @param {string} [opts.waitFor='domcontentloaded'] Puppeteer waitUntil value
   * @returns {Promise<void>}
   */
  async navigate(url, opts = {}) {
    const waitUntil = opts.waitFor || 'domcontentloaded';
    let lastError;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.page.goto(url, {
          waitUntil,
          timeout: this.config.navigationTimeout,
        });
        return;
      } catch (err) {
        lastError = err;
        if (attempt < this.config.maxRetries) {
          await this._sleep(1500 * (attempt + 1));
        }
      }
    }
    throw new Error(`Navigation failed after ${this.config.maxRetries + 1} attempts: ${lastError.message}`);
  }

  /**
   * Scrape a single product page. Returns whatever extractData() returns.
   * Use this for one-off scraping or testing selectors.
   *
   * @param {string} url
   * @param {Object} [row={}]  original row, passed through to extractData
   * @returns {Promise<Object>}
   */
  async scrapePage(url, row = {}) {
    await this.navigate(url);
    return this.extractData(this.page, row);
  }

  /**
   * Scrape a batch of URLs, merging results back onto source rows.
   *
   * @param {Array<{ url: string, row: Object }>} items
   * @param {function} [onProgress]  called with (done, total, lastItem)
   * @returns {Promise<Array<{ row: Object, scraped: Object, error: string|null }>>}
   */
  async scrapeAll(items, onProgress) {
    const results = [];

    for (let i = 0; i < items.length; i++) {
      const { url, row } = items[i];
      let scraped = null;
      let error   = null;

      try {
        scraped = await this.scrapePage(url, row);
      } catch (err) {
        error = err.message;
      }

      results.push({ row, scraped, error });

      if (onProgress) onProgress(i + 1, items.length, { url, error });

      // Rate limit between requests
      if (i < items.length - 1) {
        await this._sleep(this.config.delayBetweenRequests);
      }
    }

    return results;
  }

  /**
   * Close the browser.
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page    = null;
    }
  }

  // ── Extraction helpers ────────────────────────────────────────────────────
  // These are thin wrappers around page.$eval / page.$$eval that return
  // null on failure instead of throwing. Agents: use these in extractData().

  /**
   * Get text content of first matching element.
   * @param {string} selector  CSS selector
   * @returns {Promise<string|null>}
   */
  async getText(selector) {
    try {
      return await this.page.$eval(selector, el => el.textContent?.trim() || null);
    } catch { return null; }
  }

  /**
   * Get an attribute value from first matching element.
   * @param {string} selector
   * @param {string} attr       attribute name, e.g. 'src', 'href', 'data-sku'
   * @returns {Promise<string|null>}
   */
  async getAttr(selector, attr) {
    try {
      return await this.page.$eval(selector, (el, a) => el.getAttribute(a) || null, attr);
    } catch { return null; }
  }

  /**
   * Get text content of all matching elements as an array.
   * @param {string} selector
   * @returns {Promise<string[]>}
   */
  async getTextList(selector) {
    try {
      return await this.page.$$eval(selector, els =>
        els.map(el => el.textContent?.trim()).filter(Boolean)
      );
    } catch { return []; }
  }

  /**
   * Get an attribute from all matching elements.
   * @param {string} selector
   * @param {string} attr
   * @returns {Promise<string[]>}
   */
  async getAttrList(selector, attr) {
    try {
      return await this.page.$$eval(selector, (els, a) =>
        els.map(el => el.getAttribute(a)).filter(Boolean), attr
      );
    } catch { return []; }
  }

  /**
   * Scrape a definition-list or table of label→value pairs.
   * Returns { [label]: value }. Useful for spec tables.
   *
   * @param {string} rowSelector     selector for each row
   * @param {string} labelSelector   selector for label cell within each row
   * @param {string} valueSelector   selector for value cell within each row
   * @returns {Promise<Object>}
   */
  async getTable(rowSelector, labelSelector, valueSelector) {
    try {
      return await this.page.$$eval(
        rowSelector,
        (rows, lSel, vSel) => {
          const result = {};
          for (const row of rows) {
            const label = row.querySelector(lSel)?.textContent?.trim();
            const value = row.querySelector(vSel)?.textContent?.trim();
            if (label && value) result[label] = value;
          }
          return result;
        },
        labelSelector,
        valueSelector
      );
    } catch { return {}; }
  }

  /**
   * Wait for a selector to appear, then return its text. Useful for SPAs.
   * Returns null if the selector doesn't appear within the timeout.
   *
   * @param {string} selector
   * @param {number} [timeout=5000]
   * @returns {Promise<string|null>}
   */
  async waitAndGetText(selector, timeout = 5000) {
    try {
      await this.page.waitForSelector(selector, { timeout });
      return this.getText(selector);
    } catch { return null; }
  }

  /**
   * Evaluate arbitrary JS in the page context.
   * Alias for page.evaluate() for convenience.
   */
  async evaluate(fn, ...args) {
    return this.page.evaluate(fn, ...args);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CUSTOMIZE BELOW — implement these two methods for your scraping task
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * CUSTOMIZE: Derive the JEGS product URL from a pipeline row.
   *
   * @param {Object} row  one row from the pipeline
   * @returns {string}    full URL to scrape
   *
   * Examples:
   *   return `${this.config.baseUrl}/i/JEGS/555/${row['SKU']}/-1`;
   *   return row['Product URL'];
   *   return `${this.config.baseUrl}/search?q=${encodeURIComponent(row['Part Number'])}`;
   */
  buildUrl(row) {
    // TODO(agent): implement URL construction for this scraping task
    const sku = row['SKU'] || row['Part Number'] || '';
    return `${this.config.baseUrl}/i/JEGS/555/${sku.replace('555-', '')}/-1`;
  }

  /**
   * CUSTOMIZE: Extract the data you need from the loaded page.
   *
   * @param {import('puppeteer').Page} page  Puppeteer page (already navigated)
   * @param {Object} row                     original row (for context)
   * @returns {Promise<Object>}              fields to merge onto the row
   *
   * Use the extraction helpers (getText, getAttr, getTextList, getTable, …)
   * defined above, or call page.$eval / page.evaluate directly.
   *
   * Return ONLY the fields you want to add/overwrite on the row.
   * The transform merges this onto the original row, so omitted fields
   * are preserved as-is.
   *
   * Example (product page scraping):
   *
   *   const title       = await this.getText('h1.product-title');
   *   const description = await this.getText('.product-description');
   *   const images      = await this.getAttrList('.product-image img', 'src');
   *   const specs       = await this.getTable('.spec-row', '.spec-label', '.spec-value');
   *   const price       = await this.getText('.price-display .price');
   *
   *   return { title, description, images: images.join('|'), specs, price };
   */
  async extractData(page, row) {
    // TODO(agent): implement data extraction for this scraping task
    throw new Error(
      'extractData() not implemented. ' +
      'Open transforms/jegs-scraper.js and implement this method.'
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PIPELINE TRANSFORM ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pipeline transform function.
 * Reads rows, scrapes each, merges scraped data back onto the row.
 * Rows that fail scraping pass through unchanged (error logged, not thrown).
 *
 * @param {Object[]} rows
 * @param {Object}   config
 * @param {string}   [config.urlField]   field containing the URL to scrape
 *                                        (if not set, buildUrl() is used)
 * @param {number}   [config.delay]      override request delay (ms)
 * @param {boolean}  [config.headless]   override headless mode
 * @param {Object}   opts
 * @param {function} opts.onEvent
 */
module.exports = async function jegsScraperTransform(rows, config = {}, opts = {}) {
  const { onEvent = () => {} } = opts;

  const scraper = new JegsScraper({
    delayBetweenRequests: config.delay      ?? SCRAPER_CONFIG.delayBetweenRequests,
    launchOptions:        config.headless === false
      ? { ...SCRAPER_CONFIG.launchOptions, headless: false }
      : SCRAPER_CONFIG.launchOptions,
  });

  let failed = 0;

  try {
    await scraper.launch();
    onEvent({ type: 'info', message: `Browser launched — scraping ${rows.length} items` });

    const items = rows.map(row => ({
      row,
      url: config.urlField ? row[config.urlField] : scraper.buildUrl(row),
    }));

    const results = await scraper.scrapeAll(items, (done, total, last) => {
      onEvent({
        type:     'progress',
        message:  `Scraped ${done}/${total}${last.error ? ` (error: ${last.error})` : ''}`,
        progress: Math.round((done / total) * 100),
      });
      if (last.error) failed++;
    });

    const merged = results.map(({ row, scraped, error }) => {
      if (error || !scraped) return row;
      return { ...row, ...scraped };
    });

    onEvent({
      type:    'info',
      message: `Scraping complete — ${rows.length - failed} succeeded, ${failed} failed`,
    });

    return merged;

  } finally {
    await scraper.close();
  }
};

// Export the class for standalone use
module.exports.JegsScraper = JegsScraper;
module.exports.SCRAPER_CONFIG = SCRAPER_CONFIG;
