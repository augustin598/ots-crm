// Client Google PageSpeed Insights API v5.
// Cheia stă DOAR pe server (env PSI_API_KEY) și nu apare niciodată în răspunsuri.
// Politica de rețea: timeout 60 s per apel, 2 retry-uri cu backoff exponențial + jitter
// pentru erori tranzitorii (rețea, 429, 5xx); 4xx ≠ 429 = permanent, fără retry.
import { env } from '$env/dynamic/private';
import type { PsiStrategy } from '$lib/logic/pagespeed';

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const PSI_TIMEOUT_MS = 60_000;
const PSI_RETRIES = 3; // 1 încercare + 2 retry

export class PsiApiError extends Error {
	status: number;
	retryable: boolean;
	constructor(message: string, status: number, retryable: boolean) {
		super(message);
		this.name = 'PsiApiError';
		this.status = status;
		this.retryable = retryable;
	}
}

export interface PsiOpportunityItem {
	/** URL-ul resursei sau selectorul DOM al elementului afectat. */
	label: string;
	/** Detaliu scurt: greutate/durată pentru resurse, snippet HTML pentru elemente. */
	detail?: string;
}

export interface PsiOpportunity {
	id: string;
	title: string;
	category: 'performance' | 'accessibility' | 'best-practices' | 'seo';
	savingsMs: number;
	displayValue?: string;
	/** Descrierea auditului, fără link-urile markdown. */
	description?: string;
	/** Elementele afectate (max 5), ca în raportul PageSpeed web. */
	items: PsiOpportunityItem[];
}

/** Rezultatul parsat al unei rulări PSI — mapare 1:1 pe coloanele pagespeed_measurement. */
export interface PsiResult {
	performance: number | null;
	accessibility: number | null;
	bestPractices: number | null;
	seo: number | null;
	lcpMs: number | null;
	cls: number | null;
	tbtMs: number | null;
	fcpMs: number | null;
	speedIndexMs: number | null;
	inpMs: number | null;
	ttfbMs: number | null;
	totalBytes: number | null;
	requestCount: number | null;
	fieldLcpMs: number | null;
	fieldInpMs: number | null;
	fieldCls: number | null;
	opportunities: PsiOpportunity[];
}

type PsiRawItem = {
	url?: string;
	totalBytes?: number;
	wastedMs?: number;
	wastedBytes?: number;
	node?: { selector?: string; snippet?: string; nodeLabel?: string };
	source?: { url?: string };
};

type PsiRawAudit = {
	title?: string;
	description?: string;
	displayValue?: string;
	score?: number | null;
	scoreDisplayMode?: string;
	numericValue?: number;
	metricSavings?: Record<string, number>;
	details?: { type?: string; overallSavingsMs?: number; items?: PsiRawItem[] };
};

type PsiRaw = {
	loadingExperience?: {
		metrics?: Record<string, { percentile?: number }>;
	};
	lighthouseResult?: {
		categories?: Record<
			string,
			{ score?: number | null; auditRefs?: { id: string; weight?: number; group?: string }[] }
		>;
		audits?: Record<string, PsiRawAudit>;
	};
};

function score100(cat?: { score?: number | null }): number | null {
	return cat?.score == null ? null : Math.round(cat.score * 100);
}

function auditMs(audits: NonNullable<PsiRaw['lighthouseResult']>['audits'], key: string): number | null {
	const v = audits?.[key]?.numericValue;
	return v == null ? null : Math.round(v);
}

const OPP_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
const MAX_OPPORTUNITIES = 12;
const MAX_ITEMS_PER_OPPORTUNITY = 5;

