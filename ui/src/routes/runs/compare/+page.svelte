<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { APP } from '$lib/constants/app';
	import type { RunManifest, RunSummary } from '$lib/types';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';

	let runs: RunSummary[] = $state([]);
	let leftId = $state('');
	let rightId = $state('');
	let leftManifest: RunManifest | null = $state(null);
	let rightManifest: RunManifest | null = $state(null);
	let loading = $state(false);
	let error: string | null = $state(null);

	onMount(async () => {
		runs = await api.runs.list();
		// Pre-fill from URL params if present
		const params = page.url.searchParams;
		if (params.get('left')) leftId = params.get('left')!;
		if (params.get('right')) rightId = params.get('right')!;
		if (leftId && rightId) compare();
	});

	async function compare() {
		if (!leftId || !rightId) return;
		loading = true;
		error = null;
		try {
			[leftManifest, rightManifest] = await Promise.all([
				api.runs.get(leftId),
				api.runs.get(rightId),
			]);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load runs';
		} finally {
			loading = false;
		}
	}

	function formatBytes(bytes: number | null): string {
		if (bytes === null) return '--';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function formatDuration(ms: number | null): string {
		if (ms === null) return '--';
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		return `${(ms / 60_000).toFixed(1)}m`;
	}

	function diffClass(a: number | null, b: number | null): string {
		if (a === null || b === null) return '';
		if (a > b) return 'text-green-600';
		if (a < b) return 'text-red-600';
		return 'text-[var(--color-text-secondary)]';
	}

	function formatDelta(a: number | null, b: number | null): string {
		if (a === null || b === null) return '--';
		const diff = a - b;
		if (diff === 0) return '=';
		const sign = diff > 0 ? '+' : '';
		if (Math.abs(diff) > 1000) return `${sign}${(diff / 1000).toFixed(1)}k`;
		return `${sign}${diff}`;
	}

	function deltaDurationClass(a: number | null, b: number | null): string {
		if (a === null || b === null) return 'text-[var(--color-text-muted)]';
		if (a < b) return 'text-green-600';
		if (a > b) return 'text-red-600';
		return 'text-[var(--color-text-secondary)]';
	}

	function formatDurationDelta(a: number | null, b: number | null): string {
		if (a === null || b === null) return '--';
		const diff = a - b;
		if (diff === 0) return '=';
		const sign = diff > 0 ? '+' : '';
		return `${sign}${formatDuration(diff)}`;
	}

	// Build a unified step list from both manifests
	let unifiedSteps = $derived.by(() => {
		if (!leftManifest || !rightManifest) return [];
		const allIds = new Set([
			...leftManifest.steps.map(s => s.id),
			...rightManifest.steps.map(s => s.id),
		]);
		return [...allIds].map(id => ({
			id,
			left: leftManifest!.steps.find(s => s.id === id) ?? null,
			right: rightManifest!.steps.find(s => s.id === id) ?? null,
		}));
	});
</script>

<svelte:head>
	<title>Compare | {APP.title}</title>
</svelte:head>

<div class="space-y-6 max-w-5xl">
	<Breadcrumb items={[{ label: 'Runs', href: '/runs' }, { label: 'Compare' }]} />

	<div>
		<h2 class="text-2xl font-bold text-[var(--color-text-primary)]">Compare Runs</h2>
		<p class="text-sm text-[var(--color-text-secondary)] mt-1">Side-by-side comparison of step stats between two pipeline runs.</p>
	</div>

	<!-- Selector -->
	<div class="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg p-4">
		<div class="flex items-end gap-4">
			<div class="flex-1">
				<label for="left" class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Run A</label>
				<select
					id="left"
					bind:value={leftId}
					class="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm bg-[var(--color-bg-surface)] focus:outline-none focus:ring-2 focus:ring-blue-400"
				>
					<option value="">Select a run...</option>
					{#each runs as run (run.runId)}
						<option value={run.runId} disabled={run.runId === rightId}>{run.configName} ({run.runId})</option>
					{/each}
				</select>
			</div>
			<div class="text-[var(--color-text-muted)] pb-2">
				<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
			</div>
			<div class="flex-1">
				<label for="right" class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Run B</label>
				<select
					id="right"
					bind:value={rightId}
					class="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm bg-[var(--color-bg-surface)] focus:outline-none focus:ring-2 focus:ring-blue-400"
				>
					<option value="">Select a run...</option>
					{#each runs as run (run.runId)}
						<option value={run.runId} disabled={run.runId === leftId}>{run.configName} ({run.runId})</option>
					{/each}
				</select>
			</div>
			<button
				onclick={compare}
				disabled={!leftId || !rightId || loading}
				class="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-[var(--color-bg-inset)] disabled:cursor-not-allowed transition-colors active:scale-95"
			>
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
				Compare
			</button>
		</div>
	</div>

	{#if loading}
		<div class="flex items-center justify-center h-32">
			<div class="text-[var(--color-text-muted)] text-sm">Loading comparison...</div>
		</div>
	{:else if error}
		<div class="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">{error}</div>
	{:else if leftManifest && rightManifest}
		<!-- Summary comparison -->
		<div class="grid grid-cols-2 gap-4">
			{#each [leftManifest, rightManifest] as m}
				<div class="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg p-4 space-y-2">
					<div class="flex items-center justify-between">
						<a href="/runs/{m.runId}" class="text-sm font-semibold text-[var(--color-text-primary)] hover:text-blue-700 transition-colors">{m.configName}</a>
						<StatusBadge status={m.status} size="sm" />
					</div>
					<div class="text-xs font-mono text-[var(--color-text-muted)]">{m.runId}</div>
					{#if m.description}
						<div class="text-xs text-[var(--color-text-secondary)]">{m.description}</div>
					{/if}
					<div class="grid grid-cols-3 gap-2 text-xs pt-2 border-t border-[var(--color-border-light)]">
						<div>
							<div class="text-[var(--color-text-muted)]">Steps</div>
							<div class="text-[var(--color-text-primary)]">{m.steps.length}</div>
						</div>
						<div>
							<div class="text-[var(--color-text-muted)]">Input Rows</div>
							<div class="text-[var(--color-text-primary)]">{m.input.rowCount?.toLocaleString() ?? '--'}</div>
						</div>
						<div>
							<div class="text-[var(--color-text-muted)]">Completed</div>
							<div class="text-[var(--color-text-primary)]">{m.steps.filter(s => s.status === 'completed').length}/{m.steps.length}</div>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Step-by-step comparison table -->
		{#if unifiedSteps.length > 0}
			<div class="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden">
				<table class="w-full text-sm">
					<thead>
						<tr class="bg-[var(--color-bg-page)] border-b border-[var(--color-border)]">
							<th class="text-left px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)]">Step</th>
							<th class="text-center px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)]" colspan="2">Status</th>
							<th class="text-center px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)]" colspan="3">Output Rows</th>
							<th class="text-center px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)]" colspan="3">Duration</th>
						</tr>
						<tr class="bg-[var(--color-bg-page)] border-b border-[var(--color-border-light)] text-[10px] text-[var(--color-text-muted)]">
							<th></th>
							<th class="px-3 py-1">A</th>
							<th class="px-3 py-1">B</th>
							<th class="px-3 py-1">A</th>
							<th class="px-3 py-1">B</th>
							<th class="px-3 py-1 text-[var(--color-text-secondary)] font-semibold">Delta</th>
							<th class="px-3 py-1">A</th>
							<th class="px-3 py-1">B</th>
							<th class="px-3 py-1 text-[var(--color-text-secondary)] font-semibold">Delta</th>
						</tr>
					</thead>
					<tbody>
						{#each unifiedSteps as us (us.id)}
							<tr class="border-b border-[var(--color-border-light)] hover:bg-[var(--color-bg-surface-hover)] transition-colors">
								<td class="px-4 py-2">
									<div class="font-medium text-[var(--color-text-primary)] text-xs">{us.left?.name ?? us.right?.name}</div>
									<div class="text-[10px] font-mono text-[var(--color-text-muted)]">{us.left?.fn ?? us.right?.fn}</div>
								</td>
								<td class="px-3 py-2 text-center">{#if us.left}<StatusBadge status={us.left.status} size="sm" />{:else}<span class="text-[var(--color-text-muted)]">--</span>{/if}</td>
								<td class="px-3 py-2 text-center">{#if us.right}<StatusBadge status={us.right.status} size="sm" />{:else}<span class="text-[var(--color-text-muted)]">--</span>{/if}</td>
								<td class="px-3 py-2 text-center text-xs {diffClass(us.left?.outputRowCount ?? null, us.right?.outputRowCount ?? null)}">{us.left?.outputRowCount?.toLocaleString() ?? '--'}</td>
								<td class="px-3 py-2 text-center text-xs {diffClass(us.right?.outputRowCount ?? null, us.left?.outputRowCount ?? null)}">{us.right?.outputRowCount?.toLocaleString() ?? '--'}</td>
								<td class="px-3 py-2 text-center text-xs font-medium {diffClass(us.left?.outputRowCount ?? null, us.right?.outputRowCount ?? null)}">{formatDelta(us.left?.outputRowCount ?? null, us.right?.outputRowCount ?? null)}</td>
								<td class="px-3 py-2 text-center text-xs text-[var(--color-text-secondary)]">{formatDuration(us.left?.durationMs ?? null)}</td>
								<td class="px-3 py-2 text-center text-xs text-[var(--color-text-secondary)]">{formatDuration(us.right?.durationMs ?? null)}</td>
								<td class="px-3 py-2 text-center text-xs font-medium {deltaDurationClass(us.left?.durationMs ?? null, us.right?.durationMs ?? null)}">{formatDurationDelta(us.left?.durationMs ?? null, us.right?.durationMs ?? null)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>
