import {
	BUNDLES,
	CATEGORIES,
	getCategory,
	BUNDLE_TIERS_RULE,
	type Bundle,
	type Tier,
	type UseCase
} from '$lib/constants/ots-catalog';

export type BusinessType =
	| 'ecommerce'
	| 'b2b-services'
	| 'local'
	| 'content-media'
	| 'education'
	| 'other';

export type Goal =
	| 'sales-online'
	| 'leads'
	| 'brand-awareness'
	| 'local-traffic'
	| 'retention'
	| 'scale-all';

export type BudgetBand = 'under-500' | '500-1500' | '1500-5000' | '5000-plus';

export type ProjectStatus = 'new' | 'continuing' | 'unsure';

export interface WizardAnswers {
	businessType: BusinessType | null;
	businessTypeOther: string;
	goal: Goal | null;
	mediaBudget: BudgetBand | null;
	interestedServices: string[];
	projectStatus: ProjectStatus | null;
}

export function emptyAnswers(): WizardAnswers {
	return {
		businessType: null,
		businessTypeOther: '',
		goal: null,
		mediaBudget: null,
		interestedServices: [],
		projectStatus: null
	};
}

export const BUSINESS_TYPE_OPTIONS: { value: BusinessType; label: string; hint: string }[] = [
	{ value: 'ecommerce', label: 'E-commerce / magazin online', hint: 'Vinzi produse online (fashion, cosmetice, electronice, etc.)' },
	{ value: 'b2b-services', label: 'Servicii B2B / SaaS / consultanță', hint: 'Vinzi servicii către alte firme sau profesioniști' },
	{ value: 'local', label: 'Business local', hint: 'Restaurant, clinică, salon, atelier — clienți din zonă' },
	{ value: 'content-media', label: 'Content / media / influencer', hint: 'Creator de conținut, publicație, podcast, YouTube' },
	{ value: 'education', label: 'Educație / cursuri', hint: 'Cursuri online, training-uri, platforme de învățare' },
	{ value: 'other', label: 'Altceva', hint: 'Descrie scurt domeniul tău' }
];

export const GOAL_OPTIONS: { value: Goal; label: string; description: string }[] = [
	{ value: 'sales-online', label: 'Vând produse online', description: 'Conversii directe, ROAS, comenzi în magazin' },
	{ value: 'leads', label: 'Obțin lead-uri / cereri ofertă', description: 'Formulare, apeluri, cereri demo, MQL/SQL' },
	{ value: 'brand-awareness', label: 'Creștere notorietate brand', description: 'Lansare produs, recunoaștere pe piață, reach' },
	{ value: 'local-traffic', label: 'Trafic local / rezervări', description: 'Oameni care intră în magazin / rezervă online' },
	{ value: 'retention', label: 'Păstrez clienții existenți', description: 'Repeat customers, LTV, lifecycle email' },
	{ value: 'scale-all', label: 'Scale agresiv pe toate canalele', description: 'Stack complet, bugete mari, multi-channel' }
];

// Which goals make sense per business type (contextual filtering step 1 → step 2)
export const GOAL_VISIBILITY: Record<BusinessType, Goal[]> = {
	ecommerce: ['sales-online', 'scale-all', 'retention', 'brand-awareness'],
	'b2b-services': ['leads', 'scale-all', 'brand-awareness'],
	local: ['local-traffic', 'leads', 'sales-online', 'brand-awareness'],
	'content-media': ['brand-awareness', 'scale-all', 'retention'],
	education: ['leads', 'sales-online', 'brand-awareness', 'scale-all'],
	other: ['sales-online', 'leads', 'brand-awareness', 'local-traffic', 'retention', 'scale-all']
};

export function getAvailableGoals(businessType: BusinessType | null): typeof GOAL_OPTIONS {
	if (!businessType) return GOAL_OPTIONS;
	const allowed = new Set(GOAL_VISIBILITY[businessType]);
	return GOAL_OPTIONS.filter((g) => allowed.has(g.value));
}

export function isGoalValidForBusiness(
	goal: Goal | null,
	businessType: BusinessType | null
): boolean {
	if (!goal || !businessType) return true;
	return GOAL_VISIBILITY[businessType].includes(goal);
}

