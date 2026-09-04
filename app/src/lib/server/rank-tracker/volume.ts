// Volume de căutare lunare + bidurile top-of-page pentru cuvintele cheie, din Google
// Ads API (KeywordPlanIdeaService.generateKeywordHistoricalMetrics). Rulează lunar, nu
// zilnic. Skip grațios dacă tenantul n-are integrarea Google Ads. Dependențele externe
// sunt injectabile → testabil fără API. NOTĂ: un dev token de test întoarce volume goale.
// Google NU întoarce un CPC mediu aici, doar intervalul low/high al bidului de top —
// în micro-unități ale monedei contului (RON la noi).
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { rankKeyword, rankProject } from '$lib/server/db/schema';
import { logError, logInfo, serializeError } from '$lib/server/logger';

const BATCH = 20;
const RO_GEO = 'geoTargetConstants/2642'; // România
const RO_LANG = 'languageConstants/1032'; // ro

interface KeywordLite {
	id: string;
	keyword: string;
}

/** Ce reține un cuvânt cheie dintr-un răspuns Keyword Planner. */
export interface KeywordMetrics {
	volume: number | null;
	cpcLowMicros: number | null;
	cpcHighMicros: number | null;
}

export interface VolumeDeps {
	loadKeywords?: (tenantId: string) => Promise<KeywordLite[]>;
	/** Întoarce metricile per keyword, sau null dacă nu există integrare Google Ads. */
	fetchVolumes?: (tenantId: string, keywords: string[]) => Promise<Map<string, KeywordMetrics> | null>;
	saveVolume?: (keywordId: string, metrics: KeywordMetrics, now: Date) => Promise<void>;
	now?: () => Date;
}

export interface VolumeResult {
	skipped?: boolean;
	reason?: string;
	updated: number;
}

async function defaultLoadKeywords(tenantId: string): Promise<KeywordLite[]> {
	return db
		.select({ id: rankKeyword.id, keyword: rankKeyword.keyword })
		.from(rankKeyword)
		.innerJoin(rankProject, eq(rankKeyword.projectId, rankProject.id))
		.where(and(eq(rankProject.tenantId, tenantId), eq(rankKeyword.active, true)));
}

async function defaultFetchVolumes(
	tenantId: string,
	keywords: string[]
): Promise<Map<string, KeywordMetrics> | null> {
	const { getAuthenticatedClient } = await import('$lib/server/google-ads/auth');
	const auth = await getAuthenticatedClient(tenantId);
	if (!auth) return null;
	const { integration } = auth as { integration: { developerToken: string; refreshToken: string; mccAccountId: string } };

	const { GoogleAdsApi } = await import('google-ads-api');
	const { env } = await import('$env/dynamic/private');
	const cleanId = String(integration.mccAccountId).replace(/\D/g, '');
	const client = new GoogleAdsApi({
		client_id: env.GOOGLE_CLIENT_ID!,
		client_secret: env.GOOGLE_CLIENT_SECRET!,
		developer_token: integration.developerToken
	});
	const customer = client.Customer({
		customer_id: cleanId,
		login_customer_id: cleanId,
		refresh_token: integration.refreshToken
	});

	// generateKeywordHistoricalMetrics întoarce avg_monthly_searches și intervalul de
	// bid top-of-page per keyword (micro-unități ale monedei contului).
	const response = await (
		customer as unknown as {
			keywordPlanIdeas: {
				generateKeywordHistoricalMetrics: (req: Record<string, unknown>) => Promise<{
					results?: Array<{
						text?: string;
						keyword_metrics?: {
							avg_monthly_searches?: number | string;
							low_top_of_page_bid_micros?: number | string;
							high_top_of_page_bid_micros?: number | string;
						};
					}>;
				}>;
			};
		}
	).keywordPlanIdeas.generateKeywordHistoricalMetrics({
		customer_id: cleanId,
		keywords,
		geo_target_constants: [RO_GEO],
		language: RO_LANG,
		keyword_plan_network: 'GOOGLE_SEARCH'
	});

	const num = (v: number | string | undefined | null) => (v != null ? Number(v) : null);
	const map = new Map<string, KeywordMetrics>();
	for (const r of response.results ?? []) {
		if (!r.text) continue;
		map.set(r.text.toLowerCase(), {
			volume: num(r.keyword_metrics?.avg_monthly_searches),
			cpcLowMicros: num(r.keyword_metrics?.low_top_of_page_bid_micros),
			cpcHighMicros: num(r.keyword_metrics?.high_top_of_page_bid_micros)
		});
	}
	return map;
}

async function defaultSaveVolume(keywordId: string, metrics: KeywordMetrics, now: Date) {
	await db
		.update(rankKeyword)
		.set({
			volume: metrics.volume,
			cpcLowMicros: metrics.cpcLowMicros,
			cpcHighMicros: metrics.cpcHighMicros,
			volumeUpdatedAt: now,
			updatedAt: now
		})
		.where(eq(rankKeyword.id, keywordId));
}

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/** Reîmprospătează volumele de căutare pentru cuvintele cheie ale unui tenant. */
export async function refreshKeywordVolumes(tenantId: string, deps: VolumeDeps = {}): Promise<VolumeResult> {
	const loadKeywords = deps.loadKeywords ?? defaultLoadKeywords;
	const fetchVolumes = deps.fetchVolumes ?? defaultFetchVolumes;
	const saveVolume = deps.saveVolume ?? defaultSaveVolume;
	const now = deps.now ?? (() => new Date());

	const keywords = await loadKeywords(tenantId);
	if (keywords.length === 0) return { skipped: true, reason: 'fără cuvinte cheie', updated: 0 };

	let updated = 0;
	for (const batch of chunk(keywords, BATCH)) {
		let volumes: Map<string, KeywordMetrics> | null;
		try {
			volumes = await fetchVolumes(tenantId, batch.map((k) => k.keyword));
		} catch (e) {
			logError('scheduler', `[rank] volume: batch eșuat pentru ${tenantId}: ${serializeError(e).message}`);
			continue; // erorile de batch nu opresc restul
		}
		if (volumes === null) return { skipped: true, reason: 'fără integrare Google Ads', updated };

		for (const kw of batch) {
			const key = kw.keyword.toLowerCase();
			// Nu suprascrie valorile cunoscute când Google omite keyword-ul din răspuns.
			const metrics = volumes.get(key);
			if (!metrics) continue;
			await saveVolume(kw.id, metrics, now());
			updated++;
		}
	}

	if (updated > 0) logInfo('scheduler', `[rank] volume actualizate: ${updated} cuvinte cheie (${tenantId})`);
	return { updated };
}
