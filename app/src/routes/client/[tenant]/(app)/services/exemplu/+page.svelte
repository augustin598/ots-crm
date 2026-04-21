<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CheckIcon from '@lucide/svelte/icons/check';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import InfoIcon from '@lucide/svelte/icons/info';
	import {
		emptyAnswers,
		recommend,
		getAvailableGoals,
		isGoalValidForBusiness,
		BUSINESS_TYPE_OPTIONS,
		BUDGET_OPTIONS,
		PROJECT_STATUS_OPTIONS,
		type WizardAnswers,
		type Recommendation,
		type TierAdvice
	} from '$lib/logic/wizard-engine';
	import {
		CATEGORIES,
		TIER_LABELS,
		TIER_COLORS,
		getCategory,
		type Tier
	} from '$lib/constants/ots-catalog';
	import CategoryIcon from '$lib/components/services/CategoryIcon.svelte';
	import TierQuickGuide from '$lib/components/services/TierQuickGuide.svelte';
	import HelpCircleIcon from '@lucide/svelte/icons/help-circle';
	import { createPackageRequest } from '$lib/remotes/packages.remote';

	const tenantSlug = $derived(page.params.tenant);

	let step = $state(1);
	let tierGuideOpen = $state(false);
	const TOTAL_STEPS = 5;
	let answers = $state<WizardAnswers>(emptyAnswers());
	let submitting = $state(false);

	const progress = $derived((step / TOTAL_STEPS) * 100);

	const canProceed = $derived.by(() => {
		if (step === 1) {
			if (!answers.businessType) return false;
			if (answers.businessType === 'other' && !answers.businessTypeOther.trim()) return false;
			return true;
		}
		if (step === 2) return answers.goal !== null;
		if (step === 3) return answers.mediaBudget !== null;
		if (step === 4) return true; // optional
		if (step === 5) return answers.projectStatus !== null;
		return false;
	});

	const result = $derived(
		step > TOTAL_STEPS
			? recommend(answers)
			: null
	);

	const availableGoals = $derived(getAvailableGoals(answers.businessType));

	function setBusinessType(value: typeof answers.businessType) {
		answers.businessType = value;
		if (!isGoalValidForBusiness(answers.goal, value)) {
			answers.goal = null;
		}
	}

	function applyTierAdvice(advice: TierAdvice) {
		answers.mediaBudget = advice.suggestedBudget;
	}

	function toggleService(slug: string) {
		if (answers.interestedServices.includes(slug)) {
			answers.interestedServices = answers.interestedServices.filter((s) => s !== slug);
		} else {
			answers.interestedServices = [...answers.interestedServices, slug];
		}
	}

	function next() {
		if (!canProceed) return;
		step = Math.min(step + 1, TOTAL_STEPS + 1);
	}

	function prev() {
		step = Math.max(step - 1, 1);
	}

	function restart() {
		answers = emptyAnswers();
		step = 1;
	}

	function formatEur(value: number): string {
		return `${value.toLocaleString('ro-RO')} €`;
	}

	async function requestBundle(rec: Recommendation) {
		if (rec.bundle.services.length === 0) {
			toast.error('Bundle gol — nu se poate trimite cerere.');
			return;
		}
		submitting = true;
		const note = buildContextNote(rec);
		try {
			// Trimitem câte o cerere per serviciu, la tier-ul recomandat
			for (const slug of rec.bundle.services) {
				try {
					await createPackageRequest({
						categorySlug: slug,
						tier: rec.tier,
						note
					});
				} catch (innerErr) {
					console.error('[wizard] createPackageRequest failed for', slug, innerErr);
					throw innerErr;
				}
			}
			toast.success('Am trimis cererile pentru toate serviciile din bundle', {
				description: 'Echipa OTS te contactează cu oferta finală consolidată.'
			});
			goto(`/client/${tenantSlug}/services`);
		} catch (e) {
			console.error('[wizard] requestBundle outer error:', e);
			toast.error('Nu am putut trimite toate cererile', {
				description: e instanceof Error ? e.message : 'Încearcă din nou peste câteva minute.'
			});
		} finally {
			submitting = false;
		}
	}

	function buildContextNote(rec: Recommendation): string {
		const biz = BUSINESS_TYPE_OPTIONS.find((b) => b.value === answers.businessType);
		const goal = GOAL_OPTIONS.find((g) => g.value === answers.goal);
		const budget = BUDGET_OPTIONS.find((b) => b.value === answers.mediaBudget);
		const status = PROJECT_STATUS_OPTIONS.find((p) => p.value === answers.projectStatus);

		return [
			`Cerere generată prin wizardul Servicii & Oferte — bundle „${rec.bundle.name}".`,
			`Tip business: ${biz?.label || '—'}${answers.businessType === 'other' && answers.businessTypeOther ? ` (${answers.businessTypeOther})` : ''}`,
			`Obiectiv principal: ${goal?.label || '—'}`,
			`Buget media lunar: ${budget?.label || '—'}`,
			`Status proiect: ${status?.label || '—'}`,
			`Pachet recomandat: ${TIER_LABELS[rec.tier]}`,
			rec.cost.includedSetup
				? `Setup inclus: ${formatEur(rec.cost.setupTotal)} (one-time)`
				: 'Fără setup (conturi existente)',
			`Total lunar estimativ (cu discount ${rec.cost.discountPct}%): ${formatEur(rec.cost.monthlyAfterDiscount)}`
		].join('\n');
	}
