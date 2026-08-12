/**
 * CTA-ul emailurilor de factură (factură nouă + reminder de restanță).
 *
 * Trăiește separat de `email.ts` ca să fie importabil fără DB/env — de scriptul
 * de preview (`scripts/demo-invoice-card-payment-email.ts`) și de teste. Copia
 * locală a butonului urmează convenția din `invoice-paid.ts`.
 */

function renderCtaButton(href: string, label: string, themeColor: string): string {
	return `<div style="text-align: center; margin: 24px 0;">
		<a href="${href}" style="background-color: ${themeColor}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">${label}</a>
	</div>`;
}

/**
 * Când plata cu cardul e disponibilă, butonul primar devine „Plătește cu cardul"
 * spre `?pay=1` (deschide direct formularul pe pagina publică), iar „Vezi factura
 * online" coboară ca link secundar. Fără Stripe activ pe tenant, rămâne exact
 * CTA-ul de dinainte — un singur buton „Vezi factura online".
 */
export function renderInvoiceCtaBlock(
	invoiceUrl: string,
	themeColor: string,
	canPayByCard: boolean
): string {
	if (!canPayByCard) return renderCtaButton(invoiceUrl, 'Vezi factura online', themeColor);
	return `${renderCtaButton(`${invoiceUrl}?pay=1`, 'Plătește cu cardul', themeColor)}
	<p style="text-align: center; margin: -12px 0 24px 0;">
		<a href="${invoiceUrl}" style="color: #6b7280; font-size: 13px; text-decoration: underline;">Vezi factura online</a>
	</p>`;
}
