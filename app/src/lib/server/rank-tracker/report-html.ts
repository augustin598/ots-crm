// Renderer PUR pentru emailurile Rank Tracker (raport săptămânal + alerte).
// Fără DB, fără env, DOAR importuri relative — ca scriptul demo să-l poată importa
// în afara Vite. Corpul e inserat în shell-ul de brand de către email.ts.
import { fmtPosition, type RankBucket } from '../../logic/rank-tracker';
import { alertLabelRo, type RankAlertType } from './alerts';

export interface RankReportRow {
	projectId: string;
	domain: string;
	clientName: string | null;
	clientEmail: string | null;
	keywordCount: number;
	avgPosition: number | null;
	visibility: number;
	deltaVisibility: number | null;
	top3: number;
	top10: number;
	alerts: number;
	aiCited: number;
}

export interface RankReportMover {
	keyword: string;
	device: 'desktop' | 'mobile';
	from: number | null;
	to: number | null;
	delta: number | null;
}

export interface RankReportData {
	weekKey: string;
	weekLabel: string;
	interval: string;
	projectCount: number;
	keywordCount: number;
	avgPosition: number | null;
	visibility: number;
	deltaVisibility: number | null;
	distribution: Record<RankBucket, number>;
	topUp: RankReportMover[];
	topDown: RankReportMover[];
	aiPresent: number;
	aiCited: number;
	alertCount: number;
	rows: RankReportRow[];
}

export interface RankAlertEmailRow {
	keyword: string;
	device: 'desktop' | 'mobile';
	type: RankAlertType;
	from: number | null;
	to: number | null;
	delta: number | null;
}

export interface RankAlertEmailData {
	projectDomain: string;
	count: number;
	rows: RankAlertEmailRow[];
}

const BUCKET_ORDER: RankBucket[] = ['1-3', '4-10', '11-20', '21-50', '51-100', '100+'];
const nf = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 1 });
const esc = (s: string) =>
	s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function fmtDelta(delta: number | null): string {
	if (delta == null) return '—';
	if (delta > 0) return `▲ ${delta}`;
	if (delta < 0) return `▼ ${Math.abs(delta)}`;
	return '→ 0';
}

function fmtVisDelta(delta: number | null): string {
	if (delta == null) return '—';
	const sign = delta > 0 ? '+' : '';
	return `${sign}${nf.format(delta)} pct`;
}

/** Corpul HTML al raportului săptămânal (inline-styles, prietenos cu clienții de mail). */
export function renderRankReportBodyHtml(data: RankReportData): string {
	const kpi = (label: string, value: string, sub = '') => `
		<td style="padding:10px 14px;background:#f8fafc;border-radius:10px;text-align:center;">
			<div style="font-size:22px;font-weight:700;color:#0f172a;">${value}</div>
			<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;">${label}</div>
			${sub ? `<div style="font-size:11px;color:#475569;margin-top:2px;">${sub}</div>` : ''}
		</td>`;

	const distRow = BUCKET_ORDER.map(
		(b) =>
			`<td style="padding:6px 10px;text-align:center;border:1px solid #e2e8f0;">
				<div style="font-weight:700;color:#0f172a;">${data.distribution[b] ?? 0}</div>
				<div style="font-size:11px;color:#64748b;">${b}</div>
			</td>`
	).join('');

	const moverRows = (movers: RankReportMover[]) =>
		movers.length
			? movers
					.map(
						(m) => `<tr>
			<td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">${esc(m.keyword)} <span style="color:#94a3b8;font-size:11px;">(${m.device === 'mobile' ? 'mobil' : 'desktop'})</span></td>
			<td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b;">${fmtPosition(m.from)} → ${fmtPosition(m.to)}</td>
			<td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;">${fmtDelta(m.delta)}</td>
		</tr>`
					)
					.join('')
			: `<tr><td colspan="3" style="padding:8px;color:#94a3b8;">—</td></tr>`;

	const projectRows = data.rows
		.map(
			(r) => `<tr>
			<td style="padding:8px;border-bottom:1px solid #f1f5f9;font-weight:600;">${esc(r.domain)}${r.clientName ? `<div style="font-size:11px;color:#94a3b8;">${esc(r.clientName)}</div>` : ''}</td>
			<td style="padding:8px;border-bottom:1px solid #f1f5f9;text-align:center;">${r.keywordCount}</td>
			<td style="padding:8px;border-bottom:1px solid #f1f5f9;text-align:center;">${r.avgPosition != null ? nf.format(r.avgPosition) : '—'}</td>
			<td style="padding:8px;border-bottom:1px solid #f1f5f9;text-align:center;">${nf.format(r.visibility)}%<div style="font-size:11px;color:#64748b;">${fmtVisDelta(r.deltaVisibility)}</div></td>
			<td style="padding:8px;border-bottom:1px solid #f1f5f9;text-align:center;">${r.top3} / ${r.top10}</td>
			<td style="padding:8px;border-bottom:1px solid #f1f5f9;text-align:center;color:${r.alerts ? '#b91c1c' : '#64748b'};">${r.alerts}</td>
		</tr>`
		)
		.join('');

	return `
	<p style="margin:0 0 12px;color:#334155;">Raport de poziții Google organic pentru săptămâna <strong>${data.interval}</strong> (${data.weekLabel}).</p>
	<table role="presentation" width="100%" style="border-spacing:8px 0;margin:0 0 16px;"><tr>
		${kpi('Vizibilitate', `${nf.format(data.visibility)}%`, fmtVisDelta(data.deltaVisibility))}
		${kpi('Poziție medie', data.avgPosition != null ? nf.format(data.avgPosition) : '—')}
		${kpi('Cuvinte cheie', String(data.keywordCount))}
		${kpi('Alerte', String(data.alertCount))}
	</tr></table>

	<h3 style="font-size:14px;color:#0f172a;margin:16px 0 6px;">Distribuția pozițiilor</h3>
	<table role="presentation" style="border-collapse:collapse;width:100%;"><tr>${distRow}</tr></table>

	<h3 style="font-size:14px;color:#0f172a;margin:18px 0 6px;">Top urcări</h3>
	<table role="presentation" style="border-collapse:collapse;width:100%;font-size:13px;">${moverRows(data.topUp)}</table>

	<h3 style="font-size:14px;color:#0f172a;margin:18px 0 6px;">Top scăderi</h3>
	<table role="presentation" style="border-collapse:collapse;width:100%;font-size:13px;">${moverRows(data.topDown)}</table>

	<h3 style="font-size:14px;color:#0f172a;margin:18px 0 6px;">Proiecte</h3>
	<table role="presentation" style="border-collapse:collapse;width:100%;font-size:13px;">
		<tr style="background:#f8fafc;color:#475569;text-align:left;">
			<th style="padding:8px;">Domeniu</th><th style="padding:8px;text-align:center;">Cuvinte</th>
			<th style="padding:8px;text-align:center;">Poz. medie</th><th style="padding:8px;text-align:center;">Vizibilitate</th>
			<th style="padding:8px;text-align:center;">Top 3 / 10</th><th style="padding:8px;text-align:center;">Alerte</th>
		</tr>
		${projectRows}
	</table>

	<p style="margin:16px 0 0;font-size:12px;color:#64748b;">AI Overview: apare la ${data.aiPresent} cuvinte cheie, domeniul e citat ca sursă la ${data.aiCited}.</p>`;
}

