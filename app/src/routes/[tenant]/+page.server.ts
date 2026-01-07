import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.tenant) {
		return {
			stats: {
				totalClients: 0,
				activeProjects: 0,
				pendingTasks: 0,
				unpaidInvoices: 0
			}
		};
	}

	const tenantId = event.locals.tenant.id;

	// Get total clients
	const [clientsCount] = await db
		.select({ count: sql<number>`count(*)`.as('count') })
		.from(table.client)
		.where(eq(table.client.tenantId, tenantId));

	// Get active projects
	const [activeProjectsCount] = await db
		.select({ count: sql<number>`count(*)`.as('count') })
		.from(table.project)
		.where(and(eq(table.project.tenantId, tenantId), eq(table.project.status, 'active')));

	// Get pending tasks
	const [pendingTasksCount] = await db
		.select({ count: sql<number>`count(*)`.as('count') })
		.from(table.task)
		.where(
			and(
				eq(table.task.tenantId, tenantId),
				eq(table.task.status, 'todo')
			)
		);

	// Get unpaid invoices
	const [unpaidInvoicesCount] = await db
		.select({ count: sql<number>`count(*)`.as('count') })
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.status, 'sent')
			)
		);

	return {
		stats: {
			totalClients: Number(clientsCount?.count) || 0,
			activeProjects: Number(activeProjectsCount?.count) || 0,
			pendingTasks: Number(pendingTasksCount?.count) || 0,
			unpaidInvoices: Number(unpaidInvoicesCount?.count) || 0
		}
	};
};
