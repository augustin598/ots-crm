/**
 * Standalone demo of the new ad-payment digest email layout.
 *
 * Generates a static HTML preview so the visual design can be inspected
 * without sending real email or booting the whole SvelteKit app.
 *
 * Run: `bun run scripts/demo-ads-digest-email.ts > /tmp/ads-digest-demo.html && open /tmp/ads-digest-demo.html`
 */
import { describeStatus } from '../src/lib/ads/status-copy';
import type { AdDigestItem } from '../src/lib/server/email';

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function buildItem(overrides: Partial<AdDigestItem> & {
	rejectReasonMessage?: string | null;
	rejectReasonEndsAt?: string | null;
	googleSuspensionReasons?: string[] | null;
	rawStatusCode?: string | null;
}): AdDigestItem {
	const provider = (overrides.provider ?? 'tiktok') as 'meta' | 'google' | 'tiktok';
	const paymentStatus = (overrides.paymentStatus ?? 'risk_review') as
		| 'ok'
		| 'grace_period'
		| 'risk_review'
		| 'payment_failed'
		| 'suspended'
		| 'closed';
	const details = describeStatus({
		provider,
		paymentStatus,
		rawDisableReason:
			typeof overrides.rawDisableReason === 'string' ? overrides.rawDisableReason : null,
		rejectReasonMessage: overrides.rejectReasonMessage ?? null,
		rejectReasonEndsAt: overrides.rejectReasonEndsAt ?? null,
		googleSuspensionReasons: overrides.googleSuspensionReasons ?? null,
		rawStatusCode: typeof overrides.rawStatusCode === 'string' ? overrides.rawStatusCode : null,
	});

	return {
		provider,
		providerLabel:
			overrides.providerLabel ??
			(provider === 'meta' ? 'Meta (Facebook)' : provider === 'google' ? 'Google Ads' : 'TikTok Ads'),
		accountName: overrides.accountName ?? 'Cont demo',
		externalAccountId: overrides.externalAccountId ?? '0000000000000000',
		paymentStatus,
		statusLabelRo:
			overrides.statusLabelRo ??
			(paymentStatus === 'suspended'
				? 'Suspendat'
				: paymentStatus === 'payment_failed'
					? 'Plată eșuată'
					: paymentStatus === 'grace_period'
						? 'Perioadă de grație'
						: paymentStatus === 'closed'
							? 'Închis'
							: 'Revizuire în curs'),
		rawStatusCode: overrides.rawStatusCode ?? 'STATUS_ENABLE',
		rawDisableReason: overrides.rawDisableReason ?? null,
		billingUrl: overrides.billingUrl ?? 'https://ads.tiktok.com/i18n/account/payment_invoice',
		clientLabel: overrides.clientLabel ?? null,
		balanceFormatted: overrides.balanceFormatted ?? null,
		details,
	};
}

