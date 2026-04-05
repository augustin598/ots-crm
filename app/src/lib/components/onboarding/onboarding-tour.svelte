<script lang="ts">
	import { goto, afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { getTourSteps, getChecklistItems } from './tour-steps';
	import TourCard from './tour-card.svelte';
	import { tourState, tourActions } from '$lib/stores/onboarding-store.svelte';
	import { getClientUserPreferences, updateClientUserPreferences } from '$lib/remotes/client-user-preferences.remote';

	let { isPrimary, tenantSlug }: { isPrimary: boolean; tenantSlug: string } = $props();

	const steps = $derived(getTourSteps(isPrimary));
	const checklistItems = $derived(getChecklistItems(isPrimary));
	let showCard = $state(false);
	let navigating = $state(false);

	const prefsQuery = getClientUserPreferences();
	const prefs = $derived(prefsQuery.current);

	// Initialize tour state from DB preferences (once)
	$effect(() => {
		if (prefs && !tourState.initialized) {
			tourActions.init({
				onboardingTourCompleted: prefs.onboardingTourCompleted,
				onboardingTourEnabled: prefs.onboardingTourEnabled
			});
		}
	});

	// Auto-start tour on first visit
	let autoStartDone = $state(false);

	// Reset autoStartDone when tour completes (allows re-trigger after reset)
	$effect(() => {
		if (tourState.completed) {
			autoStartDone = false;
		}
	});

	$effect(() => {
		if (tourState.initialized && !tourState.completed && tourState.enabled && !tourState.active && !autoStartDone) {
			autoStartDone = true;
			setTimeout(() => {
				if (!tourState.completed && tourState.enabled && !tourState.active) {
					tourActions.start();
				}
			}, 500);
		}
	});

	// Navigate when tour step changes
	$effect(() => {
		if (!tourState.active) {
			showCard = false;
			return;
		}
		const currentStep = steps[tourState.step];
		if (!currentStep) return;

		const targetPath = `/client/${tenantSlug}/${currentStep.path}`;
		const currentPath = page.url.pathname;

		if (currentPath !== targetPath) {
			showCard = false;
			navigating = true;
			goto(targetPath);
		} else if (!navigating) {
			// Already on correct page and not mid-navigation
			showCard = true;
		}
	});

	// Show card after navigation completes
	afterNavigate(() => {
		if (tourState.active && navigating) {
			navigating = false;
			setTimeout(() => {
				if (tourState.active) showCard = true;
			}, 300);
		}
	});

	// Sidebar highlight effect
	$effect(() => {
		if (!browser) return;

		// Clean all previous highlights
		document.querySelectorAll('[data-sidebar-id].ring-2').forEach((el) => {
			el.classList.remove('ring-2', 'ring-primary', 'animate-pulse');
		});

		if (tourState.active && steps[tourState.step]) {
			const el = document.querySelector(`[data-sidebar-id="${steps[tourState.step].sidebarKey}"]`);
			if (el) {
				el.classList.add('ring-2', 'ring-primary', 'animate-pulse');
			}
		}
	});

	// Auto-check checklist items when user visits pages (runs in layout, persists across all pages)
	const checklistPersisted = new Set<string>();

	afterNavigate(() => {
		if (!prefs) return;
		const currentPath = page.url.pathname;
		const basePath = `/client/${tenantSlug}/`;

		let currentChecklist: Record<string, boolean> = {};
		try {
			currentChecklist = prefs.onboardingChecklist ? JSON.parse(prefs.onboardingChecklist) : {};
		} catch { /* ignore */ }

		for (const item of checklistItems) {
			if (checklistPersisted.has(item.id)) continue;
			if (currentChecklist[item.id]) continue;
			const itemPath = basePath + item.path;
			if (currentPath.startsWith(itemPath)) {
				checklistPersisted.add(item.id);
				const updated = { ...currentChecklist, [item.id]: true };
				updateClientUserPreferences({
					onboardingChecklist: JSON.stringify(updated)
				}).updates(prefsQuery);
				break;
			}
		}
	});

	async function handleNext() {
		const wasLastStep = tourState.step >= steps.length - 1;
		tourActions.next(steps.length);
		if (wasLastStep) {
			showCard = false;
			await persistCompletion();
			await goto(`/client/${tenantSlug}/dashboard`);
		}
	}

	function handlePrev() {
		tourActions.prev();
	}

	async function handleSkip() {
		showCard = false;
		tourActions.skip();
		await persistCompletion();
	}

	async function persistCompletion() {
		try {
			await updateClientUserPreferences({ onboardingTourCompleted: true }).updates(prefsQuery);
		} catch {
			// Silently fail — localStorage has the state
		}
	}
</script>

{#if tourState.active && showCard && steps[tourState.step]}
	<!-- Backdrop — pointer-events-auto only on backdrop, none during exit transition -->
	<button
		class="fixed inset-0 bg-black/20 z-40 cursor-default"
		onclick={handleSkip}
		onkeydown={(e) => { if (e.key === 'Escape') handleSkip(); }}
		aria-label="Închide turul"
	></button>

	<!-- Tour Card -->
	<TourCard
		step={steps[tourState.step]}
		currentIndex={tourState.step}
		totalSteps={steps.length}
		onNext={handleNext}
		onPrev={handlePrev}
		onSkip={handleSkip}
	/>
{/if}
