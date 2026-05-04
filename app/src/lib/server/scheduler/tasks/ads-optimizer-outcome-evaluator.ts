// Daily outcome evaluator for ad optimization recommendations.
// For each applied recommendation older than 7 days without a verdict,
// computes current CPL vs baseline and sets outcome_verdict.

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, isNull, lt, isNotNull, desc, gt } from 'drizzle-orm';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { sendTelegramMessage } from '$lib/server/telegram/sender';
import { writeTargetAudit } from '$lib/server/ads-monitor/audit-writer';

function ymd(d: Date): string {
	const fmt = new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Europe/Bucharest',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	return fmt.format(d);
}

async function notifyAdmins(tenantId: string, text: string): Promise<void> {
	const users = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(eq(table.tenantUser.tenantId, tenantId));
	for (const u of users) {
		try {
			await sendTelegramMessage({ tenantId, userId: u.userId, text });
		} catch (e) {
			logWarning('scheduler', `[outcome-evaluator] Telegram alert failed for user ${u.userId}: ${serializeError(e).message}`);
		}
	}
}

async function checkAndAutopause(
	tenantId: string,
	targetId: string,
	campaignId: string
): Promise<boolean> {
	const cutoff30d = Math.floor((Date.now() - 30 * 86400_000) / 1000);
	const recentWorsened = await db
		.select({ id: table.adOptimizationRecommendation.id })
		.from(table.adOptimizationRecommendation)
		.where(
			and(
				eq(table.adOptimizationRecommendation.targetId, targetId),
				eq(table.adOptimizationRecommendation.outcomeVerdict, 'worsened'),
				gt(table.adOptimizationRecommendation.outcomeEvaluatedAt, cutoff30d)
			)
		)
		.orderBy(desc(table.adOptimizationRecommendation.outcomeEvaluatedAt))
		.limit(5);

	if (recentWorsened.length < 5) return false;

	const pausedUntil = Date.now() + 30 * 86400_000;
	const pausedReason = 'worsened_streak_5_consecutive';

	const [target] = await db
		.select({ externalCampaignName: table.adMonitorTarget.externalCampaignName, version: table.adMonitorTarget.version })
		.from(table.adMonitorTarget)
		.where(eq(table.adMonitorTarget.id, targetId))
		.limit(1);

	await db
		.update(table.adMonitorTarget)
		.set({
			optimizerPausedUntil: pausedUntil,
			optimizerPausedReason: pausedReason,
			updatedAt: new Date()
		})
		.where(eq(table.adMonitorTarget.id, targetId));

	await writeTargetAudit({
		tenantId,
		targetId,
		actorType: 'system',
		actorId: 'outcome-evaluator',
		action: 'updated',
		changes: {
			optimizerPausedUntil: { from: null, to: pausedUntil },
			optimizerPausedReason: { from: null, to: pausedReason }
		},
		note: '5 worsened outcomes in 30d — optimizer paused 30d'
	});

	const campaignLabel = target?.externalCampaignName
		? `${target.externalCampaignName} (${campaignId})`
		: campaignId;
	await notifyAdmins(
		tenantId,
		`⚠️ Optimizer paused 30d on target ${targetId} (campanie ${campaignLabel}) — 5 worsened recs streak`
	);

	logInfo('scheduler', `[outcome-evaluator] Auto-paused optimizer on target ${targetId} — 5 consecutive worsened recs`, { tenantId });
	return true;
}

export async function processAdsOptimizerOutcomeEvaluator(): Promise<{
	evaluated: number;
	improved: number;
	worsened: number;
	neutral: number;
	insufficient: number;
	autoPaused: number;
}> {
	const cutoff = new Date(Date.now() - 7 * 86400_000);

	const recs = await db
		.select({
			id: table.adOptimizationRecommendation.id,
			tenantId: table.adOptimizationRecommendation.tenantId,
			targetId: table.adOptimizationRecommendation.targetId,
			externalCampaignId: table.adOptimizationRecommendation.externalCampaignId,
			baselineCplCents: table.adOptimizationRecommendation.baselineCplCents,
			appliedAt: table.adOptimizationRecommendation.appliedAt
		})
		.from(table.adOptimizationRecommendation)
		.where(
			and(
				eq(table.adOptimizationRecommendation.status, 'applied'),
				lt(table.adOptimizationRecommendation.appliedAt, cutoff),
				isNull(table.adOptimizationRecommendation.outcomeVerdict),
				isNotNull(table.adOptimizationRecommendation.baselineCplCents)
			)
		)
		.limit(200);

	let improved = 0, worsened = 0, neutral = 0, insufficient = 0, autoPaused = 0;

	for (const rec of recs) {
		try {
			const sinceDate = ymd(new Date(Date.now() - 7 * 86400_000));
			const snapshots = await db
				.select({
					spendCents: table.adMetricSnapshot.spendCents,
					conversions: table.adMetricSnapshot.conversions,
					date: table.adMetricSnapshot.date
				})
				.from(table.adMetricSnapshot)
				.where(
					and(
						eq(table.adMetricSnapshot.tenantId, rec.tenantId),
						eq(table.adMetricSnapshot.externalCampaignId, rec.externalCampaignId)
					)
				)
				.orderBy(table.adMetricSnapshot.date);

			const recent = snapshots.filter((s) => s.date >= sinceDate);
			const totalSpend = recent.reduce((sum, s) => sum + s.spendCents, 0);
			const totalConversions = recent.reduce((sum, s) => sum + s.conversions, 0);

			let verdict: string;
			let outcomeCpl: number | null = null;

			if (totalConversions < 3) {
				verdict = 'insufficient_data';
				insufficient++;
			} else {
				const currentCpl = Math.round(totalSpend / totalConversions);
				outcomeCpl = currentCpl;
				const baseline = rec.baselineCplCents!;
				const ratio = currentCpl / baseline;
				if (ratio < 0.85) {
					verdict = 'improved';
					improved++;
				} else if (ratio > 1.15) {
					verdict = 'worsened';
					worsened++;
				} else {
					verdict = 'neutral';
					neutral++;
				}
			}

			await db
				.update(table.adOptimizationRecommendation)
				.set({
					outcomeVerdict: verdict,
					outcomeCplCents7d: outcomeCpl,
					outcomeEvaluatedAt: Math.floor(Date.now() / 1000),
					updatedAt: new Date()
				})
				.where(eq(table.adOptimizationRecommendation.id, rec.id));

			if (verdict === 'worsened' && rec.targetId) {
				try {
					const paused = await checkAndAutopause(rec.tenantId, rec.targetId, rec.externalCampaignId);
					if (paused) autoPaused++;
				} catch (e) {
					logError('scheduler', `outcome-evaluator: auto-pause check failed for target ${rec.targetId}: ${serializeError(e).message}`);
				}
			}
		} catch (e) {
			logError(
				'scheduler',
				`outcome-evaluator: failed for rec ${rec.id}: ${serializeError(e).message}`
			);
		}
	}

	logInfo(
		'scheduler',
		`[outcome-evaluator] Evaluated ${recs.length} recs: improved=${improved} worsened=${worsened} neutral=${neutral} insufficient=${insufficient} autoPaused=${autoPaused}`
	);

	return { evaluated: recs.length, improved, worsened, neutral, insufficient, autoPaused };
}
