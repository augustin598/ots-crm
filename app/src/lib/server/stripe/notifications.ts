import { db } from '$lib/server/db';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import {
	paymentEmailEvent,
	invoice as invoiceTable,
	invoiceLineItem,
	invoiceSettings,
	tenant as tenantTable,
	client as clientTable,
	emailSettings as emailSettingsTable
} from '$lib/server/db/schema';
import {
	sendInvoicePaidEmail,
	getNotificationRecipients,
	sendWithPersistence,
	fetchTenantBrand,
	resolveFromEmail
} from '$lib/server/email';
import { logEmailAttempt } from '$lib/server/email-logger';
import { resolveAdminRecipients } from '$lib/server/hosting/notifications-helpers';
import { render as renderAdminPaymentReceived } from './email-templates/admin-payment-received';
import { logInfo, logError } from '$lib/server/logger';

function generateEventId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Dedupe-aware wrapper around sendInvoicePaidEmail (Task 13).
 *
 * Lifetime dedupe per invoice via the payment_email_event unique index. A
 * second call for the same invoice no-ops cleanly — important because:
 *   1. The Stripe post-payment dispatcher is idempotent (webhook retries are
 *      a normal part of Stripe operation).
 *   2. The legacy invoice.paid hook in email-notifications.ts was disabled in
 *      the same change, making this notify the SOLE driver of the
 *      payment-succeeded customer email. Re-enabling the legacy listener
 *      without removing this would still be safe — the unique index would
 *      block the double-send. But for clarity we disabled the legacy path.
 *
 * Recipient resolution mirrors the legacy hook (getNotificationRecipients with
 * 'invoices' category) so the swap is invisible to customers: primary
 * client.email + any secondary contacts opted into invoice notifications.
 *
 * payload: not threaded — sendInvoicePaidEmail manages its own email_log row
 * with a replayable payload internally. The dedupe row carries no emailLogId
 * back-link; admins can still trace the actual send via email_log filtered by
 * (invoiceId, emailType='invoice-paid'). This matches the simplest-possible
 * audit trail the user signed off on in Task 13.
 *
 * Failure semantics: any error (decryption, missing recipient, SMTP) bubbles
 * to the caller. The caller (dispatcher) catches and logs without unwinding
 * the broader pipeline — the customer is unhappy but the invoice + DA
 * provision succeed and admin can manually re-send.
 */
