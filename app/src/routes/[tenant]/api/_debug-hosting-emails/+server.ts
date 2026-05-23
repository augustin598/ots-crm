import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import {
	notifyHostingAccountCreated,
	notifyHostingSuspended,
	notifyHostingReactivated,
	notifyHostingRenewalReminder,
	notifyHostingPaymentFailed,
	notifyHostingProvisioningFailed
} from '$lib/server/hosting/notifications';
import { processHostingRenewalReminder } from '$lib/server/scheduler/tasks/hosting-renewal-reminder';
import { render as renderAccountCreated } from '$lib/server/hosting/email-templates/account-created';
import { render as renderSuspended } from '$lib/server/hosting/email-templates/suspended';
import { render as renderReactivated } from '$lib/server/hosting/email-templates/reactivated';
import { render as renderRenewalReminder } from '$lib/server/hosting/email-templates/renewal-reminder';
import { render as renderPaymentFailed } from '$lib/server/hosting/email-templates/payment-failed';
import { resolveCustomerEmail } from '$lib/server/hosting/notifications-helpers';
import { logInfo, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Hosting-email debug + manual retry harness — mirrors the keez/stripe/DA
 * debug endpoints. Use to inspect dedupe rows, preview templates, and manually
 * (re)trigger notifications without tailing the dev-server log or wrestling
 * with the email-log viewer.
 *
 * Read-only probes (GET):
 *   action=dedupe-table[&eventType=created|provisioning-failed|suspended|reactivated|renewal-reminder|payment-failed]
 *                                       — recent hosting_email_event rows for THIS tenant (LIMIT 50, sentAt DESC).
 *   action=payment-dedupe[&eventType=...]
 *                                       — recent payment_email_event rows for THIS tenant (LIMIT 50, sentAt DESC).
 *   action=email-log&accountId=X        — recent email_log rows linked through hosting_email_event for that account (LIMIT 20).
 *   action=preview&accountId=X&type=welcome|suspended|reactivated|renewal-reminder|payment-failed
 *                                       — render the template WITHOUT sending. Returns HTML.
 *                                         Fields not available on the account (invoice details, DA password)
 *                                         use a placeholder fixture; a yellow banner at the top of the
 *                                         rendered HTML marks "PREVIEW MODE" so it isn't mistaken for a real send.
 *
 * Mutating actions (GET with ?confirm=yes, OR POST with ?confirm=yes):
 *   action=resend&accountId=X&type=welcome|suspended|reactivated|renewal-reminder|payment-failed|provisioning-failed[&invoiceId=Y][&daysOut=14|7|1][&reason=...][&attempt=N]
 *                                       — fire the matching notify function. The notifier honors its dedupe
 *                                         contract, so a same-day re-send for an already-sent (account, key)
 *                                         is a NO-OP. This is the "manual retry" button — if dedupe blocks
 *                                         the send, that's the safety guard working; do NOT hand-delete the
 *                                         dedupe row to force a resend.
 *   action=force-renewal-check          — invoke processHostingRenewalReminder() directly (the scheduler task).
 *                                         Returns `{ checked, sent, skipped }`. Used for staging smoke tests.
 *
 * Admin-only. Tenant-scoped on `event.locals.tenant.id` — every DB read is
 * filtered by tenantId, and the notify functions themselves re-enforce the
 * tenant scope via `where(eq(hostingAccount.tenantId, tenantId))`. STRICT
 * RULE: there is NO action to hand-delete dedupe rows on this endpoint —
 * dedupe rows are append-only audit evidence by design.
 */

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
}

type EventType =
	| 'created'
	| 'provisioning-failed'
	| 'suspended'
	| 'reactivated'
	| 'renewal-reminder'
	| 'payment-failed';

const KNOWN_EVENT_TYPES: ReadonlySet<EventType> = new Set([
	'created',
	'provisioning-failed',
	'suspended',
	'reactivated',
	'renewal-reminder',
	'payment-failed'
]);

type ResendType =
	| 'welcome'
	| 'suspended'
	| 'reactivated'
	| 'renewal-reminder'
	| 'payment-failed'
	| 'provisioning-failed';

