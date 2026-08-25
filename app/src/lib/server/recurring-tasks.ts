import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { sendTaskAssignmentEmail } from '$lib/server/email';
import { recordTaskActivity } from '$lib/server/task-activity';
import { logWarning } from '$lib/server/logger';

function generateTaskId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export function calculateNextTaskDueDate(
	currentDate: Date,
	recurringType: string,
	recurringInterval: number
): Date {
	const nextDate = new Date(currentDate);
	switch (recurringType) {
		case 'daily':
			nextDate.setDate(nextDate.getDate() + recurringInterval);
			break;
		case 'weekly':
			nextDate.setDate(nextDate.getDate() + recurringInterval * 7);
			break;
		case 'monthly':
			nextDate.setMonth(nextDate.getMonth() + recurringInterval);
			if (nextDate.getDate() !== currentDate.getDate()) {
				nextDate.setDate(0);
			}
			break;
		case 'yearly':
			nextDate.setFullYear(nextDate.getFullYear() + recurringInterval);
			if (nextDate.getMonth() !== currentDate.getMonth()) {
				nextDate.setDate(0);
			}
			break;
		default:
			throw new Error(`Unknown recurring type: ${recurringType}`);
	}
	return nextDate;
}

/**
 * Hard cap on catch-up iterations. A daily chain abandoned for a decade needs
 * ~3650 steps; anything past this is corrupt data, not a real backlog.
 */
const MAX_CATCHUP_STEPS = 5000;

/** Midnight local — the same boundary `isTaskOverdue` uses to decide "restant". */
export function startOfToday(reference: Date = new Date()): Date {
	const d = new Date(reference);
	d.setHours(0, 0, 0, 0);
	return d;
}

/**
 * The k-th occurrence after `anchor`, always measured from the anchor itself and
 * never by chaining k single steps. Chaining drifts on month-end: Jan 31 → Feb 28
 * → Mar 28, losing the 31st for good. Multiplying the interval keeps the clamp in
 * `calculateNextTaskDueDate` comparing against the original day-of-month, so
 * Jan 31 + 2 months is Mar 31.
 */
function occurrenceAt(anchor: Date, recurringType: string, step: number, k: number): Date {
	return calculateNextTaskDueDate(anchor, recurringType, step * k);
}

/**
 * First occurrence strictly after `notBefore` (default: today).
 *
 * Used when an occurrence is completed: anchoring the child on the parent's due
 * date alone meant a task finished 3 weeks late spawned a child due 3 weeks ago —
 * born overdue, and the chain never caught up because every completion produced
 * another backdated row. Skipped periods are reported so the caller can log them.
 */
export function nextRecurringDueDateAfter(
	anchor: Date,
	recurringType: string,
	recurringInterval: number,
	notBefore: Date = startOfToday()
): { dueDate: Date; skipped: number } {
	const step = Math.max(1, recurringInterval || 1);
	let k = 1;
	let next = occurrenceAt(anchor, recurringType, step, k);
	while (next.getTime() <= notBefore.getTime() && k < MAX_CATCHUP_STEPS) {
		k++;
		next = occurrenceAt(anchor, recurringType, step, k);
	}
	return { dueDate: next, skipped: k - 1 };
}

/**
 * Latest occurrence that is still <= `today`, or null when not even one full
 * period has elapsed since `anchor`.
 *
 * Used for open (never-completed) occurrences: the row represents the CURRENT
 * period, so it is pulled forward to it instead of drifting to -60 days. It
 * deliberately stops at today rather than jumping into the future — a period
 * whose deadline really has passed must stay visibly late, just capped at under
 * one interval.
 */
export function currentRecurringDueDate(
	anchor: Date,
	recurringType: string,
	recurringInterval: number,
	today: Date = startOfToday()
): { dueDate: Date; missed: number } | null {
	const step = Math.max(1, recurringInterval || 1);
	let k = 1;
	let candidate = occurrenceAt(anchor, recurringType, step, k);
	if (candidate.getTime() > today.getTime()) return null;

	let last = candidate;
	while (k < MAX_CATCHUP_STEPS) {
		k++;
		candidate = occurrenceAt(anchor, recurringType, step, k);
		if (candidate.getTime() > today.getTime()) break;
		last = candidate;
	}
	// Every occurrence from the anchor up to (excluding) the new current one went by
	// unfinished — that is k - 1 dates, the anchor included.
	return { dueDate: last, missed: k - 1 };
}

