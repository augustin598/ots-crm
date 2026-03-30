import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import {
	createSession,
	checkLogin,
	getSessionForClient,
	cancelSession,
	type ScraperPlatform
} from '$lib/server/scraper/invoice-scraper';
import { scrapeMetaInvoices } from '$lib/server/scraper/platforms/meta-scraper';
import { scrapeGoogleInvoices } from '$lib/server/scraper/platforms/google-scraper';
import { scrapeTiktokInvoices } from '$lib/server/scraper/platforms/tiktok-scraper';

// ── Auth helper ───────────────────────────────────────────────────

function requireAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	if (event.locals.isClientUser) {
		throw error(401, 'Unauthorized');
	}
	return { userId: event.locals.user.id, tenantId: event.locals.tenant.id };
}

// ── Commands ──────────────────────────────────────────────────────

/**
 * Start a new scraper session: launches interactive browser and navigates to billing page.
 * Returns the session ID for subsequent operations.
 */
export const startScraperSession = command(
	v.object({
		platform: v.picklist(['meta', 'google', 'tiktok']),
		integrationId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const { tenantId } = requireAdmin();
		const sessionId = await createSession(
			data.platform as ScraperPlatform,
			tenantId,
			data.integrationId
		);
		return { sessionId };
	}
);

/**
 * Check if the user has completed login in the browser.
 */
export const checkScraperLogin = command(
	v.object({
		sessionId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		requireAdmin();
		const loggedIn = await checkLogin(data.sessionId);
		return { loggedIn };
	}
);

/**
 * Run the scraper: extracts invoices from the billing page + refreshes cookies.
 * Must be called after the user has logged in (checkScraperLogin returns true).
 */
export const runScraper = command(
	v.object({
		sessionId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		requireAdmin();
		const session = getSessionForClient(data.sessionId);
		if (!session) {
			throw error(404, 'Sesiunea nu există');
		}

		if (session.status !== 'logged_in') {
			throw error(400, 'Trebuie să te loghezi mai întâi în browser');
		}

		let invoices;
		switch (session.platform) {
			case 'meta': {
				// Query DB for active CRM-mapped Meta Ads accounts with businessId
				const metaAccounts = await db
					.select({
						metaAdAccountId: table.metaAdsAccount.metaAdAccountId,
						accountName: table.metaAdsAccount.accountName,
						businessId: table.metaAdsIntegration.businessId
					})
					.from(table.metaAdsAccount)
					.innerJoin(table.metaAdsIntegration, eq(table.metaAdsAccount.integrationId, table.metaAdsIntegration.id))
					.where(and(
						eq(table.metaAdsAccount.tenantId, session.tenantId),
						eq(table.metaAdsAccount.isActive, true),
						isNotNull(table.metaAdsAccount.clientId)
					));
				invoices = await scrapeMetaInvoices(data.sessionId, metaAccounts);
				break;
			}
			case 'google': {
				// Query DB for active CRM-mapped Google Ads customer IDs
				const activeAccounts = await db
					.select({ googleAdsCustomerId: table.googleAdsAccount.googleAdsCustomerId })
					.from(table.googleAdsAccount)
					.where(and(
						eq(table.googleAdsAccount.tenantId, session.tenantId),
						eq(table.googleAdsAccount.isActive, true),
						isNotNull(table.googleAdsAccount.clientId)
					));
				const allowedCustomerIds = activeAccounts.map(a => a.googleAdsCustomerId);
				invoices = await scrapeGoogleInvoices(data.sessionId, allowedCustomerIds);
				break;
			}
			case 'tiktok':
				invoices = await scrapeTiktokInvoices(data.sessionId);
				break;
			default:
				throw error(400, `Platformă necunoscută: ${session.platform}`);
		}

		return {
			invoices,
			cookiesRefreshed: getSessionForClient(data.sessionId)?.cookiesRefreshed ?? false
		};
	}
);

/**
 * Cancel a scraper session and close the browser page.
 */
export const cancelScraperSession = command(
	v.object({
		sessionId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		requireAdmin();
		await cancelSession(data.sessionId);
		return { success: true };
	}
);

// ── Queries ───────────────────────────────────────────────────────

/**
 * Get the current status of a scraper session.
 */
export const getScraperSessionStatus = query(
	v.object({
		sessionId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		requireAdmin();
		const session = getSessionForClient(data.sessionId);
		if (!session) return null;
		return session;
	}
);
