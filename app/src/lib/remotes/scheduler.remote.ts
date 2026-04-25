import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { parseExpression } from 'cron-parser';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, desc, sql, count, and, or, like, isNull } from 'drizzle-orm';
import { getSchedulerQueue, JOB_LABELS, JOB_PARAMS, JOB_HANDLER_TYPES } from '$lib/server/scheduler';
import { logInfo } from '$lib/server/logger';

/** Validates cron pattern syntax and rejects patterns that fire more than 1x/minute */
function validateCronPattern(pattern: string): boolean {
	try {
		const interval = parseExpression(pattern);
		const next1 = interval.next().getTime();
		const next2 = interval.next().getTime();
		return (next2 - next1) >= 60_000; // minimum 1-minute interval
	} catch {
		return false;
	}
}

function requireAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Forbidden: Admin access required');
	}
	return event;
}

function requireOwner() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner') {
		throw new Error('Forbidden: Owner access required');
	}
	return event;
}

// Rate limit for manual job triggers (30s cooldown per job name)
const lastTriggerTime = new Map<string, number>();
const TRIGGER_COOLDOWN_MS = 30_000;

export const getSchedulerJobs = query(async () => {
	requireAdmin();

	const queue = getSchedulerQueue();
	const repeatableJobs = await queue.getRepeatableJobs();

	return {
		jobs: repeatableJobs.map((job) => {
			const typeKey = job.name.replace(/-/g, '_');
			const handlerType = JOB_HANDLER_TYPES[typeKey] || typeKey.replace(/_evening$/, '');
			return {
				key: job.key,
				name: job.name,
				typeKey,
				handlerType,
				pattern: job.pattern,
				tz: job.tz || 'Europe/Bucharest',
				next: job.next ? new Date(job.next).toISOString() : null,
				label: JOB_LABELS[typeKey] || job.name,
				params: JOB_PARAMS[typeKey] || {}
			};
		}),
		allJobLabels: JOB_LABELS
	};
});

export const getSchedulerHistory = query(async () => {
	const event = requireAdmin();
	const tenantId = event.locals.tenant!.id;

	// Show logs for this tenant + system-level logs (tenantId IS NULL)
	const logs = await db
		.select({
			id: table.debugLog.id,
			level: table.debugLog.level,
			message: table.debugLog.message,
			metadata: table.debugLog.metadata,
			stackTrace: table.debugLog.stackTrace,
			createdAt: table.debugLog.createdAt
		})
		.from(table.debugLog)
		.where(and(
			eq(table.debugLog.source, 'scheduler'),
			or(eq(table.debugLog.tenantId, tenantId), isNull(table.debugLog.tenantId))
		))
		.orderBy(desc(table.debugLog.createdAt))
		.limit(1000);

	return logs;
});

export const getSchedulerStats = query(async () => {
	const event = requireAdmin();
	const tenantId = event.locals.tenant!.id;

	const [result] = await db
		.select({
			total: count(),
			info: count(sql`CASE WHEN ${table.debugLog.level} = 'info' THEN 1 END`),
			warning: count(sql`CASE WHEN ${table.debugLog.level} = 'warning' THEN 1 END`),
			error: count(sql`CASE WHEN ${table.debugLog.level} = 'error' THEN 1 END`)
		})
		.from(table.debugLog)
		.where(and(
			eq(table.debugLog.source, 'scheduler'),
			or(eq(table.debugLog.tenantId, tenantId), isNull(table.debugLog.tenantId))
		));

	return result ?? { total: 0, info: 0, warning: 0, error: 0 };
});

/** Per-job execution stats — computed server-side from tenant-scoped logs */
export const getJobStats = query(async () => {
	const event = requireAdmin();
	const tenantId = event.locals.tenant!.id;

	// Query 1: Count successes and failures per handler type
	// Include system-level logs (tenantId IS NULL) since worker logs are global
	const countRows = await db
		.select({
			message: table.debugLog.message,
			level: table.debugLog.level,
			cnt: count()
		})
		.from(table.debugLog)
		.where(and(
			eq(table.debugLog.source, 'scheduler'),
			or(eq(table.debugLog.tenantId, tenantId), isNull(table.debugLog.tenantId)),
			or(
				like(table.debugLog.message, 'Job completed: %'),
				like(table.debugLog.message, 'Job failed: %')
			)
		))
		.groupBy(table.debugLog.message, table.debugLog.level);

	// Query 2: Last execution per handler type (most recent completed or failed)
	const lastRows = await db
		.select({
			message: table.debugLog.message,
			level: table.debugLog.level,
			createdAt: table.debugLog.createdAt
		})
		.from(table.debugLog)
		.where(and(
			eq(table.debugLog.source, 'scheduler'),
			or(eq(table.debugLog.tenantId, tenantId), isNull(table.debugLog.tenantId)),
			or(
				like(table.debugLog.message, 'Job completed: %'),
				like(table.debugLog.message, 'Job failed: %')
			)
		))
		.orderBy(desc(table.debugLog.createdAt))
		.limit(100);

	// Parse handler type from message
	function extractHandlerType(msg: string): string | null {
		const completedMatch = msg.match(/^Job completed: (\S+)$/);
		if (completedMatch) return completedMatch[1];
		const failedMatch = msg.match(/^Job failed: (\S+)/);
		if (failedMatch) return failedMatch[1];
		return null;
	}

	// Build stats map
	const stats: Record<string, { successCount: number; failCount: number; lastRun: string | null; lastStatus: 'success' | 'error' | null }> = {};

	// Initialize all known handler types
	const uniqueHandlerTypes = new Set<string>();
	for (const key of Object.keys(JOB_LABELS)) {
		const ht = JOB_HANDLER_TYPES[key] || key.replace(/_evening$/, '');
		uniqueHandlerTypes.add(ht);
	}
	for (const ht of uniqueHandlerTypes) {
		stats[ht] = { successCount: 0, failCount: 0, lastRun: null, lastStatus: null };
	}

	// Aggregate counts
	for (const row of countRows) {
		const ht = extractHandlerType(row.message);
		if (!ht || !stats[ht]) continue;
		if (row.level === 'info') stats[ht].successCount += row.cnt;
		else if (row.level === 'error') stats[ht].failCount += row.cnt;
	}

	// Find last run per handler type
	const seenLast = new Set<string>();
	for (const row of lastRows) {
		const ht = extractHandlerType(row.message);
		if (!ht || !stats[ht] || seenLast.has(ht)) continue;
		seenLast.add(ht);
		stats[ht].lastRun = row.createdAt ? String(row.createdAt) : null;
		stats[ht].lastStatus = row.level === 'error' ? 'error' : 'success';
	}

	return stats;
});

