// Agregarea hub-ului „SEO & GEO & AEO" — sursă unică pentru pagina de admin
// (/[tenant]/seo, toate website-urile) și pagina din portalul clientului
// (/client/[tenant]/seo, DOAR site-urile/linkurile/PageSpeed-ul clientului din
// sesiune — `clientId` filtrează fiecare interogare la nivel de SQL).
import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { cwvPass, isoWeekKey, isoWeekShortDate } from '$lib/logic/pagespeed';
import { seoOverall } from '$lib/content/seo-score';
import {
	buildSeoRecommendations,
	type SeoRecommendation
} from '$lib/content/seo-recommendations';
import type { SeoHubData, SeoHubWebsite } from '$lib/components/seo-hub/types';

const WEEKS = 6;

function domainOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return url;
	}
}

const num = (v: unknown): number => Number(v ?? 0);
const avgOrNull = (v: unknown): number | null => (v == null ? null : Math.round(Number(v)));

export interface SeoHubOptions {
	/** Setat pentru portalul clientului: limitează TOT la datele acestui client. */
	clientId?: string | null;
}

export async function buildSeoHubData(
	tenantId: string,
	opts: SeoHubOptions = {}
): Promise<SeoHubData> {
	const clientId = opts.clientId ?? null;
	const now = new Date();
	const cutoffWeeks = new Date(now.getTime() - WEEKS * 7 * 86400000);
	const cutoffStale = new Date(now.getTime() - 14 * 86400000);

	const ca = table.contentArticle;
	// subquery pt filtrarea articolelor pe website-urile clientului (clientId-ul de pe
	// content_article e nullable la rândurile vechi — website-ul e proprietarul real)
	const clientWebsiteIds = clientId
		? db
				.select({ id: table.clientWebsite.id })
				.from(table.clientWebsite)
				.where(
					and(
						eq(table.clientWebsite.tenantId, tenantId),
						eq(table.clientWebsite.clientId, clientId)
					)
				)
		: null;

	const [websiteRows, weeklyRows, linksByWebsite, linksByClient, psSites, lastJobRows, clients] =
		await Promise.all([
			db
				.select({
					id: table.clientWebsite.id,
					name: table.clientWebsite.name,
					url: table.clientWebsite.url,
					clientId: table.clientWebsite.clientId,
					clientName: table.client.name,
					wpSiteId: table.clientWebsite.wpSiteId,
					profileId: table.websiteContentProfile.id,
					publishMode: table.websiteContentProfile.publishMode,
					cadencePerWeek: table.websiteContentProfile.cadencePerWeek,
					total: sql<number>`count(${ca.id})`,
					ready: sql<number>`sum(case when ${ca.rewriteStatus} = 'ready' then 1 else 0 end)`,
					scheduled: sql<number>`sum(case when ${ca.publishStatus} = 'scheduled' then 1 else 0 end)`,
					published: sql<number>`sum(case when ${ca.publishStatus} = 'published' then 1 else 0 end)`,
					failed: sql<number>`sum(case when ${ca.publishStatus} = 'failed' then 1 else 0 end)`,
					sourcePending: sql<number>`sum(case when ${ca.rewriteStatus} = 'none' then 1 else 0 end)`,
					analyzed: sql<number>`sum(case when ${ca.seoScore} is not null then 1 else 0 end)`,
					faqSuspect: sql<number>`sum(case when ${ca.aeoScore} is not null and ${ca.aeoScore} <= 83 then 1 else 0 end)`,
					seoAvg: sql<number | null>`avg(${ca.seoScore})`,
					aeoAvg: sql<number | null>`avg(${ca.aeoScore})`,
					geoAvg: sql<number | null>`avg(${ca.geoScore})`
				})
				.from(table.clientWebsite)
				.leftJoin(ca, and(eq(ca.websiteId, table.clientWebsite.id), eq(ca.tenantId, tenantId)))
				.leftJoin(
					table.client,
					and(eq(table.client.id, table.clientWebsite.clientId), eq(table.client.tenantId, tenantId))
				)
				.leftJoin(
					table.websiteContentProfile,
					and(
						eq(table.websiteContentProfile.websiteId, table.clientWebsite.id),
						eq(table.websiteContentProfile.tenantId, tenantId)
					)
				)
				.where(
					and(
						eq(table.clientWebsite.tenantId, tenantId),
						...(clientId ? [eq(table.clientWebsite.clientId, clientId)] : [])
					)
				)
				.groupBy(table.clientWebsite.id),

			db
				.select({
					websiteId: ca.websiteId,
					seoScore: ca.seoScore,
					aeoScore: ca.aeoScore,
					geoScore: ca.geoScore,
					generatedAt: ca.generatedAt
				})
				.from(ca)
				.where(
					and(
						eq(ca.tenantId, tenantId),
						isNotNull(ca.seoScore),
						isNotNull(ca.generatedAt),
						gte(ca.generatedAt, cutoffWeeks),
						...(clientWebsiteIds ? [inArray(ca.websiteId, clientWebsiteIds)] : [])
					)
				),

			db
				.select({
					websiteId: table.seoLink.websiteId,
					total: sql<number>`count(*)`,
					published: sql<number>`sum(case when ${table.seoLink.status} = 'published' then 1 else 0 end)`
				})
				.from(table.seoLink)
				.where(
					and(
						eq(table.seoLink.tenantId, tenantId),
						isNotNull(table.seoLink.websiteId),
						...(clientId ? [eq(table.seoLink.clientId, clientId)] : [])
					)
				)
				.groupBy(table.seoLink.websiteId),

			db
				.select({
					clientId: table.seoLink.clientId,
					clientName: table.client.name,
					total: sql<number>`count(*)`,
					pending: sql<number>`sum(case when ${table.seoLink.status} = 'pending' then 1 else 0 end)`,
					submitted: sql<number>`sum(case when ${table.seoLink.status} = 'submitted' then 1 else 0 end)`,
					published: sql<number>`sum(case when ${table.seoLink.status} = 'published' then 1 else 0 end)`,
					rejected: sql<number>`sum(case when ${table.seoLink.status} = 'rejected' then 1 else 0 end)`,
					costCents: sql<number>`sum(coalesce(${table.seoLink.price}, 0))`,
					stale: sql<number>`sum(case when ${table.seoLink.status} in ('pending','submitted') and ${table.seoLink.createdAt} < ${cutoffStale.toISOString()} then 1 else 0 end)`
				})
				.from(table.seoLink)
				.leftJoin(
					table.client,
					and(eq(table.client.id, table.seoLink.clientId), eq(table.client.tenantId, tenantId))
				)
				.where(
					and(
						eq(table.seoLink.tenantId, tenantId),
						...(clientId ? [eq(table.seoLink.clientId, clientId)] : [])
					)
				)
				.groupBy(table.seoLink.clientId),

			// doar site-urile active: cele în pauză nu intră în medii, tabel sau recomandări
			// (aceeași convenție ca media din modulul PageSpeed)
			db
				.select({
					id: table.pagespeedSite.id,
					domain: table.pagespeedSite.domain
				})
				.from(table.pagespeedSite)
				.where(
					and(
						eq(table.pagespeedSite.tenantId, tenantId),
						eq(table.pagespeedSite.active, true),
						...(clientId ? [eq(table.pagespeedSite.clientId, clientId)] : [])
					)
				),

			// discovery-ul e unealtă de staff, cross-client → nu apare în portal
			clientId
				? Promise.resolve([])
				: db
						.select({
							id: table.seoLinkDiscoveryJob.id,
							sourceDomain: table.seoLinkDiscoveryJob.sourceDomain,
							finishedAt: table.seoLinkDiscoveryJob.finishedAt
						})
						.from(table.seoLinkDiscoveryJob)
						.where(
							and(
								eq(table.seoLinkDiscoveryJob.tenantId, tenantId),
								eq(table.seoLinkDiscoveryJob.status, 'completed')
							)
						)
						.orderBy(desc(table.seoLinkDiscoveryJob.createdAt))
						.limit(1),

			clientId
				? Promise.resolve([])
				: db
						.select({ id: table.client.id, name: table.client.name })
						.from(table.client)
						.where(eq(table.client.tenantId, tenantId))
						.orderBy(table.client.name)
		]);

	// dependente: măsurători PageSpeed (au nevoie de id-urile site-urilor) +
	// rezultatele netrackate ale ultimului discovery job
	const siteIds = psSites.map((s) => s.id);
	const lastJob = lastJobRows[0] ?? null;
	const [psMeasurements, untrackedRows] = await Promise.all([
		siteIds.length
			? db
					.select({
						siteId: table.pagespeedMeasurement.siteId,
						status: table.pagespeedMeasurement.status,
						performance: table.pagespeedMeasurement.performance,
						measuredAt: table.pagespeedMeasurement.measuredAt,
						fieldLcpMs: table.pagespeedMeasurement.fieldLcpMs,
						fieldInpMs: table.pagespeedMeasurement.fieldInpMs,
						fieldCls: table.pagespeedMeasurement.fieldCls
					})
					.from(table.pagespeedMeasurement)
					.where(
						and(
							inArray(table.pagespeedMeasurement.siteId, siteIds),
							eq(table.pagespeedMeasurement.strategy, 'mobile')
						)
					)
					.orderBy(desc(table.pagespeedMeasurement.measuredAt))
					.limit(siteIds.length * 12)
			: Promise.resolve([]),
		lastJob
			? db
					.select({
						n: sql<number>`sum(case when ${table.seoLinkDiscoveryResult.savedAsSeoLinkId} is null and ${table.seoLinkDiscoveryResult.alreadyTracked} = 0 then 1 else 0 end)`
					})
					.from(table.seoLinkDiscoveryResult)
					.where(
						and(
							eq(table.seoLinkDiscoveryResult.jobId, lastJob.id),
							eq(table.seoLinkDiscoveryResult.tenantId, tenantId)
						)
					)
			: Promise.resolve([{ n: 0 }])
	]);

	// ---- PageSpeed per domeniu (ultima + penultima măsurătoare ok, CWV pe date CrUX) ----
	const psBySite = new Map<string, (typeof psMeasurements)[number][]>();
	for (const m of psMeasurements) {
		const list = psBySite.get(m.siteId) ?? [];
		if (list.length < 4) list.push(m);
		psBySite.set(m.siteId, list);
	}
	interface PsSummary {
		mobile: number | null;
		prev: number | null;
		delta: number | null;
		cwv: boolean | null;
		measuredAt: Date | null;
		domain: string;
	}
	const psByDomain = new Map<string, PsSummary>();
	const lastScans: {
		siteId: string;
		domain: string;
		measuredAt: Date;
		mobile: number | null;
		delta: number | null;
		cwv: boolean | null;
	}[] = [];
	for (const site of psSites) {
		const rows = psBySite.get(site.id) ?? [];
		const ok = rows.filter((r) => r.status === 'ok' && r.performance != null);
		const last = ok[0] ?? null;
		const prev = ok[1] ?? null;
		const summary: PsSummary = {
			mobile: last?.performance ?? null,
			prev: prev?.performance ?? null,
			delta:
				last?.performance != null && prev?.performance != null
					? last.performance - prev.performance
					: null,
			cwv: cwvPass(
				last ? { lcpMs: last.fieldLcpMs, inpMs: last.fieldInpMs, cls: last.fieldCls } : null
			),
			measuredAt: rows[0]?.measuredAt ?? null,
			domain: site.domain
		};
		psByDomain.set(site.domain.toLowerCase(), summary);
		if (rows[0]) {
			lastScans.push({
				siteId: site.id,
				domain: site.domain,
				measuredAt: rows[0].measuredAt,
				mobile: summary.mobile,
				delta: summary.delta,
				cwv: summary.cwv
			});
		}
	}
	lastScans.sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime());

	// ---- serii săptămânale (globale + sparkline per website) ----
	const weeks: { id: string; label: string }[] = [];
	for (let back = WEEKS - 1; back >= 0; back--) {
		const id = isoWeekKey(new Date(now.getTime() - back * 7 * 86400000));
		// eticheta = data de luni („31 aug.”), nu codul ISO „S36”
		weeks.push({ id, label: isoWeekShortDate(id) });
	}
	type Acc = { seo: number[]; aeo: number[]; geo: number[] };
	const globalByWeek = new Map<string, Acc>();
	const siteWeek = new Map<string, number[]>(); // `${websiteId}:${weekKey}` -> scoruri SEO
	for (const r of weeklyRows) {
		const wk = isoWeekKey(r.generatedAt!);
		const acc = globalByWeek.get(wk) ?? { seo: [], aeo: [], geo: [] };
		acc.seo.push(r.seoScore!);
		if (r.aeoScore != null) acc.aeo.push(r.aeoScore);
		if (r.geoScore != null) acc.geo.push(r.geoScore);
		globalByWeek.set(wk, acc);
		if (r.websiteId) {
			const key = `${r.websiteId}:${wk}`;
			const list = siteWeek.get(key) ?? [];
			list.push(r.seoScore!);
			siteWeek.set(key, list);
		}
	}
	const mean = (xs: number[]): number | null =>
		xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
	const weekly = {
		weeks,
		seo: weeks.map((w) => mean(globalByWeek.get(w.id)?.seo ?? [])),
		aeo: weeks.map((w) => mean(globalByWeek.get(w.id)?.aeo ?? [])),
		geo: weeks.map((w) => mean(globalByWeek.get(w.id)?.geo ?? []))
	};

	// ---- linkuri per website ----
	const linksByWebsiteMap = new Map(
		linksByWebsite.map((l) => [l.websiteId!, { total: num(l.total), published: num(l.published) }])
	);

	// ---- website-urile (rândurile tabelului) ----
	const websites: SeoHubWebsite[] = websiteRows.map((w) => {
		const domain = domainOf(w.url);
		const ps = psByDomain.get(domain) ?? null;
		const seo = avgOrNull(w.seoAvg);
		const aeo = avgOrNull(w.aeoAvg);
		const geo = avgOrNull(w.geoAvg);
		const failed = num(w.failed);
		// aceleași semnale ca recomandările PageSpeed (scor slab SAU CWV picate),
		// plus regulile de bază din spec: fără profil / fără WordPress / publicări eșuate.
		// În portal, semnalele de integrare internă (profil/WordPress) nu se arată clientului.
		const needsAttention = clientId
			? (ps?.mobile != null && ps.mobile < 50) || ps?.cwv === false || failed > 0
			: (ps?.mobile != null && ps.mobile < 50) ||
				ps?.cwv === false ||
				!w.profileId ||
				!w.wpSiteId ||
				failed > 0;
		return {
			id: w.id,
			name: w.name,
			url: w.url,
			domain,
			clientId: w.clientId,
			clientName: w.clientName,
			wpConnected: !!w.wpSiteId,
			hasProfile: !!w.profileId,
			publishMode: w.publishMode,
			cadencePerWeek: w.cadencePerWeek,
			articles: {
				total: num(w.total),
				ready: num(w.ready),
				scheduled: num(w.scheduled),
				published: num(w.published),
				failed,
				source: num(w.sourcePending),
				analyzed: num(w.analyzed)
			},
			scores: {
				seo,
				aeo,
				geo,
				overall: seo != null && aeo != null && geo != null ? seoOverall(seo, aeo, geo) : null
			},
			links: linksByWebsiteMap.get(w.id) ?? { total: 0, published: 0 },
			pagespeed: {
				mobile: ps?.mobile ?? null,
				delta: ps?.delta ?? null,
				cwv: ps?.cwv ?? null,
				measuredAt: ps?.measuredAt?.toISOString() ?? null
			},
			spark: weeks.map((wk) => mean(siteWeek.get(`${w.id}:${wk.id}`) ?? [])),
			needsAttention
		};
	});
	websites.sort((a, b) => (b.scores.overall ?? -1) - (a.scores.overall ?? -1));

	// ---- recomandările — aceleași reguli pentru tab-ul „Necesită atenție" + KPI ----
	const discoveryUntracked = num(untrackedRows[0]?.n);
	const allRecommendations: SeoRecommendation[] = buildSeoRecommendations(
		{
			websites: websites.map((w) => ({
				id: w.id,
				domain: w.domain,
				clientName: w.clientName,
				hasProfile: w.hasProfile,
				hasWordpress: w.wpConnected,
				failedPublishes: w.articles.failed,
				sourceArticles: w.articles.source,
				analyzedArticles: w.articles.analyzed,
				faqSuspect: num(websiteRows.find((r) => r.id === w.id)?.faqSuspect),
				pagespeedMobile: w.pagespeed.mobile,
				cwvPass: w.pagespeed.cwv
			})),
			links: linksByClient
				.filter((l) => l.clientId)
				.map((l) => ({
					clientId: l.clientId!,
					clientName: l.clientName ?? 'Client necunoscut',
					staleCount: num(l.stale)
				})),
			discoveryUntracked,
			discoveryDomain: lastJob?.sourceDomain ?? null
		},
		now
	);
	// Portal: doar recomandările relevante pentru client (performanță, extractibilitate,
	// linkuri) — cele de integrare internă (profil brand, WordPress) rămân în admin.
	const recommendations = clientId
		? allRecommendations.filter((r) => ['PageSpeed', 'AEO', 'Linkuri'].includes(r.type))
		: allRecommendations;

	// ---- linkuri de presă pe status (panoul din dreapta) ----
	const linkTotals = linksByClient.reduce(
		(acc, l) => ({
			total: acc.total + num(l.total),
			pending: acc.pending + num(l.pending),
			submitted: acc.submitted + num(l.submitted),
			published: acc.published + num(l.published),
			rejected: acc.rejected + num(l.rejected),
			costCents: acc.costCents + num(l.costCents)
		}),
		{ total: 0, pending: 0, submitted: 0, published: 0, rejected: 0, costCents: 0 }
	);

	return {
		websites,
		weekly,
		recommendations,
		linkTotals,
		clients,
		lastScans: lastScans.map((s) => ({ ...s, measuredAt: s.measuredAt.toISOString() })),
		discovery: lastJob
			? {
					sourceDomain: lastJob.sourceDomain,
					finishedAt: lastJob.finishedAt?.toISOString() ?? null,
					untracked: discoveryUntracked
				}
			: null,
		generatedAt: now.toISOString()
	};
}
