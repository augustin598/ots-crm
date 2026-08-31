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

export interface PsiOpportunity {
	id: string;
	title: string;
	savingsMs: number;
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

type PsiRaw = {
	loadingExperience?: {
		metrics?: Record<string, { percentile?: number }>;
	};
	lighthouseResult?: {
		categories?: Record<string, { score?: number | null }>;
		audits?: Record<
			string,
			{
				title?: string;
				numericValue?: number;
				details?: { type?: string; overallSavingsMs?: number; items?: unknown[] };
			}
		>;
	};
};

function score100(cat?: { score?: number | null }): number | null {
	return cat?.score == null ? null : Math.round(cat.score * 100);
}

function auditMs(audits: NonNullable<PsiRaw['lighthouseResult']>['audits'], key: string): number | null {
	const v = audits?.[key]?.numericValue;
	return v == null ? null : Math.round(v);
}

export function parsePsiResponse(raw: unknown): PsiResult {
	const data = (raw ?? {}) as PsiRaw;
	const lh = data.lighthouseResult ?? {};
	const cats = lh.categories ?? {};
	const audits = lh.audits ?? {};
	const field = data.loadingExperience?.metrics;

	const clsRaw = audits['cumulative-layout-shift']?.numericValue;
	const fieldClsRaw = field?.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;

	const opportunities: PsiOpportunity[] = Object.entries(audits)
		.filter(
			([, a]) => a?.details?.type === 'opportunity' && (a.details.overallSavingsMs ?? 0) > 0
		)
		.map(([id, a]) => ({
			id,
			title: a.title ?? id,
			savingsMs: Math.round(a.details?.overallSavingsMs ?? 0)
		}))
		.sort((a, b) => b.savingsMs - a.savingsMs)
		.slice(0, 6);

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

export function buildPsiUrl(url: string, strategy: PsiStrategy, apiKey: string): string {
	const params = new URLSearchParams();
	params.set('url', url);
	params.set('strategy', strategy);
	params.append('category', 'performance');
	params.append('category', 'accessibility');
	params.append('category', 'best-practices');
	params.append('category', 'seo');
	params.set('locale', 'ro');
	params.set('key', apiKey);
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
	const apiKey = env.PSI_API_KEY;
	if (!apiKey) {
		throw new PsiApiError('PSI_API_KEY lipsește din variabilele de mediu', 0, false);
	}
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
				const retryable = response.status === 429 || response.status >= 500;
				let detail = '';
				try {
					const body = (await response.json()) as { error?: { message?: string } };
					detail = body?.error?.message ?? '';
				} catch {
					// corp non-JSON — păstrăm doar statusul
				}
				throw new PsiApiError(
					`PSI ${response.status}${detail ? `: ${detail}` : ''} (${strategy} ${url})`,
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
