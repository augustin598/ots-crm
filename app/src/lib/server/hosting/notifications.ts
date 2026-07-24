import { db } from '$lib/server/db';
import { eq, and, gt, like, ne, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import {
	hostingAccount,
	hostingEmailEvent,
	daServer,
	tenant as tenantTable,
	emailSettings as emailSettingsTable,
	invoice as invoiceTable,
	invoiceSettings as invoiceSettingsTable,
	recurringInvoice,
	client as clientTable
} from '$lib/server/db/schema';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { sendWithPersistence, fetchTenantBrand, resolveFromEmail } from '$lib/server/email';
import { logEmailAttempt } from '$lib/server/email-logger';
import {
	resolveCustomerEmail,
	resolveAdminRecipients,
	NoAdminRecipientError,
	dayBucketEET
} from './notifications-helpers';
import { render as renderAccountCreated } from './email-templates/account-created';
import { render as renderProvisioningFailed } from './email-templates/provisioning-failed';
import { render as renderSuspended } from './email-templates/suspended';
import { render as renderReactivated } from './email-templates/reactivated';
import { render as renderSuspendedManual } from './email-templates/suspended-manual';
import { render as renderReactivatedManual } from './email-templates/reactivated-manual';
import {
	render as renderAdminStatusChange,
	type StatusChangeAction,
	type StatusChangeTrigger
} from './email-templates/admin-status-change';
import { render as renderRenewalReminder } from './email-templates/renewal-reminder';
import { render as renderPaymentFailed } from './email-templates/payment-failed';
import { render as renderPasswordReset } from './email-templates/password-reset';
import { render as renderProvisioningInProgress } from './email-templates/provisioning-in-progress';
import { logInfo, logError, logWarning } from '$lib/server/logger';
import { DEFAULT_VAT_PERCENT } from '$lib/server/vat/rate';

function generateEventId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Sends a single welcome email per hosting account using an atomic dedupe row.
 *
 * Dedupe strategy:
 *   1. Look up the account (tenant-scoped — cross-tenant returns 0 rows → throws).
 *   2. Null-check the encrypted credentials blob.
 *   3. Decrypt + JSON.parse credentials BEFORE the dedupe insert so transient
 *      decrypt failures (Turso ciphertext truncation) don't leak a dedupe row
 *      that would silently block all future replays of this lifetime-keyed event.
 *   4. Atomic INSERT into `hosting_email_event` with onConflictDoNothing on the
 *      unique (tenant_id, hosting_account_id, dedupe_key) index. `dedupeKey` is
 *      the literal `'created'` → one welcome email per account, lifetime.
 *   5. Insert no-op (empty returning) → another caller already sent → skip.
 *   6. Insert succeeded → resolve recipient, load daServer, render template,
 *      pre-create email_log row, call sendWithPersistence with `_retryOfLogId`,
 *      then patch the dedupe row with the resulting log id.
 *
 * Errors bubble to the caller after a structured log line — they decide retry.
 *
 * Note on `payload: null`: the dedupe key is per-account lifetime, so a
 * scheduled email-retry replay would hit the dedupe row and no-op anyway.
 * Mirroring the pattern used by sendDailyWorkReminderEmail (also payload: null).
 */
export async function notifyHostingAccountCreated(
	tenantId: string,
	accountId: string
): Promise<void> {
	// 1. Tenant-scoped lookup. Cross-tenant request returns 0 rows.
	const [account] = await db
		.select({
			id: hostingAccount.id,
			tenantId: hostingAccount.tenantId,
			clientId: hostingAccount.clientId,
			daServerId: hostingAccount.daServerId,
			daUsername: hostingAccount.daUsername,
			domain: hostingAccount.domain,
			daCredentialsEncrypted: hostingAccount.daCredentialsEncrypted
		})
		.from(hostingAccount)
		.where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
		.limit(1);

	if (!account) {
		const msg = `hosting account ${accountId} not found for tenant ${tenantId}`;
		logError('hosting-email', msg, { tenantId });
		throw new Error(msg);
	}

	if (!account.daCredentialsEncrypted) {
		throw new Error(`hosting account ${accountId} has no daCredentialsEncrypted`);
	}

	// 2. Decrypt DA credentials BEFORE the dedupe insert so transient
	//    decrypt failures (Turso ciphertext truncation) don't leak a dedupe row.
	//    Stored as encrypt(tenantId, JSON.stringify({ username, password })).
	//    Concurrency note: duplicate decrypts under parallel calls are fine —
	//    only one onConflictDoNothing insert below will win, and decrypt is
	//    cheap + idempotent.
	let creds: { username: string; password: string };
	try {
		creds = JSON.parse(decrypt(tenantId, account.daCredentialsEncrypted));
	} catch (err) {
		// Low (audit 2026-05-31): retry once on DecryptionError with a FRESH DB read.
		// Turso occasionally truncates ciphertext on a read → decrypt fails
		// transiently; re-reading the row usually returns the full blob (matches the
		// documented decrypt-retry pattern used by the Keez/Stripe factories).
		if (err instanceof DecryptionError) {
			logWarning('hosting-email', `decrypt credentials failed for account ${accountId} — retrying with fresh read`, {
				tenantId
			});
			const [fresh] = await db
				.select({ daCredentialsEncrypted: hostingAccount.daCredentialsEncrypted })
				.from(hostingAccount)
				.where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
				.limit(1);
			if (!fresh?.daCredentialsEncrypted) {
				logError('hosting-email', `decrypt retry: no credentials on fresh read for account ${accountId}`, {
					tenantId
				});
				throw err;
			}
			try {
				creds = JSON.parse(decrypt(tenantId, fresh.daCredentialsEncrypted));
			} catch (retryErr) {
				logError('hosting-email', `decrypt credentials failed after retry for account ${accountId}`, {
					tenantId
				});
				throw retryErr;
			}
		} else {
			logError('hosting-email', `decrypt credentials failed for account ${accountId}`, {
				tenantId
			});
			throw err;
		}
	}

	// 3. Atomic dedupe: insert one row with the unique-key conflict resolving to no-op.
	const dedupeKey = 'created';
	const dedupeRowId = generateEventId();
	const insertedRows = await db
		.insert(hostingEmailEvent)
		.values({
			id: dedupeRowId,
			tenantId,
			hostingAccountId: accountId,
			eventType: 'created',
			dedupeKey
		})
		.onConflictDoNothing({
			target: [
				hostingEmailEvent.tenantId,
				hostingEmailEvent.hostingAccountId,
				hostingEmailEvent.dedupeKey
			]
		})
		.returning({ id: hostingEmailEvent.id });

	if (insertedRows.length === 0) {
		// 4. Dedupe hit — another caller already sent the welcome email.
		logInfo('hosting-email', `dedupe skip account-created for account ${accountId}`, {
			tenantId
		});
		return;
	}

	const newDedupeId = insertedRows[0]?.id ?? dedupeRowId;

	try {
		// 5. Resolve recipient via Task 4 helper (3-tier fallback).
		const customer = await resolveCustomerEmail({
			id: account.id,
			tenantId: account.tenantId,
			clientId: account.clientId
		});

		// 6. Load DA server (tenant-scoped) for hostname display in template.
		const [server] = await db
			.select({
				id: daServer.id,
				tenantId: daServer.tenantId,
				hostname: daServer.hostname
			})
			.from(daServer)
			.where(and(eq(daServer.id, account.daServerId), eq(daServer.tenantId, tenantId)))
			.limit(1);

		if (!server) {
			throw new Error(
				`DA server ${account.daServerId} not found for tenant ${tenantId} (account ${accountId})`
			);
		}

		// 7. Render the welcome template.
		const { subject, html } = await renderAccountCreated({
			tenantId,
			domain: account.domain,
			daUsername: creds.username,
			daPassword: creds.password,
			daServerHost: server.hostname,
			// TODO: swap to a dedicated server.ip field if one is added to da_server schema.
			serverIp: server.hostname,
			clientName: customer.name
		});

		// 8. Pre-create the email_log row so we know its ID for the dedupe linkage.
		//    payload: null — scheduler replay would hit the dedupe row and no-op anyway.
		const emailLogId = await logEmailAttempt({
			tenantId,
			toEmail: customer.email,
			subject,
			emailType: 'hosting-account-created',
			htmlBody: html,
			payload: null
		});

		// 9. Send via the outbox; pass _retryOfLogId so it reuses our row.
		//    payload: null mirrors sendDailyWorkReminderEmail — not replay-able.
		await sendWithPersistence(
			{
				tenantId,
				toEmail: customer.email,
				subject,
				emailType: 'hosting-account-created',
				metadata: {},
				htmlBody: html,
				payload: null,
				_retryOfLogId: emailLogId
			},
			async () => {
				const brand = await fetchTenantBrand(tenantId);
				const [settings] = await db
					.select()
					.from(emailSettingsTable)
					.where(eq(emailSettingsTable.tenantId, tenantId))
					.limit(1);
				const fromEmail = resolveFromEmail(settings ?? null);
				return {
					from: `"${brand.tenantName}" <${fromEmail}>`,
					to: customer.email,
					subject,
					html,
					...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {})
				};
			}
		);

		// 10. Link the dedupe row to the email_log row for audit trail.
		await db
			.update(hostingEmailEvent)
			.set({ emailLogId })
			.where(eq(hostingEmailEvent.id, newDedupeId));

		logInfo('hosting-email', `sent account-created for account ${accountId}`, {
			tenantId,
			metadata: { emailLogId, toEmail: customer.email }
		});
	} catch (err) {
		logError('hosting-email', `notifyHostingAccountCreated failed for account ${accountId}`, {
			tenantId,
			stackTrace: err instanceof Error ? err.stack : undefined
		});
		throw err;
	}
}

