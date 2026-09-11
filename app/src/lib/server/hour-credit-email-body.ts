/**
 * Corpul emailurilor de credit de ore — PUR (fără DB), ca demo-ul din
 * `scripts/demo-hour-credit-email.ts` să randeze exact ce trimite serverul.
 */
import { formatMinutes } from '$lib/logic/hourly-catalog';
import type { HourCreditEvent } from './hour-credit-notifications';

function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
	);
}

const P = 'color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;';
const BOX =
	'width: 100%; table-layout: fixed; background-color: #f9fafb; border-radius: 8px; margin: 0 0 20px 0;';

export function hourCreditEmailTitle(event: HourCreditEvent): string {
	if (event.kind === 'credited') return 'Ore adăugate în credit';
	if (event.kind === 'consumed') return 'Ore consumate din credit';
	return 'Credit de ore scăzut';
}

export function hourCreditEmailSubject(clientName: string, event: HourCreditEvent): string {
	if (event.kind === 'credited')
		return `+${formatMinutes(event.minutes)} în creditul de ore ${clientName}`;
	if (event.kind === 'consumed')
		return `Task finalizat: ${event.taskTitle} — ${formatMinutes(event.realMinutes)}`;
	return `Credit de ore scăzut — ${clientName}`;
}

export function buildHourCreditEmailBody(params: {
	clientName: string;
	event: HourCreditEvent;
	balanceMinutes: number;
	portalUrl: string;
	servicesUrl: string;
	themeColor: string;
}): string {
	const { event, themeColor } = params;
	const clientName = escapeHtml(params.clientName);
	const button = (href: string, label: string) =>
		`<a href="${href}" style="display:inline-block; background:${themeColor}; color:#fff; text-decoration:none; padding: 12px 22px; border-radius: 8px; font-weight: 600; font-size: 14px;">${label}</a>`;
	const balanceRow = `<div style="margin-top: 8px;"><span style="color: #6b7280;">Sold curent</span> &nbsp;·&nbsp; <strong>${formatMinutes(params.balanceMinutes)}</strong></div>`;

	if (event.kind === 'credited') {
		return `
			<p style="${P}">Bună ziua,</p>
			<p style="${P}">Am adăugat <strong>${formatMinutes(event.minutes)}</strong> în creditul de ore al companiei <strong>${clientName}</strong> (${escapeHtml(event.source)}).</p>
			<table role="presentation" cellpadding="0" cellspacing="0" style="${BOX}"><tr><td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">${balanceRow}</td></tr></table>
			${button(params.portalUrl, 'Vezi creditul de ore')}
		`;
	}
	if (event.kind === 'consumed') {
		const overage =
			event.overageRealMinutes > 0
				? `<div style="margin-top: 8px; color: #b45309;">${formatMinutes(event.overageRealMinutes)} depășesc creditul și se facturează separat, la tariful specializării.</div>`
				: '';
		return `
			<p style="${P}">Bună ziua,</p>
			<p style="${P}">Task-ul <strong>${escapeHtml(event.taskTitle)}</strong> a fost finalizat.</p>
			<table role="presentation" cellpadding="0" cellspacing="0" style="${BOX}"><tr><td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
				<div><span style="color: #6b7280;">Ore lucrate</span> &nbsp;·&nbsp; <strong>${formatMinutes(event.realMinutes)}</strong></div>
				<div style="margin-top: 8px;"><span style="color: #6b7280;">Scăzut din credit</span> &nbsp;·&nbsp; <strong>${formatMinutes(event.consumedMinutes)}</strong></div>
				${overage}
				${balanceRow}
			</td></tr></table>
			${button(params.portalUrl, 'Vezi creditul de ore')}
		`;
	}
	return `
		<p style="${P}">Bună ziua,</p>
		<p style="${P}">Creditul de ore al companiei <strong>${clientName}</strong> a scăzut sub pragul de <strong>${formatMinutes(event.thresholdMinutes)}</strong>.</p>
		<table role="presentation" cellpadding="0" cellspacing="0" style="${BOX}"><tr><td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">${balanceRow}</td></tr></table>
		<p style="${P}">Poți cumpăra ore direct online, iar ele intră imediat în credit.</p>
		${button(params.servicesUrl, 'Cumpără ore')}
		<p style="color: #6b7280; font-size: 13px; margin: 16px 0 0 0;"><a href="${params.portalUrl}" style="color: #6b7280;">Vezi creditul de ore</a></p>
	`;
}
