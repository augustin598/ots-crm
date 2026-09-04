import { json, error } from '@sveltejs/kit';
import { serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Sondă operațională pentru metricile Keyword Planner (admin-only, tenant-scoped).
 *   GET ?kw=cuvant,alt cuvant  — răspunsul BRUT de la generateKeywordHistoricalMetrics
 *                               plus moneda contului, ca să știm ce câmpuri chiar vin
 *                               (volum, competiție, biduri top-of-page) înainte să le
 *                               afișăm undeva.
 *   GET ?run=1                 — rulează efectiv reîmprospătarea (volum + biduri) pentru
 *                               tenantul curent, direct, fără coadă. Util când vrei
 *                               datele acum, nu la rularea lunară.
 * Nu întoarce niciodată credențiale.
 */

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: Admin access required');
	return event.locals.tenant.id;
}

export const GET: RequestHandler = async (event) => {
	const tenantId = requireAdmin(event);
	const keywords = (event.url.searchParams.get('kw') ?? 'videochat iasi,studio videochat')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, 10);

	if (event.url.searchParams.get('run') === '1') {
		const { refreshKeywordVolumes } = await import('$lib/server/rank-tracker/volume');
		try {
			return json({ ok: true, mode: 'run', ...(await refreshKeywordVolumes(tenantId)) });
		} catch (e) {
			return json({ ok: false, mode: 'run', error: serializeError(e).message }, { status: 200 });
		}
	}

	try {
		const { getAuthenticatedClient } = await import('$lib/server/google-ads/auth');
		const auth = await getAuthenticatedClient(tenantId);
		if (!auth) return json({ ok: false, reason: 'fără integrare Google Ads' }, { status: 200 });
		const { integration } = auth as {
			integration: { developerToken: string; refreshToken: string; mccAccountId: string };
		};

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

		const currencyRows = await customer.query(
			'SELECT customer.currency_code, customer.descriptive_name FROM customer LIMIT 1'
		);

		const response = await (
			customer as unknown as {
				keywordPlanIdeas: {
					generateKeywordHistoricalMetrics: (req: Record<string, unknown>) => Promise<unknown>;
				};
			}
		).keywordPlanIdeas.generateKeywordHistoricalMetrics({
			customer_id: cleanId,
			keywords,
			geo_target_constants: ['geoTargetConstants/2642'],
			language: 'languageConstants/1032',
			keyword_plan_network: 'GOOGLE_SEARCH'
		});

		return json({
			ok: true,
			customerId: cleanId,
			currency: currencyRows?.[0]?.customer?.currency_code ?? null,
			keywords,
			raw: JSON.parse(JSON.stringify(response))
		});
	} catch (e) {
		return json({ ok: false, error: serializeError(e).message }, { status: 200 });
	}
};
