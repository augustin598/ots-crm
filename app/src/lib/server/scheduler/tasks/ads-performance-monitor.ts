// Daily worker that pulls Meta Ads insights for monitored campaigns,
// persists snapshots, runs the deviation engine, and emits alerts
// (in-app + email digest + Telegram) for mature campaigns over threshold.
//
// Per-tenant stagger via deterministic offset to spread Meta API load.

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, gte, lte } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logError, logInfo, logWarning, serializeError } from '$lib/server/logger';
import { listCampaignInsights, listActiveCampaigns } from '$lib/server/meta-ads/client';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';
import { env } from '$env/dynamic/private';
import { createNotification } from '$lib/server/notifications';
import { sendTelegramMessage } from '$lib/server/telegram/sender';
import {
	assessMaturity,
	detectDeviations,
	type CampaignTargets,
	type DailyMetrics,
	type DeviationResult
} from '$lib/server/ads/deviation-engine';

const PROCESS_TIMEOUT_MS = 90_000;
const MAX_TENANT_STAGGER_MS = 60 * 60 * 1000; // 0–60 min spread

interface BreakerState {
	consecutiveFailures: number;
	openedAt: number | null;
}
const breaker = new Map<string, BreakerState>();
const BREAK_AFTER_FAILURES = 5;
const COOLDOWN_MS = 15 * 60 * 1000;

function breakerKey(tenantId: string): string {
	return `meta-perf:${tenantId}`;
}

function shouldSkip(tenantId: string): boolean {
	const state = breaker.get(breakerKey(tenantId));
	if (!state?.openedAt) return false;
	if (Date.now() - state.openedAt < COOLDOWN_MS) return true;
	breaker.delete(breakerKey(tenantId));
	return false;
}

function markFailure(tenantId: string): void {
	const key = breakerKey(tenantId);
	const current = breaker.get(key) ?? { consecutiveFailures: 0, openedAt: null };
	const next: BreakerState = {
		consecutiveFailures: current.consecutiveFailures + 1,
		openedAt: current.openedAt
	};
	if (next.consecutiveFailures >= BREAK_AFTER_FAILURES && !next.openedAt) {
		next.openedAt = Date.now();
		logWarning('scheduler', `Circuit breaker opened for ${key} — pausing 15min`);
	}
	breaker.set(key, next);
}

function markSuccess(tenantId: string): void {
	breaker.delete(breakerKey(tenantId));
}

// Deterministic stagger so a tenant always wakes at the same minute, but tenants spread.
function staggerOffsetMs(tenantId: string): number {
	let h = 0;
	for (let i = 0; i < tenantId.length; i++) {
		h = ((h << 5) - h) + tenantId.charCodeAt(i);
		h |= 0;
	}
	return Math.abs(h) % MAX_TENANT_STAGGER_MS;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		p,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
		)
	]);
}

function ymd(d: Date): string {
	// YYYY-MM-DD in Europe/Bucharest — which is Meta's daily attribution boundary
	const fmt = new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Europe/Bucharest',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	return fmt.format(d);
}

function shiftDays(d: Date, days: number): Date {
	const copy = new Date(d);
	copy.setUTCDate(copy.getUTCDate() + days);
	return copy;
}

interface ResolvedAccount {
	tenantId: string;
	clientId: string | null;
	metaAdAccountId: string;
	integrationId: string;
}

// Map externalCampaignId -> matching meta_ads_account row
async function resolveAdAccountForCampaign(
	tenantId: string,
	externalCampaignId: string
): Promise<ResolvedAccount | null> {
	// We need to look up which ad account holds this campaign.
	// In practice the ad_monitor_target row was created from a campaigns list page,
	// so the campaign belongs to one of the tenant's metaAdsAccount rows.
	// We hit each active integration's campaigns until we find a match. To keep
	// this efficient, we cache per-account at the call site.
	return null; // resolution happens via the per-account loop in run() below
}

type DailyByDate = Map<string, DailyMetrics>;

interface InsightRow {
	campaignId: string;
	objective: string;
	startTime: string | null;
	dailyByDate: DailyByDate; // keyed by YYYY-MM-DD
}

function emptyDay(date: string): DailyMetrics {
	return {
		date,
		spendCents: 0,
		impressions: 0,
		clicks: 0,
		conversions: 0,
		cpcCents: null,
		cpmCents: null,
		cpaCents: null,
		cplCents: null,
		ctr: null,
		roas: null,
		frequency: null
	};
}

function toCents(value: string | number | null | undefined): number {
	if (value === null || value === undefined) return 0;
	const n = typeof value === 'string' ? parseFloat(value) : value;
	if (!isFinite(n)) return 0;
	return Math.round(n * 100);
}