/**
 * Admin alert dispatched when DA provisioning for a hosting account fails.
 *
 * Dedupe strategy (DIFFERENT from welcome — this is rolling-window, not lifetime):
 *   - The same `reason` for the same `accountId` is suppressed for 5 minutes.
 *   - Different reasons (e.g. `da_username_exists` then `da_unreachable`) within
 *     5 minutes both send: the `dedupeKey` encodes both reason and a timestamp
 *     so the LIKE prefix scan `provisioning-failed:${reason}:%` matches only
 *     the same reason class.
 *   - We deliberately do NOT use `onConflictDoNothing` here because multiple
 *     rows per account+reason ARE expected over the account's lifetime — the
 *     rolling window is the suppression mechanism, the unique index would
 *     hard-block forever.
 *
 * Multi-recipient send:
 *   - Loops over every admin/owner email from `resolveAdminRecipients`. Each
 *     send gets its own `email_log` row so audit covers every attempt.
 *   - The single dedupe row's `emailLogId` is "last writer wins" — acceptable
 *     for internal alerts where the audit trail lives on `email_log` rows
 *     keyed by `metadata.hostingAccountId`.
 *
 * Why `payload: null`: the dedupe row already suppresses retries within the
 * window. If a scheduler replay fired this notifier with the same args, it
 * would hit the rolling-dedupe SELECT and no-op. Mirrors the welcome notifier.
 *
 * Errors:
 *   - `NoAdminRecipientError` (admin config bug) is logged and rethrown so
 *     ops sees it — caller decides whether to alert another way.
 *   - SMTP/build errors bubble up after a structured error log.
 */
export async function notifyHostingProvisioningFailed(
	tenantId: string,
	accountId: string,
	reason: string,
	attemptNumber: number
): Promise<void> {
	const windowStart = new Date(Date.now() - 5 * 60 * 1000);
	const dedupeKeyPrefix = `provisioning-failed:${reason}:`;

	// 1. Rolling 5-min dedupe check. Same reason within window → no-op.
	const existing = await db
		.select({ id: hostingEmailEvent.id })
		.from(hostingEmailEvent)
		.where(
			and(
				eq(hostingEmailEvent.hostingAccountId, accountId),
				eq(hostingEmailEvent.eventType, 'provisioning-failed'),
				like(hostingEmailEvent.dedupeKey, `${dedupeKeyPrefix}%`),
				gt(hostingEmailEvent.sentAt, windowStart)
			)
		)
		.limit(1);

	if (existing.length > 0) {
		logInfo(
			'hosting-email',
			`rolling-dedupe skip provisioning-failed (${reason}) for account ${accountId}`,
			{ tenantId, metadata: { reason, attemptNumber } }
		);
		return;
	}

	// 2. Tenant-scoped account lookup.
	const [account] = await db
		.select({
			id: hostingAccount.id,
			tenantId: hostingAccount.tenantId,
			clientId: hostingAccount.clientId,
			daServerId: hostingAccount.daServerId,
			daUsername: hostingAccount.daUsername,
			domain: hostingAccount.domain
		})
		.from(hostingAccount)
		.where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
		.limit(1);

	if (!account) {
		const msg = `hosting account ${accountId} not found for tenant ${tenantId}`;
		logError('hosting-email', msg, { tenantId });
		throw new Error(msg);
	}

	// 3. Tenant lookup for slug (used in CRM deep link).
	const [tenantRow] = await db
		.select({ id: tenantTable.id, slug: tenantTable.slug })
		.from(tenantTable)
		.where(eq(tenantTable.id, tenantId))
		.limit(1);

	if (!tenantRow) {
		const msg = `tenant ${tenantId} not found`;
		logError('hosting-email', msg, { tenantId });
		throw new Error(msg);
	}

	// 4. Resolve admin recipients (owner/admin users → tenant.adminContactEmail → OPS env).
	let recipients: string[];
	try {
		recipients = await resolveAdminRecipients(tenantId);
	} catch (err) {
		logError(
			'hosting-email',
			`resolveAdminRecipients failed for tenant ${tenantId} — provisioning-failed alert blocked`,
			{
				tenantId,
				metadata: { accountId, reason, attemptNumber },
				stackTrace: err instanceof Error ? err.stack : undefined
			}
		);
		throw err;
	}

	const adminCrmUrl = `https://clients.onetopsolution.ro/${tenantRow.slug}/hosting/accounts/${accountId}`;

	// 5. Render the alert template ONCE (reused across all recipients).
	const { subject, html } = await renderProvisioningFailed({
		tenantId,
		tenantSlug: tenantRow.slug,
		accountId,
		domain: account.domain,
		reason,
		attemptNumber,
		adminCrmUrl
	});

	// 6. Fetch brand once so every buildMail call reuses the same `from`-prefix
	//    and logo attachment — avoids 1 DB read per recipient.
	const brand = await fetchTenantBrand(tenantId);

	// 7. Insert one rolling-dedupe row (no onConflictDoNothing — multiple rows
	//    per account+reason over time are expected; the rolling SELECT above
	//    is the suppression mechanism, not the unique index).
	//    Use timestamp suffix to keep `dedupeKey` unique under the table's
	//    unique(tenantId, hostingAccountId, dedupeKey) index even when many
	//    alerts fire over the account's lifetime.
	const dedupeRowId = generateEventId();
	const dedupeKey = `${dedupeKeyPrefix}${Date.now()}`;
	await db.insert(hostingEmailEvent).values({
		id: dedupeRowId,
		tenantId,
		hostingAccountId: accountId,
		eventType: 'provisioning-failed',
		dedupeKey,
		attemptNumber
	});

	// 8. Send to each recipient. Per-recipient email_log row so audit covers
	//    every attempt. Wrapped in try/catch so a partial failure (e.g.
	//    recipient #2 SMTP error) is logged and rethrown but doesn't leak as
	//    an unhandled rejection from the caller's catch block.
	//
	//    Partial-failure tradeoff: dedupe row is inserted BEFORE the loop, so
	//    if recipient #1 sends successfully but #2 fails, the rolling 5-min
	//    window blocks any subsequent fire for the same account+reason. The
	//    failed recipient may miss this specific window — they will get
	//    re-notified when (a) the 5-min window expires AND (b) the same root
	//    cause re-fires. Acceptable because most tenants have ≤2 admins,
	//    recipient #1 already received the alert, and the underlying root
	//    cause typically retries anyway. Audit trail is preserved per
	//    recipient via the per-recipient email_log rows.
	try {
		let lastEmailLogId: string | undefined;
		for (const email of recipients) {
			// Pre-create email_log row so we know its ID for the audit linkage.
			// payload: null — scheduler replay would hit the rolling-dedupe SELECT and no-op.
			const emailLogId = await logEmailAttempt({
				tenantId,
				toEmail: email,
				subject,
				emailType: 'hosting-provisioning-failed',
				htmlBody: html,
				payload: null
			});
			lastEmailLogId = emailLogId;

			await sendWithPersistence(
				{
					tenantId,
					toEmail: email,
					subject,
					emailType: 'hosting-provisioning-failed',
					metadata: { hostingAccountId: accountId, reason, attemptNumber },
					htmlBody: html,
					payload: null,
					_retryOfLogId: emailLogId
				},
				async () => {
					const [settings] = await db
						.select()
						.from(emailSettingsTable)
						.where(eq(emailSettingsTable.tenantId, tenantId))
						.limit(1);
					const fromEmail = resolveFromEmail(settings ?? null);
					return {
						from: `"${brand.tenantName}" <${fromEmail}>`,
						to: email,
						subject,
						html,
						...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {})
					};
				}
			);
		}

		// 9. Link the dedupe row to the LAST recipient's email_log row (last-writer-wins).
		if (lastEmailLogId) {
			await db
				.update(hostingEmailEvent)
				.set({ emailLogId: lastEmailLogId })
				.where(eq(hostingEmailEvent.id, dedupeRowId));
		}

		logInfo(
			'hosting-email',
			`sent provisioning-failed alert for account ${accountId} (${reason})`,
			{
				tenantId,
				metadata: { reason, attemptNumber, recipients: recipients.length }
			}
		);
	} catch (err) {
		logError(
			'hosting-email',
			`notifyHostingProvisioningFailed failed for account ${accountId} (${reason})`,
			{
				tenantId,
				metadata: { reason, attemptNumber },
				stackTrace: err instanceof Error ? err.stack : undefined
			}
		);
		throw err;
	}
}
// Re-export for downstream consumers that need to differentiate admin-config bugs.
export { NoAdminRecipientError };

/**
 * Customer email sent when payment succeeded but automatic DA provisioning did
 * NOT complete (audit H4). The post-payment dispatcher fires this INSTEAD of the
 * "payment confirmed / account ready" email so the customer never gets login
 * promises for an account that doesn't exist yet — they're told the payment was
 * received + the account is being set up by the team. Staff are alerted via the
 * admin-payment-received email (it surfaces the failed `da_provision` step).
 *
 * Resolves the recipient straight off the client row (no hosting_account needed
 * — provisioning may have failed before any account row was created, e.g. M12
 * domain_missing). Best-effort, no dedupe table: the webhook returns 200 even on
 * a failed step so Stripe does NOT auto-retry → this fires once per real event
 * delivery; a rare manual replay could re-send, which is acceptable for a
 * reassurance email. The caller (dispatcher) catches + logs so a send failure
 * never marks the webhook event failed.
 */
