// Runner-ul de verificare a pozițiilor pentru UN proiect: interoghează providerul
// SERP pentru fiecare (keyword × device), face UPSERT pe snapshotul zilei (o linie
// per keyword/device/zi — istoricul nu se suprascrie între zile), scrie progresul în
// Redis, calculează agregatele rulării și persistă alertele. O eroare pe un keyword
// NU oprește restul cozii; blocarea Google oprește scraperul și, în modul 'auto',
// comută restul cozii pe providerul de rezervă.
import { env } from '$env/dynamic/private';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { rankProject, rankKeyword, rankSnapshot, rankRun, rankAlert } from '$lib/server/db/schema';
import { getRedis } from '$lib/server/redis';
import { logError, logInfo, serializeError } from '$lib/server/logger';
import { rankDayKey, parseLocale, visibility, pageForPosition, positionDelta } from '$lib/logic/rank-tracker';
import { pickTargetPosition, competitorPositions } from './providers/serp-parser';
import { resolveSerpProvider, shouldFailover, type ResolvedProviders } from './providers/resolve';
import { SerpProviderError, type SerpQuery } from './providers/types';
import { computeAlert } from './alerts';
import { SERP_DEPTH } from './config';

const PROGRESS_TTL_S = 30 * 60;
const FINAL_TTL_S = 20;

export interface RankRunProgress {
	runId: string;
	total: number;
	done: number;
	currentKeyword: string | null;
	startedAt: string;
	finishedAt?: string;
}

export interface RankRunSummary {
	runId: string | null;
	checked: number;
	failed: number;
	up: number;
	down: number;
	flat: number;
	alerts: number;
	status: 'ok' | 'partial' | 'interrupted';
	skipped: boolean;
}

export interface RankRunDeps {
	/** Providerii deja rezolvați (altfel se rezolvă din setările tenantului). */
	providers?: ResolvedProviders;
	sleep?: (ms: number) => Promise<void>;
	now?: () => Date;
}

