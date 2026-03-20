<script lang="ts">
	import { getToasts, removeToast } from '$lib/stores/toast.svelte';

	let toasts = $derived(getToasts());
</script>

{#if toasts.length > 0}
	<div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
		{#each toasts as t (t.id)}
			<div
				class="pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium border transition-all animate-slide-in {t.type === 'success' ? 'bg-green-600 text-white border-green-500' : t.type === 'error' ? 'bg-red-600 text-white border-red-500' : 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] border-[var(--color-border)]'}"
			>
				{#if t.type === 'success'}
					<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
				{:else if t.type === 'error'}
					<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
					</svg>
				{:else}
					<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
					</svg>
				{/if}
				<span>{t.message}</span>
				<button
					onclick={() => removeToast(t.id)}
					class="ml-1 opacity-60 hover:opacity-100 cursor-pointer"
				>
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	@keyframes slide-in {
		from {
			opacity: 0;
			transform: translateX(1rem);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
	.animate-slide-in {
		animation: slide-in 0.2s ease-out;
	}
</style>
