import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, isNotNull, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { createKeezClientForTenant } from './factory';
import type { KeezInvoiceHeader } from './client';
import { mapKeezInvoiceToCRM, mapKeezDetailsToLineItems, findOrCreateClientForKeezPartner } from './mapper';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';
import { clearNotificationsByType } from '$lib/server/notifications';
import { classifyKeezError } from './error-classification';
import { reconcileMissingKeezInvoices } from './sync-reconcile';
import { withTursoBusyRetry } from './db-retry';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

// In-memory lock to prevent concurrent syncs per tenant
const activeSyncs = new Set<string>();

/**
 * Parse Keez date format (YYYYMMDD as number or string)
 */
function parseKeezDate(dateValue: string | number | undefined): Date | null {
	if (dateValue === null || dateValue === undefined) {
		return null;
	}

	try {
		if (typeof dateValue === 'number') {
			const dateNum = dateValue;
			if (dateNum >= 10000101 && dateNum <= 99991231) {
				const dateStr = String(dateNum);
				const year = parseInt(dateStr.substring(0, 4), 10);
				const month = parseInt(dateStr.substring(4, 6), 10) - 1;
				const day = parseInt(dateStr.substring(6, 8), 10);
				const date = new Date(year, month, day);
				if (!isNaN(date.getTime()) && date.getFullYear() === year) {
					return date;
				}
			}
			return null;
		}

		const dateStrTrimmed = String(dateValue).trim();
		if (
			!dateStrTrimmed ||
			dateStrTrimmed === 'null' ||
			dateStrTrimmed === 'undefined' ||
			dateStrTrimmed === '0000-00-00'
		) {
			return null;
		}

		const date = new Date(dateStrTrimmed);
		if (!isNaN(date.getTime()) && date.getFullYear() > 1970) {
			return date;
		}
		return null;
	} catch {
		return null;
	}
}

export interface SyncKeezInvoicesResult {
	imported: number;
	updated: number;
	/** Header fingerprint matched CRM, getInvoice() skipped — smart-sync no-op for this row. */
	unchanged: number;
	/** 404 / "nu exista" on Keez — invoice was deleted upstream. */
	skipped: number;
	errors: number;
	/** Pages pulled from Keez during this run (≥1 on success, 0 if the integration was skipped). */
	pagesFetched?: number;
	/** CRM invoices that were marked cancelled because they no longer exist on Keez. */
	reconciledCancelled?: number;
}

/**
 * Smart-sync fingerprint: returns true when the Keez header indicates the
 * invoice has not changed in any way the user can see in CRM, so we can
 * skip the expensive per-invoice getInvoice() call.
 *
 * Compares 4 fields, all normalized to integers (cents / ms timestamp) to
 * avoid float precision pitfalls:
 *   1. status (Draft / Valid / Cancelled)
 *   2. grossAmount → cents
 *   3. remainingAmount → cents
 *   4. dueDate → ms since epoch
 *
 * Trade-off: line-item / note / partner-CUI changes that leave the total and
 * status untouched are invisible. Mitigation is the user-facing "Force re-sync"
 * button which bypasses this check (passes `force: true` down).
 *
 * Exported for unit testing — the per-invoice loop in this file is the only
 * production call site.
 */
export function headerMatchesExisting(
	header: KeezInvoiceHeader,
	existing: typeof table.invoice.$inferSelect
): boolean {
	// Status (trim defensive — Keez occasionally returns trailing spaces)
	if ((header.status ?? '').trim() !== (existing.keezStatus ?? '').trim()) return false;

	// Gross total in cents (integer comparison, no floats)
	const headerGrossCents = Math.round((header.grossAmount ?? 0) * 100);
	if (headerGrossCents !== (existing.totalAmount ?? 0)) return false;

	// Remaining amount in cents
	const headerRemainingCents = Math.round((header.remainingAmount ?? 0) * 100);
	if (headerRemainingCents !== (existing.remainingAmount ?? 0)) return false;

	// Due date — both sides parsed to a ms timestamp (or null). Strict equality.
	const headerDue = parseKeezDate(header.dueDate);
	const headerDueMs = headerDue?.getTime() ?? null;
	const existingDueMs = existing.dueDate?.getTime() ?? null;
	if (headerDueMs !== existingDueMs) return false;

	return true;
}