function stripMarkdownLinks(text: string): string {
	return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

function formatKb(bytes: number): string {
	const kb = bytes / 1024;
	return kb < 10 ? `${kb.toFixed(1).replace('.', ',')} KB` : `${Math.round(kb)} KB`;
}

function opportunityItem(item: PsiRawItem): PsiOpportunityItem | null {
	if (item.node?.selector) {
		return {
			label: item.node.selector,
			detail: (item.node.snippet ?? item.node.nodeLabel ?? '').slice(0, 160) || undefined
		};
	}
	const url = item.url ?? item.source?.url;
	if (!url) return null;
	const parts: string[] = [];
	if (item.totalBytes != null) parts.push(formatKb(item.totalBytes));
	if (item.wastedMs != null) parts.push(`${Math.round(item.wastedMs)} ms`);
	else if (item.wastedBytes != null) parts.push(`${formatKb(item.wastedBytes)} irosiți`);
	return { label: url.slice(0, 200), detail: parts.join(' · ') || undefined };
}

/**
 * Recomandările de îmbunătățire, ca în raportul PageSpeed web: auditurile picate
 * din fiecare categorie, cu economia estimată (Lighthouse ≥ 10 o raportează prin
 * `metricSavings`, cele vechi prin `details.overallSavingsMs`) și elementele
 * afectate (URL-uri de resurse sau selectori DOM).
 */
function extractOpportunities(
	cats: NonNullable<NonNullable<PsiRaw['lighthouseResult']>['categories']>,
	audits: NonNullable<NonNullable<PsiRaw['lighthouseResult']>['audits']>
): PsiOpportunity[] {
	const out: PsiOpportunity[] = [];
	const seen = new Set<string>();
	for (const category of OPP_CATEGORIES) {
		for (const ref of cats[category]?.auditRefs ?? []) {
			if (seen.has(ref.id) || ref.group === 'metrics') continue;
			const audit = audits[ref.id];
			if (!audit) continue;
			const mode = audit.scoreDisplayMode;
			if (mode === 'notApplicable' || mode === 'manual' || mode === 'informative') continue;
			const savingsMs = Math.round(
				Math.max(
					audit.details?.overallSavingsMs ?? 0,
					...Object.values(audit.metricSavings ?? {}).map((v) => v ?? 0)
				)
			);
			const failing = audit.score != null && audit.score < 0.9;
			if (!failing && savingsMs <= 0) continue;
			// în răspunsurile reale, unele audituri au `details.items` non-array (ex. debugdata)
			const items = (Array.isArray(audit.details?.items) ? audit.details.items : [])
				.map(opportunityItem)
				.filter((i): i is PsiOpportunityItem => !!i)
				.slice(0, MAX_ITEMS_PER_OPPORTUNITY);
			// „insights" de performanță fără economie și fără elemente = zgomot, nu recomandare
			if (category === 'performance' && savingsMs <= 0 && items.length === 0) continue;
			seen.add(ref.id);
			out.push({
				id: ref.id,
				title: audit.title ?? ref.id,
				category,
				savingsMs,
				displayValue: audit.displayValue || undefined,
				description: audit.description
					? stripMarkdownLinks(audit.description).slice(0, 240)
					: undefined,
				items
			});
		}
	}
	// performanța întâi (după economie), apoi restul categoriilor în ordinea de mai sus
	const categoryRank = (c: PsiOpportunity['category']) => OPP_CATEGORIES.indexOf(c);
	return out
		.sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || b.savingsMs - a.savingsMs)
		.slice(0, MAX_OPPORTUNITIES);
}

