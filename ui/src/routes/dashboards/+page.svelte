<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';

	interface Dashboard {
		id: string;
		name: string;
		description: string;
		version?: string;
	}

	let dashboards: Dashboard[] = $state([]);
	let loading = $state(true);
	let error: string | null = $state(null);

	onMount(async () => {
		try {
			dashboards = await api.dashboards.list() as Dashboard[];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load dashboards';
		} finally {
			loading = false;
		}
	});

	function openDashboard(id: string) {
		window.open(
			`http://localhost:3460/dashboards/${id}/`,
			`dashboard-${id}`,
			'width=1280,height=900,menubar=no,toolbar=no'
		);
	}
</script>

<Breadcrumb items={[{ label: 'Dashboards' }]} />

<div class="space-y-6 max-w-3xl">
	<div>
		<h1 class="text-xl font-bold text-[var(--color-text-primary)]">Dashboards</h1>
		<p class="text-sm text-[var(--color-text-secondary)] mt-1">
			Manual review plugins for pipeline approval steps. Each dashboard lets you inspect data,
			make selections, and resume the pipeline.
		</p>
	</div>

	{#if loading}
		<div class="space-y-2">
			{#each [1, 2, 3] as _}
				<div class="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg p-4 animate-pulse">
					<div class="h-4 bg-[var(--color-bg-inset)] rounded w-1/3 mb-2"></div>
					<div class="h-3 bg-[var(--color-bg-inset)] rounded w-2/3"></div>
				</div>
			{/each}
		</div>
	{:else if error}
		<div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
	{:else if dashboards.length === 0}
		<div class="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl p-10 text-center space-y-3">
			<div class="text-3xl">🧩</div>
			<p class="text-sm font-medium text-[var(--color-text-primary)]">No dashboards yet</p>
			<p class="text-xs text-[var(--color-text-muted)] max-w-xs mx-auto">
				Copy <code class="bg-[var(--color-bg-inset)] px-1 rounded">dashboards/_template/</code> to create
				your first dashboard plugin. See <code class="bg-[var(--color-bg-inset)] px-1 rounded">dashboards/README.md</code> for instructions.
			</p>
		</div>
	{:else}
		<div class="space-y-2">
			{#each dashboards as dash (dash.id)}
				<div class="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg p-4 flex items-center justify-between gap-4 hover:border-blue-200 dark:hover:border-blue-800 transition-colors">
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<span class="text-sm font-semibold text-[var(--color-text-primary)]">{dash.name}</span>
							<span class="text-xs font-mono text-[var(--color-text-muted)]">{dash.id}</span>
							{#if dash.version}
								<span class="text-[10px] text-[var(--color-text-muted)] bg-[var(--color-bg-inset)] px-1.5 py-0.5 rounded">v{dash.version}</span>
							{/if}
						</div>
						{#if dash.description}
							<p class="text-xs text-[var(--color-text-secondary)] mt-0.5 truncate">{dash.description}</p>
						{/if}
					</div>
					<button
						onclick={() => openDashboard(dash.id)}
						class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-bg-surface-hover)] transition-colors active:scale-95 shrink-0"
					>
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
						</svg>
						Open
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Docs callout -->
	<div class="border border-[var(--color-border-light)] rounded-lg p-4 text-xs text-[var(--color-text-secondary)] space-y-1">
		<p class="font-medium text-[var(--color-text-primary)]">Adding a dashboard</p>
		<p>Copy <code class="bg-[var(--color-bg-inset)] px-1 rounded text-[var(--color-text-primary)]">dashboards/_template/</code> to <code class="bg-[var(--color-bg-inset)] px-1 rounded text-[var(--color-text-primary)]">dashboards/your-name/</code>, edit the manifest, implement three functions, and add a <code class="bg-[var(--color-bg-inset)] px-1 rounded text-[var(--color-text-primary)]">type: "manual"</code> step to your run config.</p>
		<p>See <code class="bg-[var(--color-bg-inset)] px-1 rounded text-[var(--color-text-primary)]">dashboards/README.md</code> for full instructions.</p>
	</div>
</div>
