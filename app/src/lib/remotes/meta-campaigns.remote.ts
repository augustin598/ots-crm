/**
 * Remote functions pentru pagina Campanii Ads (Meta) — /[tenant]/campaigns-ads/facebook.
 *
 * Pattern identic cu reports.remote.ts (cache in-process 5 min, rezolvarea
 * integrării din DB — niciodată din parametrii clientului), dar staff-only:
 * pagina de management nu e expusă în portalul clientului.
 *
 * Diferență deliberată față de reports.remote.ts: cheile de cache includ
 * integrationId-ul rezolvat (conturile duplicate post-reconnect nu împart intrarea).
 */
import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { requireStaff } from '$lib/server/get-actor';
import { logError } from '$lib/server/logger';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';
import {
	listCampaignInsights,
	listActiveCampaigns,
	listCampaignReachFrequency,
	toggleCampaignStatus as toggleCampaignStatusApi,
	getCampaignWithAdsets,
	getCampaignAccountId,
	type CampaignWithAdsets
} from '$lib/server/meta-ads/client';
import { buildCampaignRows } from '$lib/server/meta-ads/campaigns-view';
import type { CampaignRow } from '$lib/utils/meta-campaigns';

// ---- Cache in-process (5 min TTL, max 200 chei, FIFO) ----

const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 200;

function getCached<T>(key: string): T | null {
	const entry = cache.get(key);
	if (!entry) return null;
	if (Date.now() - entry.timestamp > CACHE_TTL) {
		cache.delete(key);
		return null;
	}
	// LRU: reinserarea mută cheia la coada Map-ului, deci evicția FIFO de mai jos
	// lovește cheile reci, nu listing-ul consultat la fiecare interacțiune.
	cache.delete(key);
	cache.set(key, entry);
	return entry.data as T;
}

function setCache(key: string, data: unknown): void {
	if (cache.size >= MAX_CACHE_SIZE) {
		const firstKey = cache.keys().next().value;
		if (firstKey) cache.delete(firstKey);
	}
	cache.set(key, { data, timestamp: Date.now() });
}

function invalidateCache(...patterns: string[]): void {
	for (const key of cache.keys()) {
		if (patterns.some((p) => key.includes(p))) {
			cache.delete(key);
		}
	}
}

// ---- Helpers (aceeași logică precum reports.remote.ts) ----

const _integrationCache = new Map<string, string>();
const _helperCacheTTL = 30_000;
let _helperCacheTs = 0;

function clearHelperCacheIfStale() {
	if (Date.now() - _helperCacheTs > _helperCacheTTL) {
		_integrationCache.clear();
		_helperCacheTs = Date.now();
	}
}

/**
 * Rezolvă integrationId-ul corect pentru un cont; când același cont există sub
 * mai multe integrări (post-reconnect), preferă integrarea activă.
 */
async function resolveAccountIntegration(adAccountId: string, tenantId: string): Promise<string> {
	clearHelperCacheIfStale();
	const ck = `${adAccountId}:${tenantId}`;
	const cached = _integrationCache.get(ck);
	if (cached) return cached;

	const rows = await db
		.select({
			integrationId: table.metaAdsAccount.integrationId,
			integrationActive: table.metaAdsIntegration.isActive
		})
		.from(table.metaAdsAccount)
		.leftJoin(table.metaAdsIntegration, eq(table.metaAdsAccount.integrationId, table.metaAdsIntegration.id))
		.where(
			and(
				eq(table.metaAdsAccount.metaAdAccountId, adAccountId),
				eq(table.metaAdsAccount.tenantId, tenantId)
			)
		);

	if (!rows.length) {
		throw error(404, 'Cont Meta Ads negăsit');
	}

	const best = rows.find((r) => r.integrationActive === true) ?? rows[0];
	_integrationCache.set(ck, best.integrationId);
	return best.integrationId;
}

function throwMetaApiError(err: unknown, context?: { adAccountId?: string; integrationId?: string }): never {
	const msg = err instanceof Error ? err.message : String(err);
	logError('meta-ads', `API error${context?.adAccountId ? ` for account ${context.adAccountId}` : ''}`, {
		metadata: { error: msg, ...context }
	});
	if (msg.includes('validating access token') || msg.includes('session has been invalidated') || msg.includes('Session has expired')) {
		throw error(401, 'Tokenul Meta Ads a expirat sau a fost revocat. Reconectează din Settings → Meta Ads.');
	}
	if (msg.includes('does not have permission') || msg.includes('(#200)')) {
		throw error(403, 'Nu ai permisiuni pentru acest cont Meta Ads. Verifică rolul din Business Manager.');
	}
	if (msg.includes('has not authorized application') || msg.includes('(#190)')) {
		throw error(401, 'Aplicația nu mai este autorizată. Reconectează din Settings → Meta Ads.');
	}
	if (msg.includes('log in to www.facebook.com')) {
		// OAuthException 190/459 — checkpoint de securitate pe contul FB al integrării.
		throw error(
			401,
			'Contul Facebook al integrării are o verificare de securitate (checkpoint). Intră pe facebook.com cu acel cont, finalizează verificarea, apoi reîncearcă sau reconectează din Settings → Meta Ads.'
		);
	}
	if (msg.includes('Invalid OAuth') || msg.includes('OAuthException')) {
		throw error(401, 'Token OAuth invalid. Reconectează din Settings → Meta Ads.');
	}
	// Nu expune blob-ul JSON brut de la Meta în UI — detaliile sunt deja în log.
	throw error(500, 'Meta Ads a răspuns cu o eroare neașteptată. Încearcă din nou în câteva minute.');
}

