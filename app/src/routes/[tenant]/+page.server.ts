import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql, desc, or, lt, gte } from 'drizzle-orm';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.tenant) {
		return {
			stats: {
				totalRevenue: 0,
				activeClients: 0,
				activeProjects: 0,
				pendingInvoicesAmount: 0,
				pendingInvoicesCount: 0,
				overdueInvoicesCount: 0
			},
			recentActivity: [],
			upcomingTasks: []
		};
	}

	const tenantId = event.locals.tenant.id;

	// Get total revenue (sum of paid invoices)
	const [revenueResult] = await db
		.select({ total: sql<number>`coalesce(sum(${table.invoice.totalAmount}), 0)`.as('total') })
		.from(table.invoice)
		.where(and(eq(table.invoice.tenantId, tenantId), eq(table.invoice.status, 'paid')));

	// Get active clients count
	const [activeClientsCount] = await db
		.select({ count: sql<number>`count(*)`.as('count') })
		.from(table.client)
		.where(and(eq(table.client.tenantId, tenantId), eq(table.client.status, 'active')));

	// Get active projects count
	const [activeProjectsCount] = await db
		.select({ count: sql<number>`count(*)`.as('count') })
		.from(table.project)
		.where(and(eq(table.project.tenantId, tenantId), eq(table.project.status, 'active')));

	// Get pending invoices amount and count
	const [pendingInvoicesResult] = await db
		.select({
			total: sql<number>`coalesce(sum(${table.invoice.totalAmount}), 0)`.as('total'),
			count: sql<number>`count(*)`.as('count')
		})
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				or(eq(table.invoice.status, 'sent'), eq(table.invoice.status, 'draft'))
			)
		);

	// Get overdue invoices count
	const now = new Date();
	const [overdueInvoicesCount] = await db
		.select({ count: sql<number>`count(*)`.as('count') })
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.status, 'sent'),
				sql`${table.invoice.dueDate} IS NOT NULL`,
				lt(table.invoice.dueDate, now)
			)
		);

	// Get recent activity (last 10 items: invoices, projects, clients)
	const recentInvoices = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			createdAt: table.invoice.createdAt,
			clientId: table.invoice.clientId
		})
		.from(table.invoice)
		.where(eq(table.invoice.tenantId, tenantId))
		.orderBy(desc(table.invoice.createdAt))
		.limit(5);

	const recentProjects = await db
		.select({
			id: table.project.id,
			name: table.project.name,
			updatedAt: table.project.updatedAt,
			clientId: table.project.clientId
		})
		.from(table.project)
		.where(eq(table.project.tenantId, tenantId))
		.orderBy(desc(table.project.updatedAt))
		.limit(5);

	const recentClients = await db
		.select({
			id: table.client.id,
			name: table.client.name,
			createdAt: table.client.createdAt
		})
		.from(table.client)
		.where(eq(table.client.tenantId, tenantId))
		.orderBy(desc(table.client.createdAt))
		.limit(5);

	// Combine and sort recent activity
	const tenantSlug = event.params.tenant;
	const allActivity = [
		...recentInvoices.map((inv) => ({
			id: inv.id,
			type: 'invoice' as const,
			action: 'New invoice created',
			detail: inv.invoiceNumber,
			link: `/${tenantSlug}/invoices/${inv.id}`,
			createdAt: inv.createdAt,
			clientId: inv.clientId
		})),
		...recentProjects.map((proj) => ({
			id: proj.id,
			type: 'project' as const,
			action: 'Project updated',
			detail: proj.name,
			link: `/${tenantSlug}/projects/${proj.id}`,
			createdAt: proj.updatedAt,
			clientId: proj.clientId
		})),
		...recentClients.map((client) => ({
			id: client.id,
			type: 'client' as const,
			action: 'New client added',
			detail: client.name,
			link: `/${tenantSlug}/clients/${client.id}`,
			createdAt: client.createdAt,
			clientId: null
		}))
	]
		.sort((a, b) => {
			const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
			const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
			return dateB.getTime() - dateA.getTime();
		})
		.slice(0, 10);

	// Get upcoming tasks (tasks with due dates in the future, ordered by due date)
	const allTasks = await db
		.select({
			id: table.task.id,
			title: table.task.title,
			projectId: table.task.projectId,
			priority: table.task.priority,
			dueDate: table.task.dueDate,
			projectName: table.project.name
		})
		.from(table.task)
		.leftJoin(table.project, eq(table.task.projectId, table.project.id))
		.where(
			and(
				eq(table.task.tenantId, tenantId),
				or(eq(table.task.status, 'todo'), eq(table.task.status, 'in-progress')),
				sql`${table.task.dueDate} IS NOT NULL`
			)
		)
		.orderBy(table.task.dueDate)
		.limit(20);

	// Filter tasks with due dates in the future
	const upcomingTasksData = allTasks
		.filter((task) => {
			if (!task.dueDate) return false;
			const dueDate = task.dueDate instanceof Date ? task.dueDate : new Date(task.dueDate);
			return dueDate >= now;
		})
		.slice(0, 5);

	return {
		stats: {
			totalRevenue: Number(revenueResult?.total) || 0,
			activeClients: Number(activeClientsCount?.count) || 0,
			activeProjects: Number(activeProjectsCount?.count) || 0,
			pendingInvoicesAmount: Number(pendingInvoicesResult?.total) || 0,
			pendingInvoicesCount: Number(pendingInvoicesResult?.count) || 0,
			overdueInvoicesCount: Number(overdueInvoicesCount?.count) || 0
		},
		recentActivity: allActivity,
		upcomingTasks: upcomingTasksData.map((task) => ({
			id: task.id,
			title: task.title,
			project: task.projectName || 'No project',
			priority: task.priority || 'medium',
			dueDate: task.dueDate
		}))
	};
};
