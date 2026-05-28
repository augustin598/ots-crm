import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, sql, gte, lte, inArray, or, like, isNull } from 'drizzle-orm';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';
import { createDAClient } from '$lib/server/plugins/directadmin/factory';
import { runWithAudit, withAccountLock } from '$lib/server/plugins/directadmin/audit';
import { decrypt, encrypt } from '$lib/server/plugins/smartbill/crypto';
import { generateDaPassword } from '$lib/utils/da-generators';
import {
	notifyHostingAccountCreated,
	notifyHostingPasswordReset
} from '$lib/server/hosting/notifications';
import { logError } from '$lib/server/logger';

/* ============================================================
 * Schema-uri input (Valibot)
 * ============================================================ */

const HistoryFiltersSchema = v.optional(
	v.object({
		status: v.optional(v.string()), // 'all' | 'active' | 'pending' | 'failed' | 'suspended'
		serverId: v.optional(v.string()),
		serverName: v.optional(v.string()),
		interval: v.optional(v.string()), // '24h' | '7d' | '30d' | 'all'
		search: v.optional(v.string()),
		limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(500)), 100),
		offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0)
	})
);

const AccountIdSchema = v.object({
	id: v.pipe(v.string(), v.minLength(1))
});

/* ============================================================
 * Helpers private
 * ============================================================ */

function intervalCutoffMs(interval?: string): Date | null {
	const now = Date.now();
	switch (interval) {
		case '24h':
			return new Date(now - 24 * 60 * 60 * 1000);
		case '7d':
			return new Date(now - 7 * 24 * 60 * 60 * 1000);
		case '30d':
			return new Date(now - 30 * 24 * 60 * 60 * 1000);
		case 'all':
		default:
			return null;
	}
}

function tenantIdFromEvent(event: ReturnType<typeof getRequestEvent>): string {
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	return event.locals.tenant.id;
}

function dateToIso(value: unknown): string {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return new Date(value).toISOString();
	return new Date().toISOString();
}

function dateToIsoOrNull(value: unknown): string | null {
	if (value == null) return null;
	return dateToIso(value);
}

/* ============================================================
 * 1) getProvisioningStats — KPI bar
 * ============================================================ */

export const getProvisioningStats = query(async () => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	const now = Date.now();
	const day = 24 * 60 * 60 * 1000;
	const t30d = new Date(now - 30 * day);
	const t60d = new Date(now - 60 * day);
	const t24h = new Date(now - day);
	const t48h = new Date(now - 2 * day);

	// 30d create attempts
	const [last30dStats] = await db
		.select({
			total: sql<number>`COUNT(*)`,
			ok: sql<number>`SUM(CASE WHEN ${table.daAuditLog.success} = 1 THEN 1 ELSE 0 END)`,
			avgMs: sql<number>`AVG(CASE WHEN ${table.daAuditLog.success} = 1 AND ${table.daAuditLog.action} = 'create' THEN ${table.daAuditLog.durationMs} END)`
		})
		.from(table.daAuditLog)
		.where(
			and(
				eq(table.daAuditLog.tenantId, tenantId),
				eq(table.daAuditLog.action, 'create'),
				gte(table.daAuditLog.createdAt, t30d)
			)
		);

	const last30Total = Number(last30dStats?.total ?? 0);
	const last30Ok = Number(last30dStats?.ok ?? 0);
	const last30Failed = last30Total - last30Ok;
	const successRate30d = last30Total > 0 ? (last30Ok / last30Total) * 100 : 100;
	const avgDurationMs = Math.round(Number(last30dStats?.avgMs ?? 0));

	// Previous window (30-60 days ago) pentru trend
	const [prev30dStats] = await db
		.select({
			total: sql<number>`COUNT(*)`,
			ok: sql<number>`SUM(CASE WHEN ${table.daAuditLog.success} = 1 THEN 1 ELSE 0 END)`,
			avgMs: sql<number>`AVG(CASE WHEN ${table.daAuditLog.success} = 1 AND ${table.daAuditLog.action} = 'create' THEN ${table.daAuditLog.durationMs} END)`
		})
		.from(table.daAuditLog)
		.where(
			and(
				eq(table.daAuditLog.tenantId, tenantId),
				eq(table.daAuditLog.action, 'create'),
				gte(table.daAuditLog.createdAt, t60d),
				lte(table.daAuditLog.createdAt, t30d)
			)
		);

	const prev30Total = Number(prev30dStats?.total ?? 0);
	const prev30Ok = Number(prev30dStats?.ok ?? 0);
	const successRate30dPrev = prev30Total > 0 ? (prev30Ok / prev30Total) * 100 : successRate30d;
	const avgDurationMsPrev = Math.round(Number(prev30dStats?.avgMs ?? avgDurationMs));

	// Conturi noi în 24h vs 24-48h
	const [new24h] = await db
		.select({ c: sql<number>`COUNT(*)` })
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				gte(table.hostingAccount.createdAt, t24h)
			)
		);
	const [new48h] = await db
		.select({ c: sql<number>`COUNT(*)` })
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				gte(table.hostingAccount.createdAt, t48h),
				lte(table.hostingAccount.createdAt, t24h)
			)
		);

	// Pending > 5 min și failed
	const fiveMinAgo = new Date(now - 5 * 60 * 1000);
	const [pendingRow] = await db
		.select({ c: sql<number>`COUNT(*)` })
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.status, 'pending'),
				lte(table.hostingAccount.createdAt, fiveMinAgo)
			)
		);
	const [failedRow] = await db
		.select({ c: sql<number>`COUNT(*)` })
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.status, 'failed')
			)
		);

	// Servere online / total
	const servers = await db
		.select({
			id: table.daServer.id,
			isActive: table.daServer.isActive,
			lastError: table.daServer.lastError
		})
		.from(table.daServer)
		.where(eq(table.daServer.tenantId, tenantId));
	const serversTotal = servers.length;
	const serversOnline = servers.filter((s) => s.isActive && !s.lastError).length;

	return {
		successRate30d,
		successRate30dPrev,
		trend: successRate30d - successRate30dPrev,
		successCount30d: last30Ok,
		failedCount30d: last30Failed,
		newAccounts24h: Number(new24h?.c ?? 0),
		newAccounts24hPrev: Number(new48h?.c ?? 0),
		pendingCount: Number(pendingRow?.c ?? 0),
		failedCount: Number(failedRow?.c ?? 0),
		avgDurationMs,
		avgDurationMsPrev,
		serversOnline,
		serversTotal
	};
});

