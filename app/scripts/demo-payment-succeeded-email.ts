/**
 * Zero-DB preview of the customer payment-succeeded email.
 * Renders the actual production template (`renderInvoicePaidEmailHtml`) with
 * fixture data — no SvelteKit, no DB, no env required.
 *
 * Brings this template to parity with the other 7 hosting/stripe demos:
 * each one runs the real render helper used in production so the preview
 * stays in lockstep with what customers receive.
 *
 * Usage:
 *   bun --bun scripts/demo-payment-succeeded-email.ts > /tmp/payment-succeeded.html && open /tmp/payment-succeeded.html
 */
import { renderInvoicePaidEmailHtml } from '../src/lib/server/email-templates/invoice-paid';

const { subject, html } = renderInvoicePaidEmailHtml({
	tenantName: 'One Top Solution',
	themeColor: '#0ea5e9',
	headerLogoHtml: '', // no logo in demo — production injects via CID attachment
	clientName: 'Ion Popescu',
	invoiceNumber: 'INV-2026-0042',
	totalAmount: 49900, // 499.00 RON in cents
	currency: 'RON',
	paidDate: new Date('2026-05-24'),
	issueDate: new Date('2026-05-15'),
	invoiceUrl: 'https://clients.onetopsolution.ro/invoice/ots/preview-token'
});

console.log(`<!-- Subject: ${subject} -->`);
console.log(html);