/**
 * When a recurring task transitions to 'done', spawn the next occurrence.
 * Idempotent: skips if recurringSpawnedAt is already set.
 * Returns the new child task id, or null if the chain ended / nothing was spawned.
 */
export async function spawnNextRecurringTask(parentTaskId: string): Promise<string | null> {
	const [parent] = await db
		.select()
		.from(table.task)
		.where(eq(table.task.id, parentTaskId))
		.limit(1);

	if (!parent) return null;
	if (!parent.isRecurring || !parent.recurringType || !parent.dueDate) return null;
	if (parent.recurringSpawnedAt) return null;

	const interval = parent.recurringInterval || 1;
	// Anchored on the parent's due date (so a monthly report stays on the 5th), but
	// never landing in the past: a late completion skips the periods that already
	// went by instead of handing the assignee a task that is born overdue.
	const { dueDate: nextDueDate, skipped } = nextRecurringDueDateAfter(
		new Date(parent.dueDate),
		parent.recurringType,
		interval
	);

	const now = new Date();

	if (parent.recurringEndDate && nextDueDate.getTime() > new Date(parent.recurringEndDate).getTime()) {
		await db
			.update(table.task)
			.set({ recurringSpawnedAt: now, updatedAt: now })
			.where(eq(table.task.id, parent.id));
		await recordTaskActivity({
			taskId: parent.id,
			userId: parent.createdByUserId || '',
			tenantId: parent.tenantId,
			action: 'recurring_chain_ended'
		});
		return null;
	}

	const childTaskId = generateTaskId();
	const rootId = parent.recurringParentId ?? parent.id;
	const childStatus = parent.status === 'pending-approval' ? 'pending-approval' : 'todo';

	const [maxPositionResult] = await db
		.select({
			maxPosition: sql<number>`coalesce(max(${table.task.position}), -1)`.as('maxPosition')
		})
		.from(table.task)
		.where(and(eq(table.task.tenantId, parent.tenantId), eq(table.task.status, childStatus)));
	const nextPosition = (maxPositionResult?.maxPosition ?? -1) + 1;

	await db.insert(table.task).values({
		id: childTaskId,
		tenantId: parent.tenantId,
		projectId: parent.projectId,
		clientId: parent.clientId,
		milestoneId: parent.milestoneId,
		title: parent.title,
		description: parent.description,
		status: childStatus,
		priority: parent.priority,
		position: nextPosition,
		dueDate: nextDueDate,
		assignedToUserId: parent.assignedToUserId,
		createdByUserId: parent.createdByUserId,
		isRecurring: true,
		recurringType: parent.recurringType,
		recurringInterval: interval,
		recurringEndDate: parent.recurringEndDate,
		recurringParentId: rootId,
		recurringSpawnedAt: null
	});

	await db
		.update(table.task)
		.set({ recurringSpawnedAt: now, updatedAt: now })
		.where(eq(table.task.id, parent.id));

	if (parent.assignedToUserId) {
		const watcherId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
		await db.insert(table.taskWatcher).values({
			id: watcherId,
			taskId: childTaskId,
			userId: parent.assignedToUserId,
			tenantId: parent.tenantId
		});

		const [assignee] = await db
			.select()
			.from(table.user)
			.where(eq(table.user.id, parent.assignedToUserId))
			.limit(1);

		if (assignee?.email) {
			try {
				const assigneeName = `${assignee.firstName} ${assignee.lastName}`.trim() || assignee.email;
				await sendTaskAssignmentEmail(childTaskId, assignee.email, assigneeName);
			} catch (error) {
				logWarning('email', `Failed to send recurring child task assignment email: ${(error as Error).message}`);
			}
		}
	}

	await recordTaskActivity({
		taskId: parent.id,
		userId: parent.createdByUserId || '',
		tenantId: parent.tenantId,
		action: 'recurring_spawned',
		newValue: childTaskId
	});

	// The chain jumped over periods that went by while the parent sat unfinished.
	// Record it so the timeline explains why this child is not simply
	// "parent due + one interval". Payload is JSON, like the meet_event_* rows.
	if (skipped > 0) {
		await recordTaskActivity({
			taskId: childTaskId,
			userId: parent.createdByUserId || '',
			tenantId: parent.tenantId,
			action: 'recurring_occurrences_skipped',
			newValue: JSON.stringify({ skipped, to: nextDueDate.toISOString() })
		});
	}

	return childTaskId;
}
