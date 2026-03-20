<script lang="ts">
	interface Props {
		keys: string[];
	}

	let { keys }: Props = $props();
</script>

<span class="inline-flex items-center gap-0.5">
	{#each keys as key, i (i)}
		{#if i > 0}<span class="text-[var(--color-text-muted)] text-[10px]">+</span>{/if}
		<kbd class="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-[10px] font-medium rounded border bg-[var(--color-bg-inset)] border-[var(--color-border)] text-[var(--color-text-secondary)] shadow-sm">{key}</kbd>
	{/each}
</span>
