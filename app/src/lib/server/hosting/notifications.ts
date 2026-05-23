import { db } from '$lib/server/db';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import {
	hostingAccount,
	hostingEmailEvent,
	daServer,
	emailSettings as emailSettingsTable
} from '$lib/server/db/schema';
import { decrypt } from '$lib/server/plugins/smartbill/crypto';
import { sendWithPersistence, fetchTenantBrand, resolveFromEmail } from '$lib/server/email';
import { logEmailAttempt } from '$lib/server/email-logger';
import { resolveCustomerEmail } from './notifications-helpers';
import { render as renderAccountCreated } from './email-templates/account-created';
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
