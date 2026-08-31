import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { getLatestBnrRates, loadBnrFxRates } from '$lib/server/bnr/client';
import type { FxRates } from '$lib/server/banking/payment-match';
import {
	emptySpend,
	PLATFORMS,
	type KpiInterview,
	type KpiMonthSpend,
	type KpiStatus,
	type KpiYearData,
	type PlatformId,
	type SpendByPlatform
} from '$lib/logic/interviuri-kpi';

/**
 * Datele paginii „KPI Performanță" (Interviuri → cost pe interviu).
 *
 * Bugetul de ads NU are tabel propriu: se agregă la citire din
 * meta/tiktok/google_ads_spending pentru clienții asociați interviurilor
 * (interview.client_id distinct pe tenant). Sumele în altă valută decât RON
 * (Google e în USD) se convertesc la cursul BNR de la sfârșitul lunii
 * (plafonat la azi pentru luna curentă); fără curs, suma e exclusă și raportată.
 */

/** Rând brut din oricare din tabelele *_ads_spending (deja etichetat cu platforma). */
export interface SpendRowInput {
	platform: PlatformId;
	periodStart: string; // 'YYYY-MM-DD'
	periodEnd: string;
	spendCents: number;
	currencyCode: string;
}
export interface FxWarning {
	platform: PlatformId;
	month: string; // 'YYYY-MM'
	currency: string;
	/** true = convertit la cel mai recent curs disponibil (lipsește istoricul BNR); false = exclus */
	approx: boolean;
}

/** Cursul „zilei de facturare" pentru spend lunar = sfârșitul lunii, plafonat la azi. */
export function fxRateDateFor(periodEnd: string, today: string): string {
	return periodEnd > today ? today : periodEnd;
}

/**
 * Agregă în lei pe (lună, platformă) rândurile unui an. Pur — testabil fără DB.
 * `latestRates` = cel mai recent curs per valută, folosit DOAR când lipsește
 * cotația istorică (istoricul BNR din CRM începe în 2026); suma e marcată „aproximat".
 */
export function aggregateSpend(
	rows: SpendRowInput[],
	year: number,
	fx: FxRates,
	today: string,
	latestRates: Record<string, number> = {}
): { months: KpiMonthSpend[]; warnings: FxWarning[] } {
	const byMonth = new Map<number, SpendByPlatform>();
	const warnings: FxWarning[] = [];
	for (const r of rows) {
		if (!r.periodStart.startsWith(`${year}-`)) continue;
		const monthNum = Number(r.periodStart.slice(5, 7));
		if (!(monthNum >= 1 && monthNum <= 12)) continue;
		const cur = (r.currencyCode || 'RON').toUpperCase();
		let ron: number;
		if (cur === 'RON') {
			ron = r.spendCents / 100;
		} else {
			const rate = fx[fxRateDateFor(r.periodEnd, today)]?.[cur];
			if (rate) {
				ron = (r.spendCents / 100) * rate.ronPerUnit;
			} else if (latestRates[cur]) {
				ron = (r.spendCents / 100) * latestRates[cur];
				warnings.push({ platform: r.platform, month: r.periodStart.slice(0, 7), currency: cur, approx: true });
			} else {
				warnings.push({ platform: r.platform, month: r.periodStart.slice(0, 7), currency: cur, approx: false });
				continue;
			}
		}
		const s = byMonth.get(monthNum) ?? emptySpend();
		s[r.platform] += ron;
		byMonth.set(monthNum, s);
	}
	return {
		months: [...byMonth]
			.sort((a, b) => a[0] - b[0])
			.map(([monthNum, spend]) => ({ monthNum, spend })),
		warnings
	};
}

export interface KpiPlatformInfo {
	id: PlatformId;
	label: string;
	/** „Nume cont · id" sau null când clienții interviurilor n-au cont pe platformă */
	account: string | null;
	syncedAt: string | null;
}
export interface InterviewKpiData {
	years: number[];
	platforms: KpiPlatformInfo[];
	current: KpiYearData;
	previous: KpiYearData | null;
	/** câți clienți distincți au interviuri (0 ⇒ nu putem citi bugete) */
	linkedClients: number;
	hasAdsData: boolean;
	fxWarnings: FxWarning[];
	lastSyncedAt: string | null;
}

type SpendRowWithSync = SpendRowInput & { syncedAt: Date | null };

