import { fetchTenantBrand, renderCtaButton } from '$lib/server/email';
import { renderHostingShellWithBrand } from './_branded-shell';
import { escapeHtml } from './_escape-html';

export interface SuspendedInput {
	tenantId: string;
	domain: string;
	clientName: string;
	invoiceNumber: string;
	/** Formatted Romanian date (DD.MM.YYYY) — formatted by the caller. */
	invoiceDate: string;
	/** Amount in cents (per invoice.totalAmount schema convention). */
	amountDue: number;
	currency: 'RON' | 'EUR' | 'USD';
	/** Public CRM payment URL for this invoice. */
	payUrl: string;
	supportEmail: string;
}

/**
 * Formats a cents amount as `99.50` (two-decimal). Returns `0.00` if cents is
 * not a finite number — defensive against an invoice whose totalAmount is null
 * (the resolver in notifications.ts falls back to 0).
 */
function formatCentsToMajor(cents: number): string {
	if (!Number.isFinite(cents)) return '0.00';
	return (cents / 100).toFixed(2);
}

export async function render(input: SuspendedInput): Promise<{ subject: string; html: string }> {
	const escDomain = escapeHtml(input.domain);
	const escClientName = escapeHtml(input.clientName);
	const escInvoiceNumber = escapeHtml(input.invoiceNumber);
	const escInvoiceDate = escapeHtml(input.invoiceDate);
	const escCurrency = escapeHtml(input.currency);
	const escSupportEmail = escapeHtml(input.supportEmail);
	const escPayUrl = escapeHtml(input.payUrl);
	const escAmount = escapeHtml(formatCentsToMajor(input.amountDue));

	// Subject interpolations escaped to keep parity with body (same convention
	// established in Task 8 provisioning-failed: any downstream consumer that
	// renders the subject in an HTML context (admin email-log viewer, etc.)
	// must not see raw `<script>`).
	const subject = `\u{26A0}️ Contul de hosting suspendat — factură neachitată (${escDomain})`;

	// Brand fetched ONCE: the shell wants it, but the body uses a hard-coded
	// red (#dc2626) for the CTA — payment urgency, NOT brand theme.
	const brand = await fetchTenantBrand(input.tenantId);

	// Red CTA color override. Hard-coded literal (NOT brand.themeColor) because
	// the visual urgency is the whole point of the message — we want every
	// tenant's customer to see red here regardless of their brand.
	const dangerColor = '#dc2626';

	const bodyHtml = `
		<p>Salut <strong>${escClientName}</strong>,</p>
		<p>
			Contul tău de hosting pentru <strong>${escDomain}</strong> a fost
			<strong style="color:${dangerColor};">suspendat</strong> deoarece factura
			de mai jos este neachitată.
		</p>

		<h3 style="margin-top:24px;">Detalii factură</h3>
		<table style="border-collapse:collapse;width:100%;max-width:480px;">
			<tr><td style="padding:6px 0;color:#666;">Factură</td><td style="padding:6px 0;"><strong>${escInvoiceNumber}</strong></td></tr>
			<tr><td style="padding:6px 0;color:#666;">Data emiterii</td><td style="padding:6px 0;">${escInvoiceDate}</td></tr>
			<tr><td style="padding:6px 0;color:#666;">Sumă datorată</td><td style="padding:6px 0;"><strong>${escAmount} ${escCurrency}</strong></td></tr>
		</table>

		${renderCtaButton(escPayUrl, 'Plătește acum', dangerColor)}

		<p style="margin-top:24px;">
			După confirmarea plății, contul va fi reactivat automat în câteva minute.
		</p>

		<p style="margin-top:32px;color:#666;font-size:13px;">
			Pentru întrebări sau probleme cu plata, scrie-ne la
			<a href="mailto:${escSupportEmail}">${escSupportEmail}</a>.
		</p>
	`;

	const html = renderHostingShellWithBrand({
		brand,
		title: 'Hosting suspendat',
		bodyHtml,
		previewTitle: `Hosting suspendat — ${escDomain}`
	});
	return { subject, html };
}
