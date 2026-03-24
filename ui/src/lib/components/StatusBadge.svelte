<script lang="ts">
	interface Props {
		status: string;
		size?: 'sm' | 'md';
	}

	let { status, size = 'sm' }: Props = $props();

	const validStatuses = new Set([
		'completed', 'running', 'partial', 'error', 'interrupted',
		'stale', 'awaiting', 'draft', 'pending', 'skipped',
	]);

	const sizeClass = $derived(size === 'sm' ? 'text-xs px-2 py-0.5 gap-1.5' : 'text-sm px-3 py-1 gap-2');
	const dotSize = $derived(size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2');
	const statusKey = $derived(validStatuses.has(status) ? status : 'draft');
</script>

<span class="badge badge-{statusKey} inline-flex items-center rounded-full border font-medium capitalize {sizeClass}">
	<span class="dot dot-{statusKey} rounded-full shrink-0 {dotSize} {status === 'running' ? 'animate-pulse' : ''}"></span>
	{status}
</span>

<style>
	/* Light mode */
	.badge-awaiting    { background: #f3e8ff; color: #6b21a8; border-color: #d8b4fe; }
	.badge-completed   { background: #d1fae5; color: #065f46; border-color: #6ee7b7; }
	.badge-running     { background: #dbeafe; color: #1d4ed8; border-color: #93c5fd; }
	.badge-partial     { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
	.badge-error       { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
	.badge-interrupted { background: #fef9c3; color: #854d0e; border-color: #fde047; }
	.badge-stale       { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
	.badge-draft       { background: #f3f4f6; color: #4b5563; border-color: #d1d5db; }
	.badge-pending     { background: #f3f4f6; color: #4b5563; border-color: #d1d5db; }
	.badge-skipped     { background: #f3f4f6; color: #6b7280; border-color: #d1d5db; }

	.dot-awaiting    { background: #a855f7; }
	.dot-completed   { background: #10b981; }
	.dot-running     { background: #3b82f6; }
	.dot-partial     { background: #f59e0b; }
	.dot-error       { background: #ef4444; }
	.dot-interrupted { background: #eab308; }
	.dot-stale       { background: #f59e0b; }
	.dot-draft       { background: #9ca3af; }
	.dot-pending     { background: #9ca3af; }
	.dot-skipped     { background: #9ca3af; }

	/* Dark mode — keyed to .dark class, not media query */
	:global(.dark) .badge-awaiting    { background: rgba(88, 28, 135, 0.4); color: #d8b4fe; border-color: #581c87; }
	:global(.dark) .badge-completed   { background: rgba(6, 78, 59, 0.4);   color: #6ee7b7; border-color: #065f46; }
	:global(.dark) .badge-running     { background: rgba(30, 58, 138, 0.4); color: #93c5fd; border-color: #1e3a8a; }
	:global(.dark) .badge-partial     { background: rgba(120, 53, 15, 0.4); color: #fcd34d; border-color: #78350f; }
	:global(.dark) .badge-error       { background: rgba(127, 29, 29, 0.4); color: #fca5a5; border-color: #7f1d1d; }
	:global(.dark) .badge-interrupted { background: rgba(113, 63, 18, 0.4); color: #fde047; border-color: #713f12; }
	:global(.dark) .badge-stale       { background: rgba(120, 53, 15, 0.4); color: #fcd34d; border-color: #78350f; }
	:global(.dark) .badge-draft       { background: rgba(30, 41, 59, 0.6);  color: #94a3b8; border-color: #334155; }
	:global(.dark) .badge-pending     { background: rgba(30, 41, 59, 0.6);  color: #94a3b8; border-color: #334155; }
	:global(.dark) .badge-skipped     { background: rgba(30, 41, 59, 0.6);  color: #64748b; border-color: #334155; }

	:global(.dark) .dot-awaiting    { background: #c084fc; }
	:global(.dark) .dot-completed   { background: #34d399; }
	:global(.dark) .dot-running     { background: #60a5fa; }
	:global(.dark) .dot-partial     { background: #fbbf24; }
	:global(.dark) .dot-error       { background: #f87171; }
	:global(.dark) .dot-interrupted { background: #facc15; }
	:global(.dark) .dot-stale       { background: #fbbf24; }
	:global(.dark) .dot-draft       { background: #64748b; }
	:global(.dark) .dot-pending     { background: #64748b; }
	:global(.dark) .dot-skipped     { background: #475569; }
</style>
