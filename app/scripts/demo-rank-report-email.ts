// Previzualizare a emailurilor Rank Tracker (raport + alerte), fără DB/SvelteKit.
// Rulează: bun run scripts/demo-rank-report-email.ts > /tmp/rank-report.html && open /tmp/rank-report.html
import {
	renderRankReportBodyHtml,
	renderRankAlertBodyHtml,
	type RankReportData,
	type RankAlertEmailData
} from '../src/lib/server/rank-tracker/report-html';

const report: RankReportData = {
	weekKey: '2026-W36',
	weekLabel: 'S36',
	interval: '31 aug. – 6 sept. 2026',
	projectCount: 3,
	keywordCount: 42,
	avgPosition: 8.4,
	visibility: 41.7,
	deltaVisibility: 2.3,
	distribution: { '1-3': 8, '4-10': 12, '11-20': 9, '21-50': 7, '51-100': 4, '100+': 2 },
	topUp: [
		{ keyword: 'agentie seo bucuresti', device: 'desktop', from: 9, to: 3, delta: 6 },
		{ keyword: 'optimizare seo', device: 'mobile', from: 12, to: 8, delta: 4 }
	],
	topDown: [
		{ keyword: 'servicii marketing', device: 'desktop', from: 4, to: 11, delta: -7 },
		{ keyword: 'promovare online', device: 'desktop', from: 6, to: null, delta: null }
	],
	aiPresent: 14,
	aiCited: 5,
	alertCount: 3,
	rows: [
		{ projectId: 'p1', domain: 'example.ro', clientName: 'Client Demo', clientEmail: null, keywordCount: 18, avgPosition: 6.2, visibility: 52.1, deltaVisibility: 3.4, top3: 5, top10: 11, alerts: 1, aiCited: 3 },
		{ projectId: 'p2', domain: 'altsite.ro', clientName: 'Alt Client', clientEmail: null, keywordCount: 14, avgPosition: 9.8, visibility: 34.2, deltaVisibility: -1.1, top3: 2, top10: 6, alerts: 2, aiCited: 1 },
		{ projectId: 'p3', domain: 'magazin.ro', clientName: null, keywordCount: 10, avgPosition: 11.3, visibility: 28.9, deltaVisibility: 0.5, top3: 1, top10: 4, alerts: 0, aiCited: 1, clientEmail: null }
	]
};

const alerts: RankAlertEmailData = {
	projectDomain: 'example.ro',
	count: 3,
	rows: [
		{ keyword: 'servicii marketing', device: 'desktop', type: 'drop', from: 4, to: 11, delta: -7 },
		{ keyword: 'promovare online', device: 'desktop', type: 'lost', from: 6, to: null, delta: null },
		{ keyword: 'consultanta seo', device: 'mobile', type: 'out_of_top10', from: 10, to: 14, delta: -4 }
	]
};

const shell = (title: string, body: string) =>
	`<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>${title}</title></head>
	<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f1f5f9;padding:24px;">
	<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
	<h2 style="margin:0 0 4px;color:#0f172a;">${title}</h2>${body}</div></body></html>`;

process.stdout.write(shell('Raport săptămânal', renderRankReportBodyHtml(report)));
process.stdout.write('\n<hr>\n');
process.stdout.write(shell('Alerte poziții', renderRankAlertBodyHtml(alerts)));
