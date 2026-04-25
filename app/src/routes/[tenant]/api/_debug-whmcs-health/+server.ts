/**
 * Operational health probe for the WHMCS integration. Admin-only, tenant-scoped.
 *
 * The WHMCS pipeline is mostly inbound (WHMCS pushes to us), so this endpoint
 * gathers signals from three boundaries:
 *
 *   1. Sync queue state — counts + samples of in-flight / retrying / failed
 *      rows in whmcs_invoice_sync. Lets ops spot a backlog at a glance.
 *
 *   2. WHMCS push-back round-trip — POST a signed callback.php probe (echo
 *      mode supplied by the addon) and measure latency. Confirms HMAC clocks
 *      are aligned and the addon is reachable. Falls back gracefully when the
 *      addon doesn't expose an echo endpoint (older versions).
 *
 *   3. BullMQ retry queue — count of whmcs-keez-push-retry-* jobs, so ops can
 *      tell "DB says 50 invoices retrying, but 0 jobs scheduled" → ghost state.
 *
 * Usage:
 *   GET                                   default summary
 *   GET ?mode=summary                     same
 *   GET ?mode=callback                    only the HMAC round-trip probe
 *   GET ?mode=queue                       only sync-row + BullMQ counts
 *   GET ?mode=stuck&minutes=N             rows stuck in 'in_flight' >N min
 *   GET ?syncId=<id>                      deep inspect one sync row
 *   GET ?invoiceId=<id>&action=trigger    manually re-enqueue a push (delay=0)
 *
 * Why this lives in a separate endpoint from /api/webhooks/whmcs/health:
 * /health is the WHMCS-side connectivity self-test (called by the addon).
 * This endpoint inspects OUR state — it's for humans diagnosing OUR pipeline.
 */
import { json, error } from '@sveltejs/kit';
import { and, count, desc, eq, gt, isNotNull, lt } from 'drizzle-orm';

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { decrypt } from '$lib/server/plugins/smartbill/crypto';
import { buildSignedHeaders } from '$lib/server/whmcs/hmac';
import type { RequestHandler } from './$types';

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
}

interface QueueSummary {
	totalRows: number;
	byState: Record<string, number>;
	byKeezPushStatus: Record<string, number>;
	scheduledRetryCount: number;
	scheduledRetryNext: { invoiceId: string | null; whmcsInvoiceId: number; nextRetryAt: string }[];
	bullmqQueue: {
		ok: boolean;
		pendingPushRetryJobs: number;
		error?: string;
	};
}

async function buildQueueSummary(tenantId: string): Promise<QueueSummary> {
	// State histogram in ONE query (LEFT-side aggregation).
	const stateRows = await db
		.select({
			state: table.whmcsInvoiceSync.state,
			n: count()
		})
		.from(table.whmcsInvoiceSync)
		.where(eq(table.whmcsInvoiceSync.tenantId, tenantId))
		.groupBy(table.whmcsInvoiceSync.state);

	const byState: Record<string, number> = {};
	let totalRows = 0;
	for (const r of stateRows) {
		byState[r.state ?? 'NULL'] = r.n;
		totalRows += r.n;
	}

	// keezPushStatus histogram
	const pushRows = await db
		.select({
			status: table.whmcsInvoiceSync.keezPushStatus,
			n: count()
		})
		.from(table.whmcsInvoiceSync)
		.where(eq(table.whmcsInvoiceSync.tenantId, tenantId))
		.groupBy(table.whmcsInvoiceSync.keezPushStatus);

	const byKeezPushStatus: Record<string, number> = {};
	for (const r of pushRows) {
		byKeezPushStatus[r.status ?? 'idle'] = r.n;
	}

	// Scheduled retries (rows with nextRetryAt > now)
	const now = new Date();
	const scheduled = await db
		.select({
			invoiceId: table.whmcsInvoiceSync.invoiceId,
			whmcsInvoiceId: table.whmcsInvoiceSync.whmcsInvoiceId,
			nextRetryAt: table.whmcsInvoiceSync.nextRetryAt
		})
		.from(table.whmcsInvoiceSync)
		.where(
			and(
				eq(table.whmcsInvoiceSync.tenantId, tenantId),
				isNotNull(table.whmcsInvoiceSync.nextRetryAt),
				gt(table.whmcsInvoiceSync.nextRetryAt, now)
			)
		)
		.orderBy(table.whmcsInvoiceSync.nextRetryAt)
		.limit(10);

	// BullMQ retry-job count (best-effort; isolate failures so DB summary still
	// returns even if Redis is down).
	let bullmq: QueueSummary['bullmqQueue'] = {
		ok: true,
		pendingPushRetryJobs: 0
	};
	try {
		const { schedulerQueue } = await import('$lib/server/scheduler');
		const delayed = await schedulerQueue.getDelayed(0, 1000);
		bullmq.pendingPushRetryJobs = delayed.filter(
			(j: { id?: string | null }) =>
				typeof j.id === 'string' && j.id.startsWith(`whmcs-keez-push-retry-${tenantId}-`)
		).length;
	} catch (err) {
		bullmq = {
			ok: false,
			pendingPushRetryJobs: 0,
			error: err instanceof Error ? err.message : String(err)
		};
	}

	return {
		totalRows,
		byState,
		byKeezPushStatus,
		scheduledRetryCount: scheduled.length,
		scheduledRetryNext: scheduled.map((r) => ({
			invoiceId: r.invoiceId,
			whmcsInvoiceId: r.whmcsInvoiceId,
			nextRetryAt: r.nextRetryAt!.toISOString()
		})),
		bullmqQueue: bullmq
	};
}

