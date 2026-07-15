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
 *   - `clientId`       : reassign the account to a specific CRM client (id).
 *                        Use either this OR `clientCui`, not both.
 *   - `clientCui`      : reassign by CUI lookup (accepts "39988493" or "RO39988493").
 *                        Resolved against client.cui within this tenant.
 *   - `nextDueDate`    : YYYY-MM-DD. The date the service is paid up to — i.e. when
 *                        the next renewal falls due. Correcting it is common after
 *                        the WHMCS import: WHMCS's own date drifted from what the
 *                        customer actually paid for (a 2-year prepay, a renewal on
 *                        a different anniversary). Also re-anchors the recurring
 *                        template to nextDueDate - 14d, since the schedule exists
 *                        to serve this date; pass `keepSchedule=true` to leave the
 *                        template alone.
 *
 * Returns before/after for the patched row. Refuses to operate on more than
 * one account per call to keep changes auditable.
 *
 * Admin-only.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, or } from 'drizzle-orm';
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
	const clientIdParam = event.url.searchParams.get('clientId');
	const clientCuiParam = event.url.searchParams.get('clientCui');
	const nextDueDateParam = event.url.searchParams.get('nextDueDate');
	const keepSchedule = event.url.searchParams.get('keepSchedule') === 'true';

	if (nextDueDateParam && !/^\d{4}-\d{2}-\d{2}$/.test(nextDueDateParam)) {
		throw error(400, 'nextDueDate must be YYYY-MM-DD');
	}
	if (nextDueDateParam && Number.isNaN(Date.parse(`${nextDueDateParam}T00:00:00Z`))) {
		throw error(400, `nextDueDate "${nextDueDateParam}" is not a real date`);
	}

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

	if (clientIdParam && clientCuiParam) {
		throw error(400, 'Pass either clientId or clientCui, not both');
	}

	let targetClientId: string | null = null;
	let targetClientLabel: string | null = null;
	if (clientIdParam) {
		const [c] = await db
			.select({ id: table.client.id, name: table.client.name, cui: table.client.cui })
			.from(table.client)
			.where(and(eq(table.client.id, clientIdParam), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (!c) throw error(404, `No client with id "${clientIdParam}" in this tenant`);
		targetClientId = c.id;
		targetClientLabel = `${c.name} (CUI ${c.cui ?? '—'})`;
	} else if (clientCuiParam) {
		// Accept "39988493" or "RO39988493" — match against both stored forms.
		const raw = clientCuiParam.trim().toUpperCase();
		const bare = raw.startsWith('RO') ? raw.slice(2) : raw;
		const withPrefix = `RO${bare}`;
		const candidates = await db
			.select({ id: table.client.id, name: table.client.name, cui: table.client.cui })
			.from(table.client)
			.where(
				and(
					eq(table.client.tenantId, tenantId),
					or(eq(table.client.cui, bare), eq(table.client.cui, withPrefix))
				)
			);
		if (candidates.length === 0) {
			throw error(404, `No client with CUI "${clientCuiParam}" in this tenant`);
		}
		if (candidates.length > 1) {
			throw error(
				409,
				`${candidates.length} clients share CUI "${clientCuiParam}" — refusing to patch ambiguous selector`
			);
		}
		targetClientId = candidates[0].id;
		targetClientLabel = `${candidates[0].name} (CUI ${candidates[0].cui ?? '—'})`;
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
	const changes: Record<string, { before: unknown; after: unknown; afterLabel?: string | null }> =
		{};
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
	if (targetClientId !== null && targetClientId !== account.clientId) {
		changes.clientId = {
			before: account.clientId,
			after: targetClientId,
			afterLabel: targetClientLabel
		};
		patch.clientId = targetClientId;
	}
	if (nextDueDateParam && nextDueDateParam !== account.nextDueDate) {
		changes.nextDueDate = { before: account.nextDueDate, after: nextDueDateParam };
		patch.nextDueDate = nextDueDateParam;
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
				recurringAmount: account.recurringAmount,
				clientId: account.clientId,
				nextDueDate: account.nextDueDate
			}
		});
	}

	// Re-anchor the renewal schedule on the corrected due date. The template's
	// nextRunDate exists only to serve nextDueDate (issue 14 days ahead so the
	// proforma falls due exactly on expiry), so a due-date correction that left
	// the old schedule behind would bill on the wrong day. This is an explicit
	// operator correction, so it overrides the monotonic guard in the upsert
	// helper — including moving the schedule backwards.
	const RENEWAL_LEAD_DAYS = 14;
	let scheduleChange: { templateId: string; before: string; after: string } | null = null;
	if (patch.nextDueDate && !keepSchedule) {
		const [tpl] = await db
			.select({ id: table.recurringInvoice.id, nextRunDate: table.recurringInvoice.nextRunDate })
			.from(table.recurringInvoice)
			.where(
				and(
					eq(table.recurringInvoice.hostingAccountId, account.id),
					eq(table.recurringInvoice.tenantId, tenantId)
				)
			)
			.limit(1);
		if (tpl) {
			const anchor = new Date(
				Date.parse(`${patch.nextDueDate}T00:00:00Z`) - RENEWAL_LEAD_DAYS * 86400000
			);
			if (anchor.getTime() !== tpl.nextRunDate.getTime()) {
				scheduleChange = {
					templateId: tpl.id,
					before: tpl.nextRunDate.toISOString().slice(0, 10),
					after: anchor.toISOString().slice(0, 10)
				};
			}
		}
	}

	if (apply) {
		patch.updatedAt = new Date();
		await db
			.update(table.hostingAccount)
			.set(patch)
			.where(
				and(eq(table.hostingAccount.id, account.id), eq(table.hostingAccount.tenantId, tenantId))
			);
		if (scheduleChange) {
			await db
				.update(table.recurringInvoice)
				.set({
					nextRunDate: new Date(`${scheduleChange.after}T00:00:00.000Z`),
					updatedAt: new Date()
				})
				.where(
					and(
						eq(table.recurringInvoice.id, scheduleChange.templateId),
						eq(table.recurringInvoice.tenantId, tenantId)
					)
				);
		}
		logInfo(
			'directadmin',
			`Patched hostingAccount ${account.id} (${account.domain}): ${Object.keys(changes).join(', ')}` +
				(scheduleChange
					? ` · template nextRun ${scheduleChange.before} → ${scheduleChange.after}`
					: ''),
			{ tenantId, metadata: { hostingAccountId: account.id, changes, scheduleChange } }
		);
	}

	return json({
		ok: true,
		apply,
		hostingAccountId: account.id,
		domain: account.domain,
		changes,
		scheduleChange
	});
};
