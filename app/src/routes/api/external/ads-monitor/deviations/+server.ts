import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq, gte } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';

/**
 * GET /api/external/ads-monitor/deviations
 *
 * Returns recent deviation events (notification rows of type ad.target_deviation).
 * This is the primary endpoint PersonalOPS CEO uses to know what's broken in
 * Meta Ads — it's the input for a weekly-review worker or an optimizer.
 *
 * Query:
 *   since        — ISO datetime, default 7 days ago, max 90 days back
 *   severity     — optional, filter to one of: warning | high | urgent
 *   campaignId   — optional, filter to specific campaign (externalCampaignId)
 *   limit        — default 100, max 500
 */
export const GET: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:read', async (event, ctx) => {
		const url = event.url;

		const sinceParam = url.searchParams.get('since');
		const defaultSince = new Date(Date.now() - 7 * 86400_000);
		const maxBack = new Date(Date.now() - 90 * 86400_000);
		let since = defaultSince;
		if (sinceParam) {
			const parsed = new Date(sinceParam);
			if (Number.isFinite(parsed.getTime())) {
				since = parsed < maxBack ? maxBack : parsed;
			}
		}

		const severity = url.searchParams.get('severity');
		const campaignId = url.searchParams.get('campaignId');

		const limitRaw = parseInt(url.searchParams.get('limit') ?? '100', 10);
		const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

		const conditions = [
			eq(table.notification.tenantId, ctx.tenantId),
			eq(table.notification.type, 'ad.target_deviation'),
			gte(table.notification.createdAt, since)
		];

		const rows = await db
			.select({
				id: table.notification.id,
				createdAt: table.notification.createdAt,
				updatedAt: table.notification.updatedAt,
				clientId: table.notification.clientId,
				priority: table.notification.priority,
				title: table.notification.title,
				message: table.notification.message,
				link: table.notification.link,
				metadata: table.notification.metadata,
				count: table.notification.count
			})
			.from(table.notification)
			.where(and(...conditions))
			.orderBy(desc(table.notification.createdAt))
			.limit(limit);

		// Decode metadata + filter client-side by severity / campaignId since metadata is JSON
		type DeviationItem = {
			notificationId: string;
			detectedAt: Date;
			lastSeenAt: Date;
			clientId: string | null;
			priority: string;
			occurrences: number;
			campaignId: string | null;
			deviations: Array<{
				metric: string;
				actual: number;
				target: number;
				deviationPct: number;
				severity: string;
				consecutiveDays: number;
			}>;
			maxSeverity: string | null;
		};

		const items: DeviationItem[] = [];
		for (const r of rows) {
			const meta = (r.metadata ?? {}) as {
				targetId?: string;
				externalCampaignId?: string;
				deviations?: Array<{
					metric: string;
					actual: number;
					target: number;
					deviationPct: number;
					severity: string;
					consecutiveDays: number;
				}>;
			};
			const deviations = Array.isArray(meta.deviations) ? meta.deviations : [];

			if (campaignId && meta.externalCampaignId !== campaignId) continue;

			const severities = deviations.map((d) => d.severity);
			const order: Record<string, number> = { warning: 1, high: 2, urgent: 3 };
			const maxSev =
				severities.length > 0
					? severities.reduce((a, b) => (order[b] > (order[a] ?? 0) ? b : a))
					: null;

			if (severity && maxSev !== severity) continue;

			items.push({
				notificationId: r.id,
				detectedAt: r.createdAt,
				lastSeenAt: r.updatedAt,
				clientId: r.clientId,
				priority: r.priority,
				occurrences: r.count,
				campaignId: meta.externalCampaignId ?? null,
				deviations,
				maxSeverity: maxSev
			});
		}

		// Summary aggregates so the CEO can quickly assess the situation
		const summary = {
			total: items.length,
			byCampaign: items.reduce(
				(acc, i) => {
					if (!i.campaignId) return acc;
					acc[i.campaignId] = (acc[i.campaignId] ?? 0) + 1;
					return acc;
				},
				{} as Record<string, number>
			),
			bySeverity: items.reduce(
				(acc, i) => {
					const k = i.maxSeverity ?? 'unknown';
					acc[k] = (acc[k] ?? 0) + 1;
					return acc;
				},
				{} as Record<string, number>
			)
		};

		return {
			status: 200,
			body: {
				items,
				summary,
				query: { since: since.toISOString(), severity, campaignId, limit }
			}
		};
	});