async function loadSpendRows(tenantId: string, clientIds: string[]): Promise<SpendRowWithSync[]> {
	const [meta, tiktok, google] = await Promise.all([
		db
			.select({
				periodStart: table.metaAdsSpending.periodStart,
				periodEnd: table.metaAdsSpending.periodEnd,
				spendCents: table.metaAdsSpending.spendCents,
				currencyCode: table.metaAdsSpending.currencyCode,
				syncedAt: table.metaAdsSpending.syncedAt
			})
			.from(table.metaAdsSpending)
			.where(
				and(
					eq(table.metaAdsSpending.tenantId, tenantId),
					inArray(table.metaAdsSpending.clientId, clientIds)
				)
			),
		db
			.select({
				periodStart: table.tiktokAdsSpending.periodStart,
				periodEnd: table.tiktokAdsSpending.periodEnd,
				spendCents: table.tiktokAdsSpending.spendCents,
				currencyCode: table.tiktokAdsSpending.currencyCode,
				syncedAt: table.tiktokAdsSpending.syncedAt
			})
			.from(table.tiktokAdsSpending)
			.where(
				and(
					eq(table.tiktokAdsSpending.tenantId, tenantId),
					inArray(table.tiktokAdsSpending.clientId, clientIds)
				)
			),
		db
			.select({
				periodStart: table.googleAdsSpending.periodStart,
				periodEnd: table.googleAdsSpending.periodEnd,
				spendCents: table.googleAdsSpending.spendCents,
				currencyCode: table.googleAdsSpending.currencyCode,
				syncedAt: table.googleAdsSpending.syncedAt
			})
			.from(table.googleAdsSpending)
			.where(
				and(
					eq(table.googleAdsSpending.tenantId, tenantId),
					inArray(table.googleAdsSpending.clientId, clientIds)
				)
			)
	]);
	return [
		...meta.map((r) => ({ ...r, platform: 'meta' as const })),
		...tiktok.map((r) => ({ ...r, platform: 'tiktok' as const })),
		...google.map((r) => ({ ...r, platform: 'google' as const }))
	];
}

function accountLabel(rows: Array<{ name: string; ext: string }>): string | null {
	if (rows.length === 0) return null;
	const first = `${rows[0].name || 'Cont'} · ${rows[0].ext}`;
	return rows.length > 1 ? `${first} +${rows.length - 1}` : first;
}

async function loadAccountLabels(
	tenantId: string,
	clientIds: string[]
): Promise<Record<PlatformId, string | null>> {
	if (clientIds.length === 0) return { tiktok: null, google: null, meta: null };
	const [meta, tiktok, google] = await Promise.all([
		db
			.select({ name: table.metaAdsAccount.accountName, ext: table.metaAdsAccount.metaAdAccountId })
			.from(table.metaAdsAccount)
			.where(
				and(
					eq(table.metaAdsAccount.tenantId, tenantId),
					inArray(table.metaAdsAccount.clientId, clientIds),
					eq(table.metaAdsAccount.isActive, true)
				)
			),
		db
			.select({
				name: table.tiktokAdsAccount.accountName,
				ext: table.tiktokAdsAccount.tiktokAdvertiserId
			})
			.from(table.tiktokAdsAccount)
			.where(
				and(
					eq(table.tiktokAdsAccount.tenantId, tenantId),
					inArray(table.tiktokAdsAccount.clientId, clientIds),
					eq(table.tiktokAdsAccount.isActive, true)
				)
			),
		db
			.select({
				name: table.googleAdsAccount.accountName,
				ext: table.googleAdsAccount.googleAdsCustomerId
			})
			.from(table.googleAdsAccount)
			.where(
				and(
					eq(table.googleAdsAccount.tenantId, tenantId),
					inArray(table.googleAdsAccount.clientId, clientIds),
					eq(table.googleAdsAccount.isActive, true)
				)
			)
	]);
	return { meta: accountLabel(meta), tiktok: accountLabel(tiktok), google: accountLabel(google) };
}

async function loadInterviews(tenantId: string, year: number): Promise<KpiInterview[]> {
	const rows = await db
		.select({
			dataInterviu: table.interview.dataInterviu,
			status: table.interview.status,
			channelName: table.interviewChannel.name
		})
		.from(table.interview)
		.leftJoin(
			table.interviewChannel,
			and(
				eq(table.interview.channelId, table.interviewChannel.id),
				eq(table.interviewChannel.tenantId, tenantId)
			)
		)
		.where(
			and(
				eq(table.interview.tenantId, tenantId),
				gte(table.interview.dataInterviu, `${year}-01-01`),
				lte(table.interview.dataInterviu, `${year}-12-31`)
			)
		);
	return rows.map((r) => ({
		monthNum: Number(r.dataInterviu.slice(5, 7)) || 1,
		channel: r.channelName ?? 'Nespecificat',
		status: (['admisa', 'respinsa', 'in_evaluare'].includes(r.status)
			? r.status
			: 'in_evaluare') as KpiStatus
	}));
}