export async function notifyHostingProvisioningInProgress(
	tenantId: string,
	clientId: string,
	planName?: string | null
): Promise<void> {
	const [clientRow] = await db
		.select({
			id: clientTable.id,
			tenantId: clientTable.tenantId,
			email: clientTable.email,
			name: clientTable.name
		})
		.from(clientTable)
		.where(and(eq(clientTable.id, clientId), eq(clientTable.tenantId, tenantId)))
		.limit(1);

	if (!clientRow) {
		const msg = `client ${clientId} not found for tenant ${tenantId}`;
		logError('hosting-email', msg, { tenantId });
		throw new Error(msg);
	}
	if (!clientRow.email) {
		logWarning('hosting-email', `client ${clientId} has no email — provisioning-in-progress skipped`, {
			tenantId
		});
		return;
	}
	const toEmail = clientRow.email;

	const { subject, html } = await renderProvisioningInProgress({
		tenantId,
		clientName: clientRow.name ?? 'client',
		planName: planName ?? null
	});

	const emailLogId = await logEmailAttempt({
		tenantId,
		toEmail,
		subject,
		emailType: 'hosting-provisioning-in-progress',
		htmlBody: html,
		payload: null
	});

	await sendWithPersistence(
		{
			tenantId,
			toEmail,
			subject,
			emailType: 'hosting-provisioning-in-progress',
			metadata: { clientId },
			htmlBody: html,
			payload: null,
			_retryOfLogId: emailLogId
		},
		async () => {
			const brand = await fetchTenantBrand(tenantId);
			const [settings] = await db
				.select()
				.from(emailSettingsTable)
				.where(eq(emailSettingsTable.tenantId, tenantId))
				.limit(1);
			const fromEmail = resolveFromEmail(settings ?? null);
			return {
				from: `"${brand.tenantName}" <${fromEmail}>`,
				to: toEmail,
				subject,
				html,
				...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {})
			};
		}
	);

	logInfo('hosting-email', `sent provisioning-in-progress for client ${clientId}`, {
		tenantId,
		metadata: { emailLogId, toEmail }
	});
}

/**
 * Format a Date (or ISO string) as `DD.MM.YYYY` (Romanian locale).
 * Falls back to an em-dash when the input is null or invalid.
 */
function formatDateRo(d: Date | string | null): string {
	if (!d) return '—';
	const date = typeof d === 'string' ? new Date(d) : d;
	if (Number.isNaN(date.getTime())) return '—';
	return date.toLocaleDateString('ro-RO', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	});
}

/**
 * Customer alert dispatched when a hosting account is auto-suspended for an
 * unpaid invoice. Once per (invoice, calendar-day) — the 24h day-bucket
 * dedupe rolls over at local midnight (Europe/Bucharest).
 *
 * Dedupe strategy (DIFFERENT from welcome AND provisioning-failed):
 *   - `dedupeKey = \`suspended:${invoiceId}:${dayBucketEET()}\``
 *   - Atomic INSERT with onConflictDoNothing on the unique
 *     (tenantId, hostingAccountId, dedupeKey) index. Same-day second call →
 *     insert no-ops → early return.
 *   - Midnight rolls into a new bucket → a new email may fire if the suspend
 *     hook re-emits. Acceptable per spec (rolling daily reminder cadence).
 *
 * Order matters:
 *   - Recipient + DA server + invoice + tenant resolution happens BEFORE the
 *     dedupe insert so transient DB errors don't leak a dedupe row (parallel
 *     to Task 6 review fixes). A leaked row would only block for the rest of
 *     the day (less critical than account-created's lifetime lock), but we
 *     keep the pattern consistent.
 *
 * Why `payload: null`: the day-bucket dedupe already suppresses any
 * scheduler replay within the same local day. Mirrors notifyHostingAccountCreated.
 *
 * Errors:
 *   - Missing account or invoice → log + throw (caller decides retry).
 *   - SMTP/build errors bubble up after a structured error log.
 */
export async function notifyHostingSuspended(
	tenantId: string,
	accountId: string,
	invoiceId: string
): Promise<void> {
	// 1. Tenant-scoped account lookup. Cross-tenant returns 0 rows → throws.
	const [account] = await db
		.select({
			id: hostingAccount.id,
			tenantId: hostingAccount.tenantId,
			clientId: hostingAccount.clientId,
			daServerId: hostingAccount.daServerId,
			daUsername: hostingAccount.daUsername,
			domain: hostingAccount.domain
		})
		.from(hostingAccount)
		.where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
		.limit(1);

	if (!account) {
		const msg = `hosting account ${accountId} not found for tenant ${tenantId}`;
		logError('hosting-email', msg, { tenantId });
		throw new Error(msg);
	}

	// 2. Tenant-scoped invoice lookup. Cross-tenant returns 0 rows → throws.
	const [invoiceRow] = await db
		.select({
			id: invoiceTable.id,
			tenantId: invoiceTable.tenantId,
			invoiceNumber: invoiceTable.invoiceNumber,
			issueDate: invoiceTable.issueDate,
			dueDate: invoiceTable.dueDate,
			totalAmount: invoiceTable.totalAmount,
			currency: invoiceTable.currency
		})
		.from(invoiceTable)
		.where(and(eq(invoiceTable.id, invoiceId), eq(invoiceTable.tenantId, tenantId)))
		.limit(1);

	if (!invoiceRow) {
		const msg = `invoice ${invoiceId} not found for tenant ${tenantId}`;
		logError('hosting-email', msg, { tenantId, metadata: { accountId } });
		throw new Error(msg);
	}

	try {
		// 3. Resolve customer recipient (3-tier fallback in helpers).
		const customer = await resolveCustomerEmail({
			id: account.id,
			tenantId: account.tenantId,
			clientId: account.clientId
		});

		// 4. Load DA server (tenant-scoped) — kept for consistency with siblings
		//    and to assert existence early so we don't insert a dedupe row on a
		//    half-resolved tenant.
		const [server] = await db
			.select({
				id: daServer.id,
				tenantId: daServer.tenantId,
				hostname: daServer.hostname
			})
			.from(daServer)
			.where(and(eq(daServer.id, account.daServerId), eq(daServer.tenantId, tenantId)))
			.limit(1);

		if (!server) {
			throw new Error(
				`DA server ${account.daServerId} not found for tenant ${tenantId} (account ${accountId})`
			);
		}

		// 5. Tenant slug lookup → payUrl construction.
		const [tenantRow] = await db
			.select({ id: tenantTable.id, slug: tenantTable.slug })
			.from(tenantTable)
			.where(eq(tenantTable.id, tenantId))
			.limit(1);

		if (!tenantRow) {
			throw new Error(`tenant ${tenantId} not found`);
		}

		// 6. Build payUrl + render template. Points at the client portal renew page
		// (under /client/) which resolves this account's open invoice and offers
		// card payment — NOT the bare /{slug}/... staff tree (missing /client/ +
		// a nonexistent /pay route was why the old link 404'd).
		const payUrl = `https://clients.onetopsolution.ro/client/${tenantRow.slug}/hosting/accounts/${accountId}/renew`;
		// totalAmount stored in CENTS per schema (`integer('total_amount') // in cents`).
		// Fall back to 0 when null — the template renders `0.00 RON`.
		const amountDue = invoiceRow.totalAmount ?? 0;
		// Currency narrowing — schema is free-form text but our templates only
		// support these three. Anything else is normalized to RON (consistent
		// with the rest of the CRM's defaults).
		const currency = (
			invoiceRow.currency === 'EUR' || invoiceRow.currency === 'USD' ? invoiceRow.currency : 'RON'
		) as 'RON' | 'EUR' | 'USD';

		const { subject, html } = await renderSuspended({
			tenantId,
			domain: account.domain,
			clientName: customer.name,
			invoiceNumber: invoiceRow.invoiceNumber,
			invoiceDate: formatDateRo(invoiceRow.issueDate),
			amountDue,
			currency,
			payUrl,
			// TODO: pull from tenant.supportEmail when that column is added to the
			// tenant schema (tenant.adminContactEmail is admin-only, not customer-facing).
			supportEmail: 'support@onetopsolution.ro'
		});

		// 7. Atomic day-bucket dedupe insert.
		const dedupeKey = `suspended:${invoiceId}:${dayBucketEET()}`;
		const dedupeRowId = generateEventId();
		const insertedRows = await db
			.insert(hostingEmailEvent)
			.values({
				id: dedupeRowId,
				tenantId,
				hostingAccountId: accountId,
				eventType: 'suspended',
				dedupeKey
			})
			.onConflictDoNothing({
				target: [
					hostingEmailEvent.tenantId,
					hostingEmailEvent.hostingAccountId,
					hostingEmailEvent.dedupeKey
				]
			})
			.returning({ id: hostingEmailEvent.id });

		if (insertedRows.length === 0) {
			// 8. Dedupe hit — same invoice already sent today.
			logInfo(
				'hosting-email',
				`dedupe skip suspended for account ${accountId} (invoice ${invoiceId})`,
				{ tenantId }
			);
			return;
		}

		const newDedupeId = insertedRows[0]?.id ?? dedupeRowId;

		// 9. Pre-create email_log row so we know its ID for the dedupe linkage.
		//    payload: null — scheduler replay would hit the day-bucket dedupe and no-op.
		const emailLogId = await logEmailAttempt({
			tenantId,
			toEmail: customer.email,
			subject,
			emailType: 'hosting-suspended',
			htmlBody: html,
			payload: null
		});

		// 10. Send via the outbox; pass _retryOfLogId so it reuses our row.
		await sendWithPersistence(
			{
				tenantId,
				toEmail: customer.email,
				subject,
				emailType: 'hosting-suspended',
				metadata: { hostingAccountId: accountId, invoiceId },
				htmlBody: html,
				payload: null,
				_retryOfLogId: emailLogId
			},
			async () => {
				const brand = await fetchTenantBrand(tenantId);
				const [settings] = await db
					.select()
					.from(emailSettingsTable)
					.where(eq(emailSettingsTable.tenantId, tenantId))
					.limit(1);
				const fromEmail = resolveFromEmail(settings ?? null);
				return {
					from: `"${brand.tenantName}" <${fromEmail}>`,
					to: customer.email,
					subject,
					html,
					...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {})
				};
			}
		);

		// 11. Link the dedupe row to the email_log row for audit trail.
		await db
			.update(hostingEmailEvent)
			.set({ emailLogId })
			.where(eq(hostingEmailEvent.id, newDedupeId));

		logInfo(
			'hosting-email',
			`sent suspended alert for account ${accountId} (invoice ${invoiceId})`,
			{ tenantId, metadata: { emailLogId, toEmail: customer.email } }
		);

		// Fire the admin alert AFTER the customer email is queued. Best-effort:
		// failure here MUST NOT roll back the customer send. Has its own dedupe
		// row keyed on invoiceId so retries naturally collapse.
		await fireAutoAdminStatusAlert(
			tenantId,
			accountId,
			'suspended',
			invoiceId,
			invoiceRow.invoiceNumber
		);
	} catch (err) {
		logError('hosting-email', `notifyHostingSuspended failed for account ${accountId}`, {
			tenantId,
			metadata: { invoiceId },
			stackTrace: err instanceof Error ? err.stack : undefined
		});
		throw err;
	}
}

