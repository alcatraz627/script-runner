<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import type { RunSummary, TransformInfo, FileInfo } from '$lib/types';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import Card from '$lib/components/Card.svelte';
	import { APP } from '$lib/constants/app';

	let runs: RunSummary[] = $state([]);
	let transforms: TransformInfo[] = $state([]);
	let files: FileInfo[] = $state([]);
	let loading = $state(true);

	onMount(async () => {
		try {
			[runs, transforms, files] = await Promise.all([
				api.runs.list(),
				api.transforms.list(),
				api.files.list(),
			]);
		} catch { /* ignore */ }
		finally { loading = false; }
	});

	let recentRuns = $derived(runs.slice(0, 6));
	let completedRuns = $derived(runs.filter(r => r.status === 'completed').length);
	let runningRuns = $derived(runs.filter(r => r.status === 'running').length);
	let errorRuns = $derived(runs.filter(r => r.status === 'error').length);
	let draftRuns = $derived(runs.filter(r => r.status === 'draft').length);
	let llmTransforms = $derived(transforms.filter(t => t.hasSystemPrompt).length);
	let totalFiles = $derived(files.length);
	let totalDataSize = $derived(files.reduce((sum, f) => sum + f.sizeBytes, 0));

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

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function progressPercent(run: RunSummary): number {
		if (run.stepsTotal === 0) return 0;
		return Math.round((run.stepsCompleted / run.stepsTotal) * 100);
	}
</script>

<svelte:head>
	<title>Dashboard | {APP.title}</title>
</svelte:head>