export const BUDGET_OPTIONS: {
	value: BudgetBand;
	label: string;
	tier: Tier;
	note: string;
	badge?: 'recommended' | 'popular';
}[] = [
	{
		value: 'under-500',
		label: 'Sub 500 € / lună',
		tier: 'bronze',
		note: 'Buget limitat — focus pe 1-2 canale, optimizare atentă.'
	},
	{
		value: '500-1500',
		label: '500 – 1.500 € / lună',
		tier: 'silver',
		note: 'Pragul potrivit pentru date statistic relevante pe A/B și optimizare.',
		badge: 'recommended'
	},
	{
		value: '1500-5000',
		label: '1.500 – 5.000 € / lună',
		tier: 'gold',
		note: 'Scale consistent — permite multi-canal, creative multiple, remarketing avansat.',
		badge: 'popular'
	},
	{
		value: '5000-plus',
		label: 'Peste 5.000 € / lună',
		tier: 'platinum',
		note: 'Nivel enterprise — integrări custom, consultanță dedicată, offline conversions.'
	}
];

export const PROJECT_STATUS_OPTIONS: {
	value: ProjectStatus;
	label: string;
	description: string;
}[] = [
	{
		value: 'new',
		label: 'Proiect nou — am nevoie de setup complet',
		description:
			'Configurare conturi, pixel, GA4, strategie de la zero. Include taxă one-time de setup.'
	},
	{
		value: 'continuing',
		label: 'Continuare — conturile sunt deja configurate',
		description: 'Preluăm ce există, nu mai plătești setup pentru canalele existente.'
	},
	{
		value: 'unsure',
		label: 'Nu sunt sigur',
		description: 'Decidem împreună după un audit inițial.'
	}
];

// ---- Mapping helpers --------------------------------------------------

export function mapToUseCase(business: BusinessType | null, goal: Goal | null): UseCase {
	if (goal === 'scale-all') return 'full-stack';
	if (goal === 'retention') return 'retention';
	if (goal === 'brand-awareness') return 'branding';
	if (goal === 'local-traffic') return 'local';
	if (goal === 'sales-online') return 'ecommerce';
	if (goal === 'leads') return 'lead-gen';

	switch (business) {
		case 'ecommerce':
			return 'ecommerce';
		case 'b2b-services':
			return 'lead-gen';
		case 'local':
			return 'local';
		case 'content-media':
		case 'education':
			return 'branding';
		default:
			return 'lead-gen';
	}
}

export function budgetToTier(budget: BudgetBand | null): Tier {
	const option = BUDGET_OPTIONS.find((b) => b.value === budget);
	return option?.tier ?? 'silver';
}

export function discountForServiceCount(count: number): number {
	let best = 0;
	for (const rule of BUNDLE_TIERS_RULE) {
		if (count >= rule.minServices) best = rule.discountPct;
	}
	return best;
}

// Business-type × useCase affinity matrix (0-100)
// Lets us score bundles that don't match useCase exactly but are still relevant.
const BUSINESS_USE_CASE_AFFINITY: Record<BusinessType, Record<UseCase, number>> = {
	ecommerce: {
		ecommerce: 100,
		retention: 80,
		'full-stack': 70,
		branding: 40,
		'lead-gen': 10,
		local: 5
	},
	'b2b-services': {
		'lead-gen': 100,
		'full-stack': 80,
		branding: 50,
		retention: 40,
		ecommerce: 10,
		local: 5
	},
	local: {
		local: 100,
		'full-stack': 60,
		ecommerce: 50,
		'lead-gen': 55,
		branding: 50,
		retention: 40
	},
	'content-media': {
		branding: 100,
		retention: 75,
		'full-stack': 60,
		ecommerce: 40,
		'lead-gen': 25,
		local: 5
	},
	education: {
		'lead-gen': 90,
		ecommerce: 85,
		branding: 65,
		'full-stack': 70,
		retention: 55,
		local: 20
	},
	other: {
		'full-stack': 100,
		branding: 70,
		'lead-gen': 60,
		ecommerce: 55,
		local: 40,
		retention: 50
	}
};

function computeAffinity(businessType: BusinessType | null, useCase: UseCase): number {
	if (!businessType) return 50;
	return BUSINESS_USE_CASE_AFFINITY[businessType][useCase] ?? 30;
}

