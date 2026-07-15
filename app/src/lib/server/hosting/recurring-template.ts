/**
 * Hosting recurring-template upsert helper.
 *
 * Promoted out of `whmcs-import-da.remote.ts` so it can be called from any code
 * path that creates a `hostingAccount` — WHMCS import, CRM UI, Stripe checkout —
 * without dragging the WHMCS import semantics along.
 *
 * Idempotent: keyed by `hostingAccountId` (one recurring template per account).
 * Re-running is safe: INSERT first time, UPDATE on subsequent calls.
 *
 * Phase 3 additions:
 *  - Hybrid price resolution: when `hostingProductId` is set, prefer the catalog
 *    price (`hostingProduct.price`) unless the account snapshot looks like a
 *    manually-negotiated override.
 *  - Dry-run support: returns `before` / `after` snapshots when {dryRun:true}.
 */

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getLatestBnrRate } from '$lib/server/bnr/client';
import { DEFAULT_VAT_PERCENT } from '$lib/server/vat/rate';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Collapse our wider billing-cycle vocabulary into recurringInvoice's
 * 'monthly'|'yearly' + interval pair.
 */
function cycleToRecurring(
	cycle: string
): { type: 'monthly' | 'yearly'; interval: number } | null {
	switch (cycle) {
		case 'monthly':
			return { type: 'monthly', interval: 1 };
		case 'quarterly':
			return { type: 'monthly', interval: 3 };
		case 'semiannually':
		case 'biannually': // WHMCS-conflated alias (spelled with 'a') — same 6-month cadence
			return { type: 'monthly', interval: 6 };
		case 'annually':
			return { type: 'yearly', interval: 1 };
		case 'biennially':
			return { type: 'yearly', interval: 2 };
		case 'triennially':
			return { type: 'yearly', interval: 3 };
		case 'one_time':
		default:
			return null;
	}
}

export interface UpsertRecurringForHostingArgs {
	tenantId: string;
	userId: string; // createdByUserId for the recurringInvoice row
	hostingAccountId: string;
	hostingProductId?: string | null;
	/**
	 * FK to `daPackage`. Used as the auto-resolution key when `hostingProductId`
	 * is not explicitly set on the hostingAccount: the helper looks up a unique
	 * `hostingProduct` with the same `daPackageId` and treats THAT catalog row
	 * as the source-of-truth price.
	 */
	daPackageId?: string | null;
	clientId: string | null;
	domain: string;
	daPackageName?: string | null;
	recurringAmount: number; // cents (for the cycle, not monthly)
	currency: string;
	billingCycle: string;
	startDate?: Date | string | null;
	nextDueDate?: Date | string | null;
	status: string;
}

export interface TemplateSnapshot {
	amount: number;
	currency: string;
	recurringType: 'monthly' | 'yearly';
	recurringInterval: number;
	taxRateBps: number;
	isActive: boolean;
	lineItemDescription: string;
}

export type PriceSource =
	| 'catalog'
	| 'catalog_converted_via_bnr'
	| 'catalog_via_name_match'
	| 'catalog_via_name_match_bnr';

export interface UpsertDiff {
	action: 'created' | 'updated' | 'skipped' | 'noop';
	reason?: string;
	before?: TemplateSnapshot | null;
	after?: TemplateSnapshot;
	priceSource?: PriceSource;
	healed?: {
		clientId?: { from: string; to: string };
		nextRunDate?: { from: string; to: string };
	};
}

export interface TemplateHeal {
	/** New clientId to write, or null when the existing link is already correct. */
	clientId: string | null;
	/** nextRunDate to write (monotonic guard applied for templates that already generated). */
	nextRunDate: Date;
	changed: boolean;
}

