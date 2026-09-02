/**
 * pipeline/engine.js — Core pipeline execution engine
 *
 * The central execution loop for all pipeline runs. Called by both the CLI
 * (run.js) and the API server (via job-queue.js). Handles:
 *   - Raw input import (Excel/CSV/JSON → data/raw.json)
 *   - Sequential step execution through transforms/*.js functions
 *   - Manifest state tracking and JSONL event logging
 *   - Abort/cancellation via AbortSignal
 *
 * Data flow per step:
 *   data/<prev-step>.json → transforms/<fn>.js → data/<step-id>.json
 *
 * Usage:
 *   const { execute } = require('./engine');
 *   await execute({ runDir, onEvent: (e) => console.log(e) });
 */

const fs   = require('fs');
const path = require('path');
const io   = require('./io');
const manifest = require('./manifest');
const createLogger = require('./logger');

/**
 * Execute a pipeline run.
 *
 * @param {Object} opts
 * @param {string} opts.runDir - Absolute path to the run directory
 * @param {string} [opts.step] - Run only this one step
 * @param {string} [opts.fromStep] - Resume from this step
 * @param {number|string} [opts.limit] - Cap rows processed
 * @param {string} [opts.slice] - Process only rows start,end (inclusive)
 * @param {function} [opts.onEvent] - Event callback
 * @returns {Promise<void>}
 */
