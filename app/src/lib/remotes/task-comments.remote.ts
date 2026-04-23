import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import sanitizeHtml from 'sanitize-html';
import { recordTaskActivity } from '$lib/server/task-activity';
import { sendTaskUpdateEmail, sendTaskClientNotificationEmail, getNotificationRecipients } from '$lib/server/email';
import * as storage from '$lib/server/storage';
import { createNotification } from '$lib/server/notifications';

/** Sanitize TipTap HTML - allow safe tags + mention attributes */
function sanitizeCommentHtml(html: string): string {
	return sanitizeHtml(html, {
		allowedTags: [
			'p', 'br', 'strong', 'em', 'u', 's', 'del', 'mark',
			'h1', 'h2', 'h3', 'h4',
			'ul', 'ol', 'li',
			'blockquote', 'pre', 'code',
			'a', 'img', 'span',
			'table', 'thead', 'tbody', 'tr', 'th', 'td',
			'hr', 'div', 'label', 'input'
		],
		allowedAttributes: {
			'a': ['href', 'target', 'rel'],
			'img': ['src', 'alt', 'title'],
			'span': ['class', 'data-type', 'data-id', 'data-label'],
			'td': ['colspan', 'rowspan'],
			'th': ['colspan', 'rowspan'],
			'input': ['type', 'checked', 'disabled'],
			'*': ['class', 'style']
		},
		allowedStyles: {
			'*': { 'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/] }
		},
		allowedSchemes: ['http', 'https', 'mailto'],
	});
}

function generateTaskCommentId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Extract mentioned user IDs from TipTap HTML content.
 * TipTap outputs attributes in varying order, so we match data-id on any element
 * that also has data-type="mention" (handles both attribute orderings).
 */
function extractMentionIds(html: string): string[] {
	const ids: string[] = [];
	// Match any tag that contains both data-type="mention" and data-id="..."
	const tagRegex = /<[^>]*data-type="mention"[^>]*>/g;
	let tagMatch;
	while ((tagMatch = tagRegex.exec(html)) !== null) {
		const idMatch = tagMatch[0].match(/data-id="([^"]+)"/);
		if (idMatch?.[1] && !ids.includes(idMatch[1])) {
			ids.push(idMatch[1]);
		}
	}
	// Also match reversed order: data-id before data-type
	const tagRegex2 = /<[^>]*data-id="([^"]+)"[^>]*data-type="mention"[^>]*>/g;
	let tagMatch2;
	while ((tagMatch2 = tagRegex2.exec(html)) !== null) {
		if (tagMatch2[1] && !ids.includes(tagMatch2[1])) {
			ids.push(tagMatch2[1]);
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

		if (comments.length === 0) return [];

		const commentIds = comments.map(c => c.id);
		const attachments = await db
			.select({
				id: table.taskCommentAttachment.id,
				commentId: table.taskCommentAttachment.commentId,
				mimeType: table.taskCommentAttachment.mimeType,
				fileName: table.taskCommentAttachment.fileName,
				fileSize: table.taskCommentAttachment.fileSize,
				createdAt: table.taskCommentAttachment.createdAt
			})
			.from(table.taskCommentAttachment)
			.where(inArray(table.taskCommentAttachment.commentId, commentIds))
			.orderBy(table.taskCommentAttachment.createdAt);

		const attachmentsByComment = new Map<string, typeof attachments>();
		for (const a of attachments) {
			const existing = attachmentsByComment.get(a.commentId) || [];
			existing.push(a);
			attachmentsByComment.set(a.commentId, existing);
		}

		return comments.map(c => ({
			...c,
			authorName: `${c.authorName || ''} ${c.authorLastName || ''}`.trim() || c.authorEmail || c.userId,
			attachments: attachmentsByComment.get(c.id) || []
		}));
	}
);

