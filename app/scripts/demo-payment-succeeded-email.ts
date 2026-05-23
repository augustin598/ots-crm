/**
 * Demo / preview reference for the customer payment-succeeded email.
 *
 * Unlike the other `demo-hosting-*-email.ts` scripts in this folder, this is
 * NOT a self-contained zero-DB renderer — the production code (`sendInvoicePaidEmail`
 * in `src/lib/server/email.ts:1904`) renders the HTML INLINE inside its
 * `sendWithPersistence` callback, with no exposed render-only helper.
 *
 * That decision predates the hosting-email-flow rollout. The trade-off:
 *   - All other notify functions either delegate to a templated render() helper
 *     in `email-templates/` OR mirror that pattern here in scripts/. The legacy
 *     `sendInvoicePaidEmail` does both shell + body inline.
 *   - Extracting a render-only helper would be a wider refactor (touches the
 *     branded shell, the brand fetch, the invoice URL token issuance, the
 *     PDF attach logic). Out of scope for Task 15.
 *
 * This script documents the email contract so future maintainers can locate it.
 * For an actual HTML preview, the recommended path is:
 *
 *   1. Run the dev server.
 *   2. Trigger a Stripe test checkout: `4242 4242 4242 4242`.
 *   3. The post-payment dispatcher (Task 13) fires `notifyPaymentSucceeded`,
 *      which calls `sendInvoicePaidEmail`. The resulting `email_log` row
 *      contains the rendered HTML (`htmlBody` column).
 *   4. Inspect via the admin email log UI or:
 *      `bun -e "import { db } from './src/lib/server/db';
 *               import { emailLog } from './src/lib/server/db/schema';
 *               import { eq, desc } from 'drizzle-orm';
 *               const [r] = await db.select().from(emailLog)
 *                 .where(eq(emailLog.emailType, 'invoice-paid'))
 *                 .orderBy(desc(emailLog.createdAt)).limit(1);
 *               console.log(r?.htmlBody);"`
 *
 * Usage (informational): bun scripts/demo-payment-succeeded-email.ts
 */

const invoiceId = process.argv[2];

console.log('=== payment-succeeded email contract ===');
console.log('');
console.log('Trigger:        Stripe post-payment dispatcher (Task 13)');
console.log('Notify wrapper: notifyPaymentSucceeded(tenantId, invoiceId)');
console.log('Sender:         sendInvoicePaidEmail(invoiceId, clientEmail)');
console.log('Source file:    src/lib/server/email.ts:1904');
console.log('Email type:     invoice-paid');
console.log('Dedupe table:   payment_email_event');
console.log('Dedupe key:     payment-succeeded:<invoiceId> (lifetime per invoice)');
console.log('Recipient:      via getNotificationRecipients(invoice.clientId, "invoices")');
console.log('');
console.log('Subject:        "Plata primita: Factura <invoiceNumber>"');
console.log('Body:           branded shell + payment confirmation + invoice link');
console.log('Attachments:    Keez fiscal PDF (when invoice.keezExternalId is set)');
console.log('');

if (invoiceId) {
	console.log(`To inspect the actual HTML for invoice ${invoiceId}, run:`);
	console.log('');
	console.log(`  bun -e "import { db } from './src/lib/server/db';`);
	console.log(`           import { emailLog } from './src/lib/server/db/schema';`);
	console.log(`           import { eq, and, desc } from 'drizzle-orm';`);
	console.log(`           const rows = await db.select().from(emailLog).where(`);
	console.log(`             and(eq(emailLog.emailType, 'invoice-paid'),`);
	console.log(`                 eq(emailLog.metadata, JSON.stringify({ invoiceId: '${invoiceId}' })))`);
	console.log(`           ).orderBy(desc(emailLog.createdAt)).limit(1);`);
	console.log(`           console.log(rows[0]?.htmlBody);"`);
} else {
	console.log('Pass an invoiceId as the first arg to get a inspection one-liner.');
}
