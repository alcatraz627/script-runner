/**
 * api.ts — Typed API client for the Express backend.
 *
 * All backend communication goes through this module. It provides a structured
 * namespace (api.runs, api.transforms, api.files, api.docs, api.jobs) so
 * components never construct fetch URLs directly.
 *
 * The BASE path is '/api' — in dev mode, Vite proxies this to localhost:3460.
 * In production, the Express server serves both the SPA and API on the same port.
 */
import type { RunSummary, RunManifest, TransformInfo, ExecuteOptions, DataPage, FileInfo, HelperInfo, TransformDefaults, FilePreview } from './types';

const BASE = '/api';

/** Generic typed fetch wrapper. Throws on non-2xx with the server's error message. */
async function request<T>(path: string, opts?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		headers: { 'Content-Type': 'application/json' },
		...opts,
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error(body.error || `HTTP ${res.status}`);
	}
	return res.json();
}

export const api = {
	runs: {
		list(): Promise<RunSummary[]> {
			return request('/runs');
		},
		get(id: string): Promise<RunManifest> {
			return request(`/runs/${id}`);
		},
		create(data: { runId: string; name: string; description?: string }): Promise<RunManifest> {
			return request('/runs', {
				method: 'POST',
				body: JSON.stringify(data),
			});
		},
		delete(id: string): Promise<void> {
			return request(`/runs/${id}`, { method: 'DELETE' });
		},
		fork(id: string, newRunId: string, copyDataThrough?: string): Promise<RunManifest> {
			return request(`/runs/${id}/fork`, {
				method: 'POST',
				body: JSON.stringify({ newRunId, copyDataThrough }),
			});
		},
		execute(id: string, opts?: ExecuteOptions): Promise<{ jobId: string }> {
			return request(`/runs/${id}/execute`, {
				method: 'POST',
				body: JSON.stringify(opts || {}),
			});
		},
		config(id: string): Promise<Record<string, unknown>> {
			return request(`/runs/${id}/config`);
		},
		updateConfig(id: string, updates: Record<string, unknown>): Promise<Record<string, unknown>> {
			return request(`/runs/${id}/config`, {
				method: 'PATCH',
				body: JSON.stringify(updates),
			});
		},
		async upload(id: string, file: File): Promise<{ filename: string; path: string; sheets: string[] }> {
			const form = new FormData();
			form.append('file', file);
			const res = await fetch(`${BASE}/runs/${id}/upload`, { method: 'POST', body: form });
			if (!res.ok) {
				const body = await res.json().catch(() => ({ error: res.statusText }));
				throw new Error(body.error || `HTTP ${res.status}`);
			}
			return res.json();
		},
		data(id: string, fileId: string, limit = 50, offset = 0): Promise<DataPage> {
			return request(`/runs/${id}/data/${fileId}?limit=${limit}&offset=${offset}`);
		},
		report(id: string, instructions?: string): Promise<{ markdown: string; path: string; filename: string; message: string }> {
			return request(`/runs/${id}/report`, {
				method: 'POST',
				body: JSON.stringify({ instructions }),
			});
		},
		activeJob(id: string): Promise<{ active: boolean; jobId?: string; status?: string; events?: Array<Record<string, unknown>> }> {
			return request(`/runs/${id}/active-job`);
		},
		stepLogs(id: string, stepId: string): Promise<{ events: Array<Record<string, unknown>> }> {
			return request(`/runs/${id}/logs/${stepId}`);
		},
		toggleStar(id: string): Promise<{ starred: boolean }> {
			return request(`/runs/${id}/star`, { method: 'POST' });
		},
		toggleArchive(id: string): Promise<{ archived: boolean }> {
			return request(`/runs/${id}/archive`, { method: 'POST' });
		},
	},
	transforms: {
		list(): Promise<TransformInfo[]> {
			return request('/transforms');
		},
		source(name: string): Promise<{ name: string; source: string; lines: number; sizeBytes: number; modifiedAt: string }> {
			return request(`/transforms/${name}/source`);
		},
		saveSource(name: string, source: string): Promise<{ name: string; lines: number; sizeBytes: number; modifiedAt: string }> {
			return request(`/transforms/${name}/source`, {
				method: 'PUT',
				body: JSON.stringify({ source }),
			});
		},
		helpers(name: string): Promise<{ name: string; helpers: HelperInfo[] }> {
			return request(`/transforms/${name}/helpers`);
		},
		defaults(name: string): Promise<TransformDefaults> {
			return request(`/transforms/${name}/defaults`);
		},
	},
	files: {
		list(): Promise<FileInfo[]> {
			return request('/files');
		},
		sheets(filePath: string): Promise<{ sheets: string[] }> {
			return request(`/files/sheets?path=${encodeURIComponent(filePath)}`);
		},
		linkToRun(runId: string, sourceRunId: string, filename: string): Promise<{ filename: string; path: string; sheets: string[] }> {
			return request(`/runs/${runId}/link-file`, {
				method: 'POST',
				body: JSON.stringify({ sourceRunId, filename }),
			});
		},
		preview(runId: string, filename: string, opts?: { sheet?: string; limit?: number }): Promise<FilePreview> {
			const params = new URLSearchParams({ runId, filename });
			if (opts?.sheet) params.set('sheet', opts.sheet);
			if (opts?.limit) params.set('limit', String(opts.limit));
			return request(`/files/preview?${params}`);
		},
	},
	docs: {
		files(): Promise<{ id: string; label: string; path: string; description: string; exists: boolean; sizeBytes: number; modifiedAt: string | null }[]> {
			return request('/docs/files');
		},
		read(id: string): Promise<{ id: string; path: string; content: string }> {
			return request(`/docs/files/${id}`);
		},
	},
	jobs: {
		list(): Promise<unknown[]> {
			return request('/jobs');
		},
		cancel(jobId: string): Promise<void> {
			return request(`/jobs/${jobId}`, { method: 'DELETE' });
		},
	},
};
