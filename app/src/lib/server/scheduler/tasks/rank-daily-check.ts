// Job orar: pentru fiecare tenant cu Rank Tracker activat a cărui oră de verificare
// se potrivește cu ora curentă din Europe/Bucharest, pune în coadă câte un job
// one-shot `rank_project_check` per proiect activ care NU a rulat deja azi.
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { rankSettings, rankProject, rankRun } from '$lib/server/db/schema';
import { logInfo, serializeError, logWarning } from '$lib/server/logger';
import { getSchedulerQueue } from '$lib/server/scheduler';
import { rankDayKey } from '$lib/logic/rank-tracker';

const BUCHAREST_TZ = 'Europe/Bucharest';

function bucharestHour(d: Date): number {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: BUCHAREST_TZ,
		hour: 'numeric',
		hourCycle: 'h23'
	}).formatToParts(d);
	return Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
}

export interface RankDailyDeps {
	loadEnabledSettings?: () => Promise<{ tenantId: string; checkHour: string }[]>;
	loadActiveProjects?: (tenantId: string) => Promise<{ id: string }[]>;
	hasRunToday?: (projectId: string, dayKey: string) => Promise<boolean>;
	enqueue?: (jobId: string, params: Record<string, unknown>) => Promise<void>;
}

export interface RankDailyResult {
	checkedTenants: number;
	enqueued: number;
}

async function defaultLoadEnabledSettings() {
	return db
		.select({ tenantId: rankSettings.tenantId, checkHour: rankSettings.checkHour })
		.from(rankSettings)
		.where(eq(rankSettings.isEnabled, true));
}

async function defaultLoadActiveProjects(tenantId: string) {
	return db
		.select({ id: rankProject.id })
		.from(rankProject)
		.where(and(eq(rankProject.tenantId, tenantId), eq(rankProject.active, true)));
}

async function defaultHasRunToday(projectId: string, dayKey: string): Promise<boolean> {
	// „a rulat azi" = există un run FINALIZAT (ok/partial) pe ziua curentă. Filtrăm statusul
	// în SQL ca să nu depindem de ordinea rândurilor (un run 'running'/'interrupted' anterior
	// nu trebuie să blocheze o verificare nouă).
	const [row] = await db
		.select({ id: rankRun.id })
		.from(rankRun)
		.where(
			and(
				eq(rankRun.projectId, projectId),
				eq(rankRun.dayKey, dayKey),
				inArray(rankRun.status, ['ok', 'partial'])
			)
		)
		.limit(1);
	return !!row;
}

async function defaultEnqueue(jobId: string, params: Record<string, unknown>) {
	await getSchedulerQueue().add(
		'rank-project-check',
		{ type: 'rank_project_check', params },
		{ jobId, attempts: 1, removeOnComplete: true, removeOnFail: true }
	);
}

/** Verifică ce tenanți sunt „la ora lor" și pune proiectele lor în coadă. */
export async function processRankDailyCheck(
	now: Date = new Date(),
	deps: RankDailyDeps = {}
): Promise<RankDailyResult> {
	const loadEnabledSettings = deps.loadEnabledSettings ?? defaultLoadEnabledSettings;
	const loadActiveProjects = deps.loadActiveProjects ?? defaultLoadActiveProjects;
	const hasRunToday = deps.hasRunToday ?? defaultHasRunToday;
	const enqueue = deps.enqueue ?? defaultEnqueue;

	const hour = bucharestHour(now);
	const dayKey = rankDayKey(now);
	const settings = await loadEnabledSettings();

	let checkedTenants = 0;
	let enqueued = 0;

	for (const s of settings) {
		const settingHour = Number(String(s.checkHour).split(':')[0]);
		if (Number.isNaN(settingHour) || settingHour !== hour) continue;
		checkedTenants++;

		let projects: { id: string }[] = [];
		try {
			projects = await loadActiveProjects(s.tenantId);
		} catch (e) {
			logWarning('scheduler', `[rank] nu am putut încărca proiectele tenantului ${s.tenantId}: ${serializeError(e).message}`);
			continue;
		}

		for (const p of projects) {
			try {
				if (await hasRunToday(p.id, dayKey)) continue;
				await enqueue(`rank-project-check-${p.id}-${dayKey}`, {
					tenantId: s.tenantId,
					projectId: p.id,
					trigger: 'cron'
				});
				enqueued++;
			} catch (e) {
				logWarning('scheduler', `[rank] enqueue eșuat pentru proiectul ${p.id}: ${serializeError(e).message}`);
			}
		}
	}

	if (enqueued > 0) {
		logInfo('scheduler', `[rank] verificare zilnică: ${enqueued} proiecte puse în coadă (${checkedTenants} tenanți la ora ${hour})`);
	}
	return { checkedTenants, enqueued };
}
