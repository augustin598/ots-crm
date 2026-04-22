import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray, desc } from 'drizzle-orm';
import type { AdsPaymentStatus, AdsProvider } from '$lib/server/ads/payment-status-types';
import { PAYMENT_STATUS_LABEL_RO, PROVIDER_LABEL, PROVIDER_BILLING_URL } from '$lib/server/ads/payment-status-types';

function requireAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Forbidden: Admin access required');
	}
	return event;
}

export interface FlaggedAccountRow {
	provider: AdsProvider;
	providerLabel: string;
	accountTableId: string;
	externalAccountId: string;
	accountName: string;
	clientId: string | null;
	clientName: string | null;
	clientEmail: string | null;
	paymentStatus: AdsPaymentStatus;
	statusLabel: string;
	rawStatusCode: string;
	rawDisableReason: string | null;
	checkedAt: string | null;
	billingUrl: string;
}

export interface AdsStatusDashboard {
	flagged: FlaggedAccountRow[];
	totals: {
		total: number;
		byStatus: Record<AdsPaymentStatus, number>;
		byProvider: Record<AdsProvider, number>;
	};
	totalAccountsMonitored: number;
}

function parseRaw(raw: string | null): { code: string; disableReason: string | null } {
	if (!raw) return { code: '', disableReason: null };
	try {
		const parsed = JSON.parse(raw);
		return {
			code: String(parsed.code ?? ''),
			disableReason: parsed.disableReason != null ? String(parsed.disableReason) : null,
		};
	} catch {
		return { code: raw, disableReason: null };
	}
}

async function resolveClientInfo(
	tenantId: string,
	clientIds: string[],
): Promise<Map<string, { name: string; email: string | null }>> {
	if (clientIds.length === 0) return new Map();
	const rows = await db
		.select({ id: table.client.id, name: table.client.name, email: table.client.email })
		.from(table.client)
		.where(
			and(
				eq(table.client.tenantId, tenantId),
				inArray(table.client.id, clientIds),
			),
		);
	return new Map(rows.map((r) => [r.id, { name: r.name, email: r.email ?? null }]));
}