/**
 * Customer confirmation dispatched when a hosting account is unsuspended after
 * an invoice payment. Sends a single positive-confirmation email per invoice
 * (lifetime dedupe — once per invoice, ever).
 *
 * Dedupe strategy (DIFFERENT from siblings):
 *   - `dedupeKey = \`reactivated:${invoiceId}\`` — lifetime dedupe per invoice.
 *   - Atomic INSERT with onConflictDoNothing on the unique
 *     (tenantId, hostingAccountId, dedupeKey) index. Second call for the same
 *     invoice → insert no-ops → early return.
 *   - Different invoice (e.g. customer pays a NEXT cycle invoice for the same
 *     account) → different dedupeKey → email sends again.
 *
 * Multi-invoice safety (defense-in-depth):
 *   - BEFORE any expensive work, check if any OTHER unpaid hosting invoice
 *     remains for THIS hosting account. If yes → skip (no reactivation email).
 *   - The hook in directadmin/hooks.ts already enforces this guard before
 *     calling us (lines 286-305), so this is a second line of defense — a
 *     direct caller of `notifyHostingReactivated` (e.g. manual replay) won't
 *     accidentally send a "reactivated" email while other invoices are unpaid.
 *
 * Order matters:
 *   - Safety check runs FIRST — quick exit path before any DB chain or
 *     decrypt work. Mirrors the resolve-then-dedupe ordering of Tasks 6/8/9
 *     (do expensive work BEFORE the dedupe insert so transient failures
 *     don't leak a dedupe row).
 *
 * Why `payload: null`: the lifetime dedupe already suppresses any scheduler
 * replay for the same invoice. Mirrors notifyHostingSuspended.
 *
 * Errors:
 *   - Missing account or invoice → log + throw (caller decides retry).
 *   - SMTP/build errors bubble up after a structured error log.
 */
export async function notifyHostingReactivated(
	tenantId: string,
	accountId: string,
	invoiceId: string
): Promise<void> {
	// 1. Multi-invoice safety check (defense-in-depth) — query any OTHER unpaid
	//    hosting invoice for this account, tenant-scoped. Uses invoice.hostingAccountId
	//    directly (mirrors hooks.ts:286-305) — the schema propagates this from
	//    recurringInvoice when the scheduler generates hosting invoices.
	const otherUnpaid = await db
		.select({ id: invoiceTable.id })
		.from(invoiceTable)
		.where(
			and(
				eq(invoiceTable.tenantId, tenantId),
				eq(invoiceTable.hostingAccountId, accountId),
				inArray(invoiceTable.status, ['overdue', 'sent']),
				ne(invoiceTable.id, invoiceId)
			)
		)
		.limit(1);

	if (otherUnpaid.length > 0) {
		logInfo(
			'hosting-email',
			`reactivated email skipped — other unpaid invoice exists for account ${accountId}`,
			{ tenantId, metadata: { invoiceId, otherInvoiceId: otherUnpaid[0]?.id } }
		);
		return;
	}

	// 2. Tenant-scoped account lookup. Cross-tenant returns 0 rows → throws.
	const [account] = await db
		.select({
			id: hostingAccount.id,
			tenantId: hostingAccount.tenantId,
			clientId: hostingAccount.clientId,
			daServerId: hostingAccount.daServerId,
			daUsername: hostingAccount.daUsername,
			domain: hostingAccount.domain
		})
		.from(hostingAccount)
		.where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
		.limit(1);

	if (!account) {
		const msg = `hosting account ${accountId} not found for tenant ${tenantId}`;
		logError('hosting-email', msg, { tenantId });
		throw new Error(msg);
	}

	// 3. Tenant-scoped invoice lookup. Cross-tenant returns 0 rows → throws.
	const [invoiceRow] = await db
		.select({
			id: invoiceTable.id,
			tenantId: invoiceTable.tenantId,
			invoiceNumber: invoiceTable.invoiceNumber,
			issueDate: invoiceTable.issueDate,
			dueDate: invoiceTable.dueDate,
			totalAmount: invoiceTable.totalAmount,
			currency: invoiceTable.currency
		})
		.from(invoiceTable)
		.where(and(eq(invoiceTable.id, invoiceId), eq(invoiceTable.tenantId, tenantId)))
		.limit(1);

	if (!invoiceRow) {
		const msg = `invoice ${invoiceId} not found for tenant ${tenantId}`;
		logError('hosting-email', msg, { tenantId, metadata: { accountId } });
		throw new Error(msg);
	}

	try {
		// 4. Resolve customer recipient (3-tier fallback in helpers).
		const customer = await resolveCustomerEmail({
			id: account.id,
			tenantId: account.tenantId,
			clientId: account.clientId
		});

		// 5. Load DA server (tenant-scoped) for hostname → daPanelUrl.
		const [server] = await db
			.select({
				id: daServer.id,
				tenantId: daServer.tenantId,
				hostname: daServer.hostname
			})
			.from(daServer)
			.where(and(eq(daServer.id, account.daServerId), eq(daServer.tenantId, tenantId)))
			.limit(1);

		if (!server) {
			throw new Error(
				`DA server ${account.daServerId} not found for tenant ${tenantId} (account ${accountId})`
			);
		}

		// 6. Build daPanelUrl + render template.
		const daPanelUrl = `https://${server.hostname}:2222`;
		// totalAmount stored in CENTS per schema. Fall back to 0 when null — the
		// template renders `0.00 RON`.
		const amountPaid = invoiceRow.totalAmount ?? 0;
		// Currency narrowing — schema is free-form text but our templates only
		// support these three. Anything else is normalized to RON (consistent
		// with the rest of the CRM's defaults).
		const currency = (
			invoiceRow.currency === 'EUR' || invoiceRow.currency === 'USD' ? invoiceRow.currency : 'RON'
		) as 'RON' | 'EUR' | 'USD';

		const { subject, html } = await renderReactivated({
			tenantId,
			domain: account.domain,
			clientName: customer.name,
			invoiceNumber: invoiceRow.invoiceNumber,
			amountPaid,
			currency,
			daPanelUrl
		});

		// 7. Atomic lifetime dedupe insert (per invoice).
		const dedupeKey = `reactivated:${invoiceId}`;
		const dedupeRowId = generateEventId();
		const insertedRows = await db
			.insert(hostingEmailEvent)
			.values({
				id: dedupeRowId,
				tenantId,
				hostingAccountId: accountId,
				eventType: 'reactivated',
				dedupeKey
			})
			.onConflictDoNothing({
				target: [
					hostingEmailEvent.tenantId,
					hostingEmailEvent.hostingAccountId,
					hostingEmailEvent.dedupeKey
				]
			})
			.returning({ id: hostingEmailEvent.id });

		if (insertedRows.length === 0) {
			// 8. Dedupe hit — already sent for this invoice.
			logInfo(
				'hosting-email',
				`dedupe skip reactivated for account ${accountId} (invoice ${invoiceId})`,
				{ tenantId }
			);
			return;
		}

		const newDedupeId = insertedRows[0]?.id ?? dedupeRowId;

		// 9. Pre-create email_log row so we know its ID for the dedupe linkage.
		//    payload: null — scheduler replay would hit the lifetime dedupe and no-op.
		const emailLogId = await logEmailAttempt({
			tenantId,
			toEmail: customer.email,
			subject,
			emailType: 'hosting-reactivated',
			htmlBody: html,
			payload: null
		});

		// 10. Send via the outbox; pass _retryOfLogId so it reuses our row.
		await sendWithPersistence(
			{
				tenantId,
				toEmail: customer.email,
				subject,
				emailType: 'hosting-reactivated',
				metadata: { hostingAccountId: accountId, invoiceId },
				htmlBody: html,
				payload: null,
				_retryOfLogId: emailLogId
			},
			async () => {
				const brand = await fetchTenantBrand(tenantId);
				const [settings] = await db
					.select()
					.from(emailSettingsTable)
					.where(eq(emailSettingsTable.tenantId, tenantId))
					.limit(1);
				const fromEmail = resolveFromEmail(settings ?? null);
				return {
					from: `"${brand.tenantName}" <${fromEmail}>`,
					to: customer.email,
					subject,
					html,
					...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {})
				};
			}
		);

		// 11. Link the dedupe row to the email_log row for audit trail.
		await db
			.update(hostingEmailEvent)
			.set({ emailLogId })
			.where(eq(hostingEmailEvent.id, newDedupeId));

		logInfo(
			'hosting-email',
			`sent reactivated alert for account ${accountId} (invoice ${invoiceId})`,
			{ tenantId, metadata: { emailLogId, toEmail: customer.email } }
		);

		// Fire the admin alert AFTER the customer email is queued. Best-effort:
		// failure here MUST NOT roll back the customer send. Has its own dedupe
		// row keyed on invoiceId so retries naturally collapse.
		await fireAutoAdminStatusAlert(
			tenantId,
			accountId,
			'reactivated',
			invoiceId,
			invoiceRow.invoiceNumber
		);
	} catch (err) {
		logError('hosting-email', `notifyHostingReactivated failed for account ${accountId}`, {
			tenantId,
			metadata: { invoiceId },
			stackTrace: err instanceof Error ? err.stack : undefined
		});
		throw err;
	}
}