export const createTaskComment = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		content: v.string(),
		parentCommentId: v.optional(v.string()),
		attachments: v.optional(
			v.array(
				v.object({
					path: v.pipe(v.string(), v.minLength(1)),
					mimeType: v.optional(v.string()),
					fileName: v.optional(v.string()),
					fileSize: v.optional(v.number())
				})
			)
		),
		// Legacy single-attachment fields — kept for backward compatibility
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

		// Client users can only comment on their own tasks
		if (event.locals.isClientUser && task.clientId !== event.locals.client?.id) {
			throw new Error('Unauthorized: You do not have access to this task');
		}

		// Normalize attachments: accept either new `attachments[]` shape or legacy single-attachment fields
		const attachments = data.attachments?.length
			? data.attachments
			: data.attachmentPath
				? [{
						path: data.attachmentPath,
						mimeType: data.attachmentMimeType,
						fileName: data.attachmentFileName,
						fileSize: data.attachmentFileSize
					}]
				: [];

		// Strip empty TipTap HTML (e.g. "<p></p>", "<p> </p>")
		const textContent = data.content.replace(/<[^>]*>/g, '').trim();
		if (!textContent && attachments.length === 0) {
			throw new Error('Comment must have text or an image');
		}

		const commentId = generateTaskCommentId();
		const sanitizedContent = sanitizeCommentHtml(data.content || '');

		await db.insert(table.taskComment).values({
			id: commentId,
			taskId: data.taskId,
			userId: event.locals.user.id,
			parentCommentId: data.parentCommentId || null,
			content: sanitizedContent,
			// Mirror the first attachment into legacy columns so older readers still see something
			attachmentPath: attachments[0]?.path ?? null,
			attachmentMimeType: attachments[0]?.mimeType ?? null,
			attachmentFileName: attachments[0]?.fileName ?? null,
			attachmentFileSize: attachments[0]?.fileSize ?? null
		});

		if (attachments.length > 0) {
			await db.insert(table.taskCommentAttachment).values(
				attachments.map((a) => ({
					id: generateTaskCommentId(),
					commentId,
					path: a.path,
					mimeType: a.mimeType ?? null,
					fileName: a.fileName ?? null,
					fileSize: a.fileSize ?? null
				}))
			);
		}

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
				.select({
					userId: table.taskWatcher.userId,
					email: table.user.email,
					firstName: table.user.firstName,
					lastName: table.user.lastName
				})
				.from(table.taskWatcher)
				.innerJoin(table.user, eq(table.taskWatcher.userId, table.user.id))
				.where(
					and(
						eq(table.taskWatcher.taskId, data.taskId),
						eq(table.taskWatcher.tenantId, event.locals.tenant.id)
					)
				);

			for (const watcher of watchers) {
				if (watcher.userId === event.locals.user.id) continue;
				if (!watcher.email) continue;

				try {
					const watcherName =
						`${watcher.firstName} ${watcher.lastName}`.trim() || watcher.email;
					await sendTaskUpdateEmail(data.taskId, watcher.email, watcherName, 'comment');
				} catch (error) {
					console.error('Failed to send comment notification to watcher:', error);
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
				// Skip self-mentions
				if (mentionedId === event.locals.user.id) continue;

				const isAlreadyWatcher = watcherUserIds.has(mentionedId);

				// Send mention email only if not already notified as watcher
				if (!isAlreadyWatcher) {
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

				// In-app notification for @mention — always sent (even if watcher)
				const authorName = `${event.locals.user.firstName ?? ''} ${event.locals.user.lastName ?? ''}`.trim() || event.locals.user.email;
				const tenantSlug = event.locals.tenant.slug;
				await createNotification({
					tenantId: event.locals.tenant.id,
					userId: mentionedId,
					clientId: task.clientId ?? undefined,
					type: 'comment.mention',
					title: `${authorName} te-a menționat`,
					message: `Te-a menționat într-un comentariu la "${task.title}"`,
					link: `/${tenantSlug}/tasks/${data.taskId}`,
					priority: 'high',
					metadata: { taskId: data.taskId, commentId },
				}).catch(() => {});
			}
		}

		// Send client notification (if enabled) — skip when the comment author is a client user
		const isClientUser = event.locals.isClientUser === true;
		if (!isClientUser && settings?.clientEmailsEnabled && settings?.clientEmailOnComment !== false) {
			if (task.clientId) {
				const [client] = await db
					.select()
					.from(table.client)
					.where(eq(table.client.id, task.clientId))
					.limit(1);

				if (client?.email) {
					const recipients = await getNotificationRecipients(task.clientId, 'tasks');
					for (const recipient of recipients) {
						// Skip the comment author (don't notify yourself)
						if (recipient.email.toLowerCase() === event.locals.user.email.toLowerCase()) continue;
						try {
							await sendTaskClientNotificationEmail(
								data.taskId,
								recipient.email,
								recipient.name || null,
								'comment',
								{ commentPreview: data.content }
							);
						} catch (error) {
							console.error(`Failed to send comment notification to ${recipient.email}:`, error);
							// Continue with other recipients even if one fails
						}
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

		// Client users can only update comments on their own tasks
		if (event.locals.isClientUser && comment.task.clientId !== event.locals.client?.id) {
			throw new Error('Unauthorized: You do not have access to this task');
		}

		// Only allow user who created the comment to update it
		if (comment.comment.userId !== event.locals.user.id) {
			throw new Error('Unauthorized to update this comment');
		}

		await db
			.update(table.taskComment)
			.set({
				content: sanitizeCommentHtml(data.content),
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

		// Client users can only delete comments on their own tasks
		if (event.locals.isClientUser && comment.task.clientId !== event.locals.client?.id) {
			throw new Error('Unauthorized: You do not have access to this task');
		}

		// Only allow user who created the comment to delete it
		if (comment.comment.userId !== event.locals.user.id) {
			throw new Error('Unauthorized to delete this comment');
		}

		// Delete child replies first, then the comment itself
		await db.delete(table.taskComment).where(eq(table.taskComment.parentCommentId, commentId));
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

export const getAttachmentUrl = query(
	v.pipe(v.string(), v.minLength(1)),
	async (attachmentId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [row] = await db
			.select({
				path: table.taskCommentAttachment.path,
				fileName: table.taskCommentAttachment.fileName,
				mimeType: table.taskCommentAttachment.mimeType,
				taskTenantId: table.task.tenantId
			})
			.from(table.taskCommentAttachment)
			.innerJoin(
				table.taskComment,
				eq(table.taskCommentAttachment.commentId, table.taskComment.id)
			)
			.innerJoin(table.task, eq(table.taskComment.taskId, table.task.id))
			.where(
				and(
					eq(table.taskCommentAttachment.id, attachmentId),
					eq(table.task.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!row) {
			throw new Error('Attachment not found');
		}

		const url = await storage.getDownloadUrl(row.path, 300);
		return { url, fileName: row.fileName, mimeType: row.mimeType };
	}
);
