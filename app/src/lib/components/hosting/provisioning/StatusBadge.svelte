<script lang="ts">
	import type { ProvisioningStatus } from './types';
	import { STATUS_LABELS } from './types';

	let { status }: { status: ProvisioningStatus | string } = $props();

	const toneClasses: Record<string, string> = {
		active:
			'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
		pending:
			'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
		failed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
		suspended:
			'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
		terminated: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
	};

	const dotClasses: Record<string, string> = {
		active: 'bg-emerald-500',
		pending: 'bg-amber-500',
		failed: 'bg-rose-500',
		suspended: 'bg-orange-500',
		terminated: 'bg-slate-400'
	};

	const tone = $derived(toneClasses[status as string] ?? toneClasses.terminated);
	const dot = $derived(dotClasses[status as string] ?? dotClasses.terminated);
	const label = $derived(STATUS_LABELS[status as ProvisioningStatus] ?? status);
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium {tone}"
>
	<span class="h-1.5 w-1.5 rounded-full {dot}"></span>
	{label}
</span>
