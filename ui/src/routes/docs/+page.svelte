<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import Card from '$lib/components/Card.svelte';
	import { APP } from '$lib/constants/app';
	import { renderMarkdown } from '$lib/markdown';

	interface DocFile {
		id: string;
		label: string;
		path: string;
		description: string;
		exists: boolean;
		sizeBytes: number;
		modifiedAt: string | null;
	}

	let docs: DocFile[] = $state([]);
	let loading = $state(true);
	let activeDoc: string | null = $state(null);
	let docContent: string = $state('');
	let docLoading = $state(false);

	onMount(async () => {
		try {
			docs = await api.docs.files();
		} catch {
			/* ignore */
		} finally {
			loading = false;
		}
	});

	async function openDoc(id: string) {
		if (activeDoc === id) {
			activeDoc = null;
			docContent = '';
			return;
		}
		activeDoc = id;
		docLoading = true;
		try {
			const result = await api.docs.read(id);
			docContent = result.content;
		} catch (e) {
			docContent = `Error loading document: ${e instanceof Error ? e.message : 'Unknown error'}`;
		} finally {
			docLoading = false;
		}
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	function relativeTime(iso: string | null): string {
		if (!iso) return '--';
		const diff = Date.now() - new Date(iso).getTime();
		const hours = Math.floor(diff / 3600000);
		if (hours < 1) return 'just now';
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}
</script>

<svelte:head>
	<title>Docs | {APP.title}</title>
</svelte:head>

<div class="space-y-6 max-w-4xl">
	<div>
		<h2 class="text-2xl font-bold text-[var(--color-text-primary)]">Documentation</h2>
		<p class="text-sm text-[var(--color-text-secondary)] mt-1">Project markdown files and reference docs.</p>
	</div>

	{#if loading}
		<div class="flex items-center justify-center h-48">
			<div class="text-[var(--color-text-muted)] text-sm">Loading...</div>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-3">
			{#each docs as doc (doc.id)}
				<button
					onclick={() => openDoc(doc.id)}
					class="text-left w-full bg-[var(--color-bg-surface)] border rounded-lg px-4 py-3 transition-all cursor-pointer {activeDoc === doc.id ? 'border-[var(--color-brand)] ring-1 ring-[var(--color-brand)]' : 'border-[var(--color-border)] hover:border-[var(--color-brand)]'}"
					disabled={!doc.exists}
				>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div class="w-8 h-8 rounded-lg bg-[var(--color-brand-light)] flex items-center justify-center shrink-0">
								<svg class="w-4 h-4 text-[var(--color-brand)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
								</svg>
							</div>
							<div>
								<div class="text-sm font-medium text-[var(--color-text-primary)]">{doc.label}</div>
								<div class="text-xs text-[var(--color-text-muted)]">{doc.description}</div>
							</div>
						</div>
						<div class="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
							{#if !doc.exists}
								<span class="text-red-500">Missing</span>
							{:else}
								<span>{formatSize(doc.sizeBytes)}</span>
								<span>{relativeTime(doc.modifiedAt)}</span>
							{/if}
							<svg class="w-4 h-4 transition-transform {activeDoc === doc.id ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
							</svg>
						</div>
					</div>
				</button>

				{#if activeDoc === doc.id}
					<Card padding="none">
						<div class="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border-light)] bg-[var(--color-bg-inset)]">
							<span class="text-xs font-mono text-[var(--color-text-muted)]">{doc.path}</span>
							<div class="flex items-center gap-3">
								<a
									href="/api/docs/files/{doc.id}/raw"
									target="_blank"
									rel="noopener"
									class="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-brand)] transition-colors"
									title="Open raw markdown in new tab"
								>
									<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
									Open
								</a>
								<button
									onclick={() => { activeDoc = null; docContent = ''; }}
									class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
								>Close</button>
							</div>
						</div>
						{#if docLoading}
							<div class="p-8 text-center text-sm text-[var(--color-text-muted)]">Loading...</div>
						{:else}
							<div class="p-6 max-h-[600px] overflow-auto md-content">
								{@html renderMarkdown(docContent)}
							</div>
						{/if}
					</Card>
				{/if}
			{/each}
		</div>

		{#if docs.length === 0}
			<div class="text-center py-12 text-[var(--color-text-muted)] text-sm">
				No documentation files configured.
			</div>
		{/if}
	{/if}
</div>
