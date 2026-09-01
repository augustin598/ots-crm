// Randarea PURĂ a raportului săptămânal PageSpeed (fără DB, fără env) — folosită
// de email.ts și de scripts/demo-pagespeed-report-email.ts. Importuri relative
// intenționat: scriptul demo rulează cu bun în afara Vite, unde $lib nu există.
import { psiFmt, psiScoreLevel } from '../../logic/pagespeed';

export interface PagespeedReportRow {
	siteId: string;
	domain: string;
	clientName: string | null;
	clientEmail: string | null;
	mobile: number | null;
	deltaMobile: number | null;
	desktop: number | null;
	lcpMs: number | null;
	cls: number | null;
	cwv: boolean | null;
	failed: boolean;
	alert: boolean;
	topOpportunity: string | null;
}

export interface PagespeedReportData {
	weekKey: string;
	weekLabel: string;
	interval: string;
	siteCount: number;
	avgMobile: number | null;
	avgDesktop: number | null;
	deltaMobile: number | null;
	cwvPassCount: number;
	cwvKnownCount: number;
	alertCount: number;
	failedCount: number;
	rows: PagespeedReportRow[];
	includeOpportunities: boolean;
	attachPdf: boolean;
}

const SCORE_COLORS: Record<string, string> = {
	good: '#047857',
	ni: '#b45309',
	poor: '#b91c1c',
	none: '#9ca3af'
};

function scoreCell(value: number | null, bold = true): string {
	const color = SCORE_COLORS[psiScoreLevel(value)];
	// evidențiere spec: scoruri sub 50 pe fundal roșu deschis
	const bg = value != null && value < 50 ? 'background-color: #fef2f2;' : '';
	return `<td style="padding: 8px 6px; text-align: right; border-top: 1px solid #e5e7eb; color: ${color}; font-weight: ${bold ? 700 : 600}; ${bg}">${value ?? '—'}</td>`;
}

function deltaCell(delta: number | null, threshold: number): string {
	if (delta == null) {
		return '<td style="padding: 8px 6px; text-align: right; border-top: 1px solid #e5e7eb; color: #9ca3af;">—</td>';
	}
	// evidențiere spec: scăderi peste prag, pe fundal roșu deschis
	const dropped = delta <= -threshold;
	const color = delta > 0 ? '#047857' : delta < 0 ? '#b91c1c' : '#6b7280';
	return `<td style="padding: 8px 6px; text-align: right; border-top: 1px solid #e5e7eb; color: ${color}; font-weight: 700; ${dropped ? 'background-color: #fef2f2;' : ''}">${delta > 0 ? '+' : ''}${delta}</td>`;
}

const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