/* ============================================================
 * 2) getProvisioningHistory — tabel
 * ============================================================ */

export const getProvisioningHistory = query(HistoryFiltersSchema, async (filters) => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	const conditions = [eq(table.hostingAccount.tenantId, tenantId)];

	if (filters?.status && filters.status !== 'all') {
		conditions.push(eq(table.hostingAccount.status, filters.status));
	}

	if (filters?.serverId) {
		conditions.push(eq(table.hostingAccount.daServerId, filters.serverId));
	}

	const intervalCutoff = intervalCutoffMs(filters?.interval);
	if (intervalCutoff) {
		conditions.push(gte(table.hostingAccount.createdAt, intervalCutoff));
	}

	if (filters?.search) {
		const q = `%${filters.search.toLowerCase()}%`;
		conditions.push(
			or(
				like(sql`LOWER(${table.hostingAccount.daUsername})`, q),
				like(sql`LOWER(${table.hostingAccount.domain})`, q)
			)!
		);
	}

	const rows = await db
		.select({
			id: table.hostingAccount.id,
			accountId: table.hostingAccount.id,
			daUsername: table.hostingAccount.daUsername,
			domain: table.hostingAccount.domain,
			status: table.hostingAccount.status,
			suspendReason: table.hostingAccount.suspendReason,
			createdAt: table.hostingAccount.createdAt,
			daServerId: table.hostingAccount.daServerId,
			daServerName: table.daServer.name,
			daServerHostname: table.daServer.hostname,
			daPackageId: table.hostingAccount.daPackageId,
			daPackageName: table.daPackage.daName,
			hostingProductId: table.hostingAccount.hostingProductId,
			productName: table.hostingProduct.name,
			productColor: table.hostingProduct.color,
			clientId: table.hostingAccount.clientId,
			clientName: table.client.name,
			clientEmail: table.client.email,
			diskUsage: table.hostingAccount.diskUsage,
			bandwidthUsage: table.hostingAccount.bandwidthUsage,
			emailCount: table.hostingAccount.emailCount,
			dbCount: table.hostingAccount.dbCount,
			lastSyncedAt: table.hostingAccount.lastSyncedAt,
			daSyncStatus: table.hostingAccount.daSyncStatus,
			daSyncIssue: table.hostingAccount.daSyncIssue,
			daCredentialsEncrypted: table.hostingAccount.daCredentialsEncrypted
		})
		.from(table.hostingAccount)
		.leftJoin(table.daServer, eq(table.hostingAccount.daServerId, table.daServer.id))
		.leftJoin(table.daPackage, eq(table.hostingAccount.daPackageId, table.daPackage.id))
		.leftJoin(
			table.hostingProduct,
			eq(table.hostingAccount.hostingProductId, table.hostingProduct.id)
		)
		.leftJoin(table.client, eq(table.hostingAccount.clientId, table.client.id))
		.where(and(...conditions))
		.orderBy(desc(table.hostingAccount.createdAt))
		.limit(filters?.limit ?? 100)
		.offset(filters?.offset ?? 0);

	// Pentru fiecare cont, găsesc ultimul audit-log de tip create pentru durata + trigger + invoice
	const ids = rows.map((r) => r.id);
	const audits =
		ids.length > 0
			? await db
					.select({
						hostingAccountId: table.daAuditLog.hostingAccountId,
						trigger: table.daAuditLog.trigger,
						durationMs: table.daAuditLog.durationMs,
						invoiceId: table.daAuditLog.invoiceId,
						actorId: table.daAuditLog.actorId,
						success: table.daAuditLog.success,
						errorMessage: table.daAuditLog.errorMessage
					})
					.from(table.daAuditLog)
					.where(
						and(
							eq(table.daAuditLog.tenantId, tenantId),
							eq(table.daAuditLog.action, 'create'),
							inArray(table.daAuditLog.hostingAccountId, ids)
						)
					)
					.orderBy(desc(table.daAuditLog.createdAt))
			: [];

	// Iau primul (cel mai recent) audit pe cont
	const auditByAccount = new Map<string, (typeof audits)[number]>();
	for (const a of audits) {
		if (!a.hostingAccountId) continue;
		if (!auditByAccount.has(a.hostingAccountId)) auditByAccount.set(a.hostingAccountId, a);
	}

	// Pentru invoice numbers (afișare în tabel)
	const invoiceIds = audits.map((a) => a.invoiceId).filter((x): x is string => !!x);
	const invoiceMap = new Map<string, string>();
	if (invoiceIds.length > 0) {
		const invs = await db
			.select({ id: table.invoice.id, number: table.invoice.invoiceNumber })
			.from(table.invoice)
			.where(
				and(eq(table.invoice.tenantId, tenantId), inArray(table.invoice.id, invoiceIds))
			);
		for (const inv of invs) invoiceMap.set(inv.id, inv.number ?? inv.id);
	}

	// Pentru actor names
	const actorIds = audits
		.map((a) => a.actorId)
		.filter((x): x is string => !!x);
	const actorMap = new Map<string, string>();
	if (actorIds.length > 0) {
		const users = await db
			.select({
				id: table.user.id,
				firstName: table.user.firstName,
				lastName: table.user.lastName,
				email: table.user.email
			})
			.from(table.user)
			.where(inArray(table.user.id, actorIds));
		for (const u of users) {
			const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
			actorMap.set(u.id, fullName || u.email || u.id);
		}
	}

	const total = await db
		.select({ c: sql<number>`COUNT(*)` })
		.from(table.hostingAccount)
		.where(and(...conditions));

	return {
		rows: rows.map((r) => {
			const audit = auditByAccount.get(r.id);
			const pendingSinceMin = r.status === 'pending'
				? Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 60000)
				: null;
			const { daCredentialsEncrypted, ...rest } = r;
			return {
				...rest,
				hasCredentials: !!daCredentialsEncrypted,
				createdAt: dateToIso(r.createdAt),
				lastSyncedAt: dateToIsoOrNull(r.lastSyncedAt),
				trigger: audit?.trigger ?? 'manual',
				durationMs: audit?.durationMs ?? null,
				invoiceId: audit?.invoiceId ?? null,
				invoiceNumber: audit?.invoiceId ? invoiceMap.get(audit.invoiceId) ?? null : null,
				actor: audit?.actorId
					? actorMap.get(audit.actorId) ?? 'sistem'
					: audit?.trigger === 'manual'
						? 'sistem'
						: 'system',
				errorMessage: audit?.errorMessage ?? null,
				pendingSinceMin
			};
		}),
		total: Number(total[0]?.c ?? 0)
	};
});