/**
 * Thrown by the per-invoice loop when 3 consecutive transient errors trip
 * the in-run circuit breaker. Carries a snapshot of progress made so far
 * so callers (manual remote command, scheduler) can surface partial results
 * instead of treating the run as a total loss.
 */
export class KeezSyncAbortedError extends Error {
	constructor(
		public readonly partial: SyncKeezInvoicesResult,
		public readonly cause: unknown
	) {
		super('Keez sync aborted after consecutive transient errors');
		this.name = 'KeezSyncAbortedError';
	}
}

/**
 * Sync invoices from Keez for a specific tenant.
 * Can be called from the scheduler (no request context needed).
 */
export async function syncKeezInvoicesForTenant(
	tenantId: string,
	options?: { offset?: number; count?: number; filter?: string; force?: boolean }
): Promise<SyncKeezInvoicesResult> {
	const result: SyncKeezInvoicesResult = { imported: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0 };

	// Prevent concurrent syncs for same tenant
	if (activeSyncs.has(tenantId)) {
		logWarning('keez', `Sync already in progress for tenant — skipping`, { tenantId });
		return result;
	}
	activeSyncs.add(tenantId);
	try {
		return await _syncKeezInvoicesForTenantInner(tenantId, options, result);
	} finally {
		activeSyncs.delete(tenantId);
	}
}