// Replicates the per-card HTML from sendAdPaymentDigestEmail so the demo
// stays in sync visually. If you change the email template, update this too.
function renderCard(it: AdDigestItem): string {
	const isCritical = it.paymentStatus === 'suspended' || it.paymentStatus === 'payment_failed';
	const accent = isCritical ? '#dc2626' : '#d97706';
	const accentDark = isCritical ? '#7f1d1d' : '#92400e';
	const accentDarker = isCritical ? '#450a0a' : '#78350f';
	const accentBg = isCritical ? '#fef2f2' : '#fffbeb';
	const accentBorder = isCritical ? '#fecaca' : '#fde68a';
	const accentPill = isCritical ? '#b91c1c' : '#b45309';

	const clientLine = it.clientLabel
		? `<div style="color: #6b7280; font-size: 12px; margin-top: 3px;">${escapeHtml(it.clientLabel)}</div>`
		: '';

	const deadlineLine = it.details?.deadline
		? `<div style="font-size: 12px; font-weight: 600; color: ${accentDark}; margin-top: 8px;">Termen expirare: ${escapeHtml(it.details.deadline)}</div>`
		: '';

	const balanceLine = it.balanceFormatted
		? `<div style="font-size: 12px; font-weight: 700; color: ${accentDark}; margin-top: 6px; font-variant-numeric: tabular-nums;">Sold restant: ${escapeHtml(it.balanceFormatted)}</div>`
		: '';

	const detailsBlock = it.details
		? `
			<div class="ots-details" style="margin-top: 14px; padding: 14px 16px; background: ${accentBg}; border: 1px solid ${accentBorder}; border-left: 4px solid ${accent}; border-radius: 8px;">
				<div style="font-size: 14px; font-weight: 700; color: ${accentDark}; letter-spacing: -0.01em;">${escapeHtml(it.details.headline)}</div>
				<div style="font-size: 13px; color: ${accentDarker}; line-height: 1.6; margin-top: 6px;">${escapeHtml(it.details.body)}</div>
				${deadlineLine}
				${balanceLine}
				<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top: 12px; border-collapse: collapse;">
					<tr>
						<td style="vertical-align: top; padding-right: 8px; font-size: 14px; color: ${accentDark};">💡</td>
						<td style="vertical-align: top; font-size: 13px; color: ${accentDarker}; line-height: 1.55; font-weight: 500;">${escapeHtml(it.details.suggestion)}</td>
					</tr>
				</table>
			</div>
		`
		: '';

	const ctaLabel = isCritical
		? 'Deschide contul'
		: it.paymentStatus === 'grace_period' || it.paymentStatus === 'risk_review'
			? 'Rezolvă acum'
			: 'Vezi detalii';

	return `
		<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: separate; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff; margin: 0 0 14px 0; overflow: hidden;">
			<tr>
				<td class="ots-card-inner" style="padding: 18px 20px;">
					<table role="presentation" cellpadding="0" cellspacing="0" width="100%" class="ots-stack">
						<tr>
							<td style="vertical-align: top; padding-right: 12px;">
								<div style="font-weight: 700; color: #111827; font-size: 15px; line-height: 1.3;">${escapeHtml(it.accountName)}</div>
								<div style="color: #6b7280; font-size: 12px; margin-top: 3px;">
									${escapeHtml(it.providerLabel)}
									<span style="color: #d1d5db;"> · </span>
									<span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace; color: #9ca3af;">${escapeHtml(String(it.externalAccountId))}</span>
								</div>
								${clientLine}
							</td>
							<td class="ots-stack-right" style="vertical-align: top; text-align: right; white-space: nowrap;">
								<span style="display: inline-block; padding: 5px 12px; border-radius: 999px; background: ${accentBg}; color: ${accentPill}; font-size: 12px; font-weight: 600; border: 1px solid ${accentBorder};">${escapeHtml(it.statusLabelRo)}</span>
							</td>
						</tr>
					</table>
					${detailsBlock}
					<div style="margin-top: 14px;">
						<a href="${escapeHtml(it.billingUrl)}" style="display: inline-block; padding: 9px 18px; background: ${accent}; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 13px; font-weight: 600; letter-spacing: 0.01em;">${ctaLabel} →</a>
					</div>
				</td>
			</tr>
		</table>
	`;
}