/** Varianta text a raportului (alternativă obligatorie la HTML). */
export function renderRankReportText(data: RankReportData): string {
	const lines = [
		`Raport poziții Google — ${data.interval} (${data.weekLabel})`,
		`Vizibilitate: ${nf.format(data.visibility)}% (${fmtVisDelta(data.deltaVisibility)})`,
		`Poziție medie: ${data.avgPosition != null ? nf.format(data.avgPosition) : '—'}`,
		`Cuvinte cheie: ${data.keywordCount} · Alerte: ${data.alertCount}`,
		'',
		'Distribuție: ' + BUCKET_ORDER.map((b) => `${b}=${data.distribution[b] ?? 0}`).join(' '),
		'',
		'Proiecte:'
	];
	for (const r of data.rows) {
		lines.push(
			`- ${r.domain}: ${r.keywordCount} cuvinte, poz. medie ${r.avgPosition != null ? nf.format(r.avgPosition) : '—'}, vizibilitate ${nf.format(r.visibility)}%, alerte ${r.alerts}`
		);
	}
	lines.push('', 'Trimis automat de OTS CRM.');
	return lines.join('\n');
}

/** Corpul HTML al emailului de alerte pentru un proiect. */
export function renderRankAlertBodyHtml(data: RankAlertEmailData): string {
	const rows = data.rows
		.map(
			(r) => `<tr>
			<td style="padding:7px 8px;border-bottom:1px solid #fee2e2;">${esc(r.keyword)} <span style="color:#94a3b8;font-size:11px;">(${r.device === 'mobile' ? 'mobil' : 'desktop'})</span></td>
			<td style="padding:7px 8px;border-bottom:1px solid #fee2e2;text-align:center;">${fmtPosition(r.from)} → ${fmtPosition(r.to)}</td>
			<td style="padding:7px 8px;border-bottom:1px solid #fee2e2;text-align:right;color:#b91c1c;font-weight:600;">${esc(alertLabelRo(r.type))}</td>
		</tr>`
		)
		.join('');
	return `
	<p style="margin:0 0 12px;color:#334155;">Am detectat <strong>${data.count}</strong> ${data.count === 1 ? 'alertă' : 'alerte'} de poziție pentru <strong>${esc(data.projectDomain)}</strong>.</p>
	<table role="presentation" style="border-collapse:collapse;width:100%;font-size:13px;">
		<tr style="background:#fef2f2;color:#991b1b;text-align:left;"><th style="padding:8px;">Cuvânt cheie</th><th style="padding:8px;text-align:center;">Schimbare</th><th style="padding:8px;text-align:right;">Tip</th></tr>
		${rows}
	</table>
	<p style="margin:14px 0 0;font-size:12px;color:#64748b;">Trimis automat de OTS CRM · Rank Tracker.</p>`;
}

/** Varianta text a emailului de alerte. */
export function renderRankAlertText(data: RankAlertEmailData): string {
	const lines = [`Alerte poziții Google — ${data.projectDomain} (${data.count})`, ''];
	for (const r of data.rows) {
		lines.push(
			`- ${r.keyword} (${r.device === 'mobile' ? 'mobil' : 'desktop'}): ${fmtPosition(r.from)} → ${fmtPosition(r.to)} — ${alertLabelRo(r.type)}`
		);
	}
	return lines.join('\n');
}
