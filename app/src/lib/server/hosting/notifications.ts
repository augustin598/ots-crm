import { db } from '$lib/server/db';
import { eq, and, gt, like, ne, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import {
	hostingAccount,
	hostingEmailEvent,
	daServer,
	tenant as tenantTable,
	emailSettings as emailSettingsTable,
	invoice as invoiceTable
} from '$lib/server/db/schema';
import { decrypt } from '$lib/server/plugins/smartbill/crypto';
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
import { logInfo, logError } from '$lib/server/logger';

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
		logError('hosting-email', `decrypt credentials failed for account ${accountId}`, {
			tenantId
		});
		throw err;
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

		// 6. Build payUrl + render template.
		const payUrl = `https://clients.onetopsolution.ro/${tenantRow.slug}/invoices/${invoiceId}/pay`;
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
	} catch (err) {
		logError('hosting-email', `notifyHostingReactivated failed for account ${accountId}`, {
			tenantId,
			metadata: { invoiceId },
			stackTrace: err instanceof Error ? err.stack : undefined
		});
		throw err;
	}
}
