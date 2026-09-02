// Raportul săptămânal PageSpeed: agregarea datelor (aceleași formule ca UI-ul),
// corpul HTML al emailului și PDF-ul opțional. Datele sunt serializabile (JSON),
// ca emailul să poată fi re-trimis din admin prin registry-ul de retry.
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import {
	cwvPass,
	isoWeekInterval,
	isoWeekLabel,
	type PsiStrategy
} from '$lib/logic/pagespeed';

export {
	renderPagespeedReportBodyHtml,
	renderPagespeedReportText,
	type PagespeedReportRow,
	type PagespeedReportData
} from './report-html';
import type { PagespeedReportData, PagespeedReportRow } from './report-html';

const avg = (values: (number | null)[]): number | null => {
	const nums = values.filter((v): v is number => v != null);
	return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
};

/**
 * Construiește datele raportului pentru săptămâna dată, din ultimele măsurători
 * ale site-urilor active. Trendul per site = diferența față de măsurătoarea
 * anterioară pe aceeași strategie (mobil), conform spec-ului.
 */
export async function buildPagespeedReportData(
	tenantId: string,
	weekKey: string,
	opts: { includeOpportunities: boolean; attachPdf: boolean } = {
		includeOpportunities: true,
		attachPdf: false
	}
): Promise<PagespeedReportData> {
	const sites = await db
		.select({
			id: table.pagespeedSite.id,
			domain: table.pagespeedSite.domain,
			alertThreshold: table.pagespeedSite.alertThreshold,
			clientName: table.client.name,
			clientEmail: table.client.email
		})
		.from(table.pagespeedSite)
		.leftJoin(
			table.client,
			and(
				eq(table.pagespeedSite.clientId, table.client.id),
				eq(table.client.tenantId, tenantId)
			)
		)
		.where(and(eq(table.pagespeedSite.tenantId, tenantId), eq(table.pagespeedSite.active, true)))
		.orderBy(table.pagespeedSite.domain);

	const siteIds = sites.map((s) => s.id);
	// Fereastra se taie ÎN SQL la săptămâna cerută: altfel, pentru un raport istoric,
	// cele mai noi `siteIds × 24` rânduri ar fi toate din săptămânile de după el, iar
	// raportul ar ieși gol pe măsură ce se adună scanări. („YYYY-Www" se compară
	// lexicografic corect cronologic.)
	const measurements = siteIds.length
		? await db
				.select()
				.from(table.pagespeedMeasurement)
				.where(
					and(
						inArray(table.pagespeedMeasurement.siteId, siteIds),
						lte(table.pagespeedMeasurement.weekKey, weekKey)
					)
				)
				.orderBy(desc(table.pagespeedMeasurement.measuredAt))
				.limit(siteIds.length * 24)
		: [];

	const latest = (siteId: string, strategy: PsiStrategy) => {
		const rows = measurements.filter((m) => m.siteId === siteId && m.strategy === strategy);
		const ok = rows.filter((m) => m.status === 'ok');
		return { any: rows[0] ?? null, last: ok[0] ?? null, prev: ok[1] ?? null };
	};

	const rows: PagespeedReportRow[] = sites.map((site) => {
		const mobile = latest(site.id, 'mobile');
		const desktop = latest(site.id, 'desktop');
		const deltaMobile =
			mobile.last?.performance != null && mobile.prev?.performance != null
				? mobile.last.performance - mobile.prev.performance
				: null;
		const opportunities = (mobile.last?.opportunities ?? []) as {
			title: string;
			savingsMs: number;
		}[];
		return {
			siteId: site.id,
			domain: site.domain,
			clientName: site.clientName,
			clientEmail: site.clientEmail,
			mobile: mobile.last?.performance ?? null,
			deltaMobile,
			desktop: desktop.last?.performance ?? null,
			lcpMs: mobile.last?.lcpMs ?? null,
			cls: mobile.last?.cls ?? null,
			cwv: cwvPass(
				mobile.last
					? { lcpMs: mobile.last.fieldLcpMs, inpMs: mobile.last.fieldInpMs, cls: mobile.last.fieldCls }
					: null
			),
			failed: mobile.any?.status === 'failed' || desktop.any?.status === 'failed',
			alert: deltaMobile != null && deltaMobile <= -(site.alertThreshold || 5),
			topOpportunity: opportunities[0]?.title ?? null
		};
	});

	const measured = rows.filter((r) => r.mobile != null || r.desktop != null);
	const avgMobile = avg(rows.map((r) => r.mobile));
	const prevAvgMobile = avg(
		sites.map((s) => latest(s.id, 'mobile').prev?.performance ?? null)
	);

	return {
		weekKey,
		weekLabel: isoWeekLabel(weekKey),
		interval: isoWeekInterval(weekKey),
		siteCount: measured.length,
		avgMobile,
		avgDesktop: avg(rows.map((r) => r.desktop)),
		deltaMobile: avgMobile != null && prevAvgMobile != null ? avgMobile - prevAvgMobile : null,
		cwvPassCount: rows.filter((r) => r.cwv === true).length,
		cwvKnownCount: rows.filter((r) => r.cwv != null).length,
		alertCount: rows.filter((r) => r.alert).length,
		failedCount: rows.filter((r) => r.failed).length,
		rows,
		includeOpportunities: opts.includeOpportunities,
		attachPdf: opts.attachPdf
	};
}

