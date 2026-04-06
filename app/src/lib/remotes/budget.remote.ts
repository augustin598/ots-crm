import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';
import { listAdAccountInsights, listActiveCampaigns as listMetaCampaigns } from '$lib/server/meta-ads/client';
import { getAuthenticatedClient } from '$lib/server/google-ads/auth';
import { listMonthlySpend, formatCustomerId, listCampaigns as listGoogleCampaigns } from '$lib/server/google-ads/client';
import { getAuthenticatedToken as getTiktokAuthToken } from '$lib/server/tiktok-ads/auth';
import { listAdvertiserInsights, listCampaigns as listTiktokCampaigns } from '$lib/server/tiktok-ads/client';
import { env } from '$env/dynamic/private';
import { logWarning, logInfo } from '$lib/server/logger';
import { desc } from 'drizzle-orm';

/** Get latest BNR exchange rate for a currency → RON */
async function getExchangeRate(currencyCode: string): Promise<{ rate: number; date: string } | null> {
	if (currencyCode === 'RON') return { rate: 1, date: '' };
	const [row] = await db.select({ rate: table.bnrExchangeRate.rate, rateDate: table.bnrExchangeRate.rateDate })
		.from(table.bnrExchangeRate)
		.where(eq(table.bnrExchangeRate.currency, currencyCode))
		.orderBy(desc(table.bnrExchangeRate.rateDate))
		.limit(1);
	return row ? { rate: row.rate, date: row.rateDate } : null;
}

/** Detect currency for an ad account */
async function detectAccountCurrency(platform: string, acc: any, tenantId: string): Promise<string> {
	if (platform === 'google' && acc.currencyCode) return acc.currencyCode;
	// For Meta/TikTok — check latest spending record
	if (platform === 'meta') {
		const [row] = await db.select({ cc: table.metaAdsSpending.currencyCode })
			.from(table.metaAdsSpending)
			.where(and(eq(table.metaAdsSpending.metaAdAccountId, acc.metaAdAccountId), eq(table.metaAdsSpending.tenantId, tenantId)))
			.orderBy(desc(table.metaAdsSpending.periodStart))
			.limit(1);
		return row?.cc || 'RON';
	}
	if (platform === 'tiktok') {
		const [row] = await db.select({ cc: table.tiktokAdsSpending.currencyCode })
			.from(table.tiktokAdsSpending)
			.where(and(eq(table.tiktokAdsSpending.tiktokAdvertiserId, acc.tiktokAdvertiserId), eq(table.tiktokAdsSpending.tenantId, tenantId)))
			.orderBy(desc(table.tiktokAdsSpending.periodStart))
			.limit(1);
		return row?.cc || 'RON';
	}
	return 'RON';
}

function generateBudgetId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const updateBudgetSchema = v.object({
	clientId: v.pipe(v.string(), v.minLength(1)),
	platform: v.picklist(['google', 'meta', 'tiktok']),
	adsAccountId: v.pipe(v.string(), v.minLength(1)),
	monthlyBudget: v.nullable(v.pipe(v.number(), v.minValue(0)))
});

