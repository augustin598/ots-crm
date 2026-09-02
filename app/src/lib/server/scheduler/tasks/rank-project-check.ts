// Handler BullMQ one-shot pentru verificarea unui singur proiect. Deleagă la
// runner și, dacă rularea a produs alerte, trimite emailul de alerte (dacă e activat).
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { rankSettings } from '$lib/server/db/schema';
import { logError, serializeError } from '$lib/server/logger';
import { runRankProjectCheck, type RankRunSummary } from '$lib/server/rank-tracker/run';

export interface RankProjectCheckDeps {
	run?: typeof runRankProjectCheck;
	sendAlerts?: (tenantId: string, projectId: string, runId: string) => Promise<void>;
	alertsEnabled?: (tenantId: string) => Promise<boolean>;
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

	const summary = await run({
		tenantId,
		projectId,
		trigger: (params.trigger as 'cron' | 'manual') ?? 'cron',
		triggeredBy: (params.triggeredBy as string) ?? null
	});

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