export async function notifyPaymentSucceeded(
	tenantId: string,
	invoiceId: string
): Promise<void> {
	// 0. Honor tenant opt-out: skip silently if invoice emails are disabled or
	//    if the per-event "paid confirmation" toggle is off. The legacy
	//    invoice.paid hook (now disabled — see hooks/email-notifications.ts)
	//    gated on the same two toggles, so we preserve the behavior — admins
	//    who turned off paid-confirmation emails in settings must not start
	//    receiving them again just because the trigger source moved to the
	//    Stripe post-payment dispatcher. We run this BEFORE the dedupe insert
	//    so the dedupe slot isn't consumed when the toggle blocks the send;
	//    a future toggle-flip should then be able to email retroactively if
	//    the same invoice succeeds payment again (rare but possible via
	//    Stripe's retry behavior).
	const [settings] = await db
		.select({
			invoiceEmailsEnabled: invoiceSettings.invoiceEmailsEnabled,
			paidConfirmationEmailEnabled: invoiceSettings.paidConfirmationEmailEnabled
		})
		.from(invoiceSettings)
		.where(eq(invoiceSettings.tenantId, tenantId))
		.limit(1);
	const masterEnabled = settings?.invoiceEmailsEnabled ?? true;
	const paidEnabled = settings?.paidConfirmationEmailEnabled ?? true;
	if (!masterEnabled || !paidEnabled) {
		logInfo(
			'hosting-email',
			`payment-succeeded suppressed by tenant settings for invoice ${invoiceId}`,
			{
				tenantId,
				metadata: {
					invoiceId,
					invoiceEmailsEnabled: masterEnabled,
					paidConfirmationEmailEnabled: paidEnabled
				}
			}
		);
		return;
	}

	// 1. Atomic dedupe — lifetime per invoice. Insert FIRST so a concurrent
	//    dispatcher retry can't both pass the check and double-send.
	const dedupeKey = `payment-succeeded:${invoiceId}`;
	const inserted = await db
		.insert(paymentEmailEvent)
		.values({
			id: generateEventId(),
			tenantId,
			invoiceId,
			eventType: 'payment-succeeded',
			dedupeKey
		})
		.onConflictDoNothing({
			target: [paymentEmailEvent.tenantId, paymentEmailEvent.invoiceId, paymentEmailEvent.dedupeKey]
		})
		.returning({ id: paymentEmailEvent.id });

	if (inserted.length === 0) {
		logInfo('hosting-email', `dedupe skip payment-succeeded for invoice ${invoiceId}`, {
			tenantId,
			metadata: { invoiceId }
		});
		return;
	}

	try {
		// 2. Load invoice (tenant-scoped). Defense-in-depth: a malicious caller
		//    that hit the dispatcher with the wrong tenant context still can't
		//    surface another tenant's clientId through this path.
		const [inv] = await db
			.select({
				id: invoiceTable.id,
				tenantId: invoiceTable.tenantId,
				clientId: invoiceTable.clientId,
				invoiceNumber: invoiceTable.invoiceNumber
			})
			.from(invoiceTable)
			.where(and(eq(invoiceTable.id, invoiceId), eq(invoiceTable.tenantId, tenantId)))
			.limit(1);
		if (!inv) {
			throw new Error(`invoice ${invoiceId} not found for tenant ${tenantId}`);
		}

		// 3. Resolve recipients — matches legacy hook behavior exactly (primary
		//    client.email + secondary contacts with the 'invoices' notification
		//    flag enabled). Throws if zero recipients resolve.
		const recipients = await getNotificationRecipients(inv.clientId, 'invoices');
		if (recipients.length === 0) {
			throw new Error(`no recipient resolvable for invoice ${invoiceId}`);
		}

		// 4. Delegate to the existing sender for each recipient. The sender
		//    handles persistence (email_log), brand resolution, and Romanian
		//    template rendering — we're swapping the trigger, not the email.
		for (const recipient of recipients) {
			await sendInvoicePaidEmail(invoiceId, recipient.email);
		}

		logInfo('hosting-email', `sent payment-succeeded for invoice ${invoiceId}`, {
			tenantId,
			metadata: {
				invoiceId,
				invoiceNumber: inv.invoiceNumber,
				recipients: recipients.map((r) => r.email).join(', ')
			}
		});
	} catch (err) {
		logError('hosting-email', `notifyPaymentSucceeded failed for invoice ${invoiceId}`, {
			tenantId,
			metadata: {
				invoiceId,
				error: err instanceof Error ? err.message : String(err)
			}
		});
		throw err;
	}
}

/**
 * Step status used by the admin-payment-received template + dispatcher hook.
 *
 * Free-form string (the schema stores `postPaymentStep.status` as TEXT), but
 * the production code only writes the four values below. The notify path is
 * permissive on input: an unrecognized status falls through the template's
 * color map to gray, matching the "skipped" tone.
 */
type AdminStepStatus = 'success' | 'failed' | 'skipped' | 'pending';

