<script lang="ts">
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';

	let {
		met,
		total,
		missing
	}: {
		met: number;
		total: number;
		missing: string[];
	} = $props();

	const percentage = $derived(total > 0 ? Math.round((met / total) * 100) : 100);
	const isComplete = $derived(met >= total && total > 0);
</script>

<div class="rounded-lg border p-3 space-y-2">
	<div class="flex items-center justify-between text-sm">
		<span class="font-medium">
			{#if isComplete}
				<span class="flex items-center gap-1.5 text-green-600 dark:text-green-400">
					<CheckCircleIcon class="h-4 w-4" />
					Cerințe complete
				</span>
			{:else}
				<span class="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
					<AlertCircleIcon class="h-4 w-4" />
					{met}/{total} cerințe îndeplinite
				</span>
			{/if}
		</span>
		<span class="text-xs text-muted-foreground">{percentage}%</span>
	</div>

	<div class="w-full bg-muted rounded-full h-2 overflow-hidden">
		<div
			class="h-full rounded-full transition-all duration-300 {isComplete
				? 'bg-green-500'
				: percentage > 50
					? 'bg-amber-500'
					: 'bg-red-500'}"
			style="width: {percentage}%"
		></div>
	</div>

	{#if missing.length > 0}
		<details class="text-xs">
			<summary class="cursor-pointer text-muted-foreground hover:text-foreground">
				{missing.length} câmpuri lipsă
			</summary>
			<ul class="mt-1 space-y-0.5 text-muted-foreground pl-4 list-disc">
				{#each missing as item}
					<li>{item}</li>
				{/each}
			</ul>
		</details>
	{/if}
</div>
