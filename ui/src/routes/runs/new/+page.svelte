<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { APP } from '$lib/constants/app';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';

	let name = $state('');
	let runId = $state('');
	let description = $state('');
	let submitting = $state(false);
	let error: string | null = $state(null);
	let autoId = $state(true);

	// Auto-generate slug from name
	$effect(() => {
		if (autoId && name) {
			runId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
		}
	});

	let idError = $derived.by(() => {
		if (!runId.trim()) return null;
		if (/[^a-z0-9-]/.test(runId)) return 'Only lowercase letters, numbers, and hyphens allowed';
		if (runId.startsWith('-') || runId.endsWith('-')) return 'Cannot start or end with a hyphen';
		return null;
	});

	async function handleSubmit() {
		if (!name.trim() || !runId.trim()) return;
		submitting = true;
		error = null;
		try {
			await api.runs.create({ runId, name: name.trim(), description: description.trim() || undefined });
			goto(`/runs/${runId}`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create run';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>New Run | {APP.title}</title>
</svelte:head>

<div class="max-w-lg space-y-6">
	<Breadcrumb items={[{ label: 'Runs', href: '/runs' }, { label: 'New Run' }]} />

	<div>
		<h2 class="text-2xl font-bold text-[var(--color-text-primary)]">New Run</h2>
		<p class="text-sm text-[var(--color-text-secondary)] mt-1">Create a new pipeline execution run</p>
	</div>

	{#if error}
		<div class="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">{error}</div>
	{/if}

	<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
		<div>
			<label for="name" class="block text-sm font-medium text-[var(--color-text-primary)] mb-1">Name</label>
			<input
				id="name"
				type="text"
				bind:value={name}
				placeholder="JEGS eBay — Apr 01"
				class="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
				required
			/>
		</div>

		<div>
			<label for="runId" class="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
				Run ID
				<button
					type="button"
					onclick={() => { autoId = !autoId; }}
					class="ml-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
				>
					{autoId ? '(auto — click to edit)' : '(manual — click for auto)'}
				</button>
			</label>
			<input
				id="runId"
				type="text"
				bind:value={runId}
				disabled={autoId}
				placeholder="jegs-ebay-apr-01"
				class="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:border-transparent disabled:bg-[var(--color-bg-surface-hover)] disabled:text-[var(--color-text-secondary)] {idError ? 'border-red-300 focus:ring-red-400' : 'border-[var(--color-border)] focus:ring-blue-400'}"
				required
			/>
			{#if idError}
				<p class="text-xs text-red-500 mt-1">{idError}</p>
			{/if}
		</div>

		<div>
			<label for="description" class="block text-sm font-medium text-[var(--color-text-primary)] mb-1">Description <span class="text-[var(--color-text-muted)] font-normal">(optional)</span></label>
			<textarea
				id="description"
				bind:value={description}
				rows={3}
				placeholder="Brief description of this run — data source, transforms to apply, purpose..."
				class="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-y"
			></textarea>
		</div>

		<div class="flex items-center gap-3 pt-2">
			<button
				type="submit"
				disabled={submitting || !name.trim() || !runId.trim() || !!idError}
				class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-[var(--color-bg-inset)] disabled:cursor-not-allowed transition-colors"
			>
				{submitting ? 'Creating...' : 'Create Run'}
			</button>
			<a href="/runs" class="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">Cancel</a>
		</div>
	</form>
</div>
