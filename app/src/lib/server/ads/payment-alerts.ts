import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { createNotification, type NotificationType } from '$lib/server/notifications';
import { sendAdPaymentDigestEmail, type AdDigestItem } from '$lib/server/email';
import { describeStatus, parseTikTokRejectReason } from '$lib/ads/status-copy';
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

async function persistStatus(snap: PaymentStatusSnapshot, tenantId: string) {
	const raw = JSON.stringify({
		code: snap.rawStatusCode,
		disableReason: snap.rawDisableReason ?? null,
		balanceCents: snap.balanceCents ?? null,
		currency: snap.currencyCode ?? null,
		tiktokSecondary: snap.tiktokSecondary ?? null,
	});
	const payload = {
		paymentStatus: snap.paymentStatus,
		paymentStatusRaw: raw,
		paymentStatusCheckedAt: snap.checkedAt,
		updatedAt: snap.checkedAt,
	};

	if (snap.provider === 'meta') {
		await db
			.update(table.metaAdsAccount)
			.set({
				...payload,
				accountStatus: Number(snap.rawStatusCode),
				disableReason: Number(snap.rawDisableReason ?? 0),
			})
			.where(
				and(
					eq(table.metaAdsAccount.id, snap.accountTableId),
					eq(table.metaAdsAccount.tenantId, tenantId),
				),
			);
	} else if (snap.provider === 'google') {
		await db
			.update(table.googleAdsAccount)
			.set({
				...payload,
				status: String(snap.rawStatusCode),
				billingSetupStatus: snap.rawDisableReason ? String(snap.rawDisableReason) : null,
			})
			.where(
				and(
					eq(table.googleAdsAccount.id, snap.accountTableId),
					eq(table.googleAdsAccount.tenantId, tenantId),
				),
			);
	} else if (snap.provider === 'tiktok') {
		await db
			.update(table.tiktokAdsAccount)
			.set({ ...payload, status: String(snap.rawStatusCode) })
			.where(
				and(
					eq(table.tiktokAdsAccount.id, snap.accountTableId),
					eq(table.tiktokAdsAccount.tenantId, tenantId),
				),
			);
	}
}

interface PriorStatusInfo {
	status: AdsPaymentStatus | null;
	everChecked: boolean;
	lastAlertEmailAt: Date | null;
	alertMutedAtStatus: string | null;
}

async function readPriorStatus(snap: PaymentStatusSnapshot, tenantId: string): Promise<PriorStatusInfo> {
	if (snap.provider === 'meta') {
		const [row] = await db
			.select({
				paymentStatus: table.metaAdsAccount.paymentStatus,
				checkedAt: table.metaAdsAccount.paymentStatusCheckedAt,
				lastAlertEmailAt: table.metaAdsAccount.lastAlertEmailAt,
				alertMutedAtStatus: table.metaAdsAccount.alertMutedAtStatus,
			})
			.from(table.metaAdsAccount)
			.where(
				and(
					eq(table.metaAdsAccount.id, snap.accountTableId),
					eq(table.metaAdsAccount.tenantId, tenantId),
				),
			)
			.limit(1);
		return {
			status: (row?.paymentStatus as AdsPaymentStatus) ?? null,
			everChecked: row?.checkedAt != null,
			lastAlertEmailAt: row?.lastAlertEmailAt ?? null,
			alertMutedAtStatus: row?.alertMutedAtStatus ?? null,
		};
	}
	if (snap.provider === 'google') {
		const [row] = await db
			.select({
				paymentStatus: table.googleAdsAccount.paymentStatus,
				checkedAt: table.googleAdsAccount.paymentStatusCheckedAt,
				lastAlertEmailAt: table.googleAdsAccount.lastAlertEmailAt,
				alertMutedAtStatus: table.googleAdsAccount.alertMutedAtStatus,
			})
			.from(table.googleAdsAccount)
			.where(
				and(
					eq(table.googleAdsAccount.id, snap.accountTableId),
					eq(table.googleAdsAccount.tenantId, tenantId),
				),
			)
			.limit(1);
		return {
			status: (row?.paymentStatus as AdsPaymentStatus) ?? null,
			everChecked: row?.checkedAt != null,
			lastAlertEmailAt: row?.lastAlertEmailAt ?? null,
			alertMutedAtStatus: row?.alertMutedAtStatus ?? null,
		};
	}
	const [row] = await db
		.select({
			paymentStatus: table.tiktokAdsAccount.paymentStatus,
			checkedAt: table.tiktokAdsAccount.paymentStatusCheckedAt,
			lastAlertEmailAt: table.tiktokAdsAccount.lastAlertEmailAt,
			alertMutedAtStatus: table.tiktokAdsAccount.alertMutedAtStatus,
		})
		.from(table.tiktokAdsAccount)
		.where(
			and(
				eq(table.tiktokAdsAccount.id, snap.accountTableId),
				eq(table.tiktokAdsAccount.tenantId, tenantId),
			),
		)
		.limit(1);
	return {
		status: (row?.paymentStatus as AdsPaymentStatus) ?? null,
		everChecked: row?.checkedAt != null,
		lastAlertEmailAt: row?.lastAlertEmailAt ?? null,
		alertMutedAtStatus: row?.alertMutedAtStatus ?? null,
	};
}