<div class="space-y-6 max-w-5xl">
	<div class="flex items-center justify-between">
		<div>
			<h2 class="text-2xl font-bold text-[var(--color-text-primary)]">Dashboard</h2>
			<p class="text-sm text-[var(--color-text-secondary)] mt-1">Overview of your pipeline runs and data.</p>
		</div>
		<div class="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
			<span class="px-2 py-1 rounded bg-[var(--color-bg-inset)] border border-[var(--color-border)] font-mono">{APP.buildTag}</span>
		</div>
	</div>

	{#if loading}
		<div class="flex items-center justify-center h-48">
			<div class="text-[var(--color-text-muted)] text-sm">Loading...</div>
		</div>
	{:else}
		<!-- Stats grid -->
		<div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
			<div class="bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] p-3.5">
				<div class="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-medium">Total Runs</div>
				<div class="text-xl font-bold text-[var(--color-text-primary)] mt-1">{runs.length}</div>
				{#if draftRuns > 0}<div class="text-[10px] text-[var(--color-text-muted)] mt-0.5">{draftRuns} draft</div>{/if}
			</div>
			<div class="bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] p-3.5">
				<div class="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-medium">Completed</div>
				<div class="text-xl font-bold text-emerald-600 mt-1">{completedRuns}</div>
			</div>
			{#if runningRuns > 0}
				<div class="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-3.5">
					<div class="text-[10px] text-blue-600 dark:text-blue-400 uppercase tracking-wider font-medium">Running</div>
					<div class="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1 animate-pulse">{runningRuns}</div>
				</div>
			{/if}
			{#if errorRuns > 0}
				<div class="bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] p-3.5">
					<div class="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-medium">Errors</div>
					<div class="text-xl font-bold text-red-600 mt-1">{errorRuns}</div>
				</div>
			{/if}
			<div class="bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] p-3.5">
				<div class="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-medium">Transforms</div>
				<div class="text-xl font-bold text-[var(--color-text-primary)] mt-1">{transforms.length}</div>
				{#if llmTransforms > 0}<div class="text-[10px] text-purple-600 mt-0.5">{llmTransforms} LLM</div>{/if}
			</div>
			<div class="bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] p-3.5">
				<div class="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-medium">Data Files</div>
				<div class="text-xl font-bold text-[var(--color-text-primary)] mt-1">{totalFiles}</div>
				<div class="text-[10px] text-[var(--color-text-muted)] mt-0.5">{formatSize(totalDataSize)}</div>
			</div>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
			<!-- Recent runs (2/3 width) -->
			<div class="lg:col-span-2">
				<Card title="Recent Runs">
					{#snippet actions()}
						<a href="/runs" class="text-xs text-[var(--color-brand)] hover:text-[var(--color-brand-hover)] transition-colors">View all</a>
					{/snippet}
					{#if recentRuns.length === 0}
						<div class="p-8 text-center text-sm text-[var(--color-text-muted)]">
							No runs yet. <a href="/runs/new" class="text-[var(--color-brand)] hover:text-[var(--color-brand-hover)]">Create one</a>
						</div>
					{:else}
						<div class="divide-y divide-[var(--color-border-light)]">
							{#each recentRuns as run (run.runId)}
								<a href="/runs/{run.runId}" class="flex items-center justify-between px-4 py-3 hover:bg-[var(--color-bg-surface-hover)] transition-colors group">
									<div class="flex items-center gap-3 min-w-0">
										<StatusBadge status={run.status} size="sm" />
										<div class="min-w-0">
											<span class="text-sm font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-brand)] transition-colors">{run.configName}</span>
											<div class="text-[10px] font-mono text-[var(--color-text-muted)] truncate">{run.runId}</div>
										</div>
									</div>
									<div class="flex items-center gap-3 shrink-0">
										{#if run.stepsTotal > 0}
											<div class="flex items-center gap-2">
												<div class="w-16 h-1.5 bg-[var(--color-bg-inset)] rounded-full overflow-hidden">
													<div
														class="h-full rounded-full transition-all {run.status === 'running' ? 'bg-gradient-to-r from-blue-400 via-blue-600 to-blue-400 animate-shimmer' : run.status === 'error' ? 'bg-red-400' : 'bg-gradient-to-r from-emerald-400 to-green-500'}"
														style="width: {progressPercent(run)}%"
													></div>
												</div>
												<span class="text-[10px] text-[var(--color-text-muted)] w-8 text-right">{run.stepsCompleted}/{run.stepsTotal}</span>
											</div>
										{/if}
										<span class="text-[10px] text-[var(--color-text-muted)] w-14 text-right">{relativeTime(run.lastExecutedAt)}</span>
									</div>
								</a>
							{/each}
						</div>
					{/if}
				</Card>
			</div>

			<!-- Quick actions (1/3 width) -->
			<div class="space-y-3">
				<a href="/runs/new" class="flex items-center gap-3 bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] p-4 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm transition-all group">
					<div class="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-900 transition-colors shrink-0">
						<svg class="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
					</div>
					<div>
						<div class="text-sm font-medium text-[var(--color-text-primary)]">New Run</div>
						<div class="text-xs text-[var(--color-text-secondary)]">Create a pipeline</div>
					</div>
				</a>
				<a href="/transforms" class="flex items-center gap-3 bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] p-4 hover:border-purple-300 dark:hover:border-purple-700 hover:shadow-sm transition-all group">
					<div class="w-10 h-10 rounded-lg bg-purple-50 dark:bg-purple-950 flex items-center justify-center group-hover:bg-purple-100 dark:group-hover:bg-purple-900 transition-colors shrink-0">
						<svg class="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
					</div>
					<div>
						<div class="text-sm font-medium text-[var(--color-text-primary)]">Transforms</div>
						<div class="text-xs text-[var(--color-text-secondary)]">{transforms.length} functions ({llmTransforms} LLM)</div>
					</div>
				</a>
				<a href="/runs/compare" class="flex items-center gap-3 bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] p-4 hover:border-green-300 dark:hover:border-green-700 hover:shadow-sm transition-all group">
					<div class="w-10 h-10 rounded-lg bg-green-50 dark:bg-green-950 flex items-center justify-center group-hover:bg-green-100 dark:group-hover:bg-green-900 transition-colors shrink-0">
						<svg class="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
					</div>
					<div>
						<div class="text-sm font-medium text-[var(--color-text-primary)]">Compare</div>
						<div class="text-xs text-[var(--color-text-secondary)]">Side-by-side run diffs</div>
					</div>
				</a>
				<a href="/docs" class="flex items-center gap-3 bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] p-4 hover:border-amber-300 dark:hover:border-amber-700 hover:shadow-sm transition-all group">
					<div class="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-950 flex items-center justify-center group-hover:bg-amber-100 dark:group-hover:bg-amber-900 transition-colors shrink-0">
						<svg class="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>
					</div>
					<div>
						<div class="text-sm font-medium text-[var(--color-text-primary)]">Documentation</div>
						<div class="text-xs text-[var(--color-text-secondary)]">Guides & references</div>
					</div>
				</a>
			</div>
		</div>
	{/if}
</div>
