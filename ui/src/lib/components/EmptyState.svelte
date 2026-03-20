<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		icon?: 'search' | 'empty' | 'error';
		title: string;
		description?: string;
		actions?: Snippet;
	}

	let { icon = 'empty', title, description, actions }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center py-12 text-center">
	<div class="w-12 h-12 rounded-full bg-[var(--color-bg-inset)] flex items-center justify-center mb-3">
		{#if icon === 'search'}
			<svg class="w-6 h-6 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
			</svg>
		{:else if icon === 'error'}
			<svg class="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
			</svg>
		{:else}
			<svg class="w-6 h-6 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
			</svg>
		{/if}
	</div>
	<h3 class="text-sm font-medium text-[var(--color-text-primary)]">{title}</h3>
	{#if description}
		<p class="text-xs text-[var(--color-text-muted)] mt-1 max-w-xs">{description}</p>
	{/if}
	{#if actions}
		<div class="mt-4">
			{@render actions()}
		</div>
	{/if}
</div>
