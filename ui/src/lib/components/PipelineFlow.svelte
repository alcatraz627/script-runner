<script lang="ts">
	import type { RunManifest, StepManifest } from '$lib/types';

	interface Props {
		manifest: RunManifest;
		activeStep: string | null;
		onStepClick: (stepId: string) => void;
	}

	let { manifest, activeStep, onStepClick }: Props = $props();

	function statusColor(status: string, stale: boolean): string {
		if (stale) return 'border-amber-400 bg-amber-50';
		switch (status) {
			case 'completed': return 'border-green-400 bg-green-50';
			case 'running': return 'border-blue-400 bg-blue-50';
			case 'error': return 'border-red-400 bg-red-50';
			default: return 'border-[var(--color-border)] bg-[var(--color-bg-surface-hover)]';
		}
	}

	function statusDot(status: string, stale: boolean): string {
		if (stale) return 'bg-amber-400';
		switch (status) {
			case 'completed': return 'bg-green-400';
			case 'running': return 'bg-blue-400 animate-pulse';
			case 'error': return 'bg-red-400';
			default: return 'bg-[var(--color-border)]';
		}
	}

	function formatRows(n: number | null): string {
		if (n === null) return '';
		return n.toLocaleString() + ' rows';
	}

	function formatDuration(ms: number | null): string {
		if (ms === null) return '';
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		return `${(ms / 60_000).toFixed(1)}m`;
	}
</script>

<div class="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg p-4">
	<h3 class="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider mb-4">Pipeline Flow</h3>
	<div class="flex items-center gap-0 overflow-x-auto pb-2">
		<!-- Input node -->
		<div class="shrink-0 flex flex-col items-center">
			<div class="w-32 rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-bg-surface-hover)] p-2.5 text-center">
				<div class="flex items-center justify-center gap-1.5 mb-1">
					<svg class="w-3.5 h-3.5 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
					</svg>
					<span class="text-xs font-semibold text-[var(--color-text-primary)]">Input</span>
				</div>
				{#if manifest.input.file}
					<div class="text-[10px] font-mono text-[var(--color-text-secondary)] truncate" title={manifest.input.file}>{manifest.input.file.split('/').pop()}</div>
				{:else}
					<div class="text-[10px] text-[var(--color-text-muted)]">No file</div>
				{/if}
				{#if manifest.input.rowCount}
					<div class="text-[10px] text-[var(--color-text-secondary)] mt-0.5">{manifest.input.rowCount.toLocaleString()} rows</div>
				{/if}
			</div>
		</div>

		{#each manifest.steps as step, i (step.id)}
			<!-- Arrow connector -->
			<div class="shrink-0 flex items-center px-1">
				<div class="w-6 h-px bg-[var(--color-border)]"></div>
				<svg class="w-2 h-3 text-[var(--color-border)] -ml-px shrink-0" viewBox="0 0 6 10" fill="currentColor">
					<path d="M0 0 L6 5 L0 10 Z" />
				</svg>
			</div>

			<!-- Step node -->
			<button
				onclick={() => onStepClick(step.id)}
				class="shrink-0 flex flex-col items-center group"
			>
				<div
					class="w-36 rounded-lg border-2 p-2.5 transition-all cursor-pointer
						{statusColor(step.status, step.stale)}
						{activeStep === step.id ? 'ring-2 ring-blue-400 ring-offset-1' : 'hover:ring-2 hover:ring-[var(--color-border)] hover:ring-offset-1'}"
				>
					<div class="flex items-center gap-1.5 mb-1">
						<span class="w-2 h-2 rounded-full shrink-0 {statusDot(step.status, step.stale)}"></span>
						<span class="text-xs font-semibold text-[var(--color-text-primary)] truncate" title={step.name}>{step.name}</span>
					</div>
					<div class="text-[10px] font-mono text-[var(--color-text-secondary)] truncate">{step.fn}</div>
					<div class="flex items-center justify-between mt-1">
						<span class="text-[10px] text-[var(--color-text-secondary)]">{formatRows(step.outputRowCount)}</span>
						<span class="text-[10px] text-[var(--color-text-muted)]">{formatDuration(step.durationMs)}</span>
					</div>
					{#if step.status === 'running'}
						<div class="mt-1.5 h-1 rounded-full bg-blue-100 overflow-hidden">
							<div class="h-full w-full rounded-full bg-gradient-to-r from-blue-400 via-blue-600 to-blue-400 animate-shimmer"></div>
						</div>
					{/if}
					{#if step.stale}
						<div class="text-[10px] text-amber-600 mt-0.5">stale</div>
					{/if}
					{#if step.error}
						<div class="text-[10px] text-red-600 truncate mt-0.5" title={step.error}>{step.error}</div>
					{/if}
				</div>
				</button>
		{/each}

		{#if manifest.steps.length === 0}
			<div class="shrink-0 flex items-center px-1">
				<div class="w-6 h-px bg-[var(--color-border)]"></div>
				<svg class="w-2 h-3 text-[var(--color-border)] -ml-px" viewBox="0 0 6 10" fill="currentColor">
					<path d="M0 0 L6 5 L0 10 Z" />
				</svg>
			</div>
			<div class="shrink-0 w-32 rounded-lg border-2 border-dashed border-[var(--color-border)] p-3 text-center">
				<div class="text-xs text-[var(--color-text-muted)]">No steps</div>
			</div>
		{/if}
	</div>
</div>
