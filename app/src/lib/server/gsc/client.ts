// Apelurile Google Search Console API v5 (`searchanalytics.query`, `sites.list`).
// `api` e injectabil, ca testele să nu atingă rețeaua. Orice apel are timeout —
// regula casei pentru fetch extern.
import { google } from 'googleapis';
import { getAuthenticatedClient } from './auth';
import type { GscRow } from '$lib/logic/gsc';

const TIMEOUT_MS = 60_000;
/** Maximul acceptat de API (docs: valid range 1–25.000). */
const ROW_LIMIT = 25000;

type SearchConsoleApi = ReturnType<typeof google.searchconsole>;
type Deps = { api?: SearchConsoleApi };

async function getApi(tenantId: string, deps: Deps): Promise<SearchConsoleApi> {
	if (deps.api) return deps.api;
	const auth = await getAuthenticatedClient(tenantId);
	return google.searchconsole({ version: 'v1', auth });
}

/**
 * Rândurile de performanță pentru o proprietate, pe fereastra dată.
 * `dataState: 'all'` include și zilele proaspete (parțiale) — de aceea jobul retrage
 * fereastra la fiecare rulare și face upsert.
 */
export async function querySearchAnalytics(
	tenantId: string,
	property: string,
	window: { startDate: string; endDate: string },
	deps: Deps = {}
): Promise<GscRow[]> {
	const api = await getApi(tenantId, deps);
	const res = await api.searchanalytics.query(
		{
			siteUrl: property,
			requestBody: {
				startDate: window.startDate,
				endDate: window.endDate,
				dimensions: ['query', 'device', 'date'],
				type: 'web',
				dataState: 'all',
				rowLimit: ROW_LIMIT
			}
		},
		{ timeout: TIMEOUT_MS }
	);
	return (res.data.rows ?? []) as GscRow[];
}

/** Proprietățile la care contul conectat are drept de citire. */
export async function listProperties(tenantId: string, deps: Deps = {}): Promise<string[]> {
	const api = await getApi(tenantId, deps);
	const res = await api.sites.list({}, { timeout: TIMEOUT_MS });
	return (res.data.siteEntry ?? [])
		.filter((s) => s.siteUrl && s.permissionLevel && s.permissionLevel !== 'siteUnverifiedUser')
		.map((s) => s.siteUrl as string);
}
