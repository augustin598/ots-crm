import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { createKeezClientForTenant } from '$lib/server/plugins/keez/factory';
import { KeezClientError } from '$lib/server/plugins/keez/errors';
import { classifyKeezError } from '$lib/server/plugins/keez/error-classification';
import { mapKeezDetailsToLineItems } from '$lib/server/plugins/keez/mapper';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { logInfo, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Probe Keez upstream health independently of the sync engine.
 *
 *   GET ?count=10               — 10 sequential getInvoices(count=1) probes via
 *                                  the real client (with inner retry).
 *   GET ?count=10&raw=true      — same probes but raw fetch (NO inner retry).
 *                                  Reveals the true 502 rate.
 *   GET ?externalId=<uuid>      — probe getInvoice for a specific invoice.
 *   GET ?token=true             — only test the OAuth token endpoint.
 *   GET ?mode=all-invoices       — list ALL invoice externalIds and probe each
 *      [&raw=true]                 one (mirrors what sync does per-invoice).
 *      [&concurrency=N]            Reports the failed probes only (success
 *      [&max=N]                    list would be huge), plus a summary.
 *
 * Admin-only. Tenant-scoped: uses the active Keez integration of `locals.tenant`.
 *
 * This exists because manual sync hits a chain of sync.ts → client.request →
 * upstream and it's hard to tell from the toast whether Keez is actually flaky
 * or whether something in our code amplifies a single hiccup. This endpoint
 * isolates each layer.
 */

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
}

/**
 * Defensive shape check on Keez `externalId` before interpolating into the
 * upstream URL. Keez uses 32-char lowercase hex (no hyphens) — we accept the
 * superset [a-f0-9-]{32,36} so both classic UUIDs and Keez's compact form pass.
 * Rejects any path-traversal attempt (`..`, `/`, ...) outright.
 */
function isValidKeezExternalId(s: string): boolean {
	return /^[a-f0-9-]{32,36}$/i.test(s);
}

interface ProbeResult {
	attempt: number;
	ok: boolean;
	status: number | null;
	durationMs: number;
	classification?: 'transient' | 'permanent';
	errorMessage?: string;
}

function summarize(results: ProbeResult[]) {
	const total = results.length;
	const ok = results.filter((r) => r.ok).length;
	const failed = total - ok;
	const transient = results.filter((r) => r.classification === 'transient').length;
	const permanent = results.filter((r) => r.classification === 'permanent').length;
	const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
	const p50 = durations[Math.floor(durations.length * 0.5)] ?? 0;
	const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0;
	const max = durations[durations.length - 1] ?? 0;
	return {
		total,
		ok,
		failed,
		successRate: total > 0 ? Number((ok / total).toFixed(3)) : 0,
		transient,
		permanent,
		latencyMs: { p50, p95, max },
	};
}