/**
 * Admin alert dispatched at the END of the Stripe post-payment pipeline. Lists
 * the per-step statuses (magic_link / keez_invoice / da_provision) color-coded
 * so the on-call admin sees at a glance whether each step succeeded.
 *
 * Dedupe strategy (LIFETIME per CRM invoice):
 *   - `dedupeKey = \`admin-payment-received:${invoiceId}\``
 *   - Atomic INSERT with onConflictDoNothing on the unique
 *     (tenantId, invoiceId, dedupeKey) index on `payment_email_event`.
 *   - Second call for the same invoice (e.g. Stripe webhook retry → dispatcher
 *     re-runs) → insert no-ops → early return.
 *   - Different invoice (e.g. next billing cycle for the same client) →
 *     different dedupeKey → fresh email.
 *
 * Multi-recipient send (mirrors notifyHostingProvisioningFailed from Task 8):
 *   - Loops over every admin/owner email from `resolveAdminRecipients`. Each
 *     send gets its own `email_log` row so audit covers every attempt.
 *   - Single dedupe row's `emailLogId` is "last writer wins" — acceptable for
 *     internal alerts where the audit trail lives on `email_log` rows keyed
 *     by `metadata.invoiceId`.
 *
 * Order matters:
 *   - Resolution (invoice, tenant slug, line items, client) happens BEFORE the
 *     dedupe insert so transient DB errors don't leak a dedupe row that would
 *     forever block this lifetime-keyed event for this invoice (parallel to
 *     Task 6/8/9/10/11/12 review fixes).
 *
 * Why `payload: null` (both logEmailAttempt and sendWithPersistence ctx): the
 * lifetime dedupe already suppresses any scheduler replay for this invoice.
 * If a scheduler replay fired this notifier with the same args, it would hit
 * the dedupe row and no-op anyway. Mirrors the multi-recipient hosting siblings.
 *
 * Errors:
 *   - Missing invoice → log + throw (caller decides retry).
 *   - `NoAdminRecipientError` (admin config bug) bubbles up — the dispatcher
 *     wrapper catches and logs without unwinding the broader pipeline.
 *   - SMTP/build errors bubble up after a structured error log.
 */