async function fetchAccountInsights(
	adAccountId: string,
	integrationId: string,
	since: string,
	until: string
): Promise<InsightRow[] | null> {
	const auth = await getAuthenticatedToken(integrationId);
	if (!auth) {
		logWarning('scheduler', `ads-performance-monitor: no auth token for integration ${integrationId}`);
		return null;
	}
	const appSecret = env.META_APP_SECRET;
	if (!appSecret) {
		logError('scheduler', 'ads-performance-monitor: META_APP_SECRET not configured');
		return null;
	}

	const [insights, campaigns] = await Promise.all([
		listCampaignInsights(adAccountId, auth.accessToken, appSecret, since, until, 'daily'),
		listActiveCampaigns(adAccountId, auth.accessToken, appSecret)
	]);

	const objectiveByCampaign = new Map<string, { objective: string; startTime: string | null }>();
	for (const c of campaigns) {
		objectiveByCampaign.set(c.campaignId, { objective: c.objective, startTime: c.startTime });
	}

	const grouped = new Map<string, InsightRow>();
	for (const row of insights) {
		if (!row.campaignId) continue;
		const dateKey = row.dateStart || ymd(new Date());
		let entry = grouped.get(row.campaignId);
		if (!entry) {
			const meta = objectiveByCampaign.get(row.campaignId);
			entry = {
				campaignId: row.campaignId,
				objective: row.objective || meta?.objective || '',
				startTime: meta?.startTime ?? null,
				dailyByDate: new Map()
			};
			grouped.set(row.campaignId, entry);
		}

		const spendCents = toCents(row.spend);
		const impressions = parseInt(row.impressions || '0', 10) || 0;
		const clicks = parseInt(row.clicks || '0', 10) || 0;
		const conversions = row.conversions ?? 0;
		const conversionValue = row.conversionValue ?? 0;

		const day: DailyMetrics = {
			date: dateKey,
			spendCents,
			impressions,
			clicks,
			conversions,
			cpcCents: clicks > 0 ? Math.round(spendCents / clicks) : null,
			cpmCents: impressions > 0 ? Math.round((spendCents / impressions) * 1000) : null,
			cpaCents: conversions > 0 ? Math.round(spendCents / conversions) : null,
			cplCents: conversions > 0 ? Math.round(spendCents / conversions) : null,
			ctr: impressions > 0 ? clicks / impressions : null,
			roas: spendCents > 0 ? conversionValue / (spendCents / 100) : null,
			frequency: parseFloat(row.frequency || '0') || null
		};
		entry.dailyByDate.set(dateKey, day);
	}

	return Array.from(grouped.values());
}

async function persistSnapshots(
	tenantId: string,
	clientId: string,
	externalCampaignId: string,
	maturity: 'learning' | 'sparse' | 'mature',
	rows: DailyMetrics[]
): Promise<void> {
	for (const day of rows) {
		const existing = await db
			.select({ id: table.adMetricSnapshot.id })
			.from(table.adMetricSnapshot)
			.where(
				and(
					eq(table.adMetricSnapshot.tenantId, tenantId),
					eq(table.adMetricSnapshot.externalCampaignId, externalCampaignId),
					eq(table.adMetricSnapshot.date, day.date)
				)
			)
			.limit(1);

		const payload = {
			spendCents: day.spendCents,
			impressions: day.impressions,
			clicks: day.clicks,
			conversions: day.conversions,
			cpcCents: day.cpcCents,
			cpmCents: day.cpmCents,
			cpaCents: day.cpaCents,
			cplCents: day.cplCents,
			ctr: day.ctr,
			roas: day.roas,
			frequency: day.frequency,
			maturity,
			fetchedAt: new Date()
		};

		if (existing[0]) {
			await db
				.update(table.adMetricSnapshot)
				.set(payload)
				.where(eq(table.adMetricSnapshot.id, existing[0].id));
		} else {
			await db.insert(table.adMetricSnapshot).values({
				id: encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15))),
				tenantId,
				clientId,
				platform: 'meta',
				externalCampaignId,
				externalAdsetId: null,
				date: day.date,
				...payload
			});
		}
	}
}

const SEVERITY_LABEL_RO: Record<string, string> = {
	warning: 'avertizare',
	high: 'ridicat',
	urgent: 'urgent'
};

const METRIC_LABEL_RO: Record<string, string> = {
	cpl: 'CPL',
	cpa: 'CPA',
	roas: 'ROAS',
	ctr: 'CTR',
	dailyBudget: 'Buget zilnic'
};

function formatActual(metric: string, value: number): string {
	if (metric === 'cpl' || metric === 'cpa' || metric === 'dailyBudget') {
		return `${(value / 100).toFixed(2)} RON`;
	}
	if (metric === 'ctr') return `${(value * 100).toFixed(2)}%`;
	return value.toFixed(2);
}