function tierFitnessScore(tier: Tier, serviceCount: number): number {
	if (tier === 'bronze') {
		if (serviceCount <= 1) return 100;
		if (serviceCount === 2) return 85;
		if (serviceCount === 3) return 50;
		return 20;
	}
	if (tier === 'silver') {
		if (serviceCount === 1) return 70;
		if (serviceCount === 2) return 100;
		if (serviceCount === 3) return 95;
		if (serviceCount === 4) return 60;
		return 30;
	}
	if (tier === 'gold') {
		if (serviceCount <= 2) return 75;
		if (serviceCount === 3) return 100;
		if (serviceCount === 4) return 95;
		return 80;
	}
	// platinum
	if (serviceCount === 1) return 40;
	if (serviceCount === 2) return 80;
	return 100;
}

function serviceOverlapScore(bundleServices: string[], userServices: string[]): number {
	if (userServices.length === 0) return 50;
	const userSet = new Set(userServices);
	const matched = bundleServices.filter((s) => userSet.has(s)).length;
	const exact =
		matched === userServices.length && matched === bundleServices.length;
	if (exact) return 100;
	if (matched === userServices.length) {
		return Math.round(70 + 20 * (userServices.length / bundleServices.length));
	}
	if (matched > 0) {
		return Math.round(30 + 40 * (matched / userServices.length));
	}
	return 0;
}

function funnelCoverageScore(bundle: Bundle, goal: Goal | null): number {
	const hasAwareness = bundle.services.some((s) => ['meta-ads', 'tiktok-ads'].includes(s));
	const hasConversion = bundle.services.some((s) => ['google-ads', 'cro'].includes(s));
	const hasRetention = bundle.services.some((s) =>
		['email-marketing', 'marketing-automation'].includes(s)
	);
	const hasOrganic = bundle.services.includes('seo');

	if (goal === 'scale-all') {
		const stages = [hasAwareness, hasConversion, hasRetention].filter(Boolean).length;
		if (stages === 3) return 100;
		if (stages === 2) return 70;
		return 40;
	}
	if (goal === 'sales-online') {
		let s = 50;
		if (hasConversion) s += 35;
		if (hasRetention) s += 20;
		if (hasOrganic) s += 10;
		return Math.min(100, s);
	}
	if (goal === 'leads') {
		let s = 50;
		if (hasConversion) s += 35;
		if (hasRetention) s += 15;
		return Math.min(100, s);
	}
	if (goal === 'local-traffic') {
		const hasLocalish = bundle.services.some((s) => ['google-ads', 'seo'].includes(s));
		return hasLocalish ? 85 : 50;
	}
	if (goal === 'brand-awareness') {
		let s = hasAwareness ? 90 : 50;
		if (hasOrganic) s = Math.min(100, s + 10);
		return s;
	}
	if (goal === 'retention') {
		return hasRetention ? 95 : 40;
	}
	return 50;
}

function projectStatusScore(status: ProjectStatus | null, serviceCount: number): number {
	if (status === 'new') {
		if (serviceCount <= 2) return 100;
		if (serviceCount === 3) return 70;
		return 40;
	}
	if (status === 'unsure') {
		return serviceCount === 2 ? 85 : 50;
	}
	return 50; // continuing or null
}

function platformBonus(
	bundle: Bundle,
	businessType: BusinessType | null,
	goal: Goal | null
): number {
	let bonus = 0;
	const has = (s: string) => bundle.services.includes(s);

	if (businessType === 'ecommerce' && has('meta-ads')) bonus += 12;
	if (businessType === 'ecommerce' && has('google-ads') && has('meta-ads')) bonus += 18;
	if (goal === 'leads' && has('google-ads') && (has('email-marketing') || has('marketing-automation'))) {
		bonus += 15;
	}
	if (businessType === 'local' && has('google-ads') && has('seo')) bonus += 12;

	if (goal === 'leads' && businessType === 'b2b-services' && has('tiktok-ads')) bonus -= 25;
	if (bundle.services.length === 1 && has('cro')) bonus -= 20;

	return bonus;
}

// ---- Scoring ----------------------------------------------------------

