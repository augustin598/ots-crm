import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, gte } from 'drizzle-orm';
import { generateExcel, generateCSV, type ExportColumn, type ExportSheet } from '$lib/server/export';

type MetaSpendRow = {
	periodStart: string;
	periodEnd: string;
	clientName: string | null;
	metaAdAccountId: string;
	spendAmount: string;
	currencyCode: string;
	impressions: number | null;
	clicks: number | null;
};

type TiktokSpendRow = {
	periodStart: string;
	periodEnd: string;
	clientName: string | null;
	tiktokAdvertiserId: string;
	spendCents: number;
	currencyCode: string;
	impressions: number | null;
	clicks: number | null;
};

const metaColumns: ExportColumn<MetaSpendRow>[] = [
	{ key: 'periodStart', header: 'Perioadă Start', width: 14 },
	{ key: 'periodEnd', header: 'Perioadă End', width: 14 },
	{ key: 'clientName', header: 'Client', width: 30 },
	{ key: 'metaAdAccountId', header: 'Ad Account ID', width: 20 },
	{
		key: 'spendAmount',
		header: 'Cheltuieli',
		width: 14,
		format: (v) => (v != null ? String(v) : '0')
	},
	{ key: 'currencyCode', header: 'Monedă', width: 10 },
	{ key: 'impressions', header: 'Impresii', width: 12 },
	{ key: 'clicks', header: 'Click-uri', width: 12 }
];

const tiktokColumns: ExportColumn<TiktokSpendRow>[] = [
	{ key: 'periodStart', header: 'Perioadă Start', width: 14 },
	{ key: 'periodEnd', header: 'Perioadă End', width: 14 },
	{ key: 'clientName', header: 'Client', width: 30 },
	{ key: 'tiktokAdvertiserId', header: 'Advertiser ID', width: 20 },
	{
		key: 'spendCents',
		header: 'Cheltuieli',
		width: 14,
		format: (v) => (v != null ? (Number(v) / 100).toFixed(2) : '0.00')
	},
	{ key: 'currencyCode', header: 'Monedă', width: 10 },
	{ key: 'impressions', header: 'Impresii', width: 12 },
	{ key: 'clicks', header: 'Click-uri', width: 12 }
];

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const format = url.searchParams.get('format') ?? 'excel';
	const platform = url.searchParams.get('platform') ?? 'all'; // 'meta' | 'tiktok' | 'all'
	const fromDate = url.searchParams.get('from'); // e.g. "2026-01-01"
	const tenantId = locals.tenant.id;

	const fileName = `ad-spend-${new Date().toISOString().split('T')[0]}`;

	// ---- Meta Ads ----
	let metaRows: MetaSpendRow[] = [];
	if (platform === 'meta' || platform === 'all') {
		let metaConditions = eq(table.metaAdsSpending.tenantId, tenantId);
		if (fromDate) {
			metaConditions = and(
				metaConditions,
				gte(table.metaAdsSpending.periodStart, fromDate)
			) as typeof metaConditions;
		}

		const metaData = await db
			.select({
				periodStart: table.metaAdsSpending.periodStart,
				periodEnd: table.metaAdsSpending.periodEnd,
				clientName: table.client.name,
				metaAdAccountId: table.metaAdsSpending.metaAdAccountId,
				spendAmount: table.metaAdsSpending.spendAmount,
				currencyCode: table.metaAdsSpending.currencyCode,
				impressions: table.metaAdsSpending.impressions,
				clicks: table.metaAdsSpending.clicks
			})
			.from(table.metaAdsSpending)
			.leftJoin(table.client, eq(table.metaAdsSpending.clientId, table.client.id))
			.where(metaConditions)
			.orderBy(desc(table.metaAdsSpending.periodStart));

		metaRows = metaData;
	}

	// ---- TikTok Ads ----
	let tiktokRows: TiktokSpendRow[] = [];
	if (platform === 'tiktok' || platform === 'all') {
		let tiktokConditions = eq(table.tiktokAdsSpending.tenantId, tenantId);
		if (fromDate) {
			tiktokConditions = and(
				tiktokConditions,
				gte(table.tiktokAdsSpending.periodStart, fromDate)
			) as typeof tiktokConditions;
		}

		const tiktokData = await db
			.select({
				periodStart: table.tiktokAdsSpending.periodStart,
				periodEnd: table.tiktokAdsSpending.periodEnd,
				clientName: table.client.name,
				tiktokAdvertiserId: table.tiktokAdsSpending.tiktokAdvertiserId,
				spendCents: table.tiktokAdsSpending.spendCents,
				currencyCode: table.tiktokAdsSpending.currencyCode,
				impressions: table.tiktokAdsSpending.impressions,
				clicks: table.tiktokAdsSpending.clicks
			})
			.from(table.tiktokAdsSpending)
			.leftJoin(table.client, eq(table.tiktokAdsSpending.clientId, table.client.id))
			.where(tiktokConditions)
			.orderBy(desc(table.tiktokAdsSpending.periodStart));

		tiktokRows = tiktokData;
	}

	// ---- CSV (single platform only — no multi-sheet support) ----
	if (format === 'csv') {
		if (platform === 'all') {
			return json(
				{ error: 'CSV format supports only a single platform. Use format=excel for all platforms.' },
				{ status: 400 }
			);
		}
		if (platform === 'tiktok') {
			const csv = generateCSV(tiktokRows, tiktokColumns);
			return new Response(csv, {
				headers: {
					'Content-Type': 'text/csv; charset=utf-8',
					'Content-Disposition': `attachment; filename="${fileName}-tiktok.csv"`
				}
			});
		}
		const csv = generateCSV(metaRows, metaColumns);
		return new Response(csv, {
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="${fileName}-meta.csv"`
			}
		});
	}

	// ---- Excel (multi-sheet) ----
	const sheets: ExportSheet<any>[] = [];
	if (metaRows.length > 0) sheets.push({ name: 'Meta Ads', columns: metaColumns, data: metaRows });
	if (tiktokRows.length > 0) sheets.push({ name: 'TikTok Ads', columns: tiktokColumns, data: tiktokRows });

	// Always produce at least one sheet
	if (sheets.length === 0) {
		sheets.push({ name: 'Date', columns: metaColumns, data: [] });
	}

	const buffer = generateExcel(sheets);
	return new Response(buffer, {
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'Content-Disposition': `attachment; filename="${fileName}.xlsx"`
		}
	});
};
