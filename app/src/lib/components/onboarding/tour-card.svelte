<script lang="ts">
	import type { TourStep } from './tour-steps';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Progress } from '$lib/components/ui/progress';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import XIcon from '@lucide/svelte/icons/x';
	import { fly } from 'svelte/transition';

	let {
		step,
		currentIndex,
		totalSteps,
		onNext,
		onPrev,
		onSkip
	}: {
		step: TourStep;
		currentIndex: number;
		totalSteps: number;
		onNext: () => void;
		onPrev: () => void;
		onSkip: () => void;
	} = $props();

	const progress = $derived(((currentIndex + 1) / totalSteps) * 100);
	const isFirst = $derived(currentIndex === 0);
	const isLast = $derived(currentIndex === totalSteps - 1);
</script>

<div
	class="fixed left-[var(--sidebar-width,16rem)] top-1/3 z-50 ml-6 w-80"
	transition:fly={{ x: -20, duration: 250 }}
>
	<Card class="shadow-xl border-primary/20">
		<CardHeader class="pb-3">
			<div class="flex items-center justify-between">
				<span class="text-xs text-muted-foreground font-medium">
					Pas {currentIndex + 1} din {totalSteps}
				</span>
				<button
					onclick={onSkip}
					class="text-muted-foreground hover:text-foreground transition-colors"
					aria-label="Închide turul"
				>
					<XIcon class="h-4 w-4" />
				</button>
			</div>
			<CardTitle class="text-lg">{step.title}</CardTitle>
			<CardDescription>{step.description}</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			<Progress value={progress} max={100} class="h-1.5" />
			<div class="flex items-center gap-2">
				{#if !isFirst}
					<Button variant="outline" size="sm" onclick={onPrev}>
						<ChevronLeftIcon class="h-4 w-4 mr-1" />
						Înapoi
					</Button>
				{/if}
				<div class="flex-1"></div>
				<Button size="sm" onclick={onNext}>
					{#if isLast}
						Finalizează
					{:else}
						Următorul
						<ChevronRightIcon class="h-4 w-4 ml-1" />
					{/if}
				</Button>
			</div>
		</CardContent>
	</Card>
</div>