/**
 * Decide how to heal a template's clientId + nextRunDate against the
 * account-derived values.
 *
 * - clientId: the hosting account's client is the source of truth. Templates
 *   created against an import-time duplicate client (no email/CUI) would
 *   otherwise stay wrong forever — the plain UPDATE branch never touched it.
 * - nextRunDate: a template that has NEVER generated snaps to the computed
 *   date (expiry - lead days). One that already generated may only move
 *   FORWARD: the account's next_due_date only advances on payment, so a
 *   backward move would re-bill the cycle the template just invoiced.
 */
export function resolveTemplateHeal(
	existing: { clientId: string; nextRunDate: Date; lastRunDate: Date | null },
	computed: { clientId: string | null; nextRunDate: Date }
): TemplateHeal {
	const clientId =
		computed.clientId && computed.clientId !== existing.clientId ? computed.clientId : null;
	const nextRunDate =
		existing.lastRunDate == null || computed.nextRunDate.getTime() > existing.nextRunDate.getTime()
			? computed.nextRunDate
			: existing.nextRunDate;
	const changed = clientId !== null || nextRunDate.getTime() !== existing.nextRunDate.getTime();
	return { clientId, nextRunDate, changed };
}

/**
 * UPSERT a recurring_invoice row for a hosting account. Wires the hosting
 * service into the CRM's recurring billing engine (scheduler at
 * `scheduler/tasks/recurring-invoices.ts` picks it up).
 *
 * Returns a diff describing what changed (or would change in dryRun mode).
 * Backward-compat callers can check `.action` instead of the old string return.
 */
