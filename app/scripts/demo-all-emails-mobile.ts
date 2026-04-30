/**
 * Mobile responsiveness preview for ALL branded email templates.
 *
 * Renders each email type's body inside a replica of renderBrandedEmail,
 * with the same mobile media queries used in production. Each template is
 * shown side-by-side: full-width desktop iframe + 375px mobile iframe so
 * mobile bugs (overflow, clipped badges, padded callouts) are obvious.
 *
 * Run: bun run scripts/demo-all-emails-mobile.ts > /tmp/all-emails-mobile.html && open /tmp/all-emails-mobile.html
 */

const escapeHtml = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

interface BrandedEmailOptions {
	themeColor: string;
	title: string;
	subtitle?: string;
	bodyHtml: string;
}

// Mirror of app/src/lib/server/email.ts renderBrandedEmail (must be kept in sync).
function renderBrandedEmail(opts: BrandedEmailOptions): string {
	const subtitle = opts.subtitle ?? 'OTS CRM — One Top Solution';
	const subtitleBlock = subtitle
		? `<p class="ots-subtitle" style="color: #6b7280; font-size: 13px; margin: 0 0 24px 0;">${subtitle}</p>`
		: '';
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${opts.title}</title>
	<style>
		@media only screen and (max-width: 480px) {
			.ots-outer { padding: 16px 8px !important; }
			.ots-card { padding: 20px 18px !important; border-radius: 8px !important; }
			.ots-title { font-size: 18px !important; line-height: 1.25 !important; word-break: break-word; }
			.ots-subtitle { font-size: 12px !important; line-height: 1.5 !important; }
			.ots-stack td { display: block !important; width: 100% !important; padding: 0 !important; }
			.ots-stack-right { text-align: left !important; padding-top: 10px !important; white-space: normal !important; }
			.ots-card-inner { padding: 16px 16px !important; }
			.ots-details { padding: 12px 14px !important; }
		}
	</style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
	<div class="ots-outer" style="max-width: 600px; margin: 0 auto; padding: 32px 20px;">
		<div class="ots-card" style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 32px;">
			<h1 class="ots-title" style="color: ${opts.themeColor}; font-size: 22px; margin: 0 0 6px 0; line-height: 1.2;">${opts.title}</h1>
			${subtitleBlock}
			<div style="height: 1px; background-color: #e5e7eb; margin: 0 0 24px 0;"></div>
			${opts.bodyHtml}
			<div style="height: 1px; background-color: #e5e7eb; margin: 0 0 18px 0;"></div>
			<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0;">Pentru întrebări sau clarificări, nu ezitați să ne contactați.</p>
		</div>
	</div>
</body>
</html>`;
}

function renderCtaButton(href: string, label: string, themeColor: string): string {
	return `<div style="text-align: center; margin: 24px 0;">
		<a href="${href}" style="background-color: ${themeColor}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">${label}</a>
	</div>`;
}

const themeColor = '#0ea5e9';
const accentRed = '#dc2626';
const accentAmber = '#d97706';

// ---------------------------------------------------------------------------
// Mock email templates — body HTML replicas of production templates
// ---------------------------------------------------------------------------

const invitationBody = `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua,</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;"><strong>${escapeHtml('Ana Popescu')}</strong> v-a invitat să vă alăturați echipei <strong>${escapeHtml('One Top Solution')}</strong> pe platforma CRM.</p>
	${renderCtaButton('https://example.com/invite/xyz', 'Acceptă invitația', themeColor)}
	<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 4px 0;">Sau copiați acest link în browser:</p>
	<p style="color: ${themeColor}; font-size: 13px; line-height: 1.6; margin: 0 0 20px 0; word-break: break-all;">https://example.com/invite/xyz123abc456def789ghi012jkl345mno678pqr901</p>
	<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0 0 6px 0;">Această invitație expiră în 7 zile.</p>
`;

const invoiceBody = `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Stimate/Stimată Beone Medical SRL,</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Vă transmitem factura de la <strong>One Top Solution</strong>.</p>
	<table role="presentation" cellpadding="0" cellspacing="0" class="ots-details" style="width: 100%; background-color: #f9fafb; border-radius: 8px; margin: 0 0 20px 0;">
		<tr>
			<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
				<div><span style="color: #6b7280;">Număr factură</span> &nbsp;·&nbsp; <strong>OTS-2026-00042</strong></div>
				<div><span style="color: #6b7280;">Data emitere</span> &nbsp;·&nbsp; <strong>15 Aprilie 2026</strong></div>
				<div><span style="color: #6b7280;">Scadență</span> &nbsp;·&nbsp; <strong>30 Aprilie 2026</strong></div>
				<div><span style="color: #6b7280;">Total de plată</span> &nbsp;·&nbsp; <strong>2.450,00 RON</strong></div>
			</td>
		</tr>
	</table>
	<div class="ots-details" style="background-color: #f9fafb; border-left: 3px solid ${themeColor}; padding: 14px 16px; border-radius: 6px; margin: 0 0 20px 0;">
		<p style="color: #111827; font-weight: 600; font-size: 14px; margin: 0 0 6px 0;">Date pentru plată</p>
		<p style="color: #374151; font-size: 13px; margin: 2px 0;"><span style="color: #6b7280;">Banca</span> &nbsp;·&nbsp; Banca Transilvania</p>
		<p style="color: #374151; font-size: 13px; margin: 2px 0;"><span style="color: #6b7280;">IBAN (LEI)</span> &nbsp;·&nbsp; RO49AAAA1B31007593840000</p>
		<p style="color: #374151; font-size: 13px; margin: 2px 0;"><span style="color: #6b7280;">IBAN (EUR)</span> &nbsp;·&nbsp; RO12BTRLEURCRT0000123456</p>
	</div>
	<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 12px 0;">📎 Factura este atașată în format PDF la acest email.</p>
	${renderCtaButton('https://example.com/invoice/abc', 'Vezi factura online', themeColor)}
`;

const invoicePaidBody = `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Stimate/Stimată Beone Medical SRL,</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Am primit plata pentru următoarea factură:</p>
	<table role="presentation" cellpadding="0" cellspacing="0" class="ots-details" style="width: 100%; background-color: #f0fdf4; border-left: 3px solid #10b981; border-radius: 8px; margin: 0 0 20px 0;">
		<tr>
			<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
				<div><span style="color: #6b7280;">Număr factură</span> &nbsp;·&nbsp; <strong>OTS-2026-00042</strong></div>
				<div><span style="color: #6b7280;">Suma plătită</span> &nbsp;·&nbsp; <strong>2.450,00 RON</strong></div>
				<div><span style="color: #6b7280;">Data plății</span> &nbsp;·&nbsp; <strong>22 Aprilie 2026</strong></div>
			</td>
		</tr>
	</table>
	<p style="color: #15803d; font-weight: 600; font-size: 15px; margin: 0 0 20px 0;">Vă mulțumim pentru plată!</p>
	${renderCtaButton('https://example.com/invoice/abc', 'Vezi factura', themeColor)}
`;

const overdueBody = `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Stimate/Stimată Beone Medical SRL,</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Vă reamintim că factura de mai jos este restantă de <strong>14 zile</strong>.</p>
	<table role="presentation" cellpadding="0" cellspacing="0" class="ots-details" style="width: 100%; background-color: #fffbeb; border-left: 3px solid #d97706; border-radius: 8px; margin: 0 0 20px 0;">
		<tr>
			<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
				<div><span style="color: #6b7280;">Număr factură</span> &nbsp;·&nbsp; <strong>OTS-2026-00042</strong></div>
				<div><span style="color: #6b7280;">Suma de plată</span> &nbsp;·&nbsp; <strong>2.450,00 RON</strong></div>
				<div><span style="color: #6b7280;">Scadență</span> &nbsp;·&nbsp; <strong>14 Aprilie 2026</strong></div>
				<div><span style="color: #6b7280;">Zile restanță</span> &nbsp;·&nbsp; <strong style="color: #d97706;">14</strong></div>
			</td>
		</tr>
	</table>
	${renderCtaButton('https://example.com/invoice/abc', 'Vezi factura online', themeColor)}
`;

const taskAssignmentBody = `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua George,</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Ți-a fost atribuit un task nou:</p>
	<table role="presentation" cellpadding="0" cellspacing="0" class="ots-details" style="width: 100%; background-color: #f9fafb; border-radius: 8px; margin: 0 0 20px 0;">
		<tr>
			<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
				<div style="font-weight: 600; color: #111827; font-size: 15px; margin-bottom: 8px;">Pregătește raportul de campanie pentru Beonemedical pe ultima săptămână</div>
				<div style="color: #6b7280; font-size: 13px; margin-bottom: 12px;">Include CTR, CPC, conversii, cost-per-lead și recomandări pentru optimizare în următoarea săptămână.</div>
				<div><span style="color: #6b7280;">Prioritate</span> &nbsp;·&nbsp; <span style="display:inline-block; padding:3px 12px; border-radius:9999px; font-size:13px; font-weight:600; background:#fee2e2; color:#b91c1c;">High</span></div>
				<div style="margin-top: 6px;"><span style="color: #6b7280;">Status</span> &nbsp;·&nbsp; <span style="display:inline-block; padding:3px 12px; border-radius:9999px; font-size:13px; font-weight:600; background:#f1f5f9; color:#334155;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#94a3b8; margin-right:6px; vertical-align:middle;"></span>Todo</span></div>
				<div style="margin-top: 6px;"><span style="color: #6b7280;">Termen</span> &nbsp;·&nbsp; <strong>30 Aprilie 2026</strong></div>
			</td>
		</tr>
	</table>
	${renderCtaButton('https://example.com/tasks/xyz', 'Vezi task-ul', themeColor)}
`;

const taskReminderBody = `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua George,</p>
	<p style="color: ${accentRed}; font-weight: 600; font-size: 15px; margin: 0 0 16px 0;">Acest task este restant!</p>
	<table role="presentation" cellpadding="0" cellspacing="0" class="ots-details" style="width: 100%; background-color: #f9fafb; border-left: 3px solid ${accentRed}; border-radius: 8px; margin: 0 0 20px 0;">
		<tr>
			<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
				<div style="font-weight: 600; color: #111827; font-size: 15px; margin-bottom: 8px;">Pregătește raportul de campanie pentru Beonemedical</div>
				<div><span style="color: #6b7280;">Prioritate</span> &nbsp;·&nbsp; <strong>high</strong></div>
				<div><span style="color: #6b7280;">Status</span> &nbsp;·&nbsp; <strong>todo</strong></div>
				<div><span style="color: #6b7280;">Termen</span> &nbsp;·&nbsp; <strong style="color: ${accentRed};">25 Aprilie 2026</strong></div>
			</td>
		</tr>
	</table>
	${renderCtaButton('https://example.com/tasks/xyz', 'Vezi task-ul', themeColor)}
`;

const dailyReminderBody = `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună dimineața, George!</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Planul tău pentru <strong>luni, 28 aprilie 2026</strong> — ai 3 task-uri programate astăzi:</p>
	<div class="ots-details" style="background-color: #f9fafb; padding: 14px 16px; border-radius: 8px; margin-bottom: 10px; border-left: 3px solid #dc2626;">
		<div style="margin: 0 0 6px 0;"><a href="https://example.com/t/1" style="color: ${themeColor}; text-decoration: none; font-weight: 600; font-size: 15px;">Pregătește raportul de campanie pentru Beonemedical</a></div>
		<div style="color: #6b7280; font-size: 13px; margin: 0 0 8px 0;">Include CTR, CPC, conversii, cost-per-lead.</div>
		<div style="color: #374151; font-size: 13px; line-height: 1.6;">
			<span style="color: #6b7280;">Prioritate</span> · <strong style="color: #dc2626;">urgent</strong>
			&nbsp;&nbsp;<span style="color: #6b7280;">Status</span> · <strong>todo</strong>
			&nbsp;&nbsp;<span style="color: #6b7280;">Termen</span> · <strong>azi</strong>
		</div>
	</div>
	<div class="ots-details" style="background-color: #f9fafb; padding: 14px 16px; border-radius: 8px; margin-bottom: 10px; border-left: 3px solid #f59e0b;">
		<div style="margin: 0 0 6px 0;"><a href="https://example.com/t/2" style="color: ${themeColor}; text-decoration: none; font-weight: 600; font-size: 15px;">Verifică conversiile pe Google Ads pentru clientul Atlas</a></div>
		<div style="color: #374151; font-size: 13px; line-height: 1.6;">
			<span style="color: #6b7280;">Prioritate</span> · <strong style="color: #f59e0b;">high</strong>
			&nbsp;&nbsp;<span style="color: #6b7280;">Status</span> · <strong>in-progress</strong>
			&nbsp;&nbsp;<span style="color: #6b7280;">Termen</span> · <strong>azi</strong>
		</div>
	</div>
	${renderCtaButton('https://example.com/my-plans', 'Vezi planurile mele', themeColor)}
`;

const magicLinkBody = `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua Beone Medical SRL,</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Ați solicitat acces la portalul client pentru <strong>One Top Solution</strong>.</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 4px 0;">Apăsați butonul de mai jos pentru autentificare. Linkul expiră în 24 de ore.</p>
	${renderCtaButton('https://example.com/verify/xyz', 'Intră în portalul client', themeColor)}
	<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 4px 0;">Sau copiați acest link în browser:</p>
	<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0 0 18px 0; word-break: break-all;">https://example.com/client/ots/verify?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0</p>
	<div style="background-color: #fffbeb; border-left: 3px solid #f59e0b; padding: 12px 14px; border-radius: 6px; margin: 0 0 20px 0;">
		<p style="color: #92400e; font-size: 13px; line-height: 1.5; margin: 0;"><strong>Securitate</strong> · Linkul este valabil 24 de ore și poate fi folosit o singură dată. Dacă nu ați solicitat acest email, ignorați-l.</p>
	</div>
`;

const contractSigningBody = `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Stimate/Stimată Beone Medical SRL,</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Ați primit o invitație pentru a semna contractul <strong>OTS-CTR-2026-0042</strong> emis de <strong>One Top Solution</strong>.</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 4px 0;">Apăsați butonul de mai jos pentru a vizualiza și semna contractul. Linkul este valabil 7 zile.</p>
	${renderCtaButton('https://example.com/sign/xyz', 'Vizualizează și semnează contractul', themeColor)}
	<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 4px 0;">Sau copiați acest link în browser:</p>
	<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0 0 18px 0; word-break: break-all;">https://example.com/sign/ots/abc123def456ghi789jkl012mno345</p>
	<div style="background-color: #fffbeb; border-left: 3px solid #f59e0b; padding: 12px 14px; border-radius: 6px; margin: 0 0 20px 0;">
		<p style="color: #92400e; font-size: 13px; line-height: 1.5; margin: 0;"><strong>Securitate</strong> · Linkul este valabil 7 zile și poate fi folosit o singură dată.</p>
	</div>
`;

const reportBody = `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua,</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Vă transmitem raportul de marketing pentru <strong>Beonemedical</strong>.</p>
	<table role="presentation" cellpadding="0" cellspacing="0" class="ots-details" style="width: 100%; background-color: #f9fafb; border-radius: 8px; margin: 0 0 20px 0;">
		<tr>
			<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
				<div><span style="color: #6b7280;">Client</span> &nbsp;·&nbsp; <strong>Beonemedical</strong></div>
				<div><span style="color: #6b7280;">Perioadă</span> &nbsp;·&nbsp; <strong>1-30 Aprilie 2026</strong></div>
			</td>
		</tr>
	</table>
	<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 20px 0;">📎 Raportul este atașat în format PDF la acest email.</p>
`;

const packageRequestBody = `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua George,</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Un client a solicitat un bundle de servicii din CRM:</p>
	<table role="presentation" cellpadding="0" cellspacing="0" class="ots-details" style="width: 100%; background-color: #f9fafb; border-radius: 8px; margin: 0 0 20px 0;">
		<tr>
			<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.8;">
				<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Client</span> &nbsp;·&nbsp; <strong>Beonemedical SRL</strong> <span style="color:#6b7280;">(office@beonemedical.ro)</span></div>
				<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Bundle</span> &nbsp;·&nbsp; <strong>marketing-complete-bundle</strong></div>
				<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Servicii incluse</span> &nbsp;·&nbsp; <strong>Google Ads, Meta Ads, TikTok Ads, SEO, Content</strong></div>
				<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Pachet</span> &nbsp;·&nbsp; <strong>Premium</strong></div>
				<div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #d1d5db;"><span style="color: #6b7280;">Notă client:</span><div style="margin-top: 6px; color: #111827; white-space: pre-line;">Avem nevoie să accelerăm campania pentru luna mai. Vă rog să mă contactați să discutăm detaliile.</div></div>
			</td>
		</tr>
	</table>
	${renderCtaButton('https://example.com/services?tab=requests', 'Vezi cererea în CRM', themeColor)}
`;

const adPaymentBody = `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Salut George,</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">Contul tău de <strong>Meta (Facebook)</strong> <strong>beonemedical.ro</strong> este în perioadă de grație cu o factură neachitată. Sold restant: <strong>1.121,59 RON</strong>. Te rugăm să achiți cât mai repede pentru a preveni oprirea automată a reclamelor.</p>
	<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: separate; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff; margin: 0 0 14px 0; overflow: hidden;">
		<tr>
			<td class="ots-card-inner" style="padding: 18px 20px;">
				<table role="presentation" cellpadding="0" cellspacing="0" width="100%" class="ots-stack">
					<tr>
						<td style="vertical-align: top; padding-right: 12px;">
							<div style="font-weight: 700; color: #111827; font-size: 15px; line-height: 1.3;">beonemedical.ro</div>
							<div style="color: #6b7280; font-size: 12px; margin-top: 3px;">Meta (Facebook)<span style="color: #d1d5db;"> · </span><span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace; color: #9ca3af;">act_818842774503712</span></div>
						</td>
						<td class="ots-stack-right" style="vertical-align: top; text-align: right; white-space: nowrap;">
							<span style="display: inline-block; padding: 5px 12px; border-radius: 999px; background: #fffbeb; color: #b45309; font-size: 12px; font-weight: 600; border: 1px solid #fde68a;">Perioadă de grație</span>
						</td>
					</tr>
				</table>
				<div class="ots-details" style="margin-top: 14px; padding: 14px 16px; background: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid ${accentAmber}; border-radius: 8px;">
					<div style="font-size: 14px; font-weight: 700; color: #92400e; letter-spacing: -0.01em;">Cont Meta — Perioadă de grație — factură neachitată</div>
					<div style="font-size: 13px; color: #78350f; line-height: 1.6; margin-top: 6px;">Meta a aplicat această stare pe cont. Detalii și pași de remediere mai jos.</div>
					<div style="font-size: 12px; font-weight: 700; color: #92400e; margin-top: 6px;">Sold restant: 1.121,59 RON</div>
				</div>
				<div style="margin-top: 14px;"><a href="https://example.com" style="display: inline-block; padding: 9px 18px; background: ${accentAmber}; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 13px; font-weight: 600;">Rezolvă acum →</a></div>
			</td>
		</tr>
	</table>
`;

// ---------------------------------------------------------------------------
// Showcase grid: each template renders into a desktop iframe + mobile iframe
// ---------------------------------------------------------------------------

interface Template {
	name: string;
	description: string;
	emailHtml: string;
}

const templates: Template[] = [
	{
		name: 'Ad Payment Digest (single)',
		description: 'The original mobile bug — Meta grace period with big "Sold restant" headline.',
		emailHtml: renderBrandedEmail({
			themeColor,
			title: 'Sold restant 1.121,59 RON',
			subtitle: 'beonemedical.ro · Meta (Facebook) · Perioadă de grație',
			bodyHtml: adPaymentBody,
		}),
	},
	{
		name: 'Invoice (cu IBAN + PDF)',
		description: 'Factura cu IBAN și atașament PDF — verifică wrap pe IBAN.',
		emailHtml: renderBrandedEmail({
			themeColor,
			title: 'Factura OTS-2026-00042',
			bodyHtml: invoiceBody,
		}),
	},
	{
		name: 'Invoice Paid',
		description: 'Confirmare plată cu card verde.',
		emailHtml: renderBrandedEmail({
			themeColor,
			title: 'Plată primită',
			bodyHtml: invoicePaidBody,
		}),
	},
	{
		name: 'Invoice Overdue Reminder',
		description: 'Reminder factură restantă (amber accent).',
		emailHtml: renderBrandedEmail({
			themeColor,
			title: 'Reminder plată factură',
			bodyHtml: overdueBody,
		}),
	},
	{
		name: 'Task Assignment',
		description: 'Task nou atribuit — cu prioritate, status și termen.',
		emailHtml: renderBrandedEmail({
			themeColor,
			title: 'Task nou atribuit',
			bodyHtml: taskAssignmentBody,
		}),
	},
	{
		name: 'Task Reminder (overdue)',
		description: 'Reminder task restant.',
		emailHtml: renderBrandedEmail({
			themeColor,
			title: 'Task restant',
			bodyHtml: taskReminderBody,
		}),
	},
	{
		name: 'Daily Work Reminder',
		description: 'Planul zilnic cu mai multe task-uri grupate.',
		emailHtml: renderBrandedEmail({
			themeColor,
			title: 'Bună dimineața, George!',
			bodyHtml: dailyReminderBody,
		}),
	},
	{
		name: 'Magic Link (client portal)',
		description: 'Email autentificare — link lung + callout securitate.',
		emailHtml: renderBrandedEmail({
			themeColor,
			title: 'Autentificare în One Top Solution',
			bodyHtml: magicLinkBody,
		}),
	},
	{
		name: 'Contract Signing',
		description: 'Invitație semnare contract.',
		emailHtml: renderBrandedEmail({
			themeColor,
			title: 'Semnare contract OTS-CTR-2026-0042',
			bodyHtml: contractSigningBody,
		}),
	},
	{
		name: 'Marketing Report',
		description: 'Raport lunar trimis cu PDF atașat.',
		emailHtml: renderBrandedEmail({
			themeColor,
			title: 'Raport Marketing Lunar',
			bodyHtml: reportBody,
		}),
	},
	{
		name: 'Invitation',
		description: 'Invitație de alăturare la echipă.',
		emailHtml: renderBrandedEmail({
			themeColor,
			title: 'Invitație nouă',
			bodyHtml: invitationBody,
		}),
	},
	{
		name: 'Package Request',
		description: 'Cerere pachet de servicii — cu bundle, listă servicii și notă.',
		emailHtml: renderBrandedEmail({
			themeColor,
			title: 'Cerere pachet nouă',
			bodyHtml: packageRequestBody,
		}),
	},
];

const sections = templates
	.map(
		(t) => `
	<section>
		<h2>${escapeHtml(t.name)}</h2>
		<p class="desc">${escapeHtml(t.description)}</p>
		<div class="row">
			<div class="col-desktop">
				<div class="label">Desktop (full width)</div>
				<iframe class="iframe-desktop" srcdoc="${escapeAttr(t.emailHtml)}" loading="lazy"></iframe>
			</div>
			<div class="col-mobile">
				<div class="label">Mobile (375px)</div>
				<iframe class="iframe-mobile" srcdoc="${escapeAttr(t.emailHtml)}" loading="lazy"></iframe>
			</div>
		</div>
	</section>
	`
	)
	.join('');

const html = `<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<title>OTS CRM — All Email Templates Mobile Preview</title>
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f3f4f6; margin: 0; padding: 24px; color: #111827; }
		header { max-width: 1200px; margin: 0 auto 32px auto; padding: 24px 28px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
		header h1 { margin: 0 0 8px 0; font-size: 22px; }
		header p { margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6; }
		section { max-width: 1200px; margin: 0 auto 40px auto; padding: 24px 28px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
		section h2 { margin: 0 0 4px 0; font-size: 18px; color: #111827; }
		.desc { margin: 0 0 16px 0; color: #6b7280; font-size: 13px; }
		.row { display: flex; gap: 24px; flex-wrap: wrap; }
		.col-desktop { flex: 1 1 600px; min-width: 0; }
		.col-mobile { flex: 0 0 375px; }
		iframe { border: 1px solid #d1d5db; border-radius: 12px; background: #f4f5f7; box-shadow: 0 1px 3px rgba(0,0,0,0.04); display: block; }
		.iframe-desktop { width: 100%; height: 760px; }
		.iframe-mobile { width: 375px; height: 760px; }
		.label { font-size: 13px; color: #374151; font-weight: 600; margin-bottom: 6px; }
	</style>
</head>
<body>
	<header>
		<h1>OTS CRM — toate template-urile de email, desktop + mobile</h1>
		<p>Replică a <code>renderBrandedEmail</code> cu media queries production. Verifică pe coloana "Mobile (375px)" că nu există overflow, padding excesiv sau badge-uri tăiate.</p>
	</header>
	${sections}
</body>
</html>
`;

console.log(html);
