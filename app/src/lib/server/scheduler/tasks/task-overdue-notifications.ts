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
 * Check for tasks overdue by more than 3 days and create grouped notifications.
 * Runs daily at 09:00.
 */
export async function processTaskOverdueNotifications(): Promise<void> {
	try {
		const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

		const overdueTasks = await db
			.select({
				id: table.task.id,
				tenantId: table.task.tenantId,
				clientId: table.task.clientId,
				title: table.task.title,
				dueDate: table.task.dueDate,
			})
			.from(table.task)
			.where(
				and(
					ne(table.task.status, 'done'),
					ne(table.task.status, 'cancelled'),
					isNotNull(table.task.dueDate),
					lt(table.task.dueDate, threeDaysAgo)
				)
			);

		if (overdueTasks.length === 0) return;

		// Group by tenant
		const byTenant = new Map<string, typeof overdueTasks>();
		for (const t of overdueTasks) {
			const list = byTenant.get(t.tenantId) ?? [];
			list.push(t);
			byTenant.set(t.tenantId, list);
		}

		let totalNotified = 0;

		for (const [tenantId, tasks] of byTenant) {
			const adminUserIds = await getTenantAdminUserIds(tenantId);
			const [tenant] = await db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, tenantId))
				.limit(1);

			for (const userId of adminUserIds) {
				await createNotification({
					tenantId,
					userId,
					type: 'task.overdue',
					title: `${tasks.length} taskuri intarziate`,
					message: `${tasks.length} taskuri au depasit deadline-ul cu mai mult de 3 zile`,
					link: tenant ? `/${tenant.slug}/tasks` : undefined,
					priority: 'medium',
				});
				totalNotified++;
			}
		}

		logInfo('scheduler', `Task overdue notifications: ${overdueTasks.length} overdue across ${byTenant.size} tenants`, {
			metadata: { overdueCount: overdueTasks.length, tenantCount: byTenant.size, notified: totalNotified }
		});
	} catch (error) {
		logError('scheduler', `Task overdue notifications failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