async function execute({ runDir, step: onlyStep, fromStep, limit, slice, onEvent, signal, waitForApproval }) {
  const log = createLogger('engine');
  const emit = onEvent || (() => {});
  log.info(`Execute: ${path.basename(runDir)}${onlyStep ? ` step=${onlyStep}` : ''}${fromStep ? ` from=${fromStep}` : ''}`);

  const configPath = path.join(runDir, 'run.config.js');
  if (!fs.existsSync(configPath)) {
    throw new Error(`No run.config.js found at: ${configPath}`);
  }

  // Clear require cache for fresh config
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath);

  const dataDir = path.join(runDir, 'data');
  const logsDir = path.join(runDir, 'logs');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(path.join(runDir, 'raw'),    { recursive: true });
  fs.mkdirSync(path.join(runDir, 'output'), { recursive: true });

  /** Persist event to a step-specific JSONL log file and forward to the caller's emitter.
   *  Every event gets a timestamp and stepId injected before being written and emitted. */
  function persistAndEmit(event, stepId) {
    const stamped = { ...event, timestamp: new Date().toISOString() };
    if (stepId && !stamped.stepId) stamped.stepId = stepId;
    const target = stepId ? path.join(logsDir, `${stepId}.jsonl`) : path.join(logsDir, 'run.jsonl');
    try { fs.appendFileSync(target, JSON.stringify(stamped) + '\n'); } catch { /* ignore */ }
    emit(stamped);
  }

  // Resolve input file: if an absolute path is given, create a symlink in raw/
  // so all file references are relative to the run directory
  if (config.input?.file) {
    const rawFile = config.input.file;
    const isAbsolute = path.isAbsolute(rawFile) || rawFile.startsWith('~');
    if (isAbsolute) {
      const resolved = rawFile.startsWith('~')
        ? rawFile.replace('~', process.env.HOME)
        : rawFile;
      const linkDest = path.join(runDir, 'raw', path.basename(resolved));
      if (!fs.existsSync(linkDest)) {
        fs.symlinkSync(resolved, linkDest);
      }
      config.input.file = path.join('./raw', path.basename(resolved));
    }
  }

  // Auto-generate output path if not set
  if (!config.output) {
    const slug = (config.name || path.basename(runDir))
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const date = new Date().toISOString().slice(0, 10);
    config.output = `./output/${slug}-${date}.xlsx`;
  }

  function dataFile(id) { return path.join(dataDir, `${id}.json`); }

  function loadRows(id) {
    const f = dataFile(id);
    if (!fs.existsSync(f)) throw new Error(`Data file not found: ${f}\nRun a prior step first.`);
    return io.readFile(f);
  }

  function saveRows(id, rows) {
    io.writeFile(rows, dataFile(id));
  }

  // Get or create manifest
  let mf = manifest.getOrCreate(runDir);
  mf.status = 'running';
  mf.lastExecutedAt = new Date().toISOString();
  manifest.save(mf, runDir);

  // Determine which steps to run: --step runs a single step,
  // --from resumes from a step, otherwise run all steps
  const allSteps = config.steps || [];
  let stepsToRun = allSteps;
  let inputId = 'raw';

  if (onlyStep) {
    const s = allSteps.find(s => s.id === onlyStep);
    if (!s) throw new Error(`Step "${onlyStep}" not found. Available: ${allSteps.map(s => s.id).join(', ')}`);
    const idx = allSteps.indexOf(s);
    inputId = idx === 0 ? 'raw' : allSteps[idx - 1].id;
    stepsToRun = [s];
  } else if (fromStep) {
    const idx = allSteps.findIndex(s => s.id === fromStep);
    if (idx < 0) throw new Error(`Step "${fromStep}" not found.`);
    inputId = idx === 0 ? 'raw' : allSteps[idx - 1].id;
    stepsToRun = allSteps.slice(idx);
  }

  const needsImport = !fs.existsSync(dataFile('raw')) && config.input?.file;

  // Step 0: import raw input (always if raw.json missing)
  if (needsImport) {
    const inputPath = path.resolve(runDir, config.input.file);
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${config.input.file}\nResolved to: ${inputPath}`);
    }
    persistAndEmit({ type: 'import', message: `Reading ${config.input.file}...` });

    const rows = io.readFile(inputPath, {
      sheet: config.input.sheet,
      limit,
      slice,
    });
    saveRows('raw', rows);

    // Update manifest input info
    mf.input.rowCount = rows.length;
    mf.input.importedAt = new Date().toISOString();
    try {
      const stat = fs.statSync(dataFile('raw'));
      mf.input.sizeBytes = stat.size;
    } catch { /* ignore */ }
    manifest.save(mf, runDir);

    persistAndEmit({ type: 'import', message: `${rows.length} rows imported`, rowCount: rows.length });
    log.info(`Imported ${rows.length} rows from ${config.input.file}`);
  }

  // Run steps
  let currentInputId = inputId;
  let lastError = null;

  for (const step of stepsToRun) {
    // Check for abort before starting each step
    if (signal?.aborted) {
      // Mark remaining steps as interrupted
      for (const s of stepsToRun.slice(stepsToRun.indexOf(step))) {
        manifest.updateStep(mf, s.id, { status: 'interrupted' });
      }
      mf.status = 'interrupted';
      manifest.save(mf, runDir);
      persistAndEmit({ type: 'interrupted', message: 'Pipeline execution cancelled by user' });
      return;
    }

    const stepStart = Date.now();
    const stepId = step.id;

    // ── Manual (approval-gate) steps ──────────────────────────────────────────
    // type: 'manual' steps are transparent data-wise — they pass the previous
    // step's output through unchanged and suspend execution until the user
    // approves via POST /api/runs/:id/approve. This is the hook for human-in-
    // the-loop review steps: image selection, attribute review, content sign-off.
    if (step.type === 'manual') {
      const inputData = loadRows(currentInputId);
      saveRows(stepId, inputData);

      manifest.updateStep(mf, stepId, {
        status: 'awaiting',
        stale: false,
        startedAt: new Date().toISOString(),
        inputRowCount: inputData.length,
        outputRowCount: inputData.length,
        outputFile: `data/${stepId}.json`,
        error: null,
      });
      manifest.save(mf, runDir);

      persistAndEmit({
        type: 'step-awaiting',
        stepId,
        message: `Awaiting approval: ${step.name || stepId}`,
        dashboardId: step.dashboardId || null,
      }, stepId);
      log.info(`Step ${stepId} awaiting manual approval`);

      if (waitForApproval) {
        await waitForApproval(stepId);
      }

      // Re-check abort after waking up — user may have cancelled while waiting
      if (signal?.aborted) {
        manifest.updateStep(mf, stepId, { status: 'interrupted' });
        manifest.save(mf, runDir);
        return;
      }

      const durationMs = Date.now() - stepStart;
      manifest.updateStep(mf, stepId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        durationMs,
      });
      manifest.save(mf, runDir);

      persistAndEmit({
        type: 'step-complete',
        stepId,
        message: `Step ${stepId} approved — continuing`,
        rowCount: inputData.length,
        durationMs,
      }, stepId);
      log.info(`Step ${stepId} approved after ${durationMs}ms`);

      currentInputId = stepId;
      continue;
    }

    // Update manifest: step starting
    manifest.updateStep(mf, stepId, {
      status: 'running',
      stale: false,
      startedAt: new Date().toISOString(),
      error: null,
    });
    manifest.save(mf, runDir);

    // Clear previous log for this step (fresh execution)
    const stepLogPath = path.join(logsDir, `${stepId}.jsonl`);
    try { fs.writeFileSync(stepLogPath, ''); } catch { /* ignore */ }

    persistAndEmit({ type: 'step-start', stepId, message: `Running step: ${stepId}` }, stepId);
      log.info(`Step ${stepId} (${step.fn}) starting`);

    try {
      const rows = loadRows(currentInputId);

      // Apply columnMap if specified: renames columns before passing to the transform,
      // allowing transforms to work with a standard schema regardless of source format
      let inputRows = rows;
      if (step.columnMap) {
        inputRows = rows.map(row => {
          const mapped = { ...row };
          for (const [from, to] of Object.entries(step.columnMap)) {
            if (mapped[from] !== undefined) {
              mapped[to] = mapped[from];
              if (from !== to) delete mapped[from];
            }
          }
          return mapped;
        });
      }

      const transformPath = path.resolve(__dirname, `../transforms/${step.fn}.js`);
      if (!fs.existsSync(transformPath)) {
        throw new Error(`Transform not found: transforms/${step.fn}.js`);
      }
      delete require.cache[require.resolve(transformPath)];
      const transform = require(transformPath);
      const fn = typeof transform === 'function' ? transform : transform.run;

      // Wrap onEvent to track whether the transform emits its own progress
      let transformEmitted = false;
      const stepOnEvent = (event) => {
        transformEmitted = true;
        persistAndEmit(event, stepId);
      };

      persistAndEmit({ type: 'info', message: `Processing ${inputRows.length} rows through ${step.fn}...` }, stepId);

      const result = await fn(inputRows, step.config || {}, {
        limit,
        slice,
        runDir,
        onEvent: stepOnEvent,
      });

      saveRows(stepId, result);

      const durationMs = Date.now() - stepStart;
      let outputSizeBytes = null;
      try {
        outputSizeBytes = fs.statSync(dataFile(stepId)).size;
      } catch { /* ignore */ }

      manifest.updateStep(mf, stepId, {
        status:         'completed',
        stale:          false,
        inputRowCount:  inputRows.length,
        outputRowCount: result.length,
        durationMs,
        outputSizeBytes,
        completedAt:    new Date().toISOString(),
        error:          null,
        outputFile:     `data/${stepId}.json`,
      });
      manifest.save(mf, runDir);

      persistAndEmit({
        type: 'step-complete',
        stepId,
        message: `Step ${stepId} complete`,
        rowCount: result.length,
        durationMs,
      }, stepId);
      log.info(`Step ${stepId} complete — ${result.length} rows in ${durationMs}ms`);

      currentInputId = stepId;
    } catch (err) {
      const durationMs = Date.now() - stepStart;
      lastError = err;

      manifest.updateStep(mf, stepId, {
        status:    'error',
        durationMs,
        error:     err.message,
        completedAt: new Date().toISOString(),
      });
      mf.status = 'error';
      manifest.save(mf, runDir);

      persistAndEmit({
        type: 'step-error',
        stepId,
        message: `Step ${stepId} failed: ${err.message}`,
        error: err.message,
        durationMs,
      }, stepId);
      log.error(`Step ${stepId} failed after ${durationMs}ms:`, err.message);

      throw err;
    }
  }

  // Write final.json as a copy of the last step's output — this provides a
  // stable reference for downstream consumers regardless of step naming
  const lastStep = stepsToRun[stepsToRun.length - 1];
  if (lastStep) {
    const finalSrc  = dataFile(lastStep.id);
    const finalDest = dataFile('final');
    fs.copyFileSync(finalSrc, finalDest);
  }

  // Write output xlsx if configured
  if (config.output && !onlyStep) {
    const outPath = path.resolve(runDir, config.output);
    const finalRows = io.readFile(dataFile('final'));
    io.writeFile(finalRows, outPath, { colWidths: config.outputColWidths });
  }

  // Update manifest status
  const allCompleted = mf.steps.every(s => s.status === 'completed');
  mf.status = allCompleted ? 'completed' : 'partial';
  manifest.save(mf, runDir);

  persistAndEmit({ type: 'done', message: 'Pipeline execution complete' });
}

module.exports = { execute };
