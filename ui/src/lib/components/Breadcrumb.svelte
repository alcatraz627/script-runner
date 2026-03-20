<script lang="ts">
	interface Crumb {
		label: string;
		href?: string;
	}

	interface Props {
		items: Crumb[];
	}

	let { items }: Props = $props();
</script>

<nav class="flex items-center gap-1.5 text-sm mb-4">
	{#each items as crumb, i}
		{#if i > 0}
			<span class="text-[var(--color-text-muted)]">/</span>
		{/if}
		{#if crumb.href && i < items.length - 1}
			<a href={crumb.href} class="text-blue-600 hover:text-blue-800 transition-colors">{crumb.label}</a>
		{:else}
			<span class="text-[var(--color-text-secondary)] {i === items.length - 1 ? 'font-medium text-[var(--color-text-primary)]' : ''}">{crumb.label}</span>
		{/if}
	{/each}
</nav>