export function parsePsiResponse(raw: unknown): PsiResult {
	const data = (raw ?? {}) as PsiRaw;
	const lh = data.lighthouseResult ?? {};
	const cats = lh.categories ?? {};
	const audits = lh.audits ?? {};
	const field = data.loadingExperience?.metrics;

	const clsRaw = audits['cumulative-layout-shift']?.numericValue;
	const fieldClsRaw = field?.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;
	const opportunities = extractOpportunities(cats, audits);

	return {
		performance: score100(cats.performance),
		accessibility: score100(cats.accessibility),
		bestPractices: score100(cats['best-practices']),
		seo: score100(cats.seo),
		lcpMs: auditMs(audits, 'largest-contentful-paint'),
		cls: clsRaw == null ? null : clsRaw,
		tbtMs: auditMs(audits, 'total-blocking-time'),
		fcpMs: auditMs(audits, 'first-contentful-paint'),
		speedIndexMs: auditMs(audits, 'speed-index'),
		inpMs:
			auditMs(audits, 'interaction-to-next-paint') ??
			auditMs(audits, 'experimental-interaction-to-next-paint'),
		ttfbMs: auditMs(audits, 'server-response-time'),
		totalBytes: auditMs(audits, 'total-byte-weight'),
		requestCount: audits['network-requests']?.details?.items?.length ?? null,
		fieldLcpMs: field?.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
		fieldInpMs: field?.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
		// CrUX raportează CLS ×100 (ex. 8 = 0.08)
		fieldCls: fieldClsRaw == null ? null : fieldClsRaw / 100,
		opportunities
	};
}

type FetchDeps = {
	/** injectabil în teste — semnătura minimă de care avem nevoie */
	fetch?: (url: string, init?: RequestInit) => Promise<Response>;
	sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function buildPsiUrl(url: string, strategy: PsiStrategy, apiKey: string | null): string {
	const params = new URLSearchParams();
	params.set('url', url);
	params.set('strategy', strategy);
	params.append('category', 'performance');
	params.append('category', 'accessibility');
	params.append('category', 'best-practices');
	params.append('category', 'seo');
	params.set('locale', 'ro');
	if (apiKey) params.set('key', apiKey);
	return `${PSI_ENDPOINT}?${params.toString()}`;
}

/**
 * Rulează PageSpeed pentru un URL + strategie. Aruncă PsiApiError pe eroare permanentă
 * sau ultima eroare după epuizarea retry-urilor.
 */
export async function fetchPagespeed(
	url: string,
	strategy: PsiStrategy,
	deps: FetchDeps = {}
): Promise<PsiResult> {
	// Fără cheie, PSI acceptă un volum mic de cereri (util în dev); în producție
	// cheia din PSI_API_KEY ridică limita la cota configurată în Google Cloud.
	const apiKey = env.PSI_API_KEY || null;
	const doFetch = deps.fetch ?? fetch;
	const sleep = deps.sleep ?? defaultSleep;
	const requestUrl = buildPsiUrl(url, strategy, apiKey);

	let lastError: unknown;
	for (let attempt = 0; attempt < PSI_RETRIES; attempt++) {
		try {
			const response = await doFetch(requestUrl, {
				signal: AbortSignal.timeout(PSI_TIMEOUT_MS),
				headers: { accept: 'application/json' }
			});
			if (!response.ok) {
				// 429 fără cheie = cota anonimă partajată Google, epuizată permanent —
				// retry-ul e inutil; utilul e mesajul: configurează PSI_API_KEY.
				const anonymousQuota = response.status === 429 && !apiKey;
				const retryable = !anonymousQuota && (response.status === 429 || response.status >= 500);
				let detail = '';
				try {
					const body = (await response.json()) as { error?: { message?: string } };
					detail = body?.error?.message ?? '';
				} catch {
					// corp non-JSON — păstrăm doar statusul
				}
				const hint = anonymousQuota
					? 'Lipsește PSI_API_KEY — creează o cheie gratuită în Google Cloud (PageSpeed Insights API) și pune-o în .env. '
					: '';
				throw new PsiApiError(
					`${hint}PSI ${response.status}${detail ? `: ${detail}` : ''} (${strategy} ${url})`,
					response.status,
					retryable
				);
			}
			return parsePsiResponse(await response.json());
		} catch (error) {
			lastError = error;
			if (error instanceof PsiApiError && !error.retryable) throw error;
			if (attempt === PSI_RETRIES - 1) break;
			const base = Math.min(1000 * Math.pow(2, attempt), 8000);
			const jitter = base * (Math.random() * 0.5 - 0.25);
			await sleep(Math.round(base + jitter));
		}
	}
	throw lastError;
}
