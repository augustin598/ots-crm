<script lang="ts">
	/**
	 * Progress banner for a long WordPress job (chunked backup / restore),
	 * same shape as the Rank Tracker scan banner: spinner, one line of text,
	 * a filling track. `percent` null = still starting (indeterminate).
	 */
	let {
		text,
		percent = null,
		tone = 'default'
	}: { text: string; percent?: number | null; tone?: 'default' | 'warning' } = $props();

	const clamped = $derived(percent === null ? null : Math.max(0, Math.min(100, percent)));
</script>

<div
	class="flex w-full min-w-0 items-center gap-3 rounded-xl border px-3.5 py-2.5 {tone === 'warning'
		? 'border-amber-500/50 bg-amber-500/10'
		: 'border-primary/40 bg-primary/5'}"
	role="status"
	aria-live="polite"
>
	<span
		class="size-3 shrink-0 animate-spin rounded-full border-2 motion-reduce:animate-none {tone === 'warning'
			? 'border-amber-500/30 border-t-amber-600'
			: 'border-primary/25 border-t-primary'}"
	></span>
	<span
		class="min-w-0 flex-1 truncate text-xs font-semibold {tone === 'warning'
			? 'text-amber-800 dark:text-amber-300'
			: 'text-primary'}"
		title={text}
	>
		{text}
	</span>
	<span class="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-primary/15 sm:w-40">
		{#if clamped === null}
			<i class="block h-full w-1/3 animate-pulse rounded-full bg-primary/60"></i>
		{:else}
			<i
				class="block h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
				style:width="{clamped}%"
			></i>
		{/if}
	</span>
	{#if clamped !== null}
		<span class="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{clamped}%</span>
	{/if}
</div>