interface CallbackProbeResult {
	ok: boolean;
	status: number | null;
	durationMs: number;
	bodyExcerpt?: string;
	error?: string;
}

async function probeWhmcsCallback(
	tenantId: string,
	tenantSlug: string
): Promise<CallbackProbeResult> {
	const start = performance.now();
	try {
		const [integration] = await db
			.select({
				whmcsUrl: table.whmcsIntegration.whmcsUrl,
				sharedSecret: table.whmcsIntegration.sharedSecret
			})
			.from(table.whmcsIntegration)
			.where(eq(table.whmcsIntegration.tenantId, tenantId))
			.limit(1);

		if (!integration) {
			return { ok: false, status: null, durationMs: 0, error: 'integration_missing' };
		}

		const secret = decrypt(tenantId, integration.sharedSecret);
		const callbackPath = '/modules/addons/ots_crm_connector/callback.php';
		const url = `${integration.whmcsUrl.replace(/\/+$/, '')}${callbackPath}`;
		const body = JSON.stringify({ event: 'health_probe', tenantId, ts: Date.now() });
		const headers = buildSignedHeaders(secret, 'POST', callbackPath, tenantSlug, body);

		const res = await fetch(url, {
			method: 'POST',
			headers,
			body,
			signal: AbortSignal.timeout(10_000)
		});
		const duration = Math.round(performance.now() - start);
		const text = await res.text().catch(() => '');
		return {
			ok: res.ok,
			status: res.status,
			durationMs: duration,
			bodyExcerpt: text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300)
		};
	} catch (err) {
		const duration = Math.round(performance.now() - start);
		return {
			ok: false,
			status: null,
			durationMs: duration,
			error: err instanceof Error ? err.message.slice(0, 300) : String(err)
		};
	}
}

async function findStuckInFlight(tenantId: string, minutes: number) {
	const cutoff = new Date(Date.now() - minutes * 60_000);
	return db
		.select({
			id: table.whmcsInvoiceSync.id,
			invoiceId: table.whmcsInvoiceSync.invoiceId,
			whmcsInvoiceId: table.whmcsInvoiceSync.whmcsInvoiceId,
			lastPushAttemptAt: table.whmcsInvoiceSync.lastPushAttemptAt,
			retryCount: table.whmcsInvoiceSync.retryCount,
			lastErrorClass: table.whmcsInvoiceSync.lastErrorClass,
			lastErrorMessage: table.whmcsInvoiceSync.lastErrorMessage
		})
		.from(table.whmcsInvoiceSync)
		.where(
			and(
				eq(table.whmcsInvoiceSync.tenantId, tenantId),
				eq(table.whmcsInvoiceSync.keezPushStatus, 'in_flight'),
				lt(table.whmcsInvoiceSync.lastPushAttemptAt, cutoff)
			)
		)
		.orderBy(desc(table.whmcsInvoiceSync.lastPushAttemptAt))
		.limit(50);
}

