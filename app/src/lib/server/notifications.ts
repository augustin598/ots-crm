import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logError, logInfo } from '$lib/server/logger';

// ---- Types ----

export type NotificationType =
	// Tasks
	| 'task.assigned'
	| 'task.completed'
	| 'task.overdue'
	// Invoices
	| 'invoice.created'
	| 'invoice.paid'
	| 'invoice.overdue'
	| 'invoice.reminder'
	// Contracts
	| 'contract.signed'
	| 'contract.activated'
	| 'contract.expired'
	| 'contract.expiring'
	// Leads & Marketing
	| 'lead.imported'
	| 'lead.status_changed'
	| 'ad.spending_synced'
	// Budget
	| 'budget.exceeded'
	| 'budget.warning'
	// Integrations
	| 'sync.error'
	| 'integration.auth_expired'
	| 'integration.auth_expiring'
	| 'keez.sync_error'
	| 'smartbill.sync_error'
	// Communication
	| 'email.delivery_failed'
	| 'comment.mention'
	| 'approval.requested'
	// Clients
	| 'client.created'
	// System
	| 'system'
	| 'system.db_error'
	| 'scheduler.job_failed';

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
	priority?: 'low' | 'medium' | 'high' | 'urgent';
}

// ---- Grouping ----

const GROUPABLE_TYPES: Set<NotificationType> = new Set([
	'lead.imported',
	'ad.spending_synced',
	'email.delivery_failed',
	'invoice.reminder',
	'contract.expiring',
	'task.overdue',
]);

const GROUP_TITLES: Partial<Record<NotificationType, (count: number) => string>> = {
	'lead.imported': (n) => `${n} leaduri importate azi`,
	'ad.spending_synced': (n) => `${n} conturi sincronizate`,
	'email.delivery_failed': (n) => `${n} emailuri esuate`,
	'invoice.reminder': (n) => `${n} facturi restante`,
	'contract.expiring': (n) => `${n} contracte expira curand`,
	'task.overdue': (n) => `${n} taskuri intarziate`,
};

function generateFingerprint(tenantId: string, userId: string, type: string, clientId: string | null): string {
	const dateKey = new Date().toISOString().split('T')[0];
	const raw = `${tenantId}:${userId}:${type}:${clientId ?? 'global'}:${dateKey}`;
	let hash = 0;
	for (let i = 0; i < raw.length; i++) {
		const char = raw.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash |= 0;
	}
	return `fp_${Math.abs(hash).toString(36)}`;
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
 * Groupable types are upserted by fingerprint (one row per user+type+day).
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
	const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
	const now = params.createdAt ?? new Date();
	const priority = params.priority ?? 'medium';
	const isGroupable = GROUPABLE_TYPES.has(params.type);

	if (isGroupable) {
		const fingerprint = generateFingerprint(params.tenantId, params.userId, params.type, params.clientId ?? null);

		// Check for existing group
		const [existing] = await db
			.select({ id: table.notification.id, count: table.notification.count })
			.from(table.notification)
			.where(eq(table.notification.fingerprint, fingerprint))
			.limit(1);

		if (existing) {
			const newCount = existing.count + 1;
			const titleFn = GROUP_TITLES[params.type];
			const newTitle = titleFn ? titleFn(newCount) : params.title;

			await db.update(table.notification)
				.set({
					count: newCount,
					title: newTitle,
					message: params.message,
					updatedAt: now,
					isRead: false,
					priority,
				})
				.where(eq(table.notification.id, existing.id));

			// Push updated notification via SSE
			broadcastNotification(params.userId, {
				id: existing.id,
				tenantId: params.tenantId,
				userId: params.userId,
				clientId: params.clientId ?? null,
				type: params.type,
				title: newTitle,
				message: params.message,
				link: params.link ?? null,
				isRead: false,
				metadata: params.metadata ?? null,
				createdAt: now,
				priority,
				fingerprint,
				count: newCount,
				updatedAt: now,
				lastEmailAt: null,
			});
			return;
		}

		// No existing group — insert with fingerprint
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
			createdAt: now,
			priority,
			fingerprint,
			count: 1,
			updatedAt: now,
			lastEmailAt: null,
		};

		await db.insert(table.notification).values(newNotification);
		broadcastNotification(params.userId, newNotification);
		return;
	}

	// Non-groupable: standard insert
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
		createdAt: now,
		priority,
		fingerprint: null,
		count: 1,
		updatedAt: now,
		lastEmailAt: null,
	};

	await db.insert(table.notification).values(newNotification);
	broadcastNotification(params.userId, newNotification);
}

/** Push a notification to the user via SSE if they are connected. */
function broadcastNotification(userId: string, notif: table.NewNotification | table.Notification): void {
	const controller = sseControllers.get(userId);
	if (!controller) return;
	try {
		controller.enqueue(formatSSEEvent('notification', notif));
	} catch {
		sseControllers.delete(userId);
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
