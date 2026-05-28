<script lang="ts">
	import { TRIGGER_LABELS } from './types';

	let { trigger }: { trigger: string } = $props();

	const t = $derived(trigger.split(' ')[0]);
	const isStripe = $derived(t === 'stripe-webhook');
	const isManual = $derived(t === 'manual');
	const isRetry = $derived(t === 'retry');
	const isSystem = $derived(t === 'system' || t === 'cron' || t.startsWith('hook:'));

	const dotClass = $derived(
		isStripe
			? 'bg-indigo-500'
			: isManual
				? 'bg-blue-500'
				: isRetry
					? 'bg-amber-500'
					: 'bg-slate-400'
	);

	const label = $derived(TRIGGER_LABELS[t] ?? t);
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
>
	<span class="h-1.5 w-1.5 rounded-full {dotClass}"></span>
	{label}
</span>
