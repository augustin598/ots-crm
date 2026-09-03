// Job orar: pentru fiecare tenant cu Rank Tracker activat a cărui oră de verificare
// se potrivește cu ora curentă din Europe/Bucharest, pune în coadă câte un job
// one-shot `rank_project_check` per proiect activ care NU a rulat deja azi.
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { rankSettings, rankProject, rankRun, rankKeyword } from '$lib/server/db/schema';
import { logInfo, serializeError, logWarning } from '$lib/server/logger';
import { getSchedulerQueue } from '$lib/server/scheduler';
import { rankDayKey } from '$lib/logic/rank-tracker';
import { planWindows } from '$lib/logic/scrape-engine';
import { loadEngineState } from '$lib/server/rank-tracker/engine-store';

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
	loadActiveProjects?: (tenantId: string) => Promise<{ id: string; queries?: number }[]>;
	hasRunToday?: (projectId: string, dayKey: string) => Promise<boolean>;
	enqueue?: (jobId: string, params: Record<string, unknown>, delayMs?: number) => Promise<void>;
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
	// Include numărul de interogări (cuvinte × dispozitive) — motorul planifică ferestrele
	// zilei din duratele estimate, deci un proiect mare împinge automat următoarele mai târziu.
	const projects = await db
		.select({ id: rankProject.id, devices: rankProject.devices })
		.from(rankProject)
		.where(and(eq(rankProject.tenantId, tenantId), eq(rankProject.active, true)));
	const counts = await db
		.select({ projectId: rankKeyword.projectId, id: rankKeyword.id })
		.from(rankKeyword)
		.where(eq(rankKeyword.active, true));
	const byProject = new Map<string, number>();
	for (const k of counts) byProject.set(k.projectId, (byProject.get(k.projectId) ?? 0) + 1);
	return projects.map((p) => ({
		id: p.id,
		queries: (byProject.get(p.id) ?? 0) * ((p.devices as string[]).length || 1)
	}));
}

async function defaultHasRunToday(projectId: string, dayKey: string): Promise<boolean> {
	// „a rulat azi" = există un run CRON finalizat (ok/partial) pe ziua curentă. DOAR cron:
	// o verificare manuală pe un singur cuvânt la miezul nopții nu e scanarea zilei și nu
	// trebuie s-o anuleze. Filtrăm statusul în SQL ca să nu depindem de ordinea rândurilor.
	const [row] = await db
		.select({ id: rankRun.id })
		.from(rankRun)
		.where(
			and(
				eq(rankRun.projectId, projectId),
				eq(rankRun.dayKey, dayKey),
				inArray(rankRun.status, ['ok', 'partial']),
				eq(rankRun.trigger, 'cron'))
		)
		.limit(1);
	return !!row;
}

async function defaultEnqueue(jobId: string, params: Record<string, unknown>, delayMs = 0) {
	await getSchedulerQueue().add(
		'rank-project-check',
		{ type: 'rank_project_check', params },
		{ jobId, delay: delayMs, attempts: 1, removeOnComplete: true, removeOnFail: true }
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
		// CATCH-UP, nu egalitate strictă: pe un laptop care doarme (sau după un restart de
		// prod), tick-ul de la ora exactă se pierde, iar cu `!==` scanarea zilei era sărită
		// COMPLET — măsurat pe 3 sep.: Mac adormit la 06:00 România, primul tick la 09:00,
		// „9 ≠ 6" → enqueued: 0. Acum: rulăm la prima ocazie DE LA ora setată încolo;
		// dublurile sunt oprite de jobId-ul pe zi + hasRunToday.
		if (Number.isNaN(settingHour) || hour < settingHour) continue;
		checkedTenants++;

		let projects: { id: string; queries?: number }[] = [];
		try {
			projects = await loadActiveProjects(s.tenantId);
		} catch (e) {
			logWarning('scheduler', `[rank] nu am putut încărca proiectele tenantului ${s.tenantId}: ${serializeError(e).message}`);
			continue;
		}

		// FERESTRE ORARE planificate de MOTOR: fiecare proiect pornește după durata
		// ESTIMATĂ a celui dinainte (funcție de numărul lui de cuvinte și de ritmul curent
		// al motorului) + gaura de răcire RANK_STAGGER_MINUTES (implicit 120 min), + 0-10
		// min aleator. Scalabil: 26 sau 200 de cuvinte — planul se întinde singur.
		const engState = await loadEngineState(now);
		const gapMs = (Number(process.env.RANK_STAGGER_MINUTES ?? 120) || 120) * 60_000;
		const plan = planWindows(projects.map((p) => p.queries ?? 0), engState, gapMs);
		let projectIndex = 0;
		for (const p of projects) {
			try {
				if (await hasRunToday(p.id, dayKey)) {
					projectIndex++;
					continue;
				}
				const delayMs =
					(plan.delaysMs[projectIndex] ?? 0) + Math.floor(Math.random() * 10 * 60_000);
				await enqueue(
					`rank-project-check-${p.id}-${dayKey}`,
					{
						tenantId: s.tenantId,
						projectId: p.id,
						trigger: 'cron'
					},
					delayMs
				);
				projectIndex++;
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