/**
 * Format a YYYY-MM-DD text date (the `next_due_date` schema convention) as
 * `DD.MM.YYYY` (Romanian locale). Throws if the input isn't parseable — the
 * caller already verified the value is non-null, so an invalid format is a
 * programming/data bug worth surfacing rather than silently falling back.
 */
function formatTextDateRo(textDate: string): string {
	const date = new Date(textDate);
	if (Number.isNaN(date.getTime())) {
		throw new Error(`invalid nextDueDate format: ${textDate}`);
	}
	return date.toLocaleDateString('ro-RO', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	});
}

/**
 * Customer reminder dispatched in advance of a hosting account's renewal date.
 * Three windows fire over the renewal cycle: 14 / 7 / 1 days before due. Each
 * window sends at most once per (account, dueDate, window) tuple — the dedupe
 * key encodes the due date so a renewed account (new nextDueDate) starts a
 * fresh reminder cycle.
 *
 * Dedupe strategy:
 *   - `dedupeKey = \`renewal-reminder:${dueDateIso}:${daysUntilDue}d\``
 *   - Atomic INSERT with onConflictDoNothing on the unique
 *     (tenantId, hostingAccountId, dedupeKey) index. Second call for the same
 *     (dueDate, window) → insert no-ops → early return.
 *   - When the cycle renews and nextDueDate moves forward, the new dueDateIso
 *     produces a different dedupeKey → reminders fire again for the new cycle.
 *
 * Order matters:
 *   - Resolution + template render happen BEFORE the dedupe insert so
 *     transient DB errors don't leak a dedupe row (parallel to Task 6/9/10
 *     review fixes). A leaked row would block the entire window for this due
 *     date, missing the customer's heads-up.
 *
 * Why `payload: null`: the scheduler task re-runs hourly (08-20 RO) and the
 * dedupe blocks duplicates, so replay via the email outbox would just be
 * redundant DB churn. Mirrors the other hosting notifiers.
 *
 * Errors:
 *   - Missing account or null nextDueDate → log + throw (caller decides retry).
 *     For the scheduler the catch surfaces in the task's per-account loop
 *     (skipped++) so one bad account never breaks the whole run.
 *   - SMTP/build errors bubble up after a structured error log.
 */
export async function notifyHostingRenewalReminder(
	tenantId: string,
	accountId: string,
	daysUntilDue: 1 | 7 | 14
): Promise<void> {
	// 1. Tenant-scoped account lookup. Cross-tenant returns 0 rows → throws.
	const [account] = await db
		.select({
			id: hostingAccount.id,
			tenantId: hostingAccount.tenantId,
			clientId: hostingAccount.clientId,
			daServerId: hostingAccount.daServerId,
			daUsername: hostingAccount.daUsername,
			domain: hostingAccount.domain,
			nextDueDate: hostingAccount.nextDueDate,
			recurringAmount: hostingAccount.recurringAmount,
			currency: hostingAccount.currency,
			autoRenew: hostingAccount.autoRenew
		})
		.from(hostingAccount)
		.where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
		.limit(1);

	if (!account) {
		const msg = `hosting account ${accountId} not found for tenant ${tenantId}`;
		logError('hosting-email', msg, { tenantId });
		throw new Error(msg);
	}

	if (!account.nextDueDate) {
		const msg = `hosting account ${accountId} has no nextDueDate — cannot send renewal reminder`;
		logError('hosting-email', msg, { tenantId, metadata: { accountId } });
		throw new Error(msg);
	}

	try {
		// 2. Resolve customer recipient (3-tier fallback in helpers).
		const customer = await resolveCustomerEmail({
			id: account.id,
			tenantId: account.tenantId,
			clientId: account.clientId
		});

		// 3. Tenant slug lookup → payUrl construction.
		const [tenantRow] = await db
			.select({ id: tenantTable.id, slug: tenantTable.slug })
			.from(tenantTable)
			.where(eq(tenantTable.id, tenantId))
			.limit(1);

		if (!tenantRow) {
			throw new Error(`tenant ${tenantId} not found`);
		}

		// 4. Format Romanian date + build payUrl. Under /client/ (portal route group)
		// so it reaches the real renew page, not the staff tree (the missing /client/
		// prefix was one of the two reasons the old link failed).
		const dueDateIso = account.nextDueDate; // 'YYYY-MM-DD'
		const dueDateRo = formatTextDateRo(dueDateIso);
		const payUrl = `https://clients.onetopsolution.ro/client/${tenantRow.slug}/hosting/accounts/${accountId}/renew`;

		// 5. Resolve the billed amount from the recurring-invoice template — the
		//    SAME source the scheduler bills from (recurring-invoices.ts →
		//    recurringInvoice.amount). recurring-template.ts syncs that row from the
		//    product catalog (hostingProduct.price) and INTENTIONALLY ignores
		//    hostingAccount.recurringAmount, a per-account snapshot that can drift
		//    from the catalog. Reading the snapshot here is exactly what made the
		//    email quote a different price than the invoice (e.g. 866 vs 1149).
		const [recurring] = await db
			.select({
				amount: recurringInvoice.amount,
				currency: recurringInvoice.currency,
				taxRate: recurringInvoice.taxRate // BPS (percent × 100)
			})
			.from(recurringInvoice)
			.where(
				and(
					eq(recurringInvoice.hostingAccountId, accountId),
					eq(recurringInvoice.tenantId, tenantId)
				)
			)
			.limit(1);

		// 5b. VAT fallback from tenant invoiceSettings — only used on the snapshot
		//     fallback path below. Per feedback_no_hardcode.md (RO 19% → 21% in
		//     2025/2026) never hardcode; fallback 21 matches recurring-template.ts.
		const [vatRow] = await db
			.select({ defaultTaxRate: invoiceSettingsTable.defaultTaxRate })
			.from(invoiceSettingsTable)
			.where(eq(invoiceSettingsTable.tenantId, tenantId))
			.limit(1);
		const fallbackVatRate = vatRow?.defaultTaxRate ?? DEFAULT_VAT_PERCENT;

		// 5c. Pick the price source: the recurring-invoice template (catalog-derived,
		//     == what the customer is actually billed) when present, else the
		//     snapshot as a last resort so the reminder still sends — logged as a
		//     warning so the drift is traceable.
		let subtotal: number;
		let vatRate: number;
		let currencyRaw: string;
		if (recurring && recurring.amount > 0) {
			subtotal = recurring.amount;
			// recurringInvoice.taxRate is BPS (e.g. 2100 = 21%) → integer percent.
			vatRate = recurring.taxRate ? Math.round(recurring.taxRate / 100) : fallbackVatRate;
			currencyRaw = recurring.currency ?? account.currency ?? 'RON';
		} else {
			logWarning(
				'hosting-email',
				`renewal reminder falling back to recurringAmount snapshot — no recurringInvoice template for account ${accountId}`,
				{ tenantId, metadata: { accountId } }
			);
			subtotal = Number(account.recurringAmount ?? 0);
			vatRate = fallbackVatRate;
			currencyRaw = account.currency ?? 'RON';
		}

		// 5d. Currency narrowing — templates support only these three; anything
		//     else is normalized to RON (consistent with the rest of the CRM).
		const currency = (
			currencyRaw === 'EUR' || currencyRaw === 'USD' ? currencyRaw : 'RON'
		) as 'RON' | 'EUR' | 'USD';

		const vatAmount = Math.round((subtotal * vatRate) / 100);
		const totalAmount = subtotal + vatAmount;

		// 6. Render template with all inputs.
		const { subject, html } = await renderRenewalReminder({
			tenantId,
			domain: account.domain,
			clientName: customer.name,
			dueDate: dueDateRo,
			subtotal,
			vatRate,
			vatAmount,
			totalAmount,
			currency,
			daysUntilDue,
			autoRenew: account.autoRenew,
			payUrl
		});

		// 7. Atomic dedupe insert keyed on (dueDateIso, window).
		const dedupeKey = `renewal-reminder:${dueDateIso}:${daysUntilDue}d`;
		const dedupeRowId = generateEventId();
		const insertedRows = await db
			.insert(hostingEmailEvent)
			.values({
				id: dedupeRowId,
				tenantId,
				hostingAccountId: accountId,
				eventType: 'renewal-reminder',
				dedupeKey
			})
			.onConflictDoNothing({
				target: [
					hostingEmailEvent.tenantId,
					hostingEmailEvent.hostingAccountId,
					hostingEmailEvent.dedupeKey
				]
			})
			.returning({ id: hostingEmailEvent.id });

		if (insertedRows.length === 0) {
			// 8. Dedupe hit — already sent for this (dueDate, window).
			logInfo(
				'hosting-email',
				`dedupe skip renewal-reminder for account ${accountId} (${dueDateIso} / ${daysUntilDue}d)`,
				{ tenantId }
			);
			return;
		}

		const newDedupeId = insertedRows[0]?.id ?? dedupeRowId;

		// 9. Pre-create email_log row so we know its ID for the dedupe linkage.
		//    payload: null — scheduler replay would hit the (dueDate, window) dedupe and no-op.
		const emailLogId = await logEmailAttempt({
			tenantId,
			toEmail: customer.email,
			subject,
			emailType: 'hosting-renewal-reminder',
			htmlBody: html,
			payload: null
		});

		// 10. Send via the outbox; pass _retryOfLogId so it reuses our row.
		//     Note: emailType is NOT in TRANSACTIONAL_TYPES (see email.ts:876-879)
		//     so sendWithPersistence automatically adds RFC 8058 List-Unsubscribe
		//     headers — no flag needed on the ctx.
		await sendWithPersistence(
			{
				tenantId,
				toEmail: customer.email,
				subject,
				emailType: 'hosting-renewal-reminder',
				metadata: { hostingAccountId: accountId, dueDate: dueDateIso, daysUntilDue },
				htmlBody: html,
				payload: null,
				_retryOfLogId: emailLogId
			},
			async () => {
				const brand = await fetchTenantBrand(tenantId);
				const [settings] = await db
					.select()
					.from(emailSettingsTable)
					.where(eq(emailSettingsTable.tenantId, tenantId))
					.limit(1);
				const fromEmail = resolveFromEmail(settings ?? null);
				return {
					from: `"${brand.tenantName}" <${fromEmail}>`,
					to: customer.email,
					subject,
					html,
					...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {})
				};
			}
		);

		// 11. Link the dedupe row to the email_log row for audit trail.
		await db
			.update(hostingEmailEvent)
			.set({ emailLogId })
			.where(eq(hostingEmailEvent.id, newDedupeId));

		logInfo(
			'hosting-email',
			`sent renewal-reminder for account ${accountId} (${dueDateIso} / ${daysUntilDue}d)`,
			{ tenantId, metadata: { emailLogId, toEmail: customer.email } }
		);
	} catch (err) {
		logError('hosting-email', `notifyHostingRenewalReminder failed for account ${accountId}`, {
			tenantId,
			metadata: { daysUntilDue },
			stackTrace: err instanceof Error ? err.stack : undefined
		});
		throw err;
	}
}

