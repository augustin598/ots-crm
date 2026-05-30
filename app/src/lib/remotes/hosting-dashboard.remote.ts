import { query, getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, ne, desc, gte, lte, inArray, isNotNull, sql } from 'drizzle-orm';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';

const MRR_CASE_SQL = sql<number>`
	CASE ${table.hostingAccount.billingCycle}
		WHEN 'monthly'      THEN ${table.hostingAccount.recurringAmount} * 1.0
		WHEN 'quarterly'    THEN ${table.hostingAccount.recurringAmount} * 1.0 / 3
		WHEN 'semiannually' THEN ${table.hostingAccount.recurringAmount} * 1.0 / 6
		WHEN 'biannually'   THEN ${table.hostingAccount.recurringAmount} * 1.0 / 6
		WHEN 'annually'     THEN ${table.hostingAccount.recurringAmount} * 1.0 / 12
		WHEN 'biennially'   THEN ${table.hostingAccount.recurringAmount} * 1.0 / 24
		WHEN 'triennially'  THEN ${table.hostingAccount.recurringAmount} * 1.0 / 36
		ELSE 0
	END
`;

function ymd(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function monthLabel(d: Date): string {
	return new Intl.DateTimeFormat('ro-RO', { month: 'short' }).format(d).replace('.', '');
}

function lastDayOfMonth(year: number, month0: number): Date {
	// month0 = 0..11; new Date(y, m+1, 0) = last day of month
	return new Date(Date.UTC(year, month0 + 1, 0, 23, 59, 59));
}

const ACTIVITY_META: Record<
	string,
	{ icon: string; color: string; label: (action: string) => string }
> = {
	suspend: { icon: 'pause', color: '#f59e0b', label: () => 'Cont suspendat' },
	unsuspend: { icon: 'play', color: '#10b981', label: () => 'Cont reactivat' },
	create: { icon: 'plus', color: '#1877F2', label: () => 'Cont nou creat' },
	delete: { icon: 'trash', color: '#ef4444', label: () => 'Cont șters' },
	sync: { icon: 'refresh', color: '#1877F2', label: () => 'Sync DA' },
	test: { icon: 'check', color: '#10b981', label: () => 'Test conexiune' },
	'package-change': {
		icon: 'package',
		color: '#6366f1',
		label: () => 'Schimbare pachet'
	},
	'package-apply': { icon: 'package', color: '#6366f1', label: () => 'Aplicare pachet' },
	'view-credentials': { icon: 'eye', color: '#475569', label: () => 'Vizualizare credențiale' },
	'password-reset': { icon: 'key', color: '#f59e0b', label: () => 'Reset parolă' },
	'welcome-resend': { icon: 'mail', color: '#1877F2', label: () => 'Welcome email retrimis' },
	'retry-provision': {
		icon: 'refresh',
		color: '#f59e0b',
		label: () => 'Retry provisioning'
	},
	'login-as': { icon: 'log-in', color: '#475569', label: () => 'Login as user' },
	'ssl-issue': { icon: 'lock', color: '#7c3aed', label: () => 'SSL emis' },
	'alert-sent': { icon: 'bell', color: '#ef4444', label: () => 'Alertă trimisă' }
};

/**
 * Hosting Dashboard — single roll-up query that powers `/[tenant]/hosting`.
 *
 * Keeps the page to a single waterfall: KPIs, 12-month MRR history, servers,
 * expiring soon, suspended list, product distribution, top clients, recent
 * activity. Cheaper than 8 separate queries even with the wider JOINs because
 * SQLite re-uses the same hot pages for each.
 */
export const getHostingDashboard = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	const tenantId = event.locals.tenant.id;
	const now = new Date();
	const todayStr = ymd(now);
	const in30 = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
	const in30Str = ymd(in30);
	const minus30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

	// ---------- KPI aggregates (one wide row) ----------
	const [agg] = await db
		.select({
			total: sql<number>`COUNT(*)`,
			active: sql<number>`SUM(CASE WHEN ${table.hostingAccount.status} = 'active' THEN 1 ELSE 0 END)`,
			suspended: sql<number>`SUM(CASE WHEN ${table.hostingAccount.status} = 'suspended' THEN 1 ELSE 0 END)`,
			pending: sql<number>`SUM(CASE WHEN ${table.hostingAccount.status} = 'pending' THEN 1 ELSE 0 END)`,
			mrrCents: sql<number>`COALESCE(SUM(ROUND(CASE WHEN ${table.hostingAccount.status} = 'active' THEN ${MRR_CASE_SQL} ELSE 0 END)), 0)`,
			distinctClients: sql<number>`COUNT(DISTINCT CASE WHEN ${table.hostingAccount.status} = 'active' THEN ${table.hostingAccount.clientId} END)`,
			createdLast30: sql<number>`SUM(CASE WHEN ${table.hostingAccount.createdAt} >= ${minus30} THEN 1 ELSE 0 END)`
		})
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				ne(table.hostingAccount.status, 'failed')
			)
		);

	const activeCount = Number(agg?.active ?? 0);
	const totalCount = Number(agg?.total ?? 0);
	const suspendedCount = Number(agg?.suspended ?? 0);
	const mrrCents = Number(agg?.mrrCents ?? 0);
	const distinctClients = Number(agg?.distinctClients ?? 0);
	const createdLast30 = Number(agg?.createdLast30 ?? 0);

	// ---------- Expiring next 30 days (active, sorted asc) ----------
	const expiringRows = await db
		.select({
			id: table.hostingAccount.id,
			domain: table.hostingAccount.domain,
			nextDueDate: table.hostingAccount.nextDueDate,
			recurringAmount: table.hostingAccount.recurringAmount,
			billingCycle: table.hostingAccount.billingCycle,
			currency: table.hostingAccount.currency,
			clientName: table.client.name,
			clientBusinessName: table.client.businessName,
			productName: table.hostingProduct.name,
			daPackageName: table.hostingAccount.daPackageName
		})
		.from(table.hostingAccount)
		.leftJoin(table.client, eq(table.hostingAccount.clientId, table.client.id))
		.leftJoin(table.hostingProduct, eq(table.hostingAccount.hostingProductId, table.hostingProduct.id))
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.status, 'active'),
				isNotNull(table.hostingAccount.nextDueDate),
				gte(table.hostingAccount.nextDueDate, todayStr),
				lte(table.hostingAccount.nextDueDate, in30Str)
			)
		)
		.orderBy(table.hostingAccount.nextDueDate)
		.limit(6);

	const expiringCount = expiringRows.length === 6
		? // Need an accurate count beyond limit
			(
				await db
					.select({ c: sql<number>`COUNT(*)` })
					.from(table.hostingAccount)
					.where(
						and(
							eq(table.hostingAccount.tenantId, tenantId),
							eq(table.hostingAccount.status, 'active'),
							isNotNull(table.hostingAccount.nextDueDate),
							gte(table.hostingAccount.nextDueDate, todayStr),
							lte(table.hostingAccount.nextDueDate, in30Str)
						)
					)
			)[0]?.c ?? expiringRows.length
		: expiringRows.length;

	const expiring = expiringRows.map((r) => {
		const days = Math.max(
			0,
			Math.round((new Date(r.nextDueDate!).getTime() - now.getTime()) / (24 * 3600 * 1000))
		);
		const cycleDivisor =
			r.billingCycle === 'monthly'
				? 1
				: r.billingCycle === 'quarterly'
					? 3
					: r.billingCycle === 'semiannually' || r.billingCycle === 'biannually'
						? 6
						: r.billingCycle === 'annually'
							? 12
							: r.billingCycle === 'biennially'
								? 24
								: r.billingCycle === 'triennially'
									? 36
									: 1;
		return {
			id: r.id,
			domain: r.domain,
			client: r.clientBusinessName ?? r.clientName ?? '—',
			product: r.productName ?? r.daPackageName ?? '—',
			mrrCents: Math.round((r.recurringAmount ?? 0) / cycleDivisor),
			currency: r.currency ?? 'RON',
			expiresInDays: days
		};
	});

	// ---------- Suspended accounts (limit 6) ----------
	const suspendedRows = await db
		.select({
			id: table.hostingAccount.id,
			domain: table.hostingAccount.domain,
			suspendReason: table.hostingAccount.suspendReason,
			nextDueDate: table.hostingAccount.nextDueDate,
			clientName: table.client.name,
			clientBusinessName: table.client.businessName
		})
		.from(table.hostingAccount)
		.leftJoin(table.client, eq(table.hostingAccount.clientId, table.client.id))
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.status, 'suspended')
			)
		)
		.orderBy(desc(table.hostingAccount.updatedAt))
		.limit(6);

	const suspended = suspendedRows.map((r) => {
		let overdueDays: number | null = null;
		if (r.nextDueDate) {
			const d = new Date(r.nextDueDate);
			const diff = Math.round((now.getTime() - d.getTime()) / (24 * 3600 * 1000));
			overdueDays = diff > 0 ? diff : null;
		}
		return {
			id: r.id,
			domain: r.domain,
			client: r.clientBusinessName ?? r.clientName ?? '—',
			reason: r.suspendReason ?? 'Suspendat',
			overdueDays
		};
	});

	// ---------- 12-month MRR history ----------
	// Cumulative monthly-normalized MRR of accounts started by month-end,
	// excluding terminated/cancelled/failed. Approximate but cheap.
	const historyMonths: { m: string; v: number }[] = [];
	for (let i = 11; i >= 0; i--) {
		const ref = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
		const eom = lastDayOfMonth(ref.getUTCFullYear(), ref.getUTCMonth());
		const eomStr = ymd(eom);
		const [row] = await db
			.select({
				mrrCents: sql<number>`COALESCE(SUM(ROUND(${MRR_CASE_SQL})), 0)`
			})
			.from(table.hostingAccount)
			.where(
				and(
					eq(table.hostingAccount.tenantId, tenantId),
					inArray(table.hostingAccount.status, ['active', 'suspended']),
					sql`COALESCE(${table.hostingAccount.startDate}, strftime('%Y-%m-%d', ${table.hostingAccount.createdAt})) <= ${eomStr}`
				)
			);
		historyMonths.push({ m: monthLabel(ref), v: Number(row?.mrrCents ?? 0) });
	}

	// ---------- Product distribution (active accounts) ----------
	const productStats = await db
		.select({
			productId: table.hostingProduct.id,
			name: table.hostingProduct.name,
			color: table.hostingProduct.color,
			sold: sql<number>`COUNT(${table.hostingAccount.id})`,
			mrrCents: sql<number>`COALESCE(SUM(ROUND(${MRR_CASE_SQL})), 0)`
		})
		.from(table.hostingAccount)
		.innerJoin(
			table.hostingProduct,
			eq(table.hostingAccount.hostingProductId, table.hostingProduct.id)
		)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.status, 'active')
			)
		)
		.groupBy(table.hostingProduct.id, table.hostingProduct.name, table.hostingProduct.color)
		.orderBy(desc(sql`COUNT(${table.hostingAccount.id})`));

	// Pre-built palette used when products share the schema-default color
	// (#1877F2). Keeps each tier visually distinct in the donut + legend
	// without forcing the user to set per-product colors in admin.
	const PRODUCT_PALETTE = [
		'#1877F2', // blue
		'#10b981', // emerald
		'#f59e0b', // amber
		'#7c3aed', // violet
		'#ec4899', // pink
		'#6366f1', // indigo
		'#14b8a6', // teal
		'#ef4444', // red
		'#0ea5e9', // sky
		'#a855f7' // purple
	];
	const distinctConfiguredColors = new Set(
		productStats.map((p) => (p.color || '').toLowerCase()).filter((c) => c && c !== '#1877f2')
	);
	const useFallbackPalette = distinctConfiguredColors.size < productStats.length - 1;

	const productDistribution = productStats.map((p, i) => ({
		id: p.productId,
		name: p.name,
		color: useFallbackPalette ? PRODUCT_PALETTE[i % PRODUCT_PALETTE.length] : p.color || PRODUCT_PALETTE[i % PRODUCT_PALETTE.length],
		accounts: Number(p.sold) || 0,
		mrrCents: Number(p.mrrCents) || 0
	}));

	// ---------- Top clients by MRR ----------
	const topClientRows = await db
		.select({
			clientId: table.hostingAccount.clientId,
			clientName: table.client.name,
			businessName: table.client.businessName,
			accounts: sql<number>`COUNT(${table.hostingAccount.id})`,
			mrrCents: sql<number>`COALESCE(SUM(ROUND(${MRR_CASE_SQL})), 0)`
		})
		.from(table.hostingAccount)
		.leftJoin(table.client, eq(table.hostingAccount.clientId, table.client.id))
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.status, 'active'),
				isNotNull(table.hostingAccount.clientId)
			)
		)
		.groupBy(table.hostingAccount.clientId, table.client.name, table.client.businessName)
		.orderBy(desc(sql`SUM(ROUND(${MRR_CASE_SQL}))`))
		.limit(6);

	const topClients = topClientRows.map((c) => ({
		id: c.clientId ?? '',
		name: c.businessName ?? c.clientName ?? '—',
		accounts: Number(c.accounts) || 0,
		mrrCents: Number(c.mrrCents) || 0
	}));

	// ---------- Recent activity (last 10) ----------
	const activityRows = await db
		.select({
			id: table.daAuditLog.id,
			action: table.daAuditLog.action,
			trigger: table.daAuditLog.trigger,
			success: table.daAuditLog.success,
			createdAt: table.daAuditLog.createdAt,
			domain: table.hostingAccount.domain,
			serverName: table.daServer.name,
			actorEmail: table.user.email,
			actorFirstName: table.user.firstName,
			actorLastName: table.user.lastName
		})
		.from(table.daAuditLog)
		.leftJoin(
			table.hostingAccount,
			eq(table.daAuditLog.hostingAccountId, table.hostingAccount.id)
		)
		.leftJoin(table.daServer, eq(table.daAuditLog.daServerId, table.daServer.id))
		.leftJoin(table.user, eq(table.daAuditLog.actorId, table.user.id))
		.where(eq(table.daAuditLog.tenantId, tenantId))
		.orderBy(desc(table.daAuditLog.createdAt))
		.limit(10);

	const activity = activityRows.map((a) => {
		const meta = ACTIVITY_META[a.action] ?? {
			icon: 'info',
			color: '#475569',
			label: () => a.action
		};
		const actor =
			[a.actorFirstName, a.actorLastName].filter(Boolean).join(' ') ||
			a.actorEmail ||
			(a.trigger === 'cron' ? 'cron' : a.trigger === 'system' ? 'system' : '—');
		return {
			id: a.id,
			icon: meta.icon,
			color: a.success ? meta.color : '#ef4444',
			label: meta.label(a.action),
			detail: a.domain ?? a.serverName ?? '—',
			actor,
			createdAt: a.createdAt
		};
	});

	const mrrFirst = historyMonths[0]?.v ?? 0;
	const mrrLast = historyMonths[historyMonths.length - 1]?.v ?? 0;
	const mrrPrev = historyMonths[historyMonths.length - 2]?.v ?? mrrLast;
	const mrrDeltaPct =
		mrrPrev > 0 ? Math.round(((mrrLast - mrrPrev) / mrrPrev) * 10000) / 100 : 0;

	// Approximate "new accounts in last 12 months"
	const yearAgo = new Date(now.getTime() - 365 * 24 * 3600 * 1000);
	const [newAccRow] = await db
		.select({ c: sql<number>`COUNT(*)` })
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				gte(table.hostingAccount.createdAt, yearAgo)
			)
		);
	const newAccounts12mo = Number(newAccRow?.c ?? 0);

	return {
		generatedAt: now.toISOString(),
		kpis: {
			activeAccounts: activeCount,
			totalAccounts: totalCount,
			activeDelta30d: createdLast30,
			distinctClients,
			suspended: suspendedCount,
			expiringIn30: expiringCount,
			mrrCents,
			arrCents: mrrCents * 12,
			mrrYearAgoCents: mrrFirst,
			mrrDeltaPct
		},
		mrrHistory: historyMonths,
		mrrStats: {
			currentCents: mrrLast,
			previousCents: mrrPrev,
			deltaPct: mrrDeltaPct,
			newAccounts12mo
		},
		expiring,
		suspended,
		productDistribution,
		topClients,
		activity
	};
});
