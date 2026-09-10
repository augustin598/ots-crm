import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getSession, createSession, checkLogin } from '$lib/server/scraper/invoice-scraper';
import { extractAccountInfo, extractInvoicesFromPage } from '$lib/server/scraper/platforms/google-scraper';
import { getDecryptedGoogleCookies } from '$lib/server/google-ads/google-cookies';
import { downloadGoogleInvoicesFromLinks } from '$lib/server/google-ads/invoice-downloader';
import { formatCustomerId } from '$lib/server/google-ads/client';
import { logInfo, serializeError } from '$lib/server/logger';
import type { RequestHandler, RequestEvent } from './$types';

/**
 * Debug: scrape the Google Ads billing page CURRENTLY open in an interactive
 * scraper session (dev machine only) and import its invoices.
 *
 * Why: the MCC account discovery (graph / table / picker search) can miss an
 * account (Wow Agency, 2026-09-09). The operator navigates the visible Chrome
 * window to that account's Facturare → Documente page by hand, then:
 *   GET  ?sessionId=…                → what page/account the session is on
 *   POST { sessionId, customerId?, dryRun? } → extract (+ import unless dryRun)
 */
function requireAdmin(event: RequestEvent) {
	const { locals } = event;
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	const role = locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: admin access required');
	return { tenantId: locals.tenant.id, userId: locals.user.id };
}

function requireSession(sessionId: string | null, tenantId: string) {
	if (!sessionId) throw error(400, 'sessionId lipsă');
	const session = getSession(sessionId);
	if (!session || !session.page || session.page.isClosed()) throw error(404, 'Sesiunea de scanare nu există sau browserul s-a închis');
	if (session.tenantId !== tenantId || session.platform !== 'google') throw error(403, 'Sesiunea nu aparține acestui tenant');
	return session;
}

export const GET: RequestHandler = async (event) => {
	const { tenantId } = requireAdmin(event);
	const session = requireSession(event.url.searchParams.get('sessionId'), tenantId);
	const page = session.page!;
	const account = await extractAccountInfo(page);
	return json({ sessionId: session.id, status: session.status, url: page.url().slice(0, 300), account });
};

export const POST: RequestHandler = async (event) => {
	const { tenantId, userId } = requireAdmin(event);
	let body: Record<string, unknown> = {};
	try {
		body = (await event.request.json()) as Record<string, unknown>;
	} catch { /* empty */ }

	// action=start: open the visible Chrome (dev machine) on the billing page and
	// return the session id; action=check: has the operator logged in yet?
	const action = typeof body.action === 'string' ? body.action : 'scrape';
	if (action === 'start') {
		const [integration] = await db
			.select({ id: table.googleAdsIntegration.id })
			.from(table.googleAdsIntegration)
			.where(and(eq(table.googleAdsIntegration.tenantId, tenantId), eq(table.googleAdsIntegration.isActive, true)))
			.limit(1);
		if (!integration) throw error(400, 'Integrarea Google Ads nu este configurată');
		const sessionId = await createSession('google', tenantId, integration.id);
		const created = getSession(sessionId);
		return json({ ok: true, sessionId, status: created?.status, url: created?.page?.url().slice(0, 300) });
	}
	if (action === 'check') {
		const s = requireSession(typeof body.sessionId === 'string' ? body.sessionId : null, tenantId);
		const loggedIn = await checkLogin(s.id);
		return json({ ok: true, sessionId: s.id, loggedIn, status: s.status, url: s.page?.url().slice(0, 300) });
	}

	const session = requireSession(typeof body.sessionId === 'string' ? body.sessionId : null, tenantId);
	const page = session.page!;
	const dryRun = body.dryRun === true;

	const account = await extractAccountInfo(page);
	const customerId = formatCustomerId(typeof body.customerId === 'string' && body.customerId ? body.customerId : account.customerId);
	if (!/^\d{10}$/.test(customerId)) {
		return json({ ok: false, error: 'customer_id_unknown', account, url: page.url().slice(0, 300) }, { status: 422 });
	}

	const [mapped] = await db
		.select({ clientId: table.googleAdsAccount.clientId, accountName: table.googleAdsAccount.accountName })
		.from(table.googleAdsAccount)
		.where(and(eq(table.googleAdsAccount.tenantId, tenantId), eq(table.googleAdsAccount.googleAdsCustomerId, customerId)))
		.limit(1);
	if (!mapped?.clientId) {
		return json({ ok: false, error: 'account_not_mapped', customerId, account }, { status: 404 });
	}

	// The table lives in a payments.google.com iframe that may still be loading.
	let invoices = await extractInvoicesFromPage(page);
	for (let attempt = 0; attempt < 3 && invoices.length === 0; attempt++) {
		await new Promise((r) => setTimeout(r, 3000));
		invoices = await extractInvoicesFromPage(page);
	}
	for (const inv of invoices) {
		inv.accountId = customerId;
		inv.accountName = mapped.accountName;
	}

	logInfo('google-scraper', `Debug page scrape: ${invoices.length} invoices on current page for ${customerId}`, {
		tenantId,
		userId,
		metadata: { sessionId: session.id, url: page.url().slice(0, 200), dryRun }
	});

	if (dryRun) {
		return json({ ok: true, dryRun: true, customerId, accountName: mapped.accountName, found: invoices.length, invoices: invoices.map((i) => ({ invoiceId: i.invoiceId, date: i.date, amountText: i.amountText })) });
	}

	const [integration] = await db
		.select({ id: table.googleAdsIntegration.id })
		.from(table.googleAdsIntegration)
		.where(and(eq(table.googleAdsIntegration.tenantId, tenantId), eq(table.googleAdsIntegration.isActive, true)))
		.limit(1);
	if (!integration) throw error(400, 'Integrarea Google Ads nu este configurată');
	const cookies = await getDecryptedGoogleCookies(integration.id, tenantId);
	if (!cookies) throw error(400, 'Cookies Google nu sunt salvate');

	try {
		const links = invoices.filter((i) => i.downloadUrl).map((i) => ({ url: i.downloadUrl!, invoiceId: i.invoiceId, date: i.date, amount: i.amountText }));
		const result = await downloadGoogleInvoicesFromLinks(tenantId, customerId, links, cookies, null);
		return json({ ok: true, customerId, accountName: mapped.accountName, found: invoices.length, ...result });
	} catch (e) {
		const { message } = serializeError(e);
		return json({ ok: false, error: message }, { status: 500 });
	}
};