/**
 * Customer alert dispatched when Stripe reports a recurring payment failure
 * (`invoice.payment_failed` webhook). Sends a single notification per CRM
 * invoice for the lifetime of that invoice — Stripe retries each declined
 * charge multiple times over the smart-retry window (typically 4 attempts
 * spread over a week), and we don't want to spam the customer with the same
 * "update your card" reminder on every retry. The CRM `invoiceId` keys the
 * dedupe so a brand-new failing invoice on the next billing cycle still
 * triggers a fresh email.
 *
 * Dedupe strategy (LIFETIME per CRM invoice):
 *   - `dedupeKey = \`payment-failed:${invoiceId}\`` — one email per CRM
 *     invoice, forever.
 *   - Atomic INSERT with onConflictDoNothing on the unique
 *     (tenantId, hostingAccountId, dedupeKey) index. Second call for the same
 *     invoice → insert no-ops → early return.
 *   - Different invoice (next billing cycle, fresh failure) → different
 *     dedupeKey → fresh email.
 *
 * Order matters:
 *   - Resolution + template render happen BEFORE the dedupe insert so
 *     transient DB errors don't leak a dedupe row (parallel to Task 6/9/10/11
 *     review fixes). A leaked row here would suppress the customer's only
 *     heads-up for this billing cycle.
 *
 * Why `payload: null`: the lifetime dedupe already suppresses any scheduler
 * replay for the same invoice. Mirrors notifyHostingReactivated (also lifetime
 * per invoice).
 *
 * Errors:
 *   - Missing account or invoice → log + throw (caller decides retry).
 *   - SMTP/build errors bubble up after a structured error log.
 */
export async function notifyHostingPaymentFailed(
	tenantId: string,
	accountId: string,
	invoiceId: string,
	failureReason: string,
	updateMethodUrl?: string
): Promise<void> {
	// 1. Tenant-scoped account lookup. Cross-tenant returns 0 rows → throws.
	const [account] = await db
		.select({
			id: hostingAccount.id,
			tenantId: hostingAccount.tenantId,
			clientId: hostingAccount.clientId,
			daServerId: hostingAccount.daServerId,
			daUsername: hostingAccount.daUsername,
			domain: hostingAccount.domain
		})
		.from(hostingAccount)
		.where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
		.limit(1);

	if (!account) {
		const msg = `hosting account ${accountId} not found for tenant ${tenantId}`;
		logError('hosting-email', msg, { tenantId });
		throw new Error(msg);
	}

	// 2. Tenant-scoped invoice lookup. Cross-tenant returns 0 rows → throws.
	const [invoiceRow] = await db
		.select({
			id: invoiceTable.id,
			tenantId: invoiceTable.tenantId,
			invoiceNumber: invoiceTable.invoiceNumber,
			issueDate: invoiceTable.issueDate,
			dueDate: invoiceTable.dueDate,
			totalAmount: invoiceTable.totalAmount,
			currency: invoiceTable.currency
		})
		.from(invoiceTable)
		.where(and(eq(invoiceTable.id, invoiceId), eq(invoiceTable.tenantId, tenantId)))
		.limit(1);

	if (!invoiceRow) {
		const msg = `invoice ${invoiceId} not found for tenant ${tenantId}`;
		logError('hosting-email', msg, { tenantId, metadata: { accountId } });
		throw new Error(msg);
	}

	try {
		// 3. Resolve customer recipient (3-tier fallback in helpers).
		const customer = await resolveCustomerEmail({
			id: account.id,
			tenantId: account.tenantId,
			clientId: account.clientId
		});

		// 4. Tenant slug lookup → manualPayUrl construction.
		const [tenantRow] = await db
			.select({ id: tenantTable.id, slug: tenantTable.slug })
			.from(tenantTable)
			.where(eq(tenantTable.id, tenantId))
			.limit(1);

		if (!tenantRow) {
			throw new Error(`tenant ${tenantId} not found`);
		}

		// 5. Build URLs + currency normalization. manualPayUrl → client portal renew
		// page (card payment for the account's open invoice); the old bare /{slug}/
		// invoices/{id}/pay route never existed.
		const manualPayUrl = `https://clients.onetopsolution.ro/client/${tenantRow.slug}/hosting/accounts/${accountId}/renew`;
		// Stripe billing portal URL (caller passes invoice.hosted_invoice_url when
		// available). Falls back to the same CRM pay URL when the caller has no
		// portal URL — keeps the dual-CTA template happy.
		const resolvedUpdateMethodUrl = updateMethodUrl ?? manualPayUrl;

		// totalAmount stored in CENTS per schema. Fall back to 0 when null — the
		// template renders `0.00 RON`.
		const amountDue = invoiceRow.totalAmount ?? 0;
		// Currency narrowing — schema is free-form text but our templates only
		// support these three. Anything else is normalized to RON (consistent
		// with the rest of the CRM's defaults).
		const currency = (
			invoiceRow.currency === 'EUR' || invoiceRow.currency === 'USD' ? invoiceRow.currency : 'RON'
		) as 'RON' | 'EUR' | 'USD';

		// Hard-coded 10-day suspension grace per the email-flow spec. Centralized
		// here so a future copy update in only one place stays consistent with the
		// scheduled auto-suspend window (handled elsewhere).
		const daysUntilSuspend = 10;

		// 6. Render template (resolve-then-dedupe — same pattern as siblings).
		const { subject, html } = await renderPaymentFailed({
			tenantId,
			domain: account.domain,
			clientName: customer.name,
			invoiceNumber: invoiceRow.invoiceNumber,
			amountDue,
			currency,
			failureReason,
			updateMethodUrl: resolvedUpdateMethodUrl,
			manualPayUrl,
			daysUntilSuspend
		});

		// 7. Atomic lifetime dedupe insert (per CRM invoice).
		const dedupeKey = `payment-failed:${invoiceId}`;
		const dedupeRowId = generateEventId();
		const insertedRows = await db
			.insert(hostingEmailEvent)
			.values({
				id: dedupeRowId,
				tenantId,
				hostingAccountId: accountId,
				eventType: 'payment-failed',
				dedupeKey
			})
			.onConflictDoNothing({
				target: [
					hostingEmailEvent.tenantId,
					hostingEmailEvent.hostingAccountId,
					hostingEmailEvent.dedupeKey
				]
			})
			.returning({ id: hostingEmailEvent.id });

		if (insertedRows.length === 0) {
			// 8. Dedupe hit — already sent for this invoice (lifetime).
			logInfo(
				'hosting-email',
				`dedupe skip payment-failed for account ${accountId} (invoice ${invoiceId})`,
				{ tenantId }
			);
			return;
		}

		const newDedupeId = insertedRows[0]?.id ?? dedupeRowId;

		// 9. Pre-create email_log row so we know its ID for the dedupe linkage.
		//    payload: null — scheduler replay would hit the lifetime dedupe and no-op.
		const emailLogId = await logEmailAttempt({
			tenantId,
			toEmail: customer.email,
			subject,
			emailType: 'hosting-payment-failed',
			htmlBody: html,
			payload: null
		});

		// 10. Send via the outbox; pass _retryOfLogId so it reuses our row.
		await sendWithPersistence(
			{
				tenantId,
				toEmail: customer.email,
				subject,
				emailType: 'hosting-payment-failed',
				metadata: { hostingAccountId: accountId, invoiceId, failureReason },
				htmlBody: html,
				payload: null,
				_retryOfLogId: emailLogId
			},
			async () => {
				const brand = await fetchTenantBrand(tenantId);
				const [settings] = await db
					.select()
					.from(emailSettingsTable)
					.where(eq(emailSettingsTable.tenantId, tenantId))
					.limit(1);
				const fromEmail = resolveFromEmail(settings ?? null);
				return {
					from: `"${brand.tenantName}" <${fromEmail}>`,
					to: customer.email,
					subject,
					html,
					...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {})
				};
			}
		);

		// 11. Link the dedupe row to the email_log row for audit trail.
		await db
			.update(hostingEmailEvent)
			.set({ emailLogId })
			.where(eq(hostingEmailEvent.id, newDedupeId));

		logInfo(
			'hosting-email',
			`sent payment-failed alert for account ${accountId} (invoice ${invoiceId})`,
			{ tenantId, metadata: { emailLogId, toEmail: customer.email, failureReason } }
		);
	} catch (err) {
		logError('hosting-email', `notifyHostingPaymentFailed failed for account ${accountId}`, {
			tenantId,
			metadata: { invoiceId, failureReason },
			stackTrace: err instanceof Error ? err.stack : undefined
		});
		throw err;
	}
}