/* ============================================================
 * 3) getAccountAuditLog
 * ============================================================ */

export const getAccountAuditLog = query(AccountIdSchema, async ({ id }) => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	// Tenant-scope check
	const [account] = await db
		.select({ id: table.hostingAccount.id })
		.from(table.hostingAccount)
		.where(
			and(eq(table.hostingAccount.id, id), eq(table.hostingAccount.tenantId, tenantId))
		)
		.limit(1);
	if (!account) throw new Error('Cont inexistent');

	const rows = await db
		.select({
			id: table.daAuditLog.id,
			action: table.daAuditLog.action,
			trigger: table.daAuditLog.trigger,
			success: table.daAuditLog.success,
			errorMessage: table.daAuditLog.errorMessage,
			durationMs: table.daAuditLog.durationMs,
			actorId: table.daAuditLog.actorId,
			invoiceId: table.daAuditLog.invoiceId,
			createdAt: table.daAuditLog.createdAt
		})
		.from(table.daAuditLog)
		.where(
			and(
				eq(table.daAuditLog.tenantId, tenantId),
				eq(table.daAuditLog.hostingAccountId, id)
			)
		)
		.orderBy(desc(table.daAuditLog.createdAt))
		.limit(200);

	// Resolve actor names
	const actorIds = rows.map((r) => r.actorId).filter((x): x is string => !!x);
	const actorMap = new Map<string, string>();
	if (actorIds.length > 0) {
		const users = await db
			.select({
				id: table.user.id,
				firstName: table.user.firstName,
				lastName: table.user.lastName,
				email: table.user.email
			})
			.from(table.user)
			.where(inArray(table.user.id, actorIds));
		for (const u of users) {
			const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
			actorMap.set(u.id, fullName || u.email || u.id);
		}
	}

	return rows.map((r) => ({
		...r,
		createdAt: dateToIso(r.createdAt),
		actor: r.actorId ? actorMap.get(r.actorId) ?? 'sistem' : 'sistem'
	}));
});

/* ============================================================
 * 4) verifyAccountOnDA — live DA verification
 * ============================================================ */

export const verifyAccountOnDA = command(AccountIdSchema, async ({ id }) => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	const [account] = await db
		.select()
		.from(table.hostingAccount)
		.where(
			and(eq(table.hostingAccount.id, id), eq(table.hostingAccount.tenantId, tenantId))
		)
		.limit(1);
	if (!account) throw new Error('Cont inexistent');

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, account.daServerId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server DA inexistent');

	const daClient = await createDAClient(tenantId, server);

	try {
		const [config, usage] = await Promise.all([
			daClient.getUserConfig(account.daUsername),
			daClient.getUserUsage(account.daUsername)
		]);

		const daStatus = config.suspended ? 'suspended' : 'active';
		const crmStatus = account.status;
		// Out-of-sync = orice divergență între CRM și DA care necesită intervenție:
		//   - CRM zice active dar DA zice suspended (sau invers)
		//   - CRM zice terminated/failed/cancelled dar DA încă are contul (zombie pe DA)
		const outOfSync =
			(daStatus === 'suspended' && crmStatus === 'active') ||
			(daStatus === 'active' && crmStatus === 'suspended') ||
			crmStatus === 'terminated' ||
			crmStatus === 'failed' ||
			crmStatus === 'cancelled';

		return {
			existsOnDA: true as const,
			daStatus,
			outOfSync,
			usage: {
				disk: Number(usage.quota) || 0,
				diskOf: Number(config.quotaLim) || 0,
				bw: Number(usage.bandwidth) || 0,
				bwOf: Number(config.bandwidthLim) || 0,
				emails: Number(usage.emailAccountCount) || 0,
				emailsOf: Number(config.emailAccountsLim) || 0,
				dbs: Number(usage.dbCount) || 0,
				dbsOf: Number(config.mySqlDatabasesLim) || 0
			},
			package: config.package,
			ip: config.ip,
			daVersion: null as string | null,
			lastSync: new Date().toISOString(),
			daHostname: server.hostname,
			daPort: server.port
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			existsOnDA: false as const,
			daStatus: null,
			outOfSync: false,
			usage: null,
			package: null,
			ip: null,
			daVersion: null,
			lastSync: new Date().toISOString(),
			daHostname: server.hostname,
			daPort: server.port,
			errorMessage: msg
		};
	}
});

/* ============================================================
 * 5) getAccountCredentials — decrypt + audit
 *
 *  SECURITY:
 *  - parola plain text NU se loghează în niciun mod.
 *  - actor + timestamp se scriu obligatoriu ÎNAINTE de a returna parola.
 * ============================================================ */

export const getAccountCredentials = command(AccountIdSchema, async ({ id }) => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');
	if (actor.kind !== 'tenant') throw new Error('Forbidden');

	const [account] = await db
		.select()
		.from(table.hostingAccount)
		.where(
			and(eq(table.hostingAccount.id, id), eq(table.hostingAccount.tenantId, tenantId))
		)
		.limit(1);
	if (!account) error(404, 'Cont inexistent');
	if (!account.daCredentialsEncrypted) {
		error(
			409,
			'Credențiale nestocate pentru acest cont. Folosește „Resetează parola" pentru a genera o parolă nouă.'
		);
	}

	// Scriem audit ÎNAINTE de a returna parola (dacă scrierea eșuează → refuzăm).
	await runWithAudit(
		{
			tenantId,
			hostingAccountId: account.id,
			daServerId: account.daServerId,
			actorId: actor.userId,
			action: 'view-credentials',
			trigger: 'manual'
		},
		async () => {
			// no-op: doar pentru a captura audit-ul cu duration ~0
			return undefined;
		}
	);

	let creds: { username: string; password: string };
	try {
		creds = JSON.parse(decrypt(tenantId, account.daCredentialsEncrypted));
	} catch (err) {
		logError('directadmin', `decrypt credentials failed for ${id}`, { tenantId });
		throw new Error('Decriptarea credențialelor a eșuat');
	}

	return {
		username: creds.username,
		password: creds.password,
		daHostname: account.daUsername
	};
});

