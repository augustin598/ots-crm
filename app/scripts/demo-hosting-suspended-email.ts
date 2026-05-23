/**
 * Standalone demo of the hosting suspended (customer alert) email.
 * Renders the email body inside a minimal mock branded shell so the demo
 * has zero DB dependencies (mirrors the convention used by the other
 * demo-*-email.ts scripts in this folder).
 *
 * Run:
 *   bun --bun scripts/demo-hosting-suspended-email.ts > /tmp/suspended-preview.html && open /tmp/suspended-preview.html
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

const fixture = {
	domain: 'example.ro',
	clientName: 'Ion Popescu',
	invoiceNumber: 'INV-2026-0123',
	invoiceDate: '15.05.2026',
	amountDue: 9950, // in cents → 99.50
	currency: 'RON',
	payUrl: 'https://clients.onetopsolution.ro/ots/invoices/inv-1/pay',
	supportEmail: 'support@onetopsolution.ro'
};

const themeColor = '#0ea5e9';
const dangerColor = '#dc2626';
const title = 'Hosting suspendat';
const subject = `\u{26A0}️ Contul de hosting suspendat — factură neachitată (${fixture.domain})`;
const amountMajor = (fixture.amountDue / 100).toFixed(2);

const bodyHtml = `
	<p>Salut <strong>${escapeHtml(fixture.clientName)}</strong>,</p>
	<p>
		Contul tău de hosting pentru <strong>${escapeHtml(fixture.domain)}</strong> a fost
		<strong style="color:${dangerColor};">suspendat</strong> deoarece factura
		de mai jos este neachitată.
	</p>

	<h3 style="margin-top:24px;">Detalii factură</h3>
	<table style="border-collapse:collapse;width:100%;max-width:480px;">
		<tr><td style="padding:6px 0;color:#666;">Factură</td><td style="padding:6px 0;"><strong>${escapeHtml(fixture.invoiceNumber)}</strong></td></tr>
		<tr><td style="padding:6px 0;color:#666;">Data emiterii</td><td style="padding:6px 0;">${escapeHtml(fixture.invoiceDate)}</td></tr>
		<tr><td style="padding:6px 0;color:#666;">Sumă datorată</td><td style="padding:6px 0;"><strong>${escapeHtml(amountMajor)} ${escapeHtml(fixture.currency)}</strong></td></tr>
	</table>

	<div style="text-align: center; margin: 24px 0;">
		<a href="${escapeHtml(fixture.payUrl)}"
		   style="background-color: ${dangerColor}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">
			Plătește acum
		</a>
	</div>

	<p style="margin-top:24px;">
		După confirmarea plății, contul va fi reactivat automat în câteva minute.
	</p>

	<p style="margin-top:32px;color:#666;font-size:13px;">
		Pentru întrebări sau probleme cu plata, scrie-ne la
		<a href="mailto:${escapeHtml(fixture.supportEmail)}">${escapeHtml(fixture.supportEmail)}</a>.
	</p>
`;

const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Hosting suspendat — ${escapeHtml(fixture.domain)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
	<div style="max-width: 600px; margin: 0 auto; padding: 32px 20px;">
		<div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 32px;">
			<h1 style="color: ${themeColor}; font-size: 22px; margin: 0 0 6px 0; line-height: 1.2;">${title}</h1>
			<p style="color: #6b7280; font-size: 13px; margin: 0 0 24px 0;">Marketing &amp; Hosting</p>
			<div style="height: 1px; background-color: #e5e7eb; margin: 0 0 24px 0;"></div>
			${bodyHtml}
			<div style="height: 1px; background-color: #e5e7eb; margin: 18px 0 18px 0;"></div>
			<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0;">Pentru întrebări sau clarificări, nu ezitați să ne contactați.</p>
		</div>
	</div>
</body>
</html>`;

console.log(`<!-- Subject: ${subject} -->`);
console.log(html);
