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
	/** Ofertă multi-serviciu de pe /servicii (coloana `items`): un rând per serviciu. */
	items?: { name: string; tier: string; price: string }[];
	discountPct?: number;
	monthlySubtotal?: string;
	monthlyTotal?: string;
	setupTotal?: string;
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
	},
	{
		label: 'Cerere de ofertă multi-serviciu (coșul de pe /servicii)',
		source: 'public',
		clientName: 'Maria Ionescu',
		clientEmail: 'maria@example.ro',
		companyName: 'Maria SRL',
		contactPhone: '0733 000 111',
		categorySlug: 'google-ads',
		tier: 'gold',
		items: [
			{ name: 'Google Ads', tier: 'Gold', price: '900 €/lună' },
			{ name: 'SEO', tier: 'Bronze', price: '400 €/lună' },
			{ name: 'Website WordPress', tier: 'Silver', price: '1.500 € one-time' }
		],
		discountPct: 15,
		monthlySubtotal: '1.300 €',
		monthlyTotal: '1.105 €',
		setupTotal: '1.500 €',
		note: 'Vrem să pornim în septembrie.'
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
	const isQuote = !!r.items?.length;
	const quoteRowsHtml = (r.items ?? [])
		.map(
			(i) =>
				`<tr><td style="padding: 4px 0; color: #111827;">${escapeHtml(i.name)}</td><td style="padding: 4px 10px; color: #6b7280;">${escapeHtml(i.tier)}</td><td style="padding: 4px 0; text-align: right; color: #111827; white-space: nowrap;">${escapeHtml(i.price)}</td></tr>`
		)
		.join('');
	const quoteHtml = isQuote
		? `<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Servicii cerute</span></div>
					<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; font-size: 14px; margin-bottom: 8px;">${quoteRowsHtml}</table>
					<div style="margin-bottom: 4px;"><span style="color: #6b7280;">Subtotal lunar</span> &nbsp;·&nbsp; <strong>${escapeHtml(r.monthlySubtotal ?? '')}</strong></div>
					${r.discountPct ? `<div style="margin-bottom: 4px;"><span style="color: #6b7280;">Discount ${r.items!.length} servicii</span> &nbsp;·&nbsp; <strong style="color: #047857;">−${r.discountPct}%</strong></div>` : ''}
					<div style="margin-bottom: 4px;"><span style="color: #6b7280;">Total lunar estimat</span> &nbsp;·&nbsp; <strong>${escapeHtml(r.monthlyTotal ?? '')}</strong></div>
					${r.setupTotal ? `<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Setup one-time</span> &nbsp;·&nbsp; <strong>${escapeHtml(r.setupTotal)}</strong></div>` : ''}`
		: `<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Categorie</span> &nbsp;·&nbsp; <strong>${categoryLabel}</strong></div>
					<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Pachet</span> &nbsp;·&nbsp; <strong>${tierLabel}</strong></div>`;

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
					${quoteHtml}
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
			Subiect: ${r.items?.length ? `Cerere ofertă nouă — ${r.items.length} servicii` : `Cerere pachet nouă — ${escapeHtml(r.categorySlug)} ${escapeHtml(r.tier)}`}
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
