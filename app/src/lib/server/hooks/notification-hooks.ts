import { getHooksManager } from '../plugins/hooks';
import { createNotification } from '../notifications';
import { db } from '../db';
import * as table from '../db/schema';
import { eq, and, or } from 'drizzle-orm';
import type {
	InvoicePaidEvent,
	TaskAssignedEvent,
	ContractSignedEvent,
	SyncErrorEvent
} from '../plugins/types';
import { logError, logInfo } from '$lib/server/logger';

/**
 * Get all owner/admin user IDs for a tenant (used to broadcast notifications).
 */
async function getTenantAdminUserIds(tenantId: string): Promise<string[]> {
	const tenantUsers = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(
			and(
				eq(table.tenantUser.tenantId, tenantId),
				or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
			)
		);
	return tenantUsers.map((tu) => tu.userId);
}

/**
 * Register in-app notification hooks.
 *
 * IMPORTANT: All handlers MUST catch their own errors and NOT re-throw.
 * The hooks.emit() uses Promise.all() — a re-thrown error here would
 * cancel other hooks (e.g., email hooks) from running.
 */
export function registerNotificationHooks(): void {
	const hooks = getHooksManager();

	// ---- Invoice Paid ----
	hooks.on('invoice.paid', async (event: InvoicePaidEvent) => {
		try {
			const adminUserIds = await getTenantAdminUserIds(event.tenantId);
			const invoiceNumber = event.invoice.invoiceNumber || 'N/A';

			// Get tenant slug for the link
			const [tenant] = await db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, event.tenantId))
				.limit(1);

			const link = tenant ? `/${tenant.slug}/invoices/${event.invoice.id}` : null;

			await Promise.all(
				adminUserIds.map((userId) =>
					createNotification({
						tenantId: event.tenantId,
						userId,
						type: 'invoice.paid',
						title: 'Factură plătită',
						message: `Factura ${invoiceNumber} a fost marcată ca plătită`,
						link: link ?? undefined,
						metadata: { invoiceId: event.invoice.id }
					})
				)
			);
		} catch (error) {
			logError('server', 'notification-hooks: failed to create invoice.paid notification', {
				tenantId: event.tenantId
			});
		}
	});

	// ---- Task Assigned ----
	hooks.on('task.assigned', async (event: TaskAssignedEvent) => {
		try {
			await createNotification({
				tenantId: event.tenantId,
				userId: event.assignedToUserId,
				type: 'task.assigned',
				title: 'Task asignat',
				message: `Ți-a fost asignat task-ul: "${event.taskTitle}"`,
				link: `/${event.tenantSlug}/tasks/${event.taskId}`,
				metadata: { taskId: event.taskId, assignedBy: event.assignedByUserId }
			});
		} catch (error) {
			logError('server', 'notification-hooks: failed to create task.assigned notification', {
				tenantId: event.tenantId
			});
		}
	});

	// ---- Contract Signed ----
	hooks.on('contract.signed', async (event: ContractSignedEvent) => {
		try {
			const adminUserIds = await getTenantAdminUserIds(event.tenantId);

			await Promise.all(
				adminUserIds.map((userId) =>
					createNotification({
						tenantId: event.tenantId,
						userId,
						type: 'contract.signed',
						title: 'Contract semnat',
						message: `Contractul "${event.contractTitle}" a fost semnat de ${event.signerEmail}`,
						link: `/${event.tenantSlug}/contracts/${event.contractId}`,
						metadata: { contractId: event.contractId, signerEmail: event.signerEmail }
					})
				)
			);
		} catch (error) {
			logError('server', 'notification-hooks: failed to create contract.signed notification', {
				tenantId: event.tenantId
			});
		}
	});

	// ---- Sync Error ----
	hooks.on('sync.error', async (event: SyncErrorEvent) => {
		try {
			const adminUserIds = await getTenantAdminUserIds(event.tenantId);

			// Get tenant slug
			const [tenant] = await db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, event.tenantId))
				.limit(1);

			await Promise.all(
				adminUserIds.map((userId) =>
					createNotification({
						tenantId: event.tenantId,
						userId,
						type: 'sync.error',
						title: `Eroare sincronizare ${event.source}`,
						message: event.message,
						link: tenant ? `/${tenant.slug}/admin/logs` : undefined,
						metadata: { source: event.source }
					})
				)
			);
		} catch (error) {
			logError('server', 'notification-hooks: failed to create sync.error notification', {
				tenantId: event.tenantId
			});
		}
	});

	logInfo('server', 'Notification hooks registered');
}