/** Corpul HTML al raportului (se montează în renderBrandedEmail). */
export function renderPagespeedReportBodyHtml(
	data: PagespeedReportData,
	threshold: number
): string {
	const kpi = (label: string, value: string, color = '#111827') =>
		`<td style="padding: 12px 14px; border-right: 1px solid #e5e7eb;">
			<div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #6b7280;">${label}</div>
			<div style="font-size: 21px; font-weight: 800; margin-top: 3px; color: ${color};">${value}</div>
		</td>`;

	const rowsHtml = data.rows
		.map((r) => {
			const failedTag = r.failed
				? ' <span style="font-size: 10px; font-weight: 700; color: #b91c1c; background-color: #fef2f2; border-radius: 4px; padding: 1px 5px;">eșuat</span>'
				: '';
			return `<tr>
			<td style="padding: 8px 6px 8px 0; border-top: 1px solid #e5e7eb;"><strong>${escapeHtml(r.domain)}</strong>${failedTag}<div style="font-size: 11px; color: #9ca3af;">${escapeHtml(r.clientName ?? '')}</div></td>
			${scoreCell(r.mobile)}
			${deltaCell(r.deltaMobile, threshold)}
			${scoreCell(r.desktop, false)}
			<td style="padding: 8px 6px; text-align: right; border-top: 1px solid #e5e7eb; color: #374151;">${r.lcpMs != null ? psiFmt('lcp', r.lcpMs) : '—'}</td>
			<td style="padding: 8px 6px; text-align: right; border-top: 1px solid #e5e7eb; color: #374151;">${r.cls != null ? psiFmt('cls', r.cls) : '—'}</td>
			<td style="padding: 8px 0 8px 6px; text-align: right; border-top: 1px solid #e5e7eb; color: ${r.cwv == null ? '#9ca3af' : r.cwv ? '#047857' : '#b91c1c'}; font-weight: 600;">${r.cwv == null ? '—' : r.cwv ? 'trece' : 'nu trece'}</td>
		</tr>`;
		})
		.join('');

	const alerts = data.rows.filter((r) => r.alert);
	const alertsHtml = alerts.length
		? `<div style="margin-top: 16px; border: 1px solid #fecaca; background-color: #fef2f2; border-radius: 10px; padding: 12px 14px; font-size: 13px; color: #7f1d1d;">
			<strong style="display: block; margin-bottom: 4px;">${alerts.length} ${alerts.length === 1 ? 'site a scăzut' : 'site-uri au scăzut'} peste pragul de alertă</strong>
			${alerts
				.map(
					(a) =>
						`<div>${escapeHtml(a.domain)}: ${a.mobile} pe mobil (${a.deltaMobile} puncte)${a.topOpportunity ? ` — ${escapeHtml(a.topOpportunity.toLowerCase())}` : ''}</div>`
				)
				.join('')}
		</div>`
		: '';

	const oppsNote = data.includeOpportunities
		? `<p style="color: #6b7280; font-size: 12px; line-height: 1.6; margin: 14px 0 0 0;">Raportul include principalele oportunități PageSpeed pentru site-urile sub 90 de puncte${data.attachPdf ? ' și PDF-ul complet atașat' : ''}.</p>`
		: '';

	return `
		<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; margin: 0 0 18px 0; border-collapse: separate;">
			<tr>
				${kpi('Scor mediu mobil', String(data.avgMobile ?? '—'), SCORE_COLORS[psiScoreLevel(data.avgMobile)])}
				${kpi('Scor mediu desktop', String(data.avgDesktop ?? '—'), SCORE_COLORS[psiScoreLevel(data.avgDesktop)])}
				${kpi('Δ vs săpt. trecută', data.deltaMobile == null ? '—' : `${data.deltaMobile > 0 ? '+' : ''}${data.deltaMobile}`)}
				<td style="padding: 12px 14px;">
					<div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #6b7280;">Trec Core Web Vitals</div>
					<div style="font-size: 21px; font-weight: 800; margin-top: 3px; color: #111827;">${data.cwvPassCount}/${data.cwvKnownCount || data.siteCount}</div>
				</td>
			</tr>
		</table>
		<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; font-size: 13px;">
			<thead>
				<tr>
					<th style="text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; padding: 0 6px 8px 0;">Site</th>
					<th style="text-align: right; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; padding: 0 6px 8px;">Mobil</th>
					<th style="text-align: right; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; padding: 0 6px 8px;">Δ</th>
					<th style="text-align: right; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; padding: 0 6px 8px;">Desktop</th>
					<th style="text-align: right; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; padding: 0 6px 8px;">LCP</th>
					<th style="text-align: right; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; padding: 0 6px 8px;">CLS</th>
					<th style="text-align: right; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; padding: 0 0 8px 6px;">CWV</th>
				</tr>
			</thead>
			<tbody>${rowsHtml}</tbody>
		</table>
		${alertsHtml}
		${oppsNote}
		<p style="color: #9ca3af; font-size: 11px; line-height: 1.6; margin: 18px 0 0 0;">Trimis automat de OTS CRM · sursa datelor: Google PageSpeed Insights API v5 (Lighthouse + CrUX).</p>
	`;
}

/** Varianta text simplu (fără diacritice, convenția emailurilor din proiect). */
export function renderPagespeedReportText(data: PagespeedReportData): string {
	const lines = data.rows.map(
		(r) =>
			`${r.domain}: mobil ${r.mobile ?? '-'} (${r.deltaMobile == null ? '-' : (r.deltaMobile > 0 ? '+' : '') + r.deltaMobile}), desktop ${r.desktop ?? '-'}${r.failed ? ' [esuat]' : ''}`
	);
	return [
		`Raport PageSpeed — ${data.interval}`,
		'',
		`Scor mediu mobil: ${data.avgMobile ?? '-'} | desktop: ${data.avgDesktop ?? '-'} | Trec CWV: ${data.cwvPassCount}/${data.cwvKnownCount || data.siteCount}`,
		'',
		...lines,
		'',
		'Trimis automat de OTS CRM. Sursa datelor: Google PageSpeed Insights API v5.'
	]
		.join('\n')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '');
}
