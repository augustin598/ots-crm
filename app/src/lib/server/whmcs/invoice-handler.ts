/**
 * Core business logic for incoming WHMCS invoice events.
 *
 * Lives outside the `+server.ts` handler so it can be unit-tested without a
 * SvelteKit request context. The endpoint file is a thin verify-parse-dispatch
 * wrapper over this module.
 *
 * State machine per whmcs_invoice_sync row:
 *
 *     PENDING ──(created ok)──▶ INVOICE_CREATED ──(paid)──▶ INVOICE_CREATED (paid)
 *                                    │                          │
 *                                    ├──(cancelled)──▶ INVOICE_CREATED (cancelled)
 *                                    │
 *                                    └──(refunded)──▶ DEAD_LETTER (needs_credit_note)
 *
 *     any step failure ──▶ FAILED       any amount mutation ──▶ DEAD_LETTER
 *
 * V1 scope:
 *   - Events handled: created, paid, cancelled.
 *   - `refunded` → DEAD_LETTER with flag `needs_credit_note_creation`.
 *     Automatic credit-note generation is v2 (requires CRM invoice negation
 *     logic we haven't wired yet).
 *   - No auto-push to Keez here. Endpoint stays synchronous + simple.
 *     Keez push will be enqueued from a separate BullMQ worker later,
 *     gated on `integration.enableKeezPush`.
 */
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logInfo, logWarning, logError } from '$lib/server/logger';

import { matchOrCreateClient } from './client-matching';
import { redactAndStringify } from './redact';
import type { WhmcsInvoicePayload, WhmcsMatchType } from './types';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type Tenant = typeof table.tenant.$inferSelect;
export type WhmcsIntegration = typeof table.whmcsIntegration.$inferSelect;

/** Reasons a sync row lands in DEAD_LETTER. Keep stable for admin UI. */
export type DeadLetterReason =
	| 'needs_credit_note_creation'
	| 'amount_mutation_post_create'
	| 'no_admin_user_for_tenant'
	| 'invoice_missing_for_status_update'
	| 'unknown_event';

export type HandlerResult =
	| {
			outcome: 'created';
			invoiceId: string;
			invoiceNumber: string;
			matchType: WhmcsMatchType;
	  }
	| {
			outcome: 'updated';
			invoiceId: string;
			event: 'paid' | 'cancelled';
	  }
	| {
			outcome: 'dedup';
			invoiceId: string | null;
			reason: 'exact_payload_hash';
	  }
	| {
			outcome: 'dead_letter';
			reason: DeadLetterReason;
			detail?: string;
	  };

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/** Major units → minor (cents/bani). */
function toCents(major: number): number {
	return Math.round(major * 100);
}

/** Tax percent → basis points (19% → 1900). Matches existing invoice.taxRate column. */
function taxPercentToBasisPoints(percent: number): number {
	return Math.round(percent * 100);
}

/**
 * First owner/admin user of the tenant — used as `invoice.createdByUserId`
 * for automatically synced invoices. The schema requires a real FK here and
 * the CRM is multi-tenant, so picking a per-tenant admin keeps audit trails
 * attributable. Ordering: owner first, then admin; ties broken by creation
 * time.
 */
export async function getSystemUserIdForTenant(tenantId: string): Promise<string | null> {
	const row = await db
		.select({ userId: table.tenantUser.userId, role: table.tenantUser.role })
		.from(table.tenantUser)
		.where(eq(table.tenantUser.tenantId, tenantId))
		.all();

	const owner = row.find((r) => r.role === 'owner');
	if (owner) return owner.userId;
	const admin = row.find((r) => r.role === 'admin');
	if (admin) return admin.userId;
	return null;
}

/**
 * Pick the invoice series to use. Hosting series wins if configured;
 * otherwise fall back to the default Keez series. If neither, null.
 * The caller combines this with `getNextInvoiceNumberFromPlugin` if an
 * accounting plugin is configured, or falls back to a synthetic number.
 */
export async function pickInvoiceSeries(tenantId: string): Promise<string | null> {
	const settings = await db
		.select({
			keezSeries: table.invoiceSettings.keezSeries,
			keezSeriesHosting: table.invoiceSettings.keezSeriesHosting
		})
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.get();

	if (!settings) return null;
	return settings.keezSeriesHosting?.trim() || settings.keezSeries?.trim() || null;
}

