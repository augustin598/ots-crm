/**
 * Recovery endpoint: walks all active hostingAccount rows for the tenant and
 * upserts a recurring invoice template for each. Use after a deploy that adds
 * new accounts that pre-date the auto-create hook, after a billing-cycle/amount
 * change on hostingAccount, or after a catalog price sync.
 *
 *   POST /[tenant]/api/_debug-sync-hosting-recurring
 *   POST /[tenant]/api/_debug-sync-hosting-recurring?dryRun=true
 *
 * Returns:
 *   {
 *     ok: true,
 *     dryRun: bool,
 *     processed: N,
 *     created: N,
 *     updated: N,
 *     skipped: N,
 *     noop: N,
 *     errors: [{ hostingAccountId, error }, ...],
 *     diffs: [{ hostingAccountId, domain, action, reason?, priceSource?, before?, after? }, ...]
 *   }
 *
 * Idempotent: re-running on a fully-synced tenant emits `noop` for every row.
 * Per-account failure does NOT abort the walk — collected in `errors` so
 * operator sees the full picture in one shot.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import {
	upsertRecurringInvoiceForHostingAccount,
	type UpsertDiff
} from '$lib/server/hosting/recurring-template';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	const tenantId = event.locals.tenant.id;
	const userId = event.locals.user.id;
	const dryRun = event.url.searchParams.get('dryRun') === 'true';

	const accounts = await db
		.select({
			id: table.hostingAccount.id,
			clientId: table.hostingAccount.clientId,
			domain: table.hostingAccount.domain,
			daPackageName: table.hostingAccount.daPackageName,
			daPackageId: table.hostingAccount.daPackageId,
			hostingProductId: table.hostingAccount.hostingProductId,
			recurringAmount: table.hostingAccount.recurringAmount,
			currency: table.hostingAccount.currency,
			billingCycle: table.hostingAccount.billingCycle,
			status: table.hostingAccount.status,
			nextDueDate: table.hostingAccount.nextDueDate,
			startDate: table.hostingAccount.startDate
		})
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				// Walk active, pending and suspended; the upsert helper itself skips
				// terminated/cancelled. This avoids leaving stale active templates on
				// suspended accounts.
				inArray(table.hostingAccount.status, ['active', 'pending', 'suspended'])
			)
		);

	logInfo(
		'directadmin',
		`Sync-hosting-recurring: walking ${accounts.length} accounts (dryRun=${dryRun})`,
		{ tenantId, action: 'sync_hosting_recurring_start' }
	);

	let created = 0;
	let updated = 0;
	let skipped = 0;
	let noop = 0;
	const errors: Array<{ hostingAccountId: string; domain: string; error: string }> = [];
	const diffs: Array<{ hostingAccountId: string; domain: string } & UpsertDiff> = [];

	for (const acc of accounts) {
		try {
			const result = await upsertRecurringInvoiceForHostingAccount(
				{
					tenantId,
					userId,
					hostingAccountId: acc.id,
					hostingProductId: acc.hostingProductId,
					daPackageId: acc.daPackageId,
					clientId: acc.clientId,
					domain: acc.domain,
					daPackageName: acc.daPackageName,
					recurringAmount: acc.recurringAmount ?? 0,
					currency: acc.currency || 'RON',
					billingCycle: acc.billingCycle || 'monthly',
					status: acc.status,
					startDate: acc.startDate ?? null,
					nextDueDate: acc.nextDueDate ?? null
				},
				{ dryRun }
			);
			diffs.push({ hostingAccountId: acc.id, domain: acc.domain, ...result });
			if (result.action === 'created') created++;
			else if (result.action === 'updated') updated++;
			else if (result.action === 'noop') noop++;
			else skipped++;
		} catch (err) {
			const e = serializeError(err);
			errors.push({ hostingAccountId: acc.id, domain: acc.domain, error: e.message });
			logError(
				'directadmin',
				`Sync-hosting-recurring: failed for account ${acc.id} (${acc.domain}): ${e.message}`,
				{
					tenantId,
					stackTrace: e.stack,
					metadata: { hostingAccountId: acc.id }
				}
			);
		}
	}

	logInfo(
		'directadmin',
		`Sync-hosting-recurring complete (dryRun=${dryRun}): processed=${accounts.length} created=${created} updated=${updated} noop=${noop} skipped=${skipped} errors=${errors.length}`,
		{ tenantId, action: 'sync_hosting_recurring_complete' }
	);

	return json({
		ok: true,
		dryRun,
		processed: accounts.length,
		created,
		updated,
		noop,
		skipped,
		errors,
		diffs
	});
};