const KNOWN_RESEND_TYPES: ReadonlySet<ResendType> = new Set([
	'welcome',
	'suspended',
	'reactivated',
	'renewal-reminder',
	'payment-failed',
	'provisioning-failed'
]);

type PreviewType = 'welcome' | 'suspended' | 'reactivated' | 'renewal-reminder' | 'payment-failed';

const KNOWN_PREVIEW_TYPES: ReadonlySet<PreviewType> = new Set([
	'welcome',
	'suspended',
	'reactivated',
	'renewal-reminder',
	'payment-failed'
]);

/**
 * Loads a hosting account scoped to the requested tenant. Cross-tenant access
 * returns 0 rows → 404. Mirrors the lookup pattern used inside notifications.ts.
 */
async function loadAccount(tenantId: string, accountId: string) {
	if (!accountId) throw error(400, 'accountId required');
	const [account] = await db
		.select()
		.from(table.hostingAccount)
		.where(
			and(eq(table.hostingAccount.id, accountId), eq(table.hostingAccount.tenantId, tenantId))
		)
		.limit(1);
	if (!account) throw error(404, `hosting account ${accountId} not found for this tenant`);
	return account;
}

/**
 * Banner prepended to every preview HTML so a screenshot or forward never gets
 * mistaken for a real customer email. Inline styles only — email-safe.
 */
const PREVIEW_BANNER = `<div style="background:#fef3c7;padding:8px;border:1px solid #fbbf24;color:#78350f;font-family:sans-serif;font-size:13px;text-align:center;">PREVIEW MODE — placeholder credentials/invoice data, not the real ones</div>`;

/**
 * Narrow the schema's free-form `currency` text to the three values the
 * hosting email templates support. Anything else falls back to RON.
 */