export interface ScoringVector {
	affinity: { score: number; weight: number };
	tierFitness: { score: number; weight: number };
	serviceOverlap: { score: number; weight: number };
	funnelCoverage: { score: number; weight: number };
	projectStatus: { score: number; weight: number };
	platformBonus: number;
	finalScore: number;
	useCaseMatch: boolean;
}

const WEIGHTS = {
	affinity: 0.35,
	tierFitness: 0.25,
	serviceOverlap: 0.2,
	funnelCoverage: 0.15,
	projectStatus: 0.05
};

function scoreBundleNuanced(bundle: Bundle, answers: WizardAnswers): ScoringVector {
	const useCase = mapToUseCase(answers.businessType, answers.goal);
	const tier = budgetToTier(answers.mediaBudget);

	const affinityRaw =
		bundle.useCase === useCase ? 100 : computeAffinity(answers.businessType, bundle.useCase);
	const tierRaw = tierFitnessScore(tier, bundle.services.length);
	const overlapRaw = serviceOverlapScore(bundle.services, answers.interestedServices);
	const funnelRaw = funnelCoverageScore(bundle, answers.goal);
	const statusRaw = projectStatusScore(answers.projectStatus, bundle.services.length);
	const bonus = platformBonus(bundle, answers.businessType, answers.goal);

	const weighted =
		affinityRaw * WEIGHTS.affinity +
		tierRaw * WEIGHTS.tierFitness +
		overlapRaw * WEIGHTS.serviceOverlap +
		funnelRaw * WEIGHTS.funnelCoverage +
		statusRaw * WEIGHTS.projectStatus;

	const finalScore = Math.max(0, Math.min(100, weighted + bonus));

	return {
		affinity: { score: affinityRaw, weight: WEIGHTS.affinity },
		tierFitness: { score: tierRaw, weight: WEIGHTS.tierFitness },
		serviceOverlap: { score: overlapRaw, weight: WEIGHTS.serviceOverlap },
		funnelCoverage: { score: funnelRaw, weight: WEIGHTS.funnelCoverage },
		projectStatus: { score: statusRaw, weight: WEIGHTS.projectStatus },
		platformBonus: bonus,
		finalScore,
		useCaseMatch: bundle.useCase === useCase
	};
}

// ---- Cost calculation -------------------------------------------------

export interface CostBreakdown {
	monthlyTotal: number;
	discountPct: number;
	monthlySavings: number;
	monthlyAfterDiscount: number;
	setupTotal: number;
	firstMonthTotal: number;
	includedSetup: boolean;
}

export function calculateCost(
	services: string[],
	tier: Tier,
	includeSetup: boolean
): CostBreakdown {
	const monthlyTotal = services.reduce((sum, slug) => {
		const cat = getCategory(slug);
		return sum + (cat?.prices[tier] ?? 0);
	}, 0);
	const discountPct = discountForServiceCount(services.length);
	const monthlyAfterDiscount = Math.round((monthlyTotal * (100 - discountPct)) / 100);
	const monthlySavings = monthlyTotal - monthlyAfterDiscount;
	const setupTotal = includeSetup
		? services.reduce((sum, slug) => {
				const cat = getCategory(slug);
				return sum + (cat?.setupFees?.[tier] ?? 0);
			}, 0)
		: 0;
	const firstMonthTotal = monthlyAfterDiscount + setupTotal;
	return {
		monthlyTotal,
		discountPct,
		monthlySavings,
		monthlyAfterDiscount,
		setupTotal,
		firstMonthTotal,
		includedSetup: includeSetup
	};
}

// ---- Tier Override Advice --------------------------------------------

export interface TierAdvice {
	originalTier: Tier;
	suggestedTier: Tier;
	suggestedBudget: BudgetBand;
	rationale: string;
	severity: 'info' | 'warning';
}

function tierFromBudget(budget: BudgetBand): Tier {
	return BUDGET_OPTIONS.find((b) => b.value === budget)!.tier;
}

function budgetFromTier(tier: Tier): BudgetBand {
	return BUDGET_OPTIONS.find((b) => b.tier === tier)!.value;
}

