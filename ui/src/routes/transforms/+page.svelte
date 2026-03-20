<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { APP } from '$lib/constants/app';
	import { highlightJS } from '$lib/highlight';
	import type { TransformInfo, HelperInfo } from '$lib/types';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';

	let transforms: TransformInfo[] = $state([]);
	let loading = $state(true);
	let error: string | null = $state(null);
	let search = $state('');

	// Code viewer / editor
	let viewingSource: string | null = $state(null);
	let sourceCode: string = $state('');
	let sourceLoading = $state(false);
	let sourceMeta: { lines: number; sizeBytes: number; modifiedAt: string } | null = $state(null);
	let editing = $state(false);
	let editBuffer: string = $state('');
	let saving = $state(false);
	let saveError: string | null = $state(null);

	// Helper inspection
	let viewingHelpers: string | null = $state(null);
	let helpers: HelperInfo[] = $state([]);
	let helpersLoading = $state(false);
	let expandedHelper: string | null = $state(null);

	async function toggleHelpers(name: string) {
		if (viewingHelpers === name) {
			viewingHelpers = null;
			return;
		}
		viewingHelpers = name;
		helpersLoading = true;
		expandedHelper = null;
		try {
			const result = await api.transforms.helpers(name);
			helpers = result.helpers;
		} catch {
			helpers = [];
		} finally {
			helpersLoading = false;
		}
	}

	onMount(async () => {
		try {
			transforms = await api.transforms.list();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load transforms';
		} finally {
			loading = false;
		}
	});

	async function viewSource(name: string) {
		if (viewingSource === name) {
			viewingSource = null;
			editing = false;
			return;
		}
		viewingSource = name;
		sourceLoading = true;
		sourceCode = '';
		sourceMeta = null;
		editing = false;
		try {
			const result = await api.transforms.source(name);
			sourceCode = result.source;
			sourceMeta = { lines: result.lines, sizeBytes: result.sizeBytes, modifiedAt: result.modifiedAt };
		} catch (e) {
			sourceCode = `// Error loading source: ${e instanceof Error ? e.message : 'unknown'}`;
		} finally {
			sourceLoading = false;
		}
	}

	function startEditing() {
		editBuffer = sourceCode;
		editing = true;
		saveError = null;
	}

	async function saveSource(name: string) {
		saving = true;
		saveError = null;
		try {
			const result = await api.transforms.saveSource(name, editBuffer);
			sourceCode = editBuffer;
			sourceMeta = { lines: result.lines, sizeBytes: result.sizeBytes, modifiedAt: result.modifiedAt };
			editing = false;
			transforms = await api.transforms.list();
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Failed to save';
		} finally {
			saving = false;
		}
	}

	function handleEditorKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			if (editing && viewingSource) saveSource(viewingSource);
			return;
		}
		if (e.key === 'Tab') {
			e.preventDefault();
			const textarea = e.target as HTMLTextAreaElement;
			const start = textarea.selectionStart;
			const end = textarea.selectionEnd;
			editBuffer = editBuffer.substring(0, start) + '  ' + editBuffer.substring(end);
			// Restore cursor after Svelte re-renders
			requestAnimationFrame(() => {
				textarea.selectionStart = textarea.selectionEnd = start + 2;
			});
		}
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	let highlighted = $derived(sourceCode ? highlightJS(sourceCode) : '');

	let filteredTransforms = $derived.by(() => {
		if (!search.trim()) return transforms;
		const q = search.toLowerCase();
		return transforms.filter(t =>
			t.name.toLowerCase().includes(q) ||
			(t.description ?? '').toLowerCase().includes(q) ||
			(t.hasSystemPrompt && 'llm'.includes(q))
		);
	});
</script>

<svelte:head>
	<title>Transforms | {APP.title}</title>
</svelte:head>

