import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { recordTaskActivity } from '$lib/server/task-activity';
import { sendTaskUpdateEmail, sendTaskClientNotificationEmail, getNotificationRecipients } from '$lib/server/email';
import * as storage from '$lib/server/storage';

function generateTaskCommentId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Extract mentioned user IDs from TipTap HTML content.
 * TipTap Mention extension outputs: <span data-type="mention" data-id="userId">...</span>
 */
function extractMentionIds(html: string): string[] {
	const regex = /data-type="mention"\s+data-id="([^"]+)"/g;
	const ids: string[] = [];
	let match;
	while ((match = regex.exec(html)) !== null) {
		if (match[1] && !ids.includes(match[1])) {
			ids.push(match[1]);
		}
	}
	return ids;
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
			.select({
				id: table.taskComment.id,
				taskId: table.taskComment.taskId,
				userId: table.taskComment.userId,
				parentCommentId: table.taskComment.parentCommentId,
				content: table.taskComment.content,
				attachmentPath: table.taskComment.attachmentPath,
				attachmentMimeType: table.taskComment.attachmentMimeType,
				attachmentFileName: table.taskComment.attachmentFileName,
				attachmentFileSize: table.taskComment.attachmentFileSize,
				createdAt: table.taskComment.createdAt,
				updatedAt: table.taskComment.updatedAt,
				authorName: table.user.firstName,
				authorLastName: table.user.lastName,
				authorEmail: table.user.email
			})
			.from(table.taskComment)
			.leftJoin(table.user, eq(table.taskComment.userId, table.user.id))
			.where(eq(table.taskComment.taskId, taskId))
			.orderBy(table.taskComment.createdAt);

		return comments.map(c => ({
			...c,
			authorName: `${c.authorName || ''} ${c.authorLastName || ''}`.trim() || c.authorEmail || c.userId
		}));
	}
);

export const createTaskComment = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		content: v.string(),
		parentCommentId: v.optional(v.string()),
		attachmentPath: v.optional(v.string()),
		attachmentMimeType: v.optional(v.string()),
		attachmentFileName: v.optional(v.string()),
		attachmentFileSize: v.optional(v.number())
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

		if (!data.content.trim() && !data.attachmentPath) {
			throw new Error('Comment must have text or an image');
		}

		const commentId = generateTaskCommentId();

		await db.insert(table.taskComment).values({
			id: commentId,
			taskId: data.taskId,
			userId: event.locals.user.id,
			parentCommentId: data.parentCommentId || null,
			content: data.content || '',
			attachmentPath: data.attachmentPath || null,
			attachmentMimeType: data.attachmentMimeType || null,
			attachmentFileName: data.attachmentFileName || null,
			attachmentFileSize: data.attachmentFileSize || null
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

		// Send mention notifications to mentioned users (who aren't already watchers)
		const mentionedUserIds = extractMentionIds(data.content);
		if (mentionedUserIds.length > 0) {
			const watcherUserIds = new Set(
				(await db
					.select({ userId: table.taskWatcher.userId })
					.from(table.taskWatcher)
					.where(and(
						eq(table.taskWatcher.taskId, data.taskId),
						eq(table.taskWatcher.tenantId, event.locals.tenant.id)
					))
				).map(w => w.userId)
			);

			for (const mentionedId of mentionedUserIds) {
				// Skip self-mentions and users already notified as watchers
				if (mentionedId === event.locals.user.id) continue;
				if (watcherUserIds.has(mentionedId)) continue;

				const [mentionedUser] = await db
					.select()
					.from(table.user)
					.where(eq(table.user.id, mentionedId))
					.limit(1);

				if (mentionedUser?.email) {
					try {
						const mentionedName = `${mentionedUser.firstName} ${mentionedUser.lastName}`.trim() || mentionedUser.email;
						await sendTaskUpdateEmail(data.taskId, mentionedUser.email, mentionedName, 'mention');
					} catch (error) {
						console.error('Failed to send mention notification:', error);
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
						const recipients = await getNotificationRecipients(task.clientId, 'tasks');
						for (const recipientEmail of recipients) {
							await sendTaskClientNotificationEmail(
								data.taskId,
								recipientEmail,
								client.name || client.email,
								'comment',
								{ commentPreview: data.content }
							);
						}
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

export const getCommentAttachmentUrl = query(
	v.pipe(v.string(), v.minLength(1)),
	async (commentId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [comment] = await db
			.select({
				attachmentPath: table.taskComment.attachmentPath,
				attachmentFileName: table.taskComment.attachmentFileName,
				attachmentMimeType: table.taskComment.attachmentMimeType,
				taskTenantId: table.task.tenantId
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

		if (!comment || !comment.attachmentPath) {
			throw new Error('Attachment not found');
		}

		const url = await storage.getDownloadUrl(comment.attachmentPath, 300);
		return { url, fileName: comment.attachmentFileName, mimeType: comment.attachmentMimeType };
	}
);