async function inspectSyncRow(tenantId: string, syncId: string) {
	const [row] = await db
		.select()
		.from(table.whmcsInvoiceSync)
		.where(
			and(
				eq(table.whmcsInvoiceSync.tenantId, tenantId),
				eq(table.whmcsInvoiceSync.id, syncId)
			)
		)
		.limit(1);

	if (!row) return null;

	// Check whether a BullMQ hop is queued for this invoice.
	type DelayedJob = { id?: string | null; opts: { delay?: number } };
	let bullmqJobs: { id: string | undefined; delay: number; nextAttempt: string | null }[] = [];
	try {
		const { schedulerQueue } = await import('$lib/server/scheduler');
		const delayed = (await schedulerQueue.getDelayed(0, 1000)) as DelayedJob[];
		bullmqJobs = delayed
			.filter(
				(j: DelayedJob) =>
					typeof j.id === 'string' &&
					row.invoiceId &&
					j.id.startsWith(`whmcs-keez-push-retry-${tenantId}-${row.invoiceId}-`)
			)
			.map((j: DelayedJob) => ({
				id: j.id ?? undefined,
				delay: j.opts.delay ?? 0,
				nextAttempt: j.opts.delay
					? new Date(Date.now() + j.opts.delay).toISOString()
					: null
			}));
	} catch {
		// Redis down — skip silently; the row payload still tells most of the story.
	}

	return { row, bullmqJobs };
}

async function triggerImmediateRetry(tenantId: string, invoiceId: string) {
	const [row] = await db
		.select({
			whmcsInvoiceId: table.whmcsInvoiceSync.whmcsInvoiceId,
			id: table.whmcsInvoiceSync.id
		})
		.from(table.whmcsInvoiceSync)
		.where(
			and(
				eq(table.whmcsInvoiceSync.tenantId, tenantId),
				eq(table.whmcsInvoiceSync.invoiceId, invoiceId)
			)
		)
		.limit(1);

	if (!row) return { ok: false, error: 'sync row not found for invoiceId' };

	const { cancelPendingWhmcsKeezPushRetry, enqueueWhmcsKeezPushRetry } = await import(
		'$lib/server/scheduler/tasks/whmcs-keez-push-retry'
	);

	await cancelPendingWhmcsKeezPushRetry(tenantId, invoiceId);

	await db
		.update(table.whmcsInvoiceSync)
		.set({
			retryCount: 0,
			nextRetryAt: null,
			lastErrorClass: null,
			lastErrorMessage: null,
			keezPushStatus: 'retrying'
		})
		.where(eq(table.whmcsInvoiceSync.id, row.id));

	await enqueueWhmcsKeezPushRetry(tenantId, invoiceId, row.whmcsInvoiceId, 0, 1);
	return { ok: true, enqueued: true };
}

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	const tenant = event.locals.tenant!;
	const tenantId = tenant.id;
	const tenantSlug = tenant.slug;
	const url = event.url;

	const mode = url.searchParams.get('mode') ?? 'summary';
	const syncId = url.searchParams.get('syncId');
	const invoiceId = url.searchParams.get('invoiceId');
	const action = url.searchParams.get('action');

	if (syncId) {
		const detail = await inspectSyncRow(tenantId, syncId);
		if (!detail) return json({ ok: false, error: 'sync row not found' }, { status: 404 });
		return json({ ok: true, mode: 'inspect', detail });
	}

	if (invoiceId && action === 'trigger') {
		const result = await triggerImmediateRetry(tenantId, invoiceId);
		return json({ mode: 'trigger', ...result });
	}

	if (mode === 'callback') {
		const probe = await probeWhmcsCallback(tenantId, tenantSlug);
		return json({ ok: true, mode, probe });
	}

	if (mode === 'queue') {
		const queue = await buildQueueSummary(tenantId);
		return json({ ok: true, mode, queue });
	}

	if (mode === 'stuck') {
		const minutes = Math.max(1, Math.min(1440, Number(url.searchParams.get('minutes') || '15')));
		const stuck = await findStuckInFlight(tenantId, minutes);
		return json({
			ok: true,
			mode,
			cutoffMinutes: minutes,
			count: stuck.length,
			stuck
		});
	}

	// summary (default) — fan out queue + callback in parallel
	const [queue, callback] = await Promise.all([
		buildQueueSummary(tenantId),
		probeWhmcsCallback(tenantId, tenantSlug)
	]);

	const [integration] = await db
		.select({
			isActive: table.whmcsIntegration.isActive,
			enableKeezPush: table.whmcsIntegration.enableKeezPush,
			circuitBreakerUntil: table.whmcsIntegration.circuitBreakerUntil,
			consecutiveFailures: table.whmcsIntegration.consecutiveFailures,
			lastSuccessfulSyncAt: table.whmcsIntegration.lastSuccessfulSyncAt,
			lastFailureReason: table.whmcsIntegration.lastFailureReason
		})
		.from(table.whmcsIntegration)
		.where(eq(table.whmcsIntegration.tenantId, tenantId))
		.limit(1);

	return json({
		ok: true,
		mode: 'summary',
		integration: integration ?? null,
		queue,
		callback,
		hint: 'Use ?mode=stuck&minutes=15 to find orphaned in-flight rows; ?syncId=<id> for deep inspection.'
	});
};
