<script lang="ts">
	/**
	 * One line under an update / restore result: the site's caches being
	 * emptied, then what was emptied (or why not). `outcome` null = running.
	 */
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import MinusCircleIcon from '@lucide/svelte/icons/circle-minus';
	import { describeCachePurge, type CachePurgeOutcome } from '$lib/logic/wordpress-cache-purge';

	let { outcome, siteName = null }: { outcome: CachePurgeOutcome | null; siteName?: string | null } =
		$props();

	const view = $derived(outcome ? describeCachePurge(outcome) : null);
</script>

<p class="flex min-w-0 items-start gap-2 text-sm" role="status" aria-live="polite">
	{#if !view}
		<LoaderIcon class="mt-0.5 size-4 shrink-0 animate-spin text-amber-600 motion-reduce:animate-none" />
		<span class="text-muted-foreground">{siteName ? `${siteName}: ` : ''}Se golește cache-ul site-ului…</span>
	{:else}
		{#if view.tone === 'ok'}
			<CheckCircleIcon class="mt-0.5 size-4 shrink-0 text-green-600" />
		{:else if view.tone === 'warning'}
			<AlertTriangleIcon class="mt-0.5 size-4 shrink-0 text-amber-600" />
		{:else}
			<MinusCircleIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
		{/if}
		<span
			class="min-w-0 break-words {view.tone === 'warning'
				? 'text-amber-800 dark:text-amber-300'
				: view.tone === 'ok'
					? 'text-foreground'
					: 'text-muted-foreground'}"
		>
			{siteName ? `${siteName}: ` : ''}{view.text}
		</span>
	{/if}
</p>