/* ============================================================
 * 6) resetAccountPassword
 * ============================================================ */

export const resetAccountPassword = command(AccountIdSchema, async ({ id }) => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');
	if (actor.kind !== 'tenant') throw new Error('Forbidden');

	const [account] = await db
		.select()
		.from(table.hostingAccount)
		.where(
			and(eq(table.hostingAccount.id, id), eq(table.hostingAccount.tenantId, tenantId))
		)
		.limit(1);
	if (!account) throw new Error('Cont inexistent');
	if (account.status !== 'active' && account.status !== 'suspended') {
		throw new Error('Nu poți reseta parola pentru un cont în această stare');
	}

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, account.daServerId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server DA inexistent');

	const newPassword = generateDaPassword();
	const daClient = await createDAClient(tenantId, server);

	await withAccountLock(`${tenantId}:${account.daUsername}`, async () => {
		// Mutația pe DA + persistă audit
		await runWithAudit(
			{
				tenantId,
				hostingAccountId: account.id,
				daServerId: account.daServerId,
				actorId: actor.userId,
				action: 'password-reset',
				trigger: 'manual'
			},
			() => daClient.changeUserPassword(account.daUsername, newPassword)
		);

		// Re-encrypt credențiale
		const newCreds = encrypt(
			tenantId,
			JSON.stringify({ username: account.daUsername, password: newPassword })
		);
		await db
			.update(table.hostingAccount)
			.set({ daCredentialsEncrypted: newCreds, updatedAt: new Date() })
			.where(eq(table.hostingAccount.id, account.id));
	});

	// Email client (fire-and-forget cu logging)
	notifyHostingPasswordReset(tenantId, account.id, newPassword).catch((err) => {
		logError('directadmin', `notify password-reset failed for ${id}`, {
			tenantId,
			stackTrace: err instanceof Error ? err.stack : undefined
		});
	});

	return { success: true as const };
});

/* ============================================================
 * 7) resendWelcomeEmail
 * ============================================================ */

export const resendWelcomeEmail = command(AccountIdSchema, async ({ id }) => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');
	if (actor.kind !== 'tenant') throw new Error('Forbidden');

	const [account] = await db
		.select({
			id: table.hostingAccount.id,
			status: table.hostingAccount.status,
			daServerId: table.hostingAccount.daServerId
		})
		.from(table.hostingAccount)
		.where(
			and(eq(table.hostingAccount.id, id), eq(table.hostingAccount.tenantId, tenantId))
		)
		.limit(1);
	if (!account) throw new Error('Cont inexistent');
	if (account.status !== 'active') {
		throw new Error('Email welcome poate fi trimis doar pentru conturi active');
	}

	// Strategia: șterg dedupe row-ul `created` ca să poată retrimite welcome.
	// Apoi audit.
	await db
		.delete(table.hostingEmailEvent)
		.where(
			and(
				eq(table.hostingEmailEvent.tenantId, tenantId),
				eq(table.hostingEmailEvent.hostingAccountId, id),
				eq(table.hostingEmailEvent.dedupeKey, 'created')
			)
		);

	await runWithAudit(
		{
			tenantId,
			hostingAccountId: account.id,
			daServerId: account.daServerId,
			actorId: actor.userId,
			action: 'welcome-resend',
			trigger: 'manual'
		},
		() => notifyHostingAccountCreated(tenantId, account.id)
	);

	return { success: true as const };
});

/* ============================================================
 * 8) retryFailedProvisioning
 *
 *  Pentru un cont 'failed' sau 'pending' blocat, încercăm să-l finalizăm.
 *  Strategia simplă: șterg row-ul failed (forensic-preserved) și
 *  re-creez prin createHostingAccountInternal cu același payload.
 *
 *  Pentru iterația asta — îl marcăm doar ca 'pending' și fire DA call retry
 *  (necesită că deja există daCredentialsEncrypted). Dacă lipsesc, eroare.
 * ============================================================ */

