import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';
import { serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Sondă operațională pentru Rank Tracker (admin-only, tenant-scoped).
 *   GET            — Chromium disponibil, pacing/proxy (doar count), integrare SERP
 *                    (existentă/activă/lastError — NICIODATĂ credențialele), ultimele rulări.
 *   GET ?probe=1   — un SERP real prin scraper pe example.com ca să valideze Chromium
 *                    și conectivitatea (durează ~10-30 s).
 * Credențialele nu apar niciodată în răspuns.
 */

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: Admin access required');
	return event.locals.tenant.id;
}

export const GET: RequestHandler = async (event) => {
	const tenantId = requireAdmin(event);

	let chromium: { ok: boolean; path?: string; error?: string };
	try {
		const { findChromePath } = await import('$lib/server/scraper/find-chrome');
		chromium = { ok: true, path: findChromePath() };
	} catch (e) {
		chromium = { ok: false, error: serializeError(e).message };
	}

	const proxies = (env.RANK_PROXY_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
	const [integration] = await db
		.select({
			isActive: table.serpIntegration.isActive,
			lastTestedAt: table.serpIntegration.lastTestedAt,
			lastError: table.serpIntegration.lastError
		})
		.from(table.serpIntegration)
		.where(eq(table.serpIntegration.tenantId, tenantId))
		.limit(1);

	const projectCount = (
		await db.select({ id: table.rankProject.id }).from(table.rankProject).where(eq(table.rankProject.tenantId, tenantId))
	).length;
	const lastRuns = await db
		.select({
			projectId: table.rankRun.projectId,
			status: table.rankRun.status,
			startedAt: table.rankRun.startedAt,
			keywordsChecked: table.rankRun.keywordsChecked,
			failed: table.rankRun.failed
		})
		.from(table.rankRun)
		.where(eq(table.rankRun.tenantId, tenantId))
		.orderBy(desc(table.rankRun.startedAt))
		.limit(5);

	const base = {
		chromium,
		paceMs: Number(env.RANK_PACE_MS ?? 8000) || 8000,
		proxyCount: proxies.length,
		maxKeywordsPerProject: Number(env.RANK_MAX_KEYWORDS_PER_PROJECT ?? 500) || 500,
		serpIntegration: integration
			? { configured: true, active: integration.isActive, lastTestedAt: integration.lastTestedAt, lastError: integration.lastError }
			: { configured: false },
		projectCount,
		lastRuns
	};

	if (event.url.searchParams.get('probe') !== '1') return json(base);

	// Probă reală prin scraper.
	const start = Date.now();
	try {
		const { fetchSerpScraper } = await import('$lib/server/rank-tracker/providers/serp-scraper');
		const result = await fetchSerpScraper(
			{ keyword: 'example domain', device: 'desktop', googleDomain: 'google.com', hl: 'en', gl: 'us', location: '', depth: 100 },
			'example.com'
		);
		return json({ ...base, probe: { ok: true, ms: Date.now() - start, organic: result.organic.length, features: result.features } });
	} catch (e) {
		const err = e as { kind?: string; message?: string };
		return json({ ...base, probe: { ok: false, ms: Date.now() - start, kind: err.kind ?? 'unknown', error: serializeError(e).message } });
	}
};
