import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { createNotification, type NotificationType } from '$lib/server/notifications';
import { sendAdPaymentAlertEmail } from '$lib/server/email';
import { logError, logInfo } from '$lib/server/logger';
import {
	isBadStatus,
	PAYMENT_STATUS_LABEL_RO,
	PROVIDER_BILLING_URL,
	PROVIDER_LABEL,
	priorityFor,
	type AdsPaymentStatus,
	type PaymentStatusSnapshot,
} from './payment-status-types';

function notificationTypeFor(status: AdsPaymentStatus): NotificationType {
	switch (status) {
		case 'suspended':
		case 'closed':
			return 'ad.account_suspended';
		case 'payment_failed':
			return 'ad.payment_failed';
		case 'grace_period':
			return 'ad.grace_period';
		case 'risk_review':
			return 'ad.risk_review';
		case 'ok':
			return 'ad.account_restored';
	}
}

async function persistStatus(snap: PaymentStatusSnapshot) {
	const raw = JSON.stringify({ code: snap.rawStatusCode, disableReason: snap.rawDisableReason ?? null });
	const payload = {
		paymentStatus: snap.paymentStatus,
		paymentStatusRaw: raw,
		paymentStatusCheckedAt: snap.checkedAt,
		updatedAt: snap.checkedAt,
	};

	if (snap.provider === 'meta') {
		await db.update(table.metaAdsAccount).set(payload).where(eq(table.metaAdsAccount.id, snap.accountTableId));
	} else if (snap.provider === 'google') {
		await db
			.update(table.googleAdsAccount)
			.set({
				...payload,
				status: String(snap.rawStatusCode),
				billingSetupStatus: snap.rawDisableReason ? String(snap.rawDisableReason) : null,
			})
			.where(eq(table.googleAdsAccount.id, snap.accountTableId));
	} else if (snap.provider === 'tiktok') {
		await db
			.update(table.tiktokAdsAccount)
			.set({ ...payload, status: String(snap.rawStatusCode) })
			.where(eq(table.tiktokAdsAccount.id, snap.accountTableId));
	}
}

interface PriorStatusInfo {
	status: AdsPaymentStatus | null;
	everChecked: boolean;
}

async function readPriorStatus(snap: PaymentStatusSnapshot): Promise<PriorStatusInfo> {
	if (snap.provider === 'meta') {
		const [row] = await db
			.select({
				paymentStatus: table.metaAdsAccount.paymentStatus,
				checkedAt: table.metaAdsAccount.paymentStatusCheckedAt,
			})
			.from(table.metaAdsAccount)
			.where(eq(table.metaAdsAccount.id, snap.accountTableId))
			.limit(1);
		return {
			status: (row?.paymentStatus as AdsPaymentStatus) ?? null,
			everChecked: row?.checkedAt != null,
		};
	}
	if (snap.provider === 'google') {
		const [row] = await db
			.select({
				paymentStatus: table.googleAdsAccount.paymentStatus,
				checkedAt: table.googleAdsAccount.paymentStatusCheckedAt,
			})
			.from(table.googleAdsAccount)
			.where(eq(table.googleAdsAccount.id, snap.accountTableId))
			.limit(1);
		return {
			status: (row?.paymentStatus as AdsPaymentStatus) ?? null,
			everChecked: row?.checkedAt != null,
		};
	}
	const [row] = await db
		.select({
			paymentStatus: table.tiktokAdsAccount.paymentStatus,
			checkedAt: table.tiktokAdsAccount.paymentStatusCheckedAt,
		})
		.from(table.tiktokAdsAccount)
		.where(eq(table.tiktokAdsAccount.id, snap.accountTableId))
		.limit(1);
	return {
		status: (row?.paymentStatus as AdsPaymentStatus) ?? null,
		everChecked: row?.checkedAt != null,
	};
}

async function resolveAdminRecipients(tenantId: string): Promise<Array<{ userId: string; email: string }>> {
	const rows = await db
		.select({ userId: table.tenantUser.userId, email: table.user.email })
		.from(table.tenantUser)
		.innerJoin(table.user, eq(table.user.id, table.tenantUser.userId))
		.where(eq(table.tenantUser.tenantId, tenantId));
	return rows.filter((r) => r.email).filter((r) => {
		return true;
	}).map((r) => ({ userId: r.userId, email: r.email as string }));
}

async function resolveClientRecipients(
	tenantId: string,
	clientId: string,
): Promise<{ userRecipients: Array<{ userId: string; email: string }>; clientEmailFallback: string | null }> {
	const users = await db
		.select({ userId: table.clientUser.userId, email: table.user.email })
		.from(table.clientUser)
		.innerJoin(table.user, eq(table.user.id, table.clientUser.userId))
		.where(eq(table.clientUser.clientId, clientId));

	let clientEmailFallback: string | null = null;
	if (users.length === 0) {
		const [c] = await db
			.select({ email: table.client.email })
			.from(table.client)
			.where(eq(table.client.id, clientId))
			.limit(1);
		clientEmailFallback = c?.email ?? null;
	}

	return {
		userRecipients: users.map((u) => ({ userId: u.userId, email: u.email as string })).filter((u) => u.email),
		clientEmailFallback,
	};
}

