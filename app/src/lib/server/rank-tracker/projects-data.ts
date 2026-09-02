// Read model partajat de remote-ul admin și de pagina din portalul clientului.
// `clientId` (portal) intră în WHERE-ul SQL — niciodată filtrare în JS. Agregatele
// (vizibilitate, delte, distribuție, canibalizare) folosesc logica pură din $lib/logic.
import { and, desc, eq, inArray, gte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { SERP_DEPTH } from './config';
import * as table from '$lib/server/db/schema';
import {
	visibility,
	positionDelta,
	snapshotAtLookback,
	bestPosition,
	detectCannibalization,
	pageForPosition,
	rankDayKey,
	type RankBucket
} from '$lib/logic/rank-tracker';

export interface RankProjectsOptions {
	clientId?: string | null;
}

export interface RankProjectListRow {
	id: string;
	name: string;
	domain: string;
	clientName: string | null;
	keywordCount: number;
	avgPosition: number | null;
	visibility: number;
	deltaVisibility: number | null;
	distribution: Record<RankBucket, number>;
	lastRunAt: string | null;
	lastRunStatus: string | null;
	lastRunUp: number | null;
	lastRunDown: number | null;
	alertsLast7d: number;
	active: boolean;
	paused: boolean;
}

export interface RankProjectsData {
	projects: RankProjectListRow[];
	totals: {
		projectCount: number;
		keywordCount: number;
		avgVisibility: number;
		alertsLast7d: number;
	};
	/** Ultimele 30 de zile pentru graficul de portofoliu din hub (dispozitivul principal). */
	trend: { days: string[]; visibility: (number | null)[]; avgPosition: (number | null)[] };
}

const DAY_MS = 86_400_000;

function daysAgoKey(now: Date, days: number): string {
	return rankDayKey(new Date(now.getTime() - days * DAY_MS));
}

/** Lista proiectelor unui tenant (opțional scop-uită pe un client) + agregate. */
export async function buildRankProjects(
	tenantId: string,
	opts: RankProjectsOptions = {},
	now: Date = new Date()
): Promise<RankProjectsData> {
	const projConds = [eq(table.rankProject.tenantId, tenantId)];
	if (opts.clientId) projConds.push(eq(table.rankProject.clientId, opts.clientId));

	const projects = await db
		.select({
			id: table.rankProject.id,
			name: table.rankProject.name,
			domain: table.rankProject.domain,
			devices: table.rankProject.devices,
			active: table.rankProject.active,
			pausedAt: table.rankProject.pausedAt,
			clientName: table.client.name
		})
		.from(table.rankProject)
		.leftJoin(
			table.client,
			and(eq(table.rankProject.clientId, table.client.id), eq(table.client.tenantId, tenantId))
		)
		.where(and(...projConds))
		.orderBy(table.rankProject.domain);

	const projectIds = projects.map((p) => p.id);
	const keywords = projectIds.length
		? await db
				.select({ id: table.rankKeyword.id, projectId: table.rankKeyword.projectId })
				.from(table.rankKeyword)
				.where(and(inArray(table.rankKeyword.projectId, projectIds), eq(table.rankKeyword.active, true)))
		: [];

	const keywordIds = keywords.map((k) => k.id);
	const snapshots = keywordIds.length
		? await db
				.select({
					keywordId: table.rankSnapshot.keywordId,
					projectId: table.rankKeyword.projectId,
					device: table.rankSnapshot.device,
					dayKey: table.rankSnapshot.dayKey,
					position: table.rankSnapshot.position
				})
				.from(table.rankSnapshot)
				.innerJoin(table.rankKeyword, eq(table.rankSnapshot.keywordId, table.rankKeyword.id))
				.where(inArray(table.rankSnapshot.keywordId, keywordIds))
				.orderBy(desc(table.rankSnapshot.dayKey))
		: [];

	// Ultima rulare per proiect.
	const runs = projectIds.length
		? await db
				.select({
					projectId: table.rankRun.projectId,
					startedAt: table.rankRun.startedAt,
					status: table.rankRun.status,
					up: table.rankRun.up,
					down: table.rankRun.down
				})
				.from(table.rankRun)
				.where(inArray(table.rankRun.projectId, projectIds))
				.orderBy(desc(table.rankRun.startedAt))
		: [];
	const lastRunByProject = new Map<string, { startedAt: Date; status: string; up: number; down: number }>();
	for (const r of runs) if (!lastRunByProject.has(r.projectId)) lastRunByProject.set(r.projectId, r);

	// Alerte din ultimele 7 zile per proiect (alert → run → project).
	const since7 = new Date(now.getTime() - 7 * DAY_MS);
	const alerts = projectIds.length
		? await db
				.select({ projectId: table.rankRun.projectId })
				.from(table.rankAlert)
				.innerJoin(table.rankRun, eq(table.rankAlert.runId, table.rankRun.id))
				.where(and(inArray(table.rankRun.projectId, projectIds), gte(table.rankAlert.createdAt, since7)))
		: [];
	const alertsByProject = new Map<string, number>();
	for (const a of alerts) alertsByProject.set(a.projectId, (alertsByProject.get(a.projectId) ?? 0) + 1);

	const todayKey = rankDayKey(now);
	const keywordCountByProject = new Map<string, number>();
	for (const k of keywords) keywordCountByProject.set(k.projectId, (keywordCountByProject.get(k.projectId) ?? 0) + 1);

	// Serie per (keyword, device); agregatele folosesc dispozitivul principal al proiectului.
	const seriesByKeyword = new Map<string, { dayKey: string; position: number | null }[]>();
	for (const s of snapshots) {
		const key = `${s.keywordId}:${s.device}`;
		const arr = seriesByKeyword.get(key) ?? [];
		arr.push({ dayKey: s.dayKey, position: s.position });
		seriesByKeyword.set(key, arr);
	}

	// Ultimele 30 de zile calendaristice pentru graficul de portofoliu.
	const trendDays: string[] = [];
	for (let i = 29; i >= 0; i--) trendDays.push(daysAgoKey(now, i));
	const trendDaySet = new Set(trendDays);
	const perDayPositions = new Map<string, (number | null)[]>();

	const rows: RankProjectListRow[] = projects.map((p) => {
		const projKeywords = keywords.filter((k) => k.projectId === p.id);
		const trackedDevices = p.devices as ('desktop' | 'mobile')[];
		const primaryDevice = trackedDevices.includes('desktop') ? 'desktop' : (trackedDevices[0] ?? 'desktop');
		const nowPositions: (number | null)[] = [];
		const thenPositions: (number | null)[] = [];
		const dist: Record<RankBucket, number> = { '1-3': 0, '4-10': 0, '11-20': 0, '21-50': 0, '51-100': 0, '100+': 0 };
		for (const kw of projKeywords) {
			const series = (seriesByKeyword.get(`${kw.id}:${primaryDevice}`) ?? []).filter((s) => s.dayKey <= todayKey);
			const nowPos = series[0]?.position ?? null;
			const then = snapshotAtLookback(series, todayKey, 7, 3);
			nowPositions.push(nowPos);
			thenPositions.push(then?.position ?? null);
			dist[bucketFor(nowPos)]++;
			if (p.active && !p.pausedAt) {
				for (const s of series) {
					if (!trendDaySet.has(s.dayKey)) continue;
					const arr = perDayPositions.get(s.dayKey) ?? [];
					arr.push(s.position); // include null (neclasat) — numitor corect al vizibilității
					perDayPositions.set(s.dayKey, arr);
				}
			}
		}
		const nums = nowPositions.filter((x): x is number => x != null);
		const vis = visibility(nowPositions);
		const thenVis = visibility(thenPositions);
		const lastRun = lastRunByProject.get(p.id);
		return {
			id: p.id,
			name: p.name,
			domain: p.domain,
			clientName: p.clientName,
			keywordCount: keywordCountByProject.get(p.id) ?? 0,
			avgPosition: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null,
			visibility: vis,
			deltaVisibility: nowPositions.length ? Math.round((vis - thenVis) * 10) / 10 : null,
			distribution: dist,
			lastRunAt: lastRun?.startedAt?.toISOString() ?? null,
			lastRunStatus: lastRun?.status ?? null,
			lastRunUp: lastRun?.up ?? null,
			lastRunDown: lastRun?.down ?? null,
			alertsLast7d: alertsByProject.get(p.id) ?? 0,
			active: p.active,
			paused: !!p.pausedAt
		};
	});

	const activeRows = rows.filter((r) => r.active && !r.paused);
	const avgVis = activeRows.length
		? Math.round((activeRows.reduce((a, r) => a + r.visibility, 0) / activeRows.length) * 10) / 10
		: 0;

	return {
		projects: rows,
		totals: {
			projectCount: rows.filter((r) => r.active).length,
			keywordCount: keywords.length,
			avgVisibility: avgVis,
			alertsLast7d: rows.reduce((a, r) => a + r.alertsLast7d, 0)
		},
		trend: {
			days: trendDays,
			visibility: trendDays.map((d) => {
				const positions = perDayPositions.get(d);
				return positions && positions.length ? visibility(positions) : null;
			}),
			avgPosition: trendDays.map((d) => {
				const nums = (perDayPositions.get(d) ?? []).filter((x): x is number => x != null);
				if (!nums.length) return null;
				return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
			})
		}
	};
}

function bucketFor(pos: number | null): RankBucket {
	if (pos == null || pos > 100) return '100+';
	if (pos <= 3) return '1-3';
	if (pos <= 10) return '4-10';
	if (pos <= 20) return '11-20';
	if (pos <= 50) return '21-50';
	return '51-100';
}

export interface RankKeywordDetail {
	id: string;
	keyword: string;
	tag: string | null;
	location: string;
	volume: number | null;
	targetUrl: string | null;
	device: 'desktop' | 'mobile';
	position: number | null;
	page: number | null;
	rankingUrl: string | null;
	delta1: number | null;
	delta7: number | null;
	delta30: number | null;
	best: number | null;
	features: string[];
	aiOverview: 'absent' | 'present' | 'cited';
	spark30: (number | null)[];
	/**
	 * Paralel cu `spark30`: `true` = în ziua aia CHIAR s-a rulat. Fără el, `null` din
	 * `spark30` însemna deopotrivă „n-am rulat" și „am rulat și nu era clasat", iar UI-ul
	 * desena zilele dinaintea primei rulări ca „în afara top 100".
	 */
	checked30: boolean[];
	competitors: Record<string, number>;
	cannibalization: { flagged: boolean; urls: string[] };
}

export interface RankProjectDetailData {
	id: string;
	name: string;
	domain: string;
	locale: string;
	locations: string[];
	competitors: string[];
	devices: ('desktop' | 'mobile')[];
	alertThreshold: number;
	clientId: string | null;
	clientName: string | null;
	active: boolean;
	paused: boolean;
	visibility: number;
	avgPosition: number | null;
	distribution: Record<RankBucket, number>;
	aiPresent: number;
	aiCited: number;
	keywords: RankKeywordDetail[];
	trend: { days: string[]; visibility: (number | null)[]; avgPosition: (number | null)[] };
	/**
	 * Câte poziții s-au căutat efectiv. UI-ul trebuie să spună „peste 30", nu „100+",
	 * când un cuvânt nu a fost găsit — altfel afirmăm ceva ce nu am verificat.
	 */
	searchDepth: number;
	runs: { id: string; startedAt: string; finishedAt: string | null; status: string; keywordsChecked: number; up: number; down: number; flat: number; failed: number; trigger: string }[];
	shareOfVoice: Record<string, number>;
}

/** Detaliul unui proiect (drawer + grafic), scop-uit pe tenant (și opțional client). */
export async function buildRankProjectDetail(
	tenantId: string,
	projectId: string,
	opts: RankProjectsOptions = {},
	now: Date = new Date()
): Promise<RankProjectDetailData | null> {
	const projConds = [eq(table.rankProject.id, projectId), eq(table.rankProject.tenantId, tenantId)];
	if (opts.clientId) projConds.push(eq(table.rankProject.clientId, opts.clientId));

	const [project] = await db
		.select({
			id: table.rankProject.id,
			name: table.rankProject.name,
			domain: table.rankProject.domain,
			locale: table.rankProject.locale,
			locations: table.rankProject.locations,
			competitors: table.rankProject.competitors,
			devices: table.rankProject.devices,
			alertThreshold: table.rankProject.alertThreshold,
			active: table.rankProject.active,
			pausedAt: table.rankProject.pausedAt,
			clientId: table.rankProject.clientId,
			clientName: table.client.name
		})
		.from(table.rankProject)
		.leftJoin(
			table.client,
			and(eq(table.rankProject.clientId, table.client.id), eq(table.client.tenantId, tenantId))
		)
		.where(and(...projConds))
		.limit(1);
	if (!project) return null;

	const keywords = await db
		.select()
		.from(table.rankKeyword)
		.where(and(eq(table.rankKeyword.projectId, projectId), eq(table.rankKeyword.active, true)));

	const keywordIds = keywords.map((k) => k.id);
	// Fereastra de fetch trebuie să acopere lookback-ul delta30 (30 + toleranță 5) + slack DST.
	const since30 = new Date(now.getTime() - 36 * DAY_MS);
	const snapshots = keywordIds.length
		? await db
				.select({
					keywordId: table.rankSnapshot.keywordId,
					device: table.rankSnapshot.device,
					dayKey: table.rankSnapshot.dayKey,
					position: table.rankSnapshot.position,
					rankingUrl: table.rankSnapshot.rankingUrl,
					serpFeatures: table.rankSnapshot.serpFeatures,
					aiOverview: table.rankSnapshot.aiOverview,
					competitors: table.rankSnapshot.competitors
				})
				.from(table.rankSnapshot)
				.where(and(inArray(table.rankSnapshot.keywordId, keywordIds), gte(table.rankSnapshot.checkedAt, since30)))
				.orderBy(desc(table.rankSnapshot.dayKey))
		: [];

	const todayKey = rankDayKey(now);
	// Ultimele 30 de zile calendaristice (chei) pentru grafic + spark.
	const days: string[] = [];
	for (let i = 29; i >= 0; i--) days.push(daysAgoKey(now, i));

	type Snap = (typeof snapshots)[number];
	const byKwDevice = new Map<string, Snap[]>();
	for (const s of snapshots) {
		const k = `${s.keywordId}:${s.device}`;
		const arr = byKwDevice.get(k) ?? [];
		arr.push(s);
		byKwDevice.set(k, arr);
	}

	const detailKeywords: RankKeywordDetail[] = [];
	const dist: Record<RankBucket, number> = { '1-3': 0, '4-10': 0, '11-20': 0, '21-50': 0, '51-100': 0, '100+': 0 };
	// Dispozitivul principal pentru agregatele „headline" = desktop dacă e urmărit, altfel
	// mobil (un proiect doar-mobil nu trebuie să raporteze vizibilitate 0).
	const trackedDevices = project.devices as ('desktop' | 'mobile')[];
	const primaryDevice: 'desktop' | 'mobile' = trackedDevices.includes('desktop') ? 'desktop' : 'mobile';
	const primaryNow: (number | null)[] = [];
	let aiPresent = 0;
	let aiCited = 0;
	// Serii pentru graficul de trend: vizibilitate + poziție medie pe dispozitivul principal.
	// Include nulurile (unranked) în numitor, ca vizibilitatea zilei să nu fie umflată.
	const perDayPositions = new Map<string, (number | null)[]>();
	const sov: Record<string, number[]> = {};

	for (const kw of keywords) {
		for (const device of ['desktop', 'mobile'] as const) {
			const series = (byKwDevice.get(`${kw.id}:${device}`) ?? []).filter((s) => s.dayKey <= todayKey);
			if (series.length === 0 && !trackedDevices.includes(device)) {
				continue;
			}
			const nowSnap = series[0] ?? null;
			const nowPos = nowSnap?.position ?? null;
			const seriesLite = series.map((s) => ({ dayKey: s.dayKey, position: s.position }));
			const d1 = snapshotAtLookback(seriesLite, todayKey, 1, 2)?.position ?? null;
			const d7 = snapshotAtLookback(seriesLite, todayKey, 7, 3)?.position ?? null;
			const d30 = snapshotAtLookback(seriesLite, todayKey, 30, 5)?.position ?? null;
			const posByDay = new Map(series.map((s) => [s.dayKey, s.position]));
			const spark30 = days.map((d) => (posByDay.has(d) ? posByDay.get(d)! : null));
			const checked30 = days.map((d) => posByDay.has(d));

			if (device === primaryDevice) {
				primaryNow.push(nowPos);
				dist[bucketFor(nowPos)]++;
				if (nowSnap?.aiOverview === 'present' || nowSnap?.aiOverview === 'cited') aiPresent++;
				if (nowSnap?.aiOverview === 'cited') aiCited++;
				for (const s of series) {
					const arr = perDayPositions.get(s.dayKey) ?? [];
					arr.push(s.position); // include null (unranked) — numitor corect al vizibilității
					perDayPositions.set(s.dayKey, arr);
				}
				const comp = (nowSnap?.competitors ?? {}) as Record<string, number>;
				for (const [dom, pos] of Object.entries(comp)) {
					(sov[dom] ??= []).push(pos);
				}
			}

			detailKeywords.push({
				id: kw.id,
				keyword: kw.keyword,
				tag: kw.tag,
				location: kw.location,
				volume: kw.volume,
				targetUrl: kw.targetUrl,
				device,
				position: nowPos,
				page: pageForPosition(nowPos),
				rankingUrl: nowSnap?.rankingUrl ?? null,
				delta1: positionDelta(d1, nowPos).delta,
				delta7: positionDelta(d7, nowPos).delta,
				delta30: positionDelta(d30, nowPos).delta,
				best: bestPosition(series.map((s) => s.position)),
				features: (nowSnap?.serpFeatures ?? []) as string[],
				aiOverview: (nowSnap?.aiOverview ?? 'absent') as 'absent' | 'present' | 'cited',
				spark30,
				checked30,
				competitors: (nowSnap?.competitors ?? {}) as Record<string, number>,
				cannibalization: detectCannibalization(
					series.map((s) => ({ dayKey: s.dayKey, rankingUrl: s.rankingUrl }))
				)
			});
		}
	}

	const trendVis = days.map((d) => {
		const positions = perDayPositions.get(d);
		return positions && positions.length ? visibility(positions) : null;
	});
	const trendAvg = days.map((d) => {
		const nums = (perDayPositions.get(d) ?? []).filter((p): p is number => p != null);
		if (!nums.length) return null;
		return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
	});

	const runs = await db
		.select({
			id: table.rankRun.id,
			startedAt: table.rankRun.startedAt,
			finishedAt: table.rankRun.finishedAt,
			status: table.rankRun.status,
			keywordsChecked: table.rankRun.keywordsChecked,
			up: table.rankRun.up,
			down: table.rankRun.down,
			flat: table.rankRun.flat,
			failed: table.rankRun.failed,
			trigger: table.rankRun.trigger
		})
		.from(table.rankRun)
		.where(eq(table.rankRun.projectId, projectId))
		.orderBy(desc(table.rankRun.startedAt))
		.limit(15);

	const nums = primaryNow.filter((x): x is number => x != null);
	const shareOfVoice: Record<string, number> = {};
	const kwCount = keywords.length || 1;
	for (const [dom, positions] of Object.entries(sov)) {
		// completează cu null pentru keyword-urile fără competitorul respectiv
		const padded = [...positions, ...Array(Math.max(0, kwCount - positions.length)).fill(null)];
		shareOfVoice[dom] = visibility(padded);
	}

	return {
		id: project.id,
		name: project.name,
		domain: project.domain,
		locale: project.locale,
		locations: project.locations as string[],
		competitors: project.competitors as string[],
		devices: project.devices as ('desktop' | 'mobile')[],
		alertThreshold: project.alertThreshold,
		clientId: project.clientId,
		clientName: project.clientName,
		active: project.active,
		paused: !!project.pausedAt,
		visibility: visibility(primaryNow),
		avgPosition: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null,
		distribution: dist,
		aiPresent,
		aiCited,
		keywords: detailKeywords,
		trend: { days, visibility: trendVis, avgPosition: trendAvg },
		searchDepth: SERP_DEPTH,
		runs: runs.map((r) => ({
			id: r.id,
			startedAt: r.startedAt.toISOString(),
			finishedAt: r.finishedAt?.toISOString() ?? null,
			status: r.status,
			keywordsChecked: r.keywordsChecked,
			up: r.up,
			down: r.down,
			flat: r.flat,
			failed: r.failed,
			trigger: r.trigger
		})),
		shareOfVoice
	};
}
