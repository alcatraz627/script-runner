<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { api } from '$lib/api';
	import { APP } from '$lib/constants/app';
	import type { FileInfo, FilePreview } from '$lib/types';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';

	let files: FileInfo[] = $state([]);
	let loading = $state(true);
	let error: string | null = $state(null);
	let search = $state('');
	let sortBy: 'filename' | 'runId' | 'sizeBytes' | 'modifiedAt' = $state('modifiedAt');
	let sortDir: 'asc' | 'desc' = $state('desc');

	// Grouping
	let groupByRun = $state(false);

	// Preview
	let previewFile: FileInfo | null = $state(null);
	let previewData: FilePreview | null = $state(null);
	let previewLoading = $state(false);
	let previewError: string | null = $state(null);

	onMount(async () => {
		try {
			files = await api.files.list();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load files';
		} finally {
			loading = false;
		}
	});

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
	}

	function extColor(ext: string): string {
		switch (ext) {
			case '.xlsx': case '.xls': return 'text-green-600 bg-green-50 border-green-200';
			case '.csv': return 'text-blue-600 bg-blue-50 border-blue-200';
			case '.json': return 'text-amber-600 bg-amber-50 border-amber-200';
			default: return 'text-[var(--color-text-secondary)] bg-[var(--color-bg-page)] border-[var(--color-border)]';
		}
	}

	function toggleSort(col: typeof sortBy) {
		if (sortBy === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else { sortBy = col; sortDir = col === 'modifiedAt' ? 'desc' : 'asc'; }
	}

	async function togglePreview(f: FileInfo) {
		if (previewFile?.runId === f.runId && previewFile?.filename === f.filename) {
			previewFile = null;
			previewData = null;
			return;
		}
		previewFile = f;
		previewLoading = true;
		previewError = null;
		previewData = null;
		try {
			previewData = await api.files.preview(f.runId, f.filename, { limit: 30 });
		} catch (e) {
			previewError = e instanceof Error ? e.message : 'Preview failed';
		} finally {
			previewLoading = false;
		}
	}

	function formatCell(value: unknown): string {
		if (value === null || value === undefined) return '';
		if (Array.isArray(value)) {
			if (value.length === 0) return '';
			if (Array.isArray(value[0])) return value.map((v) => v.join(': ')).join(', ');
			return value.join(', ');
		}
		if (typeof value === 'object') return JSON.stringify(value);
		return String(value);
	}

	let filtered = $derived.by(() => {
		let result = files;
		if (search.trim()) {
			const q = search.toLowerCase();
			result = result.filter(f =>
				f.filename.toLowerCase().includes(q) ||
				f.runId.toLowerCase().includes(q)
			);
		}
		const dir = sortDir === 'asc' ? 1 : -1;
		result = [...result].sort((a, b) => {
			if (sortBy === 'filename') return dir * a.filename.localeCompare(b.filename);
			if (sortBy === 'runId') return dir * a.runId.localeCompare(b.runId);
			if (sortBy === 'sizeBytes') return dir * (a.sizeBytes - b.sizeBytes);
			return dir * (new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime());
		});
		return result;
	});

	let grouped = $derived.by(() => {
		if (!groupByRun) return null;
		const map = new SvelteMap<string, FileInfo[]>();
		for (const f of filtered) {
			const arr = map.get(f.runId) || [];
			arr.push(f);
			map.set(f.runId, arr);
		}
		return map;
	});

	let uniqueFiles = $derived(new Set(files.map(f => f.filename)).size);
	let totalSize = $derived(files.reduce((sum, f) => sum + f.sizeBytes, 0));
	let isPreviewActive = $derived((f: FileInfo) => previewFile?.runId === f.runId && previewFile?.filename === f.filename);
</script>

<svelte:head>
	<title>Files | {APP.title}</title>
</svelte:head>

<div class="space-y-6 max-w-5xl">
	<Breadcrumb items={[{ label: 'Files' }]} />

	<div>
		<h2 class="text-2xl font-bold text-[var(--color-text-primary)]">Files</h2>
		<p class="text-sm text-[var(--color-text-secondary)] mt-1">
			Manage input files across all pipeline runs. Reuse files by linking them to new runs instead of re-uploading.
		</p>
	</div>

	{#if loading}
		<div class="flex items-center justify-center h-48">
			<div class="text-[var(--color-text-muted)] text-sm">Loading files...</div>
		</div>
	{:else if error}
		<div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
	{:else}
		<!-- Stats bar -->
		<div class="flex items-center gap-6">
			<div class="flex items-center gap-4 text-sm">
				<span class="text-[var(--color-text-secondary)]">{files.length} file{files.length !== 1 ? 's' : ''} across {new Set(files.map(f => f.runId)).size} runs</span>
				<span class="text-[var(--color-text-muted)]">|</span>
				<span class="text-[var(--color-text-secondary)]">{uniqueFiles} unique</span>
				<span class="text-[var(--color-text-muted)]">|</span>
				<span class="text-[var(--color-text-secondary)]">{formatBytes(totalSize)} total</span>
			</div>
		</div>

		<!-- Toolbar -->
		<div class="flex items-center justify-between gap-3">
			<input
				type="text"
				bind:value={search}
				placeholder="Search files or runs..."
				class="px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg-surface)] focus:outline-none focus:ring-1 focus:ring-blue-400 w-72"
			/>
			<div class="flex items-center gap-2">
				<button
					onclick={() => { groupByRun = !groupByRun; }}
					class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors {groupByRun ? 'bg-blue-50 text-blue-700 border-blue-200' : 'text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-bg-surface-hover)]'}"
				>
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" /></svg>
					Group by Run
				</button>
			</div>
		</div>

		{#if filtered.length === 0}
			<div class="bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] p-12 text-center">
				<svg class="mx-auto h-12 w-12 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
				</svg>
				{#if search.trim()}
					<h3 class="mt-4 text-sm font-medium text-[var(--color-text-primary)]">No matching files</h3>
					<p class="mt-1 text-sm text-[var(--color-text-secondary)]">Try a different search term.</p>
				{:else}
					<h3 class="mt-4 text-sm font-medium text-[var(--color-text-primary)]">No files yet</h3>
					<p class="mt-1 text-sm text-[var(--color-text-secondary)]">Upload a file to a run to get started.</p>
				{/if}
			</div>
		{:else if grouped}
			<!-- Grouped view -->
			{#each [...grouped.entries()] as [runId, runFiles] (runId)}
				<div class="bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
					<div class="px-4 py-2.5 bg-[var(--color-bg-page)] border-b border-[var(--color-border)] flex items-center justify-between">
						<a href="/runs/{runId}" class="text-sm font-medium text-[var(--color-text-primary)] hover:text-blue-700 transition-colors">{runId}</a>
						<span class="text-xs text-[var(--color-text-muted)]">{runFiles.length} file{runFiles.length !== 1 ? 's' : ''}</span>
					</div>
					<div class="divide-y divide-[var(--color-border-light)]">
						{#each runFiles as f (f.filename)}
							<div>
								<button onclick={() => togglePreview(f)} class="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-bg-surface-hover)] transition-colors w-full text-left cursor-pointer">
									<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border {extColor(f.ext)}">{f.ext || '?'}</span>
									<span class="text-sm text-[var(--color-text-primary)] font-medium flex-1 truncate hover:text-blue-700 transition-colors">{f.filename}</span>
									{#if f.isSymlink}
										<span class="inline-flex items-center gap-1 text-[10px] text-purple-600 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded">
											<svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
											linked
										</span>
									{/if}
									<span class="text-xs text-[var(--color-text-muted)] w-16 text-right">{formatBytes(f.sizeBytes)}</span>
									<span class="text-xs text-[var(--color-text-muted)] w-36 text-right">{formatDate(f.modifiedAt)}</span>
									<span class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors {isPreviewActive(f) ? 'bg-blue-50 text-blue-700 border-blue-200' : 'text-[var(--color-text-secondary)] border-[var(--color-border)]'}">
										<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
										Preview
									</span>
								</button>
								{#if isPreviewActive(f)}
									<div class="border-t border-[var(--color-border-light)] px-4 py-3">
										{@render previewPanel()}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		{:else}
			<!-- Flat table view -->
			<div class="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden">
				<table class="w-full text-sm">
					<thead>
						<tr class="bg-[var(--color-bg-page)] border-b border-[var(--color-border)]">
							<th class="text-left px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)]">Type</th>
							<th
								onclick={() => toggleSort('filename')}
								class="text-left px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)] cursor-pointer hover:text-[var(--color-text-primary)] select-none"
							>
								Filename {sortBy === 'filename' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
							</th>
							<th
								onclick={() => toggleSort('runId')}
								class="text-left px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)] cursor-pointer hover:text-[var(--color-text-primary)] select-none"
							>
								Run {sortBy === 'runId' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
							</th>
							<th
								onclick={() => toggleSort('sizeBytes')}
								class="text-right px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)] cursor-pointer hover:text-[var(--color-text-primary)] select-none"
							>
								Size {sortBy === 'sizeBytes' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
							</th>
							<th
								onclick={() => toggleSort('modifiedAt')}
								class="text-right px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)] cursor-pointer hover:text-[var(--color-text-primary)] select-none"
							>
								Modified {sortBy === 'modifiedAt' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
							</th>
							<th class="text-right px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)]">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-[var(--color-border-light)]">
						{#each filtered as f (f.runId + '/' + f.filename)}
							<tr class="hover:bg-[var(--color-bg-surface-hover)] transition-colors {isPreviewActive(f) ? 'bg-blue-50/30' : ''}">
								<td class="px-4 py-2.5">
									<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border {extColor(f.ext)}">{f.ext || '?'}</span>
								</td>
								<td class="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">
									<button onclick={() => togglePreview(f)} class="hover:text-blue-700 transition-colors text-left cursor-pointer">{f.filename}</button>
								</td>
								<td class="px-4 py-2.5">
									<a href="/runs/{f.runId}" class="text-sm text-[var(--color-text-secondary)] hover:text-blue-700 transition-colors font-mono">{f.runId}</a>
								</td>
								<td class="px-4 py-2.5 text-right text-[var(--color-text-secondary)]">{formatBytes(f.sizeBytes)}</td>
								<td class="px-4 py-2.5 text-right text-[var(--color-text-muted)]">{formatDate(f.modifiedAt)}</td>
								<td class="px-4 py-2.5 text-right">
									<div class="flex items-center justify-end gap-2">
										{#if f.isSymlink}
											<span class="inline-flex items-center gap-1 text-[10px] text-purple-600 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded">
												<svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
												linked
											</span>
										{/if}
										<button
											onclick={() => togglePreview(f)}
											class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors active:scale-95 {isPreviewActive(f) ? 'bg-blue-50 text-blue-700 border-blue-200' : 'text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-bg-surface-hover)] hover:border-[var(--color-border)]'}"
											title="Preview file contents"
										>
											<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
											Preview
										</button>
									</div>
								</td>
							</tr>
							{#if isPreviewActive(f)}
								<tr>
									<td colspan="6" class="px-4 py-3 bg-[var(--color-bg-page)] max-w-0">
										<div class="overflow-x-auto">
											{@render previewPanel()}
										</div>
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<!-- Preview panel (rendered inline above via snippet) -->
	{/if}
</div>

{#snippet previewPanel()}
	{#if previewLoading}
		<div class="flex items-center justify-center h-24 text-sm text-[var(--color-text-muted)]">Loading preview...</div>
	{:else if previewError}
		<div class="text-sm text-red-600">{previewError}</div>
	{:else if previewData}
		{#if previewData.message}
			<div class="text-sm text-[var(--color-text-secondary)]">{previewData.message}</div>
		{:else if previewData.columns.length > 0}
			<div class="space-y-2">
				<div class="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
					<span>{previewData.total.toLocaleString()} rows total</span>
					<span class="text-[var(--color-text-muted)]">|</span>
					<span>{previewData.columns.length} columns</span>
					<span class="text-[var(--color-text-muted)]">|</span>
					<span>Showing first {previewData.rows.length}</span>
				</div>
				<div class="border border-[var(--color-border)] rounded-lg overflow-hidden">
					<div class="overflow-x-auto max-h-[40vh]">
						<table class="min-w-full text-xs">
							<thead class="bg-[var(--color-bg-inset)] sticky top-0">
								<tr>
									<th class="px-2 py-1.5 text-left text-[10px] font-medium text-[var(--color-text-secondary)] uppercase w-8">#</th>
									{#each previewData.columns as col (col)}
										<th class="px-2 py-1.5 text-left text-[10px] font-medium text-[var(--color-text-secondary)] uppercase whitespace-nowrap">{col}</th>
									{/each}
								</tr>
							</thead>
							<tbody class="divide-y divide-[var(--color-border-light)] bg-[var(--color-bg-surface)]">
								{#each previewData.rows as row, i (i)}
									<tr class="hover:bg-[var(--color-bg-surface-hover)]">
										<td class="px-2 py-1.5 text-[var(--color-text-muted)] font-mono">{i + 1}</td>
										{#each previewData.columns as col (col)}
											<td class="px-2 py-1.5 text-[var(--color-text-primary)] max-w-xs truncate" title={formatCell(row[col])}>
												{formatCell(row[col])}
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		{:else}
			<div class="text-sm text-[var(--color-text-muted)]">No data in this file.</div>
		{/if}
	{/if}
{/snippet}