/**
 * Per-provider helper: clear the mute on an account (set alert_muted_at_status = NULL).
 * Called when status changes away from the muted-at status — we auto-unmute so
 * the admin sees the new condition.
 */
async function clearAccountMute(provider: 'meta' | 'google' | 'tiktok', accountId: string, tenantId: string) {
	if (provider === 'meta') {
		await db
			.update(table.metaAdsAccount)
			.set({ alertMutedAtStatus: null })
			.where(and(eq(table.metaAdsAccount.id, accountId), eq(table.metaAdsAccount.tenantId, tenantId)));
	} else if (provider === 'google') {
		await db
			.update(table.googleAdsAccount)
			.set({ alertMutedAtStatus: null })
			.where(and(eq(table.googleAdsAccount.id, accountId), eq(table.googleAdsAccount.tenantId, tenantId)));
	} else {
		await db
			.update(table.tiktokAdsAccount)
			.set({ alertMutedAtStatus: null })
			.where(and(eq(table.tiktokAdsAccount.id, accountId), eq(table.tiktokAdsAccount.tenantId, tenantId)));
	}
}

/**
 * Updates last_alert_email_at for a batch of (provider, accountTableId) pairs.
 * Wrapped in try-catch by the caller — if this fails, the next poll will re-alert
 * (at-least-once over at-most-once, preferred for billing notifications).
 */
async function updateAlertTimestamps(
	tenantId: string,
	accounts: Array<{ provider: 'meta' | 'google' | 'tiktok'; accountId: string }>,
) {
	const now = new Date();
	for (const { provider, accountId } of accounts) {
		if (provider === 'meta') {
			await db
				.update(table.metaAdsAccount)
				.set({ lastAlertEmailAt: now })
				.where(and(eq(table.metaAdsAccount.id, accountId), eq(table.metaAdsAccount.tenantId, tenantId)));
		} else if (provider === 'google') {
			await db
				.update(table.googleAdsAccount)
				.set({ lastAlertEmailAt: now })
				.where(and(eq(table.googleAdsAccount.id, accountId), eq(table.googleAdsAccount.tenantId, tenantId)));
		} else {
			await db
				.update(table.tiktokAdsAccount)
				.set({ lastAlertEmailAt: now })
				.where(and(eq(table.tiktokAdsAccount.id, accountId), eq(table.tiktokAdsAccount.tenantId, tenantId)));
		}
	}
}