<div class="space-y-6 max-w-4xl">
	<Breadcrumb items={[{ label: 'Transforms' }]} />

	<div>
		<h2 class="text-2xl font-bold text-[var(--color-text-primary)]">Transforms</h2>
		<p class="text-sm text-[var(--color-text-secondary)] mt-1">
			Reusable data processing functions that power pipeline steps.
			Each transform reads rows in, applies a transformation, and writes rows out.
			Transforms with an LLM badge use Claude for intelligent data cleaning.
		</p>
	</div>

	{#if loading}
		<div class="flex items-center justify-center h-48">
			<div class="text-[var(--color-text-muted)] text-sm">Loading transforms...</div>
		</div>
	{:else if error}
		<div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
	{:else}
		<!-- Search -->
		<div class="flex items-center gap-3">
			<input
				type="text"
				bind:value={search}
				placeholder="Search transforms..."
				class="px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg-surface)] focus:outline-none focus:ring-1 focus:ring-blue-400 w-72"
			/>
			<span class="text-xs text-[var(--color-text-muted)]">{filteredTransforms.length} of {transforms.length} transforms</span>
		</div>

		<div class="grid gap-4">
			{#each filteredTransforms as t (t.name)}
				<div class="bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)] p-5 space-y-3 hover:border-[var(--color-border)] transition-colors overflow-hidden min-w-0">
					<!-- Header -->
					<div class="flex items-start justify-between">
						<div>
							<h3 class="text-sm font-semibold text-[var(--color-text-primary)] font-mono">{t.name}</h3>
							<div class="flex items-center gap-2 mt-1.5 flex-wrap">
								{#if t.hasSystemPrompt}
									<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
										<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
										LLM
									</span>
								{/if}
								<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--color-bg-page)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-mono">
									transforms/{t.name}.js
								</span>
								{#if t.exportedHelpers.length > 0}
									<button
										onclick={() => toggleHelpers(t.name)}
										class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border cursor-pointer transition-colors active:scale-95 {viewingHelpers === t.name ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'}"
									>
										<svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75" /></svg>
										{t.exportedHelpers.length} helper{t.exportedHelpers.length !== 1 ? 's' : ''}
									</button>
								{/if}
							</div>
						</div>
						<button
							onclick={() => viewSource(t.name)}
							class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors active:scale-95 {viewingSource === t.name ? 'bg-blue-50 text-blue-700 border-blue-200' : 'text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-bg-surface-hover)] hover:border-[var(--color-border)]'}"
						>
							<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>
							{viewingSource === t.name ? 'Hide Source' : 'View Source'}
						</button>
					</div>

					<!-- Description -->
					{#if t.description}
						<p class="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-line">{t.description}</p>
					{/if}

					<!-- Helper functions inspection -->
					{#if viewingHelpers === t.name}
						<div class="border border-[var(--color-border)] rounded-lg overflow-hidden">
							<div class="px-3 py-2 bg-[var(--color-bg-page)] border-b border-[var(--color-border)] text-xs font-medium text-[var(--color-text-secondary)]">
								Exported Helpers ({t.exportedHelpers.length})
							</div>
							{#if helpersLoading}
								<div class="p-4 text-sm text-[var(--color-text-muted)]">Loading helpers...</div>
							{:else if helpers.length === 0}
								<div class="p-4 text-sm text-[var(--color-text-muted)]">No helper details available</div>
							{:else}
								<div class="divide-y divide-[var(--color-border-light)]">
									{#each helpers as h (h.name)}
										<div>
											<button
												onclick={() => { expandedHelper = expandedHelper === h.name ? null : h.name; }}
												class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--color-bg-surface-hover)] transition-colors"
											>
												<svg
													class="w-3 h-3 text-[var(--color-text-muted)] transition-transform shrink-0 {expandedHelper === h.name ? 'rotate-90' : ''}"
													fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
												><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
												<span class="text-sm font-mono font-medium text-blue-700">{h.name}</span>
												<span class="text-xs font-mono text-[var(--color-text-muted)]">({h.params.join(', ')})</span>
												{#if h.description}
													<span class="text-xs text-[var(--color-text-secondary)] flex-1 truncate ml-2">— {h.description}</span>
												{/if}
											</button>
											{#if expandedHelper === h.name}
												<div class="px-3 pb-3">
													{#if h.description}
														<p class="text-xs text-[var(--color-text-secondary)] mb-2 pl-6">{h.description}</p>
													{/if}
													<pre class="p-3 text-xs font-mono bg-[var(--color-code-bg)] text-[var(--color-text-muted)] rounded-lg overflow-x-auto max-h-48 leading-relaxed"><code>{@html highlightJS(h.source)}</code></pre>
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}

					<!-- Input/Output + Config in a grid -->
					<div class="flex flex-wrap gap-x-8 gap-y-2">
						{#if t.inputOutput}
							{#each t.inputOutput.split('\n') as line}
								<div class="text-xs flex items-center gap-1.5">
									{#if line.startsWith('Input:')}
										<svg class="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
										<span class="text-[var(--color-text-secondary)]">In:</span>
										<span class="text-[var(--color-text-primary)] font-medium">{line.replace('Input: ', '')}</span>
									{:else if line.startsWith('Output:')}
										<svg class="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
										<span class="text-[var(--color-text-secondary)]">Out:</span>
										<span class="text-[var(--color-text-primary)] font-medium">{line.replace('Output: ', '')}</span>
									{/if}
								</div>
							{/each}
						{/if}
					</div>

					<!-- Config block -->
					{#if t.config}
						<div class="bg-[var(--color-bg-page)] border border-[var(--color-border-light)] rounded-lg px-3 py-2">
							<div class="flex items-center gap-1.5 mb-1.5">
								<svg class="w-3 h-3 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
								<span class="text-xs font-medium text-[var(--color-text-secondary)]">Default Config</span>
							</div>
							<pre class="text-xs font-mono text-[var(--color-text-primary)] overflow-x-auto leading-relaxed">{t.config}</pre>
						</div>
					{/if}

					<!-- Source code viewer / editor -->
					{#if viewingSource === t.name}
						<div class="border border-[var(--color-border)] rounded-lg overflow-hidden">
							{#if sourceLoading}
								<div class="p-4 text-sm text-[var(--color-text-muted)]">Loading source...</div>
							{:else}
								<div class="flex items-center justify-between px-3 py-1.5 bg-[var(--color-bg-page)] border-b border-[var(--color-border)] text-xs text-[var(--color-text-secondary)]">
									<div class="flex items-center gap-3">
										{#if sourceMeta}
											<span>{sourceMeta.lines} lines</span>
											<span>{formatBytes(sourceMeta.sizeBytes)}</span>
											<span class="text-[var(--color-text-muted)]">modified {formatDate(sourceMeta.modifiedAt)}</span>
										{/if}
									</div>
									<div class="flex items-center gap-2">
										{#if saveError}
											<span class="text-red-500">{saveError}</span>
										{/if}
										{#if editing}
											<button
												onclick={() => saveSource(t.name)}
												disabled={saving}
												class="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:bg-[var(--color-bg-inset)] transition-colors active:scale-95"
											>
												<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
												{saving ? 'Saving...' : 'Save'}
											</button>
											<span class="text-[10px] text-[var(--color-text-muted)] hidden sm:inline">Ctrl+S</span>
											<button
												onclick={() => { editing = false; }}
												class="px-2 py-0.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded text-xs transition-colors"
											>Cancel</button>
										{:else}
											<button
												onclick={startEditing}
												class="inline-flex items-center gap-1 px-2 py-0.5 text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded text-xs hover:bg-[var(--color-bg-inset)] transition-colors active:scale-95"
											>
												<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" /></svg>
												Edit
											</button>
										{/if}
									</div>
								</div>
								{#if editing}
									<textarea
										bind:value={editBuffer}
										onkeydown={handleEditorKeydown}
										class="w-full p-4 text-xs font-mono bg-[var(--color-code-bg)] text-[var(--color-text-muted)] border-0 focus:outline-none focus:ring-0 resize-y leading-relaxed"
										style="min-height: 300px; max-height: 60vh;"
										spellcheck="false"
									></textarea>
								{:else}
									<pre class="p-4 text-xs font-mono bg-[var(--color-code-bg)] text-[var(--color-text-muted)] overflow-x-auto max-h-[60vh] leading-relaxed"><code>{@html highlighted}</code></pre>
								{/if}
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
