// Site-urile PageSpeed + ultimele măsurători — logică partajată între remote-ul
// de admin (getPagespeedSites, toate site-urile tenantului) și pagina din
// portalul clientului (doar site-urile cu clientId-ul sesiunii).
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { cwvPass, isoWeekKey, isoWeekShortDate, type PsiStrategy } from '$lib/logic/pagespeed';

const SPARK_POINTS = 10;
/** Câte rânduri păstrăm per (site, strategie): 10 puncte de spark + last + prev. */
const ROWS_PER_SERIES = SPARK_POINTS + 2;
/** Săptămânile afișate în graficul de evoluție. */
const TREND_WEEKS = 10;

type MeasurementRow = typeof table.pagespeedMeasurement.$inferSelect;

export interface PagespeedStrategyData {
	last: MeasurementRow | null;
	/** Cea mai recentă măsurătoare REUȘITĂ (poate fi = last). UI-ul afișează scorurile de aici. */
	lastOk: MeasurementRow | null;
	prev: MeasurementRow | null;
	/** Trendul din spec: diferența față de măsurătoarea anterioară, același site + strategie. */
	delta: number | null;
	spark: number[];
}

export interface PagespeedSitesOptions {
	/** Setat pentru portalul clientului: doar site-urile acestui client. */
	clientId?: string | null;
}

export async function buildPagespeedSites(tenantId: string, opts: PagespeedSitesOptions = {}) {
	const clientId = opts.clientId ?? null;

	const sites = await db
		.select({
			id: table.pagespeedSite.id,
			clientId: table.pagespeedSite.clientId,
			clientName: table.client.name,
			domain: table.pagespeedSite.domain,
			name: table.pagespeedSite.name,
			cms: table.pagespeedSite.cms,
			pages: table.pagespeedSite.pages,
			strategies: table.pagespeedSite.strategies,
			alertThreshold: table.pagespeedSite.alertThreshold,
			active: table.pagespeedSite.active,
			pausedAt: table.pagespeedSite.pausedAt,
			createdAt: table.pagespeedSite.createdAt
		})
		.from(table.pagespeedSite)
		.leftJoin(
			table.client,
			and(eq(table.pagespeedSite.clientId, table.client.id), eq(table.client.tenantId, tenantId))
		)
		.where(
			and(
				eq(table.pagespeedSite.tenantId, tenantId),
				...(clientId ? [eq(table.pagespeedSite.clientId, clientId)] : [])
			)
		)
		.orderBy(table.pagespeedSite.domain);

	const siteIds = sites.map((s) => s.id);
	const measurements: MeasurementRow[] = siteIds.length
		? await db
				.select()
				.from(table.pagespeedMeasurement)
				.where(inArray(table.pagespeedMeasurement.siteId, siteIds))
				.orderBy(desc(table.pagespeedMeasurement.measuredAt))
				.limit(siteIds.length * 60)
		: [];

	// grupăm în JS: pe (site, strategie), în ordine descrescătoare a timpului
	const bySiteStrategy = new Map<string, MeasurementRow[]>();
	for (const m of measurements) {
		const key = `${m.siteId}:${m.strategy}`;
		const list = bySiteStrategy.get(key) ?? [];
		if (list.length < ROWS_PER_SERIES) list.push(m);
		bySiteStrategy.set(key, list);
	}

	let lastScanAt: Date | null = null;
	for (const m of measurements) {
		if (!lastScanAt || m.measuredAt > lastScanAt) lastScanAt = m.measuredAt;
	}

	// seria de trend: media scorului Performance pe site-urile active, pe ultimele
	// 10 săptămâni ISO (cea mai recentă măsurătoare ok per site+strategie+săptămână)
	const activeSiteIds = new Set(sites.filter((s) => s.active).map((s) => s.id));
	const trendWeeks: { id: string; label: string }[] = [];
	{
		const now = new Date();
		for (let back = TREND_WEEKS - 1; back >= 0; back--) {
			const d = new Date(now.getTime() - back * 7 * 86400000);
			const id = isoWeekKey(d);
			// eticheta = data de luni („31 aug."), nu codul ISO „S36" — lizibil pentru oricine
			trendWeeks.push({ id, label: isoWeekShortDate(id) });
		}
	}

	// Interogare separată pentru grafic: rândurile de mai sus sunt cele mai RECENTE
	// (pentru tabel și spark) și, după destule scanări, nu mai ajung înapoi 10
	// săptămâni — graficul ar pierde capătul stâng. Aici filtrăm direct fereastra.
	const trendRows = siteIds.length
		? await db
				.select({
					siteId: table.pagespeedMeasurement.siteId,
					strategy: table.pagespeedMeasurement.strategy,
					weekKey: table.pagespeedMeasurement.weekKey,
					performance: table.pagespeedMeasurement.performance
				})
				.from(table.pagespeedMeasurement)
				.where(
					and(
						inArray(table.pagespeedMeasurement.siteId, siteIds),
						gte(table.pagespeedMeasurement.weekKey, trendWeeks[0].id),
						eq(table.pagespeedMeasurement.status, 'ok')
					)
				)
				.orderBy(desc(table.pagespeedMeasurement.measuredAt))
				.limit(siteIds.length * TREND_WEEKS * 2 * 3)
		: [];

	const trendSeries = (strategy: PsiStrategy): (number | null)[] =>
		trendWeeks.map((week) => {
			const perSite = new Map<string, number>();
			// trendRows e sortat desc — prima potrivire per site e cea mai recentă din săptămână
			for (const m of trendRows) {
				if (
					m.weekKey === week.id &&
					m.strategy === strategy &&
					m.performance != null &&
					activeSiteIds.has(m.siteId) &&
					!perSite.has(m.siteId)
				) {
					perSite.set(m.siteId, m.performance);
				}
			}
			if (!perSite.size) return null;
			const values = [...perSite.values()];
			return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
		});
	const trend = {
		weeks: trendWeeks,
		mobile: trendSeries('mobile'),
		desktop: trendSeries('desktop')
	};

	const strategyData = (siteId: string, strategy: PsiStrategy): PagespeedStrategyData => {
		const rows = bySiteStrategy.get(`${siteId}:${strategy}`) ?? [];
		const ok = rows.filter((r) => r.status === 'ok');
		const last = rows[0] ?? null; // include eventualul failed, ca UI să-l poată semnala
		const lastOk = ok[0] ?? null;
		const prevOk = ok[1] ?? null;
		return {
			last,
			lastOk,
			prev: prevOk,
			delta:
				lastOk?.performance != null && prevOk?.performance != null
					? lastOk.performance - prevOk.performance
					: null,
			spark: ok
				.slice(0, SPARK_POINTS)
				.map((r) => r.performance)
				.filter((p): p is number => p != null)
				.reverse()
		};
	};

	return {
		lastScanAt,
		trend,
		sites: sites.map((s) => {
			const mobile = strategyData(s.id, 'mobile');
			const lastOkMobile = mobile.lastOk;
			return {
				...s,
				pages: s.pages as { url: string; label: string }[],
				strategies: s.strategies as PsiStrategy[],
				data: {
					mobile,
					desktop: strategyData(s.id, 'desktop')
				},
				cwv: cwvPass(
					lastOkMobile
						? {
								lcpMs: lastOkMobile.fieldLcpMs,
								inpMs: lastOkMobile.fieldInpMs,
								cls: lastOkMobile.fieldCls
							}
						: null
				)
			};
		})
	};
}
