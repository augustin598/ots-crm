<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getChecklistItems } from './tour-steps';
	import { getClientUserPreferences, updateClientUserPreferences } from '$lib/remotes/client-user-preferences.remote';
	import { tourState, tourActions } from '$lib/stores/onboarding-store.svelte';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Progress } from '$lib/components/ui/progress';
	import { Badge } from '$lib/components/ui/badge';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import CompassIcon from '@lucide/svelte/icons/compass';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';

	let { isPrimary, tenantSlug }: { isPrimary: boolean; tenantSlug: string } = $props();

	const items = getChecklistItems(isPrimary);
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
	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<div>
					<CardTitle class="flex items-center gap-2">
						<CompassIcon class="h-5 w-5" />
						Explorează portalul
					</CardTitle>
					<CardDescription>
						{completedCount}/{items.length} secțiuni vizitate
					</CardDescription>
				</div>
				{#if allDone}
					<Badge variant="success">Complet!</Badge>
				{/if}
			</div>
		</CardHeader>
		<CardContent class="space-y-4">
			<Progress value={progress} max={100} class="h-2" />

			<div class="space-y-1">
				{#each items as item (item.id)}
					{@const done = checklist[item.id]}
					<button
						onclick={() => {
							if (!done) goto(`/client/${tenantSlug}/${item.path}`);
						}}
						class="flex items-center gap-3 w-full text-left p-2 rounded-md transition-colors {done
							? 'text-muted-foreground'
							: 'hover:bg-accent cursor-pointer'}"
						disabled={done}
					>
						{#if done}
							<CheckCircle2Icon class="h-4 w-4 text-green-500 shrink-0" />
						{:else}
							<CircleIcon class="h-4 w-4 text-muted-foreground shrink-0" />
						{/if}
						<span class="text-sm {done ? 'line-through' : 'font-medium'}">{item.label}</span>
					</button>
				{/each}
			</div>

			{#if allDone}
				<p class="text-sm text-muted-foreground text-center pt-2">
					Felicitări! Ai explorat toate secțiunile portalului.
				</p>
			{/if}

			{#if tourState.completed}
				<Button variant="outline" size="sm" class="w-full" onclick={async () => {
					await updateClientUserPreferences({
						onboardingTourCompleted: false,
						onboardingChecklist: null
					}).updates(prefsQuery);
					tourActions.reset();
				}}>
					<RotateCcwIcon class="h-4 w-4 mr-2" />
					Reia turul ghidat
				</Button>
			{/if}
		</CardContent>
	</Card>
{/if}
