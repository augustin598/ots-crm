import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getSchedulerQueue, JOB_LABELS, JOB_PARAMS } from '$lib/server/scheduler';

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

	return repeatableJobs.map((job) => {
		const typeKey = job.name.replace(/-/g, '_');
		const handlerType = typeKey.replace(/_evening$/, '');
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
	});
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
		.limit(500);

	return logs;
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

		// Remove old repeatable job by key
		await queue.removeRepeatableByKey(jobId);

		const typeKey = name.replace(/-/g, '_');
		const handlerType = typeKey.replace(/_evening$/, '');
		const params = JOB_PARAMS[typeKey] || {};

		// Re-add with new pattern
		await queue.add(
			name,
			{
				type: handlerType,
				params
			},
			{
				repeat: {
					pattern,
					tz: tz || 'Europe/Bucharest'
				},
				jobId: name
			}
		);

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
		const handlerType = typeKey.replace(/_evening$/, '');

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
