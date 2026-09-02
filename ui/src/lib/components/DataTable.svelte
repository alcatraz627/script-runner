<script lang="ts">
	import { api } from '$lib/api';
	import type { DataPage } from '$lib/types';

	interface Props {
		runId: string;
		fileId: string;
	}

	let { runId, fileId }: Props = $props();

	let page: DataPage | null = $state(null);
	let loading = $state(true);
	let error: string | null = $state(null);
	let offset = $state(0);
	let search = $state('');
	let sortCol: string | null = $state(null);
	let sortDir: 'asc' | 'desc' = $state('asc');
	let tableContainer: HTMLDivElement;
	const limit = 50;

	async function fetchPage() {
		loading = true;
		try {
			page = await api.runs.data(runId, fileId, limit, offset);
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load data';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void [runId, fileId, offset];
		fetchPage();
	});

	function toggleSort(col: string) {
		if (sortCol === col) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortCol = col;
			sortDir = 'asc';
		}
	}

	function compareCells(a: unknown, b: unknown): number {
		const aEmpty = a === null || a === undefined || a === '';
		const bEmpty = b === null || b === undefined || b === '';
		if (aEmpty && bEmpty) return 0;
		if (aEmpty) return 1;
		if (bEmpty) return -1;
		const aNum = Number(a);
		const bNum = Number(b);
		if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
		return String(a).localeCompare(String(b));
	}

	let filteredRows = $derived.by(() => {
		let rows = page?.rows ?? [];
		if (search.trim()) {
			const q = search.toLowerCase();
			rows = rows.filter((row) =>
				Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q))
			);
		}
		if (sortCol) {
			const col = sortCol;
			const dir = sortDir === 'asc' ? 1 : -1;
			rows = [...rows].sort((a, b) => dir * compareCells(a[col], b[col]));
		}
		return rows;
	});

	let totalPages = $derived.by(() => (page ? Math.ceil(page.total / limit) : 0));
	let currentPage = $derived.by(() => Math.floor(offset / limit) + 1);

	function goTo(p: number) {
		offset = (p - 1) * limit;
		tableContainer?.scrollTo({ top: 0, behavior: 'instant' });
	}

	function downloadUrl(format: string): string {
		return `/api/runs/${runId}/data/${fileId}/download?format=${format}`;
	}

	/** Check if a value is a complex type (object/array-of-objects) that should render as code */
	function isComplexValue(value: unknown): boolean {
		if (value === null || value === undefined) return false;
		if (Array.isArray(value)) {
			return value.length > 0 && typeof value[0] === 'object' && value[0] !== null;
		}
		return typeof value === 'object';
	}

	function formatCell(value: unknown): string {
		if (value === null || value === undefined) return '';
		if (Array.isArray(value)) {
			if (value.length === 0) return '';
			if (Array.isArray(value[0])) return value.map((v: unknown[]) => v.join(': ')).join(', ');
			if (typeof value[0] === 'object' && value[0] !== null) return JSON.stringify(value, null, 2);
			return value.join(', ');
		}
		if (typeof value === 'object') return JSON.stringify(value, null, 2);
		return String(value);
	}

	/** Compact single-line preview for code cells in the table */
	function formatCellCompact(value: unknown): string {
		if (value === null || value === undefined) return '';
		if (Array.isArray(value)) {
			if (value.length === 0) return '[]';
			if (Array.isArray(value[0])) return value.map((v: unknown[]) => v.join(': ')).join(', ');
			if (typeof value[0] === 'object' && value[0] !== null) {
				return `[${value.length} items]`;
			}
			return value.join(', ');
		}
		if (typeof value === 'object') {
			const keys = Object.keys(value as Record<string, unknown>);
			if (keys.length === 0) return '{}';
			return `{${keys.join(', ')}}`;
		}
		return String(value);
	}

	let copiedCell: string | null = $state(null);
	async function copyCell(value: unknown) {
		const text = formatCell(value);
		await navigator.clipboard.writeText(text);
		copiedCell = text;
		setTimeout(() => { copiedCell = null; }, 1500);
	}

	function isImageUrl(value: unknown): boolean {
		if (typeof value !== 'string') return false;
		const v = value.trim();
		return /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|svg)/i.test(v) || /ebayimg\.com/i.test(v);
	}

	function isLocalImagePath(value: unknown): boolean {
		if (typeof value !== 'string') return false;
		return /^posters\/.*\.png$/i.test(value.trim());
	}

	/** Columns where most values look like image URLs or local poster paths */
	let imageCols = $derived.by(() => {
		if (!page || page.rows.length === 0) return new Set<string>();
		const cols = new Set<string>();
		for (const col of page.columns) {
			const sample = page.rows.slice(0, 10);
			const imgCount = sample.filter((r) => isImageUrl(r[col]) || isLocalImagePath(r[col])).length;
			if (imgCount >= sample.length * 0.5) cols.add(col);
		}
		return cols;
	});

	let hasImageCols = $derived(imageCols.size > 0);

	let zipping = $state(false);
	async function zipImages() {
		zipping = true;
		try {
			const res = await fetch(`/api/runs/${runId}/images/zip`);
			if (!res.ok) {
				const body = await res.json().catch(() => ({ error: res.statusText }));
				throw new Error(body.error || `HTTP ${res.status}`);
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${runId}-images.zip`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Zip failed');
		} finally {
			zipping = false;
		}
	}
</script>

<div class="space-y-3">
	<!-- Toolbar -->
	<div class="flex items-center justify-between gap-3">
		<div class="flex items-center gap-2 flex-1">
			<input
				type="text"
				bind:value={search}
				placeholder="Filter rows on this page..."
				class="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-md bg-[var(--color-bg-surface)] focus:outline-none focus:ring-1 focus:ring-blue-400 w-64"
			/>
			{#if page}
				<span class="text-xs text-[var(--color-text-muted)]">{page.total} rows total</span>
			{/if}
		</div>
		<div class="flex items-center gap-1.5">
			<a
				href={downloadUrl('json')}
				class="px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] bg-[var(--color-bg-inset)] rounded hover:bg-[var(--color-bg-surface-hover)] transition-colors"
			>JSON</a>
			<a
				href={downloadUrl('csv')}
				class="px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] bg-[var(--color-bg-inset)] rounded hover:bg-[var(--color-bg-surface-hover)] transition-colors"
			>CSV</a>
			<a
				href={downloadUrl('xlsx')}
				class="px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] bg-[var(--color-bg-inset)] rounded hover:bg-[var(--color-bg-surface-hover)] transition-colors"
			>XLSX</a>
			{#if hasImageCols}
				<span class="text-[var(--color-border)] mx-0.5">|</span>
				<button
					onclick={zipImages}
					disabled={zipping}
					class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] bg-[var(--color-bg-inset)] rounded hover:bg-[var(--color-bg-surface-hover)] transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-wait"
				>
					<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
					{zipping ? 'Zipping...' : 'Zip Images'}
				</button>
			{/if}
		</div>
	</div>

	<!-- Table -->
	{#if loading}
		<div class="flex items-center justify-center h-32 text-sm text-[var(--color-text-muted)]">Loading data...</div>
	{:else if error}
		<div class="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">{error}</div>
	{:else if page && page.columns.length > 0}
		<div class="border border-[var(--color-border)] rounded-lg overflow-hidden">
			<div class="overflow-x-auto max-h-[60vh]" bind:this={tableContainer}>
				<table class="min-w-full text-sm">
					<thead class="bg-[var(--color-bg-surface-hover)] sticky top-0">
						<tr>
							<th class="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider w-12">#</th>
							{#each page.columns as col (col)}
								<th
									onclick={() => toggleSort(col)}
									class="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-[var(--color-text-primary)] select-none"
								>
									{col}
									{#if sortCol === col}
										<span class="ml-0.5">{sortDir === 'asc' ? '▲' : '▼'}</span>
									{/if}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody class="divide-y divide-[var(--color-border-light)] bg-[var(--color-bg-surface)]">
						{#each filteredRows as row, i (i)}
							<tr class="hover:bg-[var(--color-bg-surface-hover)]">
								<td class="px-3 py-2 text-xs text-[var(--color-text-muted)] font-mono">{offset + i + 1}</td>
								{#each page.columns as col (col)}
									<td class="px-3 py-2 text-[var(--color-text-primary)] max-w-xs" title={formatCell(row[col])}>
										{#if imageCols.has(col) && isImageUrl(row[col])}
											<a href={String(row[col])} target="_blank" rel="noopener noreferrer" class="inline-block">
												<img
													src={String(row[col])}
													alt={col}
													class="h-10 w-10 object-cover rounded border border-[var(--color-border)] hover:ring-2 hover:ring-blue-400 transition-all"
													loading="lazy"
												/>
											</a>
										{:else if imageCols.has(col) && isLocalImagePath(row[col])}
											<a href="/api/runs/{runId}/posters/{String(row[col]).replace('posters/', '')}" target="_blank" rel="noopener noreferrer" class="inline-block">
												<img
													src="/api/runs/{runId}/posters/{String(row[col]).replace('posters/', '')}"
													alt={col}
													class="h-10 w-10 object-cover rounded border border-[var(--color-border)] hover:ring-2 hover:ring-blue-400 transition-all"
													loading="lazy"
												/>
											</a>
										{:else if isComplexValue(row[col])}
											<div class="group relative">
												<code class="text-[10px] leading-tight font-mono text-[var(--color-text-secondary)] bg-[var(--color-bg-inset)] px-1.5 py-0.5 rounded border border-[var(--color-border-light)] inline-block max-w-[200px] truncate">
													{formatCellCompact(row[col])}
												</code>
												<button
													onclick={() => copyCell(row[col])}
													class="ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
													title="Copy JSON"
												>
													{copiedCell === formatCell(row[col]) ? '✓' : '⧉'}
												</button>
												<!-- Hover popover with full formatted JSON -->
												<div class="hidden group-hover:block absolute z-50 right-0 top-full mt-1 max-h-[50vh] w-max overflow-auto bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg shadow-xl p-3" style="max-width: min(80vw, 900px);">
													<pre class="text-[11px] leading-snug font-mono text-[var(--color-text-primary)] whitespace-pre-wrap break-words">{formatCell(row[col])}</pre>
												</div>
											</div>
										{:else}
											<span class="truncate block">{formatCell(row[col])}</span>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="flex items-center justify-between pt-1">
				<span class="text-xs text-[var(--color-text-muted)]">
					Showing {offset + 1}–{Math.min(offset + limit, page.total)} of {page.total}
				</span>
				<div class="flex items-center gap-1">
					<button
						onclick={() => goTo(currentPage - 1)}
						disabled={currentPage <= 1}
						class="px-2 py-1 text-xs rounded border border-[var(--color-border)] hover:bg-[var(--color-bg-inset)] disabled:opacity-30 disabled:cursor-not-allowed"
					>Prev</button>
					{#each Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
						if (totalPages <= 7) return i + 1;
						if (currentPage <= 4) return i + 1;
						if (currentPage >= totalPages - 3) return totalPages - 6 + i;
						return currentPage - 3 + i;
					}) as p}
						<button
							onclick={() => goTo(p)}
							class="px-2 py-1 text-xs rounded border {p === currentPage ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium' : 'border-[var(--color-border)] hover:bg-[var(--color-bg-inset)]'}"
						>{p}</button>
					{/each}
					<button
						onclick={() => goTo(currentPage + 1)}
						disabled={currentPage >= totalPages}
						class="px-2 py-1 text-xs rounded border border-[var(--color-border)] hover:bg-[var(--color-bg-inset)] disabled:opacity-30 disabled:cursor-not-allowed"
					>Next</button>
				</div>
			</div>
		{/if}
	{:else}
		<div class="text-center py-8 text-sm text-[var(--color-text-muted)]">No data</div>
	{/if}
</div>