const demoItems: AdDigestItem[] = [
	buildItem({
		accountName: 'Wow Agency Bucuresti',
		externalAccountId: '7204826313654370305',
		provider: 'tiktok',
		paymentStatus: 'risk_review',
		statusLabelRo: 'Revizuire în curs',
		rawStatusCode: 'STATUS_LIMIT',
		rejectReasonMessage:
			'Your account has been suspended due to suspicious or unusual activity or a violation of the TikTok Advertising Guidelines or other standards.',
		rejectReasonEndsAt: '2035-09-03 15:25:11',
		billingUrl:
			'https://ads.tiktok.com/i18n/account/payment_invoice?aadvid=7204826313654370305',
	}),
	buildItem({
		accountName: 'Tiktok - Heylux Suceava',
		externalAccountId: '7625561661356949512',
		provider: 'tiktok',
		paymentStatus: 'risk_review',
		statusLabelRo: 'Revizuire în curs',
		rawStatusCode: 'STATUS_ENABLE',
		rawDisableReason: 'no_delivery',
	}),
	buildItem({
		accountName: 'Meduza Agency1029',
		externalAccountId: '7566621400111317009',
		provider: 'tiktok',
		paymentStatus: 'risk_review',
		statusLabelRo: 'Revizuire în curs',
		rawStatusCode: 'STATUS_ENABLE',
		rawDisableReason: 'budget_exceeded',
	}),
	buildItem({
		accountName: 'Profesional Rent Asset',
		externalAccountId: '7204809230577156097',
		provider: 'tiktok',
		paymentStatus: 'suspended',
		statusLabelRo: 'Suspendat',
		rawStatusCode: 'STATUS_DISABLE',
	}),
	buildItem({
		accountName: 'beonemedical.ro',
		externalAccountId: 'act_492839231',
		provider: 'meta',
		paymentStatus: 'payment_failed',
		statusLabelRo: 'Plată eșuată',
		rawStatusCode: 3,
		balanceFormatted: '446,51 RON',
	}),
	buildItem({
		accountName: 'Farmacie Atlas',
		externalAccountId: '1234-567-8901',
		provider: 'google',
		paymentStatus: 'grace_period',
		statusLabelRo: 'Perioadă de grație',
		rawStatusCode: '9',
		balanceFormatted: '218,00 RON',
	}),
	buildItem({
		accountName: 'Client Google Ads demo',
		externalAccountId: '123-456-7890',
		provider: 'google',
		paymentStatus: 'suspended',
		statusLabelRo: 'Suspendat',
		rawStatusCode: 'SUSPENDED',
		googleSuspensionReasons: ['UNPAID_BALANCE'],
	}),
	buildItem({
		accountName: 'Alt client Google Ads',
		externalAccountId: '987-654-3210',
		provider: 'google',
		paymentStatus: 'suspended',
		statusLabelRo: 'Suspendat',
		rawStatusCode: 'SUSPENDED',
		googleSuspensionReasons: ['SUSPICIOUS_PAYMENT_ACTIVITY', 'UNAUTHORIZED_ACCOUNT_ACTIVITY'],
	}),
	buildItem({
		accountName: 'Client Meta — Heylux',
		externalAccountId: 'act_1234567890',
		provider: 'meta',
		paymentStatus: 'suspended',
		statusLabelRo: 'Suspendat',
		rawStatusCode: '2', // DISABLED
		rawDisableReason: '1', // ADS_INTEGRITY_POLICY
	}),
	buildItem({
		accountName: 'Client Meta — DS Tech',
		externalAccountId: 'act_9876543210',
		provider: 'meta',
		paymentStatus: 'payment_failed',
		statusLabelRo: 'Plată eșuată',
		rawStatusCode: '3', // UNSETTLED
		rawDisableReason: '8', // PRE_PAYMENT_ADS_DISABLED
		balanceFormatted: '342,18 RON',
	}),
	buildItem({
		accountName: 'Client Meta — Beonemedical',
		externalAccountId: 'act_5555555555',
		provider: 'meta',
		paymentStatus: 'grace_period',
		statusLabelRo: 'Perioadă de grație',
		rawStatusCode: '9', // IN_GRACE_PERIOD
		rawDisableReason: null,
		balanceFormatted: '218,40 RON',
	}),
];

const cardsHtml = demoItems.map(renderCard).join('');

// Single-account variant (the broken-on-mobile case from the screenshot:
// "Sold restant 1.121,59 RON" — beonemedical.ro · Meta · Perioadă de grație).
const singleItem = buildItem({
	accountName: 'beonemedical.ro',
	externalAccountId: 'act_818842774503712',
	provider: 'meta',
	paymentStatus: 'grace_period',
	statusLabelRo: 'Perioadă de grație',
	rawStatusCode: '9',
	balanceFormatted: '1.121,59 RON',
});
const singleCardHtml = renderCard(singleItem);
const singleGreeting = 'Salut George,';
const singleIntro = `Contul tău de <strong>Meta (Facebook)</strong> <strong>beonemedical.ro</strong> este în perioadă de grație cu o factură neachitată. Sold restant: <strong>1.121,59 RON</strong>. Te rugăm să achiți cât mai repede pentru a preveni oprirea automată a reclamelor.`;
const singleTitle = `Sold restant 1.121,59 RON`;
const singleSubtitle = `beonemedical.ro · Meta (Facebook) · Perioadă de grație`;

