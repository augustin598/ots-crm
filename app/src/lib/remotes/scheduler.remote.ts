import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, desc, sql, count, and, or, like } from 'drizzle-orm';
import { getSchedulerQueue, JOB_LABELS, JOB_PARAMS, JOB_HANDLER_TYPES } from '$lib/server/scheduler';

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
	requireAdmin();

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
		.where(eq(table.debugLog.source, 'scheduler'))
		.orderBy(desc(table.debugLog.createdAt))
		.limit(1000);

	return logs;
});

export const getSchedulerStats = query(async () => {
	requireAdmin();

	const [result] = await db
		.select({
			total: count(),
			info: count(sql`CASE WHEN ${table.debugLog.level} = 'info' THEN 1 END`),
			warning: count(sql`CASE WHEN ${table.debugLog.level} = 'warning' THEN 1 END`),
			error: count(sql`CASE WHEN ${table.debugLog.level} = 'error' THEN 1 END`)
		})
		.from(table.debugLog)
		.where(eq(table.debugLog.source, 'scheduler'));

	return result ?? { total: 0, info: 0, warning: 0, error: 0 };
});

/** Per-job execution stats — computed server-side from ALL logs via 2 batch queries */
export const getJobStats = query(async () => {
	requireAdmin();

	// Query 1: Count successes and failures per handler type
	const countRows = await db
		.select({
			message: table.debugLog.message,
			level: table.debugLog.level,
			cnt: count()
		})
		.from(table.debugLog)
		.where(and(
			eq(table.debugLog.source, 'scheduler'),
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
			or(
				like(table.debugLog.message, 'Job completed: %'),
				like(table.debugLog.message, 'Job failed: %')
			)
		))
		.orderBy(desc(table.debugLog.createdAt))
		.limit(100); // Top 100 most recent — covers all handler types

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
		pattern: v.pipe(v.string(), v.minLength(5)),
		tz: v.optional(v.string(), 'Europe/Bucharest')
	}),
	async ({ jobId, name, pattern, tz }) => {
		requireAdmin();

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

		return { success: true };
	}
);

export const removeSchedulerJob = command(
	v.pipe(v.string(), v.minLength(1)),
	async (jobKey) => {
		requireAdmin();

		const queue = getSchedulerQueue();
		await queue.removeRepeatableByKey(jobKey);

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
		requireAdmin();

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

		return { success: true };
	}
);
