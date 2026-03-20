<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import type { Snippet } from 'svelte';
	import { APP, NAV_ITEMS } from '$lib/constants/app';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import { api } from '$lib/api';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
	let showShortcuts = $state(false);

	// Running jobs indicator
	let runningJobs: Array<{ jobId: string; status: string }> = $state([]);
	let jobPollTimer: ReturnType<typeof setInterval> | null = null;

	async function pollJobs() {
		try {
			const jobs = await api.jobs.list() as Array<{ jobId: string; status: string }>;
			runningJobs = jobs.filter(j => j.status === 'running' || j.status === 'queued');
		} catch { /* ignore */ }
	}

	onMount(() => {
		pollJobs();
		jobPollTimer = setInterval(pollJobs, 3000);
	});

	onDestroy(() => {
		if (jobPollTimer) clearInterval(jobPollTimer);
	});

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/runs') return path === '/runs' || (path.startsWith('/runs/') && !path.startsWith('/runs/compare'));
		return path === href || path.startsWith(href + '/');
	}

	function handleKeydown(e: KeyboardEvent) {
		// Ignore when typing in inputs
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

		if (e.key === '?') { showShortcuts = !showShortcuts; return; }
		if (e.key === 'Escape' && showShortcuts) { showShortcuts = false; return; }

		// g+key navigation (vim-style)
		if (e.key === 'g') {
			const handler = (e2: KeyboardEvent) => {
				document.removeEventListener('keydown', handler);
				if (e2.key === 'r') goto('/runs');
				else if (e2.key === 'n') goto('/runs/new');
				else if (e2.key === 'f') goto('/files');
				else if (e2.key === 't') goto('/transforms');
				else if (e2.key === 'c') goto('/runs/compare');
				else if (e2.key === 'd') goto('/docs');
				else if (e2.key === 'h') goto('/');
			};
			document.addEventListener('keydown', handler, { once: true });
			setTimeout(() => document.removeEventListener('keydown', handler), 1000);
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<title>{APP.title}</title>
</svelte:head>

<div class="flex h-screen bg-[var(--color-bg-page)]">
	<!-- Sidebar -->
	<aside class="w-56 bg-[var(--color-sidebar-bg)] border-r border-[var(--color-border)] flex flex-col shrink-0">
		<!-- Logo -->
		<div class="px-4 py-5 border-b border-[var(--color-border-light)]">
			<div class="flex items-center gap-2.5">
				<div class="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
					<svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
					</svg>
				</div>
				<div>
					<h1 class="text-sm font-bold text-[var(--color-text-primary)] tracking-tight leading-none">{APP.title}</h1>
					<p class="text-[10px] text-[var(--color-text-muted)] mt-0.5">{APP.subtitle}</p>
				</div>
			</div>
		</div>

		<!-- Quick action -->
		<div class="px-3 pt-4 pb-2">
			<a
				href="/runs/new"
				class="flex items-center justify-center gap-1.5 w-full px-3 py-2 text-xs font-medium text-white bg-[var(--color-brand)] rounded-lg hover:bg-[var(--color-brand-hover)] transition-colors active:scale-[0.98] shadow-sm"
			>
				<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
				New Run
			</a>
		</div>

		<!-- Navigation -->
		<nav class="flex-1 px-3 py-2 space-y-0.5">
			<div class="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 pb-1.5">Navigation</div>
			{#each NAV_ITEMS as item (item.href)}
				{#if item.external}
					<a
						href={item.href}
						target="_blank"
						rel="noopener noreferrer"
						class="flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-hover)] hover:text-[var(--color-text-primary)]"
					>
						<div class="w-5 h-5 flex items-center justify-center">
							{#if item.icon === 'api'}
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
								</svg>
							{:else}
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
								</svg>
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<div class="leading-none flex items-center gap-1">
								{item.label}
								<svg class="w-3 h-3 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
								</svg>
							</div>
							<div class="text-[10px] text-[var(--color-text-muted)] mt-0.5 truncate">{item.desc}</div>
						</div>
					</a>
				{:else}
					<a
						href={item.href}
						class="flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all {isActive(item.href) ? 'bg-[var(--color-sidebar-active-bg)] text-[var(--color-sidebar-active-text)] font-medium' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-hover)] hover:text-[var(--color-text-primary)]'}"
					>
						<div class="w-5 h-5 flex items-center justify-center">
							{#if item.icon === 'play'}
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
							{:else if item.icon === 'compare'}
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
								</svg>
							{:else if item.icon === 'file'}
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
								</svg>
							{:else if item.icon === 'docs'}
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
								</svg>
							{:else}
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
								</svg>
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<div class="leading-none">{item.label}</div>
							{#if !isActive(item.href)}
								<div class="text-[10px] text-[var(--color-text-muted)] mt-0.5 truncate">{item.desc}</div>
							{/if}
						</div>
					</a>
				{/if}
			{/each}
		</nav>

		<!-- Running jobs indicator -->
		{#if runningJobs.length > 0}
			<div class="mx-3 mb-1">
				<a
					href="/runs"
					class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-hover)] hover:text-[var(--color-text-primary)] transition-all"
				>
					<span class="relative flex h-2 w-2 shrink-0">
						<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-60"></span>
						<span class="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
					</span>
					<span class="text-xs font-medium">
						{runningJobs.length} running
					</span>
				</a>
			</div>
		{/if}

		<!-- Footer -->
		<div class="px-3 py-3 border-t border-[var(--color-border-light)] space-y-1">
			<ThemeToggle />
			<div class="text-[10px] text-[var(--color-text-muted)] px-2 mb-1 font-mono opacity-60">{APP.buildTag}</div>
			<div class="flex items-center justify-between text-xs text-[var(--color-text-muted)] px-2">
				<span class="inline-flex items-center gap-1">
					<span class="w-1.5 h-1.5 rounded-full bg-green-400"></span>
					Port {APP.port}
				</span>
				<button onclick={() => showShortcuts = true} class="opacity-50 hover:opacity-100 cursor-pointer" title="Keyboard shortcuts (?)">
					<kbd class="text-[10px] px-1 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-inset)]">?</kbd>
				</button>
			</div>
		</div>
	</aside>

	<!-- Main content -->
	<div class="flex-1 flex flex-col overflow-hidden">
		<main class="flex-1 overflow-auto p-6">
			{@render children()}
		</main>
	</div>
</div>

{#if showShortcuts}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick={() => showShortcuts = false} onkeydown={(e) => e.key === 'Escape' && (showShortcuts = false)}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-border)] shadow-2xl w-80 overflow-hidden" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
			<div class="px-4 py-3 border-b border-[var(--color-border-light)] flex items-center justify-between">
				<h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Keyboard Shortcuts</h3>
				<button onclick={() => showShortcuts = false} class="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer">
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
			</div>
			<div class="px-4 py-3 space-y-3">
				<div class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Navigation</div>
				<div class="space-y-2 text-sm">
					<div class="flex justify-between"><span class="text-[var(--color-text-secondary)]">Dashboard</span><kbd class="text-xs px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-inset)] text-[var(--color-text-muted)] font-mono">g h</kbd></div>
					<div class="flex justify-between"><span class="text-[var(--color-text-secondary)]">Runs</span><kbd class="text-xs px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-inset)] text-[var(--color-text-muted)] font-mono">g r</kbd></div>
					<div class="flex justify-between"><span class="text-[var(--color-text-secondary)]">New Run</span><kbd class="text-xs px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-inset)] text-[var(--color-text-muted)] font-mono">g n</kbd></div>
					<div class="flex justify-between"><span class="text-[var(--color-text-secondary)]">Files</span><kbd class="text-xs px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-inset)] text-[var(--color-text-muted)] font-mono">g f</kbd></div>
					<div class="flex justify-between"><span class="text-[var(--color-text-secondary)]">Transforms</span><kbd class="text-xs px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-inset)] text-[var(--color-text-muted)] font-mono">g t</kbd></div>
					<div class="flex justify-between"><span class="text-[var(--color-text-secondary)]">Compare</span><kbd class="text-xs px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-inset)] text-[var(--color-text-muted)] font-mono">g c</kbd></div>
					<div class="flex justify-between"><span class="text-[var(--color-text-secondary)]">Docs</span><kbd class="text-xs px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-inset)] text-[var(--color-text-muted)] font-mono">g d</kbd></div>
				</div>
				<div class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider pt-2">General</div>
				<div class="space-y-2 text-sm">
					<div class="flex justify-between"><span class="text-[var(--color-text-secondary)]">Show shortcuts</span><kbd class="text-xs px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-inset)] text-[var(--color-text-muted)] font-mono">?</kbd></div>
					<div class="flex justify-between"><span class="text-[var(--color-text-secondary)]">Save (in editors)</span><kbd class="text-xs px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-inset)] text-[var(--color-text-muted)] font-mono">Ctrl+S</kbd></div>
					<div class="flex justify-between"><span class="text-[var(--color-text-secondary)]">Close modal</span><kbd class="text-xs px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-inset)] text-[var(--color-text-muted)] font-mono">Esc</kbd></div>
				</div>
			</div>
		</div>
	</div>
{/if}

<ToastContainer />