</script>

<svelte:head>
	<title>Ce pachet aleg? — Wizard OTS</title>
</svelte:head>

<div class="container mx-auto px-4 py-6 max-w-4xl">
	<div class="mb-6">
		<a
			href={`/client/${tenantSlug}/services`}
			class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
		>
			<ChevronLeftIcon class="h-4 w-4" />
			Înapoi la catalog
		</a>
	</div>

	{#if step <= TOTAL_STEPS}
		<div class="mb-8">
			<div class="flex items-center gap-2 mb-1">
				<SparklesIcon class="h-3.5 w-3.5 text-primary" />
				<span class="text-[11px] font-medium uppercase tracking-wider text-primary">
					Pas {step} din {TOTAL_STEPS}
				</span>
			</div>
			<h1 class="text-3xl font-bold tracking-tight">Ce pachet ți se potrivește?</h1>
			<p class="text-muted-foreground mt-2">
				Răspunde la 5 întrebări rapide și primești recomandarea echipei OTS, cu preț estimat.
			</p>
		</div>

		<div class="h-1.5 rounded-full bg-muted mb-8 overflow-hidden">
			<div
				class="h-full bg-primary transition-all duration-300"
				style="width: {progress}%"
			></div>
		</div>

		<Card class="p-6 mb-6">
			{#if step === 1}
				<h2 class="text-xl font-semibold mb-1">Ce tip de business ai?</h2>
				<p class="text-sm text-muted-foreground mb-5">
					Ne ajută să înțelegem contextul și să recomandăm canalele potrivite.
				</p>
				<div class="grid gap-2.5">
					{#each BUSINESS_TYPE_OPTIONS as opt (opt.value)}
						<button
							type="button"
							onclick={() => setBusinessType(opt.value)}
							class="text-left p-4 rounded-lg border-2 transition-colors cursor-pointer {answers.businessType ===
							opt.value
								? 'border-primary bg-primary/5'
								: 'border-border hover:border-primary/40'}"
						>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<div class="font-medium">{opt.label}</div>
									<div class="text-xs text-muted-foreground mt-0.5">{opt.hint}</div>
								</div>
								{#if answers.businessType === opt.value}
									<CheckIcon class="h-5 w-5 text-primary shrink-0 mt-0.5" />
								{/if}
							</div>
						</button>
					{/each}
				</div>

				{#if answers.businessType === 'other'}
					<div class="mt-4 grid gap-2">
						<Label for="business-other">Descrie scurt domeniul tău</Label>
						<Input
							id="business-other"
							bind:value={answers.businessTypeOther}
							placeholder="Ex: platformă de rezervări evenimente, marketplace nișă..."
						/>
					</div>
				{/if}
			{/if}

			{#if step === 2}
				<h2 class="text-xl font-semibold mb-1">Care e obiectivul principal?</h2>
				<p class="text-sm text-muted-foreground mb-5">
					Asta determină canalele și strategia — nu doar trafic, ci trafic care aduce rezultatul
					dorit.
				</p>
				<div class="grid gap-2.5">
					{#each availableGoals as opt (opt.value)}
						<button
							type="button"
							onclick={() => (answers.goal = opt.value)}
							class="text-left p-4 rounded-lg border-2 transition-colors cursor-pointer {answers.goal ===
							opt.value
								? 'border-primary bg-primary/5'
								: 'border-border hover:border-primary/40'}"
						>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<div class="font-medium">{opt.label}</div>
									<div class="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
								</div>
								{#if answers.goal === opt.value}
									<CheckIcon class="h-5 w-5 text-primary shrink-0 mt-0.5" />
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/if}

			{#if step === 3}
				<h2 class="text-xl font-semibold mb-1">Cât alocă pentru buget media (Ads)?</h2>
				<p class="text-sm text-muted-foreground mb-2">
					Doar banii care merg către platforme (Google, Meta, TikTok) — managementul OTS se
					plătește separat.
				</p>
				<p class="text-xs text-muted-foreground mb-3 italic">
					Nu proiectăm rezultate pre-lansare. Bugetul ne ajută să calibrăm pachetul potrivit.
				</p>
				<button
					type="button"
					onclick={() => (tierGuideOpen = true)}
					class="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline mb-5"
				>
					<HelpCircleIcon class="h-3.5 w-3.5" />
					Ce înseamnă pachetele Bronze, Silver, Gold, Platinum?
				</button>
				<div class="grid gap-2.5">
					{#each BUDGET_OPTIONS as opt (opt.value)}
						{@const tierColors = TIER_COLORS[opt.tier]}
						<button
							type="button"
							onclick={() => (answers.mediaBudget = opt.value)}
							class="relative text-left p-4 rounded-lg border-2 transition-colors cursor-pointer {answers.mediaBudget ===
							opt.value
								? 'border-primary bg-primary/5'
								: 'border-border hover:border-primary/40'}"
						>
							{#if opt.badge === 'recommended'}
								<span
									class="absolute -top-2.5 right-4 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary text-primary-foreground shadow-sm"
								>
									<CheckIcon class="h-2.5 w-2.5" />
									Recomandat
								</span>
							{:else if opt.badge === 'popular'}
								<span
									class="absolute -top-2.5 right-4 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-sm"
								>
									Popular
								</span>
							{/if}
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2 mb-1 flex-wrap">
										<span class="font-medium">{opt.label}</span>
										<span
											class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border {tierColors.border} {tierColors.text} {tierColors.bg}"
										>
											<span class="h-1.5 w-1.5 rounded-full {tierColors.dot}"></span>
											Pachet {TIER_LABELS[opt.tier]}
										</span>
									</div>
									<div class="text-xs text-muted-foreground">{opt.note}</div>
								</div>
								{#if answers.mediaBudget === opt.value}
									<CheckIcon class="h-5 w-5 text-primary shrink-0 mt-0.5" />
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/if}

			{#if step === 4}
				<h2 class="text-xl font-semibold mb-1">Ce canale te interesează? (opțional)</h2>
				<p class="text-sm text-muted-foreground mb-5">
					Bifează ce ai deja în minte. Dacă nu ești sigur, lasă gol — echipa OTS alege ce
					funcționează pentru obiectivul tău.
				</p>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each CATEGORIES as cat (cat.slug)}
						{@const selected = answers.interestedServices.includes(cat.slug)}
						<button
							type="button"
							onclick={() => toggleService(cat.slug)}
							class="text-left p-3 rounded-lg border-2 transition-colors cursor-pointer flex items-start gap-3 {selected
								? 'border-primary bg-primary/5'
								: 'border-border hover:border-primary/40'}"
						>
							<div class="rounded-md bg-muted/60 p-1.5 shrink-0">
								<CategoryIcon slug={cat.slug} class="h-4 w-4" />
							</div>
							<div class="min-w-0 flex-1">
								<div class="text-sm font-medium">{cat.name}</div>
								<div class="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
									{cat.tagline}
								</div>
							</div>
							{#if selected}
								<CheckIcon class="h-4 w-4 text-primary shrink-0 mt-0.5" />
							{/if}
						</button>
					{/each}
				</div>
				{#if answers.interestedServices.length >= 2}
					<p class="text-xs text-primary mt-4">
						Ai ales {answers.interestedServices.length} servicii — discount multi-servicii se
						aplică automat.
					</p>
				{/if}
			{/if}

			{#if step === 5}
				<h2 class="text-xl font-semibold mb-1">Status proiect</h2>
				<p class="text-sm text-muted-foreground mb-5">
					Dacă ai deja conturi configurate, nu plătești din nou setup-ul.
				</p>
				<div class="grid gap-2.5">
					{#each PROJECT_STATUS_OPTIONS as opt (opt.value)}
						<button
							type="button"
							onclick={() => (answers.projectStatus = opt.value)}
							class="text-left p-4 rounded-lg border-2 transition-colors cursor-pointer {answers.projectStatus ===
							opt.value
								? 'border-primary bg-primary/5'
								: 'border-border hover:border-primary/40'}"
						>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<div class="font-medium">{opt.label}</div>
									<div class="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
								</div>
								{#if answers.projectStatus === opt.value}
									<CheckIcon class="h-5 w-5 text-primary shrink-0 mt-0.5" />
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</Card>

		<div class="flex items-center justify-between gap-3">
			<Button variant="outline" onclick={prev} disabled={step === 1}>
				<ChevronLeftIcon class="h-4 w-4 mr-1" />
				Înapoi
			</Button>
			<Button onclick={next} disabled={!canProceed}>
				{step === TOTAL_STEPS ? 'Vezi recomandarea' : 'Continuă'}
				<ChevronRightIcon class="h-4 w-4 ml-1" />
			</Button>
		</div>
	{:else if result}
		<!-- ============= RESULT PAGE ============== -->
		<div class="mb-8">
			<div class="flex items-center gap-2 mb-1">
				<SparklesIcon class="h-3.5 w-3.5 text-primary" />
				<span class="text-[11px] font-medium uppercase tracking-wider text-primary">
					Recomandarea ta
				</span>
			</div>
			<h1 class="text-3xl font-bold tracking-tight">
				Am găsit pachetul potrivit pentru tine
			</h1>
			<p class="text-muted-foreground mt-2">
				Pe baza răspunsurilor tale, iată ce combinație funcționează cel mai bine.
			</p>
		</div>

		{@const primary = result.primary}
		{@const tierColors = TIER_COLORS[primary.tier]}

		<!-- TIER ADVICE BANNER (if algorithm detected a better tier match) -->
		{#if result.tierAdvice}
			{@const advice = result.tierAdvice}
			{@const isWarning = advice.severity === 'warning'}
			<div
				class="mb-6 rounded-lg border p-4 flex items-start gap-3 {isWarning
					? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40'
					: 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40'}"
			>
				<div
					class="rounded-md p-1.5 shrink-0 {isWarning
						? 'bg-amber-200/50 dark:bg-amber-900/50'
						: 'bg-blue-200/50 dark:bg-blue-900/50'}"
				>
					{#if isWarning}
						<LightbulbIcon class="h-4 w-4 text-amber-700 dark:text-amber-300" />
					{:else}
						<InfoIcon class="h-4 w-4 text-blue-700 dark:text-blue-300" />
					{/if}
				</div>
				<div class="flex-1 min-w-0">
					<div
						class="text-sm font-semibold mb-1 {isWarning
							? 'text-amber-900 dark:text-amber-200'
							: 'text-blue-900 dark:text-blue-200'}"
					>
						Sugestie: treci la pachetul {TIER_LABELS[advice.suggestedTier]}
					</div>
					<p
						class="text-xs leading-relaxed {isWarning
							? 'text-amber-800 dark:text-amber-300/90'
							: 'text-blue-800 dark:text-blue-300/90'}"
					>
						{advice.rationale}
					</p>
					<div class="flex items-center gap-2 mt-3 flex-wrap">
						<Button size="sm" variant="outline" onclick={() => applyTierAdvice(advice)}>
							Aplică sugestia ({TIER_LABELS[advice.suggestedTier]})
						</Button>
						<button
							type="button"
							onclick={() => (tierGuideOpen = true)}
							class="inline-flex items-center gap-1 text-xs font-medium hover:underline {isWarning
								? 'text-amber-900 dark:text-amber-200'
								: 'text-blue-900 dark:text-blue-200'}"
						>
							Ce înseamnă pachetele?
						</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- PRIMARY RECOMMENDATION -->
		<Card
			class="relative p-6 mb-6 border-2 border-primary/40 overflow-hidden {tierColors.metallic}"
		>
			<div
				class="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/50 to-transparent dark:from-white/10"
			></div>
			<div class="relative">
				<div class="flex items-center gap-2 mb-3 flex-wrap">
					<Badge class="bg-primary text-primary-foreground">Top match</Badge>
					<Badge class="border {tierColors.border} {tierColors.text} bg-white/70 dark:bg-black/30">
						<span class="h-1.5 w-1.5 rounded-full {tierColors.dot} mr-1.5"></span>
						Pachet {TIER_LABELS[primary.tier]}
					</Badge>
					<button
						type="button"
						onclick={() => (tierGuideOpen = true)}
						class="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
					>
						<HelpCircleIcon class="h-3 w-3" />
						Ce înseamnă asta?
					</button>
				</div>
				<h2 class="text-2xl font-bold {tierColors.text}">{primary.bundle.name}</h2>
				<p class="text-sm {tierColors.text} opacity-80 mt-1">{primary.bundle.tagline}</p>

				<!-- Services included -->
				<div class="flex flex-wrap gap-2 mt-4">
					{#each primary.bundle.services as slug (slug)}
						<span
							class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-white/70 dark:bg-black/30 border border-white/60 dark:border-white/10"
						>
							<CategoryIcon {slug} class="h-3.5 w-3.5" />
							<span class="font-medium">{getCategory(slug)?.name}</span>
						</span>
					{/each}
				</div>

				<!-- Cost breakdown: 3-step timeline (industry standard billing) -->
				<div class="mt-6 space-y-3">
					{#if primary.cost.includedSetup && primary.cost.setupTotal > 0}
						<div class="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
							Cum se facturează
						</div>

						<!-- Step 1: Contract signing — setup fee -->
						<div
							class="rounded-lg bg-white/80 dark:bg-black/40 border border-white/60 dark:border-white/10 p-4"
						>
							<div class="flex items-start gap-3">
								<span
									class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0"
								>
									1
								</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-baseline justify-between gap-2 flex-wrap mb-1">
										<span class="text-sm font-semibold">La semnarea contractului</span>
										<span class="text-xl font-bold">{formatEur(primary.cost.setupTotal)}</span>
									</div>
									<p class="text-xs text-muted-foreground leading-snug">
										<strong>Taxă implementare tehnică</strong> — GTM, GA4, Pixel, Consent Mode v2
										(GDPR), structurare conturi, prima configurație campanii. Plătită înainte să
										pornim munca, o singură dată.
									</p>
								</div>
							</div>
						</div>

						<!-- Step 2: Campaign launch — first monthly -->
						<div
							class="rounded-lg bg-white/80 dark:bg-black/40 border border-white/60 dark:border-white/10 p-4"
						>
							<div class="flex items-start gap-3">
								<span
									class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0"
								>
									2
								</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-baseline justify-between gap-2 flex-wrap mb-1">
										<span class="text-sm font-semibold">La lansarea campaniilor (~10-14 zile)</span>
										<span class="text-xl font-bold">
											{formatEur(primary.cost.monthlyAfterDiscount)}
										</span>
									</div>
									<p class="text-xs text-muted-foreground leading-snug">
										<strong>Primul abonament lunar</strong> — se facturează în ziua lansării
										campaniilor, nu la final de lună.
									</p>
								</div>
							</div>
						</div>

						<!-- Step 3: Recurring -->
						<div
							class="rounded-lg bg-white/80 dark:bg-black/40 border border-white/60 dark:border-white/10 p-4"
						>
							<div class="flex items-start gap-3">
								<span
									class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-muted-foreground/25 text-foreground text-xs font-bold shrink-0"
								>
									3+
								</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-baseline justify-between gap-2 flex-wrap mb-1">
										<span class="text-sm font-semibold">Din luna a 2-a, recurent</span>
										<span class="text-xl font-bold">
											{formatEur(primary.cost.monthlyAfterDiscount)}<span
												class="text-xs font-normal text-muted-foreground"
											>
												/lună</span
											>
										</span>
									</div>
									<p class="text-xs text-muted-foreground leading-snug">
										<strong>Doar abonamentul lunar</strong>, fără setup. Implementarea tehnică e deja
										făcută.
									</p>
								</div>
							</div>
						</div>

						{#if primary.cost.discountPct > 0}
							<div
								class="rounded-lg bg-primary/10 border border-primary/20 px-4 py-2.5 text-xs flex items-center justify-between gap-2 flex-wrap"
							>
								<span class="text-muted-foreground">
									Abonament brut:
									<span class="line-through">{formatEur(primary.cost.monthlyTotal)}/lună</span>
								</span>
								<span class="text-primary font-semibold">
									Discount multi-servicii −{primary.cost.discountPct}% = economisești
									{formatEur(primary.cost.monthlySavings)}/lună
								</span>
							</div>
						{/if}
					{:else}
						<!-- No setup needed (continuing project) -->
						<div
							class="rounded-lg bg-white/80 dark:bg-black/40 p-4 border border-white/60 dark:border-white/10"
						>
							<div class="flex items-center gap-2 mb-2">
								<span class="text-xs uppercase tracking-wider font-semibold">
									Cost lunar (fără setup)
								</span>
							</div>
							{#if primary.cost.discountPct > 0}
								<div class="flex items-baseline gap-2">
									<span class="text-sm line-through text-muted-foreground">
										{formatEur(primary.cost.monthlyTotal)}
									</span>
									<span class="text-xs font-semibold text-primary">
										−{primary.cost.discountPct}%
									</span>
								</div>
							{/if}
							<div class="text-3xl font-bold">
								{formatEur(primary.cost.monthlyAfterDiscount)}
								<span class="text-sm font-normal text-muted-foreground">/lună</span>
							</div>
							<p class="text-xs text-muted-foreground mt-1">
								Folosim conturile tale existente — zero setup nou.
							</p>
						</div>
					{/if}
				</div>

				<!-- Why this -->
				<div class="mt-6 rounded-lg bg-white/70 dark:bg-black/30 p-4 border border-white/60 dark:border-white/10">
					<div class="text-xs uppercase tracking-wider text-muted-foreground mb-2">
						De ce ți-am recomandat asta
					</div>
					<ul class="space-y-1.5">
						{#each primary.reasonWhy as reason (reason)}
							<li class="flex items-start gap-2 text-sm">
								<CheckIcon class="h-4 w-4 text-primary shrink-0 mt-0.5" />
								<span>{reason}</span>
							</li>
						{/each}
					</ul>
					<p class="text-xs text-muted-foreground mt-3 italic">
						{primary.bundle.rationale}
					</p>
				</div>

				<!-- Warnings -->
				{#if result.warnings.length > 0}
					<div
						class="mt-4 rounded-lg bg-amber-100 dark:bg-amber-950/40 p-3 border border-amber-300 dark:border-amber-800"
					>
						{#each result.warnings as warn (warn)}
							<div class="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
								<AlertTriangleIcon class="h-4 w-4 shrink-0 mt-0.5" />
								<span>{warn}</span>
							</div>
						{/each}
						<button
							type="button"
							onclick={() => (tierGuideOpen = true)}
							class="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200 hover:underline"
						>
							<HelpCircleIcon class="h-3.5 w-3.5" />
							Ce înseamnă Bronze / Silver / Gold / Platinum?
						</button>
					</div>
				{/if}

				<!-- CTA -->
				<div class="mt-6 flex flex-wrap gap-3">
					<Button size="lg" onclick={() => requestBundle(primary)} disabled={submitting}>
						{submitting ? 'Se trimite...' : 'Trimit cerere pentru acest pachet'}
						<ArrowRightIcon class="h-4 w-4 ml-2" />
					</Button>
					<Button variant="outline" onclick={restart}>
						<RotateCcwIcon class="h-4 w-4 mr-2" />
						Răspunde din nou
					</Button>
				</div>
			</div>
		</Card>

		<!-- ALTERNATIVES -->
		{#if result.alternatives.length > 0}
			<h2 class="text-xl font-semibold mb-1 mt-10">Alternative de explorat</h2>
			<p class="text-sm text-muted-foreground mb-5">
				Dacă recomandarea principală nu e exact ce ai în minte, uite alte 2 variante.
			</p>
			<div class="grid gap-4 sm:grid-cols-2">
				{#each result.alternatives as alt (alt.bundle.id)}
					{@const altColors = TIER_COLORS[alt.tier]}
					<Card class="p-5 hover:border-primary/50 transition-colors">
						<div class="flex items-center gap-2 mb-2 flex-wrap">
							<h3 class="font-semibold">{alt.bundle.name}</h3>
							<span
								class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border {altColors.border} {altColors.text} {altColors.bg}"
							>
								<span class="h-1.5 w-1.5 rounded-full {altColors.dot}"></span>
								{TIER_LABELS[alt.tier]}
							</span>
						</div>
						{#if alt.reasonLabel}
							<p class="text-[11px] font-medium uppercase tracking-wider text-primary mb-1">
								{alt.reasonLabel}
							</p>
						{/if}
						<p class="text-xs text-muted-foreground mb-3">{alt.bundle.tagline}</p>

						<div class="flex flex-wrap gap-1.5 mb-3">
							{#each alt.bundle.services as slug (slug)}
								<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-muted">
									<CategoryIcon {slug} class="h-3 w-3" />
									{getCategory(slug)?.name}
								</span>
							{/each}
						</div>

						<div class="pt-3 border-t flex items-baseline justify-between gap-2 text-sm">
							<span class="font-bold">
								{formatEur(alt.cost.monthlyAfterDiscount)}
								<span class="text-xs font-normal text-muted-foreground">/lună</span>
							</span>
							{#if alt.cost.discountPct > 0}
								<span class="text-xs text-primary">−{alt.cost.discountPct}%</span>
							{/if}
						</div>
						{#if alt.cost.includedSetup && alt.cost.setupTotal > 0}
							<div class="text-xs text-muted-foreground mt-1">
								Setup one-time: {formatEur(alt.cost.setupTotal)}
							</div>
						{/if}

						<Button
							variant="outline"
							size="sm"
							class="w-full mt-4"
							onclick={() => requestBundle(alt)}
							disabled={submitting}
						>
							Alege această variantă
						</Button>
					</Card>
				{/each}
			</div>
		{/if}

		<section class="rounded-lg bg-muted/40 p-4 mt-8 text-sm">
			<p class="font-medium mb-1">Despre prețurile afișate</p>
			<p class="text-xs text-muted-foreground leading-relaxed">
				Costurile de mai sus sunt doar pentru managementul OTS, în EUR fără TVA. Bugetul media
				(banii care merg în platforme) și costul platformelor externe (Brevo, HubSpot etc.) se
				plătesc separat direct către furnizor. Oferta finală o confirmăm după un audit scurt —
				poate include ajustări pentru volumul sau complexitatea proiectului.
			</p>
		</section>
	{/if}
</div>

<TierQuickGuide bind:open={tierGuideOpen} />
