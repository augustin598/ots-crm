import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql, desc, or, lt, gte, inArray } from 'drizzle-orm';
import type {
	DashboardData,
	KpiData,
	AlertData,
	ActivityItem,
	TaskItem,
	TeamMember,
	TopClient,
	TodayEvent,
	FunnelStage,
	RevenuePoint,
	Accent
} from '$lib/components/dashboard/types';
import { adsPlatforms, synthSpark, seeded } from '$lib/components/dashboard/demo';
import { initials, timeAgo, fmtRON } from '$lib/components/dashboard/format';

const RO_MONTHS = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROLE_LABEL: Record<string, string> = {
	owner: 'Owner',
	admin: 'Administrator',
	manager: 'Manager',
	member: 'Membru',
	viewer: 'Viewer'
};
const DAY_MS = 86400000;

function greetingFor(now: Date): string {
	const h = now.getHours();
	return h < 12 ? 'Bună dimineața' : h < 18 ? 'Bună ziua' : 'Bună seara';
}

/** Deterministic placeholder delta (percent) for KPIs without a real prior series. */
const synthDelta = (seed: string) => Math.round((seeded(seed) * 28 - 4) * 10) / 10;

function emptyDashboard(now: Date): DashboardData {
	return {
		greeting: greetingFor(now),
		userName: '',
		alertSummary: 'Totul e la zi.',
		kpis: [],
		alerts: [],
		topClients: [],
		team: [],
		activity: [],
		tasks: [],
		revenue12m: [],
		cashflow: [],
		funnel: [],
		adsPlatforms: adsPlatforms(),
		todayEvents: [],
		demoFlags: { ads: true, revenueChart: false, cashflow: false, funnel: false, today: false }
	};
}