const RE_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function resolveAdminRecipients(tenantId: string): Promise<Array<{ userId: string; email: string }>> {
	const rows = await db
		.select({ userId: table.tenantUser.userId, email: table.user.email })
		.from(table.tenantUser)
		.innerJoin(table.user, eq(table.user.id, table.tenantUser.userId))
		.where(
			and(
				eq(table.tenantUser.tenantId, tenantId),
				inArray(table.tenantUser.role, ['owner', 'admin']),
			),
		);
	return rows
		.filter((r): r is { userId: string; email: string } => !!r.email)
		.map((r) => ({ userId: r.userId, email: r.email }));
}

async function resolveClientRecipients(
	tenantId: string,
	clientId: string,
): Promise<{ userRecipients: Array<{ userId: string; email: string }>; clientEmails: string[] }> {
	const users = await db
		.select({ userId: table.clientUser.userId, email: table.user.email })
		.from(table.clientUser)
		.innerJoin(table.user, eq(table.user.id, table.clientUser.userId))
		.where(
			and(
				eq(table.clientUser.tenantId, tenantId),
				eq(table.clientUser.clientId, clientId),
			),
		);

	const [c] = await db
		.select({ email: table.client.email })
		.from(table.client)
		.where(
			and(
				eq(table.client.id, clientId),
				eq(table.client.tenantId, tenantId),
			),
		)
		.limit(1);

	const userRecipients = users
		.filter((u): u is { userId: string; email: string } => !!u.email)
		.map((u) => ({ userId: u.userId, email: u.email }));

	// Always include the client's primary email if present, even when there
	// are linked users — the primary email (e.g. billing@) may not map to
	// a CRM user but still needs the alert.
	const userEmails = new Set(userRecipients.map((u) => u.email.toLowerCase()));
	const clientEmails: string[] = [];
	if (c?.email && !userEmails.has(c.email.toLowerCase())) {
		clientEmails.push(c.email);
	}

	return { userRecipients, clientEmails };
}

interface DigestAccumulator {
	adminByEmail: Map<string, AdDigestItem[]>;
	clientByEmail: Map<string, AdDigestItem[]>;
	/** Accounts that were included in at least one digest entry this run.
	 * Used to update last_alert_email_at after flush (not embedded in AdDigestItem
	 * to avoid leaking internal IDs into the email payload). */
	sentAccounts: Array<{ provider: 'meta' | 'google' | 'tiktok'; accountId: string }>;
}

async function resolveClientInfo(
	tenantId: string,
	clientId: string,
): Promise<{ name: string | null; status: string | null }> {
	const [c] = await db
		.select({ name: table.client.name, status: table.client.status })
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	return { name: c?.name ?? null, status: c?.status ?? null };
}

/**
 * For a single transition, create in-app notifications (per-recipient, dedup via
 * fingerprint in `createNotification`) AND accumulate digest items for emails.
 * Emails themselves are NOT sent here — the caller flushes the digest accumulator
 * once after processing all transitions in a tenant run.
 *
 * Suppression rules:
 * - If the account's client has status != 'active' (e.g., 'inactive' or
 *   'prospect'), we skip ALL notifications (no in-app, no email). Accounts
 *   with no client (orphan) are treated as if the client were active.
 * - If the account's new status is 'closed' OR restoration, we skip the email
 *   digest item (in-app still fires for history).
 */
