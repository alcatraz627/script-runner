<script lang="ts">
	interface Props {
		status: string;
		size?: 'sm' | 'md';
	}

	let { status, size = 'sm' }: Props = $props();

	const colorMap: Record<string, string> = {
		completed: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800',
		running: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
		partial: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800',
		error: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
		interrupted: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800',
		draft: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700',
		pending: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700',
		skipped: 'bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-800/40 dark:text-gray-500 dark:border-gray-700',
	};

	const dotColorMap: Record<string, string> = {
		completed: 'bg-emerald-500',
		running: 'bg-blue-500 animate-pulse',
		partial: 'bg-amber-500',
		error: 'bg-red-500',
		interrupted: 'bg-yellow-500',
		draft: 'bg-gray-400 dark:bg-gray-500',
		pending: 'bg-gray-400 dark:bg-gray-500',
		skipped: 'bg-gray-400 dark:bg-gray-500',
	};

	const sizeClass = $derived(size === 'sm' ? 'text-xs px-2 py-0.5 gap-1.5' : 'text-sm px-3 py-1 gap-2');
	const dotSize = $derived(size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2');
	const classes = $derived(colorMap[status] || colorMap['draft']);
	const dotClass = $derived(dotColorMap[status] || dotColorMap['draft']);
</script>

<span class="inline-flex items-center rounded-full border font-medium capitalize {sizeClass} {classes}">
	<span class="rounded-full shrink-0 {dotSize} {dotClass}"></span>
	{status}
</span>