export const load: PageServerLoad = async (event) => {
	const now = new Date();
	if (!event.locals.tenant) {
		return { dashboard: emptyDashboard(now) };
	}

	const tenantId = event.locals.tenant.id;
	const slug = event.params.tenant;
	const base = `/${slug}`;
	const userName = event.locals.user?.firstName ?? '';
	const userInitials = initials(
		`${event.locals.user?.firstName ?? ''} ${event.locals.user?.lastName ?? ''}`
	);

	// ---- 12-month window (revenue + expenses + leads) ----
	const twelveAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
	const startKey = now.getFullYear() * 12 + now.getMonth() - 11;
	const bucketIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth() - startKey;

	const paidRows = await db
		.select({ issueDate: table.invoice.issueDate, totalAmount: table.invoice.totalAmount })
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.status, 'paid'),
				gte(table.invoice.issueDate, twelveAgo)
			)
		);
	const revBuckets = new Array(12).fill(0);
	for (const r of paidRows) {
		if (!r.issueDate) continue;
		const idx = bucketIndex(r.issueDate instanceof Date ? r.issueDate : new Date(r.issueDate));
		if (idx >= 0 && idx < 12) revBuckets[idx] += Number(r.totalAmount) || 0;
	}

	const expenseRows = await db
		.select({ date: table.expense.date, amount: table.expense.amount })
		.from(table.expense)
		.where(and(eq(table.expense.tenantId, tenantId), gte(table.expense.date, twelveAgo)));
	const expBuckets = new Array(12).fill(0);
	for (const r of expenseRows) {
		if (!r.date) continue;
		const idx = bucketIndex(r.date instanceof Date ? r.date : new Date(r.date));
		if (idx >= 0 && idx < 12) expBuckets[idx] += Number(r.amount) || 0;
	}

	const revenueSpark = revBuckets.map((c) => Math.round(c / 100));
	const curRevenue = revenueSpark[11];
	const prevRevenue = revenueSpark[10];
	const revDelta = prevRevenue > 0 ? ((curRevenue - prevRevenue) / prevRevenue) * 100 : 0;

	const revenue12m: RevenuePoint[] = Array.from({ length: 12 }, (_, i) => {
		const dt = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
		return {
			m: `${RO_MONTHS[dt.getMonth()]} '${String(dt.getFullYear()).slice(2)}`,
			revenue: Math.round(revBuckets[i] / 100),
			expenses: Math.round(expBuckets[i] / 100)
		};
	});

	// ---- leads (12-month buckets) ----
	const leadDateRows = await db
		.select({ createdAt: table.lead.createdAt })
		.from(table.lead)
		.where(and(eq(table.lead.tenantId, tenantId), gte(table.lead.createdAt, twelveAgo)));
	const leadBuckets = new Array(12).fill(0);
	for (const r of leadDateRows) {
		const idx = bucketIndex(r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt));
		if (idx >= 0 && idx < 12) leadBuckets[idx] += 1;
	}
	const curLeads = leadBuckets[11];
	const prevLeads = leadBuckets[10];
	const leadsDelta = prevLeads > 0 ? ((curLeads - prevLeads) / prevLeads) * 100 : curLeads > 0 ? 100 : 0;

	// ---- counts ----
	const [activeClientsRow] = await db
		.select({ count: sql<number>`count(*)`.as('count') })
		.from(table.client)
		.where(and(eq(table.client.tenantId, tenantId), eq(table.client.status, 'active')));
	const activeClients = Number(activeClientsRow?.count) || 0;

	const [activeProjectsRow] = await db
		.select({ count: sql<number>`count(*)`.as('count') })
		.from(table.project)
		.where(and(eq(table.project.tenantId, tenantId), eq(table.project.status, 'active')));
	const activeProjects = Number(activeProjectsRow?.count) || 0;

	const [pendingRow] = await db
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
	const pendingAmount = Math.round((Number(pendingRow?.total) || 0) / 100);
	const pendingCount = Number(pendingRow?.count) || 0;

	const [overdueRow] = await db
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
	const overdueCount = Number(overdueRow?.count) || 0;

	// ---- cash-flow forecast (real, next 30 days) ----
	const cfStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const cfEnd = new Date(cfStart.getTime() + 30 * DAY_MS);
	const cfIn = new Array(30).fill(0);
	const cfOut = new Array(30).fill(0);

	const inflowRows = await db
		.select({ dueDate: table.invoice.dueDate, totalAmount: table.invoice.totalAmount })
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				or(eq(table.invoice.status, 'sent'), eq(table.invoice.status, 'overdue')),
				gte(table.invoice.dueDate, cfStart),
				lt(table.invoice.dueDate, cfEnd)
			)
		);
	for (const r of inflowRows) {
		if (!r.dueDate) continue;
		const idx = Math.floor((new Date(r.dueDate).getTime() - cfStart.getTime()) / DAY_MS);
		if (idx >= 0 && idx < 30) cfIn[idx] += (Number(r.totalAmount) || 0) / 100;
	}

	const outflowRows = await db
		.select({ dueDate: table.supplierInvoice.dueDate, amount: table.supplierInvoice.amount })
		.from(table.supplierInvoice)
		.where(
			and(
				eq(table.supplierInvoice.tenantId, tenantId),
				or(eq(table.supplierInvoice.status, 'unpaid'), eq(table.supplierInvoice.status, 'pending')),
				gte(table.supplierInvoice.dueDate, cfStart),
				lt(table.supplierInvoice.dueDate, cfEnd)
			)
		);
	for (const r of outflowRows) {
		if (!r.dueDate) continue;
		const idx = Math.floor((new Date(r.dueDate).getTime() - cfStart.getTime()) / DAY_MS);
		if (idx >= 0 && idx < 30) cfOut[idx] += (Number(r.amount) || 0) / 100;
	}
	const cashflow = Array.from({ length: 30 }, (_, i) => ({
		day: i + 1,
		inflow: Math.round(cfIn[i]),
		outflow: Math.round(cfOut[i])
	}));

	// ---- conversion funnel (real, from lead statuses) ----
	const leadStatusRows = await db
		.select({ status: table.lead.status, n: sql<number>`count(*)`.as('n') })
		.from(table.lead)
		.where(eq(table.lead.tenantId, tenantId))
		.groupBy(table.lead.status);
	const statusCount = (statuses: string[]) =>
		leadStatusRows.filter((r) => statuses.includes(r.status)).reduce((s, r) => s + Number(r.n), 0);
	const totalLeads = leadStatusRows.reduce((s, r) => s + Number(r.n), 0);
	const funnel: FunnelStage[] = [
		{ stage: 'Leads', value: totalLeads, colorVar: 'var(--chart-1)' },
		{ stage: 'Contactați', value: statusCount(['contacted', 'qualified', 'converted']), colorVar: 'var(--chart-2)' },
		{ stage: 'Calificați', value: statusCount(['qualified', 'converted']), colorVar: 'var(--chart-3)' },
		{ stage: 'Convertiți', value: statusCount(['converted']), colorVar: 'var(--chart-4)' }
	];

	// ---- top clients (paid revenue) + projects per client ----
	const topRows = await db
		.select({
			clientId: table.invoice.clientId,
			name: table.client.name,
			revenue: sql<number>`coalesce(sum(${table.invoice.totalAmount}), 0)`.as('revenue')
		})
		.from(table.invoice)
		.innerJoin(
			table.client,
			and(eq(table.invoice.clientId, table.client.id), eq(table.client.tenantId, tenantId))
		)
		.where(and(eq(table.invoice.tenantId, tenantId), eq(table.invoice.status, 'paid')))
		.groupBy(table.invoice.clientId, table.client.name)
		.orderBy(desc(sql`coalesce(sum(${table.invoice.totalAmount}), 0)`))
		.limit(5);

	const topClientIds = topRows.map((r) => r.clientId).filter((id): id is string => !!id);
	let projCounts: Record<string, number> = {};
	if (topClientIds.length) {
		const pc = await db
			.select({ clientId: table.project.clientId, n: sql<number>`count(*)`.as('n') })
			.from(table.project)
			.where(and(eq(table.project.tenantId, tenantId), inArray(table.project.clientId, topClientIds)))
			.groupBy(table.project.clientId);
		projCounts = Object.fromEntries(pc.map((r) => [r.clientId as string, Number(r.n)]));
	}
	const topClients: TopClient[] = topRows.map((r) => ({
		name: r.name,
		revenue: Math.round((Number(r.revenue) || 0) / 100),
		projects: projCounts[r.clientId ?? ''] ?? 0,
		change: Math.round(seeded(`${r.clientId}chg`) * 40 - 8),
		avatar: initials(r.name)
	}));

	// ---- team ----
	const teamRows = await db
		.select({
			firstName: table.user.firstName,
			lastName: table.user.lastName,
			role: table.tenantUser.role,
			title: table.tenantUser.title
		})
		.from(table.tenantUser)
		.innerJoin(table.user, eq(table.tenantUser.userId, table.user.id))
		.where(and(eq(table.tenantUser.tenantId, tenantId), eq(table.tenantUser.status, 'active')))
		.limit(8);
	const team: TeamMember[] = teamRows.map((u) => {
		const name = `${u.firstName} ${u.lastName}`.trim();
		const s = seeded(name);
		return {
			name,
			role: u.title || ROLE_LABEL[u.role] || u.role,
			avatar: initials(name),
			actions: Math.round(s * 22) + 2,
			status: s > 0.66 ? 'online' : s > 0.33 ? 'away' : 'offline'
		};
	});

	// ---- recent activity (real) ----
	const recentInvoices = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			createdAt: table.invoice.createdAt
		})
		.from(table.invoice)
		.where(eq(table.invoice.tenantId, tenantId))
		.orderBy(desc(table.invoice.createdAt))
		.limit(6);
	const recentProjects = await db
		.select({ id: table.project.id, name: table.project.name, updatedAt: table.project.updatedAt })
		.from(table.project)
		.where(eq(table.project.tenantId, tenantId))
		.orderBy(desc(table.project.updatedAt))
		.limit(6);
	const recentClients = await db
		.select({ id: table.client.id, name: table.client.name, createdAt: table.client.createdAt })
		.from(table.client)
		.where(eq(table.client.tenantId, tenantId))
		.orderBy(desc(table.client.createdAt))
		.limit(6);

	type Raw = { action: string; detail: string; href: string; createdAt: Date | string | null; icon: string; color: Accent };
	const rawActivity: Raw[] = [
		...recentInvoices.map((i) => ({
			action: 'Factură nouă',
			detail: i.invoiceNumber,
			href: `${base}/invoices/${i.id}`,
			createdAt: i.createdAt,
			icon: 'DollarSign',
			color: 'success' as Accent
		})),
		...recentProjects.map((p) => ({
			action: 'Proiect actualizat',
			detail: p.name,
			href: `${base}/projects/${p.id}`,
			createdAt: p.updatedAt,
			icon: 'Folder',
			color: 'info' as Accent
		})),
		...recentClients.map((c) => ({
			action: 'Client nou adăugat',
			detail: c.name,
			href: `${base}/clients/${c.id}`,
			createdAt: c.createdAt,
			icon: 'Users',
			color: 'primary' as Accent
		}))
	];
	const activity: ActivityItem[] = rawActivity
		.sort((a, b) => {
			const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
			const dbb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
			return dbb - da;
		})
		.slice(0, 8)
		.map((a) => ({
			action: a.action,
			detail: a.detail,
			ago: timeAgo(a.createdAt, now),
			user: 'Sistem',
			icon: a.icon,
			color: a.color,
			href: a.href
		}));

	// ---- upcoming tasks (real) ----
	const taskRows = await db
		.select({
			id: table.task.id,
			title: table.task.title,
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
	const validPrio = ['urgent', 'high', 'medium', 'low'];
	const tasks: TaskItem[] = taskRows
		.filter((t) => t.dueDate && new Date(t.dueDate) >= now)
		.slice(0, 5)
		.map((t) => ({
			id: t.id,
			title: t.title,
			project: t.projectName || 'Fără proiect',
			priority: (validPrio.includes(t.priority ?? '') ? t.priority : 'medium') as TaskItem['priority'],
			due: t.dueDate
				? new Date(t.dueDate).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })
				: '',
			assignee: userInitials,
			href: `${base}/tasks/${t.id}`
		}));

	// ---- today's agenda (real, tasks due today) ----
	const todayEnd = new Date(cfStart.getTime() + DAY_MS);
	const agendaRows = await db
		.select({ id: table.task.id, title: table.task.title, dueDate: table.task.dueDate })
		.from(table.task)
		.where(
			and(
				eq(table.task.tenantId, tenantId),
				or(eq(table.task.status, 'todo'), eq(table.task.status, 'in-progress')),
				gte(table.task.dueDate, cfStart),
				lt(table.task.dueDate, todayEnd)
			)
		)
		.orderBy(table.task.dueDate)
		.limit(6);
	const agendaColors: Accent[] = ['primary', 'warn', 'info', 'success'];
	const todayEvents: TodayEvent[] = agendaRows.map((t, i) => {
		const dt = t.dueDate ? new Date(t.dueDate) : null;
		const hh = dt?.getHours() ?? 0;
		const mm = dt?.getMinutes() ?? 0;
		const time = hh === 0 && mm === 0 ? '—' : `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
		return { time, title: t.title, color: agendaColors[i % agendaColors.length] };
	});

	// ---- ads (demo: ROAS/CTR/CPA not tracked in CRM) ----
	const ads = adsPlatforms();
	const adsSpend = ads.reduce((s, p) => s + p.spend, 0);

	// ---- KPIs ----
	const kpis: KpiData[] = [
		{
			id: 'revenue',
			label: 'Venituri (luna)',
			value: curRevenue,
			fmt: 'ron',
			delta: Math.round(revDelta * 10) / 10,
			spark: revenueSpark,
			icon: 'DollarSign',
			accent: 'success',
			href: `${base}/invoices`
		},
		{
			id: 'clients',
			label: 'Clienți activi',
			value: activeClients,
			delta: synthDelta('clients'),
			spark: synthSpark(activeClients, 'clients'),
			icon: 'Users',
			accent: 'primary',
			href: `${base}/clients`
		},
		{
			id: 'projects',
			label: 'Proiecte active',
			value: activeProjects,
			delta: synthDelta('projects'),
			spark: synthSpark(activeProjects, 'projects'),
			icon: 'Folder',
			accent: 'info',
			href: `${base}/projects`
		},
		{
			id: 'pending',
			label: 'Facturi de încasat',
			value: pendingAmount,
			fmt: 'ron',
			delta: synthDelta('pending'),
			sub: `${pendingCount} facturi · ${overdueCount} overdue`,
			spark: synthSpark(pendingAmount, 'pending'),
			icon: 'CreditCard',
			accent: 'warn',
			href: `${base}/invoices`
		},
		{
			id: 'leads',
			label: 'Leads (luna)',
			value: curLeads,
			delta: Math.round(leadsDelta * 10) / 10,
			spark: leadBuckets,
			icon: 'UserPlus',
			accent: 'primary',
			href: `${base}/leads`
		},
		{
			id: 'ads',
			label: 'Spend Ads (luna)',
			value: adsSpend,
			fmt: 'ron',
			delta: 15.3,
			sub: 'ROAS 3.2x · demo',
			spark: synthSpark(adsSpend, 'ads'),
			icon: 'Zap',
			accent: 'info',
			href: `${base}/campaigns-ads`
		}
	];

	// ---- alerts (derived from real counts) ----
	const alerts: AlertData[] = [];
	if (overdueCount > 0)
		alerts.push({
			type: 'danger',
			icon: 'Alert',
			title: `${overdueCount} ${overdueCount === 1 ? 'factură overdue' : 'facturi overdue'}`,
			detail: 'Necesită încasare urgentă',
			action: 'Vezi facturi',
			href: `${base}/invoices`
		});
	if (pendingCount > 0)
		alerts.push({
			type: 'info',
			icon: 'CreditCard',
			title: `${pendingCount} ${pendingCount === 1 ? 'factură de încasat' : 'facturi de încasat'}`,
			detail: `${fmtRON(pendingAmount)} în așteptare`,
			action: 'Deschide',
			href: `${base}/invoices`
		});
	if (curLeads > 0)
		alerts.push({
			type: 'success',
			icon: 'TrendingUp',
			title: `${curLeads} leads luna aceasta`,
			detail: `${leadsDelta >= 0 ? '+' : ''}${leadsDelta.toFixed(0)}% vs luna trecută`,
			action: 'Vezi leads',
			href: `${base}/leads`
		});

	const summaryParts: string[] = [];
	if (overdueCount) summaryParts.push(`${overdueCount} facturi overdue`);
	if (pendingCount) summaryParts.push(`${pendingCount} de încasat`);
	if (curLeads) summaryParts.push(`${curLeads} leads noi luna aceasta`);
	const alertSummary = summaryParts.length ? `Ai ${summaryParts.join(', ')}.` : 'Totul e la zi. 🎉';

	const dashboard: DashboardData = {
		greeting: greetingFor(now),
		userName,
		alertSummary,
		kpis,
		alerts,
		topClients,
		team,
		activity,
		tasks,
		revenue12m,
		cashflow,
		funnel,
		adsPlatforms: ads,
		todayEvents,
		demoFlags: { ads: true, revenueChart: false, cashflow: false, funnel: false, today: false }
	};

	return { dashboard };
};