export function adviseTierOverride(
	originalTier: Tier,
	bundle: Bundle,
	goal: Goal | null,
	projectStatus: ProjectStatus | null
): TierAdvice | null {
	const services = bundle.services.length;
	const tierRank: Record<Tier, number> = { bronze: 1, silver: 2, gold: 3, platinum: 4 };

	if (originalTier === 'bronze' && services >= 4) {
		return {
			originalTier: 'bronze',
			suggestedTier: 'silver',
			suggestedBudget: budgetFromTier('silver'),
			rationale: `„${bundle.name}" are ${services} servicii. La pachetul Bronze bugetul media e prea mic ca fiecare canal să genereze date relevante — recomandăm Silver pentru raportare săptămânală și A/B testing.`,
			severity: 'warning'
		};
	}

	if (originalTier === 'silver' && services >= 4 && goal === 'scale-all') {
		return {
			originalTier: 'silver',
			suggestedTier: 'gold',
			suggestedBudget: budgetFromTier('gold'),
			rationale: `Obiectiv „scale agresiv" cu ${services} servicii: pachetul Gold aduce consultanță săptămânală + rapoarte personalizate + integrări avansate — necesare pentru orchestrație multi-canal.`,
			severity: 'warning'
		};
	}

	if (projectStatus === 'new' && services >= 4 && tierRank[originalTier] < 3) {
		return {
			originalTier,
			suggestedTier: 'gold',
			suggestedBudget: budgetFromTier('gold'),
			rationale: `Proiect nou + stack complex (${services} servicii): pachetul Gold asigură onboarding de calitate și setup corect din ziua 1.`,
			severity: 'warning'
		};
	}

	if (originalTier === 'platinum' && services <= 2) {
		return {
			originalTier: 'platinum',
			suggestedTier: 'gold',
			suggestedBudget: budgetFromTier('gold'),
			rationale: `Pachetul Platinum cu doar ${services} servicii: features-urile enterprise (BI API, integrări custom) nu-ți aduc valoare acum. Gold îți oferă tot ce-ți trebuie la un cost mai mic.`,
			severity: 'info'
		};
	}

	if (projectStatus === 'continuing' && services === 1 && originalTier === 'platinum') {
		return {
			originalTier: 'platinum',
			suggestedTier: 'silver',
			suggestedBudget: budgetFromTier('silver'),
			rationale: `Continuare cu 1 singur serviciu: Silver acoperă nevoile unui canal existent fără features enterprise inutile.`,
			severity: 'info'
		};
	}

	return null;
}

// ---- Recommendation --------------------------------------------------

export interface Recommendation {
	bundle: Bundle;
	tier: Tier;
	cost: CostBreakdown;
	reasonWhy: string[];
	reasonLabel?: string;
	warnings: string[];
	isCustom: boolean;
	score?: number;
}

export interface RecommendationResult {
	useCase: UseCase;
	tier: Tier;
	primary: Recommendation;
	alternatives: Recommendation[];
	warnings: string[];
	tierAdvice: TierAdvice | null;
}

function validServicesSlugs(): Set<string> {
	return new Set(CATEGORIES.map((c) => c.slug));
}

function buildCustomBundle(services: string[], useCase: UseCase): Bundle {
	const valid = services.filter((s) => validServicesSlugs().has(s));
	const names = valid.map((s) => getCategory(s)?.name || s).join(' + ');
	const discountPct = discountForServiceCount(valid.length);
	return {
		id: 'custom',
		name: 'Pachet personalizat',
		tagline: names || 'Configurație pe măsură',
		useCase,
		services: valid,
		discountPct,
		rationale:
			'Am construit această combinație pornind de la serviciile pe care le-ai selectat. Dacă nu există un bundle standard care să se potrivească, mergi pe custom — echipa OTS ajustează în ofertă.'
	};
}

