import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { generateReportPdf } from '$lib/server/report-pdf-generator';
import { getDateRange, getPlatformSpendData } from '$lib/server/scheduler/tasks/pdf-report-send';
import { logWarning } from '$lib/server/logger';

/** Get account names for a client on a platform (from account tables, not spending) */
async function getClientAccounts(tenantId: string, clientId: string, platform: string) {
	try {
		if (platform === 'meta') {
			const rows = await db.select({ name: table.metaAdsAccount.accountName })
				.from(table.metaAdsAccount)
				.where(and(eq(table.metaAdsAccount.tenantId, tenantId), eq(table.metaAdsAccount.clientId, clientId)));
			return rows.map((r) => ({ accountName: r.name, spend: 0, currency: 'RON' }));
		}
		if (platform === 'google') {
			const rows = await db.select({ name: table.googleAdsAccount.accountName })
				.from(table.googleAdsAccount)
				.where(and(eq(table.googleAdsAccount.tenantId, tenantId), eq(table.googleAdsAccount.clientId, clientId)));
			return rows.map((r) => ({ accountName: r.name, spend: 0, currency: 'RON' }));
		}
		if (platform === 'tiktok') {
			const rows = await db.select({ name: table.tiktokAdsAccount.accountName })
				.from(table.tiktokAdsAccount)
				.where(and(eq(table.tiktokAdsAccount.tenantId, tenantId), eq(table.tiktokAdsAccount.clientId, clientId)));
			return rows.map((r) => ({ accountName: r.name, spend: 0, currency: 'RON' }));
		}
	} catch (err) {
		logWarning('server', `Failed to load ${platform} accounts for preview`, { tenantId, metadata: { clientId, platform, error: (err as Error).message } });
	}
	return [];
}

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const tenantId = event.locals.tenant.id;
	const url = event.url;

	const clientId = url.searchParams.get('clientId');
	if (!clientId) {
		throw error(400, 'clientId is required');
	}

	// Verify client belongs to tenant
	const [client] = await db
		.select({ id: table.client.id, name: table.client.name })
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);

	if (!client) {
		throw error(404, 'Clientul nu a fost gasit');
	}

	// Parse platforms
	const platformsParam = url.searchParams.get('platforms') || 'meta,google,tiktok';
	const platformNames = platformsParam.split(',').filter((p) => ['meta', 'google', 'tiktok'].includes(p));
	if (platformNames.length === 0) {
		throw error(400, 'Cel putin o platforma valida este necesara');
	}

	// Calculate date range
	const frequency = url.searchParams.get('frequency') || 'weekly';
	const sinceParam = url.searchParams.get('since');
	const untilParam = url.searchParams.get('until');

	let since: string;
	let until: string;
	let label: string;

	if (sinceParam && untilParam) {
		// Reject unparseable or semantically invalid ranges. Without these guards
		// a single request can pin the DB for minutes with a 10-year WHERE BETWEEN.
		const isoDate = /^\d{4}-\d{2}-\d{2}$/;
		if (!isoDate.test(sinceParam) || !isoDate.test(untilParam)) {
			throw error(400, 'since/until must be YYYY-MM-DD');
		}
		const sd = new Date(sinceParam + 'T00:00:00');
		const ud = new Date(untilParam + 'T00:00:00');
		if (Number.isNaN(sd.getTime()) || Number.isNaN(ud.getTime())) {
			throw error(400, 'since/until are not valid dates');
		}
		if (sd > ud) {
			throw error(400, 'since must be on or before until');
		}
		const MAX_DAYS = 400;
		const diffDays = Math.ceil((ud.getTime() - sd.getTime()) / 86_400_000);
		if (diffDays > MAX_DAYS) {
			throw error(400, `Intervalul maxim permis este de ${MAX_DAYS} zile`);
		}
		since = sinceParam;
		until = untilParam;
		// Format label nicely: "1 - 17 aprilie 2026"
		if (sd.getMonth() === ud.getMonth()) {
			label = `${sd.getDate()} - ${ud.getDate()} ${ud.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })}`;
		} else {
			label = `${sd.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long' })} - ${ud.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })}`;
		}
	} else {
		const range = getDateRange(frequency, new Date());
		since = range.since;
		until = range.until;
		label = range.label;
	}

	// Get platform data — for preview, include platforms with zero data too
	const platformDisplayNames: Record<string, string> = {
		meta: 'Meta Ads',
		google: 'Google Ads',
		tiktok: 'TikTok Ads'
	};
	const platforms = [];
	for (const platformName of platformNames) {
		const data = await getPlatformSpendData(tenantId, clientId, platformName, since, until);
		if (data) {
			// If no accounts from spending, try to get from account tables
			if (!data.accounts || data.accounts.length === 0) {
				data.accounts = await getClientAccounts(tenantId, clientId, platformName);
			}
			platforms.push(data);
		} else {
			// Include with zero values so it appears in the PDF
			const accounts = await getClientAccounts(tenantId, clientId, platformName);
			platforms.push({
				name: platformDisplayNames[platformName] || platformName,
				spend: 0,
				impressions: 0,
				clicks: 0,
				conversions: 0,
				currency: 'RON',
				accounts
			});
		}
	}

	// Get tenant logo
	const tenantName = event.locals.tenant.name || 'CRM';
	let tenantLogo: string | null = null;
	try {
		const [invoiceSettings] = await db
			.select({ invoiceLogo: table.invoiceSettings.invoiceLogo })
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, tenantId))
			.limit(1);
		tenantLogo = invoiceSettings?.invoiceLogo || null;
	} catch (err) {
		logWarning('server', 'Failed to load invoice settings for PDF preview, using default logo', { tenantId, metadata: { error: (err as Error).message } });
	}

	// Fetch latest BNR exchange rates for currency conversion
	const exchangeRates: Record<string, number> = {};
	try {
		const rates = await db
			.select({ currency: table.bnrExchangeRate.currency, rate: table.bnrExchangeRate.rate })
			.from(table.bnrExchangeRate)
			.where(eq(table.bnrExchangeRate.currency, 'USD'))
			.orderBy(desc(table.bnrExchangeRate.rateDate))
			.limit(1);
		const eurRates = await db
			.select({ currency: table.bnrExchangeRate.currency, rate: table.bnrExchangeRate.rate })
			.from(table.bnrExchangeRate)
			.where(eq(table.bnrExchangeRate.currency, 'EUR'))
			.orderBy(desc(table.bnrExchangeRate.rateDate))
			.limit(1);
		if (rates[0]) exchangeRates['USD'] = rates[0].rate;
		if (eurRates[0]) exchangeRates['EUR'] = eurRates[0].rate;
	} catch (err) {
		logWarning('server', 'Failed to load BNR exchange rates, using original currencies', { tenantId, metadata: { error: (err as Error).message } });
	}

	const pdfBuffer = await generateReportPdf({
		tenantName,
		clientName: client.name || 'Client',
		period: { since, until, label },
		platforms,
		generatedAt: new Date(),
		tenantLogo,
		accentColor: event.locals.tenant.themeColor || null,
		exchangeRates
	});

	const safeClientName = (client.name || 'client').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
	const safeLabel = label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
	const filename = `raport-${safeClientName}-${safeLabel}.pdf`;

	const download = url.searchParams.get('download') === 'true';
	const disposition = download ? 'attachment' : 'inline';

	const uint8 = new Uint8Array(pdfBuffer);

	return new Response(uint8, {
		status: 200,
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `${disposition}; filename="${filename}"`,
			'Content-Length': pdfBuffer.length.toString()
		}
	});
};