async function collectTransitionNotifications(
	snap: PaymentStatusSnapshot,
	tenantId: string,
	prior: AdsPaymentStatus | null,
	digest: DigestAccumulator,
): Promise<void> {
	const type = notificationTypeFor(snap.paymentStatus);
	const priority = priorityFor(snap.paymentStatus);
	const statusLabel = PAYMENT_STATUS_LABEL_RO[snap.paymentStatus];
	const providerLabel = PROVIDER_LABEL[snap.provider];
	const billingUrl = PROVIDER_BILLING_URL[snap.provider](snap.externalAccountId);

	const isRestored = snap.paymentStatus === 'ok' && prior !== null && isBadStatus(prior);
	const isClosed = snap.paymentStatus === 'closed';

	// Resolve client info (null for orphan accounts).
	const clientInfo = snap.clientId ? await resolveClientInfo(tenantId, snap.clientId) : null;

	// Suppress entirely for inactive/prospect clients. Orphans (no client) fall
	// through to notify admins (they need to triage).
	if (clientInfo && clientInfo.status && clientInfo.status !== 'active') {
		return;
	}

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

	const clientName = clientInfo?.name ?? null;
	// Email is suppressed for restored transitions (existing design) and
	// for 'closed' accounts (nothing actionable — already closed).
	const suppressEmail = isRestored || isClosed;

	// Format balance when present so clients see the exact amount owed.
	let balanceFormatted: string | null = null;
	if (snap.balanceCents != null && snap.balanceCents !== 0) {
		const amount = Math.abs(snap.balanceCents) / 100;
		const code = (snap.currencyCode || 'RON').toUpperCase();
		try {
			balanceFormatted = new Intl.NumberFormat('ro-RO', {
				style: 'currency',
				currency: code,
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).format(amount);
		} catch {
			balanceFormatted = `${amount.toFixed(2)} ${code}`;
		}
	}

	// Derive the rich Romanian explainer so the email mirrors the client-side
	// alert card. TikTok accounts with an explicit rejection_reason get a
	// translated message + deadline; STATUS_ENABLE + no_delivery/budget_exceeded
	// get the specific sub-reason copy; all other statuses get generic guidance.
	const rejectParsed =
		snap.provider === 'tiktok'
			? parseTikTokRejectReason(snap.tiktokSecondary?.rejectReason ?? null)
			: null;
	const details = describeStatus({
		provider: snap.provider,
		paymentStatus: snap.paymentStatus,
		rawDisableReason:
			typeof snap.rawDisableReason === 'string' ? snap.rawDisableReason : null,
		rejectReasonMessage: rejectParsed?.message ?? null,
		rejectReasonEndsAt: rejectParsed?.endsAt ?? null,
	});

	const baseDigestItem: AdDigestItem = {
		provider: snap.provider,
		providerLabel,
		accountName: snap.accountName,
		externalAccountId: snap.externalAccountId,
		paymentStatus: snap.paymentStatus,
		statusLabelRo: statusLabel,
		rawStatusCode: snap.rawStatusCode,
		rawDisableReason: snap.rawDisableReason,
		billingUrl,
		balanceFormatted,
		details,
	};

	// Track whether this account landed in ANY email digest this run, so we can
	// update last_alert_email_at after successful flush (single entry regardless
	// of how many recipients).
	let addedToDigest = false;

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
		} catch (err) {
			logError('server', `Failed to create admin notification for ${snap.provider}:${snap.externalAccountId}: ${err instanceof Error ? err.message : String(err)}`);
		}
		if (!suppressEmail && admin.email) {
			const list = digest.adminByEmail.get(admin.email) ?? [];
			list.push({ ...baseDigestItem, clientLabel: clientName ?? undefined });
			digest.adminByEmail.set(admin.email, list);
			addedToDigest = true;
		}
	}

	// --- Client recipients ---
	if (snap.clientId) {
		const { userRecipients, clientEmails } = await resolveClientRecipients(tenantId, snap.clientId);
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
			} catch (err) {
				logError('server', `Failed to create client notification for user ${u.userId}: ${err instanceof Error ? err.message : String(err)}`);
			}
			if (!suppressEmail && u.email) {
				const list = digest.clientByEmail.get(u.email) ?? [];
				list.push({ ...baseDigestItem });
				digest.clientByEmail.set(u.email, list);
				addedToDigest = true;
			}
		}
		if (!suppressEmail) {
			for (const email of clientEmails) {
				const list = digest.clientByEmail.get(email) ?? [];
				list.push({ ...baseDigestItem });
				digest.clientByEmail.set(email, list);
				addedToDigest = true;
			}
		}
	}

	if (addedToDigest) {
		digest.sentAccounts.push({ provider: snap.provider, accountId: snap.accountTableId });
	}
}

