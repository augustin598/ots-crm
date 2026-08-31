/**
 * Demo standalone pentru emailul „Raport PageSpeed" (fără DB, fără SvelteKit).
 * Folosește EXACT renderer-ul de producție (report-html.ts e pur) montat într-un
 * shell brand minimal, ca layoutul inspectat aici să fie cel trimis în realitate.
 *
 * Run:
 *   bun run scripts/demo-pagespeed-report-email.ts > /tmp/pagespeed-report-demo.html && open /tmp/pagespeed-report-demo.html
 */
import {
	renderPagespeedReportBodyHtml,
	renderPagespeedReportText,
	type PagespeedReportData
} from '../src/lib/server/pagespeed/report-html';

const row = (
	domain: string,
	clientName: string,
	mobile: number | null,
	deltaMobile: number | null,
	desktop: number | null,
	over: Partial<PagespeedReportData['rows'][number]> = {}
): PagespeedReportData['rows'][number] => ({
	siteId: domain,
	domain,
	clientName,
	clientEmail: null,
	mobile,
	deltaMobile,
	desktop,
	lcpMs: mobile == null ? null : 5900 - mobile * 40,
	cls: mobile == null ? null : +(0.3 - mobile * 0.002).toFixed(3),
	cwv: mobile == null ? null : mobile >= 70,
	failed: false,
	alert: deltaMobile != null && deltaMobile <= -5,
	topOpportunity: mobile != null && mobile < 90 ? 'Eliminați resursele care blochează redarea' : null,
	...over
});

const data: PagespeedReportData = {
	weekKey: '2026-W35',
	weekLabel: 'S35',
	interval: '24 – 30 aug. 2026',
	siteCount: 8,
	avgMobile: 61,
	avgDesktop: 87,
	deltaMobile: -3,
	cwvPassCount: 3,
	cwvKnownCount: 7,
	alertCount: 2,
	failedCount: 1,
	rows: [
		row('heylux.com', 'Heylux SRL', 58, -9, 88),
		row('beautyoneshop.ro', 'Beauty One Medical Europa SRL', 34, 2, 71),
		row('beonemedical.ro', 'Beauty One Medical Europa SRL', 72, 3, 94),
		row('wow-agency.com', 'Wow Agency', 91, 0, 99),
		row('luckygroup.ro', 'Lucky Group SRL', 47, -1, 79),
		row('teamwashluxury.ro', 'Team Wash Luxury SRL', 64, 2, 90, { cwv: null }),
		row('navitech.ro', 'Navitech Systems SRL', 41, -7, 74, { failed: true }),
		row('onetopsolution.ro', 'One Top Solution SRL', 83, 1, 97)
	],
	includeOpportunities: true,
	attachPdf: true
};

const bodyHtml = renderPagespeedReportBodyHtml(data, 5);

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Raport PageSpeed — ${data.weekLabel}</title></head>
<body style="margin: 0; padding: 0; background-color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
	<div style="max-width: 600px; margin: 0 auto; padding: 32px 20px;">
		<div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 32px;">
			<h1 style="color: #1877f2; font-size: 22px; margin: 0 0 6px 0; line-height: 1.2;">Raport PageSpeed Insights — ${data.weekLabel}</h1>
			<p style="color: #6b7280; font-size: 13px; margin: 0 0 24px 0;">Săptămâna ${data.interval} · ${data.siteCount} site-uri scanate</p>
			<div style="height: 1px; background-color: #e5e7eb; margin: 0 0 24px 0;"></div>
			${bodyHtml}
		</div>
	</div>
</body>
</html>`;

console.log(html);
console.error('\n--- text simplu ---\n' + renderPagespeedReportText(data));
