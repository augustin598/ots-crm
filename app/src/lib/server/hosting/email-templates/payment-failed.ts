import { fetchTenantBrand, renderCtaButton } from '$lib/server/email';
import { renderHostingShellWithBrand } from './_branded-shell';
import { escapeHtml } from './_escape-html';

export interface PaymentFailedInput {
	tenantId: string;
	domain: string;
	clientName: string;
	invoiceNumber: string;
	/** Amount in cents (per invoice.totalAmount schema convention). */
	amountDue: number;
	currency: 'RON' | 'EUR' | 'USD';
	/** Reason text surfaced from Stripe — e.g. "Card expired", "Insufficient funds". */
	failureReason: string;
	/** Stripe hosted invoice URL (or fallback CRM URL when none is available). */
	updateMethodUrl: string;
	/** Public CRM payment URL for this invoice. */
	manualPayUrl: string;
	/** How many days the customer has before the hosting account is suspended. */
	daysUntilSuspend: number;
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

export async function render(
	input: PaymentFailedInput
): Promise<{ subject: string; html: string }> {
	const escDomain = escapeHtml(input.domain);
	const escClientName = escapeHtml(input.clientName);
	const escInvoiceNumber = escapeHtml(input.invoiceNumber);
	const escCurrency = escapeHtml(input.currency);
	const escFailureReason = escapeHtml(input.failureReason);
	const escUpdateMethodUrl = escapeHtml(input.updateMethodUrl);
	const escManualPayUrl = escapeHtml(input.manualPayUrl);
	const escAmount = escapeHtml(formatCentsToMajor(input.amountDue));
	const escDays = escapeHtml(String(input.daysUntilSuspend));

	// Subject interpolations escaped to keep parity with body (same convention
	// established in Task 8 provisioning-failed: any downstream consumer that
	// renders the subject in an HTML context (admin email-log viewer, etc.)
	// must not see raw `<script>`).
	const subject = `Plata pentru hosting ${escDomain} a eșuat — acțiune necesară`;

	// Brand fetched ONCE: shell uses it for header theme, and the primary CTA
	// reuses brand.themeColor (this is an actionable reminder, not a danger
	// signal like the suspended/refunded reds — fits the tenant's identity).
	const brand = await fetchTenantBrand(input.tenantId);

	// Secondary (outlined) CTA — renderCtaButton in $lib/server/email only
	// supports a solid-fill variant (verified: 3-arg signature, single style
	// block). Inline the outlined HTML here rather than churn the shared
	// helper for one consumer.
	const secondaryCtaHtml = `
		<div style="text-align: center; margin: 16px 0;">
			<a href="${escManualPayUrl}" style="background-color: #ffffff; color: ${brand.themeColor}; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px; border: 2px solid ${brand.themeColor};">Plătește manual</a>
		</div>
	`;

	const bodyHtml = `
		<p>Salut <strong>${escClientName}</strong>,</p>
		<p>
			Plata automată pentru factura <strong>${escInvoiceNumber}</strong> în valoare de
			<strong>${escAmount} ${escCurrency}</strong> aferentă hostingului
			<strong>${escDomain}</strong> a eșuat.
		</p>

		<p style="margin-top:16px;">
			<strong>Motiv:</strong> ${escFailureReason}
		</p>

		<p style="margin-top:16px;">
			Dacă nu rezolvi situația în <strong>${escDays} zile</strong>, hostingul va fi
			suspendat.
		</p>

		${renderCtaButton(escUpdateMethodUrl, 'Actualizează metoda de plată', brand.themeColor)}

		${secondaryCtaHtml}

		<p style="margin-top:32px;color:#666;font-size:13px;">
			Dacă ai întrebări, răspunde la acest email.
		</p>
	`;

	const html = renderHostingShellWithBrand({
		brand,
		title: 'Plată eșuată',
		bodyHtml,
		previewTitle: `Plată eșuată — ${escDomain}`
	});
	return { subject, html };
}
