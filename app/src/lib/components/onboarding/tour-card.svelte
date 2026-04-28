<script lang="ts">
	import type { TourStep } from './tour-steps';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Progress } from '$lib/components/ui/progress';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import XIcon from '@lucide/svelte/icons/x';
	import { fly } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';

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

	const CARD_HEIGHT_ESTIMATE = 280;
	const VIEWPORT_PADDING = 16;

	let anchorTop = $state<number | null>(null);

	function computeAnchor() {
		if (!browser) return;
		const el = document.querySelector(`[data-sidebar-id="${step.sidebarKey}"]`);
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const center = rect.top + rect.height / 2;
		const minTop = VIEWPORT_PADDING + CARD_HEIGHT_ESTIMATE / 2;
		const maxTop = window.innerHeight - VIEWPORT_PADDING - CARD_HEIGHT_ESTIMATE / 2;
		anchorTop = Math.max(minTop, Math.min(maxTop, center));
	}

	$effect(() => {
		// Recompute when the step changes
		void step.sidebarKey;
		computeAnchor();
	});

	onMount(() => {
		computeAnchor();
		const onResize = () => computeAnchor();
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});
</script>

<div
	class="fixed left-[var(--sidebar-width,16rem)] z-50 ml-6 w-80 -translate-y-1/2"
	style:top={anchorTop !== null ? `${anchorTop}px` : '33vh'}
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
