<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { APP } from '$lib/constants/app';
	import type { RunSummary } from '$lib/types';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';

	let runs: RunSummary[] = $state([]);
	let loading = $state(true);
	let error: string | null = $state(null);
	let interval: ReturnType<typeof setInterval>;
	let search = $state('');
	let statusFilter: 'all' | 'completed' | 'running' | 'error' | 'draft' = $state('all');
	let showArchived = $state(false);

	let filtered = $derived.by(() => {
		let result = runs;
		if (!showArchived) {
			result = result.filter(r => !r.archived);
		}
		if (statusFilter !== 'all') {
			result = result.filter(r => r.status === statusFilter);
		}
		if (search.trim()) {
			const q = search.toLowerCase();
			result = result.filter(r =>
				r.configName.toLowerCase().includes(q) ||
				r.runId.toLowerCase().includes(q) ||
				(r.description ?? '').toLowerCase().includes(q)
			);
		}
		return result;
	});

	let archivedCount = $derived(runs.filter(r => r.archived).length);

	function dateLabel(iso: string | null): string {
		if (!iso) return 'No activity';
		const d = new Date(iso);
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
		const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);
		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Yesterday';
		if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
		return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
	}

	let grouped = $derived.by(() => {
		const groups: { label: string; runs: typeof filtered }[] = [];
		const map = new Map<string, typeof filtered>();
		for (const run of filtered) {
			const label = dateLabel(run.lastExecutedAt ?? run.createdAt);
			if (!map.has(label)) {
				const arr: typeof filtered = [];
				map.set(label, arr);
				groups.push({ label, runs: arr });
			}
			map.get(label)!.push(run);
		}
		return groups;
	});

	async function fetchRuns() {
		try {
			runs = await api.runs.list();
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load runs';
		} finally {
			loading = false;
		}
	}

	function relativeTime(iso: string | null): string {
		if (!iso) return '--';
		const diff = Date.now() - new Date(iso).getTime();
		const seconds = Math.floor(diff / 1000);
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function progressPercent(run: RunSummary): number {
		if (run.stepsTotal === 0) return 0;
		return Math.round((run.stepsCompleted / run.stepsTotal) * 100);
	}

	async function toggleArchive(run: RunSummary) {
		try {
			const result = await api.runs.toggleArchive(run.runId);
			run.archived = result.archived;
			runs = [...runs];
		} catch { /* ignore */ }
	}

	onMount(() => {
		fetchRuns();
		interval = setInterval(fetchRuns, 5000);
	});

	onDestroy(() => {
		if (interval) clearInterval(interval);
	});
</script>

<svelte:head>
	<title>Runs | {APP.title}</title>
</svelte:head>

<div class="space-y-6">
	<Breadcrumb items={[{ label: 'Runs' }]} />

	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h2 class="text-2xl font-bold text-[var(--color-text-primary)]">Runs</h2>
			<p class="text-sm text-[var(--color-text-secondary)] mt-1">
				Each run is a pipeline that transforms input data through a sequence of steps.
				Click a run to view its steps, inspect output data, or execute the pipeline.
			</p>
		</div>
		<a
			href="/runs/new"
			class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shrink-0"
		>
			New Run
		</a>
	</div>

	<!-- Content -->
	{#if loading}
		<div class="flex items-center justify-center h-48">
			<div class="text-[var(--color-text-muted)] text-sm">Loading runs...</div>
		</div>
	{:else if error}
		<div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
			{error}
		</div>
	{:else if runs.length === 0}
		<div class="bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] p-12 text-center">
			<svg class="mx-auto h-12 w-12 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
			</svg>
			<h3 class="mt-4 text-sm font-medium text-[var(--color-text-primary)]">No runs yet</h3>
			<p class="mt-1 text-sm text-[var(--color-text-secondary)]">Create a run directory with a run.config.js to get started.</p>
		</div>
	{:else}
		<!-- Search & Filter -->
		<div class="flex items-center justify-between gap-3">
			<input
				type="text"
				bind:value={search}
				placeholder="Search by name, ID, or description..."
				class="px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg-surface)] focus:outline-none focus:ring-1 focus:ring-blue-400 w-72"
			/>
			<div class="flex items-center gap-1">
				{#each ['all', 'completed', 'running', 'error', 'draft'] as s (s)}
					<button
						onclick={() => { statusFilter = s as typeof statusFilter; }}
						class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors {statusFilter === s ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface-hover)] border border-transparent'}"
					>
						{s === 'all' ? `All (${runs.filter(r => showArchived || !r.archived).length})` : `${s[0].toUpperCase() + s.slice(1)} (${runs.filter(r => r.status === s && (showArchived || !r.archived)).length})`}
					</button>
				{/each}
				{#if archivedCount > 0}
					<span class="mx-1 text-[var(--color-border)]">|</span>
					<button
						onclick={() => { showArchived = !showArchived; }}
						class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors {showArchived ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface-hover)] border border-transparent'}"
					>
						{showArchived ? 'Hide' : 'Show'} Archived ({archivedCount})
					</button>
				{/if}
			</div>
		</div>

		{#if filtered.length === 0}
			<div class="bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">
				No runs match your search.
			</div>
		{/if}

		{#each grouped as group (group.label)}
			<div class="space-y-2">
				<h3 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] px-1">{group.label}</h3>
				<div class="grid gap-2">
					{#each group.runs as run (run.runId)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							onclick={(e) => { if ((e.target as HTMLElement).closest('[data-no-nav]')) return; goto(`/runs/${run.runId}`); }}
							onkeydown={(e) => { if (e.key === 'Enter') goto(`/runs/${run.runId}`); }}
							role="button"
							tabindex="0"
							class="bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] p-4 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-sm transition-all text-left w-full group cursor-pointer"
						>
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3 min-w-0">
									<StatusBadge status={run.status} size="md" />
									<div class="min-w-0">
										<div class="flex items-center gap-2">
											{#if run.starred}
												<svg class="w-3.5 h-3.5 text-yellow-400 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>
											{/if}
											<span class="text-sm font-semibold text-[var(--color-text-primary)] group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">{run.configName}</span>
											<span class="text-xs font-mono text-[var(--color-text-muted)]">{run.runId}</span>
											{#if run.archived}
												<span class="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">archived</span>
											{/if}
										</div>
										{#if run.description}
											<div class="text-xs text-[var(--color-text-secondary)] mt-0.5 truncate max-w-lg">{run.description}</div>
										{/if}
									</div>
								</div>
								<div class="flex items-center gap-6 shrink-0">
									<!-- Progress -->
									{#if run.stepsTotal > 0}
										<div class="flex items-center gap-2">
											<div class="w-20 h-1.5 bg-[var(--color-bg-inset)] rounded-full overflow-hidden">
												<div
													class="h-full rounded-full transition-all {run.status === 'error' ? 'bg-red-400' : run.status === 'running' ? 'bg-gradient-to-r from-blue-400 via-blue-600 to-blue-400 animate-shimmer' : run.status === 'interrupted' ? 'bg-yellow-400' : 'bg-gradient-to-r from-emerald-400 to-green-500'}"
													style="width: {progressPercent(run)}%"
												></div>
											</div>
											<span class="text-xs text-[var(--color-text-secondary)] w-12 text-right">{run.stepsCompleted}/{run.stepsTotal}</span>
										</div>
									{:else}
										<span class="text-xs text-[var(--color-text-muted)]">No steps</span>
									{/if}
									<!-- Time -->
									<span class="text-xs text-[var(--color-text-muted)] w-16 text-right">{relativeTime(run.lastExecutedAt)}</span>
									<!-- Archive -->
									<button
										data-no-nav
										onclick={(e) => { e.stopPropagation(); toggleArchive(run); }}
										class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-amber-50 dark:hover:bg-amber-900/20"
										title={run.archived ? 'Unarchive' : 'Archive'}
									>
										<svg class="w-3.5 h-3.5 {run.archived ? 'text-amber-500' : 'text-[var(--color-text-muted)]'}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H2.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
										</svg>
									</button>
									<!-- Arrow -->
									<svg class="w-4 h-4 text-[var(--color-text-muted)] group-hover:text-blue-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
									</svg>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</div>
