import { fetchTenantBrand, renderCtaButton } from '$lib/server/email';
import { renderHostingShellWithBrand } from '$lib/server/hosting/email-templates/_branded-shell';
import { escapeHtml } from '$lib/server/hosting/email-templates/_escape-html';

/**
 * Status label rendered in the post-payment step table.
 *
 * Free-form `string` would be safer (postPaymentStep.status is a TEXT column),
 * but constraining the type to the 4 known values lets the color-map below
 * stay exhaustive and lets TS catch typos in the dispatcher.
 */
type StepStatus = 'success' | 'failed' | 'skipped' | 'pending';

export interface AdminPaymentReceivedInput {
	tenantId: string;
	tenantSlug: string;
	clientName: string;
	/** Amount in cents (per invoice.totalAmount schema convention). */
	amount: number;
	currency: 'RON' | 'EUR' | 'USD';
	invoiceNumber: string;
	productDescriptions: string[];
	crmInvoiceUrl: string;
	/**
	 * Map of step name (free-form `postPaymentStep.step`) → status. Each step
	 * is rendered in a small list with the status color-coded. Step names ARE
	 * escaped on render because the column is free-form TEXT — a malicious or
	 * accidental write could include HTML.
	 */
	stepStatuses: Record<string, StepStatus>;
}

/**
 * Formats a cents amount as `99.50` (two-decimal). Returns `0.00` if cents is
 * not a finite number — defensive against an invoice whose totalAmount is null
 * (the resolver in notifications.ts falls back to 0).
 *
 * Mirrors the formatter in hosting/email-templates/reactivated.ts. Kept inline
 * (rather than extracted to a shared helper) to avoid scope creep on Task 14 —
 * the cross-folder import already pulls in two helpers, a third would warrant
 * a dedicated $lib/server/email-templates/ refactor.
 */
function formatCentsToMajor(cents: number): string {
	if (!Number.isFinite(cents)) return '0.00';
	return (cents / 100).toFixed(2);
}

/**
 * Maps a step status to its display color. Centralized here so the test
 * suite can assert the 4 hex values directly without duplicating the table.
 */
function statusColor(status: StepStatus): string {
	switch (status) {
		case 'success':
			return '#10b981';
		case 'failed':
			return '#dc2626';
		case 'skipped':
			return '#666';
		case 'pending':
			return '#f59e0b';
		default:
			return '#666';
	}
}

/**
 * Renders the admin-facing "payment received" alert sent at the END of the
 * Stripe post-payment pipeline. Shows tenant + client + amount + invoice +
 * products and color-coded step statuses so the on-call admin sees at a
 * glance whether each downstream step (magic_link, keez_invoice, da_provision)
 * succeeded.
 *
 * Template lives in stripe/email-templates/ (not hosting/) because the trigger
 * is the Stripe post-payment dispatcher — but it imports the hosting branded
 * shell helpers since they're shell utilities, not hosting-specific.
 */
export async function render(
	input: AdminPaymentReceivedInput
): Promise<{ subject: string; html: string }> {
	const escSlug = escapeHtml(input.tenantSlug);
	const escClientName = escapeHtml(input.clientName);
	const escInvoiceNumber = escapeHtml(input.invoiceNumber);
	const escCurrency = escapeHtml(input.currency);
	const escAmount = escapeHtml(formatCentsToMajor(input.amount));
	const escUrl = escapeHtml(input.crmInvoiceUrl);

	// Subject interpolations escaped to keep parity with body (same convention
	// established in Task 8 provisioning-failed: any downstream consumer that
	// renders the subject in an HTML context must not see raw `<script>`).
	const subject = `\u{1F4B0} Plată nouă: ${escAmount} ${escCurrency} — ${escClientName} (${escSlug})`;

	// Brand fetched ONCE: shell + CTA reuse brand.themeColor.
	const brand = await fetchTenantBrand(input.tenantId);

	// Products list — escape each description individually before joining.
	const productsListHtml =
		input.productDescriptions.length === 0
			? '<li style="color:#666;"><em>(niciun produs)</em></li>'
			: input.productDescriptions.map((p) => `<li>${escapeHtml(p)}</li>`).join('\n\t\t\t');

	// Step statuses list — each step name AND status are escaped, status color
	// derives from the typed StepStatus union. A step name from a malicious or
	// future migration (e.g. an unrecognized status) falls back to gray.
	const stepRows = Object.entries(input.stepStatuses)
		.map(([stepName, status]) => {
			const escStepName = escapeHtml(stepName);
			const escStatus = escapeHtml(status);
			const color = statusColor(status);
			return `<li><code>${escStepName}</code> — <strong style="color:${color};">${escStatus}</strong></li>`;
		})
		.join('\n\t\t\t');

	const bodyHtml = `
		<p>O plată nouă a fost procesată.</p>

		<h3 style="margin-top:24px;">Detalii plată</h3>
		<table style="border-collapse:collapse;width:100%;max-width:480px;">
			<tr><td style="padding:6px 0;color:#666;">Tenant</td><td style="padding:6px 0;"><strong>${escSlug}</strong></td></tr>
			<tr><td style="padding:6px 0;color:#666;">Client</td><td style="padding:6px 0;"><strong>${escClientName}</strong></td></tr>
			<tr><td style="padding:6px 0;color:#666;">Sumă</td><td style="padding:6px 0;"><strong>${escAmount} ${escCurrency}</strong></td></tr>
			<tr><td style="padding:6px 0;color:#666;">Factură</td><td style="padding:6px 0;"><strong>${escInvoiceNumber}</strong></td></tr>
		</table>

		<h3 style="margin-top:24px;">Produse</h3>
		<ul>
			${productsListHtml}
		</ul>

		<h3 style="margin-top:24px;">Pași post-plată</h3>
		<ul>
			${stepRows}
		</ul>

		${renderCtaButton(escUrl, 'Deschide factura în CRM', brand.themeColor)}

		<p style="margin-top:32px;color:#666;font-size:13px;">
			Acest email este o notificare internă — clientul a primit deja confirmarea de plată separat.
		</p>
	`;

	const html = renderHostingShellWithBrand({
		brand,
		title: 'Plată nouă procesată',
		bodyHtml,
		previewTitle: `Plată nouă: ${escAmount} ${escCurrency} — ${escSlug}`
	});
	return { subject, html };
}
