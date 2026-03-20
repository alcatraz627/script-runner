/**
 * pipeline/job-queue.js — Simple in-process job queue for async pipeline execution
 *
 * Manages concurrent pipeline execution with a configurable concurrency limit.
 * Each job wraps an engine.execute() call and buffers all emitted events in
 * job.events[] for SSE replay when clients connect late.
 *
 * This is a singleton — the entire server shares one queue instance.
 * Jobs are NOT persisted; a server restart loses all job state.
 * The startup recovery in server.js handles orphaned "running" manifests.
 *
 * Usage:
 *   const queue = require('./job-queue');
 *   queue.enqueue({ jobId: 'abc', runDir: '/path/to/run', executeOptions: {} });
 *   queue.on('event', ({ jobId, event }) => console.log(jobId, event));
 *   const job = queue.getJob('abc');
 */

const { EventEmitter } = require('events');
const { execute } = require('./engine');
const createLogger = require('./logger');
const log = createLogger('job-queue');

// Maximum parallel pipeline executions. Set to 2 to allow one run to execute
// while another is queued, without overloading the machine (especially during
// LLM API calls or image generation).
const MAX_CONCURRENT = 2;

/**
 * @typedef {Object} Job
 * @property {string} jobId
 * @property {string} runDir
 * @property {Object} executeOptions
 * @property {'queued'|'running'|'completed'|'failed'} status
 * @property {string} createdAt
 * @property {string|null} startedAt
 * @property {string|null} completedAt
 * @property {string|null} error
 * @property {Array} events - collected events from the run
 */

class JobQueue extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, Job>} */
    this.jobs = new Map();
    this.running = 0;
  }

  /**
   * Add a job to the queue. Starts immediately if under maxConcurrent.
   * @param {Object} opts
   * @param {string} opts.jobId
   * @param {string} opts.runDir
   * @param {Object} [opts.executeOptions]
   * @returns {Job}
   */
  enqueue({ jobId, runDir, executeOptions = {} }) {
    if (this.jobs.has(jobId)) {
      throw new Error(`Job ${jobId} already exists`);
    }

    const job = {
      jobId,
      runDir,
      executeOptions,
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      error: null,
      events: [],
    };

    this.jobs.set(jobId, job);
    log.info(`Enqueued job ${jobId} (running: ${this.running}/${MAX_CONCURRENT})`);
    this._tryStart();
    return job;
  }

  /**
   * Get a job by ID.
   * @param {string} jobId
   * @returns {Job|undefined}
   */
  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  /**
   * List all jobs.
   * @returns {Job[]}
   */
  listJobs() {
    return Array.from(this.jobs.values());
  }

  /**
   * Cancel a queued or running job.
   * @param {string} jobId
   * @returns {boolean}
   */
  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === 'queued') {
      job.status = 'failed';
      job.error = 'Cancelled';
      job.completedAt = new Date().toISOString();
      return true;
    }
    if (job.status === 'running' && job.abortController) {
      job.abortController.abort();
      return true;
    }
    return false;
  }

  /** @private */
  _tryStart() {
    if (this.running >= MAX_CONCURRENT) return;

    // Find next queued job
    for (const job of this.jobs.values()) {
      if (job.status === 'queued') {
        this._run(job);
        break;
      }
    }
  }

  /** @private */
  async _run(job) {
    this.running++;
    job.status = 'running';
    job.startedAt = new Date().toISOString();

    const ac = new AbortController();
    job.abortController = ac;

    const onEvent = (event) => {
      job.events.push(event);
      this.emit('event', { jobId: job.jobId, runDir: job.runDir, event });
    };

    try {
      await execute({
        runDir: job.runDir,
        ...job.executeOptions,
        onEvent,
        signal: ac.signal,
      });
      job.status = ac.signal.aborted ? 'failed' : 'completed';
      if (ac.signal.aborted) job.error = 'Cancelled by user';
      log.info(`Job ${job.jobId} ${job.status}`);
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
    } finally {
      delete job.abortController;
      job.completedAt = new Date().toISOString();
      this.running--;
      this._tryStart();
    }
  }
}

// Singleton
const queue = new JobQueue();
module.exports = queue;
