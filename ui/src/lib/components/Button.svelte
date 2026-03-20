<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		size?: 'sm' | 'md' | 'lg';
		href?: string;
		disabled?: boolean;
		type?: 'button' | 'submit' | 'reset';
		children: Snippet;
		onclick?: (e: MouseEvent) => void;
	}

	let {
		variant = 'secondary',
		size = 'md',
		href,
		disabled = false,
		type = 'button',
		children,
		onclick,
	}: Props = $props();

	const variantClasses: Record<string, string> = {
		primary:
			'bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-hover)] shadow-sm active:shadow-none',
		secondary:
			'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] border border-[var(--color-border)] hover:bg-[var(--color-bg-surface-hover)] shadow-sm active:shadow-none',
		danger:
			'bg-red-600 text-white hover:bg-red-700 shadow-sm active:shadow-none',
		ghost:
			'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-hover)] hover:text-[var(--color-text-primary)]',
	};

	const sizeClasses: Record<string, string> = {
		sm: 'text-xs px-2.5 py-1.5 gap-1',
		md: 'text-sm px-3.5 py-2 gap-1.5',
		lg: 'text-sm px-5 py-2.5 gap-2',
	};

	let classes = $derived(
		`inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 cursor-pointer select-none active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none ${variantClasses[variant]} ${sizeClasses[size]}`
	);
</script>

{#if href}
	<a {href} class={classes}>
		{@render children()}
	</a>
{:else}
	<button {type} {disabled} {onclick} class={classes}>
		{@render children()}
	</button>
{/if}
