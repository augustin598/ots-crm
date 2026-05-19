/**
 * Admin-only field patcher for `hostingAccount`. Use when the UI lacks an
 * edit form for a column we need to change (e.g. `currency` for an account
 * that should bill EUR instead of the imported RON default).
 *
 *   POST /[tenant]/api/_debug-patch-hosting-account?domain=<d>            (dry-run; default)
 *   POST /[tenant]/api/_debug-patch-hosting-account?domain=<d>&apply=true (mutate)
 *
 * Query params (all optional except `domain` which selects the account):
 *   - `domain`         : selector, exact match on `hostingAccount.domain`
 *   - `currency`       : new currency code (uppercased). Accepts RON / EUR / USD.
 *   - `hostingProductId`: link the account to a specific catalog product.
 *   - `recurringAmount`: cents, integer ≥ 0. ONLY accept when explicitly needed
 *                        — normally the catalog is source-of-truth.
 *
 * Returns before/after for the patched row. Refuses to operate on more than
 * one account per call to keep changes auditable.
 *
 * Admin-only.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { logInfo } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const ALLOWED_CURRENCY = new Set(['RON', 'EUR', 'USD']);

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	const tenantId = event.locals.tenant.id;
	const apply = event.url.searchParams.get('apply') === 'true';

	const domain = event.url.searchParams.get('domain');
	if (!domain) throw error(400, 'domain query param is required');

	const currencyParam = event.url.searchParams.get('currency');
	const hostingProductIdParam = event.url.searchParams.get('hostingProductId');
	const recurringAmountParam = event.url.searchParams.get('recurringAmount');

	const targetCurrency = currencyParam ? currencyParam.toUpperCase() : null;
	if (targetCurrency && !ALLOWED_CURRENCY.has(targetCurrency)) {
		throw error(400, `currency must be one of ${[...ALLOWED_CURRENCY].join(', ')}`);
	}

	const targetRecurringAmount = recurringAmountParam ? Number(recurringAmountParam) : null;
	if (
		targetRecurringAmount !== null &&
		(!Number.isInteger(targetRecurringAmount) || targetRecurringAmount < 0)
	) {
		throw error(400, 'recurringAmount must be a non-negative integer (cents)');
	}

	const matches = await db
		.select()
		.from(table.hostingAccount)
		.where(
			and(eq(table.hostingAccount.tenantId, tenantId), eq(table.hostingAccount.domain, domain))
		);

	if (matches.length === 0) {
		throw error(404, `No hostingAccount found with domain "${domain}" in this tenant`);
	}
	if (matches.length > 1) {
		throw error(
			409,
			`${matches.length} hostingAccounts share domain "${domain}" — refusing to patch ambiguous selector`
		);
	}

	const account = matches[0];
	const changes: Record<string, { before: unknown; after: unknown }> = {};
	const patch: Partial<typeof table.hostingAccount.$inferInsert> = {};

	if (targetCurrency && targetCurrency !== account.currency) {
		changes.currency = { before: account.currency, after: targetCurrency };
		patch.currency = targetCurrency;
	}
	if (hostingProductIdParam && hostingProductIdParam !== account.hostingProductId) {
		changes.hostingProductId = {
			before: account.hostingProductId,
			after: hostingProductIdParam
		};
		patch.hostingProductId = hostingProductIdParam;
	}
	if (targetRecurringAmount !== null && targetRecurringAmount !== account.recurringAmount) {
		changes.recurringAmount = {
			before: account.recurringAmount,
			after: targetRecurringAmount
		};
		patch.recurringAmount = targetRecurringAmount;
	}

	if (Object.keys(changes).length === 0) {
		return json({
			ok: true,
			apply,
			noChanges: true,
			hostingAccountId: account.id,
			domain: account.domain,
			current: {
				currency: account.currency,
				hostingProductId: account.hostingProductId,
				recurringAmount: account.recurringAmount
			}
		});
	}

	if (apply) {
		patch.updatedAt = new Date();
		await db
			.update(table.hostingAccount)
			.set(patch)
			.where(
				and(
					eq(table.hostingAccount.id, account.id),
					eq(table.hostingAccount.tenantId, tenantId)
				)
			);
		logInfo(
			'directadmin',
			`Patched hostingAccount ${account.id} (${account.domain}): ${Object.keys(changes).join(', ')}`,
			{ tenantId, metadata: { hostingAccountId: account.id, changes } }
		);
	}

	return json({
		ok: true,
		apply,
		hostingAccountId: account.id,
		domain: account.domain,
		changes
	});
};