const greeting = 'Salut Demo,';
const intro = `Am detectat probleme pe <strong>${demoItems.length}</strong> conturi de publicitate ale tale. Te rugăm să verifici și să rezolvi situația cât mai repede posibil.`;

// Reproduces the production renderBrandedEmail structure (mobile media query
// + ots-* classes) so we can preview the actual responsive behaviour locally.
function renderEmail({
	title,
	subtitle,
	cardsHtml: inner,
	greeting: g,
	intro: i,
}: {
	title: string;
	subtitle: string;
	cardsHtml: string;
	greeting: string;
	intro: string;
}): string {
	const themeColor = '#0ea5e9';
	const bodyHtml = `
		<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">${g}</p>
		<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">${i}</p>
		${inner}
		<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 12px 0 0 0;">Statusurile se vor actualiza automat în următoarele 1–2 ore după ce plata/problema este rezolvată.</p>
	`;
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${title}</title>
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
			<h1 class="ots-title" style="color: ${themeColor}; font-size: 22px; margin: 0 0 6px 0; line-height: 1.2;">${title}</h1>
			<p class="ots-subtitle" style="color: #6b7280; font-size: 13px; margin: 0 0 24px 0;">${subtitle}</p>
			<div style="height: 1px; background-color: #e5e7eb; margin: 0 0 24px 0;"></div>
			${bodyHtml}
		</div>
	</div>
</body>
</html>`;
}

const singleEmailHtml = renderEmail({
	title: singleTitle,
	subtitle: singleSubtitle,
	cardsHtml: singleCardHtml,
	greeting: singleGreeting,
	intro: singleIntro,
});
const digestEmailHtml = renderEmail({
	title: `${demoItems.length} conturi de publicitate cu probleme`,
	subtitle: 'Conturile tale de publicitate',
	cardsHtml,
	greeting,
	intro,
});

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const html = `<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<title>OTS CRM — demo digest email (desktop + mobile)</title>
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f3f4f6; margin: 0; padding: 24px; }
		h2 { font-size: 14px; color: #6b7280; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.05em; }
		.row { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 32px; }
		.col-desktop { flex: 1 1 600px; min-width: 0; }
		.col-mobile { flex: 0 0 375px; }
		iframe { border: 1px solid #d1d5db; border-radius: 12px; background: #f4f5f7; box-shadow: 0 1px 3px rgba(0,0,0,0.04); display: block; }
		.iframe-desktop { width: 100%; height: 900px; }
		.iframe-mobile { width: 375px; height: 900px; }
		.label { font-size: 13px; color: #374151; font-weight: 600; margin-bottom: 6px; }
	</style>
</head>
<body>
	<h2>Single account — grace period (the broken-on-mobile case from the screenshot)</h2>
	<div class="row">
		<div class="col-desktop">
			<div class="label">Desktop (full width)</div>
			<iframe class="iframe-desktop" srcdoc="${escapeAttr(singleEmailHtml)}"></iframe>
		</div>
		<div class="col-mobile">
			<div class="label">Mobile (375px)</div>
			<iframe class="iframe-mobile" srcdoc="${escapeAttr(singleEmailHtml)}"></iframe>
		</div>
	</div>

	<h2>Multi-account digest</h2>
	<div class="row">
		<div class="col-desktop">
			<div class="label">Desktop (full width)</div>
			<iframe class="iframe-desktop" srcdoc="${escapeAttr(digestEmailHtml)}"></iframe>
		</div>
		<div class="col-mobile">
			<div class="label">Mobile (375px)</div>
			<iframe class="iframe-mobile" srcdoc="${escapeAttr(digestEmailHtml)}"></iframe>
		</div>
	</div>
</body>
</html>
`;

console.log(html);