function explainPrimary(
	bundle: Bundle,
	answers: WizardAnswers,
	tier: Tier,
	score: ScoringVector
): string[] {
	const reasons: string[] = [];
	const biz = BUSINESS_TYPE_OPTIONS.find((b) => b.value === answers.businessType);
	const goal = GOAL_OPTIONS.find((g) => g.value === answers.goal);

	if (biz && goal) {
		reasons.push(
			`Pentru ${biz.label.toLowerCase()} cu obiectiv „${goal.label.toLowerCase()}", bundle-ul „${bundle.name}" acoperă canalele potrivite.`
		);
	}

	if (score.platformBonus >= 10) {
		if (answers.businessType === 'ecommerce' && bundle.services.includes('meta-ads')) {
			reasons.push(
				'Meta DPA (catalog dinamic) e probata statistic pentru ROAS mai bun pe magazine online — de aceea face diferența.'
			);
		} else if (
			answers.businessType === 'local' &&
			bundle.services.includes('google-ads') &&
			bundle.services.includes('seo')
		) {
			reasons.push(
				'Google Ads Local + SEO (Google Business Profile) = duo-ul standard pentru business local: vizibilitate plătită + organic pe zonă.'
			);
		} else if (
			answers.goal === 'leads' &&
			bundle.services.includes('google-ads') &&
			(bundle.services.includes('email-marketing') ||
				bundle.services.includes('marketing-automation'))
		) {
			reasons.push(
				'Google Search aduce lead-uri cu intenție mare + Email/Automation le nurtureză până devin clienți — combinația dovedită B2B.'
			);
		}
	}

	if (bundle.discountPct > 0) {
		reasons.push(
			`Combinația de ${bundle.services.length} servicii aduce automat −${bundle.discountPct}% discount multi-servicii.`
		);
	}

	if (answers.interestedServices.length > 0) {
		const overlap = bundle.services.filter((s) => answers.interestedServices.includes(s));
		if (overlap.length === answers.interestedServices.length) {
			reasons.push('Include toate canalele pe care le-ai menționat ca fiind de interes.');
		} else if (overlap.length > 0) {
			reasons.push(
				`Acoperă ${overlap.length} din ${answers.interestedServices.length} canale alese; restul pot fi adăugate ulterior.`
			);
		}
	}

	const budget = BUDGET_OPTIONS.find((b) => b.value === answers.mediaBudget);
	if (budget) {
		reasons.push(
			`Pachetul ${tier.charAt(0).toUpperCase()}${tier.slice(1)} corespunde bugetului media de ${budget.label.toLowerCase()}.`
		);
	}

	if (reasons.length === 0) {
		reasons.push('Bundle versatil, recomandat pentru majoritatea clienților în această fază.');
	}

	return reasons;
}

interface ScoredBundle {
	bundle: Bundle;
	scoreVector: ScoringVector;
}

function servicesOverlapRatio(a: string[], b: string[]): number {
	if (a.length === 0 || b.length === 0) return 0;
	const setA = new Set(a);
	const overlap = b.filter((s) => setA.has(s)).length;
	return overlap / Math.max(a.length, b.length);
}

function estimateMonthlyCost(bundle: Bundle, tier: Tier): number {
	const monthly = bundle.services.reduce((sum, slug) => {
		const cat = getCategory(slug);
		return sum + (cat?.prices[tier] ?? 0);
	}, 0);
	return Math.round((monthly * (100 - bundle.discountPct)) / 100);
}

