/**
 * Standalone demo of the hosting renewal-reminder (customer reminder) email.
 * Renders the email body inside a minimal mock branded shell so the demo
 * has zero DB dependencies (mirrors the convention used by the other
 * demo-*-email.ts scripts in this folder).
 *
 * Iterates all 6 variants ([14, 7, 1] × [autoRenew on/off]) into one HTML
 * page so the reviewer can scroll through every combination at once.
 *
 * Run:
 *   bun --bun scripts/demo-hosting-renewal-reminder-email.ts > /tmp/renewal-preview.html && open /tmp/renewal-preview.html
 */

function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(c) =>
			({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;'
			})[c] as string
	);
}

// 692.00 RON net + 21% VAT (RO 2025+) = 145.32 RON VAT + 837.32 RON total.
// Realistic fixture matching what tenant 'ots' actually bills.
const SUBTOTAL_CENTS = 69200;
const VAT_RATE = 21;
const VAT_AMOUNT_CENTS = Math.round((SUBTOTAL_CENTS * VAT_RATE) / 100);
const TOTAL_CENTS = SUBTOTAL_CENTS + VAT_AMOUNT_CENTS;

const baseFixture = {
	domain: 'example.ro',
	clientName: 'Ion Popescu',
	dueDate: '01.06.2026',
	subtotal: SUBTOTAL_CENTS,
	vatRate: VAT_RATE,
	vatAmount: VAT_AMOUNT_CENTS,
	totalAmount: TOTAL_CENTS,
	currency: 'RON',
	payUrl: 'https://clients.onetopsolution.ro/ots/hosting/accounts/acc-1/renew'
};

const themeColor = '#0ea5e9';
const title = 'Reminder reînnoire hosting';

function renderVariant(daysUntilDue: 1 | 7 | 14, autoRenew: boolean): string {
	const dayWord = daysUntilDue === 1 ? '1 zi' : `${daysUntilDue} zile`;
	const subject = `Hosting ${baseFixture.domain} expiră în ${dayWord}`;
	const subtotalMajor = (baseFixture.subtotal / 100).toFixed(2);
	const vatMajor = (baseFixture.vatAmount / 100).toFixed(2);
	const totalMajor = (baseFixture.totalAmount / 100).toFixed(2);

	const autoRenewBlock = autoRenew
		? `<p>
				Reînnoirea va fi procesată automat în ${escapeHtml(dayWord)}. Dacă dorești să
				modifici metoda de plată, te rugăm să o actualizezi înainte de data scadenței.
			</p>`
		: `<p>
				Plata manuală expiră în ${escapeHtml(dayWord)}. După această dată, hostingul
				va fi <strong>suspendat</strong>.
			</p>`;

	const ctaLabel = autoRenew ? 'Vezi detalii plată' : 'Plătește acum';

	const bodyHtml = `
		<p>Salut <strong>${escapeHtml(baseFixture.clientName)}</strong>,</p>
		<p>
			Contul tău de hosting pentru <strong>${escapeHtml(baseFixture.domain)}</strong> se reînnoiește
			în curând.
		</p>

		<h3 style="margin-top:24px;">Detalii reînnoire</h3>
		<table style="border-collapse:collapse;width:100%;max-width:480px;">
			<tr><td style="padding:6px 0;color:#666;">Data scadenței</td><td style="padding:6px 0;text-align:right;"><strong>${escapeHtml(baseFixture.dueDate)}</strong></td></tr>
			<tr><td style="padding:6px 0;color:#666;">Sumă fără TVA</td><td style="padding:6px 0;text-align:right;">${escapeHtml(subtotalMajor)} ${escapeHtml(baseFixture.currency)}</td></tr>
			<tr><td style="padding:6px 0;color:#666;">TVA ${baseFixture.vatRate}%</td><td style="padding:6px 0;text-align:right;">${escapeHtml(vatMajor)} ${escapeHtml(baseFixture.currency)}</td></tr>
			<tr><td style="padding:10px 0 6px 0;color:#111827;border-top:1px solid #e5e7eb;"><strong>Total de plată</strong></td><td style="padding:10px 0 6px 0;text-align:right;border-top:1px solid #e5e7eb;"><strong>${escapeHtml(totalMajor)} ${escapeHtml(baseFixture.currency)}</strong></td></tr>
		</table>

		${autoRenewBlock}

		<div style="text-align: center; margin: 24px 0;">
			<a href="${escapeHtml(baseFixture.payUrl)}"
			   style="background-color: ${themeColor}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">
				${ctaLabel}
			</a>
		</div>

		<p style="margin-top:32px;color:#666;font-size:13px;">
			Dacă ai întrebări, răspunde la acest email.
		</p>
	`;

	return `
		<div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
			<p style="color: #9333ea; font-size: 12px; font-weight: 600; margin: 0 0 12px 0;">
				Variant: ${daysUntilDue}d / autoRenew=${autoRenew} — Subject: ${escapeHtml(subject)}
			</p>
			<h1 style="color: ${themeColor}; font-size: 22px; margin: 0 0 6px 0; line-height: 1.2;">${title}</h1>
			<p style="color: #6b7280; font-size: 13px; margin: 0 0 24px 0;">Marketing &amp; Hosting</p>
			<div style="height: 1px; background-color: #e5e7eb; margin: 0 0 24px 0;"></div>
			${bodyHtml}
			<div style="height: 1px; background-color: #e5e7eb; margin: 18px 0 18px 0;"></div>
			<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0;">Pentru întrebări sau clarificări, nu ezitați să ne contactați.</p>
		</div>
	`;
}

const variants: Array<[1 | 7 | 14, boolean]> = [
	[14, true],
	[14, false],
	[7, true],
	[7, false],
	[1, true],
	[1, false]
];

const allVariantsHtml = variants.map(([d, ar]) => renderVariant(d, ar)).join('\n<hr/>\n');

const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Renewal reminder demo (all variants)</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
	<div style="max-width: 700px; margin: 0 auto; padding: 32px 20px;">
		<h2 style="margin: 0 0 16px 0;">Renewal reminder — 6 variants</h2>
		<p style="color: #6b7280;">Iterating [14, 7, 1] × [autoRenew on/off]. Scroll to see each rendered variant.</p>
		${allVariantsHtml}
	</div>
</body>
</html>`;

console.log(html);
