import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, lt, ne, isNotNull, or } from 'drizzle-orm';
import { createNotification } from '$lib/server/notifications';
import { logInfo, logError } from '$lib/server/logger';

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
 * Check for unpaid invoices past due date and create grouped reminder notifications.
 * Runs daily at 08:00.
 */
export async function processInvoiceReminderNotifications(): Promise<void> {
	try {
		const now = new Date();

		const overdueInvoices = await db
			.select({
				id: table.invoice.id,
				tenantId: table.invoice.tenantId,
				clientId: table.invoice.clientId,
				invoiceNumber: table.invoice.invoiceNumber,
				dueDate: table.invoice.dueDate,
			})
			.from(table.invoice)
			.where(
				and(
					ne(table.invoice.status, 'paid'),
					ne(table.invoice.status, 'partially_paid'),
					ne(table.invoice.status, 'cancelled'),
					ne(table.invoice.status, 'draft'),
					isNotNull(table.invoice.dueDate),
					lt(table.invoice.dueDate, now)
				)
			);

		if (overdueInvoices.length === 0) return;

		// Group by tenant
		const byTenant = new Map<string, typeof overdueInvoices>();
		for (const inv of overdueInvoices) {
			const list = byTenant.get(inv.tenantId) ?? [];
			list.push(inv);
			byTenant.set(inv.tenantId, list);
		}

		let totalNotified = 0;

		for (const [tenantId, invoices] of byTenant) {
			const adminUserIds = await getTenantAdminUserIds(tenantId);
			const [tenant] = await db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, tenantId))
				.limit(1);

			const link = tenant ? `/${tenant.slug}/invoices?status=overdue` : undefined;
			const oldestDays = Math.max(...invoices.map((i) => {
				const diff = now.getTime() - new Date(i.dueDate!).getTime();
				return Math.floor(diff / (24 * 60 * 60 * 1000));
			}));

			for (const userId of adminUserIds) {
				await createNotification({
					tenantId,
					userId,
					type: 'invoice.reminder',
					title: `${invoices.length} facturi restante`,
					message: `${invoices.length} facturi neplatite, cea mai veche de ${oldestDays} zile`,
					link,
					priority: 'high',
					metadata: { invoiceCount: invoices.length, oldestDays },
				});
				totalNotified++;
			}
		}

		logInfo('scheduler', `Invoice reminder notifications: ${overdueInvoices.length} overdue across ${byTenant.size} tenants`, {
			metadata: { overdueCount: overdueInvoices.length, tenantCount: byTenant.size, notified: totalNotified }
		});
	} catch (error) {
		logError('scheduler', `Invoice reminder notifications failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
