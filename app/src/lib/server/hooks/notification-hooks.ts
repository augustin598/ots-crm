import { getHooksManager } from '../plugins/hooks';
import { createNotification } from '../notifications';
import { db } from '../db';
import * as table from '../db/schema';
import { eq, and, or } from 'drizzle-orm';
import type {
	InvoiceCreatedEvent,
	InvoicePaidEvent,
	InvoiceStatusChangedEvent,
	TaskAssignedEvent,
	TaskCompletedEvent,
	ContractSignedEvent,
	ContractActivatedEvent,
	ContractExpiredEvent,
	SyncErrorEvent,
	LeadsImportedEvent,
	ClientCreatedEvent,
	ApprovalRequestedEvent
} from '../plugins/types';
import { logError, logInfo } from '$lib/server/logger';
import { notifyTaskAssigned, notifyTaskCompleted } from '../telegram/task-notifications';

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
 *
 * Idempotent: a globalThis symbol prevents double-registration across HMR or
 * accidental double-calls. Handlers are inline arrow functions (new reference
 * each call), so the hooks manager's Set can't dedupe them — this guard does.
 */
const NOTIFICATION_HOOKS_REGISTERED = Symbol.for('ots_crm_notification_hooks_registered');
const gt = globalThis as unknown as Record<symbol, boolean>;