export const retryFailedProvisioning = command(AccountIdSchema, async ({ id }) => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');
	if (actor.kind !== 'tenant') throw new Error('Forbidden');

	const [account] = await db
		.select()
		.from(table.hostingAccount)
		.where(
			and(eq(table.hostingAccount.id, id), eq(table.hostingAccount.tenantId, tenantId))
		)
		.limit(1);
	if (!account) throw new Error('Cont inexistent');
	if (account.status !== 'failed' && account.status !== 'pending') {
		throw new Error('Doar conturile failed/pending pot fi retry-uite');
	}
	if (!account.daCredentialsEncrypted) {
		throw new Error('Lipsesc credențialele inițiale — recreează contul din formular');
	}

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, account.daServerId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server DA inexistent');

	const [pkg] = account.daPackageId
		? await db
				.select({ daName: table.daPackage.daName })
				.from(table.daPackage)
				.where(
					and(
						eq(table.daPackage.id, account.daPackageId),
						eq(table.daPackage.tenantId, tenantId)
					)
				)
				.limit(1)
		: [{ daName: 'default' }];

	let creds: { username: string; password: string };
	try {
		creds = JSON.parse(decrypt(tenantId, account.daCredentialsEncrypted));
	} catch {
		throw new Error('Decriptarea credențialelor inițiale a eșuat');
	}

	const client = account.clientId
		? (
				await db
					.select({ name: table.client.name, email: table.client.email })
					.from(table.client)
					.where(
						and(eq(table.client.id, account.clientId), eq(table.client.tenantId, tenantId))
					)
					.limit(1)
			)[0]
		: undefined;

	// Resolvare domeniu pentru retry: dacă contul are domeniu placeholder
	// `*.hosting-temp.ots`, încearcă să-l înlocuiești cu domeniul real din
	// inquiry-ul asociat (`requestedDomain` sau `hosting_inquiry_item.domainName`).
	// Asta acoperă cazul în care contul a fost creat înainte de fix-ul
	// provision-da.ts și a rămas blocat pe placeholder.
	let effectiveDomain = account.domain;
	const isPlaceholderDomain = /\.hosting-temp\.ots$/i.test(account.domain);
	if (isPlaceholderDomain) {
		// Caut inquiry legat de acest hostingAccountId
		const [inquiry] = await db
			.select({
				id: table.hostingInquiry.id,
				requestedDomain: table.hostingInquiry.requestedDomain
			})
			.from(table.hostingInquiry)
			.where(
				and(
					eq(table.hostingInquiry.hostingAccountId, account.id),
					eq(table.hostingInquiry.tenantId, tenantId)
				)
			)
			.limit(1);

		let realDomain: string | null = inquiry?.requestedDomain?.trim().toLowerCase() ?? null;

		// Fallback: item-uri din inquiry
		if (!realDomain && inquiry?.id) {
			const items = await db
				.select({ domainName: table.hostingInquiryItem.domainName })
				.from(table.hostingInquiryItem)
				.where(
					and(
						eq(table.hostingInquiryItem.inquiryId, inquiry.id),
						eq(table.hostingInquiryItem.tenantId, tenantId)
					)
				);
			realDomain =
				items
					.map((i) => i.domainName?.trim())
					.find((d): d is string => !!d && d.length > 0)
					?.toLowerCase() ?? null;
		}

		if (realDomain && realDomain !== account.domain) {
			effectiveDomain = realDomain;
			// Update DB pentru consistență — vizibil în următoarele refresh-uri.
			await db
				.update(table.hostingAccount)
				.set({ domain: realDomain, updatedAt: new Date() })
				.where(eq(table.hostingAccount.id, account.id));
		}
	}

	const daClient = await createDAClient(tenantId, server);

	await withAccountLock(`${tenantId}:${account.daUsername}`, async () => {
		await runWithAudit(
			{
				tenantId,
				hostingAccountId: account.id,
				daServerId: account.daServerId,
				actorId: actor.userId,
				action: 'retry-provision',
				trigger: 'manual'
			},
			() =>
				daClient.createUserAccount({
					username: creds.username,
					password: creds.password,
					domain: effectiveDomain,
					email: client?.email ?? 'no-email@example.com',
					package: pkg?.daName ?? 'default',
					skipPreCheck: false
				})
		);

		await db
			.update(table.hostingAccount)
			.set({ status: 'active', suspendReason: null, updatedAt: new Date() })
			.where(eq(table.hostingAccount.id, account.id));
	});

	// Re-trimite welcome după retry reușit
	notifyHostingAccountCreated(tenantId, account.id).catch((err) => {
		logError('directadmin', `notify after retry failed for ${id}`, {
			tenantId,
			stackTrace: err instanceof Error ? err.stack : undefined
		});
	});

	return { success: true as const, accountId: account.id };
});

/* ============================================================
 * 9) suspendAccount / unsuspendAccount manual (din pagină)
 * ============================================================ */

export const suspendProvisionedAccount = command(AccountIdSchema, async ({ id }) => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');
	if (actor.kind !== 'tenant') throw new Error('Forbidden');

	const [account] = await db
		.select()
		.from(table.hostingAccount)
		.where(
			and(eq(table.hostingAccount.id, id), eq(table.hostingAccount.tenantId, tenantId))
		)
		.limit(1);
	if (!account) throw new Error('Cont inexistent');
	if (account.status !== 'active') throw new Error('Contul nu este activ');

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, account.daServerId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server DA inexistent');

	const daClient = await createDAClient(tenantId, server);

	await withAccountLock(`${tenantId}:${account.daUsername}`, async () => {
		await runWithAudit(
			{
				tenantId,
				hostingAccountId: account.id,
				daServerId: account.daServerId,
				actorId: actor.userId,
				action: 'suspend',
				trigger: 'manual'
			},
			() => daClient.suspendUser(account.daUsername)
		);
		await db
			.update(table.hostingAccount)
			.set({
				status: 'suspended',
				suspendReason: 'Suspendare manuală din pagina Provisioning',
				suspendedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.hostingAccount.id, account.id));
	});

	return { success: true as const };
});

export const unsuspendProvisionedAccount = command(AccountIdSchema, async ({ id }) => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');
	if (actor.kind !== 'tenant') throw new Error('Forbidden');

	const [account] = await db
		.select()
		.from(table.hostingAccount)
		.where(
			and(eq(table.hostingAccount.id, id), eq(table.hostingAccount.tenantId, tenantId))
		)
		.limit(1);
	if (!account) throw new Error('Cont inexistent');
	if (account.status !== 'suspended') throw new Error('Contul nu este suspendat');

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, account.daServerId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server DA inexistent');

	const daClient = await createDAClient(tenantId, server);

	await withAccountLock(`${tenantId}:${account.daUsername}`, async () => {
		await runWithAudit(
			{
				tenantId,
				hostingAccountId: account.id,
				daServerId: account.daServerId,
				actorId: actor.userId,
				action: 'unsuspend',
				trigger: 'manual'
			},
			() => daClient.unsuspendUser(account.daUsername)
		);
		await db
			.update(table.hostingAccount)
			.set({
				status: 'active',
				suspendReason: null,
				reactivatedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.hostingAccount.id, account.id));
	});

	return { success: true as const };
});

/* ============================================================
 * 10) getCriticalProvisionings — pentru bannerul de alertă
 * ============================================================ */

