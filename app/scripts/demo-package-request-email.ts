/**
 * Demo pentru emailul „Cerere pachet nouă" (package-request), în ambele variante:
 *   1. cerere din portalul clientului (client existent în CRM)
 *   2. cerere de pe pagina publică /servicii (fără cont — contact din formular)
 *
 * Randează corpul emailului într-un shell minimal, fără DB și fără trimitere —
 * aceeași convenție ca restul scripturilor demo-*-email.ts din folder.
 *
 * Run:
 *   bun --bun scripts/demo-package-request-email.ts > /tmp/package-request-preview.html && open /tmp/package-request-preview.html
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

type Request = {
	label: string;
	source: 'portal' | 'public';
	clientName: string;
	clientEmail: string;
	companyName?: string;
	contactPhone?: string;
	categorySlug: string;
	tier: string;
	note?: string;
};

const themeColor = '#0ea5e9';
const adminUrl = 'https://clients.onetopsolution.ro/ots/services?tab=requests&id=req-demo';

const fixtures: Request[] = [
	{
		label: 'Cerere din portalul clientului',
		source: 'portal',
		clientName: 'Acme SRL',
		clientEmail: 'contact@acme.ro',
		categorySlug: 'google-ads',
		tier: 'gold',
		note: 'Vrem să pornim pe 1 septembrie, buget media ~1.500 €/lună.'
	},
	{
		label: 'Cerere de pe pagina publică /servicii',
		source: 'public',
		clientName: 'Ion Popescu',
		clientEmail: 'ion.popescu@example.com',
		companyName: 'Example SRL',
		contactPhone: '0722 123 456',
		categorySlug: 'seo',
		tier: 'silver',
		note: 'Magazin online de mobilă, ținta e zona Suceava–Botoșani.'
	}
];

function renderBody(r: Request): string {
	const isPublicRequest = r.source === 'public';
	const safeClientName = escapeHtml(r.clientName);
	const safeClientEmail = escapeHtml(r.clientEmail);
	const safeCompanyName = r.companyName ? escapeHtml(r.companyName) : '';
	const safeContactPhone = r.contactPhone ? escapeHtml(r.contactPhone) : '';
	const safeNote = r.note ? escapeHtml(r.note) : '';
	const categoryLabel = escapeHtml(r.categorySlug);
	const tierLabel = escapeHtml(r.tier.charAt(0).toUpperCase() + r.tier.slice(1));

	return `
		<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua Augustin,</p>
		<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">${
			isPublicRequest
				? 'O cerere de ofertă a fost trimisă de pe pagina publică'
				: 'Un client a solicitat un serviciu din CRM'
		}:</p>
		<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; table-layout: fixed; background-color: #f9fafb; border-radius: 8px; margin: 0 0 20px 0;">
			<tr>
				<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.8;">
					<div style="margin-bottom: 6px;"><span style="color: #6b7280;">${isPublicRequest ? 'Contact' : 'Client'}</span> &nbsp;·&nbsp; <strong>${safeClientName}</strong> <span style="color:#6b7280;">(${safeClientEmail})</span></div>
					${safeCompanyName ? `<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Companie</span> &nbsp;·&nbsp; <strong>${safeCompanyName}</strong></div>` : ''}
					${safeContactPhone ? `<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Telefon</span> &nbsp;·&nbsp; <strong>${safeContactPhone}</strong></div>` : ''}
					${isPublicRequest ? `<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Sursă</span> &nbsp;·&nbsp; <strong>Pagina publică /servicii</strong></div>` : ''}
					<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Categorie</span> &nbsp;·&nbsp; <strong>${categoryLabel}</strong></div>
					<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Pachet</span> &nbsp;·&nbsp; <strong>${tierLabel}</strong></div>
					${safeNote ? `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #d1d5db;"><span style="color: #6b7280;">Notă client:</span><div style="margin-top: 6px; color: #111827; white-space: pre-line;">${safeNote}</div></div>` : ''}
				</td>
			</tr>
		</table>
		<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius: 8px; background: ${themeColor};">
			<a href="${adminUrl}" style="display: inline-block; padding: 12px 22px; color: #fff; font-size: 14px; font-weight: 600; text-decoration: none;">Vezi cererea în CRM</a>
		</td></tr></table>
	`;
}

const sections = fixtures
	.map(
		(r) => `
	<section style="margin: 0 0 40px 0;">
		<h2 style="font: 600 13px/1.4 system-ui, sans-serif; text-transform: uppercase; letter-spacing: .06em; color: #6b7280;">
			${escapeHtml(r.label)}
		</h2>
		<p style="font: 400 12px/1.4 system-ui, sans-serif; color: #9ca3af; margin: 4px 0 12px 0;">
			Subiect: Cerere pachet nouă — ${escapeHtml(r.categorySlug)} ${escapeHtml(r.tier)}
		</p>
		<div style="max-width: 600px; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 28px;">
			<h1 style="font: 700 20px/1.3 system-ui, sans-serif; color: #111827; margin: 0 0 20px 0;">Cerere pachet nouă</h1>
			${renderBody(r)}
			<p style="color: #9ca3af; font-size: 12px; margin: 24px 0 0 0;">
				Trimis automat de One Top Solution când un client cere un pachet.
			</p>
		</div>
	</section>`
	)
	.join('\n');

console.log(`<!doctype html>
<html lang="ro">
<head>
	<meta charset="utf-8" />
	<title>Demo — email cerere pachet</title>
</head>
<body style="margin: 0; padding: 40px 24px; background: #f3f4f6;">
${sections}
</body>
</html>`);
