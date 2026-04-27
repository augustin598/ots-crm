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
	const nextDueDate = calculateNextTaskDueDate(
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

	return childTaskId;
}
