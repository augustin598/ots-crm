import { logError, logInfo } from '$lib/server/logger';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { and, eq, gt } from 'drizzle-orm';
import { createHmac } from 'crypto';
import { META_GRAPH_URL } from './client';

// =============================================================================
// Meta targeting search cache (anti-hallucination)
// =============================================================================
//
// Workers should NEVER invent Meta targeting IDs (interests, locations,
// behaviors). They query this cache for validated IDs returned by Meta's
// own `targetingsearch` and `search` endpoints. If a user asks for a
// concept that has no Meta-approved ID, the worker simply omits it.
//
// Cache TTL: 24 hours. Cache key: (type, normalized query).
// =============================================================================

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type TargetingType = 'interests' | 'locations' | 'behaviors' | 'demographics';

export interface TargetingOption {
	id: string;
	name: string;
	type: TargetingType;
	audienceSizeLowerBound?: number;
	audienceSizeUpperBound?: number;
	path?: string[]; // e.g. ["Interests", "Sports", "Yoga"]
	countryCode?: string; // for locations
	region?: string; // for locations
}

interface CachedPayload {
	options: TargetingOption[];
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function generateAppSecretProof(accessToken: string, appSecret: string): string {
	return createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

function normalizeQuery(q: string): string {
	return q.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 128);
}

/**
 * Get targeting options from Meta, with 24h DB cache. Returns up to `limit`
 * results sorted by relevance (Meta's own ordering).
 *
 * @throws on Meta API error or network failure (caller should fall back to
 *   empty list rather than crashing the campaign creation flow).
 */
export async function searchTargetingOptions(input: {
	type: TargetingType;
	query: string;
	accessToken: string;
	appSecret: string;
	limit?: number;
}): Promise<TargetingOption[]> {
	const normalized = normalizeQuery(input.query);
	if (!normalized) return [];

	const cached = await loadCached(input.type, normalized);
	if (cached) {
		logInfo('meta-ads', `targeting cache HIT type=${input.type} q="${normalized}"`);
		return cached.options.slice(0, input.limit ?? 25);
	}

	logInfo('meta-ads', `targeting cache MISS type=${input.type} q="${normalized}"`);
	const fresh = await fetchFromMeta(input);
	await storeCache(input.type, normalized, fresh);
	return fresh.slice(0, input.limit ?? 25);
}

async function loadCached(
	type: TargetingType,
	query: string
): Promise<CachedPayload | null> {
	const now = new Date();
	const [row] = await db
		.select({ payloadJson: table.metaTargetingCache.payloadJson })
		.from(table.metaTargetingCache)
		.where(
			and(
				eq(table.metaTargetingCache.type, type),
				eq(table.metaTargetingCache.query, query),
				gt(table.metaTargetingCache.expiresAt, now)
			)
		)
		.limit(1);
	if (!row) return null;
	try {
		const parsed = JSON.parse(row.payloadJson) as CachedPayload;
		if (!parsed.options || !Array.isArray(parsed.options)) return null;
		return parsed;
	} catch {
		return null;
	}
}

async function storeCache(
	type: TargetingType,
	query: string,
	options: TargetingOption[]
): Promise<void> {
	const now = new Date();
	const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
	const payload: CachedPayload = { options };
	const payloadJson = JSON.stringify(payload);

	const [existing] = await db
		.select({ id: table.metaTargetingCache.id })
		.from(table.metaTargetingCache)
		.where(and(eq(table.metaTargetingCache.type, type), eq(table.metaTargetingCache.query, query)))
		.limit(1);

	if (existing) {
		await db
			.update(table.metaTargetingCache)
			.set({ payloadJson, fetchedAt: now, expiresAt })
			.where(eq(table.metaTargetingCache.id, existing.id));
	} else {
		await db.insert(table.metaTargetingCache).values({
			id: generateId(),
			type,
			query,
			payloadJson,
			fetchedAt: now,
			expiresAt
		});
	}
}

async function fetchFromMeta(input: {
	type: TargetingType;
	query: string;
	accessToken: string;
	appSecret: string;
}): Promise<TargetingOption[]> {
	const proof = generateAppSecretProof(input.accessToken, input.appSecret);

	let url: string;
	const params = new URLSearchParams({
		access_token: input.accessToken,
		appsecret_proof: proof,
		q: normalizeQuery(input.query),
		limit: '25'
	});

	if (input.type === 'interests') {
		params.set('type', 'adinterest');
		url = `${META_GRAPH_URL}/search?${params.toString()}`;
	} else if (input.type === 'behaviors') {
		params.set('type', 'adTargetingCategory');
		params.set('class', 'behaviors');
		url = `${META_GRAPH_URL}/search?${params.toString()}`;
	} else if (input.type === 'locations') {
		params.set('type', 'adgeolocation');
		params.set('location_types', JSON.stringify(['city', 'region', 'country', 'subcity']));
		url = `${META_GRAPH_URL}/search?${params.toString()}`;
	} else {
		// demographics — handled via Meta's separate browse endpoints. Return [] for MVP.
		return [];
	}

	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
		const data: any = await res.json().catch(() => ({}));
		if (data.error) {
			throw new Error(`Meta search error: ${data.error.message}`);
		}
		const rows: any[] = Array.isArray(data.data) ? data.data : [];
		return rows.map((r) => normalizeOption(r, input.type)).filter(Boolean) as TargetingOption[];
	} catch (err) {
		logError('meta-ads', 'targeting search failed', {
			metadata: {
				type: input.type,
				query: input.query,
				error: err instanceof Error ? err.message : String(err)
			}
		});
		throw err;
	}
}

function normalizeOption(raw: any, type: TargetingType): TargetingOption | null {
	if (!raw?.id || !raw?.name) return null;
	const opt: TargetingOption = {
		id: String(raw.id),
		name: String(raw.name),
		type
	};
	if (typeof raw.audience_size_lower_bound === 'number')
		opt.audienceSizeLowerBound = raw.audience_size_lower_bound;
	if (typeof raw.audience_size_upper_bound === 'number')
		opt.audienceSizeUpperBound = raw.audience_size_upper_bound;
	if (Array.isArray(raw.path)) opt.path = raw.path.map((p: unknown) => String(p));
	if (typeof raw.country_code === 'string') opt.countryCode = raw.country_code;
	if (typeof raw.region === 'string') opt.region = raw.region;
	return opt;
}