async function singleRawProbe(
	baseUrl: string,
	clientEid: string,
	token: string,
	endpoint: string,
	attempt: number,
): Promise<ProbeResult> {
	const start = performance.now();
	try {
		const res = await fetch(`${baseUrl}/${clientEid}${endpoint}`, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${token}`,
			},
			signal: AbortSignal.timeout(15_000),
		});
		const duration = Math.round(performance.now() - start);
		if (res.ok) {
			return { attempt, ok: true, status: res.status, durationMs: duration };
		}
		const body = await res.text().catch(() => '');
		const fakeErr = new KeezClientError(`HTTP ${res.status}`, res.status);
		return {
			attempt,
			ok: false,
			status: res.status,
			durationMs: duration,
			classification: classifyKeezError(fakeErr),
			errorMessage: body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200),
		};
	} catch (err) {
		const duration = Math.round(performance.now() - start);
		return {
			attempt,
			ok: false,
			status: null,
			durationMs: duration,
			classification: classifyKeezError(err),
			errorMessage: err instanceof Error ? err.message.slice(0, 200) : String(err),
		};
	}
}

async function probeRaw(
	baseUrl: string,
	clientEid: string,
	token: string,
	endpoint: string,
	attempts: number,
): Promise<ProbeResult[]> {
	const out: ProbeResult[] = [];
	for (let i = 1; i <= attempts; i++) {
		out.push(await singleRawProbe(baseUrl, clientEid, token, endpoint, i));
	}
	return out;
}

/**
 * Probe ALL invoices for the tenant individually. Mirrors what sync.ts does:
 * for each invoiceHeader in the paginated list, hit getInvoice(externalId).
 *
 * Concurrency is limited to avoid hammering Keez beyond what sync would do
 * (sync is serial). Default 5 keeps total wall time reasonable for ~500-600
 * invoices while staying gentle on the upstream.
 */
async function probeAllInvoices(
	client: import('$lib/server/plugins/keez/client').KeezClient,
	token: string,
	concurrency: number,
	max: number,
	raw: boolean,
): Promise<{ externalIds: string[]; results: ProbeResult[]; pagesFetched: number }> {
	// 1. Walk pagination to collect every externalId.
	const externalIds: string[] = [];
	let offset = 0;
	const pageSize = 500;
	let pagesFetched = 0;
	const MAX_PAGES = 20; // 10k invoices ceiling — defensive
	while (pagesFetched < MAX_PAGES) {
		const page = await client.getInvoices({ offset, count: pageSize });
		pagesFetched++;
		const data = page.data || [];
		for (const h of data) {
			externalIds.push(h.externalId);
			if (externalIds.length >= max) break;
		}
		if (externalIds.length >= max) break;
		if (data.length === 0 || data.length < pageSize) break;
		offset += data.length;
	}

	// 2. Probe each externalId, with bounded concurrency.
	const results: ProbeResult[] = new Array(externalIds.length);
	let nextIdx = 0;
	async function worker() {
		while (true) {
			const idx = nextIdx++;
			if (idx >= externalIds.length) return;
			const externalId = externalIds[idx];
			if (raw) {
				results[idx] = await singleRawProbe(
					client.baseUrl,
					client.clientEid,
					token,
					`/invoices/${externalId}`,
					idx + 1,
				);
			} else {
				const start = performance.now();
				try {
					await client.getInvoice(externalId);
					results[idx] = {
						attempt: idx + 1,
						ok: true,
						status: 200,
						durationMs: Math.round(performance.now() - start),
					};
				} catch (err) {
					const duration = Math.round(performance.now() - start);
					const status = err instanceof KeezClientError ? err.status : null;
					results[idx] = {
						attempt: idx + 1,
						ok: false,
						status,
						durationMs: duration,
						classification: classifyKeezError(err),
						errorMessage: err instanceof Error ? err.message.slice(0, 200) : String(err),
					};
				}
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, externalIds.length) }, worker));
	return { externalIds, results, pagesFetched };
}

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	const tenantId = event.locals.tenant!.id;

	const count = Math.min(50, Math.max(1, Number(event.url.searchParams.get('count') ?? '5')));
	const raw = event.url.searchParams.get('raw') === 'true';
	const externalId = event.url.searchParams.get('externalId');
	const tokenOnly = event.url.searchParams.get('token') === 'true';
	const mode = event.url.searchParams.get('mode');

	// Inspect a single CRM invoice + probe Keez upstream to confirm whether it
	// still exists there. Returns the invoice number (so the operator can search
	// it in the Keez UI), Keez status, and counts of every related row that
	// would be affected by a delete. No side-effects.
	if (mode === 'lookup-invoice') {
		const invoiceId = event.url.searchParams.get('invoiceId');
		if (!invoiceId) throw error(400, 'invoiceId query param is required');
		if (!/^[a-z0-9]{20,32}$/i.test(invoiceId)) {
			throw error(400, 'invoiceId must be a CRM id (20-32 alphanumeric chars)');
		}

		const [inv] = await db
			.select()
			.from(table.invoice)
			.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, tenantId)))
			.limit(1);
		if (!inv) {
			return json({ ok: false, found: false, reason: 'invoice not found in this tenant' }, { status: 404 });
		}

		const [client_] = inv.clientId
			? await db
				.select({ id: table.client.id, name: table.client.name, cui: table.client.cui })
				.from(table.client)
				.where(eq(table.client.id, inv.clientId))
				.limit(1)
			: [null];

		const lineItems = await db
			.select({ id: table.invoiceLineItem.id, description: table.invoiceLineItem.description, amount: table.invoiceLineItem.amount })
			.from(table.invoiceLineItem)
			.where(eq(table.invoiceLineItem.invoiceId, inv.id));

		const keezSyncs = await db
			.select({ id: table.keezInvoiceSync.id, syncStatus: table.keezInvoiceSync.syncStatus, lastSyncedAt: table.keezInvoiceSync.lastSyncedAt })
			.from(table.keezInvoiceSync)
			.where(eq(table.keezInvoiceSync.invoiceId, inv.id));

		const bankMatches = await db
			.select({ id: table.bankTransaction.id, amount: table.bankTransaction.amount, date: table.bankTransaction.date })
			.from(table.bankTransaction)
			.where(eq(table.bankTransaction.matchedInvoiceId, inv.id));

		// Probe Keez upstream — distinguishes "Keez says it doesn't exist" (safe to delete)
		// from "Keez is down right now" (don't delete; could be transient).
		// Per memory: Keez returns 400 VALIDATION_ERROR with "nu exista" for deleted invoices, NOT 404.
		let keezProbe: {
			attempted: boolean;
			exists?: boolean;
			status?: number | null;
			classification?: 'transient' | 'permanent' | 'missing';
			errorMessage?: string;
		} = { attempted: false };
		if (inv.keezExternalId) {
			const [integration] = await db
				.select()
				.from(table.keezIntegration)
				.where(and(eq(table.keezIntegration.tenantId, tenantId), eq(table.keezIntegration.isActive, true)))
				.limit(1);
			if (integration) {
				try {
					const c = await createKeezClientForTenant(tenantId, integration);
					await c.getInvoice(inv.keezExternalId);
					keezProbe = { attempted: true, exists: true, status: 200, classification: 'permanent' };
				} catch (err) {
					const status = err instanceof KeezClientError ? err.status : null;
					const msg = err instanceof Error ? err.message : String(err);
					const looksMissing =
						status === 404 ||
						(status === 400 && /VALIDATION_ERROR|nu exista/i.test(msg));
					keezProbe = {
						attempted: true,
						exists: looksMissing ? false : undefined,
						status,
						classification: looksMissing ? 'missing' : classifyKeezError(err),
						errorMessage: msg.slice(0, 300)
					};
				}
			}
		}

		return json({
			ok: true,
			invoice: {
				id: inv.id,
				number: inv.invoiceNumber,
				status: inv.status,
				keezStatus: inv.keezStatus,
				keezInvoiceId: inv.keezInvoiceId,
				keezExternalId: inv.keezExternalId,
				amount: inv.amount,
				totalAmount: inv.totalAmount,
				currency: inv.currency,
				issueDate: inv.issueDate,
				dueDate: inv.dueDate,
				createdAt: inv.createdAt
			},
			client: client_,
			counts: {
				lineItems: lineItems.length,
				keezInvoiceSyncs: keezSyncs.length,
				bankTransactionMatches: bankMatches.length
			},
			lineItems,
			keezSyncs,
			bankMatches,
			keezProbe,
			deleteSafetyHint: keezProbe.exists === false
				? 'Keez confirms the invoice no longer exists upstream — safe to delete.'
				: keezProbe.exists === true
					? 'Keez says the invoice DOES exist — DO NOT delete; investigate why sync fails.'
					: 'Keez probe inconclusive (transient or no integration). Try again later before deleting.'
		});
	}
	const concurrency = Math.min(
		20,
		Math.max(1, Number(event.url.searchParams.get('concurrency') ?? '5')),
	);
	const maxInvoices = Math.min(
		10000,
		Math.max(1, Number(event.url.searchParams.get('max') ?? '1000')),
	);

	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(
			and(eq(table.keezIntegration.tenantId, tenantId), eq(table.keezIntegration.isActive, true)),
		)
		.limit(1);
	if (!integration) {
		return json(
			{ ok: false, reason: 'no active keez integration for this tenant' },
			{ status: 404 },
		);
	}

	const startedAt = new Date().toISOString();
	const client = await createKeezClientForTenant(tenantId, integration);

	// 1. Token probe
	const tokenStart = performance.now();
	let token: string;
	try {
		token = await client.getAccessToken();
	} catch (err) {
		return json({
			ok: false,
			startedAt,
			tokenProbe: {
				ok: false,
				durationMs: Math.round(performance.now() - tokenStart),
				error: err instanceof Error ? err.message : String(err),
			},
		});
	}
	const tokenProbe = {
		ok: true,
		durationMs: Math.round(performance.now() - tokenStart),
		tokenLength: token.length,
	};

	if (tokenOnly) {
		return json({ ok: true, startedAt, tokenProbe });
	}

	// 2a. ALL-invoices mode: list every externalId, probe each one.
	if (mode === 'all-invoices') {
		const wallStart = performance.now();
		const { externalIds, results, pagesFetched } = await probeAllInvoices(
			client,
			token,
			concurrency,
			maxInvoices,
			raw,
		);
		const summary = summarize(results);
		const failures = results.filter((r) => !r.ok);
		// Map failed indices back to externalId so we can act on them.
		const failuresByExternalId = failures.map((r) => ({
			...r,
			externalId: externalIds[r.attempt - 1],
		}));
		return json({
			ok: true,
			startedAt,
			mode: raw ? 'all-invoices-raw' : 'all-invoices-via-client',
			note: raw
				? 'Each invoice probed via raw fetch (no inner retry). Reveals the true per-invoice 502 rate.'
				: 'Each invoice probed via client (with inner 3x retry). Mirrors sync behavior exactly.',
			tokenProbe,
			pagesFetched,
			invoicesTotal: externalIds.length,
			concurrency,
			wallClockMs: Math.round(performance.now() - wallStart),
			summary,
			// Only failures in the response (success list of 555 entries is noise).
			failures: failuresByExternalId,
		});
	}

	// 2b. Single-invoice probe (most useful when sync fails on a specific invoice)
	if (externalId) {
		if (!isValidKeezExternalId(externalId)) {
			throw error(400, 'externalId must be 32-36 lowercase hex chars (UUID-like)');
		}
		const single = await probeRaw(
			client.baseUrl,
			client.clientEid,
			token,
			`/invoices/${externalId}`,
			count,
		);
		return json({
			ok: true,
			startedAt,
			mode: raw ? 'raw' : 'single-invoice',
			tokenProbe,
			externalId,
			results: single,
			summary: summarize(single),
		});
	}

	// 3. Sequential getInvoices probes
	if (raw) {
		const results = await probeRaw(
			client.baseUrl,
			client.clientEid,
			token,
			'/invoices?count=1',
			count,
		);
		return json({
			ok: true,
			startedAt,
			mode: 'raw-list',
			note: 'Raw fetch — bypasses inner-client retry. Reveals true upstream 502 rate.',
			tokenProbe,
			results,
			summary: summarize(results),
		});
	}

	// Via real client (with inner 3x retry + backoff). Closer to sync behavior.
	const results: ProbeResult[] = [];
	for (let i = 1; i <= count; i++) {
		const start = performance.now();
		try {
			await client.getInvoices({ count: 1 });
			results.push({
				attempt: i,
				ok: true,
				status: 200,
				durationMs: Math.round(performance.now() - start),
			});
		} catch (err) {
			const duration = Math.round(performance.now() - start);
			const status = err instanceof KeezClientError ? err.status : null;
			results.push({
				attempt: i,
				ok: false,
				status,
				durationMs: duration,
				classification: classifyKeezError(err),
				errorMessage: err instanceof Error ? err.message.slice(0, 200) : String(err),
			});
		}
	}

	return json({
		ok: true,
		startedAt,
		mode: 'client-list',
		note: 'Via client (inner 3x retry). Each failed attempt = 9 raw upstream calls already exhausted.',
		tokenProbe,
		results,
		summary: summarize(results),
	});
};

/**
 * Repair an invoice whose line items got wiped or never inserted (e.g. Turso
 * write-lock during sync). Re-fetches the full invoice from Keez, deletes any
 * surviving line items, and inserts fresh ones — atomically, with busy-retry.
 *
 *   POST ?mode=relink-line-items&invoiceId=<crm-invoice-id>
 *
 * Idempotent: safe to run repeatedly. Operates only on the tenant's own invoice.
 */
export const POST: RequestHandler = async (event) => {
	requireAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const mode = event.url.searchParams.get('mode');

	if (mode !== 'relink-line-items') {
		throw error(400, 'Unsupported POST mode. Use ?mode=relink-line-items&invoiceId=...');
	}

	const invoiceId = event.url.searchParams.get('invoiceId');
	if (!invoiceId) throw error(400, 'invoiceId query param is required');
	if (!/^[a-z0-9]{20,32}$/i.test(invoiceId)) {
		throw error(400, 'invoiceId must be a CRM id (20-32 alphanumeric chars)');
	}

	const [invoice] = await db
		.select({
			id: table.invoice.id,
			tenantId: table.invoice.tenantId,
			keezExternalId: table.invoice.keezExternalId
		})
		.from(table.invoice)
		.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, tenantId)))
		.limit(1);
	if (!invoice) throw error(404, 'Invoice not found in this tenant');
	if (!invoice.keezExternalId) {
		throw error(400, 'Invoice has no keezExternalId — nothing to re-fetch from Keez');
	}

	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(
			and(eq(table.keezIntegration.tenantId, tenantId), eq(table.keezIntegration.isActive, true))
		)
		.limit(1);
	if (!integration) throw error(404, 'No active Keez integration for this tenant');

	const client = await createKeezClientForTenant(tenantId, integration);
	const keezInvoice = await client.getInvoice(invoice.keezExternalId);
	const details = keezInvoice.invoiceDetails ?? [];
	const lineItemsData = mapKeezDetailsToLineItems(details, invoice.id);

	const beforeCount = await db
		.select({ id: table.invoiceLineItem.id })
		.from(table.invoiceLineItem)
		.where(eq(table.invoiceLineItem.invoiceId, invoice.id));

	try {
		await withTursoBusyRetry(
			() =>
				db.transaction(async (tx) => {
					await tx
						.delete(table.invoiceLineItem)
						.where(eq(table.invoiceLineItem.invoiceId, invoice.id));
					if (lineItemsData.length > 0) {
						await tx.insert(table.invoiceLineItem).values(
							lineItemsData.map((item) => ({
								...item,
								id: encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)))
							}))
						);
					}
				}),
			{ tenantId, label: `relink line items for invoice ${invoice.id}` }
		);
	} catch (err) {
		const e = serializeError(err);
		throw error(500, `Re-link failed: ${e.message}`);
	}

	logInfo('keez', `Relinked line items for invoice ${invoice.id}`, {
		tenantId,
		metadata: {
			before: beforeCount.length,
			after: lineItemsData.length,
			keezExternalId: invoice.keezExternalId
		}
	});

	return json({
		ok: true,
		invoiceId: invoice.id,
		keezExternalId: invoice.keezExternalId,
		lineItemsBefore: beforeCount.length,
		lineItemsAfter: lineItemsData.length
	});
};