/** Synthetic fallback when no plugin series is configured. */
function fallbackInvoiceNumber(payload: WhmcsInvoicePayload): string {
	return `WHMCS-${payload.whmcsInvoiceId}-${Date.now()}`;
}

/**
 * Deterministic fingerprint of the invoice line items. Used to detect when
 * a subsequent event (paid/cancelled) arrives with modified amounts — which
 * means someone edited the WHMCS invoice after the first sync, and the CRM
 * copy is now stale.
 */
function computeLineItemsHash(items: WhmcsInvoicePayload['items']): string {
	const sorted = [...items]
		.map((i) => ({
			d: i.description,
			q: i.quantity,
			u: i.unitPrice,
			v: i.vatPercent,
			e: i.externalItemId ?? null
		}))
		.sort((a, b) => (a.e ?? '').localeCompare(b.e ?? '') || a.d.localeCompare(b.d));
	const json = JSON.stringify(sorted);
	// Non-cryptographic ok — just need deterministic dedup signal.
	let h = 0;
	for (let i = 0; i < json.length; i++) {
		h = ((h << 5) - h + json.charCodeAt(i)) | 0;
	}
	return h.toString(16);
}

/** Parse ISO YYYY-MM-DD to Date at UTC midnight. Returns null on bad input. */
function parseDateOrNull(iso?: string | null): Date | null {
	if (!iso) return null;
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
	if (!m) return null;
	const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
	return Number.isFinite(d.getTime()) ? d : null;
}

// ─────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────

export interface ProcessInvoiceContext {
	tenant: Tenant;
	integration: WhmcsIntegration;
	payload: WhmcsInvoicePayload;
	payloadHash: string;
	/**
	 * Injection hook: callers (v2) may pre-resolve the invoice number via
	 * getNextInvoiceNumberFromPlugin to avoid Keez round-trips inside the
	 * critical path. When undefined, the handler uses pickInvoiceSeries +
	 * synthetic fallback.
	 */
	nextInvoiceNumber?: string | null;
}