async function _syncKeezInvoicesForTenantInner(
	tenantId: string,
	options: { offset?: number; count?: number; filter?: string; force?: boolean } | undefined,
	result: SyncKeezInvoicesResult
): Promise<SyncKeezInvoicesResult> {

	// Get integration
	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(
			and(eq(table.keezIntegration.tenantId, tenantId), eq(table.keezIntegration.isActive, true))
		)
		.limit(1);

	if (!integration) {
		return result;
	}

	const keezClient = await createKeezClientForTenant(tenantId, integration);

	// Get tenant owner userId for new invoice imports (createdByUserId is NOT NULL)
	const [tenantOwner] = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(and(eq(table.tenantUser.tenantId, tenantId), eq(table.tenantUser.role, 'owner')))
		.limit(1);
	if (!tenantOwner?.userId) {
		logWarning('keez', `Tenant ${tenantId} has no owner — skipping invoice sync`, { tenantId });
		return result;
	}
	const systemUserId = tenantOwner.userId;

	// Pagination + per-run circuit breaker.
	//
	// Pagination: loop offset += pageSize until we've consumed recordsCount or
	// hit a short page (defensive). Without pagination the seen-set used by
	// the reconcile pass below would only cover one page and we'd false-cancel
	// every invoice on pages 2+.
	//
	// Circuit breaker (consecutiveTransient) lives OUTSIDE the page loop on
	// purpose — a streak of 502s spanning pages should still trip after 3, not
	// reset every page. "Consecutive" really means consecutive: the counter is
	// reset on every successful iteration (each `continue` and the final
	// fall-through), and also on a non-transient error in the catch block.
	// Hard ceiling to prevent runaway pagination if Keez ever returns
	// page after page without honouring offset (would never reach `recordsCount`
	// or short-page exit). At pageSize=500 this is 100k invoices — well above
	// any realistic tenant. Hitting this bound is a bug, log loudly.
	const MAX_PAGES = 200;

	// In-run resilience: when we hit 3 consecutive transient errors, pause briefly
	// and continue rather than aborting and falling back to the cross-run BullMQ
	// retry (30 min delay). 30s × 2 covers most observed Keez nginx flaps (10–60s)
	// without making the user wait too long. Beyond 2 pauses, abort and let
	// handleKeezSyncFailure schedule a proper retry.
	const MAX_IN_RUN_PAUSES = 2;
	const IN_RUN_PAUSE_MS = 30_000;

	const pageSize = options?.count || 500;
	let offset = options?.offset ?? 0;
	let totalRecords: number | null = null;
	const seen = new Set<string>();
	let consecutiveTransient = 0;
	let pausesUsed = 0;
	let pagesFetched = 0;
	// Smart-sync: invoice IDs that matched the header fingerprint and were
	// skipped. We bump their lastSyncedAt in a single batched UPDATE after
	// the pagination loop instead of per-row to avoid 500+ individual writes
	// on a fast sync run.
	const unchangedIds: string[] = [];

	pagination: while (true) {
		if (pagesFetched >= MAX_PAGES) {
			logError('keez', `Pagination MAX_PAGES (${MAX_PAGES}) exceeded — aborting to prevent runaway`, {
				tenantId,
				metadata: { pagesFetched, offset, totalRecords },
			});
			break pagination;
		}
		const response = await keezClient.getInvoices({
			offset,
			count: pageSize,
			filter: options?.filter,
		});
		pagesFetched++;
		totalRecords = response.recordsCount ?? totalRecords;

		logInfo(
			'keez',
			`Sync fetched ${response.data?.length || 0} invoices (recordsCount: ${response.recordsCount}, total: ${response.total ?? 'N/A'}) [${response.first}-${response.last}]`,
			{ tenantId },
		);

		const pageData = response.data || [];
		for (const invoiceHeader of pageData) {
			seen.add(invoiceHeader.externalId);
			try {
			// Check if invoice already exists in CRM
			const [existing] = await db
				.select()
				.from(table.invoice)
				.where(eq(table.invoice.keezExternalId, invoiceHeader.externalId))
				.limit(1);

			// Smart-sync: if the header's status/totals/dueDate match what we
			// already have in CRM, skip the expensive getInvoice() roundtrip.
			// `force: true` (from the UI dropdown "Re-sync complet") bypasses
			// this check and forces a full fetch — escape hatch for the rare
			// case where Keez changed line-items / notes without moving totals.
			if (existing && !options?.force && headerMatchesExisting(invoiceHeader, existing)) {
				unchangedIds.push(existing.id);
				result.unchanged++;
				consecutiveTransient = 0;
				continue;
			}

			// Get full invoice details from Keez
			let keezInvoice;
			try {
				keezInvoice = await keezClient.getInvoice(invoiceHeader.externalId);
			} catch (e) {
				if (e instanceof Error && e.message === 'Not found') {
					logWarning('keez', `Sync skipping invoice ${invoiceHeader.externalId} - not found in Keez`, { tenantId });
					result.skipped++;
					consecutiveTransient = 0;
					continue;
				}
				throw e;
			}

			if (existing) {
				// Update existing invoice with latest data from Keez
				const issueDateSource =
					invoiceHeader.documentDate || invoiceHeader.issueDate || keezInvoice.issueDate;
				const parsedIssueDate = parseKeezDate(issueDateSource);
				const parsedDueDate = parseKeezDate(invoiceHeader.dueDate || keezInvoice.dueDate);

				// Determine status based on Keez status + remainingAmount
				const keezStatus = invoiceHeader.status || keezInvoice.status;
				let invoiceStatus: 'draft' | 'sent' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled' =
					existing.status as any;
				let remainingCents: number | null = null;

				if (keezStatus === 'Cancelled') {
					invoiceStatus = 'cancelled';
				} else if (keezStatus === 'Draft') {
					// Proforma — keep as draft, do NOT mark as paid
					invoiceStatus = 'draft';
				} else if (keezStatus === 'Valid') {
					// Validated fiscal invoice — check remainingAmount
					if (invoiceHeader.remainingAmount !== undefined) {
						remainingCents = Math.round(invoiceHeader.remainingAmount * 100);
						const existingTotal = existing.totalAmount || 0;
						if (remainingCents === 0) {
							invoiceStatus = 'paid';
						} else if (remainingCents > 0 && remainingCents < existingTotal) {
							invoiceStatus = 'partially_paid';
						} else if (remainingCents > 0) {
							const dueDate = parsedDueDate || existing.dueDate;
							invoiceStatus = dueDate && dueDate < new Date() ? 'overdue' : 'sent';
						}
					} else {
						invoiceStatus = 'sent';
					}
				} else if (invoiceHeader.remainingAmount !== undefined) {
					// Fallback for unknown status
					remainingCents = Math.round(invoiceHeader.remainingAmount * 100);
					const existingTotal = existing.totalAmount || 0;
					if (remainingCents === 0 && keezStatus) {
						invoiceStatus = 'paid';
					} else if (remainingCents > 0 && remainingCents < existingTotal) {
						invoiceStatus = 'partially_paid';
					} else if (remainingCents > 0) {
						const dueDate = parsedDueDate || existing.dueDate;
						invoiceStatus = dueDate && dueDate < new Date() ? 'overdue' : 'sent';
					}
				}

				// Calculate totals from Keez — try detail lines first, then invoice-level, then header
				let keezNetAmount = 0;
				let keezVatAmount = 0;
				let keezGrossAmount = 0;
				let keezTaxRate: number | null = null;

				// Use HEADER-level amounts (always RON, even for EUR invoices)
				// Detail-level amounts return EUR for multi-currency invoices (unreliable)
				keezNetAmount = invoiceHeader.netAmount ?? 0;
				keezVatAmount = invoiceHeader.vatAmount ?? 0;
				keezGrossAmount = invoiceHeader.grossAmount ?? 0;

				// Determine currency context
				const invoiceCurrencyCode = keezInvoice?.currencyCode || keezInvoice?.currency || invoiceHeader.currencyCode || invoiceHeader.currency;
				const hasRealExchangeRate = keezInvoice.exchangeRate && keezInvoice.exchangeRate > 1;
				const isNonRonInvoice = invoiceCurrencyCode && invoiceCurrencyCode !== 'RON';
				const detailHasRonBreakdown = !!keezInvoice.invoiceDetails?.[0]?.netAmountCurrency;

				// If EUR invoice has detail-level RON breakdown, use RON amounts from details
				if (isNonRonInvoice && detailHasRonBreakdown) {
					keezNetAmount = 0;
					keezVatAmount = 0;
					keezGrossAmount = 0;
					for (const detail of keezInvoice.invoiceDetails) {
						keezNetAmount += detail.netAmount ?? 0;
						keezVatAmount += detail.vatAmount ?? 0;
						keezGrossAmount += detail.grossAmount ?? 0;
					}
				}

				// Extract tax rate from details
				if (Array.isArray(keezInvoice.invoiceDetails) && keezInvoice.invoiceDetails.length > 0) {
					for (const detail of keezInvoice.invoiceDetails) {
						if (keezTaxRate === null && detail.vatPercent != null) {
							keezTaxRate = detail.vatPercent;
						}
					}
				}

				// Fallback: invoice-level totals if header has no amounts
				if (keezGrossAmount === 0) {
					keezNetAmount = keezInvoice.netAmount ?? keezInvoice.netAmountCurrency ?? 0;
					keezVatAmount = keezInvoice.vatAmount ?? keezInvoice.vatAmountCurrency ?? 0;
					keezGrossAmount = keezInvoice.grossAmount ?? keezInvoice.grossAmountCurrency ?? 0;
				}

				const updateData: any = { updatedAt: new Date(), taxApplicationType: existing.taxApplicationType || 'apply' };

				if (parsedIssueDate) updateData.issueDate = parsedIssueDate;
				if (parsedDueDate) updateData.dueDate = parsedDueDate;
				if (invoiceStatus !== existing.status) updateData.status = invoiceStatus;
				if (invoiceStatus === 'paid' && !existing.paidDate) updateData.paidDate = new Date();
				if (remainingCents !== null) updateData.remainingAmount = remainingCents;
				if (keezStatus && keezStatus !== existing.keezStatus) updateData.keezStatus = keezStatus;

				if (invoiceHeader.series && invoiceHeader.number) {
					const newNumber = `${invoiceHeader.series} ${invoiceHeader.number}`;
					if (newNumber !== existing.invoiceNumber) updateData.invoiceNumber = newNumber;
				}

				// Currency logic:
				// - If EUR invoice has real exchange rate OR detail-level RON amounts → store as RON
				// - If EUR invoice has exchangeRate=1 and no RON breakdown → amounts ARE in EUR
				if (isNonRonInvoice) {
					if (hasRealExchangeRate || detailHasRonBreakdown) {
						updateData.currency = 'RON';
						updateData.invoiceCurrency = invoiceCurrencyCode;
						if (keezInvoice.exchangeRate) {
							updateData.exchangeRate = String(keezInvoice.exchangeRate);
						}
					} else {
						// Amounts are in EUR (no RON conversion available from Keez)
						updateData.currency = invoiceCurrencyCode;
						updateData.invoiceCurrency = null;
						updateData.exchangeRate = null;
					}
				} else {
					if (existing.currency !== 'RON') {
						updateData.currency = 'RON';
					}
				}

				if (keezNetAmount > 0 || keezVatAmount > 0 || keezGrossAmount > 0) {
					const newTotalCents = Math.round(keezGrossAmount * 100);
					if (newTotalCents !== existing.totalAmount) {
						logInfo('keez', `Sync amount update ${existing.invoiceNumber}: ${existing.totalAmount} -> ${newTotalCents} (Keez gross: ${keezGrossAmount})`, { tenantId, metadata: { invoiceId: existing.id, oldAmount: existing.totalAmount, newAmount: newTotalCents } });
					}
					updateData.amount = Math.round(keezNetAmount * 100);
					updateData.taxAmount = Math.round(keezVatAmount * 100);
					updateData.totalAmount = newTotalCents;
				}

				if (keezTaxRate !== null) {
					updateData.taxRate = Math.round(keezTaxRate * 100);
				}

				if (keezInvoice.notes) updateData.notes = keezInvoice.notes;

				// Re-match client using CUI-first logic to fix wrong associations
				if (keezInvoice.partner) {
					const correctClientId = await findOrCreateClientForKeezPartner(
						keezInvoice.partner,
						tenantId
					);
					if (correctClientId && correctClientId !== existing.clientId) {
						updateData.clientId = correctClientId;
						logInfo('keez', `Sync re-matched invoice ${existing.invoiceNumber}: client ${existing.clientId} -> ${correctClientId}`, { tenantId, metadata: { invoiceId: existing.id, oldClientId: existing.clientId, newClientId: correctClientId, cui: keezInvoice.partner.identificationNumber || 'N/A' } });
					}
				}

				// Atomic: header UPDATE + line items DELETE/INSERT in one transaction so
				// a mid-write Turso failure can't leave the invoice partially updated.
				const lineItemsData =
					Array.isArray(keezInvoice.invoiceDetails) && keezInvoice.invoiceDetails.length > 0
						? mapKeezDetailsToLineItems(keezInvoice.invoiceDetails, existing.id)
						: null;

				await withTursoBusyRetry(
					() => db.transaction(async (tx) => {
						await tx.update(table.invoice).set(updateData).where(eq(table.invoice.id, existing.id));
						if (lineItemsData) {
							await tx
								.delete(table.invoiceLineItem)
								.where(eq(table.invoiceLineItem.invoiceId, existing.id));
							if (lineItemsData.length > 0) {
								await tx.insert(table.invoiceLineItem).values(
									lineItemsData.map((item) => ({ ...item, id: generateId() }))
								);
							}
						}
					}),
					{ tenantId, label: `update invoice ${existing.id} + line items` }
				);

				// Update or create sync record
				const [existingSync] = await db
					.select()
					.from(table.keezInvoiceSync)
					.where(eq(table.keezInvoiceSync.invoiceId, existing.id))
					.limit(1);

				if (existingSync) {
					await db
						.update(table.keezInvoiceSync)
						.set({
							keezInvoiceId: invoiceHeader.externalId,
							keezExternalId: invoiceHeader.externalId,
							syncDirection: 'pull',
							syncStatus: 'synced',
							lastSyncedAt: new Date()
						})
						.where(eq(table.keezInvoiceSync.id, existingSync.id));
				} else {
					await db.insert(table.keezInvoiceSync).values({
						id: generateId(),
						invoiceId: existing.id,
						tenantId,
						keezInvoiceId: invoiceHeader.externalId,
						keezExternalId: invoiceHeader.externalId,
						syncDirection: 'pull',
						syncStatus: 'synced',
						lastSyncedAt: new Date()
					});
				}

				result.updated++;
				consecutiveTransient = 0;
				continue;
			}

			// New invoice - find or create client (CUI-first matching)
			let clientId: string | null = null;
			if (keezInvoice.partner) {
				clientId = await findOrCreateClientForKeezPartner(keezInvoice.partner, tenantId);
			}

			if (!clientId) {
				result.skipped++;
				consecutiveTransient = 0;
				continue;
			}

			// Map and create invoice
			const invoiceData = mapKeezInvoiceToCRM(
				keezInvoice,
				invoiceHeader,
				tenantId,
				clientId,
				'' // No user for scheduler-triggered imports
			);

			const invoiceInsertData = invoiceData;
			const invoiceId = generateId();

			const newLineItemsData =
				Array.isArray(keezInvoice.invoiceDetails) && keezInvoice.invoiceDetails.length > 0
					? mapKeezDetailsToLineItems(keezInvoice.invoiceDetails, invoiceId)
					: [];

			// Atomic: invoice INSERT + line items INSERT in one transaction so
			// a mid-write failure can't leave an invoice row with no line items.
			await withTursoBusyRetry(
				() => db.transaction(async (tx) => {
					await tx.insert(table.invoice).values({
						id: invoiceId,
						tenantId: invoiceInsertData.tenantId || tenantId,
						clientId: invoiceInsertData.clientId || clientId,
						invoiceNumber: invoiceInsertData.invoiceNumber || invoiceHeader.externalId,
						status: invoiceInsertData.status || 'sent',
						amount: invoiceInsertData.amount || 0,
						taxRate: invoiceInsertData.taxRate || 1900,
						taxAmount: invoiceInsertData.taxAmount || 0,
						totalAmount: invoiceInsertData.totalAmount || 0,
						currency: invoiceInsertData.currency || 'RON',
						invoiceCurrency: invoiceInsertData.invoiceCurrency || null,
						exchangeRate: invoiceInsertData.exchangeRate || null,
						issueDate: invoiceInsertData.issueDate ?? new Date(),
						dueDate: invoiceInsertData.dueDate ?? null,
						notes: invoiceInsertData.notes || null,
						keezInvoiceId: invoiceInsertData.keezInvoiceId || null,
						keezExternalId: invoiceInsertData.keezExternalId || null,
						keezStatus: invoiceInsertData.keezStatus || null,
						taxApplicationType: 'apply',
						createdByUserId: systemUserId
					});
					if (newLineItemsData.length > 0) {
						await tx.insert(table.invoiceLineItem).values(
							newLineItemsData.map((item) => ({ ...item, id: generateId() }))
						);
					}
				}),
				{ tenantId, label: `atomic create invoice ${invoiceId}` }
			);

			// Create sync record
			await db.insert(table.keezInvoiceSync).values({
				id: generateId(),
				invoiceId,
				tenantId,
				keezInvoiceId: invoiceHeader.externalId,
				keezExternalId: invoiceHeader.externalId,
				syncDirection: 'pull',
				syncStatus: 'synced',
				lastSyncedAt: new Date()
			});

			result.imported++;
			consecutiveTransient = 0;
		} catch (error) {
			const processErr = serializeError(error);
			const classification = classifyKeezError(error);
			// Downgrade transient errors (502/503/504, network) to warning — they're handled
			// by the in-run circuit breaker and cross-run retry, so they're not real failures.
			const logFn = classification === 'transient' ? logWarning : logError;
			logFn('keez', `Sync ${classification} on invoice ${invoiceHeader.externalId}: ${processErr.message}`, { tenantId, stackTrace: processErr.stack });
			result.errors++;

			// On 3 consecutive transient errors: try to ride out the flap in-run
			// with up to MAX_IN_RUN_PAUSES short pauses before falling back to
			// the cross-run BullMQ retry. Empirically, Keez nginx flaps last
			// 10-60s, so 30s × 2 catches most. Skipped invoices come back via
			// upsert idempotency on keezExternalId in the next sync run — no
			// data loss, just delayed by one run.
			if (classification === 'transient') {
				consecutiveTransient++;
				if (consecutiveTransient >= 3) {
					if (pausesUsed < MAX_IN_RUN_PAUSES) {
						pausesUsed++;
						logWarning(
							'keez',
							`Hit ${consecutiveTransient} consecutive transient errors — pausing ${IN_RUN_PAUSE_MS / 1000}s before resuming (pause ${pausesUsed}/${MAX_IN_RUN_PAUSES})`,
							{
								tenantId,
								metadata: {
									offset,
									invoicesProcessed: result.imported + result.updated + result.skipped,
								},
							},
						);
						await new Promise((r) => setTimeout(r, IN_RUN_PAUSE_MS));
						consecutiveTransient = 0;
						continue;
					}
					logWarning(
						'keez',
						`Aborting sync run after ${pausesUsed} in-run pauses + ${consecutiveTransient} consecutive transient errors`,
						{ tenantId },
					);
					throw new KeezSyncAbortedError({ ...result }, error);
				}
			} else {
				consecutiveTransient = 0;
			}
		}
		}

		// Loop exit conditions, in order of safety:
		offset += pageData.length;
		if (pageData.length === 0) break pagination; // empty page → done
		if (pageData.length < pageSize) break pagination; // short page → almost certainly the tail
		if (totalRecords !== null && offset >= totalRecords) break pagination; // counted out
	}

	result.pagesFetched = pagesFetched;

	// Smart-sync: bump lastSyncedAt for all the rows whose header matched.
	// Single batched UPDATE instead of N individual writes — keeps fast-sync
	// wall time low (most invoices land here on a steady-state run).
	if (unchangedIds.length > 0) {
		await db
			.update(table.keezInvoiceSync)
			.set({ lastSyncedAt: new Date() })
			.where(inArray(table.keezInvoiceSync.invoiceId, unchangedIds));
	}

	// Reconcile pass: any CRM invoice whose Keez counterpart we did NOT see
	// in any page, and which Keez confirms is gone (per-invoice getInvoice),
	// is marked cancelled here. This runs only after a successful pagination
	// — if the per-run circuit breaker threw earlier, control never reaches
	// here, so a partial pagination cannot trigger false cancellations.
	const crmKeezBacked = await db
		.select({
			id: table.invoice.id,
			externalId: table.invoice.keezExternalId,
			status: table.invoice.status,
		})
		.from(table.invoice)
		.where(
			and(eq(table.invoice.tenantId, tenantId), isNotNull(table.invoice.keezExternalId)),
		);
	// Only consider drafts. Per app/.claude/skills/keez-api/, Keez allows DELETE
	// solely on draft/proforma — validated invoices can be cancelled but never
	// deleted (they keep appearing in /invoices). So the only realistic source
	// of a "missing on Keez" signal is a user-deleted draft. Excluding the
	// other statuses (sent/paid/partially_paid/overdue) makes the reconcile
	// fail-loud instead of fail-silent if a Keez bug or admin override ever
	// makes a validated invoice appear missing — operator must investigate.
	const candidates = crmKeezBacked
		.filter(
			(r): r is { id: string; externalId: string; status: string } =>
				!!r.externalId && !seen.has(r.externalId) && r.status === 'draft',
		)
		.map((r) => ({ id: r.id, externalId: r.externalId }));

	if (candidates.length > 0) {
		logInfo(
			'keez',
			`Reconcile: ${candidates.length} CRM invoice(s) not seen in this run, verifying individually`,
			{ tenantId },
		);
	}
	const recon = await reconcileMissingKeezInvoices({
		seen,
		candidates,
		// 5 concurrent verifies — safe under Keez's normal rate limits and keeps
		// reconcile time bounded for tenants with many stale drafts (50 stale at
		// concurrency=5 + ~100ms/call ≈ 1s vs 5s serial).
		concurrency: 5,
		getInvoice: (externalId) => keezClient.getInvoice(externalId),
		markCancelled: async (invoiceId) => {
			await db
				.update(table.invoice)
				.set({ status: 'cancelled', updatedAt: new Date() })
				.where(eq(table.invoice.id, invoiceId));
			logWarning('keez', `Reconcile: marked invoice cancelled (no longer on Keez)`, {
				tenantId,
				metadata: { invoiceId },
			});
		},
	});
	result.reconciledCancelled = recon.cancelled;
	if (recon.cancelled > 0 || recon.verified > 0) {
		logInfo(
			'keez',
			`Reconcile complete: verified=${recon.verified} cancelled=${recon.cancelled} skipped=${recon.skipped}`,
			{ tenantId },
		);
	}

	// Successful completion — always update lastSyncAt AND reset failure columns,
	// even for zero-invoice responses. Clearing failure state here is what lets
	// a healthy sync recover from a prior degraded state.
	await db
		.update(table.keezIntegration)
		.set({
			lastSyncAt: new Date(),
			lastFailureAt: null,
			lastFailureReason: null,
			consecutiveFailures: 0,
			isDegraded: false,
			updatedAt: new Date()
		})
		.where(eq(table.keezIntegration.tenantId, tenantId));

	// Clear stale Keez sync error notifications after successful sync
	try {
		await clearNotificationsByType(tenantId, 'keez.sync_error');
	} catch {
		// Don't break sync for notification cleanup errors
	}

	return result;
}
