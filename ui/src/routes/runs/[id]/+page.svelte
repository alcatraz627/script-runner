<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { api } from '$lib/api';
	import { APP } from '$lib/constants/app';
	import type { RunManifest, StepManifest, TransformInfo } from '$lib/types';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import RunConfig from '$lib/components/RunConfig.svelte';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import PipelineFlow from '$lib/components/PipelineFlow.svelte';
	import { toast } from '$lib/stores/toast.svelte';

	let manifest: RunManifest | null = $state(null);
	let transformInfoMap: Record<string, TransformInfo> = $state({});
	let loading = $state(true);
	let error: string | null = $state(null);
	let expandedStep: string | null = $state(null);
	let showConfig = $state(false);

	// Inline title editing
	let editingTitle = $state(false);
	let editTitle = $state('');
	let savingTitle = $state(false);

	// Inline description editing
	let editingDescription = $state(false);
	let editDescription = $state('');
	let savingDescription = $state(false);

	// Fork state
	let showFork = $state(false);
	let forkId = $state('');
	let forkCopyThrough: string | null = $state(null);
	let forking = $state(false);
	let forkError: string | null = $state(null);

	// Delete state
	let showDeleteConfirm = $state(false);
	let deleting = $state(false);

	// Copy ID
	let copied = $state(false);

	// Starred
	let starred = $state(false);

	// Report state
	let showReportDialog = $state(false);
	let reportInstructions = $state('');
	let generatingReport = $state(false);
	let reportResult: { markdown: string; path: string; message: string } | null = $state(null);

	// Execution state
	let executing = $state(false);
	let cancelling = $state(false);
	let jobId: string | null = $state(null);
	let events: Array<{ type: string; message?: string; stepId?: string; [key: string]: unknown }> = $state([]);
	let eventSource: EventSource | null = $state(null);
	let executeError: string | null = $state(null);

	// Step logs
	let stepLogs: Record<string, Array<Record<string, unknown>>> = $state({});
	let stepLogsLoading: Record<string, boolean> = $state({});
	let stepLogsOpen: Record<string, boolean> = $state({});

	const runId = $derived(page.params.id ?? '');

	async function fetchManifest() {
		loading = true;
		try {
			manifest = await api.runs.get(runId);
			starred = manifest.starred || false;
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load run';
		} finally {
			loading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (showDeleteConfirm) { showDeleteConfirm = false; return; }
			if (showFork) { showFork = false; return; }
			if (showConfig) { showConfig = false; return; }
		}
	}

	async function loadTransformInfo() {
		try {
			const transforms = await api.transforms.list();
			for (const t of transforms) {
				transformInfoMap[t.name] = t;
			}
			transformInfoMap = { ...transformInfoMap };
		} catch { /* ignore */ }
	}

	onMount(async () => {
		await fetchManifest();
		loadTransformInfo();
		// Reconnect to SSE if a job is still active
		if (manifest && (manifest.status === 'running' || manifest.steps.some(s => s.status === 'running'))) {
			await reconnectToActiveJob();
		}
		document.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		closeEventSource();
		document.removeEventListener('keydown', handleKeydown);
	});

	function closeEventSource() {
		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}
	}

	/** Process a single SSE event — updates the in-memory manifest state so
	 *  step status badges and row counts update in real time without re-fetching.
	 *  Terminal events (done, step-error) trigger a full manifest re-fetch. */
	function applyEvent(event: Record<string, unknown>) {
		if (!manifest) return;

		if (event.type === 'step-start' && event.stepId) {
			const step = manifest.steps.find((s) => s.id === event.stepId);
			if (step) {
				step.status = 'running';
				step.stale = false;
				manifest = { ...manifest };
			}
		} else if (event.type === 'step-complete' && event.stepId) {
			const step = manifest.steps.find((s) => s.id === event.stepId);
			if (step) {
				step.status = 'completed';
				step.outputRowCount = (event.rowCount as number) ?? null;
				step.durationMs = (event.durationMs as number) ?? null;
				manifest = { ...manifest };
			}
		} else if (event.type === 'step-error' && event.stepId) {
			const step = manifest.steps.find((s) => s.id === event.stepId);
			if (step) {
				step.status = 'error';
				step.error = (event.error as string) ?? null;
				step.durationMs = (event.durationMs as number) ?? null;
				manifest = { ...manifest };
			}
		} else if (event.type === 'import' && event.rowCount) {
			manifest.input.rowCount = event.rowCount as number;
			manifest = { ...manifest };
		}
	}

	/** Open SSE stream to /api/runs/:id/events and wire up event handling.
	 *  Events are appended to the events array for the execution log display,
	 *  and also applied to the manifest for real-time status badge updates. */
	function connectSSE() {
		const es = new EventSource(`/api/runs/${runId}/events`);
		eventSource = es;

		es.onmessage = (e) => {
			try {
				const event = JSON.parse(e.data);
				events = [...events, event];
				applyEvent(event);

				if (event.type === 'done' || event.type === 'stream-end') {
					closeEventSource();
					executing = false;
					fetchManifest();
				}

				if (event.type === 'interrupted') {
					closeEventSource();
					executing = false;
					toast.info('Run cancelled');
					fetchManifest();
				}

				if (event.type === 'step-error') {
					executeError = (event.error as string) || 'Step failed';
					closeEventSource();
					executing = false;
					fetchManifest();
				}
			} catch {
				// ignore parse errors
			}
		};

		es.onerror = () => {
			closeEventSource();
			executing = false;
			fetchManifest();
		};
	}

	/** Reconnect to an in-progress job after page reload.
	 *  Fetches buffered events from the active-job endpoint, replays them into
	 *  the manifest state, then connects SSE for live updates going forward. */
	async function reconnectToActiveJob() {
		try {
			const result = await api.runs.activeJob(runId);
			if (!result.active) {
				await fetchManifest();
				return;
			}

			jobId = result.jobId ?? null;
			executing = true;

			// SSE replays all buffered events on connect — no manual replay needed
			connectSSE();
		} catch {
			await fetchManifest();
		}
	}

	async function executeRun(opts?: { step?: string; fromStep?: string }) {
		if (executing) return;
		executing = true;
		executeError = null;
		events = [];

		try {
			const result = await api.runs.execute(runId, opts);
			jobId = result.jobId;

			// Connect SSE immediately — server replays buffered events
			connectSSE();
			// Fire-and-forget manifest refresh (don't block SSE connection)
			fetchManifest();
		} catch (e) {
			executeError = e instanceof Error ? e.message : 'Failed to start execution';
			executing = false;
		}
	}

	async function cancelRun() {
		if (!jobId || cancelling) return;
		cancelling = true;
		try {
			await api.jobs.cancel(jobId);
			toast.info('Cancelling run...');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to cancel');
		} finally {
			cancelling = false;
		}
	}

	/** Load persisted logs for a completed/error step */
	async function toggleStepLogs(stepId: string, e: MouseEvent) {
		e.stopPropagation();
		if (stepLogsOpen[stepId]) {
			stepLogsOpen = { ...stepLogsOpen, [stepId]: false };
			return;
		}
		stepLogsLoading = { ...stepLogsLoading, [stepId]: true };
		stepLogsOpen = { ...stepLogsOpen, [stepId]: true };
		try {
			const result = await api.runs.stepLogs(runId, stepId);
			stepLogs = { ...stepLogs, [stepId]: result.events };
		} catch {
			stepLogs = { ...stepLogs, [stepId]: [] };
		} finally {
			stepLogsLoading = { ...stepLogsLoading, [stepId]: false };
		}
	}

	function toggleStep(stepId: string) {
		expandedStep = expandedStep === stepId ? null : stepId;
	}

	function openForkDialog() {
		forkId = runId + '-fork';
		forkCopyThrough = null;
		forkError = null;
		showFork = true;
	}

	async function handleFork() {
		if (!forkId.trim()) return;
		forking = true;
		forkError = null;
		try {
			await api.runs.fork(runId, forkId.trim(), forkCopyThrough ?? undefined);
			goto(`/runs/${forkId.trim()}`);
		} catch (e) {
			forkError = e instanceof Error ? e.message : 'Fork failed';
		} finally {
			forking = false;
		}
	}

	async function generateReport() {
		if (!manifest) return;
		generatingReport = true;
		try {
			const result = await api.runs.report(runId, reportInstructions.trim() || undefined);
			reportResult = result;
		} catch (e) {
			reportResult = { markdown: '', path: '', message: e instanceof Error ? e.message : 'Report generation failed' };
		} finally {
			generatingReport = false;
		}
	}

	async function handleDelete() {
		deleting = true;
		try {
			await api.runs.delete(runId);
			goto('/runs');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Delete failed';
			showDeleteConfirm = false;
		} finally {
			deleting = false;
		}
	}

	async function saveTitle() {
		if (!editTitle.trim() || !manifest) return;
		savingTitle = true;
		try {
			await api.runs.updateConfig(runId, { name: editTitle.trim() });
			manifest.configName = editTitle.trim();
			manifest = { ...manifest };
			editingTitle = false;
		} catch { /* ignore */ }
		finally { savingTitle = false; }
	}

	async function saveDescription() {
		if (!manifest) return;
		savingDescription = true;
		try {
			await api.runs.updateConfig(runId, { description: editDescription.trim() });
			manifest.description = editDescription.trim();
			manifest = { ...manifest };
			editingDescription = false;
		} catch { /* ignore */ }
		finally { savingDescription = false; }
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

	function formatDate(iso: string | null): string {
		if (!iso) return '--';
		return new Date(iso).toLocaleString();
	}

	function stepStatusColor(step: StepManifest): string {
		if (step.stale) return 'border-l-amber-400';
		switch (step.status) {
			case 'completed': return 'border-l-green-400';
			case 'running':   return 'border-l-blue-400';
			case 'awaiting':  return 'border-l-purple-400';
			case 'error':     return 'border-l-red-400';
			default:          return 'border-l-[var(--color-border)]';
		}
	}

	async function approveStep(stepId: string) {
		try {
			await api.runs.approve(runId, stepId);
			await fetchManifest();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Approval failed');
		}
	}

	function openDashboard(step: StepManifest) {
		const dashboardId = (step as unknown as Record<string, unknown>).dashboardId as string | undefined;
		if (!dashboardId) return;
		const params = new URLSearchParams({
			runId,
			stepId: step.id,
			dashboardId,
			dataStep: manifest?.steps[manifest.steps.findIndex(s => s.id === step.id) - 1]?.id || '',
		});
		window.open(
			`http://localhost:3460/dashboards/${dashboardId}/?${params}`,
			`dashboard-${dashboardId}`,
			'width=1280,height=900,menubar=no,toolbar=no'
		);
	}

	let lastEvent = $derived.by(() => events.length > 0 ? events[events.length - 1] : null);

	// Auto-scroll execution log to bottom
	$effect(() => {
		if (events.length > 0) {
			const el = document.getElementById('execution-log');
			if (el) requestAnimationFrame(() => el.scrollTop = el.scrollHeight);
		}
	});
</script>

<svelte:head>
	<title>{manifest ? manifest.configName : "Run"} | {APP.title}</title>
</svelte:head>

{#if loading}
	<div class="flex items-center justify-center h-48">
		<div class="text-[var(--color-text-muted)] text-sm">Loading run...</div>
	</div>
{:else if error}
	<div class="space-y-4">
		<Breadcrumb items={[{ label: 'Runs', href: '/runs' }, { label: runId }]} />
		<div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
	</div>
{:else if manifest}
	<div class="space-y-6 max-w-5xl">
		<Breadcrumb items={[{ label: 'Runs', href: '/runs' }, { label: manifest.configName }]} />

		<!-- Header Card -->
		<div class="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
			<!-- Top row: Title + star + status -->
			<div class="flex items-start gap-3">
				<button
					onclick={async () => { const result = await api.runs.toggleStar(runId); starred = result.starred; }}
					class="mt-1 transition-all hover:scale-110 active:scale-95 shrink-0"
					title={starred ? 'Unstar run' : 'Star run'}
				>
					{#if starred}
						<svg class="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 24 24"><path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>
					{:else}
						<svg class="w-5 h-5 text-[var(--color-text-muted)] hover:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>
					{/if}
				</button>
				<div class="flex-1 min-w-0">
					{#if editingTitle}
						<form onsubmit={(e) => { e.preventDefault(); saveTitle(); }} class="flex items-center gap-2">
							<input
								type="text"
								bind:value={editTitle}
								class="text-2xl font-bold text-[var(--color-text-primary)] border-b-2 border-blue-400 bg-transparent focus:outline-none px-0 py-0"
								autofocus
							/>
							<button type="submit" disabled={savingTitle} class="text-xs text-blue-600 hover:text-blue-800">Save</button>
							<button type="button" onclick={() => { editingTitle = false; }} class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Cancel</button>
						</form>
					{:else}
						<button
							onclick={() => { editTitle = manifest?.configName ?? ''; editingTitle = true; }}
							class="text-2xl font-bold text-[var(--color-text-primary)] hover:text-blue-700 transition-colors cursor-text text-left"
							title="Click to edit name"
						>
							{manifest.configName}
						</button>
					{/if}
					<div class="flex items-center gap-3 mt-1">
						<button
							onclick={() => { navigator.clipboard.writeText(manifest?.runId ?? ''); copied = true; setTimeout(() => { copied = false; }, 1500); }}
							class="text-xs font-mono text-[var(--color-text-muted)] hover:text-blue-600 transition-colors flex items-center gap-1 group"
							title="Copy run ID"
						>
							{manifest.runId}
							{#if copied}
								<svg class="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
							{:else}
								<svg class="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>
							{/if}
						</button>
					</div>
				</div>
				<div class="flex items-center gap-2 shrink-0">
					<StatusBadge status={manifest.status} size="md" />
					{#if manifest.steps.some(s => s.stale)}
						<span class="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
							Has stale steps
						</span>
					{/if}
				</div>
			</div>

			<!-- Description -->
			{#if editingDescription}
				<form onsubmit={(e) => { e.preventDefault(); saveDescription(); }} class="flex items-start gap-2">
					<textarea
						bind:value={editDescription}
						rows={2}
						class="flex-1 text-sm text-[var(--color-text-secondary)] border border-blue-300 rounded-md bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 px-2 py-1 resize-none"
						autofocus
					></textarea>
					<button type="submit" disabled={savingDescription} class="text-xs text-blue-600 hover:text-blue-800 mt-1">Save</button>
					<button type="button" onclick={() => { editingDescription = false; }} class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] mt-1">Cancel</button>
				</form>
			{:else}
				<button
					onclick={() => { editDescription = manifest?.description ?? ''; editingDescription = true; }}
					class="text-sm text-[var(--color-text-secondary)] text-left hover:text-[var(--color-text-primary)] transition-colors cursor-text block"
					title="Click to edit description"
				>
					{manifest.description || 'Add a description...'}
				</button>
			{/if}

			<!-- Toolbar -->
			<div class="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-[var(--color-border-light)]">
				{#if executing}
					<div class="flex items-center gap-2 text-sm text-blue-600 mr-auto">
						<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						<span>Running...</span>
					</div>
					<button
						onclick={cancelRun}
						disabled={cancelling}
						class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors active:scale-95 cursor-pointer whitespace-nowrap"
					>
						<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
						{cancelling ? 'Stopping...' : 'Stop'}
					</button>
				{:else}
					<button
						onclick={() => executeRun()}
						disabled={manifest.steps.length === 0}
						class="inline-flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-[var(--color-bg-inset)] disabled:cursor-not-allowed transition-colors active:scale-95 whitespace-nowrap"
					>
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" /></svg>
						Run All
					</button>
					{#if manifest.steps.some(s => s.status === 'completed')}
						<div class="relative group">
							<button
								class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-text-secondary)] text-sm font-medium rounded-lg hover:bg-[var(--color-bg-surface-hover)] transition-colors active:scale-95 whitespace-nowrap"
							>
								<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.688c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 010 1.953l-7.108 4.062A1.125 1.125 0 013 16.81V8.688zM12.75 8.688c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 010 1.953l-7.108 4.062a1.125 1.125 0 01-1.683-.977V8.688z" /></svg>
								Run From...
							</button>
							<div class="absolute right-0 top-full mt-1 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg shadow-lg py-1 z-10 min-w-48 hidden group-hover:block">
								{#each manifest.steps as step (step.id)}
									<button
										onclick={() => executeRun({ fromStep: step.id })}
										class="w-full text-left px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-700 dark:hover:text-blue-400 transition-colors"
									>
										From: {step.name}
									</button>
								{/each}
							</div>
						</div>
					{/if}
				{/if}
				<button
					onclick={() => { showConfig = !showConfig; }}
					class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-text-secondary)] text-sm font-medium rounded-lg hover:bg-[var(--color-bg-surface-hover)] transition-colors active:scale-95 whitespace-nowrap {showConfig ? 'bg-[var(--color-bg-inset)]' : ''}"
				>
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
					{showConfig ? 'Hide Config' : 'Config'}
				</button>
				<button
					onclick={() => { showReportDialog = true; }}
					class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-text-secondary)] text-sm font-medium rounded-lg hover:bg-[var(--color-bg-surface-hover)] transition-colors active:scale-95 whitespace-nowrap"
				>
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
					Report
				</button>
				<button
					onclick={openForkDialog}
					class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-text-secondary)] text-sm font-medium rounded-lg hover:bg-[var(--color-bg-surface-hover)] transition-colors active:scale-95 whitespace-nowrap"
				>
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" /></svg>
					Fork
				</button>
				<button
					onclick={() => { showDeleteConfirm = true; }}
					class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm font-medium rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-300 dark:hover:border-red-700 transition-colors active:scale-95 whitespace-nowrap"
				>
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
					Delete
				</button>
			</div>
		</div>

		<!-- Fork dialog -->
		{#if showFork}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in" onclick={() => { showFork = false; }}>
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div class="bg-[var(--color-bg-surface)] rounded-xl shadow-2xl w-[28rem] animate-slide-up overflow-hidden" onclick={(e: MouseEvent) => e.stopPropagation()}>
					<!-- Header -->
					<div class="px-5 pt-5 pb-3">
						<div class="flex items-center gap-3">
							<div class="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
								<svg class="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" /></svg>
							</div>
							<div>
								<h3 class="text-lg font-semibold text-[var(--color-text-primary)]">Fork Run</h3>
								<p class="text-xs text-[var(--color-text-muted)]">from {manifest.configName}</p>
							</div>
						</div>
					</div>

					<div class="px-5 pb-5 space-y-4">
						{#if forkError}
							<div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-700 dark:text-red-400 text-xs">{forkError}</div>
						{/if}

						<div>
							<label for="forkId" class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">New Run ID</label>
							<input
								id="forkId"
								type="text"
								bind:value={forkId}
								class="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm font-mono bg-[var(--color-bg-surface)] focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-shadow"
							/>
						</div>

						{#if manifest.steps.some(s => s.status === 'completed')}
							<div>
								<label class="block text-xs font-medium text-[var(--color-text-secondary)] mb-2">Copy data through</label>
								<div class="space-y-1.5 max-h-48 overflow-y-auto">
									<button
										onclick={() => { forkCopyThrough = null; }}
										class="w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left text-sm transition-all {forkCopyThrough === null ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-[var(--color-border)] hover:border-[var(--color-border)] hover:bg-[var(--color-bg-surface-hover)]'}"
									>
										<span class="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 {forkCopyThrough === null ? 'border-blue-500' : 'border-[var(--color-border)]'}">
											{#if forkCopyThrough === null}<span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>{/if}
										</span>
										<span class="text-[var(--color-text-secondary)]">Config only — no data</span>
									</button>
									{#each manifest.steps.filter(s => s.status === 'completed') as step (step.id)}
										<button
											onclick={() => { forkCopyThrough = step.id; }}
											class="w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left text-sm transition-all {forkCopyThrough === step.id ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-[var(--color-border)] hover:border-[var(--color-border)] hover:bg-[var(--color-bg-surface-hover)]'}"
										>
											<span class="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 {forkCopyThrough === step.id ? 'border-blue-500' : 'border-[var(--color-border)]'}">
												{#if forkCopyThrough === step.id}<span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>{/if}
											</span>
											<div class="flex-1 min-w-0">
												<span class="text-[var(--color-text-primary)] font-medium">{step.name}</span>
												<span class="text-xs text-[var(--color-text-muted)] ml-2">{step.outputRowCount?.toLocaleString()} rows</span>
											</div>
											<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
										</button>
									{/each}
								</div>
							</div>
						{/if}

						<div class="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border-light)]">
							<button onclick={() => { showFork = false; }} class="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-lg hover:bg-[var(--color-bg-surface-hover)] transition-colors">Cancel</button>
							<button
								onclick={handleFork}
								disabled={forking || !forkId.trim()}
								class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-[var(--color-bg-inset)] disabled:text-[var(--color-text-muted)] transition-all active:scale-[0.98]"
							>
								{#if forking}
									<span class="inline-flex items-center gap-2">
										<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
										Forking...
									</span>
								{:else}
									Fork Run
								{/if}
							</button>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Delete confirmation -->
		{#if showDeleteConfirm}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in" onclick={() => { showDeleteConfirm = false; }}>
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div class="bg-[var(--color-bg-surface)] rounded-xl shadow-2xl p-5 w-96 space-y-4 animate-slide-up" onclick={(e: MouseEvent) => e.stopPropagation()}>
					<h3 class="text-lg font-semibold text-[var(--color-text-primary)]">Delete Run</h3>
					<p class="text-sm text-[var(--color-text-secondary)]">
						Permanently delete <strong>{manifest.configName}</strong> and all its data? This cannot be undone.
					</p>
					<div class="flex items-center justify-end gap-2 pt-2">
						<button onclick={() => { showDeleteConfirm = false; }} class="px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">Cancel</button>
						<button
							onclick={handleDelete}
							disabled={deleting}
							class="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:bg-[var(--color-bg-inset)] transition-colors"
						>
							{deleting ? 'Deleting...' : 'Delete'}
						</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- Config panel -->
		{#if showConfig}
			<div class="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg p-4">
				<h3 class="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">Run Configuration</h3>
				<RunConfig {runId} onConfigSaved={() => { showConfig = false; fetchManifest(); }} />
			</div>
		{/if}

		<!-- Pipeline Flow Visualization -->
		{#if manifest.steps.length > 0}
			<PipelineFlow {manifest} activeStep={expandedStep} onStepClick={toggleStep} />
		{/if}

		<!-- Execution error -->
		{#if executeError}
			<div class="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
				{executeError}
			</div>
		{/if}

		<!-- Live event log -->
		{#if events.length > 0}
			<div class="bg-[var(--color-code-bg)] rounded-lg p-4 max-h-64 overflow-y-auto scroll-smooth" id="execution-log">
				<div class="flex items-center justify-between mb-2">
					<h3 class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Execution Log</h3>
					{#if !executing}
						<button
							onclick={() => { events = []; }}
							class="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-muted)]"
						>Clear</button>
					{/if}
				</div>
				<div class="space-y-0.5 font-mono text-xs">
					{#each events as event, ei (ei)}
						<div class={
							event.type === 'step-error' ? 'text-red-400' :
							event.type === 'step-complete' || event.type === 'done' ? 'text-green-400' :
							event.type === 'step-start' ? 'text-blue-400' :
							event.type === 'interrupted' ? 'text-yellow-400' :
							event.type === 'info' ? 'text-cyan-400/70' :
							'text-[var(--color-text-muted)]'
						}>
							{#if event.type === 'step-start'}
								<span class="text-[var(--color-text-secondary)]">&#9654;</span> {event.message || `Starting ${event.stepId}`}
							{:else if event.type === 'step-complete'}
								<span class="text-green-600">&#10003;</span> {event.message || `${event.stepId} complete`}
								{#if event.rowCount}<span class="text-[var(--color-text-secondary)]"> ({event.rowCount} rows, {formatDuration(event.durationMs as number | null)})</span>{/if}
							{:else if event.type === 'step-error'}
								<span class="text-red-600">&#10007;</span> {event.message || event.error}
							{:else if event.type === 'interrupted'}
								<span class="text-yellow-600">&#9632;</span> {event.message || 'Pipeline cancelled'}
							{:else if event.type === 'import'}
								<span class="text-[var(--color-text-secondary)]">&#8615;</span> {event.message}
							{:else if event.type === 'info'}
								<span class="text-cyan-600/60">&#8227;</span> {event.message}
							{:else if event.type === 'done'}
								<span class="text-green-600">&#10003;</span> Pipeline complete
							{:else if event.type !== 'stream-end'}
								<span class="text-[var(--color-text-secondary)]">&middot;</span> {event.message || event.type}
							{/if}
						</div>
					{/each}
					{#if executing && lastEvent}
						<div class="text-[var(--color-text-secondary)] animate-pulse">&hellip;</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Input info -->
		<div class="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg p-4">
			<h3 class="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">Input</h3>
			<div class="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
				<div>
					<div class="text-[var(--color-text-muted)] text-xs">File</div>
					<div class="text-[var(--color-text-primary)] font-mono text-xs mt-0.5 truncate" title={manifest.input.file || ''}>{manifest.input.file || '--'}</div>
				</div>
				<div>
					<div class="text-[var(--color-text-muted)] text-xs">Sheet</div>
					<div class="text-[var(--color-text-primary)] mt-0.5">{manifest.input.sheet || '--'}</div>
				</div>
				<div>
					<div class="text-[var(--color-text-muted)] text-xs">Rows</div>
					<div class="text-[var(--color-text-primary)] font-semibold mt-0.5">{manifest.input.rowCount?.toLocaleString() ?? '--'}</div>
				</div>
				<div>
					<div class="text-[var(--color-text-muted)] text-xs">Size</div>
					<div class="text-[var(--color-text-primary)] mt-0.5">{formatBytes(manifest.input.sizeBytes)}</div>
				</div>
				<div>
					<div class="text-[var(--color-text-muted)] text-xs">Imported</div>
					<div class="text-[var(--color-text-primary)] mt-0.5">{formatDate(manifest.input.importedAt)}</div>
				</div>
			</div>
		</div>

		<!-- Steps -->
		<div>
			<h3 class="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">
				Steps ({manifest.steps.filter(s => s.status === 'completed').length}/{manifest.steps.length})
			</h3>
			{#if manifest.steps.length === 0}
				<div class="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg p-8 text-center text-sm text-[var(--color-text-muted)]">
					No steps configured. Add steps to the run config to get started.
				</div>
			{:else}
				<div class="space-y-2">
					{#each manifest.steps as step, i (step.id)}
						<div class="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden border-l-4 {stepStatusColor(step)}">
							<!-- Step header -->
							<button
								onclick={() => toggleStep(step.id)}
								class="w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--color-bg-surface-hover)] transition-colors text-left"
							>
								<div class="flex items-center gap-3">
									<span class="text-xs font-mono text-[var(--color-text-muted)] w-5">{i + 1}</span>
									<div>
										<div class="flex items-center gap-2">
											<span class="text-sm font-medium text-[var(--color-text-primary)]">{step.name}</span>
											<span class="text-xs font-mono text-[var(--color-text-muted)]">({step.fn})</span>
											{#if step.stale}
												<span class="text-xs text-amber-600">stale</span>
											{/if}
										</div>
										{#if step.description}
											<div class="text-xs text-[var(--color-text-secondary)] mt-0.5">{step.description}</div>
										{/if}
									</div>
								</div>
								<div class="flex items-center gap-4">
									<!-- Awaiting: open dashboard + approve buttons -->
									{#if step.status === 'awaiting'}
										{@const dashId = (step as unknown as Record<string,unknown>).dashboardId as string|undefined}
										{#if dashId}
											<span
												role="button"
												tabindex="0"
												onclick={(e: MouseEvent) => { e.stopPropagation(); openDashboard(step); }}
												onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.stopPropagation(); openDashboard(step); } }}
												class="inline-flex items-center gap-1 px-2 py-1 text-xs text-purple-700 border border-purple-200 bg-purple-50 rounded hover:bg-purple-100 transition-colors active:scale-95 cursor-pointer select-none"
												title="Open review dashboard"
											>
												<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
												Open Dashboard
											</span>
										{/if}
										<span
											role="button"
											tabindex="0"
											onclick={(e: MouseEvent) => { e.stopPropagation(); approveStep(step.id); }}
											onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.stopPropagation(); approveStep(step.id); } }}
											class="inline-flex items-center gap-1 px-2 py-1 text-xs text-purple-700 border border-purple-300 bg-purple-100 rounded hover:bg-purple-200 transition-colors active:scale-95 cursor-pointer select-none font-medium"
											title="Approve and continue pipeline"
										>
											✓ Approve
										</span>
									{/if}
									<!-- Run single step -->
									{#if !executing && step.status !== 'running' && step.status !== 'awaiting'}
										<span
											role="button"
											tabindex="0"
											onclick={(e: MouseEvent) => { e.stopPropagation(); executeRun({ step: step.id }); }}
											onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.stopPropagation(); executeRun({ step: step.id }); } }}
											class="inline-flex items-center gap-1 px-2 py-1 text-xs text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors active:scale-95 cursor-pointer select-none"
											title="Run only this step"
										>
											<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" /></svg>
											Run
										</span>
									{/if}
									<!-- Open posters folder (download-posters step only) -->
									{#if step.fn === 'download-posters' && step.status === 'completed'}
										<span
											role="button"
											tabindex="0"
											onclick={(e: MouseEvent) => { e.stopPropagation(); api.runs.openPosters(runId); }}
											onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.stopPropagation(); api.runs.openPosters(runId); } }}
											class="inline-flex items-center gap-1 px-2 py-1 text-xs text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 transition-colors active:scale-95 cursor-pointer select-none"
											title="Open posters folder in Finder"
										>
											<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>
											Open
										</span>
									{/if}
									<!-- Step stats -->
									<div class="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
										{#if step.outputRowCount !== null}
											<span>{step.outputRowCount.toLocaleString()} rows</span>
										{/if}
										{#if step.outputSizeBytes !== null}
											<span>{formatBytes(step.outputSizeBytes)}</span>
										{/if}
										{#if step.durationMs !== null}
											<span>{formatDuration(step.durationMs)}</span>
										{/if}
									</div>
									<StatusBadge status={step.status} />
									{#if step.status === 'running'}
										<div class="w-16 h-1.5 rounded-full bg-blue-100 dark:bg-blue-900/30 overflow-hidden">
											<div class="h-full w-full rounded-full bg-gradient-to-r from-blue-400 via-blue-600 to-blue-400 animate-shimmer"></div>
										</div>
									{:else}
										<!-- Expand arrow -->
										<svg
											class="w-4 h-4 text-[var(--color-text-muted)] transition-transform {expandedStep === step.id ? 'rotate-180' : ''}"
											fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
										>
											<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
										</svg>
									{/if}
								</div>
							</button>

							<!-- Expanded: step details + data table -->
							{#if expandedStep === step.id}
								<div class="border-t border-[var(--color-border-light)] px-4 py-3 space-y-4">
									<!-- Transform info -->
									{#if transformInfoMap[step.fn]}
										{@const tInfo = transformInfoMap[step.fn]}
										<div class="bg-[var(--color-bg-page)] rounded-lg px-3 py-2 text-xs space-y-1.5 border border-[var(--color-border-light)]">
											<div class="text-[var(--color-text-secondary)] leading-relaxed">{tInfo.description}</div>
											{#if tInfo.inputOutput}
												<div class="text-[var(--color-text-muted)] font-mono text-[10px]">{tInfo.inputOutput}</div>
											{/if}
											<div class="flex flex-wrap items-center gap-2 pt-0.5">
												{#if tInfo.hasSystemPrompt}
													<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 text-[10px]">
														<svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
														LLM-powered
													</span>
												{/if}
												{#if tInfo.config}
													<span class="text-[10px] text-[var(--color-text-muted)] font-mono">config: {tInfo.config.slice(0, 60)}{tInfo.config.length > 60 ? '...' : ''}</span>
												{/if}
											</div>
										</div>
									{/if}

									<!-- Step metadata -->
									<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
										<div>
											<span class="text-[var(--color-text-muted)]">Input Rows</span>
											<div class="text-[var(--color-text-primary)] mt-0.5">{step.inputRowCount?.toLocaleString() ?? '--'}</div>
										</div>
										<div>
											<span class="text-[var(--color-text-muted)]">Output Rows</span>
											<div class="text-[var(--color-text-primary)] mt-0.5">{step.outputRowCount?.toLocaleString() ?? '--'}</div>
										</div>
										<div>
											<span class="text-[var(--color-text-muted)]">Started</span>
											<div class="text-[var(--color-text-primary)] mt-0.5">{formatDate(step.startedAt)}</div>
										</div>
										<div>
											<span class="text-[var(--color-text-muted)]">Completed</span>
											<div class="text-[var(--color-text-primary)] mt-0.5">{formatDate(step.completedAt)}</div>
										</div>
									</div>

									<!-- Step params -->
									{#if step.params && (step.params.limit || step.params.slice || step.params.columnMap || step.params.outputFilename)}
										<div class="flex flex-wrap gap-2">
											{#if step.params.limit}
												<span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded border border-[var(--color-border)] bg-[var(--color-bg-page)] text-[var(--color-text-secondary)]">limit: {step.params.limit}</span>
											{/if}
											{#if step.params.slice}
												<span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded border border-[var(--color-border)] bg-[var(--color-bg-page)] text-[var(--color-text-secondary)]">slice: {step.params.slice}</span>
											{/if}
											{#if step.params.outputFilename}
												<span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded border border-[var(--color-border)] bg-[var(--color-bg-page)] text-[var(--color-text-secondary)]">output: {step.params.outputFilename}</span>
											{/if}
											{#if step.params.columnMap}
												<span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded border border-blue-200 bg-blue-50 text-blue-600">columnMap: {Object.keys(step.params.columnMap).length} cols</span>
											{/if}
										</div>
									{/if}

									{#if step.error}
										<div class="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-xs font-mono whitespace-pre-wrap">
											{step.error}
										</div>
									{/if}

									<!-- Step logs -->
									{#if step.status !== 'pending' && step.status !== 'skipped'}
										<div>
											<button
												onclick={(e: MouseEvent) => toggleStepLogs(step.id, e)}
												class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer {stepLogsOpen[step.id] ? 'bg-blue-50 text-blue-700 border-blue-200' : 'text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-bg-surface-hover)]'}"
											>
												<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" /></svg>
												{stepLogsOpen[step.id] ? 'Hide Logs' : 'View Logs'}
											</button>

											{#if stepLogsOpen[step.id]}
												<div class="mt-2 border border-[var(--color-border)] rounded-lg overflow-hidden">
													<div class="px-3 py-1.5 bg-[var(--color-bg-page)] border-b border-[var(--color-border)] text-xs font-medium text-[var(--color-text-secondary)] flex items-center justify-between">
														<span>Execution Logs</span>
														{#if stepLogs[step.id]}
															<span class="text-[var(--color-text-muted)]">{stepLogs[step.id].length} events</span>
														{/if}
													</div>
													{#if stepLogsLoading[step.id]}
														<div class="p-4 text-xs text-[var(--color-text-muted)]">Loading logs...</div>
													{:else if stepLogs[step.id] && stepLogs[step.id].length > 0}
														<div class="max-h-60 overflow-auto bg-[var(--color-code-bg)] p-3">
															{#each stepLogs[step.id] as logEvent, li}
																<div class="text-xs font-mono leading-relaxed {logEvent.type === 'step-error' ? 'text-red-400' : logEvent.type === 'step-complete' ? 'text-green-400' : logEvent.type === 'step-start' ? 'text-blue-400' : 'text-[var(--color-code-text)]'}">
																	<span class="text-[var(--color-text-muted)] opacity-50 select-none">{String(li + 1).padStart(3, ' ')} </span>{logEvent.message || logEvent.type}
																</div>
															{/each}
														</div>
													{:else}
														<div class="p-4 text-xs text-[var(--color-text-muted)]">No logs available for this step.</div>
													{/if}
												</div>
											{/if}
										</div>
									{/if}

									<!-- Data table -->
									{#if step.status === 'completed' && step.outputFile}
										<DataTable runId={manifest.runId} fileId={step.id} />
									{:else if step.status === 'completed'}
										<div class="text-xs text-[var(--color-text-muted)] py-2">Step completed with no output file.</div>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

{#if showReportDialog}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in"
		onclick={() => { showReportDialog = false; reportResult = null; }}
		onkeydown={(e) => e.key === 'Escape' && (showReportDialog = false)}
		role="dialog"
	>
		<div class="bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-border)] shadow-2xl w-[32rem] max-h-[80vh] overflow-auto p-6 animate-slide-up"
			onclick={(e) => e.stopPropagation()}
			onkeydown={() => {}}
			role="document"
		>
			<h3 class="text-lg font-semibold text-[var(--color-text-primary)] mb-1">Generate Report</h3>
			<p class="text-sm text-[var(--color-text-muted)] mb-4">Create a markdown summary of this run's pipeline and results.</p>

			{#if !reportResult}
				<label class="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Instructions (optional)</label>
				<textarea
					bind:value={reportInstructions}
					class="w-full h-24 px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] resize-none mb-4"
					placeholder="e.g. Focus on errors, include timing details..."
				></textarea>

				<div class="flex justify-end gap-2">
					<button onclick={() => { showReportDialog = false; }} class="px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer">Cancel</button>
					<button onclick={generateReport} disabled={generatingReport} class="px-4 py-2 text-sm font-medium text-white bg-[var(--color-brand)] rounded-lg hover:bg-[var(--color-brand-hover)] cursor-pointer disabled:opacity-50">
						{generatingReport ? 'Generating...' : 'Generate'}
					</button>
				</div>
			{:else}
				<p class="text-sm text-[var(--color-text-primary)] mb-3">{reportResult.message}</p>

				{#if reportResult.path}
					<div class="text-xs text-[var(--color-text-muted)] mb-3">
						<span class="font-medium">Saved to:</span> {reportResult.path}
					</div>
				{/if}

				{#if reportResult.markdown}
					<details class="mb-4">
						<summary class="text-sm font-medium text-[var(--color-text-secondary)] cursor-pointer mb-2">Preview markdown</summary>
						<pre class="text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg p-3 overflow-auto max-h-60 whitespace-pre-wrap">{reportResult.markdown}</pre>
					</details>
				{/if}

				<div class="flex justify-end gap-2">
					<button onclick={() => { reportResult = null; reportInstructions = ''; }} class="px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer">Generate Another</button>
					<button onclick={() => { showReportDialog = false; reportResult = null; }} class="px-4 py-2 text-sm font-medium text-white bg-[var(--color-brand)] rounded-lg hover:bg-[var(--color-brand-hover)] cursor-pointer">Done</button>
				</div>
			{/if}
		</div>
	</div>
{/if}                                                                           

