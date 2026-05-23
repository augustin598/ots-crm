/**
 * Standalone demo of the admin-payment-received (internal alert) email.
 * Renders the email body inside a minimal mock branded shell so the demo
 * has zero DB dependencies (mirrors the convention used by the other
 * demo-*-email.ts scripts in this folder).
 *
 * Run:
 *   bun --bun scripts/demo-admin-payment-received-email.ts > /tmp/admin-paid-preview.html && open /tmp/admin-paid-preview.html
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

type StepStatus = 'success' | 'failed' | 'skipped' | 'pending';

const fixture = {
	tenantSlug: 'ots',
	clientName: 'Acme SRL',
	amount: 24990, // 249.90
	currency: 'RON',
	invoiceNumber: 'OTS-2026-0042',
	productDescriptions: ['Hosting Pro — 1 an', 'SSL gratuit', 'Domain .ro înregistrare 1 an'],
	crmInvoiceUrl: 'https://clients.onetopsolution.ro/ots/invoices/inv-42',
	stepStatuses: {
		magic_link: 'success' as StepStatus,
		keez_invoice: 'success' as StepStatus,
		da_provision: 'failed' as StepStatus
	}
};

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

const themeColor = '#0ea5e9';
const title = 'Plată nouă procesată';
const amountMajor = (fixture.amount / 100).toFixed(2);
const subject = `\u{1F4B0} Plată nouă: ${amountMajor} ${fixture.currency} — ${escapeHtml(fixture.clientName)} (${escapeHtml(fixture.tenantSlug)})`;

const productsListHtml = fixture.productDescriptions
	.map((p) => `<li>${escapeHtml(p)}</li>`)
	.join('\n\t\t\t');

const stepRows = Object.entries(fixture.stepStatuses)
	.map(([stepName, status]) => {
		const color = statusColor(status);
		return `<li><code>${escapeHtml(stepName)}</code> — <strong style="color:${color};">${escapeHtml(status)}</strong></li>`;
	})
	.join('\n\t\t\t');

const bodyHtml = `
	<p>O plată nouă a fost procesată.</p>

	<h3 style="margin-top:24px;">Detalii plată</h3>
	<table style="border-collapse:collapse;width:100%;max-width:480px;">
		<tr><td style="padding:6px 0;color:#666;">Tenant</td><td style="padding:6px 0;"><strong>${escapeHtml(fixture.tenantSlug)}</strong></td></tr>
		<tr><td style="padding:6px 0;color:#666;">Client</td><td style="padding:6px 0;"><strong>${escapeHtml(fixture.clientName)}</strong></td></tr>
		<tr><td style="padding:6px 0;color:#666;">Sumă</td><td style="padding:6px 0;"><strong>${escapeHtml(amountMajor)} ${escapeHtml(fixture.currency)}</strong></td></tr>
		<tr><td style="padding:6px 0;color:#666;">Factură</td><td style="padding:6px 0;"><strong>${escapeHtml(fixture.invoiceNumber)}</strong></td></tr>
	</table>

	<h3 style="margin-top:24px;">Produse</h3>
	<ul>
		${productsListHtml}
	</ul>

	<h3 style="margin-top:24px;">Pași post-plată</h3>
	<ul>
		${stepRows}
	</ul>

	<div style="text-align: center; margin: 24px 0;">
		<a href="${escapeHtml(fixture.crmInvoiceUrl)}"
		   style="background-color: ${themeColor}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">
			Deschide factura în CRM
		</a>
	</div>

	<p style="margin-top:32px;color:#666;font-size:13px;">
		Acest email este o notificare internă — clientul a primit deja confirmarea de plată separat.
	</p>
`;

const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Plată nouă: ${amountMajor} ${escapeHtml(fixture.currency)} — ${escapeHtml(fixture.tenantSlug)}</title>
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