export async function processWhmcsInvoice(
	ctx: ProcessInvoiceContext
): Promise<HandlerResult> {
	const { tenant, payload, payloadHash } = ctx;
	const tenantId = tenant.id;

	// Load any existing sync row for idempotency + amount-mutation guard.
	const existingSync = await db
		.select()
		.from(table.whmcsInvoiceSync)
		.where(
			and(
				eq(table.whmcsInvoiceSync.tenantId, tenantId),
				eq(table.whmcsInvoiceSync.whmcsInvoiceId, payload.whmcsInvoiceId)
			)
		)
		.get();

	// --- 1. Exact-duplicate dedup (same payload hash + terminal state) ---
	if (
		existingSync &&
		existingSync.lastPayloadHash === payloadHash &&
		(existingSync.state === 'INVOICE_CREATED' || existingSync.state === 'KEEZ_PUSHED')
	) {
		return {
			outcome: 'dedup',
			invoiceId: existingSync.invoiceId,
			reason: 'exact_payload_hash'
		};
	}

	// --- 2. Refunded → DEAD_LETTER (v1 manual-review path) ---
	if (payload.event === 'refunded') {
		await upsertSync(existingSync, {
			tenantId,
			whmcsInvoiceId: payload.whmcsInvoiceId,
			state: 'DEAD_LETTER',
			lastEvent: 'refunded',
			lastErrorClass: 'PERMANENT',
			lastErrorMessage: 'needs_credit_note_creation',
			lastPayloadHash: payloadHash,
			payload
		});
		logWarning('whmcs', 'Refund received — flagged DEAD_LETTER for manual credit note', {
			tenantId,
			metadata: { whmcsInvoiceId: payload.whmcsInvoiceId }
		});
		return { outcome: 'dead_letter', reason: 'needs_credit_note_creation' };
	}

	// --- 3. Amount-mutation guard (for paid/cancelled/re-sent created) ---
	if (existingSync && existingSync.state === 'INVOICE_CREATED') {
		const newHash = computeLineItemsHash(payload.items);
		const mutated =
			existingSync.originalTotalHash !== null &&
			existingSync.originalTotalHash !== newHash;

		const totalMutated =
			existingSync.originalAmount !== null &&
			Math.abs((existingSync.originalAmount ?? 0) - payload.total) > 0.005;

		if (mutated || totalMutated) {
			await upsertSync(existingSync, {
				tenantId,
				whmcsInvoiceId: payload.whmcsInvoiceId,
				state: 'DEAD_LETTER',
				lastEvent: payload.event,
				lastErrorClass: 'PERMANENT',
				lastErrorMessage: `amount_mutation_post_create (old=${existingSync.originalAmount}, new=${payload.total})`,
				lastPayloadHash: payloadHash,
				payload
			});
			logError('whmcs', 'Amount mutation after invoice create — DEAD_LETTER', {
				tenantId,
				metadata: {
					whmcsInvoiceId: payload.whmcsInvoiceId,
					originalTotal: existingSync.originalAmount,
					newTotal: payload.total
				}
			});
			return {
				outcome: 'dead_letter',
				reason: 'amount_mutation_post_create',
				detail: `old=${existingSync.originalAmount}, new=${payload.total}`
			};
		}
	}

	// --- 4. Dispatch on event ---
	if (payload.event === 'created') {
		return handleCreated(ctx, existingSync);
	}

	if (payload.event === 'paid' || payload.event === 'cancelled') {
		return handleStatusChange(ctx, existingSync);
	}

	// Unknown event — defensive; types enforce the 4 known values but JS
	// runtime may still receive something unexpected.
	await upsertSync(existingSync, {
		tenantId,
		whmcsInvoiceId: payload.whmcsInvoiceId,
		state: 'DEAD_LETTER',
		lastEvent: payload.event as string,
		lastErrorClass: 'PERMANENT',
		lastErrorMessage: 'unknown_event',
		lastPayloadHash: payloadHash,
		payload
	});
	return { outcome: 'dead_letter', reason: 'unknown_event', detail: payload.event };
}

// ─────────────────────────────────────────────
// Created event
// ─────────────────────────────────────────────