/** Fetch all ads accounts for a client with their current budgets and REAL-TIME spend */
export const getClientAccountBudgets = query(
	v.object({ clientId: v.string() }),
	async ({ clientId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		const tenantId = event.locals.tenant.id;

		// Security: client users can only access their own data
		if (event.locals.isClientUser && event.locals.client) {
			if (event.locals.client.id !== clientId) {
				console.warn(`[budget] Client user ${event.locals.user.id} tried to access budget for client ${clientId}, but owns ${event.locals.client.id}`);
				throw new Error('Unauthorized');
			}
		}

		const startTime = Date.now();
		console.log(`[budget] Fetching budgets for client=${clientId} tenant=${tenantId}`);

		// 1. Fetch platform accounts + budgets in parallel
		const [metaAccounts, ttAccounts, googleAccounts, budgets] = await Promise.all([
			db.select().from(table.metaAdsAccount)
				.where(and(eq(table.metaAdsAccount.clientId, clientId), eq(table.metaAdsAccount.tenantId, tenantId))),
			db.select().from(table.tiktokAdsAccount)
				.where(and(eq(table.tiktokAdsAccount.clientId, clientId), eq(table.tiktokAdsAccount.tenantId, tenantId))),
			db.select().from(table.googleAdsAccount)
				.where(and(eq(table.googleAdsAccount.clientId, clientId), eq(table.googleAdsAccount.tenantId, tenantId))),
			db.select().from(table.adsAccountBudget)
				.where(and(eq(table.adsAccountBudget.clientId, clientId), eq(table.adsAccountBudget.tenantId, tenantId)))
		]);

		console.log(`[budget] Found accounts: meta=${metaAccounts.length} google=${googleAccounts.length} tiktok=${ttAccounts.length} budgets=${budgets.length}`);

		// 2. Current month date range
		const now = new Date();
		const y = now.getFullYear();
		const m = now.getMonth();
		const pad = (n: number) => String(n).padStart(2, '0');
		const monthStart = `${y}-${pad(m + 1)}-01`;
		const lastDay = new Date(y, m + 1, 0).getDate();
		const monthEnd = `${y}-${pad(m + 1)}-${pad(lastDay)}`;

		console.log(`[budget] Date range: ${monthStart} → ${monthEnd}`);

		// DB fallback for spend
		const getDbSpend = async (tbl: any, accountIdField: any, accountId: string): Promise<number> => {
			const [res] = await db
				.select({ totalCents: sql<number>`coalesce(sum(${tbl.spendCents}), 0)` })
				.from(tbl)
				.where(and(
					eq(tbl.tenantId, tenantId),
					eq(accountIdField, accountId),
					gte(tbl.periodStart, monthStart),
					lte(tbl.periodEnd, monthEnd)
				));
			return res?.totalCents || 0;
		};

		// 3. META — real-time spend from API (group by integrationId to avoid duplicate auth calls)
		const metaIntegrationIds = [...new Set(metaAccounts.map(a => a.integrationId))];
		const metaTokenCache = new Map<string, { accessToken: string } | null>();

		for (const integrationId of metaIntegrationIds) {
			try {
				metaTokenCache.set(integrationId, await getAuthenticatedToken(integrationId));
			} catch {
				metaTokenCache.set(integrationId, null);
			}
		}

		const appSecret = env.META_APP_SECRET;
		const metaWithBudgets = await Promise.all(metaAccounts.map(async acc => {
			const budget = budgets.find(b => b.platform === 'meta' && b.adsAccountId === acc.id);
			let spendAmount = 0;
			let activeDailyBudget = 0;
			let source = 'db';

			try {
				const authResult = metaTokenCache.get(acc.integrationId);
				if (authResult && appSecret) {
					// Fetch spend + active campaigns in parallel
					const [insights, campaigns] = await Promise.all([
						listAdAccountInsights(acc.metaAdAccountId, authResult.accessToken, appSecret, monthStart, monthEnd).catch(() => []),
						listMetaCampaigns(acc.metaAdAccountId, authResult.accessToken, appSecret).catch(() => [])
					]);
					spendAmount = (insights ?? []).reduce((sum, i) => sum + (parseFloat(i.spend) || 0), 0);
					// Sum daily budgets from active campaigns (Meta returns in cents)
					activeDailyBudget = (campaigns ?? [])
						.filter(c => c.status === 'ACTIVE')
						.reduce((sum, c) => sum + (parseFloat(c.dailyBudget || '0') / 100), 0);
					source = 'api';
				} else {
					const spendCents = await getDbSpend(table.metaAdsSpending, table.metaAdsSpending.metaAdAccountId, acc.metaAdAccountId);
					spendAmount = spendCents / 100;
				}
			} catch (err) {
				logWarning('meta-ads', `Budget: API fallback to DB for ${acc.metaAdAccountId}`, {
					tenantId, metadata: { error: err instanceof Error ? err.message : String(err) }
				});
				console.warn(`[budget] Meta API failed for ${acc.metaAdAccountId}, using DB fallback:`, err instanceof Error ? err.message : err);
				const spendCents = await getDbSpend(table.metaAdsSpending, table.metaAdsSpending.metaAdAccountId, acc.metaAdAccountId);
				spendAmount = spendCents / 100;
			}

			const currencyCode = budget?.currencyCode || await detectAccountCurrency('meta', acc, tenantId);
			console.log(`[budget] Meta ${acc.metaAdAccountId} (${acc.accountName}): spend=${spendAmount} currency=${currencyCode} activeDailyBudget=${activeDailyBudget} source=${source}`);

			return {
				...acc,
				monthlyBudget: budget?.monthlyBudget ? budget.monthlyBudget / 100 : null,
				spendCents: Math.round(spendAmount * 100),
				spendAmount,
				activeDailyBudget,
				currencyCode
			};
		}));

		// 4. GOOGLE — real-time spend from API (auth once per tenant)
		let googleAuth: Awaited<ReturnType<typeof getAuthenticatedClient>> = null;
		if (googleAccounts.length > 0) {
			try {
				googleAuth = await getAuthenticatedClient(tenantId);
			} catch (err) {
				console.warn(`[budget] Google Ads auth failed for tenant=${tenantId}:`, err instanceof Error ? err.message : err);
			}
		}

		const googleWithBudgets = await Promise.all(googleAccounts.map(async acc => {
			const budget = budgets.find(b => b.platform === 'google' && b.adsAccountId === acc.id);
			let spendAmount = 0;
			let activeDailyBudget = 0;
			let source = 'db';

			try {
				if (googleAuth) {
					const { integration } = googleAuth;
					const cleanId = formatCustomerId(acc.googleAdsCustomerId);
					const [monthlySpend, campaigns] = await Promise.all([
						listMonthlySpend(
							integration.mccAccountId, cleanId,
							integration.developerToken, integration.refreshToken,
							monthStart, monthEnd
						).catch(() => []),
						listGoogleCampaigns(
							integration.mccAccountId, cleanId,
							integration.developerToken, integration.refreshToken
						).catch(() => [])
					]);
					const currentMonth = `${y}-${pad(m + 1)}`;
					const match = (monthlySpend ?? []).find(ms => ms.month?.startsWith(currentMonth));
					spendAmount = typeof match?.spend === 'number' ? match.spend : 0;
					activeDailyBudget = (campaigns ?? [])
						.filter(c => c.status === 'ACTIVE')
						.reduce((sum, c) => sum + (parseFloat(c.dailyBudget || '0')), 0);
					source = 'api';
				} else {
					const spendCents = await getDbSpend(table.googleAdsSpending, table.googleAdsSpending.googleAdsCustomerId, acc.googleAdsCustomerId);
					spendAmount = spendCents / 100;
				}
			} catch (err) {
				logWarning('google-ads', `Budget: API fallback to DB for ${acc.googleAdsCustomerId}`, {
					tenantId, metadata: { error: err instanceof Error ? err.message : String(err) }
				});
				console.warn(`[budget] Google API failed for ${acc.googleAdsCustomerId}, using DB fallback:`, err instanceof Error ? err.message : err);
				const spendCents = await getDbSpend(table.googleAdsSpending, table.googleAdsSpending.googleAdsCustomerId, acc.googleAdsCustomerId);
				spendAmount = spendCents / 100;
			}

			const currencyCode = budget?.currencyCode || acc.currencyCode || 'USD';
			console.log(`[budget] Google ${acc.googleAdsCustomerId} (${acc.accountName}): spend=${spendAmount} currency=${currencyCode} activeDailyBudget=${activeDailyBudget} source=${source}`);

			return {
				...acc,
				monthlyBudget: budget?.monthlyBudget ? budget.monthlyBudget / 100 : null,
				spendCents: Math.round(spendAmount * 100),
				spendAmount,
				activeDailyBudget,
				currencyCode
			};
		}));

		// 5. TIKTOK — real-time API with DB fallback
		const tiktokIntegrationIds = [...new Set(ttAccounts.map(a => a.integrationId))];
		const tiktokTokenCache = new Map<string, { accessToken: string } | null>();

		for (const integrationId of tiktokIntegrationIds) {
			try {
				const authResult = await getTiktokAuthToken(integrationId);
				tiktokTokenCache.set(integrationId, authResult ? { accessToken: authResult.accessToken } : null);
			} catch {
				tiktokTokenCache.set(integrationId, null);
			}
		}

		const tiktokWithBudgets = await Promise.all(ttAccounts.map(async acc => {
			const budget = budgets.find(b => b.platform === 'tiktok' && b.adsAccountId === acc.id);
			let spendAmount = 0;
			let activeDailyBudget = 0;
			let source = 'db';

			try {
				const authResult = tiktokTokenCache.get(acc.integrationId);
				if (authResult) {
					const [insights, campaigns] = await Promise.all([
						listAdvertiserInsights(
							acc.tiktokAdvertiserId, authResult.accessToken, monthStart, monthEnd
						).catch(() => []),
						listTiktokCampaigns(acc.tiktokAdvertiserId, authResult.accessToken).catch(() => [])
					]);
					const currentMonth = `${y}-${pad(m + 1)}`;
					const match = (insights ?? []).find(i => i.dateStart?.startsWith(currentMonth));
					spendAmount = match ? parseFloat(match.spend || '0') : 0;
					activeDailyBudget = (campaigns ?? [])
						.filter(c => c.status === 'ACTIVE')
						.reduce((sum, c) => sum + (parseFloat(c.dailyBudget || '0')), 0);
					source = 'api';
				} else {
					const spendCents = await getDbSpend(table.tiktokAdsSpending, table.tiktokAdsSpending.tiktokAdvertiserId, acc.tiktokAdvertiserId);
					spendAmount = spendCents / 100;
				}
			} catch (err) {
				logWarning('tiktok-ads', `Budget: API fallback to DB for ${acc.tiktokAdvertiserId}`, {
					tenantId, metadata: { error: err instanceof Error ? err.message : String(err) }
				});
				console.warn(`[budget] TikTok API failed for ${acc.tiktokAdvertiserId}, using DB fallback:`, err instanceof Error ? err.message : err);
				const spendCents = await getDbSpend(table.tiktokAdsSpending, table.tiktokAdsSpending.tiktokAdvertiserId, acc.tiktokAdvertiserId);
				spendAmount = spendCents / 100;
			}

			const currencyCode = budget?.currencyCode || await detectAccountCurrency('tiktok', acc, tenantId);
			console.log(`[budget] TikTok ${acc.tiktokAdvertiserId} (${acc.accountName}): spend=${spendAmount} currency=${currencyCode} activeDailyBudget=${activeDailyBudget} source=${source}`);

			return {
				...acc,
				monthlyBudget: budget?.monthlyBudget ? budget.monthlyBudget / 100 : null,
				spendCents: Math.round(spendAmount * 100),
				spendAmount,
				activeDailyBudget,
				currencyCode
			};
		}));

		// 6. Get exchange rates for non-RON currencies
		const allCurrencies = new Set([
			...metaWithBudgets.map(a => a.currencyCode),
			...googleWithBudgets.map(a => a.currencyCode),
			...tiktokWithBudgets.map(a => a.currencyCode)
		]);
		const exchangeRates: Record<string, { rate: number; date: string }> = {};
		for (const cc of allCurrencies) {
			if (cc === 'RON') { exchangeRates['RON'] = { rate: 1, date: '' }; continue; }
			const rateInfo = await getExchangeRate(cc);
			if (rateInfo) exchangeRates[cc] = rateInfo;
		}

		const elapsed = Date.now() - startTime;
		console.log(`[budget] Done in ${elapsed}ms — meta=${metaWithBudgets.length} google=${googleWithBudgets.length} tiktok=${tiktokWithBudgets.length} currencies=${JSON.stringify(exchangeRates)}`);

		return {
			meta: metaWithBudgets,
			tiktok: tiktokWithBudgets,
			google: googleWithBudgets,
			exchangeRates
		};
	}
);

export const updateAccountBudget = command(
	updateBudgetSchema,
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		const tenantId = event.locals.tenant.id;

		// Security: client users can only modify their own budgets
		if (event.locals.isClientUser && event.locals.client) {
			if (event.locals.client.id !== data.clientId) {
				console.warn(`[budget] Client user ${event.locals.user.id} tried to update budget for client ${data.clientId}, but owns ${event.locals.client.id}`);
				throw new Error('Unauthorized');
			}
		}

		// Verify the ads account belongs to this client and tenant
		let accountExists = false;
		if (data.platform === 'meta') {
			const [acc] = await db.select({ id: table.metaAdsAccount.id })
				.from(table.metaAdsAccount)
				.where(and(
					eq(table.metaAdsAccount.id, data.adsAccountId),
					eq(table.metaAdsAccount.clientId, data.clientId),
					eq(table.metaAdsAccount.tenantId, tenantId)
				)).limit(1);
			accountExists = !!acc;
		} else if (data.platform === 'google') {
			const [acc] = await db.select({ id: table.googleAdsAccount.id })
				.from(table.googleAdsAccount)
				.where(and(
					eq(table.googleAdsAccount.id, data.adsAccountId),
					eq(table.googleAdsAccount.clientId, data.clientId),
					eq(table.googleAdsAccount.tenantId, tenantId)
				)).limit(1);
			accountExists = !!acc;
		} else if (data.platform === 'tiktok') {
			const [acc] = await db.select({ id: table.tiktokAdsAccount.id })
				.from(table.tiktokAdsAccount)
				.where(and(
					eq(table.tiktokAdsAccount.id, data.adsAccountId),
					eq(table.tiktokAdsAccount.clientId, data.clientId),
					eq(table.tiktokAdsAccount.tenantId, tenantId)
				)).limit(1);
			accountExists = !!acc;
		}

		if (!accountExists) {
			console.warn(`[budget] Account ${data.adsAccountId} (${data.platform}) not found for client=${data.clientId} tenant=${tenantId}`);
			throw new Error('Contul de ads nu a fost găsit sau nu aparține acestui client.');
		}

		const budgetCents = data.monthlyBudget !== null ? Math.round(data.monthlyBudget * 100) : null;

		// Detect currency for this account
		let detectedCurrency = 'RON';
		if (data.platform === 'google') {
			const [gAcc] = await db.select({ cc: table.googleAdsAccount.currencyCode })
				.from(table.googleAdsAccount).where(eq(table.googleAdsAccount.id, data.adsAccountId)).limit(1);
			detectedCurrency = gAcc?.cc || 'USD';
		} else if (data.platform === 'meta') {
			const [mAcc] = await db.select({ metaAdAccountId: table.metaAdsAccount.metaAdAccountId })
				.from(table.metaAdsAccount).where(eq(table.metaAdsAccount.id, data.adsAccountId)).limit(1);
			if (mAcc) detectedCurrency = await detectAccountCurrency('meta', mAcc, tenantId);
		} else if (data.platform === 'tiktok') {
			const [tAcc] = await db.select({ tiktokAdvertiserId: table.tiktokAdsAccount.tiktokAdvertiserId })
				.from(table.tiktokAdsAccount).where(eq(table.tiktokAdsAccount.id, data.adsAccountId)).limit(1);
			if (tAcc) detectedCurrency = await detectAccountCurrency('tiktok', tAcc, tenantId);
		}

		// Upsert: use adsAccountId + tenantId as unique key
		const [existing] = await db.select({ id: table.adsAccountBudget.id })
			.from(table.adsAccountBudget)
			.where(and(
				eq(table.adsAccountBudget.tenantId, tenantId),
				eq(table.adsAccountBudget.adsAccountId, data.adsAccountId)
			))
			.limit(1);

		if (existing) {
			await db.update(table.adsAccountBudget)
				.set({
					monthlyBudget: budgetCents,
					currencyCode: detectedCurrency,
					updatedAt: new Date()
				})
				.where(eq(table.adsAccountBudget.id, existing.id));
			console.log(`[budget] Updated budget for ${data.platform}/${data.adsAccountId}: ${budgetCents} cents ${detectedCurrency}`);
		} else {
			await db.insert(table.adsAccountBudget).values({
				id: generateBudgetId(),
				tenantId,
				clientId: data.clientId,
				platform: data.platform,
				adsAccountId: data.adsAccountId,
				monthlyBudget: budgetCents,
				currencyCode: detectedCurrency
			});
			console.log(`[budget] Created budget for ${data.platform}/${data.adsAccountId}: ${budgetCents} cents ${detectedCurrency}`);
		}

		logInfo('server', `Budget updated: ${data.platform}/${data.adsAccountId} = ${data.monthlyBudget} RON`, {
			tenantId,
			metadata: { clientId: data.clientId, platform: data.platform, amount: data.monthlyBudget }
		});

		return { success: true };
	}
);
