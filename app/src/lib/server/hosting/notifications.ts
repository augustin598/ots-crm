import { db } from '$lib/server/db';
import { eq, and, gt, like } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import {
	hostingAccount,
	hostingEmailEvent,
	daServer,
	tenant as tenantTable,
	emailSettings as emailSettingsTable
} from '$lib/server/db/schema';
import { decrypt } from '$lib/server/plugins/smartbill/crypto';
import { sendWithPersistence, fetchTenantBrand, resolveFromEmail } from '$lib/server/email';
import { logEmailAttempt } from '$lib/server/email-logger';
import {
	resolveCustomerEmail,
	resolveAdminRecipients,
	NoAdminRecipientError
} from './notifications-helpers';
import { render as renderAccountCreated } from './email-templates/account-created';
import { render as renderProvisioningFailed } from './email-templates/provisioning-failed';
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