/** Guard comun: user + tenant + rol staff. Întoarce { event, tenantId }. */
async function requireStaffEvent() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Neautentificat');
	}
	await requireStaff(event);
	return { event, tenantId: event.locals.tenant.id };
}

async function resolveAuth(adAccountId: string, tenantId: string) {
	const integrationId = await resolveAccountIntegration(adAccountId, tenantId);
	const auth = await getAuthenticatedToken(integrationId);
	if (!auth) {
		throw error(500, 'Nu s-a putut obține token-ul Meta Ads. Reconectează integrarea din Settings → Meta Ads.');
	}
	const appSecret = env.META_APP_SECRET;
	if (!appSecret) {
		throw error(500, 'META_APP_SECRET nu este configurat');
	}
	return { integrationId, accessToken: auth.accessToken, appSecret };
}

/**
 * Verifică pe Graph că un campaignId venit de la client chiar aparține
 * contului validat — tokenul tenantului poate atinge și conturi nemapate
 * în CRM (același Business Manager), pe care nu vrem să operăm.
 */
async function assertCampaignInAccount(
	campaignId: string,
	adAccountId: string,
	accessToken: string,
	appSecret: string,
	integrationId: string
): Promise<void> {
	let ownerAccountId: string | null;
	try {
		ownerAccountId = await getCampaignAccountId(campaignId, accessToken, appSecret);
	} catch (err) {
		throwMetaApiError(err, { adAccountId, integrationId });
	}
	if (!ownerAccountId || `act_${ownerAccountId}` !== adAccountId) {
		throw error(403, 'Campania nu aparține contului Meta Ads selectat.');
	}
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface MetaCampaignsPayload {
	rows: CampaignRow[];
	dailySpend: Array<{ date: string; spend: number }>;
}

// ---- Queries ----

/** Lista campaniilor cu insights agregate pe fereastra selectată. */
export const listMetaCampaignRows = query(
	v.object({
		adAccountId: v.pipe(v.string(), v.minLength(1)),
		since: v.pipe(v.string(), v.regex(DATE_RE)),
		until: v.pipe(v.string(), v.regex(DATE_RE))
	}),
	async ({ adAccountId, since, until }): Promise<MetaCampaignsPayload> => {
		const { tenantId } = await requireStaffEvent();
		const { integrationId, accessToken, appSecret } = await resolveAuth(adAccountId, tenantId);

		const cacheKey = `campanii:${tenantId}:${integrationId}:${adAccountId}:${since}:${until}`;
		const cached = getCached<MetaCampaignsPayload>(cacheKey);
		if (cached) return cached;

		try {
			const [insights, campaigns, reach] = await Promise.all([
				listCampaignInsights(adAccountId, accessToken, appSecret, since, until, 'daily'),
				listActiveCampaigns(adAccountId, accessToken, appSecret),
				listCampaignReachFrequency(adAccountId, accessToken, appSecret, since, until)
			]);
			const payload = buildCampaignRows(insights, campaigns, reach, since, until);
			setCache(cacheKey, payload);
			return payload;
		} catch (err) {
			throwMetaApiError(err, { adAccountId, integrationId });
		}
	}
);

/** Detaliu lazy pentru rândul expandat: ad seturile campaniei + bugete + CPL. */
export const getMetaCampaignAdsets = query(
	v.object({
		adAccountId: v.pipe(v.string(), v.minLength(1)),
		campaignId: v.pipe(v.string(), v.minLength(1))
	}),
	async ({ adAccountId, campaignId }): Promise<CampaignWithAdsets> => {
		const { tenantId } = await requireStaffEvent();
		const { integrationId, accessToken, appSecret } = await resolveAuth(adAccountId, tenantId);

		const cacheKey = `adseturi:${tenantId}:${integrationId}:${campaignId}`;
		const cached = getCached<CampaignWithAdsets>(cacheKey);
		if (cached) return cached;

		await assertCampaignInAccount(campaignId, adAccountId, accessToken, appSecret, integrationId);

		try {
			const detail = await getCampaignWithAdsets(campaignId, accessToken, appSecret);
			setCache(cacheKey, detail);
			return detail;
		} catch (err) {
			throwMetaApiError(err, { adAccountId, integrationId });
		}
	}
);

// ---- Commands ----

/** Pauzează sau pornește o campanie. */
export const toggleMetaCampaign = command(
	v.object({
		adAccountId: v.pipe(v.string(), v.minLength(1)),
		campaignId: v.pipe(v.string(), v.minLength(1)),
		status: v.picklist(['ACTIVE', 'PAUSED'])
	}),
	async ({ adAccountId, campaignId, status }) => {
		const { tenantId } = await requireStaffEvent();
		const { integrationId, accessToken, appSecret } = await resolveAuth(adAccountId, tenantId);

		await assertCampaignInAccount(campaignId, adAccountId, accessToken, appSecret, integrationId);

		try {
			await toggleCampaignStatusApi(campaignId, accessToken, appSecret, status);
		} catch (err) {
			throwMetaApiError(err, { adAccountId, integrationId });
		}

		// Doar cheile integrării afectate — nu tot cache-ul tenantului.
		invalidateCache(`:${integrationId}:`);
		return { success: true as const, campaignId, status };
	}
);

/** Golește cache-ul serverului pentru contul dat (butonul Refresh). */
export const refreshMetaCampaigns = command(
	v.object({ adAccountId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ adAccountId }) => {
		const { tenantId } = await requireStaffEvent();
		const integrationId = await resolveAccountIntegration(adAccountId, tenantId);
		invalidateCache(`:${integrationId}:`);
		return { success: true as const };
	}
);