export const getCriticalProvisionings = query(async () => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

	// Failed accounts (toate)
	const failed = await db
		.select({
			id: table.hostingAccount.id,
			daUsername: table.hostingAccount.daUsername,
			domain: table.hostingAccount.domain,
			status: table.hostingAccount.status,
			createdAt: table.hostingAccount.createdAt,
			daServerName: table.daServer.name,
			daServerHostname: table.daServer.hostname,
			clientName: table.client.name
		})
		.from(table.hostingAccount)
		.leftJoin(table.daServer, eq(table.hostingAccount.daServerId, table.daServer.id))
		.leftJoin(table.client, eq(table.hostingAccount.clientId, table.client.id))
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.status, 'failed')
			)
		)
		.orderBy(desc(table.hostingAccount.createdAt))
		.limit(50);

	// Pending > 5 min
	const stalePending = await db
		.select({
			id: table.hostingAccount.id,
			daUsername: table.hostingAccount.daUsername,
			domain: table.hostingAccount.domain,
			status: table.hostingAccount.status,
			createdAt: table.hostingAccount.createdAt,
			daServerName: table.daServer.name,
			daServerHostname: table.daServer.hostname,
			clientName: table.client.name
		})
		.from(table.hostingAccount)
		.leftJoin(table.daServer, eq(table.hostingAccount.daServerId, table.daServer.id))
		.leftJoin(table.client, eq(table.hostingAccount.clientId, table.client.id))
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.status, 'pending'),
				lte(table.hostingAccount.createdAt, fiveMinAgo)
			)
		)
		.orderBy(desc(table.hostingAccount.createdAt))
		.limit(50);

	// Pentru fiecare cont, find latest audit (pentru errorMessage)
	const allIds = [...failed.map((f) => f.id), ...stalePending.map((p) => p.id)];
	const auditMap = new Map<string, { errorMessage: string | null; durationMs: number | null }>();
	if (allIds.length > 0) {
		const audits = await db
			.select({
				hostingAccountId: table.daAuditLog.hostingAccountId,
				errorMessage: table.daAuditLog.errorMessage,
				durationMs: table.daAuditLog.durationMs
			})
			.from(table.daAuditLog)
			.where(
				and(
					eq(table.daAuditLog.tenantId, tenantId),
					inArray(table.daAuditLog.hostingAccountId, allIds),
					eq(table.daAuditLog.action, 'create')
				)
			)
			.orderBy(desc(table.daAuditLog.createdAt));
		for (const a of audits) {
			if (!a.hostingAccountId) continue;
			if (!auditMap.has(a.hostingAccountId)) {
				auditMap.set(a.hostingAccountId, {
					errorMessage: a.errorMessage,
					durationMs: a.durationMs
				});
			}
		}
	}

	const items = [
		...failed.map((f) => {
			const a = auditMap.get(f.id);
			return {
				...f,
				createdAt: dateToIso(f.createdAt),
				errorMessage: a?.errorMessage ?? null,
				durationMs: a?.durationMs ?? null,
				pendingSinceMin: null as number | null
			};
		}),
		...stalePending.map((p) => ({
			...p,
			createdAt: dateToIso(p.createdAt),
			errorMessage: null as string | null,
			durationMs: null as number | null,
			pendingSinceMin: Math.floor((Date.now() - new Date(p.createdAt).getTime()) / 60000)
		}))
	];

	return items;
});

/* ============================================================
 * 11) getDaServersForFilter
 * ============================================================ */

export const getDaServersForFilter = query(async () => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	return db
		.select({
			id: table.daServer.id,
			name: table.daServer.name,
			hostname: table.daServer.hostname,
			isActive: table.daServer.isActive
		})
		.from(table.daServer)
		.where(eq(table.daServer.tenantId, tenantId))
		.orderBy(table.daServer.name);
});

/* ============================================================
 * 12) checkOrphanForDelete — verifică dacă un cont CRM e orphan pe DA
 *
 *  SAFETY: ÎNAINTE să arătăm modal-ul de delete, verificăm DA-ul pentru a
 *  confirma că contul NU există acolo. Permite delete DOAR pentru conturi
 *  orphan (CRM listează, dar DA returnează 404). Statusul CRM (active/
 *  suspended/pending vs failed/terminated/cancelled) NU contează — sursa
 *  unică de adevăr e răspunsul DA-ului. Asta acoperă cazul în care DA a
 *  fost șters manual din panou (per policy) dar CRM încă listează contul
 *  ca active — toate operațiile DA pică cu 404 și admin-ul are nevoie de
 *  o cale să reconcilieze starea.
 *
 *  Returnează:
 *    - `safe: true` — DA confirmă 404, putem șterge CRM-row
 *    - `safe: false, reason: 'exists-on-da'` — DA ARE contul, NU permitem delete
 *    - `safe: false, reason: 'da-unreachable'` — DA n-a răspuns (refuz precaut)
 * ============================================================ */

export const checkOrphanForDelete = command(AccountIdSchema, async ({ id }) => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');
	if (actor.kind !== 'tenant') throw new Error('Forbidden');

	const [account] = await db
		.select()
		.from(table.hostingAccount)
		.where(and(eq(table.hostingAccount.id, id), eq(table.hostingAccount.tenantId, tenantId)))
		.limit(1);
	if (!account) throw new Error('Cont inexistent');

	// Verifică DA: dacă există acolo, NU permitem delete (ar lăsa cont orfan pe DA).
	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, account.daServerId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) {
		// Fără server config → DA inaccesibil. Refuzăm precaut.
		return {
			safe: false as const,
			reason: 'da-unreachable' as const,
			crmStatus: account.status,
			message: 'Serverul DA configurat nu există în CRM. Nu pot verifica DA — refuz delete.'
		};
	}

	const daClient = createDAClient(tenantId, server);
	try {
		// Apel direct: dacă DA returnează config-ul → contul EXISTĂ → refuz delete.
		await daClient.getUserConfig(account.daUsername);
		return {
			safe: false as const,
			reason: 'exists-on-da' as const,
			crmStatus: account.status,
			daUsername: account.daUsername,
			daHostname: server.hostname,
			message: `Contul "${account.daUsername}" încă există pe ${server.hostname}. Șterge-l manual din panoul DA înainte de a curăța rândul din CRM.`
		};
	} catch (err) {
		// 404 / DA error → contul NU mai există pe DA (orphan în CRM). Safe to delete.
		const msg = err instanceof Error ? err.message : String(err);
		const isNotFound = /404|not found|user.*not.*exist/i.test(msg);
		if (isNotFound) {
			return {
				safe: true as const,
				crmStatus: account.status,
				daUsername: account.daUsername,
				daHostname: server.hostname,
				message: `DA confirmă că ${account.daUsername} nu există pe ${server.hostname}. Safe pentru cleanup CRM.`
			};
		}
		// Alt error (timeout, auth, network) — refuz precaut.
		return {
			safe: false as const,
			reason: 'da-unreachable' as const,
			crmStatus: account.status,
			message: `DA n-a răspuns clar (${msg}). Refuz delete — verifică conexiunea cu serverul.`
		};
	}
});