interface AlertContext {
	tenantId: string;
	clientId: string;
	target: typeof table.adMonitorTarget.$inferSelect;
	deviations: DeviationResult[];
}

async function emitAlerts(ctx: AlertContext): Promise<void> {
	const { tenantId, clientId, target, deviations } = ctx;
	if (deviations.length === 0) return;

	// Resolve admin recipients
	const recipients = await db
		.select({ userId: table.tenantUser.userId, email: table.user.email })
		.from(table.tenantUser)
		.innerJoin(table.user, eq(table.user.id, table.tenantUser.userId))
		.where(eq(table.tenantUser.tenantId, tenantId));

	if (recipients.length === 0) return;

	const lines = deviations.map(
		(d) =>
			`${METRIC_LABEL_RO[d.metric]}: ${formatActual(d.metric, d.actual)} vs țintă ${formatActual(d.metric, d.target)} (${d.deviationPct >= 0 ? '+' : ''}${d.deviationPct.toFixed(0)}%, ${d.consecutiveDays} zile, ${SEVERITY_LABEL_RO[d.severity]})`
	);
	const message = `Campanie ${target.externalCampaignId}:\n${lines.join('\n')}`;
	const maxSeverity = deviations.reduce((max, d) => {
		const order = { warning: 1, high: 2, urgent: 3 } as const;
		return order[d.severity] > order[max] ? d.severity : max;
	}, 'warning' as 'warning' | 'high' | 'urgent');
	const priority = maxSeverity === 'urgent' ? 'urgent' : maxSeverity === 'high' ? 'high' : 'medium';

	for (const r of recipients) {
		// In-app
		if (target.notifyInApp) {
			try {
				await createNotification({
					tenantId,
					userId: r.userId,
					clientId,
					type: 'ad.target_deviation',
					title: `Deviație performanță Meta — ${maxSeverity}`,
					message,
					link: `/${tenantId}/reports/facebook-ads?targetId=${target.id}`,
					priority,
					metadata: {
						targetId: target.id,
						externalCampaignId: target.externalCampaignId,
						deviations: deviations.map((d) => ({
							metric: d.metric,
							actual: d.actual,
							target: d.target,
							deviationPct: d.deviationPct,
							severity: d.severity,
							consecutiveDays: d.consecutiveDays
						}))
					}
				});
			} catch (e) {
				logError('scheduler', `Failed in-app notification for target ${target.id}: ${serializeError(e).message}`);
			}
		}

		// Telegram only for high/urgent (anti-spam on warning)
		if (target.notifyTelegram && (maxSeverity === 'high' || maxSeverity === 'urgent')) {
			try {
				const sent = await sendTelegramMessage({
					tenantId,
					userId: r.userId,
					text: `*Deviație ${maxSeverity}* (Meta Ads)\nCampanie: \`${target.externalCampaignId}\`\n${lines.join('\n')}`
				});
				if (!sent.ok) {
					logWarning('scheduler', `Telegram alert skipped for user ${r.userId}: ${sent.reason}`);
				}
			} catch (e) {
				logError('scheduler', `Failed Telegram alert for user ${r.userId}: ${serializeError(e).message}`);
			}
		}
	}
}