export const updateJobSchedule = command(
	v.object({
		jobId: v.string(),
		name: v.string(),
		pattern: v.pipe(
			v.string(),
			v.minLength(5),
			v.check(validateCronPattern, 'Pattern cron invalid sau prea frecvent (minim 1 minut)')
		),
		tz: v.optional(v.string(), 'Europe/Bucharest')
	}),
	async ({ jobId, name, pattern, tz }) => {
		const event = requireOwner();
		const tenantId = event.locals.tenant!.id;
		const userId = event.locals.user!.id;

		const queue = getSchedulerQueue();

		// Save old job details for rollback
		const repeatableJobs = await queue.getRepeatableJobs();
		const oldJob = repeatableJobs.find((j) => j.key === jobId);
		if (!oldJob) throw new Error('Job not found');

		const typeKey = name.replace(/-/g, '_');
		const handlerType = JOB_HANDLER_TYPES[typeKey] || typeKey.replace(/_evening$/, '');
		const params = JOB_PARAMS[typeKey] || {};

		// Remove old repeatable job by key
		await queue.removeRepeatableByKey(jobId);

		try {
			// Re-add with new pattern
			await queue.add(
				name,
				{ type: handlerType, params },
				{
					repeat: { pattern, tz: tz || 'Europe/Bucharest' },
					jobId: name
				}
			);
		} catch (err) {
			// Rollback: restore old job
			await queue.add(
				name,
				{ type: handlerType, params },
				{
					repeat: { pattern: oldJob.pattern!, tz: oldJob.tz || 'Europe/Bucharest' },
					jobId: name
				}
			);
			throw err;
		}

		// Audit trail
		logInfo('scheduler', `Admin action: schedule updated for ${name}`, {
			tenantId,
			userId,
			action: 'scheduler.update_schedule',
			metadata: { jobId, name, oldPattern: oldJob.pattern, newPattern: pattern }
		});

		return { success: true };
	}
);

export const removeSchedulerJob = command(
	v.pipe(v.string(), v.minLength(1)),
	async (jobKey) => {
		const event = requireOwner();
		const tenantId = event.locals.tenant!.id;
		const userId = event.locals.user!.id;

		const queue = getSchedulerQueue();
		await queue.removeRepeatableByKey(jobKey);

		// Audit trail
		logInfo('scheduler', `Admin action: job removed`, {
			tenantId,
			userId,
			action: 'scheduler.remove_job',
			metadata: { jobKey }
		});

		return { success: true };
	}
);

export const triggerJobNow = command(
	v.object({
		name: v.string(),
		typeKey: v.string(),
		params: v.optional(v.record(v.string(), v.any()), {})
	}),
	async ({ name, typeKey, params }) => {
		const event = requireOwner();
		const tenantId = event.locals.tenant!.id;
		const userId = event.locals.user!.id;

		// Rate limit: 30s cooldown per job name
		const lastTime = lastTriggerTime.get(name) ?? 0;
		if (Date.now() - lastTime < TRIGGER_COOLDOWN_MS) {
			throw new Error('Prea devreme. Așteptați 30 de secunde între execuții manuale.');
		}
		lastTriggerTime.set(name, Date.now());

		const queue = getSchedulerQueue();
		const handlerType = JOB_HANDLER_TYPES[typeKey] || typeKey.replace(/_evening$/, '');

		await queue.add(
			`${name}-manual`,
			{
				type: handlerType,
				params: params || {}
			},
			{
				jobId: `${name}-manual-${Date.now()}`
			}
		);

		// Audit trail
		logInfo('scheduler', `Admin action: manual trigger for ${name}`, {
			tenantId,
			userId,
			action: 'scheduler.trigger_job',
			metadata: { name, typeKey, handlerType }
		});

		return { success: true };
	}
);

export const deleteSchedulerLogsByLevel = command(
	v.picklist(['info', 'warning', 'error']),
	async (level) => {
		const event = requireOwner();
		const tenantId = event.locals.tenant!.id;
		const userId = event.locals.user!.id;

		const deletedRows = await db
			.delete(table.debugLog)
			.where(
				and(
					eq(table.debugLog.source, 'scheduler'),
					eq(table.debugLog.level, level),
					or(
						eq(table.debugLog.tenantId, tenantId),
						isNull(table.debugLog.tenantId)
					)
				)
			)
			.returning({ id: table.debugLog.id });

		const deleted = deletedRows.length;

		// Audit trail
		logInfo('scheduler', `Admin action: logs deleted for level ${level}`, {
			tenantId,
			userId,
			action: 'scheduler.delete_logs',
			metadata: { level, deleted }
		});

		return { success: true, deleted };
	}
);