/* ============================================================
 * 13) deleteOrphanHostingAccount — șterge rândul CRM (DOAR orphan)
 *
 *  Strictly safe: re-verificăm DA înainte de delete (double-check anti-TOCTOU).
 *  Cascadă: hostingAccountId în daAuditLog/hostingInquiry are ON DELETE SET NULL.
 *  Audit: scriem o intrare finală action='delete', trigger='manual'.
 * ============================================================ */

export const deleteOrphanHostingAccount = command(AccountIdSchema, async ({ id }) => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');
	if (actor.kind !== 'tenant') throw new Error('Forbidden');

	const [account] = await db
		.select()
		.from(table.hostingAccount)
		.where(and(eq(table.hostingAccount.id, id), eq(table.hostingAccount.tenantId, tenantId)))
		.limit(1);
	if (!account) throw new Error('Cont inexistent');

	// Re-verificare DA imediat înainte de delete (TOCTOU protection — admin
	// putea avea modal deschis 30s timp în care contul a fost re-creat pe DA).
	// NOTĂ: statusul CRM (active/suspended/pending) NU mai blochează — DA-check
	// e sursa unică de adevăr. Dacă DA confirmă 404, contul e orphan indiferent
	// ce listează CRM-ul.

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, account.daServerId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server DA inexistent în CRM — nu pot verifica DA.');

	const daClient = createDAClient(tenantId, server);
	try {
		await daClient.getUserConfig(account.daUsername);
		// Dacă ajunge aici → DA RĂSPUNDE (contul există). REFUZ delete.
		throw new Error(
			`Contul "${account.daUsername}" încă există pe ${server.hostname}. Șterge-l manual din panoul DA înainte de a curăța rândul din CRM.`
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		const isNotFound = /404|not found|user.*not.*exist/i.test(msg);
		if (!isNotFound) {
			// Re-throw orice altceva (TOCTOU rejection inclus din block-ul de mai sus)
			if (msg.includes('încă există pe')) throw err;
			throw new Error(`DA n-a răspuns clar (${msg}). Refuz delete pentru siguranță.`);
		}
		// 404 confirmat — orphan. Continuă cu delete.
	}

	// Audit înainte (capturăm acțiunea chiar dacă delete eșuează ulterior).
	await runWithAudit(
		{
			tenantId,
			hostingAccountId: account.id,
			daServerId: account.daServerId,
			actorId: actor.userId,
			action: 'delete',
			trigger: 'manual'
		},
		async () => {
			// Pe schema actuală, da_audit_log.hosting_account_id are ON DELETE SET NULL,
			// la fel pentru hosting_inquiry.hosting_account_id. Deci putem șterge contul
			// fără să distrugem audit-trail-ul sau referințele din inquiry.
			await db
				.delete(table.hostingAccount)
				.where(eq(table.hostingAccount.id, account.id));
		}
	);

	return {
		success: true as const,
		deletedId: account.id,
		deletedUsername: account.daUsername,
		deletedDomain: account.domain
	};
});

/* ============================================================
 * 14) reconcileHostingWithDA — verifică DA pentru toate conturile
 *      active + suspended din tenant și marchează discrepanțele.
 *
 *  Strategie pentru a evita N apeluri DA (1 per cont):
 *    1. Grupăm conturile pe server.
 *    2. Per server: o singură listare a usernames-urilor de pe DA
 *       (`listAllUsernames` — cache 60s în client).
 *    3. Pentru fiecare cont CRM pe acel server:
 *       - dacă username NU e în listă → 'orphan' (zero apeluri suplimentare)
 *       - dacă e în listă → `getUserConfig` pentru a verifica `suspended` +
 *         `package` (apel per cont, dar doar pentru cele existente).
 *    4. Concurency limitată la 5 per server pentru a nu suprasolicita DA.
 *
 *  Persistăm `daSyncStatus` + `daSyncIssue` + `lastSyncedAt` pentru fiecare
 *  cont. Modalul citește din nou prin `getProvisioningHistory` după mutație.
 * ============================================================ */

type ReconcileBucket = {
	checked: number;
	ok: number;
	orphans: number;
	suspendedOnDa: number;
	activeOnDa: number;
	packageMismatch: number;
	errors: number;
};

const PER_SERVER_CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let cursor = 0;
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (true) {
			const i = cursor++;
			if (i >= items.length) return;
			results[i] = await fn(items[i]);
		}
	});
	await Promise.all(workers);
	return results;
}