export async function upsertRecurringInvoiceForHostingAccount(
	args: UpsertRecurringForHostingArgs,
	options?: { dryRun?: boolean }
): Promise<UpsertDiff> {
	const dryRun = options?.dryRun === true;

	if (!args.clientId) return { action: 'skipped', reason: 'no_client' };
	if (args.status === 'terminated' || args.status === 'cancelled') {
		return { action: 'skipped', reason: `status_${args.status}` };
	}
	const cycleMap = cycleToRecurring(args.billingCycle);
	if (!cycleMap) return { action: 'skipped', reason: 'billing_cycle_one_time_or_unknown' };

	// Single source of truth for price: the hosting product catalog
	// (/ots/hosting/products → hostingProduct.price). When the account is billed
	// in a different currency than the catalog (e.g. catalog RON, account EUR
	// for an intracom client), the catalog price is converted to the account's
	// currency using the latest BNR rate. The account's `recurringAmount`
	// snapshot is intentionally NOT used as a price source.
	//
	// Resolution order:
	//   1. `hostingProductId` is set → load that product directly.
	//   2. `hostingProductId` is null BUT `daPackageName` matches a unique
	//      hostingProduct.name (active) → use that product. Persist the link
	//      back to the account so subsequent syncs and the UI see it.
	//   3. Neither resolves → skip.
	let product: { id: string; price: number; currency: string | null } | null = null;
	let resolvedViaNameMatch = false;
	if (args.hostingProductId) {
		const rows = await db
			.select({
				id: table.hostingProduct.id,
				price: table.hostingProduct.price,
				currency: table.hostingProduct.currency
			})
			.from(table.hostingProduct)
			.where(
				and(
					eq(table.hostingProduct.id, args.hostingProductId),
					eq(table.hostingProduct.tenantId, args.tenantId)
				)
			)
			.limit(1);
		product = rows[0] ?? null;
	} else if (args.daPackageId) {
		// Auto-resolve via the daPackage FK. Catalog (hostingProduct) and account
		// (hostingAccount) both reference the same daPackage row when they
		// represent the same DA tier — so a unique catalog row sharing the
		// account's daPackageId is the natural source-of-truth price for that
		// tier (e.g. catalog "Wordpress Pro" sells DA tier "Wordpress_Silver").
		const candidates = await db
			.select({
				id: table.hostingProduct.id,
				price: table.hostingProduct.price,
				currency: table.hostingProduct.currency
			})
			.from(table.hostingProduct)
			.where(
				and(
					eq(table.hostingProduct.tenantId, args.tenantId),
					eq(table.hostingProduct.daPackageId, args.daPackageId)
				)
			);
		if (candidates.length === 1) {
			product = candidates[0];
			resolvedViaNameMatch = true;
		} else if (candidates.length > 1) {
			return {
				action: 'skipped',
				reason: `daPackageId resolves to ${candidates.length} catalog products — ambiguous, link manually`
			};
		}
	}
	if (!product) {
		return {
			action: 'skipped',
			reason: args.hostingProductId
				? 'hosting_product_not_found'
				: args.daPackageId
				? `no_catalog_product_for_da_package${
						args.daPackageName ? `_${args.daPackageName}` : ''
					}`
				: 'no_hosting_product_linked'
		};
	}
	if (!product.price || product.price <= 0) {
		return { action: 'skipped', reason: 'catalog_price_missing_or_zero' };
	}

	const catalogCurrency = (product.currency || 'RON').toUpperCase();
	const accountCurrency = (args.currency || 'RON').toUpperCase();

	let effectiveAmount: number;
	let priceSource: PriceSource;
	let effectiveCurrency: string;

	if (catalogCurrency === accountCurrency) {
		effectiveAmount = product.price;
		effectiveCurrency = catalogCurrency;
		priceSource = resolvedViaNameMatch ? 'catalog_via_name_match' : 'catalog';
	} else {
		// Different currency — convert catalog price via BNR. Routes through RON.
		const convertedCents = await convertCentsViaBnr(
			product.price,
			catalogCurrency,
			accountCurrency
		);
		if (convertedCents === null) {
			return {
				action: 'skipped',
				reason: `bnr_rate_missing_for_${catalogCurrency.toLowerCase()}_to_${accountCurrency.toLowerCase()}`
			};
		}
		effectiveAmount = convertedCents;
		effectiveCurrency = accountCurrency;
		priceSource = resolvedViaNameMatch ? 'catalog_via_name_match_bnr' : 'catalog_converted_via_bnr';
	}

	// Reconcile the account snapshot to the catalog-resolved price so EVERY
	// snapshot-reading surface (panel SUMĂ, client portal, MRR/ARR, the renewal
	// email's fallback path) shows exactly what the customer is billed. Without
	// this, hostingAccount.recurringAmount silently drifts from the catalog — the
	// structural cause of the audit's DRIFT-1/3/4 (H6/M4) findings. We also persist
	// the name-matched product link when one was auto-resolved. Dry-run writes nothing.
	if (!dryRun) {
		const accountPatch: Record<string, unknown> = {
			recurringAmount: effectiveAmount,
			currency: effectiveCurrency,
			updatedAt: new Date()
		};
		if (resolvedViaNameMatch) accountPatch.hostingProductId = product.id;
		await db
			.update(table.hostingAccount)
			.set(accountPatch)
			.where(eq(table.hostingAccount.id, args.hostingAccountId));
	}

	const today = new Date();
	const start = args.startDate
		? args.startDate instanceof Date
			? args.startDate
			: new Date(args.startDate)
		: today;
	// Issue the renewal proforma RENEWAL_LEAD_DAYS before the account expires, so its
	// due date (issue + dueDateOffset=14) lands exactly on the account's next_due_date.
	// This aligns "account expired" with "invoice due" — one date, no drift — and makes
	// the expiry-anchored suspension (model A on the invoice due date) coincide with the
	// account expiry. Keep RENEWAL_LEAD_DAYS == dueDateOffset (14) so due == expiry.
	const RENEWAL_LEAD_DAYS = 14;
	const expiryDate = args.nextDueDate
		? args.nextDueDate instanceof Date
			? args.nextDueDate
			: new Date(args.nextDueDate)
		: null;
	const nextRun =
		expiryDate && !Number.isNaN(expiryDate.getTime())
			? new Date(expiryDate.getTime() - RENEWAL_LEAD_DAYS * 24 * 60 * 60 * 1000)
			: today;
	if (Number.isNaN(start.getTime())) return { action: 'skipped', reason: 'invalid_start_date' };
	if (Number.isNaN(nextRun.getTime())) {
		return { action: 'skipped', reason: 'invalid_next_due_date' };
	}

	// Resolve current package name: caller-supplied wins, else fetch live from hostingAccount.
	let resolvedPackageName: string | null = args.daPackageName ?? null;
	if (!resolvedPackageName) {
		const [ha] = await db
			.select({ daPackageName: table.hostingAccount.daPackageName })
			.from(table.hostingAccount)
			.where(eq(table.hostingAccount.id, args.hostingAccountId))
			.limit(1);
		resolvedPackageName = ha?.daPackageName ?? null;
	}

	// Resolve VAT rate from tenant's invoice settings (never hardcode — Romania VAT
	// changed 19% → 21% in 2025/2026).
	const [vatSettings] = await db
		.select({ defaultTaxRate: table.invoiceSettings.defaultTaxRate })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, args.tenantId))
		.limit(1);
	const taxRatePercent = vatSettings?.defaultTaxRate ?? DEFAULT_VAT_PERCENT;
	const taxRateBps = taxRatePercent * 100;

	const name = resolvedPackageName
		? `Hosting ${args.domain} (${resolvedPackageName})`
		: `Hosting ${args.domain}`;
	const baseDescription = resolvedPackageName
		? `${resolvedPackageName} - ${args.domain}`
		: `Hosting - ${args.domain}`;
	const lineItem = {
		description: baseDescription,
		quantity: 1,
		rate: effectiveAmount / 100,
		taxRate: taxRatePercent,
		currency: effectiveCurrency,
		unitOfMeasure: 'Buc'
	};
	const lineItemsJson = JSON.stringify([lineItem]);

	const afterSnapshot: TemplateSnapshot = {
		amount: effectiveAmount,
		currency: effectiveCurrency,
		recurringType: cycleMap.type,
		recurringInterval: cycleMap.interval,
		taxRateBps,
		isActive: args.status === 'active',
		lineItemDescription: baseDescription
	};

	const [existing] = await db
		.select({
			id: table.recurringInvoice.id,
			clientId: table.recurringInvoice.clientId,
			amount: table.recurringInvoice.amount,
			currency: table.recurringInvoice.currency,
			recurringType: table.recurringInvoice.recurringType,
			recurringInterval: table.recurringInvoice.recurringInterval,
			taxRate: table.recurringInvoice.taxRate,
			isActive: table.recurringInvoice.isActive,
			lineItemsJson: table.recurringInvoice.lineItemsJson,
			nextRunDate: table.recurringInvoice.nextRunDate,
			lastRunDate: table.recurringInvoice.lastRunDate
		})
		.from(table.recurringInvoice)
		.where(eq(table.recurringInvoice.hostingAccountId, args.hostingAccountId))
		.limit(1);

	if (existing) {
		const beforeDescription = parseFirstLineItemDescription(existing.lineItemsJson);
		const beforeSnapshot: TemplateSnapshot = {
			amount: existing.amount,
			currency: existing.currency,
			recurringType: existing.recurringType as 'monthly' | 'yearly',
			recurringInterval: existing.recurringInterval,
			taxRateBps: existing.taxRate,
			isActive: existing.isActive,
			lineItemDescription: beforeDescription ?? ''
		};

		const heal = resolveTemplateHeal(
			{
				clientId: existing.clientId,
				nextRunDate: existing.nextRunDate,
				lastRunDate: existing.lastRunDate
			},
			{ clientId: args.clientId, nextRunDate: nextRun }
		);
		const healedDiff: UpsertDiff['healed'] = heal.changed
			? {
					...(heal.clientId
						? { clientId: { from: existing.clientId, to: heal.clientId } }
						: {}),
					...(heal.nextRunDate.getTime() !== existing.nextRunDate.getTime()
						? {
								nextRunDate: {
									from: existing.nextRunDate.toISOString().slice(0, 10),
									to: heal.nextRunDate.toISOString().slice(0, 10)
								}
							}
						: {})
				}
			: undefined;

		// noop when nothing would change
		if (snapshotsEqual(beforeSnapshot, afterSnapshot) && !heal.changed) {
			return { action: 'noop', before: beforeSnapshot, after: afterSnapshot, priceSource };
		}

		if (!dryRun) {
			await db
				.update(table.recurringInvoice)
				.set({
					name,
					...(heal.clientId ? { clientId: heal.clientId } : {}),
					amount: effectiveAmount,
					taxRate: taxRateBps,
					currency: effectiveCurrency,
					recurringType: cycleMap.type,
					recurringInterval: cycleMap.interval,
					nextRunDate: heal.nextRunDate,
					isActive: args.status === 'active',
					lineItemsJson,
					updatedAt: new Date()
				})
				.where(eq(table.recurringInvoice.id, existing.id));
		}
		return {
			action: 'updated',
			before: beforeSnapshot,
			after: afterSnapshot,
			priceSource,
			healed: healedDiff
		};
	}

	if (!dryRun) {
		await db.insert(table.recurringInvoice).values({
			id: generateId(),
			tenantId: args.tenantId,
			clientId: args.clientId,
			hostingAccountId: args.hostingAccountId,
			name,
			amount: effectiveAmount,
			taxRate: taxRateBps,
			currency: effectiveCurrency,
			recurringType: cycleMap.type,
			recurringInterval: cycleMap.interval,
			startDate: start,
			nextRunDate: nextRun,
			issueDateOffset: 0,
			dueDateOffset: 14,
			lineItemsJson,
			isActive: args.status === 'active',
			createdByUserId: args.userId
		});
	}
	return { action: 'created', before: null, after: afterSnapshot, priceSource };
}