async function flushDigest(tenantId: string, digest: DigestAccumulator): Promise<void> {
	for (const [email, items] of digest.adminByEmail) {
		try {
			await sendAdPaymentDigestEmail(tenantId, email, { recipientType: 'admin', items });
		} catch (err) {
			logError('server', `Failed to send admin digest to ${email}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	for (const [email, items] of digest.clientByEmail) {
		try {
			await sendAdPaymentDigestEmail(tenantId, email, { recipientType: 'client', items });
		} catch (err) {
			logError('server', `Failed to send client digest to ${email}: ${err instanceof Error ? err.message : String(err)}`);
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

	const digest: DigestAccumulator = {
		adminByEmail: new Map(),
		clientByEmail: new Map(),
		sentAccounts: [],
	};

	for (const snap of snapshots) {
		try {
			const prior = await readPriorStatus(snap, tenantId);

			// First observation: seed the status without firing alerts.
			// Prevents a flood of "ok → bad" transitions the first time the monitor runs.
			if (!prior.everChecked) {
				await persistStatus(snap, tenantId);
				result.unchanged += 1;
				continue;
			}

			// --- MUTE CHECK ---
			// Admin-muted at a specific status. While current status matches,
			// skip notifications entirely. On status drift, auto-unmute so admin
			// sees the new condition.
			if (prior.alertMutedAtStatus && prior.alertMutedAtStatus === snap.paymentStatus) {
				await persistStatus(snap, tenantId);
				result.unchanged += 1;
				continue;
			}
			if (prior.alertMutedAtStatus && prior.alertMutedAtStatus !== snap.paymentStatus) {
				// Status drifted from the muted-at status — clear the mute and proceed.
				await clearAccountMute(snap.provider, snap.accountTableId, tenantId);
			}

			const priorBad = prior.status !== null && isBadStatus(prior.status);
			const currentBad = isBadStatus(snap.paymentStatus);
			const isTransition = prior.status !== snap.paymentStatus;
			const isStaleReminder =
				currentBad &&
				!isTransition &&
				(!prior.lastAlertEmailAt ||
					Date.now() - prior.lastAlertEmailAt.getTime() > RE_ALERT_INTERVAL_MS);

			// Dispatch when:
			//   - It's a transition to/from bad (existing behavior), OR
			//   - It's a stale reminder: still-bad status hasn't been emailed in 24h
			const shouldDispatch =
				isTransition && (currentBad || priorBad) ? true : isStaleReminder;

			await persistStatus(snap, tenantId);

			if (shouldDispatch) {
				await collectTransitionNotifications(snap, tenantId, prior.status, digest);
				if (isStaleReminder) {
					// Count re-alerts toward transitions for telemetry visibility.
					result.transitions += 1;
				} else if (!currentBad && priorBad) {
					result.restored += 1;
				} else {
					result.transitions += 1;
				}
			} else {
				result.unchanged += 1;
			}
		} catch (err) {
			result.errors += 1;
			logError('server', `reconcileAndAlert failed for ${snap.provider}:${snap.externalAccountId}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	// Flush per-recipient email digests — one email per admin/client per run,
	// regardless of how many accounts transitioned. Prevents the email storm
	// pattern observed on the initial seed incident.
	await flushDigest(tenantId, digest);

	// After successful flush, stamp last_alert_email_at so we don't re-alert
	// these accounts within the next 24h window. Best-effort — failure here
	// means next run may re-alert (at-least-once; acceptable for billing).
	try {
		await updateAlertTimestamps(tenantId, digest.sentAccounts);
	} catch (err) {
		logError('server', `updateAlertTimestamps failed tenant=${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
	}

	logInfo('server', `Reconcile done tenant=${tenantId}`, {
		metadata: {
			...result,
			adminDigestsSent: digest.adminByEmail.size,
			clientDigestsSent: digest.clientByEmail.size,
		},
	});
	return result;
}