export const reconcileHostingWithDA = command(async () => {
	const event = getRequestEvent();
	const tenantId = tenantIdFromEvent(event);
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');
	if (actor.kind !== 'tenant') throw new Error('Forbidden');

	// 1) Conturile care merită verificate: active + suspended + pending. Excludem
	//    'terminated' / 'failed' / 'cancelled' — pentru acelea, „nu există pe DA"
	//    e starea așteptată, nu un orphan.
	const accounts = await db
		.select({
			id: table.hostingAccount.id,
			daUsername: table.hostingAccount.daUsername,
			domain: table.hostingAccount.domain,
			status: table.hostingAccount.status,
			daServerId: table.hostingAccount.daServerId,
			daPackageName: table.hostingAccount.daPackageName
		})
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				inArray(table.hostingAccount.status, ['active', 'suspended', 'pending'])
			)
		);

	if (accounts.length === 0) {
		return {
			checked: 0,
			ok: 0,
			orphans: 0,
			suspendedOnDa: 0,
			activeOnDa: 0,
			packageMismatch: 0,
			errors: 0,
			discrepancies: [] as Array<{
				id: string;
				daUsername: string;
				domain: string;
				crmStatus: string;
				daSyncStatus: string;
				daSyncIssue: string;
			}>,
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString()
		};
	}

	// 2) Indexează serverele după id.
	const serverIds = Array.from(new Set(accounts.map((a) => a.daServerId)));
	const servers = await db
		.select()
		.from(table.daServer)
		.where(and(inArray(table.daServer.id, serverIds), eq(table.daServer.tenantId, tenantId)));
	const serverById = new Map(servers.map((s) => [s.id, s]));

	// 3) Grupează conturile pe server.
	const byServer = new Map<string, typeof accounts>();
	for (const a of accounts) {
		const list = byServer.get(a.daServerId) ?? [];
		list.push(a);
		byServer.set(a.daServerId, list);
	}

	const startedAt = new Date().toISOString();
	const bucket: ReconcileBucket = {
		checked: 0,
		ok: 0,
		orphans: 0,
		suspendedOnDa: 0,
		activeOnDa: 0,
		packageMismatch: 0,
		errors: 0
	};
	const discrepancies: Array<{
		id: string;
		daUsername: string;
		domain: string;
		crmStatus: string;
		daSyncStatus: string;
		daSyncIssue: string;
	}> = [];

	type ReconcileUpdate = {
		id: string;
		daSyncStatus:
			| 'ok'
			| 'orphan'
			| 'suspended_on_da'
			| 'active_on_da'
			| 'package_mismatch'
			| 'server_error';
		daSyncIssue: string | null;
	};
	const updates: ReconcileUpdate[] = [];

	// 4) Pentru fiecare server, listează usernames + check per cont (concurency limitată).
	await Promise.all(
		Array.from(byServer.entries()).map(async ([serverId, list]) => {
			const server = serverById.get(serverId);
			if (!server) {
				// Server inexistent în CRM — marcăm toate conturile ca server_error.
				for (const a of list) {
					bucket.checked++;
					bucket.errors++;
					updates.push({
						id: a.id,
						daSyncStatus: 'server_error',
						daSyncIssue: 'Serverul DA nu mai există în CRM'
					});
					discrepancies.push({
						id: a.id,
						daUsername: a.daUsername,
						domain: a.domain,
						crmStatus: a.status,
						daSyncStatus: 'server_error',
						daSyncIssue: 'Serverul DA nu mai există în CRM'
					});
				}
				return;
			}

			const daClient = await createDAClient(tenantId, server);

			await mapWithConcurrency(list, PER_SERVER_CONCURRENCY, async (account) => {
				bucket.checked++;
				try {
					const config = await daClient.getUserConfig(account.daUsername);
					const daSuspended = !!config.suspended;
					const daPackage = config.package ?? '';
					const crmPackage = account.daPackageName ?? '';

					// Prioritate: suspended-mismatch > package-mismatch > ok
					if (daSuspended && account.status === 'active') {
						bucket.suspendedOnDa++;
						const issue = 'DA = suspended, CRM = activ';
						updates.push({
							id: account.id,
							daSyncStatus: 'suspended_on_da',
							daSyncIssue: issue
						});
						discrepancies.push({
							id: account.id,
							daUsername: account.daUsername,
							domain: account.domain,
							crmStatus: account.status,
							daSyncStatus: 'suspended_on_da',
							daSyncIssue: issue
						});
						return;
					}
					if (!daSuspended && account.status === 'suspended') {
						bucket.activeOnDa++;
						const issue = 'DA = activ, CRM = suspendat';
						updates.push({
							id: account.id,
							daSyncStatus: 'active_on_da',
							daSyncIssue: issue
						});
						discrepancies.push({
							id: account.id,
							daUsername: account.daUsername,
							domain: account.domain,
							crmStatus: account.status,
							daSyncStatus: 'active_on_da',
							daSyncIssue: issue
						});
						return;
					}
					if (daPackage && crmPackage && daPackage !== crmPackage) {
						bucket.packageMismatch++;
						const issue = `Pachet DA: "${daPackage}" · CRM: "${crmPackage}"`;
						updates.push({
							id: account.id,
							daSyncStatus: 'package_mismatch',
							daSyncIssue: issue
						});
						discrepancies.push({
							id: account.id,
							daUsername: account.daUsername,
							domain: account.domain,
							crmStatus: account.status,
							daSyncStatus: 'package_mismatch',
							daSyncIssue: issue
						});
						return;
					}
					bucket.ok++;
					updates.push({ id: account.id, daSyncStatus: 'ok', daSyncIssue: null });
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					const isNotFound = /404|not found|user.*not.*exist/i.test(msg);
					if (isNotFound) {
						bucket.orphans++;
						const issue = `Contul "${account.daUsername}" nu există pe ${server.hostname}`;
						updates.push({
							id: account.id,
							daSyncStatus: 'orphan',
							daSyncIssue: issue
						});
						discrepancies.push({
							id: account.id,
							daUsername: account.daUsername,
							domain: account.domain,
							crmStatus: account.status,
							daSyncStatus: 'orphan',
							daSyncIssue: issue
						});
					} else {
						bucket.errors++;
						const issue = `DA error: ${msg.slice(0, 140)}`;
						updates.push({
							id: account.id,
							daSyncStatus: 'server_error',
							daSyncIssue: issue
						});
						discrepancies.push({
							id: account.id,
							daUsername: account.daUsername,
							domain: account.domain,
							crmStatus: account.status,
							daSyncStatus: 'server_error',
							daSyncIssue: issue
						});
					}
				}
			});
		})
	);

	// 5) Persistăm rezultatele. UPDATE-uri pe loturi mici (evităm SQL gigantic).
	const lastSyncedAtIso = new Date().toISOString();
	for (const u of updates) {
		await db
			.update(table.hostingAccount)
			.set({
				daSyncStatus: u.daSyncStatus,
				daSyncIssue: u.daSyncIssue,
				lastSyncedAt: lastSyncedAtIso
			})
			.where(
				and(
					eq(table.hostingAccount.id, u.id),
					eq(table.hostingAccount.tenantId, tenantId)
				)
			);
	}

	return {
		...bucket,
		discrepancies,
		startedAt,
		finishedAt: new Date().toISOString()
	};
});
