/**
 * Standalone demo of the customer "Plată primită" (invoice paid) email.
 * The template is a pure render helper (no DB, no SvelteKit virtual modules),
 * so the demo imports it directly and prints the full HTML.
 *
 * Run:
 *   bun --bun scripts/demo-invoice-paid-email.ts > /tmp/invoice-paid-preview.html && open /tmp/invoice-paid-preview.html
 */
import { renderInvoicePaidEmailHtml } from '../src/lib/server/email-templates/invoice-paid';

const rendered = renderInvoicePaidEmailHtml({
	tenantName: 'ONE TOP SOLUTION S.R.L.',
	themeColor: '#0ea5e9',
	headerLogoHtml: '',
	clientName: 'MADDIE SYSTEMS S.R.L.',
	invoiceNumber: 'OTSH 8',
	totalAmount: 90629,
	currency: 'RON',
	paidDate: new Date('2026-08-14'),
	issueDate: new Date('2026-07-20'),
	invoiceUrl: 'https://clients.onetopsolution.ro/invoice/ots/EXEMPLU-TOKEN'
});

console.log(rendered.html);
console.error(`subject: ${rendered.subject}`);
