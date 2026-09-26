<script lang="ts">
	/**
	 * One line under an update / restore result: the site opened like a
	 * visitor would (homepage, shop, a product). `outcome` null = running.
	 */
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import { describeSiteCheck, type SiteCheckOutcome } from '$lib/logic/wordpress-site-check';

	let { outcome }: { outcome: SiteCheckOutcome | null } = $props();

	const view = $derived(outcome ? describeSiteCheck(outcome) : null);
</script>

<p
	class="flex min-w-0 items-start gap-2 text-sm {view?.tone === 'error'
		? 'rounded-md border border-destructive/40 bg-destructive/5 p-2'
		: ''}"
	role={view?.tone === 'error' ? 'alert' : 'status'}
	aria-live="polite"
>
	{#if !view}
		<LoaderIcon class="mt-0.5 size-4 shrink-0 animate-spin text-amber-600 motion-reduce:animate-none" />
		<span class="text-muted-foreground">Verific dacă site-ul e online…</span>
	{:else}
		{#if view.tone === 'ok'}
			<GlobeIcon class="mt-0.5 size-4 shrink-0 text-green-600" />
		{:else if view.tone === 'warning'}
			<AlertTriangleIcon class="mt-0.5 size-4 shrink-0 text-amber-600" />
		{:else}
			<XCircleIcon class="mt-0.5 size-4 shrink-0 text-destructive" />
		{/if}
		<span
			class="min-w-0 break-words {view.tone === 'error'
				? 'font-medium text-destructive'
				: view.tone === 'warning'
					? 'text-amber-800 dark:text-amber-300'
					: 'text-foreground'}"
		>
			{view.text}
		</span>
	{/if}
</p>
