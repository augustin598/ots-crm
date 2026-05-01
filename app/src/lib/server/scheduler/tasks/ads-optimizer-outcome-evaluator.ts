// Daily outcome evaluator for ad optimization recommendations.
// For each applied recommendation older than 7 days without a verdict,
// computes current CPL vs baseline and sets outcome_verdict.

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, isNull, lt, isNotNull } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';

function ymd(d: Date): string {
	const fmt = new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Europe/Bucharest',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	return fmt.format(d);
}

export async function processAdsOptimizerOutcomeEvaluator(): Promise<{
	evaluated: number;
	improved: number;
	worsened: number;
	neutral: number;
	insufficient: number;
}> {
	const cutoff = new Date(Date.now() - 7 * 86400_000);

	const recs = await db
		.select({
			id: table.adOptimizationRecommendation.id,
			tenantId: table.adOptimizationRecommendation.tenantId,
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

	let improved = 0, worsened = 0, neutral = 0, insufficient = 0;

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
		} catch (e) {
			logError(
				'scheduler',
				`outcome-evaluator: failed for rec ${rec.id}: ${serializeError(e).message}`
			);
		}
	}

	logInfo(
		'scheduler',
		`[outcome-evaluator] Evaluated ${recs.length} recs: improved=${improved} worsened=${worsened} neutral=${neutral} insufficient=${insufficient}`
	);

	return { evaluated: recs.length, improved, worsened, neutral, insufficient };
}