/**
 * Email-uri trimise după ce un admin resetează manual parola unui cont de hosting.
 *
 * Spre deosebire de welcome (dedupe `lifetime`), reset-ul de parolă se poate
 * întâmpla de mai multe ori per cont, deci dedupeKey include un timestamp
 * (`password-reset:<ms>`) astfel încât fiecare reset trimite un email separat,
 * iar audit-ul rămâne 1-la-1 cu fiecare acțiune.
 *
 * Decryptul credențialelor se face în remote function ÎNAINTE de a apela
 * această funcție, ca să nu duplicăm logica. Aici primim direct parola plain
 * text pentru a o trimite — apoi e dată uitării (nu o loghez nicăieri).
 */
export async function notifyHostingPasswordReset(
	tenantId: string,
	accountId: string,
	newPasswordPlain: string
): Promise<void> {
	const [account] = await db
		.select({
			id: hostingAccount.id,
			tenantId: hostingAccount.tenantId,
			clientId: hostingAccount.clientId,
			daServerId: hostingAccount.daServerId,
			daUsername: hostingAccount.daUsername,
			domain: hostingAccount.domain
		})
		.from(hostingAccount)
		.where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
		.limit(1);

	if (!account) {
		throw new Error(`hosting account ${accountId} not found for tenant ${tenantId}`);
	}

	const dedupeKey = `password-reset:${Date.now()}`;
	const dedupeRowId = generateEventId();

	const insertedRows = await db
		.insert(hostingEmailEvent)
		.values({
			id: dedupeRowId,
			tenantId,
			hostingAccountId: accountId,
			eventType: 'password-reset',
			dedupeKey
		})
		.onConflictDoNothing({
			target: [
				hostingEmailEvent.tenantId,
				hostingEmailEvent.hostingAccountId,
				hostingEmailEvent.dedupeKey
			]
		})
		.returning({ id: hostingEmailEvent.id });

	if (insertedRows.length === 0) {
		logInfo('hosting-email', `dedupe skip password-reset for account ${accountId}`, { tenantId });
		return;
	}

	const newDedupeId = insertedRows[0]?.id ?? dedupeRowId;

	try {
		const customer = await resolveCustomerEmail({
			id: account.id,
			tenantId: account.tenantId,
			clientId: account.clientId
		});

		const [server] = await db
			.select({
				id: daServer.id,
				tenantId: daServer.tenantId,
				hostname: daServer.hostname
			})
			.from(daServer)
			.where(and(eq(daServer.id, account.daServerId), eq(daServer.tenantId, tenantId)))
			.limit(1);

		if (!server) {
			throw new Error(
				`DA server ${account.daServerId} not found for tenant ${tenantId} (account ${accountId})`
			);
		}

		const { subject, html } = await renderPasswordReset({
			tenantId,
			domain: account.domain,
			daUsername: account.daUsername,
			daPassword: newPasswordPlain,
			daServerHost: server.hostname,
			clientName: customer.name
		});

		const emailLogId = await logEmailAttempt({
			tenantId,
			toEmail: customer.email,
			subject,
			emailType: 'hosting-password-reset',
			htmlBody: html,
			payload: null
		});

		await sendWithPersistence(
			{
				tenantId,
				toEmail: customer.email,
				subject,
				emailType: 'hosting-password-reset',
				metadata: { accountId },
				htmlBody: html,
				payload: null,
				_retryOfLogId: emailLogId
			},
			async () => {
				const brand = await fetchTenantBrand(tenantId);
				const [settings] = await db
					.select()
					.from(emailSettingsTable)
					.where(eq(emailSettingsTable.tenantId, tenantId))
					.limit(1);
				const fromEmail = resolveFromEmail(settings ?? null);
				return {
					from: `"${brand.tenantName}" <${fromEmail}>`,
					to: customer.email,
					subject,
					html,
					...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {})
				};
			}
		);

		await db
			.update(hostingEmailEvent)
			.set({ emailLogId })
			.where(eq(hostingEmailEvent.id, newDedupeId));

		logInfo('hosting-email', `sent password-reset for account ${accountId}`, {
			tenantId,
			metadata: { emailLogId, toEmail: customer.email }
		});
	} catch (err) {
		logError('hosting-email', `notifyHostingPasswordReset failed for account ${accountId}`, {
			tenantId,
			stackTrace: err instanceof Error ? err.stack : undefined
		});
		throw err;
	}
}

// ----------------------------------------------------------------------------
// Admin status-change alerts + manual suspend/reactivate flows.
//
// Every suspend/reactivate (manual or automatic) fires:
//   1. Customer email — rich invoice template (auto) or generic manual template (manual)
//   2. Admin alert    — internal "ops" email to resolveAdminRecipients
//
// The admin alert lives behind its own dedupe row (different eventType), so a
// customer-email dedupe hit does NOT suppress the admin alert and vice-versa.
// ----------------------------------------------------------------------------

interface SendAdminAlertOpts {
	action: StatusChangeAction;
	trigger: StatusChangeTrigger;
	actorName: string | null;
	reason: string | null;
	invoiceNumber: string | null;
	dedupeSuffix: string;
}

async function sendAdminStatusChangeAlert(
	tenantId: string,
	accountId: string,
	opts: SendAdminAlertOpts
): Promise<void> {
	let recipients: string[];
	try {
		recipients = await resolveAdminRecipients(tenantId);
	} catch (err) {
		if (err instanceof NoAdminRecipientError) {
			logInfo(
				'hosting-email',
				`admin status-change alert skipped — no admin recipients resolved for tenant ${tenantId}`,
				{ tenantId, metadata: { accountId, action: opts.action, trigger: opts.trigger } }
			);
			return;
		}
		throw err;
	}

	const [account] = await db
		.select({
			id: hostingAccount.id,
			tenantId: hostingAccount.tenantId,
			daUsername: hostingAccount.daUsername,
			domain: hostingAccount.domain
		})
		.from(hostingAccount)
		.where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
		.limit(1);
	if (!account) {
		throw new Error(`hosting account ${accountId} not found for tenant ${tenantId}`);
	}

	const [tenantRow] = await db
		.select({ id: tenantTable.id, slug: tenantTable.slug })
		.from(tenantTable)
		.where(eq(tenantTable.id, tenantId))
		.limit(1);
	if (!tenantRow) throw new Error(`tenant ${tenantId} not found`);

	const dedupeKey = `admin-status-change:${opts.action}:${opts.trigger}${opts.dedupeSuffix}`;
	const dedupeRowId = generateEventId();
	const insertedRows = await db
		.insert(hostingEmailEvent)
		.values({
			id: dedupeRowId,
			tenantId,
			hostingAccountId: accountId,
			eventType: 'admin-status-change',
			dedupeKey
		})
		.onConflictDoNothing({
			target: [
				hostingEmailEvent.tenantId,
				hostingEmailEvent.hostingAccountId,
				hostingEmailEvent.dedupeKey
			]
		})
		.returning({ id: hostingEmailEvent.id });

	if (insertedRows.length === 0) {
		logInfo(
			'hosting-email',
			`dedupe skip admin status-change alert for account ${accountId} (${dedupeKey})`,
			{ tenantId }
		);
		return;
	}

	const adminCrmUrl = `https://clients.onetopsolution.ro/${tenantRow.slug}/hosting/accounts/${accountId}`;
	const { subject, html } = await renderAdminStatusChange({
		tenantId,
		tenantSlug: tenantRow.slug,
		accountId,
		domain: account.domain,
		daUsername: account.daUsername,
		action: opts.action,
		trigger: opts.trigger,
		actorName: opts.actorName,
		reason: opts.reason,
		invoiceNumber: opts.invoiceNumber,
		adminCrmUrl
	});

	const brand = await fetchTenantBrand(tenantId);
	const [settings] = await db
		.select()
		.from(emailSettingsTable)
		.where(eq(emailSettingsTable.tenantId, tenantId))
		.limit(1);
	const fromEmail = resolveFromEmail(settings ?? null);

	let lastEmailLogId: string | undefined;
	for (const email of recipients) {
		const emailLogId = await logEmailAttempt({
			tenantId,
			toEmail: email,
			subject,
			emailType: 'hosting-admin-status-change',
			htmlBody: html,
			payload: null
		});
		lastEmailLogId = emailLogId;

		await sendWithPersistence(
			{
				tenantId,
				toEmail: email,
				subject,
				emailType: 'hosting-admin-status-change',
				metadata: {
					hostingAccountId: accountId,
					action: opts.action,
					trigger: opts.trigger
				},
				htmlBody: html,
				payload: null,
				_retryOfLogId: emailLogId
			},
			async () => ({
				from: `"${brand.tenantName}" <${fromEmail}>`,
				to: email,
				subject,
				html,
				...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {})
			})
		);
	}

	if (lastEmailLogId) {
		await db
			.update(hostingEmailEvent)
			.set({ emailLogId: lastEmailLogId })
			.where(eq(hostingEmailEvent.id, insertedRows[0]?.id ?? dedupeRowId));
	}

	logInfo(
		'hosting-email',
		`sent admin status-change alert for account ${accountId} (${opts.action}/${opts.trigger}) to ${recipients.length} recipient(s)`,
		{ tenantId, metadata: { accountId, action: opts.action, trigger: opts.trigger } }
	);
}

