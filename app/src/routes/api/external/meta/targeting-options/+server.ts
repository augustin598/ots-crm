import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';
import { searchTargetingOptions, type TargetingType } from '$lib/server/meta-ads/targeting-cache';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';

const VALID_TYPES = new Set<TargetingType>(['interests', 'locations', 'behaviors', 'demographics']);

export const GET: RequestHandler = (event) =>
	withApiKey(event, 'campaigns:read', async (event, ctx) => {
		const typeParam = (event.url.searchParams.get('type') ?? '').toLowerCase();
		const search = event.url.searchParams.get('search') ?? '';
		const limitRaw = parseInt(event.url.searchParams.get('limit') ?? '25', 10);
		const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 25;

		if (!VALID_TYPES.has(typeParam as TargetingType)) {
			return {
				status: 400,
				body: {
					error: 'invalid_type',
					message: 'type must be one of: interests | locations | behaviors | demographics'
				}
			};
		}
		if (!search.trim()) {
			return { status: 400, body: { error: 'invalid_search', message: 'search query required' } };
		}

		// Find ANY active Meta integration for this tenant — targeting search doesn't
		// need to be per-account; Meta resolves it at the user/business level.
		const [integration] = await db
			.select()
			.from(table.metaAdsIntegration)
			.where(
				and(
					eq(table.metaAdsIntegration.tenantId, ctx.tenantId),
					eq(table.metaAdsIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			return {
				status: 409,
				body: {
					error: 'no_meta_integration',
					message: 'Tenant has no active Meta integration'
				}
			};
		}

		const tokenInfo = await getAuthenticatedToken(integration.id);
		if (!tokenInfo) {
			return {
				status: 503,
				body: { error: 'token_refresh_failed' }
			};
		}

		const appSecret = env.META_APP_SECRET;
		if (!appSecret) {
			return { status: 500, body: { error: 'app_secret_missing' } };
		}

		try {
			const options = await searchTargetingOptions({
				type: typeParam as TargetingType,
				query: search,
				accessToken: tokenInfo.accessToken,
				appSecret,
				limit
			});
			return { status: 200, body: { type: typeParam, query: search, options } };
		} catch (err) {
			return {
				status: 502,
				body: {
					error: 'targeting_search_failed',
					message: err instanceof Error ? err.message : String(err)
				}
			};
		}
	});
