import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logError, logInfo } from '$lib/server/logger';

// ---- Types ----

export type NotificationType =
	| 'task.assigned'
	| 'task.completed'
	| 'invoice.created'
	| 'invoice.paid'
	| 'invoice.overdue'
	| 'contract.signed'
	| 'contract.activated'
	| 'contract.expired'
	| 'lead.imported'
	| 'lead.status_changed'
	| 'ad.spending_synced'
	| 'sync.error'
	| 'integration.auth_expired'
	| 'system';

export interface CreateNotificationParams {
	tenantId: string;
	userId: string;
	clientId?: string | null;
	type: NotificationType;
	title: string;
	message: string;
	link?: string | null;
	metadata?: Record<string, unknown>;
	/** Override createdAt (used for backfilling historical events). */
	createdAt?: Date;
}

// ---- SSE Controller Map ----
// In-process map — works for single-instance Docker deployment.
// NOTE: If the app is ever scaled to multiple instances, migrate to Redis Pub/Sub.
const sseControllers = new Map<string, ReadableStreamDefaultController<Uint8Array>>();

const encoder = new TextEncoder();

function formatSSEEvent(event: string, data: unknown): Uint8Array {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ---- Public API ----

/**
 * Register an SSE controller for a user.
 * Called when the user's browser connects to /api/notifications/stream.
 */
export function registerSSE(
	userId: string,
	controller: ReadableStreamDefaultController<Uint8Array>
): void {
	sseControllers.set(userId, controller);
}

/**
 * Unregister an SSE controller when the connection is closed.
 */
export function unregisterSSE(userId: string): void {
	sseControllers.delete(userId);
}

/**
 * Create a notification, persist it to the DB, and push it via SSE if the user is online.
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
	const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));

	const newNotification: table.NewNotification = {
		id,
		tenantId: params.tenantId,
		userId: params.userId,
		clientId: params.clientId ?? null,
		type: params.type,
		title: params.title,
		message: params.message,
		link: params.link ?? null,
		isRead: false,
		metadata: params.metadata ?? null,
		createdAt: params.createdAt ?? new Date()
	};

	await db.insert(table.notification).values(newNotification);

	// Push to SSE if user is currently connected
	const controller = sseControllers.get(params.userId);
	if (controller) {
		try {
			const notif = { ...newNotification, clientId: newNotification.clientId ?? null, link: newNotification.link ?? null, isRead: newNotification.isRead ?? false, metadata: newNotification.metadata ?? null, createdAt: new Date() } satisfies table.Notification;
			controller.enqueue(formatSSEEvent('notification', notif));
		} catch {
			// Controller may be closed — remove it silently
			sseControllers.delete(params.userId);
		}
	}
}

/**
 * Mark one or all notifications as read for a user.
 * If clientId is provided, also marks client-scoped notifications.
 */
export async function markNotificationsRead(
	userId: string,
	tenantId: string,
	ids?: string[],
	clientId?: string | null
): Promise<void> {
	// Build ownership condition: user's own OR client-scoped notifications
	const ownerCondition = clientId
		? or(eq(table.notification.userId, userId), eq(table.notification.clientId, clientId))
		: eq(table.notification.userId, userId);

	if (ids && ids.length > 0) {
		await db
			.update(table.notification)
			.set({ isRead: true })
			.where(
				and(
					ownerCondition,
					eq(table.notification.tenantId, tenantId),
					inArray(table.notification.id, ids)
				)
			);
	} else {
		await db
			.update(table.notification)
			.set({ isRead: true })
			.where(
				and(
					ownerCondition,
					eq(table.notification.tenantId, tenantId)
				)
			);
	}
}

/**
 * Delete specific notifications or all for a user.
 * If clientId is provided, also deletes client-scoped notifications.
 */
export async function deleteNotifications(
	userId: string,
	tenantId: string,
	ids?: string[],
	clientId?: string | null
): Promise<number> {
	const ownerCondition = clientId
		? or(eq(table.notification.userId, userId), eq(table.notification.clientId, clientId))
		: eq(table.notification.userId, userId);

	if (ids && ids.length > 0) {
		const result = await db
			.delete(table.notification)
			.where(
				and(
					ownerCondition,
					eq(table.notification.tenantId, tenantId),
					inArray(table.notification.id, ids)
				)
			);
		return result.rowsAffected;
	} else {
		const result = await db
			.delete(table.notification)
			.where(
				and(
					ownerCondition,
					eq(table.notification.tenantId, tenantId)
				)
			);
		return result.rowsAffected;
	}
}
