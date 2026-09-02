// Handler BullMQ one-shot pentru verificarea unui singur proiect. Deleagă la
// runner și, dacă rularea a produs alerte, trimite emailul de alerte (dacă e activat).
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { rankSettings } from '$lib/server/db/schema';
import { logError, serializeError } from '$lib/server/logger';
import { runRankProjectCheck, type RankRunSummary } from '$lib/server/rank-tracker/run';
import { getSchedulerQueue } from '$lib/server/scheduler';
import { logInfo } from '$lib/server/logger';

export interface RankProjectCheckDeps {
	run?: typeof runRankProjectCheck;
	sendAlerts?: (tenantId: string, projectId: string, runId: string) => Promise<void>;
	alertsEnabled?: (tenantId: string) => Promise<boolean>;
	/** Re-programarea jobului după cooldown-ul motorului — injectabil în teste. */
	reenqueue?: (params: Record<string, unknown>, delayMs: number) => Promise<void>;
}

async function defaultAlertsEnabled(tenantId: string): Promise<boolean> {
	const [row] = await db
		.select({ alertsEnabled: rankSettings.alertsEnabled })
		.from(rankSettings)
		.where(eq(rankSettings.tenantId, tenantId))
		.limit(1);
	return row?.alertsEnabled ?? true;
}

async function defaultSendAlerts(tenantId: string, projectId: string, runId: string): Promise<void> {
	const { sendRankAlertsForRun } = await import('$lib/server/rank-tracker/report');
	await sendRankAlertsForRun(tenantId, projectId, runId);
}

export async function processRankProjectCheck(
	params: Record<string, unknown>,
	deps: RankProjectCheckDeps = {}
): Promise<RankRunSummary | { skipped: true; reason: string }> {
	const tenantId = typeof params.tenantId === 'string' ? params.tenantId : '';
	const projectId = typeof params.projectId === 'string' ? params.projectId : '';
	if (!tenantId || !projectId) {
		return { skipped: true, reason: 'tenantId/projectId lipsă' };
	}

	const run = deps.run ?? runRankProjectCheck;
	const alertsEnabled = deps.alertsEnabled ?? defaultAlertsEnabled;
	const sendAlerts = deps.sendAlerts ?? defaultSendAlerts;

	// Subset opțional de cuvinte cheie: „Verifică acum" pe un rând sau pe o selecție.
	const keywordIds = Array.isArray(params.keywordIds)
		? params.keywordIds.filter((k): k is string => typeof k === 'string')
		: undefined;

	const summary = await run({
		tenantId,
		projectId,
		trigger: (params.trigger as 'cron' | 'manual') ?? 'cron',
		triggeredBy: (params.triggeredBy as string) ?? null,
		keywordIds
	});

	// ── RE-PROGRAMARE AUTOMATĂ (motorul adaptiv) ──
	// O rulare amânată (cooldown/buget) sau oprită de blocare cu cuvinte rămase se reia
	// SINGURĂ după cooldown, în loc să aștepte cronul de a doua zi. Max 2 reluări pe zi
	// per job — altfel o zi proastă ar produce un ping-pong infinit cu Google.
	const retryAttempt = typeof params.retryAttempt === 'number' ? params.retryAttempt : 0;
	const deferredUntil = summary.deferredUntilMs ?? null;
	const remaining = summary.unattemptedKeywordIds ?? null;
	if (retryAttempt < 2 && (deferredUntil != null || remaining?.length)) {
		const delayMs = Math.max(60_000, (deferredUntil ?? Date.now() + 30 * 60_000) - Date.now() + 2 * 60_000);
		const reenqueue =
			deps.reenqueue ??
			(async (p: Record<string, unknown>, d: number) => {
				await getSchedulerQueue().add(
					'rank-project-check',
					{ type: 'rank_project_check', params: p },
					{
						jobId: `rank-project-check-${projectId}-retry${retryAttempt + 1}-${Date.now()}`,
						delay: d,
						attempts: 1,
						removeOnComplete: true,
						removeOnFail: true
					}
				);
			});
		try {
			await reenqueue(
				{
					tenantId,
					projectId,
					trigger: params.trigger ?? 'cron',
					triggeredBy: params.triggeredBy ?? null,
					keywordIds: remaining ?? keywordIds,
					retryAttempt: retryAttempt + 1
				},
				delayMs
			);
			logInfo(
				'scheduler',
				`[rank] re-programat proiectul ${projectId} peste ${Math.round(delayMs / 60_000)} min (încercarea ${retryAttempt + 1}, ${remaining?.length ?? 'toate'} cuvinte)`
			);
		} catch {
			// re-programarea e best-effort; cronul de mâine acoperă oricum
		}
	}

	if (summary.runId && summary.alerts > 0) {
		try {
			if (await alertsEnabled(tenantId)) {
				await sendAlerts(tenantId, projectId, summary.runId);
			}
		} catch (e) {
			// Alertele nu trebuie să pice verificarea în sine.
			logError('scheduler', `[rank] trimitere alerte eșuată (proiect ${projectId}): ${serializeError(e).message}`);
		}
	}

	return summary;
}