/** Toate datele de care are nevoie pagina pentru un an (+ anul precedent, pentru delta). */
export async function loadInterviewKpiData(
	tenantId: string,
	requestedYear?: number
): Promise<InterviewKpiData> {
	const today = new Date().toISOString().slice(0, 10);

	const clientRows = await db
		.selectDistinct({ clientId: table.interview.clientId })
		.from(table.interview)
		.where(and(eq(table.interview.tenantId, tenantId), isNotNull(table.interview.clientId)));
	const clientIds = clientRows.map((r) => r.clientId).filter((x): x is string => !!x);

	const yearRows = await db
		.select({ y: sql<string>`substr(${table.interview.dataInterviu}, 1, 4)` })
		.from(table.interview)
		.where(eq(table.interview.tenantId, tenantId))
		.groupBy(sql`substr(${table.interview.dataInterviu}, 1, 4)`);
	const years = new Set<number>(yearRows.map((r) => Number(r.y)).filter((y) => y > 2000));

	const spendRows = clientIds.length ? await loadSpendRows(tenantId, clientIds) : [];
	for (const r of spendRows) {
		const y = Number(r.periodStart.slice(0, 4));
		if (y > 2000) years.add(y);
	}
	const yearList = [...years].sort((a, b) => a - b);
	const year =
		requestedYear && yearList.includes(requestedYear)
			? requestedYear
			: (yearList[yearList.length - 1] ?? new Date().getFullYear());

	const foreign = spendRows.filter((r) => (r.currencyCode || 'RON').toUpperCase() !== 'RON');
	const currencies = [...new Set(foreign.map((r) => r.currencyCode.toUpperCase()))];
	const fx: FxRates = foreign.length
		? await loadBnrFxRates(
				currencies,
				foreign.map((r) => fxRateDateFor(r.periodEnd, today))
			)
		: {};
	// fallback pentru lunile fără istoric BNR: cel mai recent curs cunoscut, PER UNITATE
	// (BNR publică HUF/JPY la 100 de unități → rate / multiplier, ca în resolveFxRates)
	const latestRates: Record<string, number> = {};
	if (currencies.length) {
		for (const r of await getLatestBnrRates()) {
			if (currencies.includes(r.currency) && r.rate > 0) {
				latestRates[r.currency] = r.rate / (r.multiplier || 1);
			}
		}
	}

	const cur = aggregateSpend(spendRows, year, fx, today, latestRates);
	const prev = aggregateSpend(spendRows, year - 1, fx, today, latestRates);
	const [curIv, prevIv, accounts] = await Promise.all([
		loadInterviews(tenantId, year),
		loadInterviews(tenantId, year - 1),
		loadAccountLabels(tenantId, clientIds)
	]);

	const syncedBy: Record<PlatformId, Date | null> = { tiktok: null, google: null, meta: null };
	for (const r of spendRows) {
		if (r.syncedAt && (!syncedBy[r.platform] || r.syncedAt > syncedBy[r.platform]!)) {
			syncedBy[r.platform] = r.syncedAt;
		}
	}
	const lastSynced =
		Object.values(syncedBy)
			.filter((d): d is Date => !!d)
			.sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

	const previous: KpiYearData | null =
		prev.months.length || prevIv.length
			? { year: year - 1, months: prev.months, interviews: prevIv }
			: null;
	return {
		years: yearList,
		platforms: PLATFORMS.map((p) => ({
			id: p.id,
			label: p.label,
			account: accounts[p.id],
			syncedAt: syncedBy[p.id]?.toISOString() ?? null
		})),
		current: { year, months: cur.months, interviews: curIv },
		previous,
		linkedClients: clientIds.length,
		hasAdsData: cur.months.length > 0,
		// și anul precedent: delta „față de anul trecut" e calculată pe aceleași aproximări
		fxWarnings: [...cur.warnings, ...prev.warnings],
		lastSyncedAt: lastSynced?.toISOString() ?? null
	};
}