function selectRecommendations(
	scored: ScoredBundle[],
	answers: WizardAnswers,
	tier: Tier,
	includeSetup: boolean
): { primary: Recommendation; alternatives: Recommendation[] } {
	const seen = new Set<string>();
	const primaryScored = scored[0];
	seen.add(primaryScored.bundle.id);

	const primary: Recommendation = {
		bundle: primaryScored.bundle,
		tier,
		cost: calculateCost(primaryScored.bundle.services, tier, includeSetup),
		reasonWhy: explainPrimary(primaryScored.bundle, answers, tier, primaryScored.scoreVector),
		warnings: [],
		isCustom: false,
		score: Math.round(primaryScored.scoreVector.finalScore)
	};

	const alternatives: Recommendation[] = [];

	// Alt 1 — Diversity: different useCase OR <75% service overlap
	let alt1: ScoredBundle | null = null;
	for (const s of scored.slice(1)) {
		if (seen.has(s.bundle.id)) continue;
		const differentUseCase = s.bundle.useCase !== primary.bundle.useCase;
		const overlapRatio = servicesOverlapRatio(primary.bundle.services, s.bundle.services);
		if (differentUseCase || overlapRatio < 0.75) {
			alt1 = s;
			break;
		}
	}
	if (alt1) {
		seen.add(alt1.bundle.id);
		const reasonLabel =
			alt1.bundle.useCase !== primary.bundle.useCase
				? 'Strategie diferită — dacă prioritățile se schimbă'
				: 'Mix diferit de canale';
		alternatives.push({
			bundle: alt1.bundle,
			tier,
			cost: calculateCost(alt1.bundle.services, tier, includeSetup),
			reasonWhy: [reasonLabel],
			reasonLabel,
			warnings: [],
			isCustom: false,
			score: Math.round(alt1.scoreVector.finalScore)
		});
	}

	// Alt 2 — Cost/scope tradeoff
	const primaryCost = estimateMonthlyCost(primary.bundle, tier);
	let alt2: ScoredBundle | null = null;
	let alt2Type: 'cheaper' | 'comprehensive' = 'cheaper';

	for (const s of scored.slice(1)) {
		if (seen.has(s.bundle.id)) continue;
		const cost = estimateMonthlyCost(s.bundle, tier);
		if (cost < primaryCost * 0.85) {
			alt2 = s;
			alt2Type = 'cheaper';
			break;
		}
	}
	if (!alt2) {
		for (const s of scored.slice(1)) {
			if (seen.has(s.bundle.id)) continue;
			if (s.bundle.services.length > primary.bundle.services.length) {
				alt2 = s;
				alt2Type = 'comprehensive';
				break;
			}
		}
	}
	if (alt2) {
		seen.add(alt2.bundle.id);
		const altCost = estimateMonthlyCost(alt2.bundle, tier);
		const reasonLabel =
			alt2Type === 'cheaper'
				? `Opțiune buget — economisești ~${(primaryCost - altCost).toLocaleString('ro-RO')} €/lună`
				: 'Opțiune scale — mai multe canale, creștere accelerată';
		alternatives.push({
			bundle: alt2.bundle,
			tier,
			cost: calculateCost(alt2.bundle.services, tier, includeSetup),
			reasonWhy: [reasonLabel],
			reasonLabel,
			warnings: [],
			isCustom: false,
			score: Math.round(alt2.scoreVector.finalScore)
		});
	}

	// Custom bundle: only if user selected 2+ services and combo doesn't match existing
	if (answers.interestedServices.length >= 2 && alternatives.length < 2) {
		const userSet = [...answers.interestedServices].sort().join(',');
		const existsAsStandard = scored.some(
			(s) => [...s.bundle.services].sort().join(',') === userSet
		);
		if (!existsAsStandard) {
			const useCase = mapToUseCase(answers.businessType, answers.goal);
			const custom = buildCustomBundle(answers.interestedServices, useCase);
			alternatives.push({
				bundle: custom,
				tier,
				cost: calculateCost(custom.services, tier, includeSetup),
				reasonWhy: ['Exact serviciile pe care le-ai ales, ca pachet custom.'],
				reasonLabel: 'Exact canalele tale, custom',
				warnings: [],
				isCustom: true
			});
		}
	}

	return { primary, alternatives };
}

export function recommend(answers: WizardAnswers): RecommendationResult {
	const useCase = mapToUseCase(answers.businessType, answers.goal);
	const tier = budgetToTier(answers.mediaBudget);
	const includeSetup = answers.projectStatus !== 'continuing';

	const scored = BUNDLES.map((b) => ({ bundle: b, scoreVector: scoreBundleNuanced(b, answers) }));
	scored.sort((a, b) => b.scoreVector.finalScore - a.scoreVector.finalScore);

	const { primary, alternatives } = selectRecommendations(scored, answers, tier, includeSetup);

	const tierAdvice = adviseTierOverride(tier, primary.bundle, answers.goal, answers.projectStatus);

	const warnings: string[] = [];
	// Keep warnings lightweight — tierAdvice now carries the main guidance
	if (answers.goal === 'scale-all' && tier !== 'platinum' && tier !== 'gold' && !tierAdvice) {
		warnings.push(
			'Obiectivul „scale agresiv" funcționează cel mai bine de la pachetul Gold în sus. Cu buget mai mic, recomandăm focus pe 2 canale în loc de stack complet.'
		);
	}

	return { useCase, tier, primary, alternatives, warnings, tierAdvice };
}

// Export helpers used in UI for re-applying tier advice
export { tierFromBudget, budgetFromTier };