async function handleCreated(
	ctx: ProcessInvoiceContext,
	existingSync: typeof table.whmcsInvoiceSync.$inferSelect | undefined
): Promise<HandlerResult> {
	const { tenant, payload, payloadHash } = ctx;
	const tenantId = tenant.id;

	// Resolve the CRM user that will "own" this invoice in audit trails.
	const systemUserId = await getSystemUserIdForTenant(tenantId);
	if (!systemUserId) {
		await upsertSync(existingSync, {
			tenantId,
			whmcsInvoiceId: payload.whmcsInvoiceId,
			state: 'DEAD_LETTER',
			lastEvent: 'created',
			lastErrorClass: 'PERMANENT',
			lastErrorMessage: 'no_admin_user_for_tenant',
			lastPayloadHash: payloadHash,
			payload
		});
		logError('whmcs', 'No owner/admin user found — cannot create WHMCS invoice', {
			tenantId,
			metadata: { whmcsInvoiceId: payload.whmcsInvoiceId }
		});
		return { outcome: 'dead_letter', reason: 'no_admin_user_for_tenant' };
	}

	// Match or create client
	const match = await matchOrCreateClient(tenantId, payload.client);

	// Resolve invoice number (caller may pre-fetch; otherwise fall back).
	const series = await pickInvoiceSeries(tenantId);
	let invoiceNumber: string;
	if (ctx.nextInvoiceNumber) {
		invoiceNumber = ctx.nextInvoiceNumber;
	} else if (series) {
		invoiceNumber = `${series} ${payload.whmcsInvoiceNumber ?? payload.whmcsInvoiceId}`;
	} else {
		invoiceNumber = fallbackInvoiceNumber(payload);
	}

	const invoiceId = generateId();
	const now = new Date();
	const subtotalCents = toCents(payload.subtotal);
	const taxCents = toCents(payload.tax);
	const totalCents = toCents(payload.total);
	const issueDate = parseDateOrNull(payload.issueDate) ?? now;
	const dueDate = parseDateOrNull(payload.dueDate);

	// Weighted-average VAT rate (basis points). Most WHMCS hosting invoices
	// have a single VAT rate, so the average just echoes the item rate.
	const vatRate =
		payload.items.length > 0
			? taxPercentToBasisPoints(
					payload.items.reduce((a, it) => a + it.vatPercent, 0) / payload.items.length
				)
			: null;

	await db.transaction(async (tx) => {
		await tx.insert(table.invoice).values({
			id: invoiceId,
			tenantId,
			clientId: match.clientId,
			contractId: null,
			projectId: null,
			serviceId: null,
			invoiceNumber,
			status: 'sent',
			amount: subtotalCents,
			taxRate: vatRate,
			taxAmount: taxCents,
			totalAmount: totalCents,
			issueDate,
			dueDate,
			paidDate: null,
			lastEmailSentAt: null,
			lastEmailStatus: null,
			overdueReminderCount: 0,
			lastOverdueReminderAt: null,
			currency: payload.currency || 'RON',
			notes: payload.notes ?? null,
			invoiceSeries: series,
			invoiceCurrency: null,
			paymentTerms: null,
			paymentMethod: payload.paymentMethod ?? null,
			exchangeRate: null,
			vatOnCollection: false,
			isCreditNote: false,
			taxApplicationType: null,
			discountType: null,
			discountValue: null,
			smartbillSeries: null,
			smartbillNumber: null,
			remainingAmount: null,
			keezInvoiceId: null,
			keezExternalId: null,
			keezStatus: null,
			spvId: null,
			externalSource: 'whmcs',
			externalInvoiceId: payload.whmcsInvoiceId,
			externalTransactionId: payload.transactionId ?? null,
			createdByUserId: systemUserId
		});

		if (payload.items.length > 0) {
			const itemNote = payload.transactionId ? `Transaction ID: ${payload.transactionId}` : null;
			await tx.insert(table.invoiceLineItem).values(
				payload.items.map((item) => ({
					id: generateId(),
					invoiceId,
					serviceId: null,
					description: item.description,
					quantity: item.quantity,
					rate: toCents(item.unitPrice),
					amount: toCents(item.quantity * item.unitPrice),
					taxRate: taxPercentToBasisPoints(item.vatPercent),
					discount: null,
					discountType: null,
					note: itemNote,
					currency: payload.currency || 'RON',
					unitOfMeasure: null,
					keezItemExternalId: item.externalItemId ?? null
				}))
			);
		}
	});

	await upsertSync(existingSync, {
		tenantId,
		whmcsInvoiceId: payload.whmcsInvoiceId,
		state: 'INVOICE_CREATED',
		lastEvent: 'created',
		matchType: match.matchType,
		lastPayloadHash: payloadHash,
		invoiceId,
		originalAmount: payload.total,
		originalCurrency: payload.currency,
		originalTotalHash: computeLineItemsHash(payload.items),
		payload
	});

	logInfo('whmcs', 'WHMCS invoice created', {
		tenantId,
		metadata: {
			whmcsInvoiceId: payload.whmcsInvoiceId,
			invoiceId,
			invoiceNumber,
			matchType: match.matchType,
			total: payload.total,
			transactionId: payload.transactionId ?? null
		}
	});

	return { outcome: 'created', invoiceId, invoiceNumber, matchType: match.matchType };
}

// ─────────────────────────────────────────────
// Paid / Cancelled — status transitions on an existing invoice
// ─────────────────────────────────────────────

