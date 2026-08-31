// Procesor de scanare PageSpeed: interoghează PSI secvențial (max 1 cerere/secundă —
// cota implicită Google), scrie măsurători în DB și progresul în Redis, ca UI-ul să
// poată afișa starea de pe orice instanță. O eroare pe un site NU oprește restul cozii.
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { pagespeedMeasurement, pagespeedSite } from '$lib/server/db/schema';
import { getRedis } from '$lib/server/redis';
import { logError, logInfo, serializeError } from '$lib/server/logger';
import { isoWeekKey, type PsiStrategy } from '$lib/logic/pagespeed';
import { fetchPagespeed, type PsiResult } from './client';

const PACE_MS = 1100; // puțin peste 1 s, ca să nu atingem niciodată 1 rps exact
const PROGRESS_TTL_S = 15 * 60;
const FINAL_TTL_S = 20; // starea finală rămâne scurt, pentru ultimul poll al UI-ului

export interface ScanProgress {
	scanId: string;
	total: number;
	done: number;
	current: string | null;
	perSite: Record<string, 'running' | 'done' | 'failed'>;
	startedAt: string;
	finishedAt?: string;
}

export interface ScanSummary {
	scanned: number;
	failed: number;
	skipped: boolean;
}

export function scanProgressKey(tenantId: string): string {
	return `pagespeed:scan:${tenantId}`;
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

type ScanDeps = {
	fetchPsi?: (url: string, strategy: PsiStrategy) => Promise<PsiResult>;
	sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Scanează site-urile tenantului (toate cele active sau doar `siteIds`) pe fiecare
 * strategie configurată a site-ului. Idempotent la dublă lansare: dacă există deja
 * un scan activ pentru tenant (cheie Redis fără `finishedAt`), iese cu `skipped`.
 */
export async function runPagespeedScan(
	opts: { tenantId: string; siteIds?: string[] },
	deps: ScanDeps = {}
): Promise<ScanSummary> {
	const fetchPsi = deps.fetchPsi ?? ((url: string, strategy: PsiStrategy) => fetchPagespeed(url, strategy));
	const sleep = deps.sleep ?? defaultSleep;
	const redis = getRedis();
	const key = scanProgressKey(opts.tenantId);

	const existingRaw = await redis.get(key);
	if (existingRaw) {
		try {
			const existing = JSON.parse(existingRaw) as ScanProgress;
			if (!existing.finishedAt) {
				logInfo('scheduler', `[pagespeed] scan deja activ pentru tenant ${opts.tenantId} — sărit`);
				return { scanned: 0, failed: 0, skipped: true };
			}
		} catch {
			// stare coruptă — o suprascriem cu scanul nou
		}
	}

	const conditions = [eq(pagespeedSite.tenantId, opts.tenantId)];
	if (opts.siteIds?.length) {
		conditions.push(inArray(pagespeedSite.id, opts.siteIds));
	} else {
		conditions.push(eq(pagespeedSite.active, true));
	}
	const sites = await db.select().from(pagespeedSite).where(and(...conditions));

	const work = sites
		.map((site) => ({
			site,
			url: (site.pages as { url: string; label: string }[])[0]?.url ?? null,
			strategies: (site.strategies as PsiStrategy[]).filter(
				(s) => s === 'mobile' || s === 'desktop'
			)
		}))
		.filter((w) => w.url && w.strategies.length > 0);

	const progress: ScanProgress = {
		scanId: generateId(),
		total: work.length,
		done: 0,
		current: work[0]?.site.domain ?? null,
		perSite: {},
		startedAt: new Date().toISOString()
	};
	const writeProgress = async (ttl = PROGRESS_TTL_S) => {
		await redis.set(key, JSON.stringify(progress), 'EX', ttl);
	};
	await writeProgress();

	let scanned = 0;
	let failed = 0;
	let firstRequest = true;

	for (const { site, url, strategies } of work) {
		progress.current = site.domain;
		progress.perSite[site.id] = 'running';
		await writeProgress();

		let siteFailed = false;
		for (const strategy of strategies) {
			if (!firstRequest) await sleep(PACE_MS);
			firstRequest = false;
			const measuredAt = new Date();
			try {
				const result = await fetchPsi(url!, strategy);
				await db.insert(pagespeedMeasurement).values({
					id: generateId(),
					siteId: site.id,
					strategy,
					measuredAt,
					weekKey: isoWeekKey(measuredAt),
					status: 'ok',
					errorMessage: null,
					performance: result.performance,
					accessibility: result.accessibility,
					bestPractices: result.bestPractices,
					seo: result.seo,
					lcpMs: result.lcpMs,
					cls: result.cls,
					tbtMs: result.tbtMs,
					fcpMs: result.fcpMs,
					speedIndexMs: result.speedIndexMs,
					inpMs: result.inpMs,
					ttfbMs: result.ttfbMs,
					totalBytes: result.totalBytes,
					requestCount: result.requestCount,
					fieldLcpMs: result.fieldLcpMs,
					fieldInpMs: result.fieldInpMs,
					fieldCls: result.fieldCls,
					fieldSampleCount: null,
					opportunities: result.opportunities,
					createdAt: measuredAt
				});
				scanned++;
			} catch (error) {
				siteFailed = true;
				failed++;
				const { message } = serializeError(error);
				logError('scheduler', `[pagespeed] măsurătoare eșuată ${site.domain} (${strategy}): ${message}`);
				await db.insert(pagespeedMeasurement).values({
					id: generateId(),
					siteId: site.id,
					strategy,
					measuredAt,
					weekKey: isoWeekKey(measuredAt),
					status: 'failed',
					errorMessage: message.slice(0, 500),
					performance: null,
					accessibility: null,
					bestPractices: null,
					seo: null,
					lcpMs: null,
					cls: null,
					tbtMs: null,
					fcpMs: null,
					speedIndexMs: null,
					inpMs: null,
					ttfbMs: null,
					totalBytes: null,
					requestCount: null,
					fieldLcpMs: null,
					fieldInpMs: null,
					fieldCls: null,
					fieldSampleCount: null,
					opportunities: null,
					createdAt: measuredAt
				});
			}
		}

		progress.done++;
		progress.perSite[site.id] = siteFailed ? 'failed' : 'done';
		await writeProgress();
	}

	progress.finishedAt = new Date().toISOString();
	progress.current = null;
	await writeProgress(FINAL_TTL_S);

	logInfo(
		'scheduler',
		`[pagespeed] scan tenant ${opts.tenantId}: ${scanned} măsurători ok, ${failed} eșuate, ${work.length} site-uri`
	);
	return { scanned, failed, skipped: false };
}

/** Starea curentă a scanării (sau null dacă nu rulează nimic). */
export async function getScanProgress(tenantId: string): Promise<ScanProgress | null> {
	const raw = await getRedis().get(scanProgressKey(tenantId));
	if (!raw) return null;
	try {
		return JSON.parse(raw) as ScanProgress;
	} catch {
		return null;
	}
}
