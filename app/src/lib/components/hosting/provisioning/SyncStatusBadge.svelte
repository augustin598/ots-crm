<script lang="ts">
	import type { DaSyncStatus } from './types';
	import { DA_SYNC_LABELS } from './types';

	let {
		status,
		issue = null,
		compact = false
	}: {
		status: DaSyncStatus | null;
		issue?: string | null;
		compact?: boolean;
	} = $props();

	const toneClasses: Record<DaSyncStatus, string> = {
		ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
		orphan: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
		suspended_on_da:
			'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
		active_on_da: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
		package_mismatch:
			'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
		server_error: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
	};

	const dotClasses: Record<DaSyncStatus, string> = {
		ok: 'bg-emerald-500',
		orphan: 'bg-rose-500',
		suspended_on_da: 'bg-orange-500',
		active_on_da: 'bg-amber-500',
		package_mismatch: 'bg-violet-500',
		server_error: 'bg-slate-500'
	};

	const tone = $derived(status ? toneClasses[status] : '');
	const dot = $derived(status ? dotClasses[status] : '');
	const label = $derived(status ? DA_SYNC_LABELS[status] : '');
	const tooltip = $derived(issue ?? label);
</script>

{#if status}
	<span
		class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-medium {tone}"
		title={tooltip}
	>
		<span class="h-1.5 w-1.5 rounded-full {dot}"></span>
		{#if !compact}{label}{/if}
	</span>
{/if}
