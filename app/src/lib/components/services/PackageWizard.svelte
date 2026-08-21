<!--
  Wizardul de recomandare pachete, folosit în DOUĂ locuri: portalul clientului
  (/client/[tenant]/services/exemplu) și pagina publică (/servicii/configurator).

  Catalogul și acțiunea de trimitere vin prin props, nu din importuri statice:
  pagina publică e protejată cu parolă, iar un import din `ots-catalog` ar
  împacheta prețurile într-un chunk JS servit oricui. Portalul pasează
  constantele direct; pagina publică pasează ce a primit din `load`.
-->
<script lang="ts">
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
		GOAL_OPTIONS,
		BUDGET_OPTIONS,
		PROJECT_STATUS_OPTIONS,
		type WizardAnswers,
		type Recommendation,
		type TierAdvice
	} from '$lib/logic/wizard-engine';
	import type { WizardCatalog } from '$lib/logic/wizard-engine';
	import type { Category, Tier, TierColors } from '$lib/constants/ots-catalog';
	import CategoryIcon from '$lib/components/services/CategoryIcon.svelte';
	import WizardOptionIcon from '$lib/components/services/WizardOptionIcon.svelte';
	import TierQuickGuide from '$lib/components/services/TierQuickGuide.svelte';
	import HelpCircleIcon from '@lucide/svelte/icons/help-circle';

	type Props = {
		/** Catalogul complet — pe public vine din `load`, în portal din constante. */
		catalog: WizardCatalog & {
			categories: Category[];
			tierLabels: Record<Tier, string>;
			tierColors: Record<Tier, TierColors>;
		};
		/** Unde duce linkul „Înapoi la catalog". */
		backHref: string;
		/** Trimiterea cererii diferă per context (portal autentificat vs public). */
		onRequest: (rec: Recommendation, note: string) => Promise<void>;
	};

	let { catalog, backHref, onRequest }: Props = $props();

	const CATEGORIES = $derived(catalog.categories);
	const TIER_LABELS = $derived(catalog.tierLabels);
	const TIER_COLORS = $derived(catalog.tierColors);
	// Funcție simplă, nu $derived: citește `catalog` la fiecare apel din markup,
	// deci rămâne reactivă fără să ambaleze o funcție într-un derived.
	function getCategory(slug: string) {
		return catalog.categories.find((c) => c.slug === slug);
	}

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
			? recommend(answers, catalog)
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
		try {
			await onRequest(rec, buildContextNote(rec));
		} catch (e) {
			console.error('[wizard] requestBundle error:', e);
			toast.error('Nu am putut trimite cererea', {
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

<div class="wz">
	<div class="wz-inner">
	<div class="mb-6">
		<a href={backHref} class="wz-back">
			<ChevronLeftIcon class="h-4 w-4" />
			Înapoi la catalog
		</a>
	</div>

	{#if step <= TOTAL_STEPS}
		<div class="wz-head">
			<span class="wz-kicker"><SparklesIcon class="h-3.5 w-3.5" /> Pas {step} din {TOTAL_STEPS}</span>
			<h1>Ce pachet ți se potrivește?</h1>
			<p>Răspunde la 5 întrebări rapide și primești recomandarea echipei OTS, cu preț estimat.</p>
		</div>

		<div
			class="wz-progress"
			role="progressbar"
			aria-valuenow={step}
			aria-valuemin={1}
			aria-valuemax={TOTAL_STEPS}
			aria-label="Progres wizard"
		>
			<div class="wz-progress-bar" style="width: {progress}%"></div>
		</div>

		<div class="wz-card">
			{#if step === 1}
				<h2 class="wz-q">Ce tip de business ai?</h2>
				<p class="wz-q-hint">
					Ne ajută să înțelegem contextul și să recomandăm canalele potrivite.
				</p>
				<div class="grid gap-2.5">
					{#each BUSINESS_TYPE_OPTIONS as opt (opt.value)}
						<button
							type="button"
							onclick={() => setBusinessType(opt.value)}
							class="wz-opt" class:is-on={answers.businessType === opt.value}
						>
							<div class="flex items-start gap-3">
								<div
									class="wz-opt-icon"
								>
									<WizardOptionIcon icon={opt.icon} class="h-5 w-5" />
								</div>
								<div class="min-w-0 flex-1">
									<div class="font-medium">{opt.label}</div>
									<div class="text-xs text-muted-foreground mt-0.5">{opt.hint}</div>
								</div>
								{#if answers.businessType === opt.value}
									<CheckIcon class="wz-opt-check" />
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
				<h2 class="wz-q">Care e obiectivul principal?</h2>
				<p class="wz-q-hint">
					Asta determină canalele și strategia — nu doar trafic, ci trafic care aduce rezultatul
					dorit.
				</p>
				<div class="grid gap-2.5">
					{#each availableGoals as opt (opt.value)}
						<button
							type="button"
							onclick={() => (answers.goal = opt.value)}
							class="wz-opt" class:is-on={answers.goal === opt.value}
						>
							<div class="flex items-start gap-3">
								<div
									class="wz-opt-icon"
								>
									<WizardOptionIcon icon={opt.icon} class="h-5 w-5" />
								</div>
								<div class="min-w-0 flex-1">
									<div class="font-medium">{opt.label}</div>
									<div class="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
								</div>
								{#if answers.goal === opt.value}
									<CheckIcon class="wz-opt-check" />
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/if}

			{#if step === 3}
				<h2 class="wz-q">Cât alocă pentru buget media (Ads)?</h2>
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
							class="wz-opt" class:is-on={answers.mediaBudget === opt.value}
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
									<CheckIcon class="wz-opt-check" />
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/if}

			{#if step === 4}
				<h2 class="wz-q">Ce canale te interesează? (opțional)</h2>
				<p class="wz-q-hint">
					Bifează ce ai deja în minte. Dacă nu ești sigur, lasă gol — echipa OTS alege ce
					funcționează pentru obiectivul tău.
				</p>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each CATEGORIES as cat (cat.slug)}
						{@const selected = answers.interestedServices.includes(cat.slug)}
						<button
							type="button"
							onclick={() => toggleService(cat.slug)}
							class="wz-opt wz-opt--row" class:is-on={selected}
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
								<CheckIcon class="wz-opt-check wz-opt-check--sm" />
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
				<h2 class="wz-q">Status proiect</h2>
				<p class="wz-q-hint">
					Dacă ai deja conturi configurate, nu plătești din nou setup-ul.
				</p>
				<div class="grid gap-2.5">
					{#each PROJECT_STATUS_OPTIONS as opt (opt.value)}
						<button
							type="button"
							onclick={() => (answers.projectStatus = opt.value)}
							class="wz-opt" class:is-on={answers.projectStatus === opt.value}
						>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<div class="font-medium">{opt.label}</div>
									<div class="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
								</div>
								{#if answers.projectStatus === opt.value}
									<CheckIcon class="wz-opt-check" />
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<div class="wz-nav">
			<button type="button" class="wz-btn wz-btn-ghost" onclick={prev} disabled={step === 1}>
				<ChevronLeftIcon class="h-4 w-4" />
				Înapoi
			</button>
			<button type="button" class="wz-btn wz-btn-primary ots-gloss" onclick={next} disabled={!canProceed}>
				{step === TOTAL_STEPS ? 'Vezi recomandarea' : 'Continuă'}
				<ChevronRightIcon class="h-4 w-4" />
			</button>
		</div>
	{:else if result}
		<!-- ============= RESULT PAGE ==============
		     Același limbaj vizual ca /servicii: carduri albe cu bordură --border și raze 18px,
		     kicker albastru, chip-uri albe cu icon, cutii pe --bg-soft, butoanele paginii. -->
		<div class="wz-head">
			<span class="wz-kicker"><SparklesIcon class="h-3.5 w-3.5" /> Recomandarea ta</span>
			<h1>Am găsit pachetul potrivit pentru tine</h1>
			<p>Pe baza răspunsurilor tale, iată ce combinație funcționează cel mai bine.</p>
		</div>

		{@const primary = result.primary}
		{@const tierColors = TIER_COLORS[primary.tier]}

		<!-- TIER ADVICE BANNER (if algorithm detected a better tier match) -->
		{#if result.tierAdvice}
			{@const advice = result.tierAdvice}
			<div class={['wz-note', advice.severity === 'warning' && 'wz-note--warn']}>
				<span class="wz-note-icon" aria-hidden="true">
					{#if advice.severity === 'warning'}
						<LightbulbIcon class="h-4 w-4" />
					{:else}
						<InfoIcon class="h-4 w-4" />
					{/if}
				</span>
				<div class="wz-note-body">
					<strong>Sugestie: treci la pachetul {TIER_LABELS[advice.suggestedTier]}</strong>
					<p>{advice.rationale}</p>
					<div class="wz-note-actions">
						<button type="button" class="wz-btn wz-btn-ghost wz-btn--sm" onclick={() => applyTierAdvice(advice)}>
							Aplică sugestia ({TIER_LABELS[advice.suggestedTier]})
						</button>
						<button type="button" class="wz-link" onclick={() => (tierGuideOpen = true)}>
							Ce înseamnă pachetele?
						</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- PRIMARY RECOMMENDATION -->
		<article class="wz-result">
			<div class="wz-result-band {tierColors.metallic}" aria-hidden="true"></div>
			<div class="wz-result-body">
				<div class="wz-pills">
					<span class="wz-pill wz-pill--accent">Top match</span>
					<span class="wz-pill wz-pill--tier {tierColors.text}">
						<span class="wz-dot {tierColors.dot}"></span>
						Pachet {TIER_LABELS[primary.tier]}
					</span>
					<button type="button" class="wz-link" onclick={() => (tierGuideOpen = true)}>
						<HelpCircleIcon class="h-3 w-3" />
						Ce înseamnă asta?
					</button>
				</div>
				<h2 class="wz-result-title">{primary.bundle.name}</h2>
				<p class="wz-result-tagline">{primary.bundle.tagline}</p>

				<!-- Services included -->
				<div class="wz-chips">
					{#each primary.bundle.services as slug (slug)}
						<span class="wz-chip">
							<span class="wz-chip-icon"><CategoryIcon {slug} class="h-3.5 w-3.5" /></span>
							{getCategory(slug)?.name}
						</span>
					{/each}
				</div>

				<!-- Cost breakdown: 3-step timeline (industry standard billing) -->
				{#if primary.cost.includedSetup && primary.cost.setupTotal > 0}
					<div class="wz-box">
						<div class="wz-box-kicker">Cum se facturează</div>
						<ol class="wz-bill">
							<li class="wz-bill-step">
								<span class="wz-bill-n">1</span>
								<div class="wz-bill-body">
									<div class="wz-bill-row">
										<span class="wz-bill-label">La semnarea contractului</span>
										<span class="wz-bill-amount">{formatEur(primary.cost.setupTotal)}</span>
									</div>
									<p>
										<strong>Taxă implementare tehnică</strong> — GTM, GA4, Pixel, Consent Mode v2
										(GDPR), structurare conturi, prima configurație campanii. Plătită înainte să
										pornim munca, o singură dată.
									</p>
								</div>
							</li>
							<li class="wz-bill-step">
								<span class="wz-bill-n">2</span>
								<div class="wz-bill-body">
									<div class="wz-bill-row">
										<span class="wz-bill-label">La lansarea campaniilor (~10–14 zile)</span>
										<span class="wz-bill-amount">{formatEur(primary.cost.monthlyAfterDiscount)}</span>
									</div>
									<p>
										<strong>Primul abonament lunar</strong> — se facturează în ziua lansării
										campaniilor, nu la final de lună.
									</p>
								</div>
							</li>
							<li class="wz-bill-step">
								<span class="wz-bill-n wz-bill-n--muted">3+</span>
								<div class="wz-bill-body">
									<div class="wz-bill-row">
										<span class="wz-bill-label">Din luna a 2-a, recurent</span>
										<span class="wz-bill-amount">
											{formatEur(primary.cost.monthlyAfterDiscount)}<small>/lună</small>
										</span>
									</div>
									<p>
										<strong>Doar abonamentul lunar</strong>, fără setup. Implementarea tehnică e deja
										făcută.
									</p>
								</div>
							</li>
						</ol>
						{#if primary.cost.discountPct > 0}
							<div class="wz-discount">
								<span>
									Abonament brut: <s>{formatEur(primary.cost.monthlyTotal)}/lună</s>
								</span>
								<strong>
									Discount multi-servicii −{primary.cost.discountPct}% = economisești
									{formatEur(primary.cost.monthlySavings)}/lună
								</strong>
							</div>
						{/if}
					</div>
				{:else}
					<!-- No setup needed (continuing project) -->
					<div class="wz-box wz-box--price">
						<div class="wz-box-kicker">Cost lunar (fără setup)</div>
						{#if primary.cost.discountPct > 0}
							<div class="wz-price-was">
								<s>{formatEur(primary.cost.monthlyTotal)}</s>
								<span class="wz-price-off">−{primary.cost.discountPct}%</span>
							</div>
						{/if}
						<div class="wz-price">
							{formatEur(primary.cost.monthlyAfterDiscount)}<small>/lună</small>
						</div>
						<p class="wz-price-note">Folosim conturile tale existente — zero setup nou.</p>
					</div>
				{/if}

				<!-- Why this -->
				<div class="wz-box">
					<div class="wz-box-kicker">De ce ți-am recomandat asta</div>
					<ul class="wz-why">
						{#each primary.reasonWhy as reason (reason)}
							<li>
								<CheckIcon class="wz-opt-check wz-opt-check--sm" />
								<span>{reason}</span>
							</li>
						{/each}
					</ul>
					<p class="wz-why-rationale">{primary.bundle.rationale}</p>
				</div>

				<!-- Warnings -->
				{#if result.warnings.length > 0}
					<div class="wz-note wz-note--warn wz-note--stack">
						<span class="wz-note-icon" aria-hidden="true"><AlertTriangleIcon class="h-4 w-4" /></span>
						<div class="wz-note-body">
							{#each result.warnings as warn (warn)}
								<p>{warn}</p>
							{/each}
							<button type="button" class="wz-link" onclick={() => (tierGuideOpen = true)}>
								<HelpCircleIcon class="h-3.5 w-3.5" />
								Ce înseamnă Bronze / Silver / Gold / Platinum?
							</button>
						</div>
					</div>
				{/if}

				<!-- CTA -->
				<div class="wz-result-cta">
					<button
						type="button"
						class="wz-btn wz-btn-primary ots-gloss"
						onclick={() => requestBundle(primary)}
						disabled={submitting}
					>
						{submitting ? 'Se trimite…' : 'Trimit cerere pentru acest pachet'}
						<ArrowRightIcon class="h-4 w-4" />
					</button>
					<button type="button" class="wz-btn wz-btn-ghost" onclick={restart}>
						<RotateCcwIcon class="h-4 w-4" />
						Răspunde din nou
					</button>
				</div>
			</div>
		</article>

		<!-- ALTERNATIVES -->
		{#if result.alternatives.length > 0}
			<div class="wz-alt-head">
				<h2>Alternative de explorat</h2>
				<p>Dacă recomandarea principală nu e exact ce ai în minte, uite alte 2 variante.</p>
			</div>
			<div class="wz-alts">
				{#each result.alternatives as alt (alt.bundle.id)}
					{@const altColors = TIER_COLORS[alt.tier]}
					<article class="wz-alt">
						<div class="wz-alt-band {altColors.metallic}" aria-hidden="true"></div>
						<div class="wz-alt-body">
							<div class="wz-pills">
								<h3 class="wz-alt-title">{alt.bundle.name}</h3>
								<span class="wz-pill wz-pill--tier {altColors.text}">
									<span class="wz-dot {altColors.dot}"></span>
									{TIER_LABELS[alt.tier]}
								</span>
							</div>
							{#if alt.reasonLabel}
								<p class="wz-alt-reason">{alt.reasonLabel}</p>
							{/if}
							<p class="wz-alt-tagline">{alt.bundle.tagline}</p>

							<div class="wz-chips wz-chips--sm">
								{#each alt.bundle.services as slug (slug)}
									<span class="wz-chip">
										<span class="wz-chip-icon"><CategoryIcon {slug} class="h-3 w-3" /></span>
										{getCategory(slug)?.name}
									</span>
								{/each}
							</div>

							<div class="wz-alt-price">
								<span class="wz-alt-amount">
									{formatEur(alt.cost.monthlyAfterDiscount)}<small>/lună</small>
								</span>
								{#if alt.cost.discountPct > 0}
									<span class="wz-price-off">−{alt.cost.discountPct}%</span>
								{/if}
							</div>
							{#if alt.cost.includedSetup && alt.cost.setupTotal > 0}
								<div class="wz-alt-setup">Setup one-time: {formatEur(alt.cost.setupTotal)}</div>
							{/if}

							<button
								type="button"
								class="wz-btn wz-btn-ghost wz-btn--block"
								onclick={() => requestBundle(alt)}
								disabled={submitting}
							>
								Alege această variantă
								<ArrowRightIcon class="h-4 w-4" />
							</button>
						</div>
					</article>
				{/each}
			</div>
		{/if}

		<section class="wz-fine">
			<strong>Despre prețurile afișate</strong>
			<p>
				Costurile de mai sus sunt doar pentru managementul OTS, în EUR fără TVA. Bugetul media
				(banii care merg în platforme) și costul platformelor externe (Brevo, HubSpot etc.) se
				plătesc separat direct către furnizor. Oferta finală o confirmăm după un audit scurt —
				poate include ajustări pentru volumul sau complexitatea proiectului.
			</p>
		</section>
	{/if}
	</div>
</div>

<TierQuickGuide bind:open={tierGuideOpen} />

<style>
	/* Același sistem ca /pachete-hosting și /servicii: Inter, --accent #1877f2,
	   borduri #e5e9f0, raze de 10px pe butoane și 18px pe carduri.

	   Înainte, wizardul folosea tokenii aplicației (`border-border`,
	   `text-muted-foreground`, `bg-primary/5`): borduri aproape invizibile și
	   stare selectată la 5% opacitate, adică imposibil de distins de restul. */
	.wz {
		--ink: #0b1220;
		--ink2: #475569;
		--muted: #94a3b8;
		--border: #e5e9f0;
		--bg-soft: #f7f8fa;
		--accent: #1877f2;
		--accent-dark: #0d5cc7;
		font-family: 'Inter', system-ui, sans-serif;
		color: var(--ink);
		background: white;
		min-height: 100vh;
		line-height: 1.5;
	}
	.wz-inner {
		max-width: 780px;
		margin: 0 auto;
		padding: 28px 24px 72px;
	}

	.wz-back {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink2);
		text-decoration: none;
		transition: color 0.15s;
	}
	.wz-back:hover {
		color: var(--accent);
	}

	/* ===== Antet + progres ===== */
	.wz-head {
		margin: 26px 0 22px;
	}
	.wz-kicker {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent);
	}
	.wz-head h1 {
		margin: 10px 0 0;
		font-size: 34px;
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1.1;
	}
	.wz-head p {
		margin: 10px 0 0;
		font-size: 15px;
		color: var(--ink2);
		max-width: 60ch;
	}
	.wz-progress {
		height: 6px;
		border-radius: 999px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		overflow: hidden;
		margin-bottom: 26px;
	}
	.wz-progress-bar {
		height: 100%;
		background: var(--accent);
		border-radius: 999px;
		transition: width 0.3s ease;
	}

	/* ===== Cardul întrebării ===== */
	.wz-card {
		background: white;
		border: 1px solid var(--border);
		border-radius: 18px;
		padding: 28px;
		margin-bottom: 20px;
	}
	.wz-q {
		margin: 0;
		font-size: 20px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.wz-q-hint {
		margin: 8px 0 22px;
		font-size: 14px;
		color: var(--ink2);
	}

	/* ===== Opțiuni ===== */
	.wz-opt {
		position: relative;
		display: block;
		width: 100%;
		padding: 16px;
		text-align: left;
		background: white;
		border: 1px solid var(--border);
		border-radius: 12px;
		font-family: inherit;
		color: inherit;
		cursor: pointer;
		transition: all 0.15s;
	}
	.wz-opt--row {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 14px;
	}
	.wz-opt:hover {
		border-color: var(--accent);
		background: #f6faff;
	}
	.wz-opt:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	/* Starea selectată trebuie să se vadă de la un metru: bordură plină de accent,
	   fundal albastru pal și inel exterior. */
	.wz-opt.is-on {
		border-color: var(--accent);
		background: #f6faff;
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.14);
	}
	.wz-opt-icon {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		border-radius: 10px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		color: var(--ink2);
		transition: all 0.15s;
	}
	.wz-opt.is-on .wz-opt-icon {
		background: var(--accent);
		border-color: var(--accent);
		color: white;
	}
	.wz :global(.wz-opt-check) {
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		margin-top: 2px;
		color: var(--accent);
	}
	.wz :global(.wz-opt-check--sm) {
		width: 16px;
		height: 16px;
	}

	/* ===== Navigare ===== */
	.wz-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.wz-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 12px 20px;
		border-radius: 10px;
		font-family: inherit;
		font-size: 13.5px;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s;
	}
	.wz-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.wz-btn-ghost {
		background: white;
		color: var(--ink);
		border: 1px solid var(--border);
	}
	.wz-btn-ghost:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}
	.wz-btn-primary {
		background: var(--accent);
		color: white;
		border: 1px solid var(--accent);
		box-shadow: 0 6px 18px rgba(24, 119, 242, 0.22);
	}
	.wz-btn-primary:hover:not(:disabled) {
		background: var(--accent-dark);
		border-color: var(--accent-dark);
	}
	.wz-btn-primary:disabled {
		box-shadow: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.wz-opt,
		.wz-btn,
		.wz-progress-bar {
			transition: none;
		}
	}

	/* ===== Rezultat — același limbaj ca /servicii ===== */
	.wz-note {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		margin-bottom: 20px;
		padding: 14px 16px;
		border: 1px solid #bfdbfe;
		border-left: 3px solid var(--accent);
		border-radius: 14px;
		background: #f5f9ff;
		color: var(--ink);
	}
	.wz-note--warn {
		border-color: #fde68a;
		border-left-color: #d97706;
		background: #fffbeb;
	}
	.wz-note--stack {
		margin: 20px 0 0;
	}
	.wz-note-icon {
		width: 30px;
		height: 30px;
		border-radius: 9px;
		display: grid;
		place-items: center;
		background: rgba(24, 119, 242, 0.12);
		color: var(--accent-dark);
		flex-shrink: 0;
	}
	.wz-note--warn .wz-note-icon {
		background: rgba(217, 119, 6, 0.14);
		color: #b45309;
	}
	.wz-note-body {
		min-width: 0;
		flex: 1;
		font-size: 13.5px;
	}
	.wz-note-body strong {
		display: block;
		font-weight: 700;
		margin-bottom: 2px;
	}
	.wz-note-body p {
		margin: 0;
		color: var(--ink2);
		line-height: 1.5;
	}
	.wz-note-body p + p {
		margin-top: 4px;
	}
	.wz-note-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 14px;
		margin-top: 10px;
	}
	.wz-link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0;
		border: none;
		background: none;
		font-family: inherit;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--accent-dark);
		cursor: pointer;
	}
	.wz-link:hover {
		text-decoration: underline;
	}
	.wz-btn--sm {
		padding: 8px 14px;
		font-size: 12.5px;
	}
	.wz-btn--block {
		width: 100%;
		justify-content: center;
		margin-top: 16px;
	}

	.wz-result,
	.wz-alt {
		background: white;
		border: 1px solid var(--border);
		border-radius: 18px;
		overflow: hidden;
	}
	.wz-result {
		border-color: rgba(24, 119, 242, 0.35);
		box-shadow: 0 18px 44px rgba(11, 18, 32, 0.08);
		margin-bottom: 28px;
	}
	/* Banda de tier: singura urmă de culoare „metalică”, ca în dialogul de comparație. */
	.wz-result-band,
	.wz-alt-band {
		height: 6px;
	}
	.wz-result-body {
		padding: 26px 28px 28px;
	}
	.wz-pills {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 10px;
		margin-bottom: 12px;
	}
	.wz-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		border: 1px solid var(--border);
		background: white;
		color: var(--ink2);
	}
	.wz-pill--accent {
		background: var(--accent);
		border-color: var(--accent);
		color: white;
	}
	.wz-dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
	.wz-result-title {
		margin: 0;
		font-size: 28px;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--ink);
	}
	.wz-result-tagline {
		margin: 4px 0 0;
		font-size: 15px;
		color: var(--ink2);
	}
	.wz-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 16px;
	}
	.wz-chip {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px 6px 6px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: white;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
	}
	.wz-chips--sm .wz-chip {
		font-size: 12px;
		padding: 4px 10px 4px 4px;
	}
	.wz-chip-icon {
		width: 26px;
		height: 26px;
		border-radius: 8px;
		background: var(--bg-soft);
		display: grid;
		place-items: center;
	}
	.wz-chips--sm .wz-chip-icon {
		width: 22px;
		height: 22px;
	}

	.wz-box {
		margin-top: 20px;
		padding: 18px 20px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--bg-soft);
	}
	.wz-box-kicker {
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink2);
		margin-bottom: 12px;
	}
	.wz-bill {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.wz-bill-step {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		padding: 14px 16px;
		background: white;
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	.wz-bill-n {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--accent);
		color: white;
		font-size: 12px;
		font-weight: 800;
		flex-shrink: 0;
	}
	.wz-bill-n--muted {
		background: #e2e8f0;
		color: var(--ink);
	}
	.wz-bill-body {
		min-width: 0;
		flex: 1;
	}
	.wz-bill-body p {
		margin: 4px 0 0;
		font-size: 12.5px;
		line-height: 1.45;
		color: var(--ink2);
	}
	.wz-bill-body p strong {
		color: var(--ink);
	}
	.wz-bill-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 4px 12px;
	}
	.wz-bill-label {
		font-size: 14px;
		font-weight: 700;
	}
	.wz-bill-amount {
		font-size: 20px;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--ink);
		white-space: nowrap;
	}
	.wz-bill-amount small,
	.wz-price small,
	.wz-alt-amount small {
		font-size: 12px;
		font-weight: 500;
		color: var(--ink2);
		margin-left: 2px;
	}
	.wz-discount {
		margin-top: 12px;
		padding: 10px 14px;
		border: 1px solid rgba(16, 185, 129, 0.3);
		border-radius: 10px;
		background: rgba(16, 185, 129, 0.08);
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 4px 12px;
		font-size: 12.5px;
		color: var(--ink2);
	}
	.wz-discount strong {
		color: #047857;
		font-weight: 700;
	}
	.wz-box--price .wz-box-kicker {
		margin-bottom: 6px;
	}
	.wz-price-was {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--ink2);
	}
	.wz-price-off {
		font-size: 11px;
		font-weight: 800;
		color: #047857;
		background: rgba(16, 185, 129, 0.12);
		padding: 2px 7px;
		border-radius: 999px;
	}
	.wz-price {
		font-size: 34px;
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1.1;
		color: var(--ink);
		margin-top: 2px;
	}
	.wz-price-note {
		margin: 6px 0 0;
		font-size: 12.5px;
		color: var(--ink2);
	}
	.wz-why {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.wz-why li {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		font-size: 14px;
		color: var(--ink);
	}
	.wz-why-rationale {
		margin: 12px 0 0;
		font-size: 12.5px;
		font-style: italic;
		color: var(--ink2);
		line-height: 1.5;
	}
	.wz-result-cta {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 24px;
	}

	.wz-alt-head {
		margin: 36px 0 16px;
	}
	.wz-alt-head h2 {
		margin: 0;
		font-size: 22px;
		font-weight: 800;
		letter-spacing: -0.02em;
	}
	.wz-alt-head p {
		margin: 4px 0 0;
		font-size: 14px;
		color: var(--ink2);
	}
	.wz-alts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
	}
	.wz-alt {
		transition:
			border-color 0.15s,
			box-shadow 0.15s,
			transform 0.15s;
	}
	.wz-alt:hover {
		border-color: rgba(24, 119, 242, 0.45);
		box-shadow: 0 14px 34px rgba(11, 18, 32, 0.08);
		transform: translateY(-2px);
	}
	.wz-alt-body {
		padding: 18px 20px 20px;
	}
	.wz-alt-title {
		margin: 0;
		font-size: 17px;
		font-weight: 800;
		letter-spacing: -0.01em;
	}
	.wz-alt-reason {
		margin: 0 0 4px;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.wz-alt-tagline {
		margin: 0;
		font-size: 13px;
		color: var(--ink2);
	}
	.wz-alt .wz-chips {
		margin-top: 12px;
	}
	.wz-alt-price {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}
	.wz-alt-amount {
		font-size: 20px;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--ink);
	}
	.wz-alt-setup {
		margin-top: 4px;
		font-size: 12px;
		color: var(--ink2);
	}
	.wz-fine {
		margin-top: 28px;
		padding: 16px 18px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--bg-soft);
		font-size: 13px;
	}
	.wz-fine strong {
		display: block;
		margin-bottom: 4px;
		font-weight: 700;
	}
	.wz-fine p {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--ink2);
	}
	@media (prefers-reduced-motion: reduce) {
		.wz-alt {
			transition: none;
		}
		.wz-alt:hover {
			transform: none;
		}
	}

	@media (max-width: 640px) {
		.wz-inner {
			padding: 20px 16px 56px;
		}
		.wz-head h1 {
			font-size: 26px;
		}
		.wz-card {
			padding: 20px;
		}
		.wz-nav .wz-btn {
			flex: 1;
			justify-content: center;
		}
		.wz-result-body {
			padding: 20px;
		}
		.wz-result-title {
			font-size: 24px;
		}
		.wz-alts {
			grid-template-columns: 1fr;
		}
		.wz-result-cta .wz-btn {
			flex: 1 1 100%;
			justify-content: center;
		}
	}
</style>