export function registerNotificationHooks(): void {
	if (gt[NOTIFICATION_HOOKS_REGISTERED]) return;
	gt[NOTIFICATION_HOOKS_REGISTERED] = true;

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
						clientId: event.invoice.clientId,
						type: 'invoice.paid',
						title: 'Factură plătită',
						message: `Factura ${invoiceNumber} a fost marcată ca plătită`,
						link: link ?? undefined,
						metadata: { invoiceId: event.invoice.id },
						priority: 'low'
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
				clientId: event.clientId,
				type: 'task.assigned',
				title: 'Task asignat',
				message: `Ți-a fost asignat task-ul: "${event.taskTitle}"`,
				link: `/${event.tenantSlug}/tasks/${event.taskId}`,
				metadata: { taskId: event.taskId, assignedBy: event.assignedByUserId },
				priority: 'medium'
			});
		} catch (error) {
			logError('server', 'notification-hooks: failed to create task.assigned notification', {
				tenantId: event.tenantId
			});
		}
		void notifyTaskAssigned(event).catch(() => {});
	});

	// ---- Task Completed ----
	hooks.on('task.completed', async (event: TaskCompletedEvent) => {
		void notifyTaskCompleted(event).catch(() => {});
	});

	// ---- Contract Signed ----
	hooks.on('contract.signed', async (event: ContractSignedEvent) => {
		try {
			const adminUserIds = await getTenantAdminUserIds(event.tenantId);

			// Look up clientId from contract
			const [contract] = await db
				.select({ clientId: table.contract.clientId })
				.from(table.contract)
				.where(eq(table.contract.id, event.contractId))
				.limit(1);

			await Promise.all(
				adminUserIds.map((userId) =>
					createNotification({
						tenantId: event.tenantId,
						userId,
						clientId: contract?.clientId,
						type: 'contract.signed',
						title: 'Contract semnat',
						message: `Contractul "${event.contractTitle}" a fost semnat de ${event.signerEmail}`,
						link: `/${event.tenantSlug}/contracts/${event.contractId}`,
						metadata: { contractId: event.contractId, signerEmail: event.signerEmail },
						priority: 'medium'
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
						metadata: { source: event.source },
						priority: 'urgent'
					})
				)
			);
		} catch (error) {
			logError('server', 'notification-hooks: failed to create sync.error notification', {
				tenantId: event.tenantId
			});
		}
	});

	// ---- Leads Imported ----
	hooks.on('leads.imported', async (event: LeadsImportedEvent) => {
		try {
			if (event.imported === 0) return;

			const adminUserIds = await getTenantAdminUserIds(event.tenantId);

			const [tenant] = await db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, event.tenantId))
				.limit(1);

			const link = tenant ? `/${tenant.slug}/leads/facebook-ads` : undefined;
			const sourceLabel = event.source === 'scheduled' ? 'automat' : 'manual';
			const clientCount = event.clientIds?.length ?? 0;

			await Promise.all(
				adminUserIds.map((userId) =>
					createNotification({
						tenantId: event.tenantId,
						userId,
						type: 'lead.imported',
						title: `${event.imported} leaduri importate`,
						message: `Sync ${sourceLabel}: ${event.imported} noi${clientCount > 0 ? ` (${clientCount} clienti)` : ''}${event.errors > 0 ? `, ${event.errors} erori` : ''}`,
						link,
						priority: 'low'
					})
				)
			);
		} catch (error) {
			logError('server', 'notification-hooks: failed to create leads.imported notification', {
				tenantId: event.tenantId
			});
		}
	});

	// ---- Invoice Created ----
	hooks.on('invoice.created', async (event: InvoiceCreatedEvent) => {
		try {
			const adminUserIds = await getTenantAdminUserIds(event.tenantId);

			const [tenant] = await db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, event.tenantId))
				.limit(1);

			const invoiceNumber = event.invoice.invoiceNumber || 'N/A';
			const link = tenant ? `/${tenant.slug}/invoices/${event.invoice.id}` : null;

			await Promise.all(
				adminUserIds.map((userId) =>
					createNotification({
						tenantId: event.tenantId,
						userId,
						clientId: event.invoice.clientId,
						type: 'invoice.created',
						title: 'Factură nouă creată',
						message: `Factura ${invoiceNumber}${event.isRecurring ? ' (recurentă)' : ''} a fost creată`,
						link: link ?? undefined,
						metadata: { invoiceId: event.invoice.id },
						priority: 'medium'
					})
				)
			);
		} catch (error) {
			logError('server', 'notification-hooks: failed to create invoice.created notification', {
				tenantId: event.tenantId
			});
		}
	});

	// ---- Invoice Overdue (status changed to overdue) ----
	hooks.on('invoice.status.changed', async (event: InvoiceStatusChangedEvent) => {
		try {
			if (event.newStatus !== 'overdue') return;

			const adminUserIds = await getTenantAdminUserIds(event.tenantId);

			const [tenant] = await db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, event.tenantId))
				.limit(1);

			const invoiceNumber = event.invoice.invoiceNumber || 'N/A';
			const link = tenant ? `/${tenant.slug}/invoices/${event.invoice.id}` : null;

			await Promise.all(
				adminUserIds.map((userId) =>
					createNotification({
						tenantId: event.tenantId,
						userId,
						clientId: event.invoice.clientId,
						type: 'invoice.overdue',
						title: 'Factură restantă',
						message: `Factura ${invoiceNumber} a depășit termenul de plată`,
						link: link ?? undefined,
						metadata: { invoiceId: event.invoice.id },
						priority: 'high'
					})
				)
			);
		} catch (error) {
			logError('server', 'notification-hooks: failed to create invoice.overdue notification', {
				tenantId: event.tenantId
			});
		}
	});

	// ---- Contract Activated ----
	hooks.on('contract.activated', async (event: ContractActivatedEvent) => {
		try {
			const adminUserIds = await getTenantAdminUserIds(event.tenantId);

			await Promise.all(
				adminUserIds.map((userId) =>
					createNotification({
						tenantId: event.tenantId,
						userId,
						clientId: event.clientId,
						type: 'contract.activated',
						title: 'Contract activat',
						message: `Contractul "${event.contractTitle}" a fost activat automat`,
						link: `/${event.tenantSlug}/contracts/${event.contractId}`,
						metadata: { contractId: event.contractId },
						priority: 'medium'
					})
				)
			);
		} catch (error) {
			logError('server', 'notification-hooks: failed to create contract.activated notification', {
				tenantId: event.tenantId
			});
		}
	});

	// ---- Contract Expired ----
	hooks.on('contract.expired', async (event: ContractExpiredEvent) => {
		try {
			const adminUserIds = await getTenantAdminUserIds(event.tenantId);

			await Promise.all(
				adminUserIds.map((userId) =>
					createNotification({
						tenantId: event.tenantId,
						userId,
						clientId: event.clientId,
						type: 'contract.expired',
						title: 'Contract expirat',
						message: `Contractul "${event.contractTitle}" a expirat`,
						link: `/${event.tenantSlug}/contracts/${event.contractId}`,
						metadata: { contractId: event.contractId },
						priority: 'high'
					})
				)
			);
		} catch (error) {
			logError('server', 'notification-hooks: failed to create contract.expired notification', {
				tenantId: event.tenantId
			});
		}
	});

	// ---- Client Created ----
	hooks.on('client.created', async (event: ClientCreatedEvent) => {
		try {
			const adminUserIds = await getTenantAdminUserIds(event.tenantId);

			await Promise.all(
				adminUserIds.map((userId) =>
					createNotification({
						tenantId: event.tenantId,
						userId,
						clientId: event.client.id,
						type: 'client.created',
						title: 'Client nou adaugat',
						message: `Clientul "${event.client.name}" a fost adaugat`,
						link: `/${event.tenantSlug}/clients/${event.client.id}`,
						priority: 'medium',
					})
				)
			);
		} catch (error) {
			logError('server', 'notification-hooks: failed to create client.created notification', {
				tenantId: event.tenantId
			});
		}
	});

	// ---- Task Approval Requested ----
	hooks.on('approval.requested', async (event: ApprovalRequestedEvent) => {
		try {
			const adminUserIds = await getTenantAdminUserIds(event.tenantId);

			await Promise.all(
				adminUserIds.map((userId) =>
					createNotification({
						tenantId: event.tenantId,
						userId,
						type: 'approval.requested',
						title: 'Task necesită aprobare',
						message: `Task-ul "${event.taskTitle}" așteaptă aprobare`,
						link: `/${event.tenantSlug}/tasks/${event.taskId}`,
						priority: 'high',
					})
				)
			);
		} catch (error) {
			logError('server', 'notification-hooks: failed to create approval.requested notification', {
				metadata: { tenantId: event.tenantId, taskId: event.taskId }
			});
		}
	});

	logInfo('server', 'Notification hooks registered');
}