export async function notifyAdminPaymentReceived(
	tenantId: string,
	invoiceId: string,
	stepStatuses: Record<string, string>
): Promise<void> {
	// 1. Tenant-scoped invoice lookup. Cross-tenant returns 0 rows → throws.
	const [inv] = await db
		.select({
			id: invoiceTable.id,
			tenantId: invoiceTable.tenantId,
			clientId: invoiceTable.clientId,
			invoiceNumber: invoiceTable.invoiceNumber,
			totalAmount: invoiceTable.totalAmount,
			currency: invoiceTable.currency
		})
		.from(invoiceTable)
		.where(and(eq(invoiceTable.id, invoiceId), eq(invoiceTable.tenantId, tenantId)))
		.limit(1);

	if (!inv) {
		const msg = `invoice ${invoiceId} not found for tenant ${tenantId}`;
		logError('hosting-email', msg, { tenantId });
		throw new Error(msg);
	}

	try {
		// 2. Tenant slug lookup → crmInvoiceUrl construction.
		const [tenantRow] = await db
			.select({ id: tenantTable.id, slug: tenantTable.slug })
			.from(tenantTable)
			.where(eq(tenantTable.id, tenantId))
			.limit(1);

		if (!tenantRow) {
			throw new Error(`tenant ${tenantId} not found`);
		}

		// 3. Invoice line items → product descriptions list. Tenant scoping is
		//    transitively enforced via the invoiceId filter (line items belong
		//    to the invoice we already tenant-checked above).
		const lineItems = await db
			.select({ description: invoiceLineItem.description })
			.from(invoiceLineItem)
			.where(eq(invoiceLineItem.invoiceId, invoiceId));
		const productDescriptions = lineItems.map((li) => li.description);

		// 4. Client name resolution: businessName ?? name ?? email. The client
		//    table's name field is the editable display name (always present),
		//    businessName comes from Keez/ANAF (preferred when available),
		//    email is the last-resort fallback when both are empty.
		const [clientRow] = await db
			.select({
				id: clientTable.id,
				businessName: clientTable.businessName,
				name: clientTable.name,
				email: clientTable.email
			})
			.from(clientTable)
			.where(and(eq(clientTable.id, inv.clientId), eq(clientTable.tenantId, tenantId)))
			.limit(1);

		const clientName =
			clientRow?.businessName?.trim() ||
			clientRow?.name?.trim() ||
			clientRow?.email ||
			'(client necunoscut)';

		// 5. Currency narrowing — schema is free-form text but our templates only
		//    support these three. Anything else is normalized to RON.
		const currency = (
			inv.currency === 'EUR' || inv.currency === 'USD' ? inv.currency : 'RON'
		) as 'RON' | 'EUR' | 'USD';

		// 6. totalAmount stored in CENTS per schema. Null falls back to 0.
		const amount = inv.totalAmount ?? 0;

		// 7. Resolve admin recipients (owner/admin users → tenant.adminContactEmail → OPS env).
		const recipients = await resolveAdminRecipients(tenantId);

		// 8. Build CRM URL + render template ONCE (reused across all recipients).
		const crmInvoiceUrl = `https://clients.onetopsolution.ro/${tenantRow.slug}/invoices/${invoiceId}`;
		const { subject, html } = await renderAdminPaymentReceived({
			tenantId,
			tenantSlug: tenantRow.slug,
			clientName,
			amount,
			currency,
			invoiceNumber: inv.invoiceNumber,
			productDescriptions,
			crmInvoiceUrl,
			stepStatuses: stepStatuses as Record<string, AdminStepStatus>
		});

		// 9. Atomic lifetime dedupe insert (per invoice).
		const dedupeKey = `admin-payment-received:${invoiceId}`;
		const dedupeRowId = generateEventId();
		const insertedRows = await db
			.insert(paymentEmailEvent)
			.values({
				id: dedupeRowId,
				tenantId,
				invoiceId,
				eventType: 'admin-payment-received',
				dedupeKey
			})
			.onConflictDoNothing({
				target: [paymentEmailEvent.tenantId, paymentEmailEvent.invoiceId, paymentEmailEvent.dedupeKey]
			})
			.returning({ id: paymentEmailEvent.id });

		if (insertedRows.length === 0) {
			// Dedupe hit — already sent for this invoice (lifetime).
			logInfo('hosting-email', `dedupe skip admin-payment-received for invoice ${invoiceId}`, {
				tenantId,
				metadata: { invoiceId }
			});
			return;
		}

		const newDedupeId = insertedRows[0]?.id ?? dedupeRowId;

		// 10. Fetch brand once so every buildMail call reuses the same `from`-prefix
		//     and logo attachment — avoids 1 DB read per recipient.
		const brand = await fetchTenantBrand(tenantId);

		// 11. Send to each recipient. Per-recipient email_log row so audit covers
		//     every attempt. Partial-failure tradeoff: dedupe row is inserted
		//     BEFORE the loop, so if recipient #1 sends successfully but #2 fails,
		//     the lifetime dedupe blocks any subsequent fire for this invoice.
		//     Acceptable because most tenants have ≤2 admins, recipient #1
		//     already received the alert, and admin can re-send manually if
		//     needed. Audit trail is preserved per recipient via the
		//     per-recipient email_log rows.
		let lastEmailLogId: string | undefined;
		for (const email of recipients) {
			// Pre-create email_log row so we know its ID for the audit linkage.
			// payload: null — scheduler replay would hit the lifetime dedupe and no-op.
			const emailLogId = await logEmailAttempt({
				tenantId,
				toEmail: email,
				subject,
				emailType: 'admin-payment-received',
				htmlBody: html,
				payload: null
			});
			lastEmailLogId = emailLogId;

			await sendWithPersistence(
				{
					tenantId,
					toEmail: email,
					subject,
					emailType: 'admin-payment-received',
					metadata: { invoiceId, recipientType: 'admin' },
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

		// 12. Link the dedupe row to the LAST recipient's email_log row (last-writer-wins).
		if (lastEmailLogId) {
			await db
				.update(paymentEmailEvent)
				.set({ emailLogId: lastEmailLogId })
				.where(eq(paymentEmailEvent.id, newDedupeId));
		}

		logInfo('hosting-email', `sent admin-payment-received for invoice ${invoiceId}`, {
			tenantId,
			metadata: {
				invoiceId,
				invoiceNumber: inv.invoiceNumber,
				recipients: recipients.length
			}
		});
	} catch (err) {
		logError('hosting-email', `notifyAdminPaymentReceived failed for invoice ${invoiceId}`, {
			tenantId,
			metadata: {
				invoiceId,
				error: err instanceof Error ? err.message : String(err)
			}
		});
		throw err;
	}
}
