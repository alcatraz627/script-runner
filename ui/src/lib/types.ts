/**
 * types.ts — Shared TypeScript interfaces matching the Express API response shapes.
 *
 * These types mirror the server-side data structures defined in:
 *   - pipeline/manifest.js (RunManifest, StepManifest)
 *   - server.js toRunSummary() (RunSummary)
 *   - server.js GET /api/transforms (TransformInfo)
 *   - server.js GET /api/files (FileInfo)
 */

/** Lightweight run info for the runs list page. */
export interface RunSummary {
	runId: string;
	configName: string;
	description: string;
	status: 'draft' | 'running' | 'completed' | 'partial' | 'error' | 'interrupted';
	stepsCompleted: number;
	stepsTotal: number;
	lastExecutedAt: string | null;
	createdAt: string | null;
	error?: string;
}

/** Per-step execution state within a run manifest. */
export interface StepManifest {
	id: string;
	fn: string;
	name: string;
	description: string;
	status: 'pending' | 'running' | 'completed' | 'error' | 'skipped' | 'interrupted';
	stale: boolean;
	inputRowCount: number | null;
	outputRowCount: number | null;
	durationMs: number | null;
	outputSizeBytes: number | null;
	startedAt: string | null;
	completedAt: string | null;
	error: string | null;
	outputFile: string | null;
	params: {
		limit: number | null;
		slice: string | null;
		columnMap: Record<string, string> | null;
		outputFilename: string | null;
	};
}

/** Full run manifest — the primary data structure for the run detail page. */
export interface RunManifest {
	runId: string;
	configName: string;
	description: string;
	createdAt: string;
	lastExecutedAt: string | null;
	status: 'draft' | 'running' | 'completed' | 'partial' | 'error' | 'interrupted';
	input: {
		file: string | null;
		sheet: string | null;
		rowCount: number | null;
		sizeBytes: number | null;
		importedAt: string | null;
	};
	steps: StepManifest[];
}

/** Metadata for a transform function, parsed from its JSDoc header and module exports. */
export interface TransformInfo {
	name: string;
	hasSystemPrompt: boolean;
	exportedHelpers: string[];
	description: string;
	config: string;
	inputOutput: string;
}

/** Metadata for an uploaded/linked file in a run's raw/ directory. */
export interface FileInfo {
	filename: string;
	runId: string;
	path: string;
	sizeBytes: number;
	modifiedAt: string;
	ext: string;
	isSymlink: boolean;
	linkedFrom: string | null;
}

/** Options passed to POST /api/runs/:id/execute to control which steps run. */
export interface ExecuteOptions {
	step?: string;
	fromStep?: string;
	limit?: number;
	slice?: string;
}

/** Paginated data response from GET /api/runs/:id/data/:fileId. */
export interface DataPage {
	rows: Record<string, unknown>[];
	total: number;
	columns: string[];
}

export interface HelperInfo {
	name: string;
	params: string[];
	description: string;
	source: string;
}

export interface TransformDefaults {
	name: string;
	config: string;
	defaults: Record<string, unknown>;
	inputOutput: string;
	description: string;
}

export interface FilePreview {
	rows: Record<string, unknown>[];
	total: number;
	columns: string[];
	format: string;
	sizeBytes?: number;
	message?: string;
}
