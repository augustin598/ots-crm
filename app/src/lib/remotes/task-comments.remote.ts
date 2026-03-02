import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { recordTaskActivity } from '$lib/server/task-activity';
import { sendTaskUpdateEmail, sendTaskClientNotificationEmail } from '$lib/server/email';

function generateTaskCommentId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const getTaskComments = query(
	v.pipe(v.string(), v.minLength(1)),
	async (taskId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify task belongs to tenant
		const [task] = await db
			.select()
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!task) {
			throw new Error('Task not found');
		}

		const comments = await db
			.select()
			.from(table.taskComment)
			.where(eq(table.taskComment.taskId, taskId))
			.orderBy(table.taskComment.createdAt);

		return comments;
	}
);

export const createTaskComment = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		content: v.pipe(v.string(), v.minLength(1, 'Content is required'))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify task belongs to tenant
		const [task] = await db
			.select()
			.from(table.task)
			.where(and(eq(table.task.id, data.taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!task) {
			throw new Error('Task not found');
		}

		const commentId = generateTaskCommentId();

		await db.insert(table.taskComment).values({
			id: commentId,
			taskId: data.taskId,
			userId: event.locals.user.id,
			content: data.content
		});

		await recordTaskActivity({
			taskId: data.taskId,
			userId: event.locals.user.id,
			tenantId: event.locals.tenant.id,
			action: 'commented'
		});

		// Load task settings for notification toggles
		const [settings] = await db
			.select()
			.from(table.taskSettings)
			.where(eq(table.taskSettings.tenantId, event.locals.tenant.id))
			.limit(1);

		// Send internal notification to watchers (if enabled)
		if (settings?.internalEmailOnComment !== false) {
			const watchers = await db
				.select()
				.from(table.taskWatcher)
				.where(
					and(
						eq(table.taskWatcher.taskId, data.taskId),
						eq(table.taskWatcher.tenantId, event.locals.tenant.id)
					)
				);

			for (const watcher of watchers) {
				if (watcher.userId === event.locals.user.id) continue;

				const [watcherUser] = await db
					.select()
					.from(table.user)
					.where(eq(table.user.id, watcher.userId))
					.limit(1);

				if (watcherUser?.email) {
					try {
						const watcherName =
							`${watcherUser.firstName} ${watcherUser.lastName}`.trim() || watcherUser.email;
						await sendTaskUpdateEmail(data.taskId, watcherUser.email, watcherName, 'comment');
					} catch (error) {
						console.error('Failed to send comment notification to watcher:', error);
					}
				}
			}
		}

		// Send client notification (if enabled)
		if (settings?.clientEmailsEnabled && settings?.clientEmailOnComment !== false) {
			if (task.clientId) {
				const [client] = await db
					.select()
					.from(table.client)
					.where(eq(table.client.id, task.clientId))
					.limit(1);

				if (client?.email) {
					try {
						await sendTaskClientNotificationEmail(
							data.taskId,
							client.email,
							client.name || client.email,
							'comment',
							{ commentPreview: data.content }
						);
					} catch (error) {
						console.error('Failed to send comment notification to client:', error);
					}
				}
			}
		}

		return { success: true, commentId };
	}
);

export const updateTaskComment = command(
	v.object({
		commentId: v.pipe(v.string(), v.minLength(1)),
		content: v.pipe(v.string(), v.minLength(1, 'Content is required'))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify comment exists and belongs to user's tenant
		const [comment] = await db
			.select({
				comment: table.taskComment,
				task: table.task
			})
			.from(table.taskComment)
			.innerJoin(table.task, eq(table.taskComment.taskId, table.task.id))
			.where(
				and(
					eq(table.taskComment.id, data.commentId),
					eq(table.task.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!comment) {
			throw new Error('Comment not found');
		}

		// Only allow user who created the comment to update it
		if (comment.comment.userId !== event.locals.user.id) {
			throw new Error('Unauthorized to update this comment');
		}

		await db
			.update(table.taskComment)
			.set({
				content: data.content,
				updatedAt: new Date()
			})
			.where(eq(table.taskComment.id, data.commentId));

		return { success: true };
	}
);

export const deleteTaskComment = command(
	v.pipe(v.string(), v.minLength(1)),
	async (commentId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify comment exists and belongs to user's tenant
		const [comment] = await db
			.select({
				comment: table.taskComment,
				task: table.task
			})
			.from(table.taskComment)
			.innerJoin(table.task, eq(table.taskComment.taskId, table.task.id))
			.where(
				and(
					eq(table.taskComment.id, commentId),
					eq(table.task.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!comment) {
			throw new Error('Comment not found');
		}

		// Only allow user who created the comment to delete it
		if (comment.comment.userId !== event.locals.user.id) {
			throw new Error('Unauthorized to delete this comment');
		}

		await db.delete(table.taskComment).where(eq(table.taskComment.id, commentId));

		return { success: true };
	}
);
