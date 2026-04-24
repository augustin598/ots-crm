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
			<div style="margin-top: 14px; padding: 14px 16px; background: ${accentBg}; border: 1px solid ${accentBorder}; border-left: 4px solid ${accent}; border-radius: 8px;">
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
				<td style="padding: 18px 20px;">
					<table role="presentation" cellpadding="0" cellspacing="0" width="100%">
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
							<td style="vertical-align: top; text-align: right; white-space: nowrap;">
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
];

const cardsHtml = demoItems.map(renderCard).join('');

const greeting = 'Salut Demo,';
const intro = `Am detectat probleme pe <strong>${demoItems.length}</strong> conturi de publicitate ale tale. Te rugăm să verifici și să rezolvi situația cât mai repede posibil.`;

const bodyHtml = `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">${greeting}</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">${intro}</p>
	${cardsHtml}
	<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 12px 0 0 0;">Statusurile se vor actualiza automat în următoarele 1–2 ore după ce plata/problema este rezolvată.</p>
`;

const html = `<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<title>OTS CRM — demo digest email</title>
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f3f4f6; margin: 0; padding: 24px; }
		.wrap { max-width: 640px; margin: 0 auto; }
		.email-frame { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 28px 28px 32px 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
		.email-header { margin-bottom: 24px; padding-bottom: 18px; border-bottom: 1px solid #e5e7eb; }
		.email-title { font-size: 22px; font-weight: 700; color: #111827; letter-spacing: -0.01em; }
		.email-subtitle { font-size: 14px; color: #6b7280; margin-top: 4px; }
		.demo-note { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; color: #1e40af; font-size: 13px; }
	</style>
</head>
<body>
	<div class="wrap">
		<div class="demo-note">
			<strong>Preview demo</strong> — așa vor arăta emailurile digest de la OTS CRM cu noile statusuri TikTok și copy RO actionable.
		</div>
		<div class="email-frame">
			<div class="email-header">
				<div class="email-title">${demoItems.length} conturi de publicitate cu probleme</div>
				<div class="email-subtitle">Conturile tale de publicitate</div>
			</div>
			${bodyHtml}
		</div>
	</div>
</body>
</html>
`;

console.log(html);
