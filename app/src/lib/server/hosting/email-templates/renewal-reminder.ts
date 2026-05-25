import { fetchTenantBrand, renderCtaButton } from '$lib/server/email';
import { renderHostingShellWithBrand } from './_branded-shell';
import { escapeHtml } from './_escape-html';

export interface RenewalReminderInput {
	tenantId: string;
	domain: string;
	clientName: string;
	/** Formatted Romanian date (DD.MM.YYYY) — formatted by the caller. */
	dueDate: string;
	/** NET amount (pre-VAT) in cents — matches hostingAccount.recurringAmount which
	 * recurring-template.ts:270 treats as `rate` (pre-tax line item). */
	subtotal: number;
	/** VAT rate as integer percent (e.g., 21 for Romania 2025+). Pulled from
	 * invoiceSettings.defaultTaxRate by the caller — never hardcoded. */
	vatRate: number;
	/** VAT amount in cents: round(subtotal × vatRate / 100). */
	vatAmount: number;
	/** Total in cents: subtotal + vatAmount. This is what the client actually pays. */
	totalAmount: number;
	currency: 'RON' | 'EUR' | 'USD';
	/** 14 / 7 / 1 — which renewal reminder window this is. */
	daysUntilDue: 1 | 7 | 14;
	autoRenew: boolean;
	/** Public CRM URL for the customer to view payment details / pay. */
	payUrl: string;
}

/**
 * Formats a cents amount as `99.50` (two-decimal). Returns `0.00` if cents is
 * not a finite number — defensive against a hosting account whose recurringAmount
 * defaults to 0.
 */
function formatCentsToMajor(cents: number): string {
	if (!Number.isFinite(cents)) return '0.00';
	return (cents / 100).toFixed(2);
}

export async function render(input: RenewalReminderInput): Promise<{ subject: string; html: string }> {
	const escDomain = escapeHtml(input.domain);
	const escClientName = escapeHtml(input.clientName);
	const escDueDate = escapeHtml(input.dueDate);
	const escCurrency = escapeHtml(input.currency);
	const escPayUrl = escapeHtml(input.payUrl);
	const escSubtotal = escapeHtml(formatCentsToMajor(input.subtotal));
	const escVatAmount = escapeHtml(formatCentsToMajor(input.vatAmount));
	const escTotalAmount = escapeHtml(formatCentsToMajor(input.totalAmount));
	const escVatRate = escapeHtml(String(input.vatRate));

	// Singular vs plural Romanian: "1 zi" / "N zile". The subject + body both use
	// `dayWord` so the cadence reads naturally regardless of window.
	const dayWord = input.daysUntilDue === 1 ? '1 zi' : `${input.daysUntilDue} zile`;
	const escDayWord = escapeHtml(dayWord);

	// Subject interpolations escaped to keep parity with body (same convention
	// established in Task 8 provisioning-failed: any downstream consumer that
	// renders the subject in an HTML context (admin email-log viewer, etc.)
	// must not see raw `<script>`).
	const subject = `Hosting ${escDomain} expiră în ${escDayWord}`;

	// Brand fetched ONCE: the shell wants it, and the CTA reuses brand.themeColor
	// (informational reminder, not danger — fits the tenant's identity).
	const brand = await fetchTenantBrand(input.tenantId);

	// Conditional copy block: auto-renew customers get a neutral renewal notice
	// (no assumption about payment method — Stripe handles the charge automatically);
	// manual-pay customers see a suspension warning. Both stress the same day window.
	const autoRenewBlock = input.autoRenew
		? `<p>
				Reînnoirea va fi procesată automat în ${escDayWord}. Dacă dorești să
				modifici metoda de plată, te rugăm să o actualizezi înainte de data scadenței.
			</p>`
		: `<p>
				Plata manuală expiră în ${escDayWord}. După această dată, hostingul
				va fi <strong>suspendat</strong>.
			</p>`;

	// CTA label conditional on autoRenew — auto-renew customers just need to
	// review details, manual-pay customers need to take action now.
	const ctaLabel = input.autoRenew ? 'Vezi detalii plată' : 'Plătește acum';

	const bodyHtml = `
		<p>Salut <strong>${escClientName}</strong>,</p>
		<p>
			Contul tău de hosting pentru <strong>${escDomain}</strong> se reînnoiește
			în curând.
		</p>

		<h3 style="margin-top:24px;">Detalii reînnoire</h3>
		<table style="border-collapse:collapse;width:100%;max-width:480px;">
			<tr><td style="padding:6px 0;color:#666;">Data scadenței</td><td style="padding:6px 0;text-align:right;"><strong>${escDueDate}</strong></td></tr>
			<tr><td style="padding:6px 0;color:#666;">Sumă fără TVA</td><td style="padding:6px 0;text-align:right;">${escSubtotal} ${escCurrency}</td></tr>
			<tr><td style="padding:6px 0;color:#666;">TVA ${escVatRate}%</td><td style="padding:6px 0;text-align:right;">${escVatAmount} ${escCurrency}</td></tr>
			<tr><td style="padding:10px 0 6px 0;color:#111827;border-top:1px solid #e5e7eb;"><strong>Total de plată</strong></td><td style="padding:10px 0 6px 0;text-align:right;border-top:1px solid #e5e7eb;"><strong>${escTotalAmount} ${escCurrency}</strong></td></tr>
		</table>

		${autoRenewBlock}

		${renderCtaButton(escPayUrl, ctaLabel, brand.themeColor)}

		<p style="margin-top:32px;color:#666;font-size:13px;">
			Dacă ai întrebări, răspunde la acest email.
		</p>
	`;

	const html = renderHostingShellWithBrand({
		brand,
		title: 'Reminder reînnoire hosting',
		bodyHtml,
		previewTitle: `Reminder reînnoire — ${escDomain} (${escDayWord})`
	});
	return { subject, html };
}
