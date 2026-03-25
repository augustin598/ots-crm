import { query, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, inArray, isNotNull } from 'drizzle-orm';
import { getAuthenticatedClient } from '$lib/server/google-ads/auth';
import {
	listCampaignInsights, listCampaigns, listAdGroupInsights, listDemographicInsights,
	GOOGLE_CHANNEL_MAP
} from '$lib/server/google-ads/client';

// ---- Server-side cache (5 min TTL) ----

const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 200;

function getCached<T>(key: string): T | null {
	const entry = cache.get(key);
	if (!entry) return null;
	if (Date.now() - entry.timestamp > CACHE_TTL) {
		cache.delete(key);
		return null;
	}
	return entry.data as T;
}

function setCache(key: string, data: any): void {
	if (cache.size >= MAX_CACHE_SIZE) {
		const firstKey = cache.keys().next().value;
		if (firstKey) cache.delete(firstKey);
	}
	cache.set(key, { data, timestamp: Date.now() });
}

// ---- Queries ----

/** Get all Google Ads accounts for the tenant (admin dropdown) */
export const getGoogleReportAdAccounts = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	if (event.locals.isClientUser) return [];

	const accounts = await db
		.select({
			id: table.googleAdsAccount.id,
			googleAdsCustomerId: table.googleAdsAccount.googleAdsCustomerId,
			accountName: table.googleAdsAccount.accountName,
			clientId: table.googleAdsAccount.clientId,
			clientName: table.client.name,
			isActive: table.googleAdsAccount.isActive
		})
		.from(table.googleAdsAccount)
		.leftJoin(table.client, eq(table.googleAdsAccount.clientId, table.client.id))
		.where(
			and(
				eq(table.googleAdsAccount.tenantId, event.locals.tenant.id),
				isNotNull(table.googleAdsAccount.clientId)
			)
		)
		.orderBy(table.googleAdsAccount.accountName);

	// Get currency from invoices
	const accountIds = accounts.map(a => a.googleAdsCustomerId);
	const currencyMap = new Map<string, string>();
	if (accountIds.length > 0) {
		const invoices = await db
			.select({ googleAdsCustomerId: table.googleAdsInvoice.googleAdsCustomerId, currencyCode: table.googleAdsInvoice.currencyCode })
			.from(table.googleAdsInvoice)
			.where(inArray(table.googleAdsInvoice.googleAdsCustomerId, accountIds))
			.orderBy(desc(table.googleAdsInvoice.issueDate));
		for (const inv of invoices) {
			if (!currencyMap.has(inv.googleAdsCustomerId)) {
				currencyMap.set(inv.googleAdsCustomerId, inv.currencyCode);
			}
		}
	}

	return accounts.map(acc => ({
		...acc,
		currency: currencyMap.get(acc.googleAdsCustomerId) || 'RON'
	}));
});

/** Get Google Ads account for logged-in client user */
export const getMyGoogleAdAccount = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant || !event?.locals.isClientUser || !event?.locals.client) {
		return null;
	}

	const accounts = await db
		.select({
			id: table.googleAdsAccount.id,
			googleAdsCustomerId: table.googleAdsAccount.googleAdsCustomerId,
			accountName: table.googleAdsAccount.accountName,
			clientId: table.googleAdsAccount.clientId
		})
		.from(table.googleAdsAccount)
		.where(
			and(
				eq(table.googleAdsAccount.tenantId, event.locals.tenant.id),
				eq(table.googleAdsAccount.clientId, event.locals.client.id)
			)
		)
		.orderBy(table.googleAdsAccount.accountName);

	if (accounts.length === 0) return [];

	return accounts.map(acc => ({ ...acc, currency: 'RON' }));
});