function narrowCurrency(value: string | null | undefined): 'RON' | 'EUR' | 'USD' {
	return value === 'EUR' || value === 'USD' ? value : 'RON';
}

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const action = event.url.searchParams.get('action') ?? '';

	// === dedupe-table =======================================================
	if (action === 'dedupe-table') {
		const eventTypeParam = event.url.searchParams.get('eventType');
		const filters = [eq(table.hostingEmailEvent.tenantId, tenantId)];
		if (eventTypeParam) {
			if (!KNOWN_EVENT_TYPES.has(eventTypeParam as EventType)) {
				throw error(
					400,
					`Unknown eventType: ${eventTypeParam}. Known: ${Array.from(KNOWN_EVENT_TYPES).join(', ')}`
				);
			}
			filters.push(eq(table.hostingEmailEvent.eventType, eventTypeParam));
		}
		const rows = await db
			.select({
				id: table.hostingEmailEvent.id,
				hostingAccountId: table.hostingEmailEvent.hostingAccountId,
				eventType: table.hostingEmailEvent.eventType,
				dedupeKey: table.hostingEmailEvent.dedupeKey,
				emailLogId: table.hostingEmailEvent.emailLogId,
				attemptNumber: table.hostingEmailEvent.attemptNumber,
				sentAt: table.hostingEmailEvent.sentAt
			})
			.from(table.hostingEmailEvent)
			.where(and(...filters))
			.orderBy(desc(table.hostingEmailEvent.sentAt))
			.limit(50);
		return json({ count: rows.length, eventTypeFilter: eventTypeParam ?? null, rows });
	}

	// === payment-dedupe =====================================================
	if (action === 'payment-dedupe') {
		const eventTypeParam = event.url.searchParams.get('eventType');
		const filters = [eq(table.paymentEmailEvent.tenantId, tenantId)];
		if (eventTypeParam) {
			filters.push(eq(table.paymentEmailEvent.eventType, eventTypeParam));
		}
		const rows = await db
			.select({
				id: table.paymentEmailEvent.id,
				invoiceId: table.paymentEmailEvent.invoiceId,
				eventType: table.paymentEmailEvent.eventType,
				dedupeKey: table.paymentEmailEvent.dedupeKey,
				emailLogId: table.paymentEmailEvent.emailLogId,
				sentAt: table.paymentEmailEvent.sentAt
			})
			.from(table.paymentEmailEvent)
			.where(and(...filters))
			.orderBy(desc(table.paymentEmailEvent.sentAt))
			.limit(50);
		return json({ count: rows.length, eventTypeFilter: eventTypeParam ?? null, rows });
	}

	// === email-log ==========================================================
	if (action === 'email-log') {
		const accountId = event.url.searchParams.get('accountId') ?? '';
		// Validate the account exists in THIS tenant before reading email_log —
		// keeps the JOIN tenant-bounded on both sides even if a malicious caller
		// supplies an accountId from another tenant.
		await loadAccount(tenantId, accountId);

		const rows = await db
			.select({
				dedupeRowId: table.hostingEmailEvent.id,
				eventType: table.hostingEmailEvent.eventType,
				dedupeKey: table.hostingEmailEvent.dedupeKey,
				sentAt: table.hostingEmailEvent.sentAt,
				emailLogId: table.emailLog.id,
				toEmail: table.emailLog.toEmail,
				subject: table.emailLog.subject,
				emailType: table.emailLog.emailType,
				status: table.emailLog.status,
				attempts: table.emailLog.attempts,
				errorMessage: table.emailLog.errorMessage,
				smtpMessageId: table.emailLog.smtpMessageId,
				createdAt: table.emailLog.createdAt,
				completedAt: table.emailLog.completedAt
			})
			.from(table.hostingEmailEvent)
			.innerJoin(
				table.emailLog,
				and(
					eq(table.emailLog.id, table.hostingEmailEvent.emailLogId),
					// Belt-and-suspenders: filter the email_log side by tenant too. The
					// dedupe row is already tenant-scoped above, but JOINing requires
					// tenant filtering on BOTH sides (per multi-tenant skill rule #2).
					eq(table.emailLog.tenantId, tenantId)
				)
			)
			.where(
				and(
					eq(table.hostingEmailEvent.tenantId, tenantId),
					eq(table.hostingEmailEvent.hostingAccountId, accountId)
				)
			)
			.orderBy(desc(table.hostingEmailEvent.sentAt))
			.limit(20);
		return json({ count: rows.length, accountId, rows });
	}

	// === preview ============================================================
	if (action === 'preview') {
		const accountId = event.url.searchParams.get('accountId') ?? '';
		const previewType = event.url.searchParams.get('type') ?? '';
		if (!previewType || !KNOWN_PREVIEW_TYPES.has(previewType as PreviewType)) {
			throw error(
				400,
				`type required — one of: ${Array.from(KNOWN_PREVIEW_TYPES).join(', ')}`
			);
		}
		const account = await loadAccount(tenantId, accountId);

		// Best-effort customer name lookup — falls back to 'Client' inside the helper.
		let clientName = 'Client';
		try {
			const customer = await resolveCustomerEmail({
				id: account.id,
				tenantId: account.tenantId,
				clientId: account.clientId
			});
			clientName = customer.name;
		} catch {
			// Preview tolerates missing customer — render with the fallback name.
		}

		// Best-effort DA server hostname lookup (tenant-scoped) — preview uses
		// a placeholder when the server row is missing or unreadable.
		const [server] = await db
			.select({
				id: table.daServer.id,
				hostname: table.daServer.hostname
			})
			.from(table.daServer)
			.where(
				and(eq(table.daServer.id, account.daServerId), eq(table.daServer.tenantId, tenantId))
			)
			.limit(1);
		const daServerHost = server?.hostname ?? 'da.example.com';

		// Tenant slug (used by templates that build CRM/pay URLs).
		const [tenantRow] = await db
			.select({ slug: table.tenant.slug })
			.from(table.tenant)
			.where(eq(table.tenant.id, tenantId))
			.limit(1);
		const tenantSlug = tenantRow?.slug ?? 'demo';

		let rendered: { subject: string; html: string };

		if (previewType === 'welcome') {
			// Placeholder credentials — the real ones live encrypted; we explicitly
			// do NOT decrypt for the preview. The banner above warns the reader.
			rendered = await renderAccountCreated({
				tenantId,
				domain: account.domain,
				daUsername: 'demo-username',
				daPassword: 'demo-password-rotates-every-min',
				daServerHost,
				serverIp: daServerHost,
				clientName
			});
		} else if (previewType === 'suspended') {
			rendered = await renderSuspended({
				tenantId,
				domain: account.domain,
				clientName,
				invoiceNumber: 'OTS-2026-PREVIEW',
				invoiceDate: '01.05.2026',
				amountDue: 4990, // 49.90 placeholder
				currency: narrowCurrency(account.currency),
				payUrl: `https://clients.onetopsolution.ro/${tenantSlug}/invoices/preview/pay`,
				supportEmail: 'support@onetopsolution.ro'
			});
		} else if (previewType === 'reactivated') {
			rendered = await renderReactivated({
				tenantId,
				domain: account.domain,
				clientName,
				invoiceNumber: 'OTS-2026-PREVIEW',
				amountPaid: 4990,
				currency: narrowCurrency(account.currency),
				daPanelUrl: `https://${daServerHost}:2222`
			});
		} else if (previewType === 'renewal-reminder') {
			// daysUntilDue defaults to 7 unless caller supplied otherwise.
			const daysParam = Number(event.url.searchParams.get('daysOut') ?? '7');
			const days = (daysParam === 1 || daysParam === 7 || daysParam === 14 ? daysParam : 7) as
				| 1
				| 7
				| 14;
			rendered = await renderRenewalReminder({
				tenantId,
				domain: account.domain,
				clientName,
				dueDate: '15.06.2026',
				amountDue: account.recurringAmount || 4990,
				currency: narrowCurrency(account.currency),
				daysUntilDue: days,
				autoRenew: account.autoRenew,
				payUrl: `https://clients.onetopsolution.ro/${tenantSlug}/hosting/accounts/${account.id}/renew`
			});
		} else {
			// payment-failed
			rendered = await renderPaymentFailed({
				tenantId,
				domain: account.domain,
				clientName,
				invoiceNumber: 'OTS-2026-PREVIEW',
				amountDue: 4990,
				currency: narrowCurrency(account.currency),
				failureReason: 'Card refuzat (insufficient_funds) — placeholder pentru preview',
				updateMethodUrl: `https://clients.onetopsolution.ro/${tenantSlug}/invoices/preview/pay`,
				manualPayUrl: `https://clients.onetopsolution.ro/${tenantSlug}/invoices/preview/pay`,
				daysUntilSuspend: 10
			});
		}

		return new Response(PREVIEW_BANNER + rendered.html, {
			status: 200,
			headers: { 'content-type': 'text/html; charset=utf-8' }
		});
	}

	// Mutating actions are accepted via GET too (mirrors DA debug endpoint's
	// `real-create` design — operational tasks where a curl with ?confirm=yes
	// is the ergonomic primary form). Routed through the same handler as POST.
	if (action === 'resend' || action === 'force-renewal-check') {
		return handleMutating(event, tenantId, action);
	}

	throw error(400, `Unknown action: ${action}`);
};