export function rankRunProgressKey(tenantId: string, projectId: string): string {
	return `${tenantId}:rank:run:${projectId}`;
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface DeviceKeywordJob {
	keywordId: string;
	keyword: string;
	device: 'desktop' | 'mobile';
	location: string;
}

/** Rulează verificarea de poziții pentru un proiect. Idempotent la dublă lansare. */
export async function runRankProjectCheck(
	opts: {
		tenantId: string;
		projectId: string;
		trigger?: 'cron' | 'manual';
		triggeredBy?: string | null;
	},
	deps: RankRunDeps = {}
): Promise<RankRunSummary> {
	const sleep = deps.sleep ?? defaultSleep;
	const now = deps.now ?? (() => new Date());
	const redis = getRedis();
	const key = rankRunProgressKey(opts.tenantId, opts.projectId);

	const emptySummary = (status: RankRunSummary['status'] = 'ok'): RankRunSummary => ({
		runId: null,
		checked: 0,
		failed: 0,
		up: 0,
		down: 0,
		flat: 0,
		alerts: 0,
		status,
		skipped: true
	});

	// Guard: rulare deja activă pentru acest proiect.
	const existingRaw = await redis.get(key);
	if (existingRaw) {
		try {
			const existing = JSON.parse(existingRaw) as RankRunProgress;
			if (!existing.finishedAt) {
				logInfo('scheduler', `[rank] rulare deja activă pentru proiectul ${opts.projectId} — sărit`);
				return emptySummary();
			}
		} catch {
			/* stare coruptă — o suprascriem */
		}
	}

	const [project] = await db
		.select()
		.from(rankProject)
		.where(and(eq(rankProject.id, opts.projectId), eq(rankProject.tenantId, opts.tenantId)))
		.limit(1);
	if (!project || !project.active || project.pausedAt) return emptySummary();

	const keywords = await db
		.select()
		.from(rankKeyword)
		.where(and(eq(rankKeyword.projectId, project.id), eq(rankKeyword.active, true)));
	if (keywords.length === 0) return emptySummary();

	const { googleDomain, hl, gl } = parseLocale(project.locale);
	const devices = (project.devices as ('desktop' | 'mobile')[]).filter(
		(d) => d === 'desktop' || d === 'mobile'
	);
	const defaultLocation = (project.locations as string[])[0] ?? '';
	const competitors = project.competitors as string[];

	// Coada de lucru: fiecare keyword × fiecare device configurat.
	const jobs: DeviceKeywordJob[] = [];
	for (const kw of keywords) {
		for (const device of devices) {
			jobs.push({
				keywordId: kw.id,
				keyword: kw.keyword,
				device,
				location: kw.location || defaultLocation
			});
		}
	}

	// Baza de comparație: cel mai recent snapshot al fiecărui (keyword, device) DINAINTE
	// de ziua curentă → pentru delte și alerte.
	const todayKey = rankDayKey(now());
	const keywordIds = keywords.map((k) => k.id);
	const recent = keywordIds.length
		? await db
				.select({
					keywordId: rankSnapshot.keywordId,
					device: rankSnapshot.device,
					dayKey: rankSnapshot.dayKey,
					position: rankSnapshot.position
				})
				.from(rankSnapshot)
				.where(inArray(rankSnapshot.keywordId, keywordIds))
				.orderBy(desc(rankSnapshot.dayKey))
		: [];
	const baseline = new Map<string, number | null>(); // `${keywordId}:${device}` → poziția precedentă
	for (const s of recent) {
		if (s.dayKey >= todayKey) continue; // ignoră ziua curentă (re-rulare)
		const k = `${s.keywordId}:${s.device}`;
		if (!baseline.has(k)) baseline.set(k, s.position); // primul = cel mai recent (desc)
	}

	const providers = deps.providers ?? (await resolveSerpProvider(opts.tenantId));
	let activeProvider = providers.primary;
	let usingFallback = false;

	const runId = generateId();
	const startedAt = now();
	await db.insert(rankRun).values({
		id: runId,
		tenantId: opts.tenantId,
		projectId: project.id,
		dayKey: todayKey,
		trigger: opts.trigger ?? 'cron',
		triggeredBy: opts.triggeredBy ?? null,
		provider: activeProvider.name,
		startedAt,
		keywordsChecked: 0,
		status: 'running'
	});

	const progress: RankRunProgress = {
		runId,
		total: jobs.length,
		done: 0,
		currentKeyword: jobs[0]?.keyword ?? null,
		startedAt: startedAt.toISOString()
	};
	const writeProgress = async (ttl = PROGRESS_TTL_S) => {
		await redis.set(key, JSON.stringify(progress), 'EX', ttl);
	};
	await writeProgress();

	try {
	let checked = 0;
	let failed = 0;
	let up = 0;
	let down = 0;
	let flat = 0;
	const todayPositions: (number | null)[] = [];
	const alertRows: (typeof rankAlert.$inferInsert)[] = [];
	const failedNotes: string[] = [];
	let blocked = false;

	for (const job of jobs) {
		progress.currentKeyword = job.keyword;
		await writeProgress();

		const query: SerpQuery = {
			keyword: job.keyword,
			device: job.device,
			googleDomain,
			hl,
			gl,
			location: job.location,
			depth: SERP_DEPTH
		};

		// Failover pe rată de eșec (modul 'auto'), înainte de următoarea cerere.
		// Numitorul = ÎNCERCĂRI totale (succese + eșecuri), nu doar succesele — altfel
		// un scraper care eșuează la fiecare cerere n-ar atinge niciodată pragul.
		if (
			!usingFallback &&
			providers.fallback &&
			shouldFailover({ keywordsChecked: checked + failed, failed })
		) {
			activeProvider = providers.fallback;
			usingFallback = true;
			logInfo('scheduler', `[rank] failover pe DataForSEO (rată de eșec) — proiect ${project.id}`);
		}

		const measuredAt = now();
		try {
			let result;
			try {
				result = await activeProvider.fetchSerp(query, project.domain);
			} catch (e) {
				// Blocare Google: în 'auto' cu rezervă, comută și reîncearcă acest keyword.
				if (
					e instanceof SerpProviderError &&
					e.kind === 'blocked' &&
					providers.fallback &&
					!usingFallback
				) {
					activeProvider = providers.fallback;
					usingFallback = true;
					logInfo('scheduler', `[rank] blocat de Google — comut pe DataForSEO — proiect ${project.id}`);
					result = await activeProvider.fetchSerp(query, project.domain);
				} else {
					throw e;
				}
			}

			const position = pickTargetPosition(result.organic, project.domain);
			const nextPos = position;
			const prevPos = baseline.get(`${job.keywordId}:${job.device}`) ?? null;

			await db
				.insert(rankSnapshot)
				.values({
					id: generateId(),
					keywordId: job.keywordId,
					device: job.device,
					checkedAt: measuredAt,
					dayKey: todayKey,
					position: nextPos,
					page: pageForPosition(nextPos),
					rankingUrl: nextPos != null ? (result.organic.find((o) => o.position === nextPos)?.url ?? null) : null,
					serpFeatures: result.features,
					aiOverview: result.aiOverview,
					competitors: competitorPositions(result.organic, competitors),
					topResults: result.organic.slice(0, 10),
					provider: activeProvider.name,
					createdAt: measuredAt
				})
				.onConflictDoUpdate({
					target: [rankSnapshot.keywordId, rankSnapshot.device, rankSnapshot.dayKey],
					set: {
						checkedAt: measuredAt,
						position: nextPos,
						page: pageForPosition(nextPos),
						rankingUrl: nextPos != null ? (result.organic.find((o) => o.position === nextPos)?.url ?? null) : null,
						serpFeatures: result.features,
						aiOverview: result.aiOverview,
						competitors: competitorPositions(result.organic, competitors),
						topResults: result.organic.slice(0, 10),
						provider: activeProvider.name
					}
				});

			checked++;
			todayPositions.push(nextPos);

			const { kind } = positionDelta(prevPos, nextPos);
			if (kind === 'up') up++;
			else if (kind === 'down') down++;
			else if (kind === 'flat') flat++;

			const alert = computeAlert(prevPos, nextPos, project.alertThreshold);
			if (alert) {
				alertRows.push({
					id: generateId(),
					tenantId: opts.tenantId,
					keywordId: job.keywordId,
					runId,
					device: job.device,
					type: alert.type,
					delta: alert.delta,
					fromPosition: alert.fromPosition,
					toPosition: alert.toPosition,
					createdAt: measuredAt
				});
			}
		} catch (error) {
			failed++;
			const { message } = serializeError(error);
			if (error instanceof SerpProviderError && error.kind === 'blocked') {
				blocked = true;
				failedNotes.push(`blocat de Google la „${job.keyword}" (${job.device})`);
				logError('scheduler', `[rank] blocat — opresc rularea proiectului ${project.id}`);
				break; // nu insista pe scraper după o blocare
			}
			failedNotes.push(`„${job.keyword}" (${job.device}): ${message.slice(0, 120)}`);
			logError('scheduler', `[rank] verificare eșuată ${job.keyword} (${job.device}): ${message}`);
		}

		progress.done++;
		await writeProgress();
	}

	if (alertRows.length > 0) {
		await db.insert(rankAlert).values(alertRows);
	}

	const nonNull = todayPositions.filter((p): p is number => p != null);
	const avgPosition = nonNull.length ? nonNull.reduce((a, b) => a + b, 0) / nonNull.length : null;
	const vis = visibility(todayPositions);
	const status: RankRunSummary['status'] = failed > 0 || blocked ? 'partial' : 'ok';
	const finishedAt = now();

	await db
		.update(rankRun)
		.set({
			finishedAt,
			keywordsChecked: checked,
			up,
			down,
			flat,
			failed,
			avgPosition,
			visibility: vis,
			alerts: alertRows.length,
			status,
			errorNote: failedNotes.length ? failedNotes.join(' · ').slice(0, 500) : null,
			provider: activeProvider.name
		})
		.where(eq(rankRun.id, runId));

	progress.finishedAt = finishedAt.toISOString();
	progress.currentKeyword = null;
	await writeProgress(FINAL_TTL_S);

	logInfo(
		'scheduler',
		`[rank] proiect ${project.domain}: ${checked} verificate, ${failed} eșuate, ${up}↑ ${down}↓ ${flat}→, ${alertRows.length} alerte`
	);

	return { runId, checked, failed, up, down, flat, alerts: alertRows.length, status, skipped: false };
	} finally {
		// Închide browserul partajat al scraperului (dacă providerul îl deține).
		await providers.primary.close?.().catch(() => {});
		await providers.fallback?.close?.().catch(() => {});
	}
}

/** Starea curentă a rulării unui proiect (sau null). */
export async function getRankRunProgress(
	tenantId: string,
	projectId: string
): Promise<RankRunProgress | null> {
	const raw = await getRedis().get(rankRunProgressKey(tenantId, projectId));
	if (!raw) return null;
	try {
		return JSON.parse(raw) as RankRunProgress;
	} catch {
		return null;
	}
}