export const getAdsPaymentStatusDashboard = query(async () => {
	const event = requireAdmin();
	const tenantId = event.locals.tenant!.id;

	const [metaRows, googleRows, tiktokRows] = await Promise.all([
		db
			.select({
				id: table.metaAdsAccount.id,
				externalId: table.metaAdsAccount.metaAdAccountId,
				accountName: table.metaAdsAccount.accountName,
				clientId: table.metaAdsAccount.clientId,
				paymentStatus: table.metaAdsAccount.paymentStatus,
				paymentStatusRaw: table.metaAdsAccount.paymentStatusRaw,
				checkedAt: table.metaAdsAccount.paymentStatusCheckedAt,
			})
			.from(table.metaAdsAccount)
			.where(eq(table.metaAdsAccount.tenantId, tenantId))
			.orderBy(desc(table.metaAdsAccount.paymentStatusCheckedAt)),
		db
			.select({
				id: table.googleAdsAccount.id,
				externalId: table.googleAdsAccount.googleAdsCustomerId,
				accountName: table.googleAdsAccount.accountName,
				clientId: table.googleAdsAccount.clientId,
				paymentStatus: table.googleAdsAccount.paymentStatus,
				paymentStatusRaw: table.googleAdsAccount.paymentStatusRaw,
				checkedAt: table.googleAdsAccount.paymentStatusCheckedAt,
			})
			.from(table.googleAdsAccount)
			.where(eq(table.googleAdsAccount.tenantId, tenantId))
			.orderBy(desc(table.googleAdsAccount.paymentStatusCheckedAt)),
		db
			.select({
				id: table.tiktokAdsAccount.id,
				externalId: table.tiktokAdsAccount.tiktokAdvertiserId,
				accountName: table.tiktokAdsAccount.accountName,
				clientId: table.tiktokAdsAccount.clientId,
				paymentStatus: table.tiktokAdsAccount.paymentStatus,
				paymentStatusRaw: table.tiktokAdsAccount.paymentStatusRaw,
				checkedAt: table.tiktokAdsAccount.paymentStatusCheckedAt,
			})
			.from(table.tiktokAdsAccount)
			.where(eq(table.tiktokAdsAccount.tenantId, tenantId))
			.orderBy(desc(table.tiktokAdsAccount.paymentStatusCheckedAt)),
	]);

	const totalAccountsMonitored = metaRows.length + googleRows.length + tiktokRows.length;

	const clientIds = new Set<string>();
	for (const r of [...metaRows, ...googleRows, ...tiktokRows]) {
		if (r.clientId) clientIds.add(r.clientId);
	}
	const clientMap = await resolveClientInfo(tenantId, [...clientIds]);

	const flagged: FlaggedAccountRow[] = [];

	const byStatus: Record<AdsPaymentStatus, number> = {
		ok: 0, grace_period: 0, risk_review: 0, payment_failed: 0, suspended: 0, closed: 0,
	};
	const byProvider: Record<AdsProvider, number> = { meta: 0, google: 0, tiktok: 0 };

	function push(provider: AdsProvider, row: typeof metaRows[number] | typeof googleRows[number] | typeof tiktokRows[number]) {
		const status = (row.paymentStatus as AdsPaymentStatus) ?? 'ok';
		if (status === 'ok') return;
		byStatus[status] = (byStatus[status] ?? 0) + 1;
		byProvider[provider] = (byProvider[provider] ?? 0) + 1;

		const client = row.clientId ? clientMap.get(row.clientId) ?? null : null;
		const raw = parseRaw(row.paymentStatusRaw);

		flagged.push({
			provider,
			providerLabel: PROVIDER_LABEL[provider],
			accountTableId: row.id,
			externalAccountId: row.externalId,
			accountName: row.accountName || row.externalId,
			clientId: row.clientId ?? null,
			clientName: client?.name ?? null,
			clientEmail: client?.email ?? null,
			paymentStatus: status,
			statusLabel: PAYMENT_STATUS_LABEL_RO[status],
			rawStatusCode: raw.code,
			rawDisableReason: raw.disableReason,
			checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
			billingUrl: PROVIDER_BILLING_URL[provider](row.externalId),
		});
	}

	for (const r of metaRows) push('meta', r);
	for (const r of googleRows) push('google', r);
	for (const r of tiktokRows) push('tiktok', r);

	flagged.sort((a, b) => {
		const statusOrder: Record<AdsPaymentStatus, number> = {
			suspended: 0, closed: 1, payment_failed: 2, risk_review: 3, grace_period: 4, ok: 5,
		};
		const aOrder = statusOrder[a.paymentStatus];
		const bOrder = statusOrder[b.paymentStatus];
		if (aOrder !== bOrder) return aOrder - bOrder;
		if (a.checkedAt && b.checkedAt) return b.checkedAt.localeCompare(a.checkedAt);
		return 0;
	});

	const dashboard: AdsStatusDashboard = {
		flagged,
		totals: {
			total: flagged.length,
			byStatus,
			byProvider,
		},
		totalAccountsMonitored,
	};
	return dashboard;
});

// Per-tenant cooldown for manual triggers to prevent spam-click API hammering
const manualTriggerCooldownMs = 60_000;
const lastManualTriggerAt = new Map<string, number>();

export const triggerAdsStatusMonitor = command(
	v.object({}),
	async () => {
		const event = requireAdmin();
		const tenantId = event.locals.tenant!.id;

		const last = lastManualTriggerAt.get(tenantId);
		if (last && Date.now() - last < manualTriggerCooldownMs) {
			const waitSec = Math.ceil((manualTriggerCooldownMs - (Date.now() - last)) / 1000);
			throw new Error(`Mai așteaptă ${waitSec}s înainte de următoarea verificare manuală.`);
		}
		lastManualTriggerAt.set(tenantId, Date.now());

		const { getSchedulerQueue } = await import('$lib/server/scheduler');
		const queue = getSchedulerQueue();

		// Scope the manual job to the current tenant only — the scheduled hourly
		// job runs unscoped for every tenant.
		await queue.add(
			'ads-status-monitor-manual',
			{ type: 'ads_status_monitor', params: { tenantIds: [tenantId] } },
			{ removeOnComplete: true, removeOnFail: false },
		);

		return { ok: true, tenantId };
	},
);