/** Get campaign-level insights from Google Ads API (live, cached 5 min) */
export const getGoogleCampaignInsights = query(
	v.object({
		customerId: v.pipe(v.string(), v.minLength(1)),
		since: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		until: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		if (event.locals.isClientUser) {
			if (!event.locals.client) throw error(401, 'Unauthorized');
			const [clientAccount] = await db
				.select({ googleAdsCustomerId: table.googleAdsAccount.googleAdsCustomerId })
				.from(table.googleAdsAccount)
				.where(and(
					eq(table.googleAdsAccount.clientId, event.locals.client.id),
					eq(table.googleAdsAccount.tenantId, event.locals.tenant.id),
					eq(table.googleAdsAccount.googleAdsCustomerId, params.customerId)
				))
				.limit(1);
			if (!clientAccount) throw error(401, 'Unauthorized');
		}

		const tenantId = event.locals.tenant.id;
		const cacheKey = `google-insights:${tenantId}:${params.customerId}:${params.since}:${params.until}`;
		const cached = getCached<any>(cacheKey);
		if (cached) return cached;

		const authResult = await getAuthenticatedClient(tenantId);
		if (!authResult) throw error(500, 'Nu s-a putut obține token-ul Google Ads. Verifică conexiunea din Settings.');

		const { integration } = authResult;

		try {
			const [insights, campaigns] = await Promise.all([
				listCampaignInsights(
					integration.mccAccountId, params.customerId,
					integration.developerToken, integration.refreshToken!,
					params.since, params.until
				),
				listCampaigns(
					integration.mccAccountId, params.customerId,
					integration.developerToken, integration.refreshToken!
				)
			]);

			setCache(cacheKey, insights);
			// Cache campaigns too
			setCache(`google-campaigns:${tenantId}:${params.customerId}`, campaigns);
			return insights;
		} catch (err) {
			const msg = err instanceof Error ? err.message : JSON.stringify(err).slice(0, 300);
			throw error(500, msg);
		}
	}
);

/** Get campaigns list for a sub-account */
export const getGoogleActiveCampaigns = query(
	v.object({
		customerId: v.pipe(v.string(), v.minLength(1))
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw error(401, 'Unauthorized');

		const tenantId = event.locals.tenant.id;
		const cacheKey = `google-campaigns:${tenantId}:${params.customerId}`;
		const cached = getCached<any>(cacheKey);
		if (cached) return cached;

		const authResult = await getAuthenticatedClient(tenantId);
		if (!authResult) throw error(500, 'Nu s-a putut obține token-ul Google Ads.');

		const { integration } = authResult;

		try {
			const campaigns = await listCampaigns(
				integration.mccAccountId, params.customerId,
				integration.developerToken, integration.refreshToken!
			);
			setCache(cacheKey, campaigns);
			return campaigns;
		} catch (err) {
			throw error(500, err instanceof Error ? err.message : JSON.stringify(err).slice(0, 300));
		}
	}
);

/** Get ad group insights for a specific campaign */
export const getGoogleAdGroupInsights = query(
	v.object({
		customerId: v.pipe(v.string(), v.minLength(1)),
		campaignId: v.pipe(v.string(), v.minLength(1)),
		since: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		until: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw error(401, 'Unauthorized');

		const tenantId = event.locals.tenant.id;
		const cacheKey = `google-adgroups:${tenantId}:${params.customerId}:${params.campaignId}:${params.since}:${params.until}`;
		const cached = getCached<any>(cacheKey);
		if (cached) return cached;

		const authResult = await getAuthenticatedClient(tenantId);
		if (!authResult) throw error(500, 'Nu s-a putut obține token-ul Google Ads.');

		const { integration } = authResult;

		try {
			const insights = await listAdGroupInsights(
				integration.mccAccountId, params.customerId, params.campaignId,
				integration.developerToken, integration.refreshToken!,
				params.since, params.until
			);
			setCache(cacheKey, insights);
			return insights;
		} catch (err) {
			throw error(500, err instanceof Error ? err.message : JSON.stringify(err).slice(0, 300));
		}
	}
);

/** Get demographic insights for a sub-account */
export const getGoogleDemographicInsights = query(
	v.object({
		customerId: v.pipe(v.string(), v.minLength(1)),
		since: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		until: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw error(401, 'Unauthorized');

		const tenantId = event.locals.tenant.id;
		const cacheKey = `google-demographics:${tenantId}:${params.customerId}:${params.since}:${params.until}`;
		const cached = getCached<any>(cacheKey);
		if (cached) return cached;

		const authResult = await getAuthenticatedClient(tenantId);
		if (!authResult) throw error(500, 'Nu s-a putut obține token-ul Google Ads.');

		const { integration } = authResult;

		try {
			const demographics = await listDemographicInsights(
				integration.mccAccountId, params.customerId,
				integration.developerToken, integration.refreshToken!,
				params.since, params.until
			);
			setCache(cacheKey, demographics);
			return demographics;
		} catch (err) {
			throw error(500, err instanceof Error ? err.message : JSON.stringify(err).slice(0, 300));
		}
	}
);
