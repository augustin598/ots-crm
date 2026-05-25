/**
 * Render-only helper for the customer "Plată primită" (invoice paid) email.
 *
 * Pure function — no DB, no I/O, no SvelteKit virtual modules. Production code
 * (`sendInvoicePaidEmail` in `$lib/server/email.ts`) calls this after resolving
 * tenant/client/invoice rows; demo scripts and admin previews call it with
 * fixture data.
 *
 * Brings the payment-succeeded email to parity with the other 7 hosting-flow
 * templates: a pure `render(input)` helper consumed by both production and
 * the zero-DB preview script.
 */

export interface InvoicePaidRenderInput {
	tenantName: string;
	themeColor: string;
	headerLogoHtml: string;
	clientName: string;
	invoiceNumber: string;
	totalAmount: number | null | undefined;
	currency: string;
	paidDate: Date | string | null | undefined;
	issueDate: Date | string | null | undefined;
	invoiceUrl: string;
}

const BRAND_MOTTO = 'Digital Marketing &amp; Growth Solutions';

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function trimPlainText(text: string): string {
	return text.replace(/^\t+/gm, '').trim();
}

function formatDateRo(date: string | Date | null | undefined): string {
	if (!date) return 'N/A';
	const d = new Date(date);
	if (isNaN(d.getTime())) return 'N/A';
	return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatAmount(cents: number | null | undefined, currency: string): string {
	if (cents === null || cents === undefined) return 'N/A';
	return `${(cents / 100).toFixed(2)} ${currency}`;
}

function renderCtaButton(href: string, label: string, themeColor: string): string {
	return `<div style="text-align: center; margin: 24px 0;">
		<a href="${href}" style="background-color: ${themeColor}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">${label}</a>
	</div>`;
}

interface BrandedEmailOptions {
	themeColor: string;
	headerLogoHtml: string;
	title: string;
	bodyHtml: string;
	previewTitle?: string;
}

function renderBrandedEmail(opts: BrandedEmailOptions): string {
	const subtitleBlock = `<p class="ots-subtitle" style="color: #6b7280; font-size: 13px; margin: 0 0 24px 0;">${BRAND_MOTTO}</p>`;
	const footer = 'Pentru întrebări sau clarificări, nu ezitați să ne contactați.';
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${opts.previewTitle ?? opts.title}</title>
	<style>
		@media only screen and (max-width: 480px) {
			.ots-outer { padding: 16px 8px !important; }
			.ots-card { padding: 20px 18px !important; border-radius: 8px !important; }
			.ots-title { font-size: 18px !important; line-height: 1.25 !important; word-break: break-word; }
			.ots-subtitle { font-size: 12px !important; line-height: 1.5 !important; }
			.ots-stack td { display: block !important; width: 100% !important; padding: 0 !important; }
			.ots-stack-right { text-align: left !important; padding-top: 10px !important; white-space: normal !important; }
			.ots-card-inner { padding: 16px 16px !important; }
			.ots-details { padding: 12px 14px !important; }
		}
	</style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
	<div class="ots-outer" style="max-width: 600px; margin: 0 auto; padding: 32px 20px;">
		<div class="ots-card" style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 32px;">
			${opts.headerLogoHtml}
			<h1 class="ots-title" style="color: ${opts.themeColor}; font-size: 22px; margin: 0 0 6px 0; line-height: 1.2;">${opts.title}</h1>
			${subtitleBlock}
			<div style="height: 1px; background-color: #e5e7eb; margin: 0 0 24px 0;"></div>
			${opts.bodyHtml}
			<div style="height: 1px; background-color: #e5e7eb; margin: 0 0 18px 0;"></div>
			<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0;">${footer}</p>
		</div>
	</div>
</body>
</html>`;
}

/**
 * Renders the "Plată primită" customer email body. Pure function — no DB,
 * no I/O. Production code calls this after resolving tenant/client/invoice
 * rows; demo scripts and admin previews call it with fixture data.
 */
export function renderInvoicePaidEmailHtml(input: InvoicePaidRenderInput): {
	subject: string;
	html: string;
	text: string;
} {
	const safeClientName = escapeHtml(input.clientName || 'Client');
	const subject = `Plata primita: Factura ${input.invoiceNumber}`;

	const bodyHtml = `
		<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Stimate/Stimată ${safeClientName},</p>
		<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Am primit plata pentru următoarea factură:</p>
		<table role="presentation" cellpadding="0" cellspacing="0" class="ots-details" style="width: 100%; background-color: #f0fdf4; border-left: 3px solid #10b981; border-radius: 8px; margin: 0 0 20px 0;">
			<tr>
				<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
					<div><span style="color: #6b7280;">Număr factură</span> &nbsp;·&nbsp; <strong>${escapeHtml(input.invoiceNumber)}</strong></div>
					<div><span style="color: #6b7280;">Suma plătită</span> &nbsp;·&nbsp; <strong>${formatAmount(input.totalAmount, input.currency)}</strong></div>
					${input.paidDate ? `<div><span style="color: #6b7280;">Data plății</span> &nbsp;·&nbsp; <strong>${formatDateRo(input.paidDate)}</strong></div>` : ''}
					${input.issueDate ? `<div><span style="color: #6b7280;">Data emitere</span> &nbsp;·&nbsp; <strong>${formatDateRo(input.issueDate)}</strong></div>` : ''}
				</td>
			</tr>
		</table>
		<p style="color: #15803d; font-weight: 600; font-size: 15px; margin: 0 0 20px 0;">Vă mulțumim pentru plată!</p>
		${renderCtaButton(input.invoiceUrl, 'Vezi factura', input.themeColor)}
	`;

	const html = renderBrandedEmail({
		themeColor: input.themeColor,
		headerLogoHtml: input.headerLogoHtml,
		title: 'Plată primită',
		bodyHtml,
		previewTitle: subject
	});

	const text = trimPlainText(`
		Plata primita

		Stimate/Stimata ${input.clientName || 'Client'},

		Am primit plata pentru urmatoarea factura:

		Numar factura: ${input.invoiceNumber}
		Suma platita: ${formatAmount(input.totalAmount, input.currency)}
		${input.paidDate ? `Data plata: ${formatDateRo(input.paidDate)}\n` : ''}
		${input.issueDate ? `Data emitere: ${formatDateRo(input.issueDate)}\n` : ''}

		Va multumim pentru plata!

		Vezi factura: ${input.invoiceUrl}

		Pentru intrebari, nu ezitati sa ne contactati.
	`);

	return { subject, html, text };
}
