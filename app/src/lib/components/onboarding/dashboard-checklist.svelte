<script lang="ts">
	import { goto } from '$app/navigation';
	import { getChecklistItems } from './tour-steps';
	import { getClientUserPreferences, updateClientUserPreferences } from '$lib/remotes/client-user-preferences.remote';
	import { tourState, tourActions } from '$lib/stores/onboarding-store.svelte';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import CompassIcon from '@lucide/svelte/icons/compass';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';

	let { isPrimary, tenantSlug }: { isPrimary: boolean; tenantSlug: string } = $props();

	const items = $derived(getChecklistItems(isPrimary));
	const prefsQuery = getClientUserPreferences();
	const prefs = $derived(prefsQuery.current);

	const checklist: Record<string, boolean> = $derived.by(() => {
		if (!prefs?.onboardingChecklist) return {};
		try {
			return JSON.parse(prefs.onboardingChecklist);
		} catch {
			return {};
		}
	});

	const completedCount = $derived(items.filter((i) => checklist[i.id]).length);
	const allDone = $derived(completedCount === items.length);
	const progress = $derived((completedCount / items.length) * 100);
</script>

{#if !allDone || !tourState.completed}
	<div class="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
		<div class="border-b border-zinc-100 px-5 py-4">
			<div class="flex items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-2.5">
					<CompassIcon class="size-4 shrink-0 text-zinc-500" />
					<div>
						<h3 class="text-sm font-semibold text-zinc-900">Explorează portalul</h3>
						<p class="mt-0.5 text-xs text-zinc-500">
							{completedCount}/{items.length} secțiuni vizitate
						</p>
					</div>
				</div>
				{#if allDone}
					<span class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
						<span class="size-1.5 rounded-full bg-emerald-500"></span>
						Complet
					</span>
				{:else}
					<span class="shrink-0 text-xs font-semibold tabular-nums text-zinc-900">
						{Math.round(progress)}%
					</span>
				{/if}
			</div>
			<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100">
				<div
					class="h-full rounded-full transition-all duration-500"
					class:bg-emerald-500={allDone}
					class:bg-zinc-900={!allDone}
					style="width: {progress}%"
				></div>
			</div>
		</div>

		<div class="p-2">
			{#each items as item (item.id)}
				{@const done = checklist[item.id]}
				<button
					type="button"
					onclick={() => {
						if (!done) goto(`/client/${tenantSlug}/${item.path}`);
					}}
					class="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
					class:hover:bg-zinc-50={!done}
					class:cursor-default={done}
					disabled={done}
				>
					{#if done}
						<CheckCircle2Icon class="size-4 shrink-0 text-emerald-500" />
						<span class="flex-1 truncate text-sm text-zinc-500">{item.label}</span>
					{:else}
						<CircleIcon class="size-4 shrink-0 text-zinc-300" />
						<span class="flex-1 truncate text-sm font-medium text-zinc-900">{item.label}</span>
						<ArrowRightIcon class="size-3.5 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100" />
					{/if}
				</button>
			{/each}
		</div>

		{#if allDone}
			<div class="border-t border-zinc-100 bg-zinc-50/50 px-5 py-3 text-center text-xs text-zinc-500">
				Felicitări! Ai explorat toate secțiunile portalului.
			</div>
		{/if}

		{#if tourState.completed}
			<div class="border-t border-zinc-100 px-3 py-3">
				<button
					type="button"
					onclick={async () => {
						await updateClientUserPreferences({
							onboardingTourCompleted: false,
							onboardingChecklist: null
						}).updates(prefsQuery);
						tourActions.reset();
					}}
					class="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
				>
					<RotateCcwIcon class="size-3.5" />
					Reia turul ghidat
				</button>
			</div>
		{/if}
	</div>
{/if}