export async function notifyHostingSuspendedManual(
	tenantId: string,
	accountId: string,
	opts: { reason: string | null; actorName: string | null }
): Promise<void> {
	const [account] = await db
		.select({
			id: hostingAccount.id,
			tenantId: hostingAccount.tenantId,
			clientId: hostingAccount.clientId,
			daServerId: hostingAccount.daServerId,
			daUsername: hostingAccount.daUsername,
			domain: hostingAccount.domain
		})
		.from(hostingAccount)
		.where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
		.limit(1);
	if (!account) {
		const msg = `hosting account ${accountId} not found for tenant ${tenantId}`;
		logError('hosting-email', msg, { tenantId });
		throw new Error(msg);
	}

	try {
		const customer = await resolveCustomerEmail({
			id: account.id,
			tenantId: account.tenantId,
			clientId: account.clientId
		});

		const { subject, html } = await renderSuspendedManual({
			tenantId,
			domain: account.domain,
			clientName: customer.name,
			reason: opts.reason,
			supportEmail: 'support@onetopsolution.ro'
		});

		const dedupeKey = `manual-suspended:${dayBucketEET()}`;
		const dedupeRowId = generateEventId();
		const insertedRows = await db
			.insert(hostingEmailEvent)
			.values({
				id: dedupeRowId,
				tenantId,
				hostingAccountId: accountId,
				eventType: 'manual-suspended',
				dedupeKey
			})
			.onConflictDoNothing({
				target: [
					hostingEmailEvent.tenantId,
					hostingEmailEvent.hostingAccountId,
					hostingEmailEvent.dedupeKey
				]
			})
			.returning({ id: hostingEmailEvent.id });

		if (insertedRows.length === 0) {
			logInfo(
				'hosting-email',
				`dedupe skip manual-suspended for account ${accountId} (today)`,
				{ tenantId }
			);
		} else {
			const emailLogId = await logEmailAttempt({
				tenantId,
				toEmail: customer.email,
				subject,
				emailType: 'hosting-suspended-manual',
				htmlBody: html,
				payload: null
			});

			await sendWithPersistence(
				{
					tenantId,
					toEmail: customer.email,
					subject,
					emailType: 'hosting-suspended-manual',
					metadata: { hostingAccountId: accountId },
					htmlBody: html,
					payload: null,
					_retryOfLogId: emailLogId
				},
				async () => {
					const brand = await fetchTenantBrand(tenantId);
					const [settings] = await db
						.select()
						.from(emailSettingsTable)
						.where(eq(emailSettingsTable.tenantId, tenantId))
						.limit(1);
					const fromEmail = resolveFromEmail(settings ?? null);
					return {
						from: `"${brand.tenantName}" <${fromEmail}>`,
						to: customer.email,
						subject,
						html,
						...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {})
					};
				}
			);

			await db
				.update(hostingEmailEvent)
				.set({ emailLogId })
				.where(eq(hostingEmailEvent.id, insertedRows[0]?.id ?? dedupeRowId));

			logInfo('hosting-email', `sent manual-suspended alert for account ${accountId}`, {
				tenantId,
				metadata: { emailLogId, toEmail: customer.email }
			});
		}
	} catch (err) {
		logError(
			'hosting-email',
			`notifyHostingSuspendedManual customer email failed for ${accountId}`,
			{ tenantId, stackTrace: err instanceof Error ? err.stack : undefined }
		);
	}

	try {
		await sendAdminStatusChangeAlert(tenantId, accountId, {
			action: 'suspended',
			trigger: 'manual',
			actorName: opts.actorName,
			reason: opts.reason,
			invoiceNumber: null,
			dedupeSuffix: `:${dayBucketEET()}`
		});
	} catch (err) {
		logError('hosting-email', `admin alert failed for manual suspend of ${accountId}`, {
			tenantId,
			stackTrace: err instanceof Error ? err.stack : undefined
		});
	}
}

export async function notifyHostingReactivatedManual(
	tenantId: string,
	accountId: string,
	opts: { actorName: string | null }
): Promise<void> {
	const [account] = await db
		.select({
			id: hostingAccount.id,
			tenantId: hostingAccount.tenantId,
			clientId: hostingAccount.clientId,
			daServerId: hostingAccount.daServerId,
			daUsername: hostingAccount.daUsername,
			domain: hostingAccount.domain
		})
		.from(hostingAccount)
		.where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
		.limit(1);
	if (!account) {
		const msg = `hosting account ${accountId} not found for tenant ${tenantId}`;
		logError('hosting-email', msg, { tenantId });
		throw new Error(msg);
	}

	try {
		const customer = await resolveCustomerEmail({
			id: account.id,
			tenantId: account.tenantId,
			clientId: account.clientId
		});

		const [server] = await db
			.select({ id: daServer.id, hostname: daServer.hostname })
			.from(daServer)
			.where(and(eq(daServer.id, account.daServerId), eq(daServer.tenantId, tenantId)))
			.limit(1);

		const daPanelUrl = server ? `https://${server.hostname}:2222` : '';

		const { subject, html } = await renderReactivatedManual({
			tenantId,
			domain: account.domain,
			clientName: customer.name,
			daPanelUrl
		});

		const dedupeKey = `manual-reactivated:${dayBucketEET()}`;
		const dedupeRowId = generateEventId();
		const insertedRows = await db
			.insert(hostingEmailEvent)
			.values({
				id: dedupeRowId,
				tenantId,
				hostingAccountId: accountId,
				eventType: 'manual-reactivated',
				dedupeKey
			})
			.onConflictDoNothing({
				target: [
					hostingEmailEvent.tenantId,
					hostingEmailEvent.hostingAccountId,
					hostingEmailEvent.dedupeKey
				]
			})
			.returning({ id: hostingEmailEvent.id });

		if (insertedRows.length === 0) {
			logInfo(
				'hosting-email',
				`dedupe skip manual-reactivated for account ${accountId} (today)`,
				{ tenantId }
			);
		} else {
			const emailLogId = await logEmailAttempt({
				tenantId,
				toEmail: customer.email,
				subject,
				emailType: 'hosting-reactivated-manual',
				htmlBody: html,
				payload: null
			});

			await sendWithPersistence(
				{
					tenantId,
					toEmail: customer.email,
					subject,
					emailType: 'hosting-reactivated-manual',
					metadata: { hostingAccountId: accountId },
					htmlBody: html,
					payload: null,
					_retryOfLogId: emailLogId
				},
				async () => {
					const brand = await fetchTenantBrand(tenantId);
					const [settings] = await db
						.select()
						.from(emailSettingsTable)
						.where(eq(emailSettingsTable.tenantId, tenantId))
						.limit(1);
					const fromEmail = resolveFromEmail(settings ?? null);
					return {
						from: `"${brand.tenantName}" <${fromEmail}>`,
						to: customer.email,
						subject,
						html,
						...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {})
					};
				}
			);

			await db
				.update(hostingEmailEvent)
				.set({ emailLogId })
				.where(eq(hostingEmailEvent.id, insertedRows[0]?.id ?? dedupeRowId));

			logInfo('hosting-email', `sent manual-reactivated alert for account ${accountId}`, {
				tenantId,
				metadata: { emailLogId, toEmail: customer.email }
			});
		}
	} catch (err) {
		logError(
			'hosting-email',
			`notifyHostingReactivatedManual customer email failed for ${accountId}`,
			{ tenantId, stackTrace: err instanceof Error ? err.stack : undefined }
		);
	}

	try {
		await sendAdminStatusChangeAlert(tenantId, accountId, {
			action: 'reactivated',
			trigger: 'manual',
			actorName: opts.actorName,
			reason: null,
			invoiceNumber: null,
			dedupeSuffix: `:${dayBucketEET()}`
		});
	} catch (err) {
		logError('hosting-email', `admin alert failed for manual reactivate of ${accountId}`, {
			tenantId,
			stackTrace: err instanceof Error ? err.stack : undefined
		});
	}
}

/**
 * Fires the admin alert for the AUTO-trigger suspend/reactivate flows.
 * Called by notifyHostingSuspended/notifyHostingReactivated AFTER the
 * customer email has been queued. Best-effort: never throws.
 */
export async function fireAutoAdminStatusAlert(
	tenantId: string,
	accountId: string,
	action: StatusChangeAction,
	invoiceId: string,
	invoiceNumber: string
): Promise<void> {
	try {
		await sendAdminStatusChangeAlert(tenantId, accountId, {
			action,
			trigger: 'auto',
			actorName: null,
			reason: null,
			invoiceNumber,
			dedupeSuffix: `:${invoiceId}`
		});
	} catch (err) {
		logError('hosting-email', `admin alert failed for auto ${action} of ${accountId}`, {
			tenantId,
			metadata: { invoiceId },
			stackTrace: err instanceof Error ? err.stack : undefined
		});
	}
}