async function dispatchNotifications(
	snap: PaymentStatusSnapshot,
	tenantId: string,
	prior: AdsPaymentStatus | null,
): Promise<void> {
	const type = notificationTypeFor(snap.paymentStatus);
	const priority = priorityFor(snap.paymentStatus);
	const statusLabel = PAYMENT_STATUS_LABEL_RO[snap.paymentStatus];
	const providerLabel = PROVIDER_LABEL[snap.provider];
	const billingUrl = PROVIDER_BILLING_URL[snap.provider](snap.externalAccountId);

	const isRestored = snap.paymentStatus === 'ok' && prior !== null && isBadStatus(prior);
	const title = isRestored
		? `✅ Cont ${providerLabel} ${snap.accountName} — restabilit`
		: `⚠️ Cont ${providerLabel} ${snap.accountName}: ${statusLabel}`;

	const messageBase = isRestored
		? `Contul ${snap.accountName} (${snap.externalAccountId}) pe ${providerLabel} este din nou activ.`
		: `Contul ${snap.accountName} (${snap.externalAccountId}) pe ${providerLabel} are status ${statusLabel.toLowerCase()}. Cod raw: ${snap.rawStatusCode}.`;

	const metadata = {
		provider: snap.provider,
		externalAccountId: snap.externalAccountId,
		paymentStatus: snap.paymentStatus,
		priorStatus: prior,
		rawStatusCode: snap.rawStatusCode,
		rawDisableReason: snap.rawDisableReason ?? null,
	};

	// --- Admins ---
	const admins = await resolveAdminRecipients(tenantId);
	for (const admin of admins) {
		try {
			await createNotification({
				tenantId,
				userId: admin.userId,
				clientId: null,
				type,
				title,
				message: messageBase,
				link: null,
				metadata,
				priority,
			});
			if (!isRestored && admin.email) {
				await sendAdPaymentAlertEmail(tenantId, admin.email, {
					provider: snap.provider,
					providerLabel,
					accountName: snap.accountName,
					externalAccountId: snap.externalAccountId,
					statusLabelRo: statusLabel,
					paymentStatus: snap.paymentStatus,
					billingUrl,
					rawStatusCode: snap.rawStatusCode,
					rawDisableReason: snap.rawDisableReason,
					recipientType: 'admin',
				});
			}
		} catch (err) {
			logError('server', `Failed to notify admin ${admin.userId} for ${snap.provider}:${snap.externalAccountId}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	// --- Client recipients ---
	if (snap.clientId) {
		const { userRecipients, clientEmailFallback } = await resolveClientRecipients(tenantId, snap.clientId);
		for (const u of userRecipients) {
			try {
				await createNotification({
					tenantId,
					userId: u.userId,
					clientId: snap.clientId,
					type,
					title,
					message: messageBase,
					link: null,
					metadata,
					priority,
				});
				if (!isRestored && u.email) {
					await sendAdPaymentAlertEmail(tenantId, u.email, {
						provider: snap.provider,
						providerLabel,
						accountName: snap.accountName,
						externalAccountId: snap.externalAccountId,
						statusLabelRo: statusLabel,
						paymentStatus: snap.paymentStatus,
						billingUrl,
						rawStatusCode: snap.rawStatusCode,
						rawDisableReason: snap.rawDisableReason,
						recipientType: 'client',
					});
				}
			} catch (err) {
				logError('server', `Failed to notify client user ${u.userId} for ${snap.provider}:${snap.externalAccountId}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		if (!isRestored && userRecipients.length === 0 && clientEmailFallback) {
			try {
				await sendAdPaymentAlertEmail(tenantId, clientEmailFallback, {
					provider: snap.provider,
					providerLabel,
					accountName: snap.accountName,
					externalAccountId: snap.externalAccountId,
					statusLabelRo: statusLabel,
					paymentStatus: snap.paymentStatus,
					billingUrl,
					rawStatusCode: snap.rawStatusCode,
					rawDisableReason: snap.rawDisableReason,
					recipientType: 'client',
				});
			} catch (err) {
				logError('server', `Failed to send fallback email to client ${snap.clientId}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}
}

export interface ReconcileResult {
	total: number;
	unchanged: number;
	transitions: number;
	restored: number;
	errors: number;
}

export async function reconcileAndAlert(
	tenantId: string,
	snapshots: PaymentStatusSnapshot[],
): Promise<ReconcileResult> {
	const result: ReconcileResult = { total: snapshots.length, unchanged: 0, transitions: 0, restored: 0, errors: 0 };

	for (const snap of snapshots) {
		try {
			const prior = await readPriorStatus(snap);

			// First observation: seed the status without firing alerts.
			// Prevents a flood of "ok → bad" transitions the first time the monitor runs.
			if (!prior.everChecked) {
				await persistStatus(snap);
				result.unchanged += 1;
				continue;
			}

			if (prior.status === snap.paymentStatus) {
				await persistStatus(snap);
				result.unchanged += 1;
				continue;
			}

			const priorBad = prior.status !== null && isBadStatus(prior.status);
			const currentBad = isBadStatus(snap.paymentStatus);

			if (currentBad || (priorBad && !currentBad)) {
				await persistStatus(snap);
				await dispatchNotifications(snap, tenantId, prior.status);
				if (!currentBad && priorBad) result.restored += 1;
				else result.transitions += 1;
			} else {
				await persistStatus(snap);
				result.unchanged += 1;
			}
		} catch (err) {
			result.errors += 1;
			logError('server', `reconcileAndAlert failed for ${snap.provider}:${snap.externalAccountId}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	logInfo('server', `Reconcile done tenant=${tenantId}`, { metadata: { ...result } });
	return result;
}