async function processTenant(tenantId: string): Promise<{ alerted: number; processed: number }> {
	if (shouldSkip(tenantId)) {
		logInfo('scheduler', `ads-performance-monitor: skipping tenant ${tenantId} (breaker open)`);
		return { alerted: 0, processed: 0 };
	}

	const stagger = staggerOffsetMs(tenantId);
	if (stagger > 0) {
		await new Promise((resolve) => setTimeout(resolve, Math.min(stagger, 5_000)));
	}

	const targets = await db
		.select()
		.from(table.adMonitorTarget)
		.where(
			and(
				eq(table.adMonitorTarget.tenantId, tenantId),
				eq(table.adMonitorTarget.isActive, true),
				eq(table.adMonitorTarget.platform, 'meta')
			)
		);

	if (targets.length === 0) return { alerted: 0, processed: 0 };

	// Group targets by externalCampaignId for efficient API calls.
	// First, find which meta_ads_account each campaign belongs to by scanning the tenant's accounts.
	const accountsRows = await db
		.select({
			id: table.metaAdsAccount.id,
			metaAdAccountId: table.metaAdsAccount.metaAdAccountId,
			integrationId: table.metaAdsAccount.integrationId,
			clientId: table.metaAdsAccount.clientId
		})
		.from(table.metaAdsAccount)
		.where(
			and(
				eq(table.metaAdsAccount.tenantId, tenantId),
				eq(table.metaAdsAccount.isActive, true)
			)
		);

	if (accountsRows.length === 0) {
		logInfo('scheduler', `ads-performance-monitor: tenant ${tenantId} has no active Meta accounts`);
		return { alerted: 0, processed: 0 };
	}

	const now = new Date();
	const since = ymd(shiftDays(now, -8));
	const until = ymd(shiftDays(now, -1));

	let alerted = 0;
	let processed = 0;

	// Per ad account: fetch all campaigns once, then match targets by campaignId
	for (const account of accountsRows) {
		try {
			const insights = await withTimeout(
				fetchAccountInsights(account.metaAdAccountId, account.integrationId, since, until),
				PROCESS_TIMEOUT_MS,
				`fetchAccountInsights ${account.metaAdAccountId}`
			);
			if (!insights) continue;

			const insightsByCampaign = new Map(insights.map((i) => [i.campaignId, i]));

			// Find targets that match any campaign in this account
			for (const target of targets) {
				const insight = insightsByCampaign.get(target.externalCampaignId);
				if (!insight) continue; // target's campaign not in this account
				processed++;

				// Build last-7-day series (sorted ascending by date)
				const dates: string[] = [];
				for (let i = 7; i >= 1; i--) dates.push(ymd(shiftDays(now, -i)));
				const dailyHistory: DailyMetrics[] = dates.map(
					(d) => insight.dailyByDate.get(d) ?? emptyDay(d)
				);
				const last7d = dailyHistory.slice(-7);

				const maturity = assessMaturity(last7d, {
					campaignStartDate: insight.startTime ? insight.startTime.slice(0, 10) : null,
					isMuted: target.isMuted,
					mutedUntil: target.mutedUntil ?? null,
					now
				});

				// Persist snapshots for all days in window
				const clientId = target.clientId;
				try {
					await persistSnapshots(
						tenantId,
						clientId,
						target.externalCampaignId,
						maturity.maturity,
						dailyHistory
					);
				} catch (e) {
					logError('scheduler', `Failed to persist snapshots for ${target.externalCampaignId}: ${serializeError(e).message}`);
				}

				const targets_: CampaignTargets = {
					targetCplCents: target.targetCplCents,
					targetCpaCents: target.targetCpaCents,
					targetRoas: target.targetRoas,
					targetCtr: target.targetCtr,
					targetDailyBudgetCents: target.targetDailyBudgetCents,
					deviationThresholdPct: target.deviationThresholdPct
				};

				const detection = detectDeviations({
					targets: targets_,
					dailyHistory,
					context: {
						campaignStartDate: insight.startTime ? insight.startTime.slice(0, 10) : null,
						isMuted: target.isMuted,
						mutedUntil: target.mutedUntil ?? null,
						now
					},
					maturity
				});

				if (detection.deviations.length > 0) {
					alerted++;
					await emitAlerts({
						tenantId,
						clientId,
						target,
						deviations: detection.deviations
					});

					await db
						.update(table.adMonitorTarget)
						.set({ updatedAt: new Date() })
						.where(eq(table.adMonitorTarget.id, target.id));
				}
			}

			markSuccess(tenantId);
		} catch (e) {
			markFailure(tenantId);
			logError('scheduler', `ads-performance-monitor: account ${account.metaAdAccountId} failed: ${serializeError(e).message}`);
		}
	}

	return { alerted, processed };
}

export async function processAdsPerformanceMonitor(
	params: { tenantId?: string } = {}
): Promise<{ tenantsProcessed: number; alerted: number; processed: number }> {
	logInfo('scheduler', 'ads-performance-monitor: starting');

	let tenantIds: string[];
	if (params.tenantId) {
		tenantIds = [params.tenantId];
	} else {
		const rows = await db
			.selectDistinct({ tenantId: table.adMonitorTarget.tenantId })
			.from(table.adMonitorTarget)
			.where(eq(table.adMonitorTarget.isActive, true));
		tenantIds = rows.map((r) => r.tenantId);
	}

	let totalAlerted = 0;
	let totalProcessed = 0;

	for (const tenantId of tenantIds) {
		try {
			const result = await processTenant(tenantId);
			totalAlerted += result.alerted;
			totalProcessed += result.processed;
		} catch (e) {
			logError(
				'scheduler',
				`ads-performance-monitor: tenant ${tenantId} failed: ${serializeError(e).message}`
			);
		}
	}

	logInfo('scheduler', 'ads-performance-monitor: done', {
		metadata: {
			tenantsProcessed: tenantIds.length,
			alerted: totalAlerted,
			processed: totalProcessed
		}
	});

	return { tenantsProcessed: tenantIds.length, alerted: totalAlerted, processed: totalProcessed };
}
