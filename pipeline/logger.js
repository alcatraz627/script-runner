/**
 * pipeline/logger.js — Centralized logging with timestamps
 *
 * Provides a consistent logging interface for all pipeline scripts and transforms.
 * Each log line is prefixed with an ISO timestamp and severity level.
 *
 * Usage:
 *   const log = require('./logger')('transform-name');
 *   log.info('Processing 500 rows');
 *   log.warn('Missing column: Brand');
 *   log.error('Failed to parse row 42', err);
 *   log.debug('Row data:', row);        // Only shown when DEBUG=1
 *   log.summary({ input: 500, output: 498, skipped: 2 });
 */

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

const LEVELS = {
  debug: { label: 'DBG', color: '\x1b[90m' },
  info:  { label: 'INF', color: '\x1b[36m' },
  warn:  { label: 'WRN', color: '\x1b[33m' },
  error: { label: 'ERR', color: '\x1b[31m' },
};

const RESET = '\x1b[0m';

function createLogger(name) {
  function format(level, ...args) {
    const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
    const { label, color } = LEVELS[level] || LEVELS.info;
    const prefix = `${color}${ts} [${label}]${RESET} ${name ? `(${name}) ` : ''}`;
    return [prefix, ...args];
  }

  const logger = {
    info(...args) {
      console.log(...format('info', ...args));
    },
    warn(...args) {
      console.warn(...format('warn', ...args));
    },
    error(...args) {
      console.error(...format('error', ...args));
    },
    debug(...args) {
      if (DEBUG) console.log(...format('debug', ...args));
    },
    /** Print a formatted summary object */
    summary(data) {
      const parts = Object.entries(data).map(([k, v]) => `${k}=${v}`).join(', ');
      logger.info(`Summary: ${parts}`);
    },
    /** Create a child logger with a sub-name */
    child(subName) {
      return createLogger(`${name}:${subName}`);
    },
  };

  return logger;
}

module.exports = createLogger;
