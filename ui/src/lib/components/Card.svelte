<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title?: string;
		subtitle?: string;
		padding?: 'none' | 'sm' | 'md' | 'lg';
		children: Snippet;
		actions?: Snippet;
		footer?: Snippet;
	}

	let { title, subtitle, padding = 'md', children, actions, footer }: Props = $props();

	const padClasses: Record<string, string> = {
		none: '',
		sm: 'p-3',
		md: 'p-4',
		lg: 'p-6',
	};
</script>

<div
	class="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl shadow-sm overflow-hidden"
>
	{#if title}
		<div
			class="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-light)]"
		>
			<div>
				<h3 class="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
				{#if subtitle}
					<p class="text-xs text-[var(--color-text-muted)] mt-0.5">{subtitle}</p>
				{/if}
			</div>
			{#if actions}
				<div class="flex items-center gap-2">
					{@render actions()}
				</div>
			{/if}
		</div>
	{/if}

	<div class={padClasses[padding]}>
		{@render children()}
	</div>

	{#if footer}
		<div
			class="px-4 py-3 border-t border-[var(--color-border-light)] bg-[var(--color-bg-inset)]"
		>
			{@render footer()}
		</div>
	{/if}
</div>
