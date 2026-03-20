/**
 * transforms/dummy.js — Idempotent test/debug transform
 *
 * A no-op transform that passes data through unchanged, with configurable
 * behaviors for testing the pipeline infrastructure:
 *
 * Config options:
 *   sleep       {number}  — Milliseconds to wait before resolving (default: 0)
 *   should_fail {boolean} — If true, throws an error after sleep (default: false)
 *   fail_message {string} — Custom error message (default: "Dummy step forced failure")
 *   log_rows    {boolean} — Emit a progress event for each row (default: false)
 *
 * Input:  Array of row objects (any schema)
 * Output: Same array, unchanged (identity function)
 *
 * Examples:
 *   // Sleep for 5 seconds then pass data through:
 *   { "sleep": 5000 }
 *
 *   // Simulate a failure after 2 seconds:
 *   { "sleep": 2000, "should_fail": true }
 *
 *   // Fail with a custom message:
 *   { "should_fail": true, "fail_message": "Out of memory (simulated)" }
 *
 *   // Emit per-row progress (useful for testing SSE streaming):
 *   { "sleep": 3000, "log_rows": true }
 */

async function run(rows, config = {}, ctx = {}) {
  const {
    sleep = 0,
    should_fail = false,
    fail_message = 'Dummy step forced failure',
    log_rows = false,
  } = config;

  const emit = ctx.onEvent || (() => {});

  emit({ type: 'info', message: `Dummy step started — ${rows.length} rows, sleep=${sleep}ms, should_fail=${should_fail}` });

  // Emit per-row progress if requested
  if (log_rows) {
    for (let i = 0; i < rows.length; i++) {
      emit({ type: 'info', message: `[${i + 1}/${rows.length}] Processing row...` });
    }
  }

  // Sleep if configured
  if (sleep > 0) {
    const interval = Math.min(sleep, 1000);
    const steps = Math.ceil(sleep / interval);
    for (let i = 0; i < steps; i++) {
      const elapsed = (i + 1) * interval;
      const remaining = sleep - elapsed;
      await new Promise(resolve => setTimeout(resolve, interval));
      if (remaining > 0) {
        emit({ type: 'info', message: `Sleeping... ${Math.round(elapsed / 1000)}s / ${Math.round(sleep / 1000)}s` });
      }
    }
    emit({ type: 'info', message: `Sleep complete (${sleep}ms)` });
  }

  // Fail if configured
  if (should_fail) {
    emit({ type: 'info', message: `About to fail: ${fail_message}` });
    throw new Error(fail_message);
  }

  emit({ type: 'info', message: `Dummy step complete — passing through ${rows.length} rows unchanged` });
  return rows;
}

module.exports = { run };
