/**
 * Preview pentru CTA-ul de plată cu cardul din emailurile de factură.
 *
 * Randează 4 variante într-o singură pagină:
 *   - factură nouă, cu / fără plată cu cardul
 *   - reminder de restanță, cu / fără plată cu cardul
 *
 * Folosește `renderInvoiceCtaBlock` REAL (modul pur, fără DB), deci previzualizarea
 * nu poate diverge de ce se trimite efectiv. Restul corpului e o replică a
 * shell-ului brandat, ca la celelalte demo-*-email.ts din folder.
 *
 * Run:
 *   bun --bun scripts/demo-invoice-card-payment-email.ts > /tmp/invoice-cta-preview.html && open /tmp/invoice-cta-preview.html
 */

import { renderInvoiceCtaBlock } from '../src/lib/server/email-templates/invoice-cta';

const themeColor = '#3b82f6';
const invoiceUrl = 'https://clients.onetopsolution.ro/invoice/ots/9OKg6JNDKSmQbDIg6Tht848fijTyfOPavVglhRxp7eo%3D';

// Fixture real: OTSH 8, MADDIE SYSTEMS — 749.00 net + 21% TVA = 906.29 RON.
const fixture = {
	invoiceNumber: 'OTSH 8',
	clientName: 'MADDIE SYSTEMS S.R.L.',
	total: '906.29 RON',
	dueDate: '02.08.2026',
	daysOverdue: 10,
	bankName: 'Banca Transilvania',
	ibanLei: 'RO86BTRLRONCRT0471538001',
	ibanEur: 'RO36BTRLEURCRT0471538001'
};

const ibanHtml = `<div style="background-color: #f9fafb; border-left: 3px solid ${themeColor}; padding: 14px 16px; border-radius: 6px; margin: 0 0 20px 0;">
	<p style="color: #111827; font-weight: 600; font-size: 14px; margin: 0 0 6px 0;">Date pentru plată</p>
	<p style="color: #374151; font-size: 13px; margin: 2px 0;"><span style="color: #6b7280;">Banca</span> &nbsp;·&nbsp; ${fixture.bankName}</p>
	<p style="color: #374151; font-size: 13px; margin: 2px 0;"><span style="color: #6b7280;">IBAN (LEI)</span> &nbsp;·&nbsp; ${fixture.ibanLei}</p>
	<p style="color: #374151; font-size: 13px; margin: 2px 0;"><span style="color: #6b7280;">IBAN (EUR)</span> &nbsp;·&nbsp; ${fixture.ibanEur}</p>
</div>`;

function invoiceBody(canPayByCard: boolean): string {
	return `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Stimate/Stimată ${fixture.clientName},</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Vă transmitem factura de la <strong>ONE TOP SOLUTION</strong>.</p>
	<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; table-layout: fixed; background-color: #f9fafb; border-radius: 8px; margin: 0 0 20px 0;">
		<tr>
			<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
				<div><span style="color: #6b7280;">Număr factură</span> &nbsp;·&nbsp; <strong>${fixture.invoiceNumber}</strong></div>
				<div><span style="color: #6b7280;">Scadență</span> &nbsp;·&nbsp; <strong>${fixture.dueDate}</strong></div>
				<div><span style="color: #6b7280;">Total de plată</span> &nbsp;·&nbsp; <strong>${fixture.total}</strong></div>
			</td>
		</tr>
	</table>
	${ibanHtml}
	<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 12px 0;">📎 Factura este atașată în format PDF la acest email.</p>
	${renderInvoiceCtaBlock(invoiceUrl, themeColor, canPayByCard)}
	<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 8px 0;">Plata este scadentă la ${fixture.dueDate}.</p>`;
}

function reminderBody(canPayByCard: boolean): string {
	return `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Stimate/Stimată ${fixture.clientName},</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Vă reamintim că factura de mai jos este restantă de <strong>${fixture.daysOverdue} zile</strong>.</p>
	<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; table-layout: fixed; background-color: #fffbeb; border-left: 3px solid #d97706; border-radius: 8px; margin: 0 0 20px 0;">
		<tr>
			<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
				<div><span style="color: #6b7280;">Număr factură</span> &nbsp;·&nbsp; <strong>${fixture.invoiceNumber}</strong></div>
				<div><span style="color: #6b7280;">Suma de plată</span> &nbsp;·&nbsp; <strong>${fixture.total}</strong></div>
				<div><span style="color: #6b7280;">Scadență</span> &nbsp;·&nbsp; <strong>${fixture.dueDate}</strong></div>
				<div><span style="color: #6b7280;">Zile restanță</span> &nbsp;·&nbsp; <strong style="color: #d97706;">${fixture.daysOverdue}</strong></div>
			</td>
		</tr>
	</table>
	${ibanHtml}
	<p style="color: #374151; font-size: 14px; line-height: 1.6; margin: 0 0 12px 0;">Vă rugăm să efectuați plata cât mai curând posibil.</p>
	<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 12px 0;">📎 Factura este atașată în format PDF la acest email.</p>
	${renderInvoiceCtaBlock(invoiceUrl, themeColor, canPayByCard)}
	<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0;">Dacă ați efectuat deja plata, vă rugăm să ignorați acest email.</p>`;
}

function shell(label: string, title: string, bodyHtml: string): string {
	return `<section style="margin: 0 0 48px 0;">
	<p style="font-family: ui-monospace, monospace; font-size: 12px; color: #64748b; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.05em;">${label}</p>
	<div style="max-width: 600px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px;">
		<h1 style="color: ${themeColor}; font-size: 24px; margin: 0 0 4px 0;">${title}</h1>
		<p style="color: #6b7280; font-size: 14px; margin: 0 0 20px 0;">Digital Marketing &amp; Growth Solutions</p>
		<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0 0 24px 0;" />
		${bodyHtml}
	</div>
</section>`;
}

const html = `<!doctype html>
<html lang="ro">
<head>
	<meta charset="utf-8" />
	<title>Preview CTA plată cu cardul — emailuri factură</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f1f5f9; margin: 0; padding: 40px 24px;">
	<h1 style="font-size: 18px; color: #0f172a; margin: 0 0 32px 0;">CTA plată cu cardul — 4 variante</h1>
	${shell('Factură nouă · Stripe ACTIV', 'Factura OTSH 8', invoiceBody(true))}
	${shell('Factură nouă · Stripe INACTIV (comportament de dinainte)', 'Factura OTSH 8', invoiceBody(false))}
	${shell('Reminder restanță · Stripe ACTIV', 'Reminder plată factură', reminderBody(true))}
	${shell('Reminder restanță · Stripe INACTIV (comportament de dinainte)', 'Reminder plată factură', reminderBody(false))}
</body>
</html>`;

console.log(html);
