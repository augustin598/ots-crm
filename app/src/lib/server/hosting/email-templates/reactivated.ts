import { fetchTenantBrand, renderCtaButton } from '$lib/server/email';
import { renderHostingShellWithBrand } from './_branded-shell';
import { escapeHtml } from './_escape-html';

export interface ReactivatedInput {
	tenantId: string;
	domain: string;
	clientName: string;
	invoiceNumber: string;
	/** Amount in cents (per invoice.totalAmount schema convention). */
	amountPaid: number;
	currency: 'RON' | 'EUR' | 'USD';
	/** Public DA panel URL — `https://${server.hostname}:2222`. */
	daPanelUrl: string;
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

export async function render(input: ReactivatedInput): Promise<{ subject: string; html: string }> {
	const escDomain = escapeHtml(input.domain);
	const escClientName = escapeHtml(input.clientName);
	const escInvoiceNumber = escapeHtml(input.invoiceNumber);
	const escCurrency = escapeHtml(input.currency);
	const escDaPanelUrl = escapeHtml(input.daPanelUrl);
	const escAmount = escapeHtml(formatCentsToMajor(input.amountPaid));

	// Subject interpolations escaped to keep parity with body (same convention
	// established in Task 8 provisioning-failed: any downstream consumer that
	// renders the subject in an HTML context (admin email-log viewer, etc.)
	// must not see raw `<script>`).
	const subject = `\u{2705} Hosting reactivat — ${escDomain}`;

	// Brand fetched ONCE: shell uses it for header theme, and the CTA reuses
	// brand.themeColor (positive confirmation — fits the tenant's identity).
	const brand = await fetchTenantBrand(input.tenantId);

	const bodyHtml = `
		<p>Salut <strong>${escClientName}</strong>,</p>
		<p>
			Am primit plata pentru factura <strong>${escInvoiceNumber}</strong> în valoare de
			<strong>${escAmount} ${escCurrency}</strong>. Mulțumim!
		</p>
		<p>
			Contul tău de hosting pentru <strong>${escDomain}</strong> a fost
			<strong style="color:${brand.themeColor};">reactivat</strong> și este din nou
			funcțional. Poți accesa panoul DirectAdmin folosind butonul de mai jos.
		</p>

		${renderCtaButton(escDaPanelUrl, 'Deschide panoul DA', brand.themeColor)}

		<p style="margin-top:32px;">Mulțumim pentru încredere!</p>
	`;

	const html = renderHostingShellWithBrand({
		brand,
		title: 'Hosting reactivat',
		bodyHtml,
		previewTitle: `Hosting reactivat — ${escDomain}`
	});
	return { subject, html };
}