function parseFirstLineItemDescription(json: string | null): string | null {
	if (!json) return null;
	try {
		const parsed = JSON.parse(json);
		if (Array.isArray(parsed) && parsed[0] && typeof parsed[0].description === 'string') {
			return parsed[0].description as string;
		}
	} catch {
		// noop
	}
	return null;
}

function snapshotsEqual(a: TemplateSnapshot, b: TemplateSnapshot): boolean {
	return (
		a.amount === b.amount &&
		a.currency === b.currency &&
		a.recurringType === b.recurringType &&
		a.recurringInterval === b.recurringInterval &&
		a.taxRateBps === b.taxRateBps &&
		a.isActive === b.isActive &&
		a.lineItemDescription === b.lineItemDescription
	);
}

/**
 * Convert `cents` from `fromCurrency` to `toCurrency` using the latest BNR rates.
 * All BNR rates are quoted against RON, so non-RON pairs route through RON.
 *
 * BNR convention: "1 EUR = X RON" (rate=X, multiplier=1). For high-value-coin
 * currencies (JPY, etc.) BNR uses multiplier > 1 but our existing helper
 * `getLatestBnrRate` already normalizes to "1 unit of foreign = N RON", so we
 * can multiply/divide directly.
 *
 * Returns null when any required rate is missing — caller should treat as a
 * fatal sync error rather than fall back to a stale price.
 */
async function convertCentsViaBnr(
	cents: number,
	fromCurrency: string,
	toCurrency: string
): Promise<number | null> {
	const F = fromCurrency.toUpperCase();
	const T = toCurrency.toUpperCase();
	if (F === T) return cents;

	// Step 1: express the amount in RON cents.
	let cents_ron: number;
	if (F === 'RON') {
		cents_ron = cents;
	} else {
		const fromRate = await getLatestBnrRate(F);
		if (!fromRate || fromRate <= 0) return null;
		cents_ron = Math.round(cents * fromRate);
	}

	// Step 2: convert RON cents to target currency cents.
	if (T === 'RON') return cents_ron;
	const toRate = await getLatestBnrRate(T);
	if (!toRate || toRate <= 0) return null;
	return Math.round(cents_ron / toRate);
}