export const POST: RequestHandler = async (event) => {
	requireAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const action = event.url.searchParams.get('action') ?? '';
	return handleMutating(event, tenantId, action);
};

/**
 * Shared dispatcher for `resend` / `force-renewal-check`. Both GET and POST
 * paths route here so a curl with ?confirm=yes works either way.
 */
async function handleMutating(
	event: Parameters<RequestHandler>[0],
	tenantId: string,
	action: string
): Promise<Response> {
	const confirm = event.url.searchParams.get('confirm') === 'yes';
	if (!confirm) {
		throw error(
			400,
			'Mutating actions require ?confirm=yes — verifică acțiunea ÎNAINTE.'
		);
	}

	// === resend =============================================================
	if (action === 'resend') {
		const accountId = event.url.searchParams.get('accountId') ?? '';
		const typeParam = event.url.searchParams.get('type') ?? '';
		if (!typeParam || !KNOWN_RESEND_TYPES.has(typeParam as ResendType)) {
			throw error(
				400,
				`type required — one of: ${Array.from(KNOWN_RESEND_TYPES).join(', ')}`
			);
		}
		// Validate cross-tenant safety: the account must belong to THIS tenant.
		// The notifier re-checks but failing fast here gives a cleaner 404.
		await loadAccount(tenantId, accountId);

		const type = typeParam as ResendType;
		const start = performance.now();

		try {
			if (type === 'welcome') {
				await notifyHostingAccountCreated(tenantId, accountId);
			} else if (type === 'suspended') {
				const invoiceId = event.url.searchParams.get('invoiceId') ?? '';
				if (!invoiceId) throw error(400, 'invoiceId required for type=suspended');
				await notifyHostingSuspended(tenantId, accountId, invoiceId);
			} else if (type === 'reactivated') {
				const invoiceId = event.url.searchParams.get('invoiceId') ?? '';
				if (!invoiceId) throw error(400, 'invoiceId required for type=reactivated');
				await notifyHostingReactivated(tenantId, accountId, invoiceId);
			} else if (type === 'renewal-reminder') {
				const daysParam = Number(event.url.searchParams.get('daysOut') ?? '');
				if (daysParam !== 1 && daysParam !== 7 && daysParam !== 14) {
					throw error(400, 'daysOut required for type=renewal-reminder (one of: 1, 7, 14)');
				}
				await notifyHostingRenewalReminder(tenantId, accountId, daysParam as 1 | 7 | 14);
			} else if (type === 'payment-failed') {
				const invoiceId = event.url.searchParams.get('invoiceId') ?? '';
				const reason = event.url.searchParams.get('reason') ?? '';
				if (!invoiceId) throw error(400, 'invoiceId required for type=payment-failed');
				if (!reason) throw error(400, 'reason required for type=payment-failed');
				await notifyHostingPaymentFailed(tenantId, accountId, invoiceId, reason);
			} else {
				// provisioning-failed
				const reason = event.url.searchParams.get('reason') ?? '';
				const attemptParam = Number(event.url.searchParams.get('attempt') ?? '');
				if (!reason) throw error(400, 'reason required for type=provisioning-failed');
				if (!Number.isFinite(attemptParam) || attemptParam < 1) {
					throw error(400, 'attempt required for type=provisioning-failed (positive integer)');
				}
				await notifyHostingProvisioningFailed(tenantId, accountId, reason, attemptParam);
			}

			logInfo('hosting-email', `_debug resend OK (${type}) for account ${accountId}`, {
				tenantId,
				metadata: { type, accountId }
			});
			return json({
				ok: true,
				durationMs: Math.round(performance.now() - start),
				type,
				accountId,
				note: 'Notifier honored its dedupe contract — if no email was sent, the dedupe row already exists for this (account, key). That is the safety guard; do NOT hand-delete the dedupe row.'
			});
		} catch (err) {
			// Return the failure as a 200 with ok:false instead of a 500 — the
			// caller is debugging, they want the message, not a stack trace.
			const { message } = serializeError(err);
			return json(
				{
					ok: false,
					durationMs: Math.round(performance.now() - start),
					type,
					accountId,
					error: message
				},
				{ status: 200 }
			);
		}
	}

	// === force-renewal-check ===============================================
	if (action === 'force-renewal-check') {
		const start = performance.now();
		try {
			// Note: processHostingRenewalReminder is global by design (scans every
			// tenant's active accounts). The per-account notifier inside it
			// enforces tenant scoping. This action is gated by ?confirm=yes for
			// explicitness — same risk profile as the scheduler firing on cron.
			const result = await processHostingRenewalReminder();
			logInfo('hosting-email', `_debug force-renewal-check ran`, {
				tenantId,
				metadata: { ...result }
			});
			return json({
				ok: true,
				durationMs: Math.round(performance.now() - start),
				...result
			});
		} catch (err) {
			const { message } = serializeError(err);
			return json(
				{
					ok: false,
					durationMs: Math.round(performance.now() - start),
					error: message
				},
				{ status: 200 }
			);
		}
	}

	throw error(400, `Unknown action: ${action}`);
}
