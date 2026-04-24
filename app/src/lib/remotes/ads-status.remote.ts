import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray, desc } from 'drizzle-orm';
import type { AdsPaymentStatus, AdsProvider } from '$lib/server/ads/payment-status-types';
import {
	PAYMENT_STATUS_LABEL_RO,
	PROVIDER_LABEL,
	PROVIDER_BILLING_URL,
	actionForStatus,
} from '$lib/server/ads/payment-status-types';
import { parseTikTokRejectReason } from '$lib/ads/status-copy';

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

export interface ClientAdsHealthItem {
	provider: AdsProvider;
	providerLabel: string;
	externalAccountId: string;
	accountName: string;
	paymentStatus: AdsPaymentStatus;
	statusLabel: string;
	rawStatusCode: string;
	/**
	 * Secondary reason code (e.g., 'budget_exceeded', 'no_delivery' for TikTok;
	 * numeric disable_reason for Meta). Used for contextual tooltip messaging.
	 */
	rawDisableReason: string | null;
	/** Outstanding balance formatted for display (e.g., "430,40 RON"); null if unavailable */
	balanceFormatted: string | null;
	/** Status-appropriate action — null means no actionable CTA */
	action: { url: string; label: string } | null;
	/**
	 * TikTok only: human-readable rejection/limit reason from `/advertiser/info/`.
	 * Raw TikTok format: `<code>:<message>,endtime:<iso>`. We parse out the
	 * message portion only; endtime is exposed separately.
	 */
	rejectReasonMessage: string | null;
	/** TikTok only: ISO string when the rejection/limit expires (if any). */
	rejectReasonEndsAt: string | null;
	/** Google only: customer.suspension_reasons enum names. null for non-Google or when empty. */
	googleSuspensionReasons: string[] | null;
}


