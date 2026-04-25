/**
 * Pure helpers for pushing CRM invoices to Keez and validating them, callable
 * from contexts WITHOUT a SvelteKit request (webhook handlers, BullMQ workers).
 *
 * These mirror the logic of the syncInvoiceToKeez / validateInvoiceInKeez
 * remote commands in $lib/remotes/keez.remote.ts but accept tenantId as an
 * argument instead of reading event.locals.tenant. The remote commands are
 * thin wrappers that auth-check and delegate here, so behavior stays identical
 * and there's no code duplication.
 *
 * Both functions never throw — they return discriminated-union results and
 * log internally. Caller decides whether to surface errors.
 */
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logError, logInfo, logWarning } from '$lib/server/logger';
import { mapInvoiceToKeez } from './mapper';
import { createKeezClientForTenant } from './factory';

function generateSyncId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export type PushInvoiceResult =
	| { success: true; externalId: string }
	| { success: false; error: string };

export type ValidateInvoiceResult =
	| { success: true }
	| { success: false; error: string };

/**
 * Push a CRM invoice to Keez (creates a Draft / proforma there).
 * Same logic as syncInvoiceToKeez command, minus auth checks. See that
 * command's docstring for behavior detail.
 */
export async function pushInvoiceToKeez(
	tenantId: string,
	invoiceId: string
): Promise<PushInvoiceResult> {
	try {
		// Get invoice
		const [invoice] = await db
			.select()
			.from(table.invoice)
			.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, tenantId)))
			.limit(1);

		if (!invoice) {
			return { success: false, error: 'Invoice not found' };
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, tenantId),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			return { success: false, error: 'Keez integration not connected' };
		}

		// Get invoice settings
		const [settings] = await db
			.select()
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, tenantId))
			.limit(1);

		// Get tenant + client
		const [tenant] = await db
			.select()
			.from(table.tenant)
			.where(eq(table.tenant.id, tenantId))
			.limit(1);
		const [client] = await db
			.select()
			.from(table.client)
			.where(eq(table.client.id, invoice.clientId))
			.limit(1);

		if (!tenant || !client) {
			return { success: false, error: 'Tenant or client not found' };
		}

		// Get line items
		const lineItems = await db
			.select()
			.from(table.invoiceLineItem)
			.where(eq(table.invoiceLineItem.invoiceId, invoiceId));

		// Create Keez client with DB token cache
		const keezClient = await createKeezClientForTenant(tenantId, integration);

		const externalId = invoice.keezExternalId || invoice.id;

		// Ensure all items exist in Keez before creating invoice
		const itemExternalIds = new Map<string, string>();
		const vatPercent = invoice.taxRate ? invoice.taxRate / 100 : 19;
		const currency = invoice.currency || settings?.defaultCurrency || 'RON';

		// Trace entry: snapshot of CRM-side line items *before* we touch Keez.
		// Compare this against the post-fetch trace to see what Keez actually
		// stored vs what we asked for.
		logInfo('keez', `[trace] auto-push starting for invoice ${invoiceId}`, {
			tenantId,
			action: 'whmcs_keez_trace',
			metadata: {
				invoiceId,
				externalId,
				externalSource: invoice.externalSource,
				externalInvoiceId: invoice.externalInvoiceId,
				lineItemCount: lineItems.length,
				lineItems: lineItems.map((li) => ({
					id: li.id,
					description: li.description,
					keezItemExternalIdBefore: li.keezItemExternalId,
					quantity: li.quantity,
					rate: li.rate,
					amount: li.amount,
					taxRate: li.taxRate,
					note: li.note
				}))
			}
		});

		for (const lineItem of lineItems) {
			const desiredName = lineItem.description || 'Item';

			// Strategy: ALWAYS create a fresh Keez article per (invoice, line-item).
			// We do NOT try to match against existing articles, because:
			//   1. Keez `?filter=code eq '...'` is not honored on /items — it
			//      returns the full nomenclator, so getItemByCode would falsely
			//      match the first article (typically `#1 - Realizare Film
			//      Documentar`, externalId `04c73804...`) and the rename branch
			//      would overwrite that article with the current invoice's
			//      description. Every WHMCS push was silently rewriting the
			//      same article. See debug_log filter `whmcs_keez_trace`.
			//   2. Per Keez Public API docs (https://app.keez.ro/help/api/item.html)
			//      `name` MUST be unique across all articles — duplicates throw
			//      HTTP 500. We append the line-item id as a discrete suffix to
			//      guarantee uniqueness without depending on description being
			//      unique (e.g. for repeated test descriptions like FIX-TEST-A).
			//   3. `code` is also unique per (invoice, line-item) so retries on
			//      the same logical line resolve to different articles, which is
			//      acceptable (Keez doesn't bill us per article entry).
			const itemCode = `CRM_${invoiceId.slice(0, 8)}_${lineItem.id.slice(0, 8)}`;
			const uniqueName = `${desiredName} · #${lineItem.id.slice(0, 6)}`;

			let resolvedExternalId: string | null = null;

			try {
				const newItem = await keezClient.createItem({
					code: itemCode,
					name: uniqueName,
					description: lineItem.description || undefined,
					currencyCode: currency,
					measureUnitId: 1,
					vatRate: vatPercent,
					isActive: true,
					categoryExternalId: 'MISCSRV'
				});
				resolvedExternalId = newItem.externalId;
				logInfo('keez', `[trace] createItem succeeded for ${itemCode}`, {
					tenantId,
					action: 'whmcs_keez_trace',
					metadata: {
						invoiceId,
						lineItemId: lineItem.id,
						itemCode,
						sentName: uniqueName,
						sentCurrency: currency,
						sentVatRate: vatPercent,
						returnedExternalId: newItem.externalId
					}
				});
			} catch (itemError) {
				logError('keez', `[trace] createItem FAILED for ${itemCode} — falling back to lineItem.id`, {
					tenantId,
					action: 'whmcs_keez_trace',
					metadata: {
						invoiceId,
						lineItemId: lineItem.id,
						itemCode,
						sentName: uniqueName,
						error: itemError instanceof Error ? itemError.message : String(itemError),
						stack: itemError instanceof Error ? itemError.stack : undefined
					}
				});
				resolvedExternalId = lineItem.id;
			}

			itemExternalIds.set(lineItem.id, resolvedExternalId);

			// Persist the Keez externalId on the CRM line-item row so future
			// queries see the SAME article id Keez has, not the WHMCS-generated
			// MD5 GUID that got there from the inbound payload.
			if (resolvedExternalId && resolvedExternalId !== lineItem.keezItemExternalId) {
				await db
					.update(table.invoiceLineItem)
					.set({ keezItemExternalId: resolvedExternalId })
					.where(eq(table.invoiceLineItem.id, lineItem.id));
			}

			logInfo('keez', `[trace] resolved externalId for lineItem ${lineItem.id}`, {
				tenantId,
				action: 'whmcs_keez_trace',
				metadata: {
					invoiceId,
					lineItemId: lineItem.id,
					itemCode,
					previousKeezItemExternalId: lineItem.keezItemExternalId,
					resolvedExternalId,
					didOverwrite:
						!!resolvedExternalId &&
						resolvedExternalId !== lineItem.keezItemExternalId
				}
			});
		}

		// Resolve series + number from settings (Keez-side getNextInvoiceNumber)
		let invoiceSeries: string | undefined;
		let invoiceNumber: string | undefined;

		if (settings?.keezSeries) {
			invoiceSeries = settings.keezSeries.trim();
			try {
				const nextNumber = await keezClient.getNextInvoiceNumber(invoiceSeries);
				if (nextNumber !== null) {
					invoiceNumber = String(nextNumber);
				} else if (invoice.invoiceNumber) {
					const match = invoice.invoiceNumber.match(/(\d+)$/);
					if (match) invoiceNumber = match[1];
				}
				if (!invoiceNumber && settings.keezStartNumber) {
					invoiceNumber = settings.keezStartNumber;
				}
			} catch (error) {
				logWarning('keez', 'Failed to get next number from Keez, falling back to local', {
					tenantId,
					metadata: { error: error instanceof Error ? error.message : String(error) }
				});
				if (invoice.invoiceNumber) {
					const match = invoice.invoiceNumber.match(/(\d+)$/);
					if (match) invoiceNumber = match[1];
				}
				if (!invoiceNumber && settings.keezStartNumber) {
					invoiceNumber = settings.keezStartNumber;
				}
			}
		}

		// Map and create invoice
		const keezInvoice = await mapInvoiceToKeez(
			{ ...invoice, lineItems },
			client,
			tenant,
			externalId,
			settings,
			itemExternalIds
		);

		if (invoiceSeries && invoiceNumber) {
			keezInvoice.series = invoiceSeries;
			keezInvoice.number = parseInt(invoiceNumber, 10);
		}

		// Trace the EXACT payload we're about to POST to /invoices. The
		// invoiceDetails snapshot is what proves whether the mapper sent the
		// right itemExternalId / itemName per line.
		logInfo('keez', `[trace] createInvoice payload prepared`, {
			tenantId,
			action: 'whmcs_keez_trace',
			metadata: {
				invoiceId,
				externalId: keezInvoice.externalId,
				series: keezInvoice.series,
				number: keezInvoice.number,
				currency: keezInvoice.currencyCode,
				detailsSent: keezInvoice.invoiceDetails.map((d) => ({
					itemExternalId: d.itemExternalId,
					itemName: d.itemName,
					itemDescription: d.itemDescription,
					quantity: d.quantity,
					unitPrice: d.unitPrice,
					vatPercent: d.vatPercent
				}))
			}
		});

		const response = await keezClient.createInvoice(keezInvoice);

		logInfo('keez', `[trace] createInvoice response`, {
			tenantId,
			action: 'whmcs_keez_trace',
			metadata: { invoiceId, returnedExternalId: response.externalId }
		});

		// Fetch back from Keez for canonical data
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let keezInvoiceData: any = null;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let keezInvoiceHeader: any = null;
		try {
			keezInvoiceData = await keezClient.getInvoice(response.externalId);
			try {
				const invoicesList = await keezClient.getInvoices({
					count: 100,
					filter: `externalId eq '${response.externalId}'`
				});
				if (invoicesList.data && invoicesList.data.length > 0) {
					keezInvoiceHeader = invoicesList.data[0];
				}
			} catch {
				/* listError ignored — header is best-effort */
			}
		} catch (error) {
			logWarning('keez', `Could not fetch invoice ${response.externalId} from Keez`, {
				tenantId,
				metadata: { error: error instanceof Error ? error.message : String(error) }
			});
		}

		// Trace what Keez ACTUALLY stored vs what we sent. The critical signal
		// is `externalIdSubstituted` — if Keez swapped the article id we sent
		// for a different one, that's the silent-substitution bug. A pure name
		// drift (sent name is a prefix of stored name) is benign — Keez
		// reflects the article's nomenclator name on the invoice line, and we
		// intentionally append a `· #<lineId6>` suffix to the article name in
		// auto-push for uniqueness, so the stored name is expected to be the
		// sent name + suffix. Only flag drift that isn't this prefix relation.
		if (keezInvoiceData?.invoiceDetails && Array.isArray(keezInvoiceData.invoiceDetails)) {
			const sentDetails = keezInvoice.invoiceDetails;
			const stored = keezInvoiceData.invoiceDetails;
			const comparisons = stored.map((kd: any, idx: number) => {
				const sent = sentDetails[idx];
				const externalIdSubstituted =
					sent && sent.itemExternalId && kd.itemExternalId !== sent.itemExternalId;
				const sentName = sent?.itemName || '';
				const storedName = kd.itemName || '';
				// "Real" drift: stored name doesn't even start with sent name.
				// (sent="Foo", stored="Foo · #abc" → benign suffix; sent="Foo",
				// stored="Bar" → real drift.)
				const nameDrift =
					!!sentName && !!storedName && !storedName.startsWith(sentName);
				return {
					idx,
					sentItemExternalId: sent?.itemExternalId,
					storedItemExternalId: kd.itemExternalId,
					externalIdSubstituted,
					sentItemName: sentName,
					storedItemName: storedName,
					nameDrift,
					storedItemDescription: kd.itemDescription
				};
			});
			const anyRealMismatch = comparisons.some(
				(c: any) => c.externalIdSubstituted || c.nameDrift
			);

			(anyRealMismatch ? logError : logInfo)(
				'keez',
				anyRealMismatch
					? `[trace] MISMATCH detected — Keez substituted itemExternalId or returned an unrelated itemName`
					: `[trace] post-fetch — Keez stored details match what we sent (suffix drift on name is expected)`,
				{
					tenantId,
					action: 'whmcs_keez_trace',
					metadata: {
						invoiceId,
						keezExternalId: response.externalId,
						comparisons
					}
				}
			);
		}

		// Build update payload from Keez response
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const updateData: any = {
			keezInvoiceId: response.externalId,
			keezExternalId: response.externalId,
			updatedAt: new Date()
		};

		const keezSeries = keezInvoiceHeader?.series || keezInvoiceData?.series;
		const keezNumber = keezInvoiceHeader?.number || keezInvoiceData?.number;

		if (keezSeries && keezNumber) {
			const keezInvoiceNumber = `${keezSeries} ${keezNumber}`;
			if (keezInvoiceNumber !== invoice.invoiceNumber) {
				updateData.invoiceNumber = keezInvoiceNumber;
			}
		} else if (keezNumber) {
			const [invoiceSettings] = await db
				.select()
				.from(table.invoiceSettings)
				.where(eq(table.invoiceSettings.tenantId, tenantId))
				.limit(1);
			if (invoiceSettings?.keezSeries) {
				const keezInvoiceNumber = `${invoiceSettings.keezSeries} ${keezNumber}`;
				if (keezInvoiceNumber !== invoice.invoiceNumber) {
					updateData.invoiceNumber = keezInvoiceNumber;
				}
			}
		}

		// Currency normalization
		const keezOriginalCurrency =
			keezInvoiceData?.currencyCode ||
			keezInvoiceData?.currency ||
			keezInvoiceHeader?.currencyCode ||
			keezInvoiceHeader?.currency;
		const pushHasRealExchangeRate =
			keezInvoiceData?.exchangeRate && keezInvoiceData.exchangeRate > 1;
		const pushIsNonRon = keezOriginalCurrency && keezOriginalCurrency !== 'RON';
		const pushDetailHasRonBreakdown = !!keezInvoiceData?.invoiceDetails?.[0]?.netAmountCurrency;

		if (pushIsNonRon) {
			if (pushHasRealExchangeRate || pushDetailHasRonBreakdown) {
				updateData.currency = 'RON';
				updateData.invoiceCurrency = keezOriginalCurrency;
				if (keezInvoiceData?.exchangeRate) {
					updateData.exchangeRate = String(keezInvoiceData.exchangeRate);
				}
			} else {
				updateData.currency = keezOriginalCurrency;
				updateData.invoiceCurrency = null;
				updateData.exchangeRate = null;
			}
		} else if (invoice.currency !== 'RON') {
			updateData.currency = 'RON';
		}

		// Date parsing helper (YYYYMMDD or ISO)
		const parseKeezDate = (dateValue: string | number | undefined): Date | null => {
			if (dateValue === null || dateValue === undefined) return null;
			try {
				if (typeof dateValue === 'number') {
					if (dateValue >= 10000101 && dateValue <= 99991231) {
						const dateStr = String(dateValue);
						const year = parseInt(dateStr.substring(0, 4), 10);
						const month = parseInt(dateStr.substring(4, 6), 10) - 1;
						const day = parseInt(dateStr.substring(6, 8), 10);
						const date = new Date(year, month, day);
						if (!isNaN(date.getTime()) && date.getFullYear() === year) return date;
					}
					return null;
				}
				const trimmed = String(dateValue).trim();
				if (!trimmed || trimmed === 'null' || trimmed === '0000-00-00') return null;
				const date = new Date(trimmed);
				if (!isNaN(date.getTime()) && date.getFullYear() > 1970) return date;
				return null;
			} catch {
				return null;
			}
		};

		const issueDateSource =
			keezInvoiceHeader?.documentDate || keezInvoiceHeader?.issueDate || keezInvoiceData?.issueDate;
		const parsedIssueDate = parseKeezDate(issueDateSource);
		if (parsedIssueDate) updateData.issueDate = parsedIssueDate;

		const dueDateSource = keezInvoiceHeader?.dueDate || keezInvoiceData?.dueDate;
		const parsedDueDate = parseKeezDate(dueDateSource);
		if (parsedDueDate) updateData.dueDate = parsedDueDate;

		// Status from Keez
		const keezStatus = keezInvoiceHeader?.status || keezInvoiceData?.status;
		if (keezStatus) updateData.keezStatus = keezStatus;

		if (keezStatus === 'Cancelled') {
			updateData.status = 'cancelled';
		} else if (keezStatus === 'Draft') {
			updateData.status = 'draft';
		} else if (keezStatus === 'Valid') {
			if (keezInvoiceHeader?.remainingAmount !== undefined) {
				const remainingAmountCents = Math.round(keezInvoiceHeader.remainingAmount * 100);
				updateData.remainingAmount = remainingAmountCents;
				const invoiceTotal = invoice.totalAmount || 0;
				if (remainingAmountCents === 0) {
					updateData.status = 'paid';
					if (!invoice.paidDate) updateData.paidDate = new Date();
				} else if (remainingAmountCents > 0 && remainingAmountCents < invoiceTotal) {
					updateData.status = 'partially_paid';
				} else if (remainingAmountCents > 0) {
					const dueDate = parsedDueDate || invoice.dueDate;
					if (dueDate && dueDate < new Date()) updateData.status = 'overdue';
					else updateData.status = 'sent';
				}
			} else {
				updateData.status = 'sent';
			}
		}

		// Amounts from Keez details
		if (
			keezInvoiceData?.invoiceDetails &&
			Array.isArray(keezInvoiceData.invoiceDetails) &&
			keezInvoiceData.invoiceDetails.length > 0
		) {
			let keezNetAmount = 0;
			let keezVatAmount = 0;
			let keezGrossAmount = 0;
			let keezTaxRate: number | null = null;

			for (const detail of keezInvoiceData.invoiceDetails) {
				keezNetAmount += detail.netAmount ?? 0;
				keezVatAmount += detail.vatAmount ?? 0;
				keezGrossAmount += detail.grossAmount ?? 0;
				if (
					keezTaxRate === null &&
					detail.vatPercent !== undefined &&
					detail.vatPercent !== null
				) {
					keezTaxRate = detail.vatPercent;
				}
			}

			updateData.amount = Math.round(keezNetAmount * 100);
			updateData.taxAmount = Math.round(keezVatAmount * 100);
			updateData.totalAmount = Math.round(keezGrossAmount * 100);
			if (keezTaxRate !== null) updateData.taxRate = Math.round(keezTaxRate * 100);
		}

		// Persist
		await db.update(table.invoice).set(updateData).where(eq(table.invoice.id, invoiceId));

		// Sync record
		const [existingSync] = await db
			.select()
			.from(table.keezInvoiceSync)
			.where(eq(table.keezInvoiceSync.invoiceId, invoiceId))
			.limit(1);

		if (existingSync) {
			await db
				.update(table.keezInvoiceSync)
				.set({
					keezInvoiceId: response.externalId,
					keezExternalId: response.externalId,
					syncStatus: 'synced',
					lastSyncedAt: new Date(),
					updatedAt: new Date()
				})
				.where(eq(table.keezInvoiceSync.id, existingSync.id));
		} else {
			await db.insert(table.keezInvoiceSync).values({
				id: generateSyncId(),
				invoiceId,
				tenantId,
				keezInvoiceId: response.externalId,
				keezExternalId: response.externalId,
				syncDirection: 'push',
				syncStatus: 'synced',
				lastSyncedAt: new Date()
			});
		}

		await db
			.update(table.keezIntegration)
			.set({ lastSyncAt: new Date(), updatedAt: new Date() })
			.where(eq(table.keezIntegration.tenantId, tenantId));

		logInfo('keez', 'Invoice pushed to Keez', {
			tenantId,
			metadata: {
				invoiceId,
				keezExternalId: response.externalId,
				keezStatus: updateData.keezStatus
			}
		});

		return { success: true, externalId: response.externalId };
	} catch (err) {
		logError('keez', 'pushInvoiceToKeez failed', {
			tenantId,
			metadata: {
				invoiceId,
				error: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined
			}
		});
		return { success: false, error: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Validate a Keez Draft → Valid (proforma → fiscal). Auto-triggers WHMCS
 * invoice number push-back if the invoice originated in WHMCS.
 *
 * Mirrors validateInvoiceInKeez command.
 */
export async function validateInvoiceInKeezForTenant(
	tenantId: string,
	invoiceId: string
): Promise<ValidateInvoiceResult> {
	try {
		const [invoice] = await db
			.select()
			.from(table.invoice)
			.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, tenantId)))
			.limit(1);

		if (!invoice) {
			return { success: false, error: 'Invoice not found' };
		}
		if (!invoice.keezExternalId) {
			return { success: false, error: 'Invoice is not synced with Keez' };
		}

		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, tenantId),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			return { success: false, error: 'Keez integration not connected' };
		}

		const keezClient = await createKeezClientForTenant(tenantId, integration);
		await keezClient.validateInvoice(invoice.keezExternalId);

		await db
			.update(table.invoice)
			.set({
				keezStatus: 'Valid',
				status: 'sent',
				updatedAt: new Date()
			})
			.where(eq(table.invoice.id, invoiceId));

		logInfo('keez', 'Invoice validated in Keez', {
			tenantId,
			metadata: { invoiceId, keezExternalId: invoice.keezExternalId }
		});

		// Auto-propagate number back to WHMCS if applicable
		if (invoice.externalSource === 'whmcs' && invoice.externalInvoiceId) {
			void import('$lib/server/whmcs/push-number-to-whmcs').then(
				({ pushInvoiceNumberToWhmcs }) => pushInvoiceNumberToWhmcs(tenantId, invoiceId)
			);
		}

		return { success: true };
	} catch (err) {
		logError('keez', 'validateInvoiceInKeezForTenant failed', {
			tenantId,
			metadata: {
				invoiceId,
				error: err instanceof Error ? err.message : String(err)
			}
		});
		return { success: false, error: err instanceof Error ? err.message : String(err) };
	}
}
