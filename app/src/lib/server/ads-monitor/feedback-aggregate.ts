export interface RecRecord {
	action: string;
	status: string;
	decidedAt: Date | null;
}

const WINDOW_DAYS = 30;
const MS_PER_DAY = 86400_000;

/**
 * Compute rejection rate per action over last 30 days.
 * Numerator: rejected. Denominator: rejected + applied (decided recs only).
 */
export function computeRejectionRates(
	recs: RecRecord[],
	now: Date = new Date()
): Record<string, number> {
	const cutoff = now.getTime() - WINDOW_DAYS * MS_PER_DAY;
	const inWindow = recs.filter(
		(r) =>
			r.decidedAt !== null &&
			r.decidedAt.getTime() >= cutoff &&
			(r.status === 'rejected' || r.status === 'applied')
	);
	const buckets = new Map<string, { rejected: number; total: number }>();
	for (const r of inWindow) {
		const b = buckets.get(r.action) ?? { rejected: 0, total: 0 };
		b.total += 1;
		if (r.status === 'rejected') b.rejected += 1;
		buckets.set(r.action, b);
	}
	const out: Record<string, number> = {};
	for (const [action, b] of buckets) {
		out[action] = b.total > 0 ? b.rejected / b.total : 0;
	}
	return out;
}

/**
 * Fetch decided recs for a (tenant, clientId) over last 30 days, ready for computeRejectionRates.
 */
export async function fetchRecsForFeedback(
	tenantId: string,
	clientId: string
): Promise<RecRecord[]> {
	const { db } = await import('$lib/server/db');
	const { and, eq, gte } = await import('drizzle-orm');
	const table = await import('$lib/server/db/schema');
	const cutoff = new Date(Date.now() - WINDOW_DAYS * MS_PER_DAY);
	const rows = await db
		.select({
			action: table.adOptimizationRecommendation.action,
			status: table.adOptimizationRecommendation.status,
			decidedAt: table.adOptimizationRecommendation.decidedAt
		})
		.from(table.adOptimizationRecommendation)
		.where(
			and(
				eq(table.adOptimizationRecommendation.tenantId, tenantId),
				eq(table.adOptimizationRecommendation.clientId, clientId),
				gte(table.adOptimizationRecommendation.createdAt, cutoff)
			)
		);
	return rows;
}

/**
 * B10: Fetch decided recs scoped to a specific target over last 30 days.
 * Used for per-target rejection rate tracking.
 */
export async function fetchRecsForFeedbackByTarget(
	tenantId: string,
	targetId: string
): Promise<RecRecord[]> {
	const { db } = await import('$lib/server/db');
	const { and, eq, gte } = await import('drizzle-orm');
	const table = await import('$lib/server/db/schema');
	const cutoff = new Date(Date.now() - WINDOW_DAYS * MS_PER_DAY);
	const rows = await db
		.select({
			action: table.adOptimizationRecommendation.action,
			status: table.adOptimizationRecommendation.status,
			decidedAt: table.adOptimizationRecommendation.decidedAt
		})
		.from(table.adOptimizationRecommendation)
		.where(
			and(
				eq(table.adOptimizationRecommendation.tenantId, tenantId),
				eq(table.adOptimizationRecommendation.targetId, targetId),
				gte(table.adOptimizationRecommendation.createdAt, cutoff)
			)
		);
	return rows;
}