async function handleStatusChange(
	ctx: ProcessInvoiceContext,
	existingSync: typeof table.whmcsInvoiceSync.$inferSelect | undefined
): Promise<HandlerResult> {
	const { tenant, payload, payloadHash } = ctx;
	const tenantId = tenant.id;
	const event = payload.event as 'paid' | 'cancelled';

	if (!existingSync || !existingSync.invoiceId) {
		// Can happen if WHMCS retries a "paid" event that races the "created"
		// we haven't received yet. Record as FAILED (not DEAD_LETTER) so WHMCS
		// can retry; a re-send of "created" + "paid" later will succeed.
		await upsertSync(existingSync, {
			tenantId,
			whmcsInvoiceId: payload.whmcsInvoiceId,
			state: 'FAILED',
			lastEvent: event,
			lastErrorClass: 'TRANSIENT',
			lastErrorMessage: 'invoice_missing_for_status_update',
			lastPayloadHash: payloadHash,
			payload
		});
		logWarning('whmcs', 'Status event arrived before invoice create — retryable', {
			tenantId,
			metadata: { whmcsInvoiceId: payload.whmcsInvoiceId, event }
		});
		return {
			outcome: 'dead_letter',
			reason: 'invoice_missing_for_status_update'
		};
	}

	const now = new Date();
	await db
		.update(table.invoice)
		.set({
			status: event, // 'paid' | 'cancelled' — both valid invoice.status values
			paidDate: event === 'paid' ? now : null,
			updatedAt: now
		})
		.where(eq(table.invoice.id, existingSync.invoiceId));

	await upsertSync(existingSync, {
		tenantId,
		whmcsInvoiceId: payload.whmcsInvoiceId,
		state: 'INVOICE_CREATED', // terminal for v1 (no Keez push yet)
		lastEvent: event,
		lastPayloadHash: payloadHash,
		invoiceId: existingSync.invoiceId,
		payload
	});

	logInfo('whmcs', `WHMCS invoice ${event}`, {
		tenantId,
		metadata: {
			whmcsInvoiceId: payload.whmcsInvoiceId,
			invoiceId: existingSync.invoiceId
		}
	});

	return { outcome: 'updated', invoiceId: existingSync.invoiceId, event };
}

// ─────────────────────────────────────────────
// Sync-row upsert
// ─────────────────────────────────────────────

interface SyncWriteArgs {
	tenantId: string;
	whmcsInvoiceId: number;
	state: 'PENDING' | 'INVOICE_CREATED' | 'KEEZ_PUSHED' | 'FAILED' | 'DEAD_LETTER';
	lastEvent: string;
	matchType?: WhmcsMatchType;
	lastPayloadHash: string;
	lastErrorClass?: 'TRANSIENT' | 'PERMANENT';
	lastErrorMessage?: string;
	invoiceId?: string;
	originalAmount?: number;
	originalCurrency?: string;
	originalTotalHash?: string;
	payload: WhmcsInvoicePayload;
}

async function upsertSync(
	existing: typeof table.whmcsInvoiceSync.$inferSelect | undefined,
	args: SyncWriteArgs
): Promise<void> {
	const now = new Date();
	const rawPayload = redactAndStringify(args.payload);

	if (existing) {
		await db
			.update(table.whmcsInvoiceSync)
			.set({
				invoiceId: args.invoiceId ?? existing.invoiceId,
				state: args.state,
				lastEvent: args.lastEvent,
				matchType: args.matchType ?? existing.matchType,
				lastPayloadHash: args.lastPayloadHash,
				originalAmount: args.originalAmount ?? existing.originalAmount,
				originalCurrency: args.originalCurrency ?? existing.originalCurrency,
				originalTotalHash: args.originalTotalHash ?? existing.originalTotalHash,
				lastErrorClass: args.lastErrorClass ?? null,
				lastErrorMessage: args.lastErrorMessage ?? null,
				rawPayload,
				processedAt: now
			})
			.where(eq(table.whmcsInvoiceSync.id, existing.id));
	} else {
		await db.insert(table.whmcsInvoiceSync).values({
			id: generateId(),
			tenantId: args.tenantId,
			whmcsInvoiceId: args.whmcsInvoiceId,
			invoiceId: args.invoiceId ?? null,
			state: args.state,
			lastEvent: args.lastEvent,
			matchType: args.matchType ?? null,
			lastPayloadHash: args.lastPayloadHash,
			originalAmount: args.originalAmount ?? null,
			originalCurrency: args.originalCurrency ?? null,
			originalTotalHash: args.originalTotalHash ?? null,
			retryCount: 0,
			lastErrorClass: args.lastErrorClass ?? null,
			lastErrorMessage: args.lastErrorMessage ?? null,
			rawPayload,
			receivedAt: now,
			processedAt: now
		});
	}
}