function formatBalance(cents: number | null, currency: string | null): string | null {
	if (cents == null || !Number.isFinite(cents) || cents === 0) return null;
	const amount = Math.abs(cents) / 100;
	const code = (currency || 'RON').toUpperCase();
	try {
		return new Intl.NumberFormat('ro-RO', {
			style: 'currency',
			currency: code,
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(amount);
	} catch {
		return `${amount.toFixed(2)} ${code}`;
	}
}

export interface ClientAdsHealth {
	flagged: ClientAdsHealthItem[];
	lastCheckedAt: string | null;
	totalMonitored: number;
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
	clientStatus: string | null;
	paymentStatus: AdsPaymentStatus;
	statusLabel: string;
	rawStatusCode: string;
	rawDisableReason: string | null;
	checkedAt: string | null;
	billingUrl: string;
	/** True when admin has muted alerts for this account at its current status */
	isMuted: boolean;
	/** TikTok-only: sub_status from /advertiser/info/. null for Meta/Google or when absent. */
	rawSubStatus: string | null;
	/** TikTok-only: reject_reason from /advertiser/info/. null for Meta/Google or when absent. */
	rawRejectReason: string | null;
	/** TikTok-only: display_status from /advertiser/info/. null for Meta/Google or when absent. */
	rawDisplayStatus: string | null;
	/** TikTok-only: aggregated delivery issue ('none'|'budget_exceeded'|'no_delivery'|'all_paused'). null otherwise. */
	rawDeliveryIssue: string | null;
	/** Google only: customer.suspension_reasons enum names. null for non-Google or when empty. */
	googleSuspensionReasons: string[] | null;
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

function parseRaw(raw: string | null): {
	code: string;
	disableReason: string | null;
	subStatus: string | null;
	rejectReason: string | null;
	displayStatus: string | null;
	deliveryIssue: string | null;
	googleSuspensionReasons: string[] | null;
} {
	const empty = {
		code: '',
		disableReason: null,
		subStatus: null,
		rejectReason: null,
		displayStatus: null,
		deliveryIssue: null,
		googleSuspensionReasons: null,
	};
	if (!raw) return empty;
	try {
		const parsed = JSON.parse(raw);
		const tt = parsed?.tiktokSecondary ?? null;
		const googleSec = parsed?.googleSecondary ?? null;
		return {
			code: String(parsed.code ?? ''),
			disableReason: parsed.disableReason != null ? String(parsed.disableReason) : null,
			subStatus: tt?.subStatus ?? null,
			rejectReason: tt?.rejectReason ?? null,
			displayStatus: tt?.displayStatus ?? null,
			deliveryIssue: tt?.deliveryIssue ?? null,
			googleSuspensionReasons: Array.isArray(googleSec?.suspensionReasons)
				? (googleSec.suspensionReasons as string[])
				: null,
		};
	} catch {
		return { ...empty, code: raw };
	}
}

async function resolveClientInfo(
	tenantId: string,
	clientIds: string[],
): Promise<Map<string, { name: string; email: string | null; status: string | null }>> {
	if (clientIds.length === 0) return new Map();
	const rows = await db
		.select({
			id: table.client.id,
			name: table.client.name,
			email: table.client.email,
			status: table.client.status,
		})
		.from(table.client)
		.where(
			and(
				eq(table.client.tenantId, tenantId),
				inArray(table.client.id, clientIds),
			),
		);
	return new Map(
		rows.map((r) => [r.id, { name: r.name, email: r.email ?? null, status: r.status ?? null }]),
	);
}

export const getAdsPaymentStatusDashboard = query(
	v.object({
		showOnlyActiveClients: v.optional(v.boolean(), true),
	}),
	async (args) => {
		const event = requireAdmin();
		const tenantId = event.locals.tenant!.id;
		const showOnlyActiveClients = args.showOnlyActiveClients;

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
				alertMutedAtStatus: table.metaAdsAccount.alertMutedAtStatus,
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
				alertMutedAtStatus: table.googleAdsAccount.alertMutedAtStatus,
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
				alertMutedAtStatus: table.tiktokAdsAccount.alertMutedAtStatus,
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

		const client = row.clientId ? clientMap.get(row.clientId) ?? null : null;
		const clientStatus = client?.status ?? null;

		// With filter ON, show ONLY rows where the account is assigned to an
		// active client. This hides both orphan (no client) and inactive/
		// prospect clients — admin toggles the switch OFF to triage those.
		if (showOnlyActiveClients) {
			if (!row.clientId || clientStatus !== 'active') return;
		}

		byStatus[status] = (byStatus[status] ?? 0) + 1;
		byProvider[provider] = (byProvider[provider] ?? 0) + 1;

		const raw = parseRaw(row.paymentStatusRaw);

		const isMuted = row.alertMutedAtStatus != null && row.alertMutedAtStatus === status;

		flagged.push({
			provider,
			providerLabel: PROVIDER_LABEL[provider],
			accountTableId: row.id,
			externalAccountId: row.externalId,
			accountName: row.accountName || row.externalId,
			clientId: row.clientId ?? null,
			clientName: client?.name ?? null,
			clientEmail: client?.email ?? null,
			clientStatus,
			paymentStatus: status,
			statusLabel: PAYMENT_STATUS_LABEL_RO[status],
			rawStatusCode: raw.code,
			rawDisableReason: raw.disableReason,
			checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
			billingUrl: PROVIDER_BILLING_URL[provider](row.externalId),
			isMuted,
			rawSubStatus: provider === 'tiktok' ? raw.subStatus : null,
			rawRejectReason: provider === 'tiktok' ? raw.rejectReason : null,
			rawDisplayStatus: provider === 'tiktok' ? raw.displayStatus : null,
			rawDeliveryIssue: provider === 'tiktok' ? raw.deliveryIssue : null,
			googleSuspensionReasons: provider === 'google' ? raw.googleSuspensionReasons : null,
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

/**
 * Returns the list of ad accounts with non-ok payment status for a given
 * client. Shown to client users on their dashboard as an at-a-glance alert.
 * Excludes `closed` accounts (terminal — nothing for client to act on).
 */
export const getClientAdsHealth = query(
	v.object({ clientId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ clientId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		const tenantId = event.locals.tenant.id;

		// Security: client users can only query their own client's accounts.
		if (event.locals.isClientUser && event.locals.client) {
			if (event.locals.client.id !== clientId) {
				throw new Error('Unauthorized');
			}
		}

		const [meta, google, tiktok] = await Promise.all([
			db
				.select({
					externalId: table.metaAdsAccount.metaAdAccountId,
					accountName: table.metaAdsAccount.accountName,
					paymentStatus: table.metaAdsAccount.paymentStatus,
					paymentStatusRaw: table.metaAdsAccount.paymentStatusRaw,
					checkedAt: table.metaAdsAccount.paymentStatusCheckedAt,
					alertMutedAtStatus: table.metaAdsAccount.alertMutedAtStatus,
				})
				.from(table.metaAdsAccount)
				.where(
					and(
						eq(table.metaAdsAccount.tenantId, tenantId),
						eq(table.metaAdsAccount.clientId, clientId),
					),
				),
			db
				.select({
					externalId: table.googleAdsAccount.googleAdsCustomerId,
					accountName: table.googleAdsAccount.accountName,
					paymentStatus: table.googleAdsAccount.paymentStatus,
					paymentStatusRaw: table.googleAdsAccount.paymentStatusRaw,
					checkedAt: table.googleAdsAccount.paymentStatusCheckedAt,
					alertMutedAtStatus: table.googleAdsAccount.alertMutedAtStatus,
				})
				.from(table.googleAdsAccount)
				.where(
					and(
						eq(table.googleAdsAccount.tenantId, tenantId),
						eq(table.googleAdsAccount.clientId, clientId),
					),
				),
			db
				.select({
					externalId: table.tiktokAdsAccount.tiktokAdvertiserId,
					accountName: table.tiktokAdsAccount.accountName,
					paymentStatus: table.tiktokAdsAccount.paymentStatus,
					paymentStatusRaw: table.tiktokAdsAccount.paymentStatusRaw,
					checkedAt: table.tiktokAdsAccount.paymentStatusCheckedAt,
					alertMutedAtStatus: table.tiktokAdsAccount.alertMutedAtStatus,
				})
				.from(table.tiktokAdsAccount)
				.where(
					and(
						eq(table.tiktokAdsAccount.tenantId, tenantId),
						eq(table.tiktokAdsAccount.clientId, clientId),
					),
				),
		]);

		const totalMonitored = meta.length + google.length + tiktok.length;
		let lastCheckedAt: Date | null = null;
		const flagged: ClientAdsHealthItem[] = [];

		function addRow(provider: AdsProvider, row: typeof meta[number]) {
			if (row.checkedAt && (!lastCheckedAt || row.checkedAt > lastCheckedAt)) {
				lastCheckedAt = row.checkedAt;
			}
			const status = (row.paymentStatus as AdsPaymentStatus) ?? 'ok';
			// Skip ok AND closed — closed is terminal, client can't act on it.
			if (status === 'ok' || status === 'closed') return;
			// Skip accounts admin has muted at the current status. The client
			// alert would be useless noise — admin has acknowledged this one.
			if (row.alertMutedAtStatus && row.alertMutedAtStatus === status) return;
			let rawCode = '';
			let rawDisableReason: string | null = null;
			let balanceCents: number | null = null;
			let currency: string | null = null;
			let parsedRejectReason: { message: string; endsAt: string | null } | null = null;
			let googleSuspensionReasons: string[] | null = null;
			try {
				const parsed = row.paymentStatusRaw ? JSON.parse(row.paymentStatusRaw) : null;
				rawCode = parsed?.code != null ? String(parsed.code) : '';
				rawDisableReason = parsed?.disableReason != null ? String(parsed.disableReason) : null;
				balanceCents = typeof parsed?.balanceCents === 'number' ? parsed.balanceCents : null;
				currency = typeof parsed?.currency === 'string' ? parsed.currency : null;
				if (provider === 'tiktok' && parsed?.tiktokSecondary?.rejectReason) {
					parsedRejectReason = parseTikTokRejectReason(String(parsed.tiktokSecondary.rejectReason));
				}
				if (provider === 'google' && Array.isArray(parsed?.googleSecondary?.suspensionReasons)) {
					googleSuspensionReasons = parsed.googleSecondary.suspensionReasons;
				}
			} catch {
				rawCode = row.paymentStatusRaw ?? '';
			}
			flagged.push({
				provider,
				providerLabel: PROVIDER_LABEL[provider],
				externalAccountId: row.externalId,
				accountName: row.accountName || row.externalId,
				paymentStatus: status,
				statusLabel: PAYMENT_STATUS_LABEL_RO[status],
				rawStatusCode: rawCode,
				rawDisableReason,
				balanceFormatted: formatBalance(balanceCents, currency),
				action: actionForStatus(provider, status, row.externalId),
				rejectReasonMessage: parsedRejectReason?.message ?? null,
				rejectReasonEndsAt: parsedRejectReason?.endsAt ?? null,
				googleSuspensionReasons,
			});
		}

		for (const r of meta) addRow('meta', r);
		for (const r of google) addRow('google', r);
		for (const r of tiktok) addRow('tiktok', r);

		// Sort: worst first (suspended → payment_failed → risk_review → grace_period)
		const order: Record<AdsPaymentStatus, number> = {
			suspended: 0, closed: 1, payment_failed: 2, risk_review: 3, grace_period: 4, ok: 5,
		};
		flagged.sort((a, b) => order[a.paymentStatus] - order[b.paymentStatus]);

		const result: ClientAdsHealth = {
			flagged,
			lastCheckedAt: lastCheckedAt ? (lastCheckedAt as Date).toISOString() : null,
			totalMonitored,
		};
		return result;
	},
);

/**
 * Mute alerts for a specific ad account at its current payment status.
 * While the account remains at this status, no email/in-app alerts fire.
 * Auto-unmutes on status change (see reconciler).
 */
export const muteAccountAlerts = command(
	v.object({
		provider: v.picklist(['meta', 'google', 'tiktok']),
		accountTableId: v.pipe(v.string(), v.minLength(1)),
	}),
	async ({ provider, accountTableId }) => {
		const event = requireAdmin();
		const tenantId = event.locals.tenant!.id;

		// Read current paymentStatus (mute is bound to a specific status).
		let currentStatus: string | null = null;
		if (provider === 'meta') {
			const [r] = await db
				.select({ s: table.metaAdsAccount.paymentStatus })
				.from(table.metaAdsAccount)
				.where(and(eq(table.metaAdsAccount.id, accountTableId), eq(table.metaAdsAccount.tenantId, tenantId)))
				.limit(1);
			currentStatus = r?.s ?? null;
			if (!currentStatus) throw new Error('Account not found');
			await db
				.update(table.metaAdsAccount)
				.set({ alertMutedAtStatus: currentStatus })
				.where(and(eq(table.metaAdsAccount.id, accountTableId), eq(table.metaAdsAccount.tenantId, tenantId)));
		} else if (provider === 'google') {
			const [r] = await db
				.select({ s: table.googleAdsAccount.paymentStatus })
				.from(table.googleAdsAccount)
				.where(and(eq(table.googleAdsAccount.id, accountTableId), eq(table.googleAdsAccount.tenantId, tenantId)))
				.limit(1);
			currentStatus = r?.s ?? null;
			if (!currentStatus) throw new Error('Account not found');
			await db
				.update(table.googleAdsAccount)
				.set({ alertMutedAtStatus: currentStatus })
				.where(and(eq(table.googleAdsAccount.id, accountTableId), eq(table.googleAdsAccount.tenantId, tenantId)));
		} else {
			const [r] = await db
				.select({ s: table.tiktokAdsAccount.paymentStatus })
				.from(table.tiktokAdsAccount)
				.where(and(eq(table.tiktokAdsAccount.id, accountTableId), eq(table.tiktokAdsAccount.tenantId, tenantId)))
				.limit(1);
			currentStatus = r?.s ?? null;
			if (!currentStatus) throw new Error('Account not found');
			await db
				.update(table.tiktokAdsAccount)
				.set({ alertMutedAtStatus: currentStatus })
				.where(and(eq(table.tiktokAdsAccount.id, accountTableId), eq(table.tiktokAdsAccount.tenantId, tenantId)));
		}

		await getAdsPaymentStatusDashboard({ showOnlyActiveClients: true }).refresh();
		return { ok: true, mutedAtStatus: currentStatus };
	},
);

export const unmuteAccountAlerts = command(
	v.object({
		provider: v.picklist(['meta', 'google', 'tiktok']),
		accountTableId: v.pipe(v.string(), v.minLength(1)),
	}),
	async ({ provider, accountTableId }) => {
		const event = requireAdmin();
		const tenantId = event.locals.tenant!.id;

		if (provider === 'meta') {
			await db
				.update(table.metaAdsAccount)
				.set({ alertMutedAtStatus: null })
				.where(and(eq(table.metaAdsAccount.id, accountTableId), eq(table.metaAdsAccount.tenantId, tenantId)));
		} else if (provider === 'google') {
			await db
				.update(table.googleAdsAccount)
				.set({ alertMutedAtStatus: null })
				.where(and(eq(table.googleAdsAccount.id, accountTableId), eq(table.googleAdsAccount.tenantId, tenantId)));
		} else {
			await db
				.update(table.tiktokAdsAccount)
				.set({ alertMutedAtStatus: null })
				.where(and(eq(table.tiktokAdsAccount.id, accountTableId), eq(table.tiktokAdsAccount.tenantId, tenantId)));
		}

		await getAdsPaymentStatusDashboard({ showOnlyActiveClients: true }).refresh();
		return { ok: true };
	},
);

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
