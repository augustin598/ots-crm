import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, count, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getActor } from '$lib/server/get-actor';
import { assertCan, can } from '$lib/server/access';
import { encrypt } from '$lib/server/plugins/smartbill/crypto';
import { createDAClient } from '$lib/server/plugins/directadmin/factory';
import { runWithAudit } from '$lib/server/plugins/directadmin/audit';
import {
	assertHostnameSafe,
	HostnameNotAllowedError
} from '$lib/server/plugins/directadmin/network-safety';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import type { Actor } from '$lib/server/access';

/**
 * Redact `lastError` for viewers without server-manage capability.
 * Full error text can leak hostnames, IP, response bodies — only admins
 * with `admin.hosting.servers.manage` see the raw message.
 */
function redactLastError(actor: Actor, lastError: string | null): string | null {
	if (!lastError) return null;
	if (can(actor, 'admin.hosting.servers.manage')) return lastError;
	return 'Server unreachable';
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Strip protocol, port, path and whitespace from a user-entered hostname.
 * Returns `{ host, port?, useHttps? }` so the caller can auto-fill port/protocol
 * if the user pasted a full URL.
 */
function parseHostname(raw: string): { host: string; port?: number; useHttps?: boolean } {
	let s = raw.trim();
	let useHttps: boolean | undefined;
	if (s.startsWith('https://')) {
		useHttps = true;
		s = s.slice(8);
	} else if (s.startsWith('http://')) {
		useHttps = false;
		s = s.slice(7);
	}
	s = s.replace(/\/+$/, '').split('/')[0]; // strip path
	let port: number | undefined;
	// IPv4 / hostname with optional :port
	const m = s.match(/^([^:]+)(?::(\d+))?$/);
	if (m) {
		s = m[1];
		if (m[2]) port = parseInt(m[2], 10);
	}
	return { host: s, port, useHttps };
}

const ServerSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Name is required'), v.maxLength(255)),
	hostname: v.pipe(v.string(), v.minLength(1, 'Hostname is required'), v.maxLength(255)),
	port: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)), 2222),
	useHttps: v.optional(v.boolean(), true),
	username: v.pipe(v.string(), v.minLength(1, 'Username is required')),
	password: v.pipe(v.string(), v.minLength(1, 'Password is required'))
});

const UpdateServerSchema = v.object({
	id: v.pipe(v.string(), v.minLength(1)),
	name: v.optional(v.pipe(v.string(), v.minLength(1))),
	hostname: v.optional(v.pipe(v.string(), v.minLength(1))),
	port: v.optional(v.pipe(v.number(), v.integer())),
	useHttps: v.optional(v.boolean()),
	username: v.optional(v.pipe(v.string(), v.minLength(1))),
	password: v.optional(v.pipe(v.string(), v.minLength(1))),
	isActive: v.optional(v.boolean())
});

const IdSchema = v.pipe(v.string(), v.minLength(1));

export const getDAServers = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	const rows = await db
		.select({
			id: table.daServer.id,
			name: table.daServer.name,
			hostname: table.daServer.hostname,
			port: table.daServer.port,
			isActive: table.daServer.isActive,
			lastCheckedAt: table.daServer.lastCheckedAt,
			lastError: table.daServer.lastError,
			daVersion: table.daServer.daVersion,
			createdAt: table.daServer.createdAt
		})
		.from(table.daServer)
		.where(
			and(
				eq(table.daServer.tenantId, event.locals.tenant.id),
				eq(table.daServer.isActive, true)
			)
		);

	return rows.map((r) => ({ ...r, lastError: redactLastError(actor, r.lastError) }));
});

/**
 * In-memory cache for live DA metrics. Avoids hammering DA every time the
 * servers page is rendered (HMR / quick re-navigation). 60s TTL is fresh
 * enough for an admin-facing dashboard without being noisy.
 *
 * Keyed on `${tenantId}:${serverId}` so we never serve another tenant's
 * cached value if the same serverId somehow collides (it can't, but cheap
 * defence-in-depth — see [[multi-tenant]] in memory).
 */
export type LiveMetrics = {
	/** CPU usage % derived from load1 / cores * 100 (capped at 100). */
	cpu: number;
	cpuModel: string | null;
	coresCount: number;
	load1: number;
	load5: number;
	load15: number;
	/** RAM usage % from system-info/memory. */
	memory: number;
	ramUsedBytes: number;
	ramTotalBytes: number;
	/** Disk usage % from the primary user-data partition (prefers /home, falls back to /). */
	disk: number;
	diskUsedBytes: number;
	diskTotalBytes: number;
	diskMount: string;
	/** Total bandwidth used across all users (bytes). */
	bandwidthBytes: number | null;
	/** DA version + available update — drives the "Alerte active" KPI. */
	daVersion: string | null;
	daUpdateAvailable: boolean;
	daUpdateVersion: string | null;
	daUpdateChannel: string | null;
	daEol: boolean;
	daOs: string | null;
	daDistro: string | null;
};
const METRICS_CACHE = new Map<string, { value: LiveMetrics | null; expiresAt: number }>();
const METRICS_TTL_MS = 60_000;

/**
 * Pick the most representative disk partition. DirectAdmin servers typically
 * keep user data under /home; fall back to / if that's missing. Skip /boot,
 * tmpfs, devtmpfs, etc.
 */
function pickPrimaryFs(
	entries: { mountPoint: string; fileSystem: string; totalBytes: number; usedBytes: number }[]
): { mountPoint: string; totalBytes: number; usedBytes: number } | null {
	const real = entries.filter(
		(e) =>
			!['tmpfs', 'devtmpfs', 'overlay', 'squashfs'].includes(e.fileSystem.toLowerCase()) &&
			e.totalBytes > 0
	);
	return (
		real.find((e) => e.mountPoint === '/home') ??
		real.find((e) => e.mountPoint === '/') ??
		// Otherwise: largest real partition.
		real.sort((a, b) => b.totalBytes - a.totalBytes)[0] ??
		null
	);
}

async function fetchLiveMetrics(
	tenantId: string,
	server: typeof table.daServer.$inferSelect
): Promise<LiveMetrics | null> {
	const cacheKey = `${tenantId}:${server.id}`;
	const cached = METRICS_CACHE.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) return cached.value;

	try {
		// 4s timeout — page-load fetch shouldn't stall on dead servers. The
		// caller swallows errors per-server so one bad host doesn't break the
		// whole list.
		const client = createDAClient(tenantId, server, { timeoutMs: 4_000 });
		const [sysCpu, sysMem, sysFs, sysLoad, admin, version] = await Promise.allSettled([
			client.getSystemInfoCpu(),
			client.getSystemInfoMemory(),
			client.getSystemInfoFs(),
			client.getSystemInfoLoad(),
			client.getAdminUsage(),
			client.getVersion()
		]);

		// CPU% — load1 / cores * 100, capped at 100. Not a perfect %
		// (load includes I/O wait), but it's the closest single-shot proxy
		// DirectAdmin exposes without sampling at intervals.
		const cores = sysCpu.status === 'fulfilled' ? sysCpu.value.coresCount : 0;
		const cpuModel =
			sysCpu.status === 'fulfilled' && sysCpu.value.cores[0]
				? sysCpu.value.cores[0].model
				: null;
		const load1 = sysLoad.status === 'fulfilled' ? sysLoad.value.last1 : 0;
		const load5 = sysLoad.status === 'fulfilled' ? sysLoad.value.last5 : 0;
		const load15 = sysLoad.status === 'fulfilled' ? sysLoad.value.last15 : 0;
		const cpuPct =
			cores > 0 && sysLoad.status === 'fulfilled'
				? Math.min(100, Math.round((load1 / cores) * 100))
				: 0;

		// RAM%
		const ramTotal = sysMem.status === 'fulfilled' ? sysMem.value.ram.totalBytes : 0;
		const ramUsed = sysMem.status === 'fulfilled' ? sysMem.value.ram.usedBytes : 0;
		const memoryPct = ramTotal > 0 ? Math.round((ramUsed / ramTotal) * 100) : 0;

		// Disk%
		const primary = sysFs.status === 'fulfilled' ? pickPrimaryFs(sysFs.value) : null;
		const diskTotal = primary?.totalBytes ?? 0;
		const diskUsed = primary?.usedBytes ?? 0;
		const diskPct = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;
		const diskMount = primary?.mountPoint ?? '—';

		// Bandwidth — across all users on this server.
		const bandwidthBytes = admin.status === 'fulfilled' ? admin.value.bandwidthBytes : null;

		// If we couldn't fetch any system-info endpoint, the server is unreachable.
		// Treat that as "no metrics" rather than returning all zeros.
		if (sysCpu.status !== 'fulfilled' && sysMem.status !== 'fulfilled' && sysFs.status !== 'fulfilled') {
			METRICS_CACHE.set(cacheKey, { value: null, expiresAt: Date.now() + METRICS_TTL_MS });
			return null;
		}

		// DA version + update detection.
		const v = version.status === 'fulfilled' ? version.value : null;
		const value: LiveMetrics = {
			cpu: cpuPct,
			cpuModel,
			coresCount: cores,
			load1,
			load5,
			load15,
			memory: memoryPct,
			ramUsedBytes: ramUsed,
			ramTotalBytes: ramTotal,
			disk: diskPct,
			diskUsedBytes: diskUsed,
			diskTotalBytes: diskTotal,
			diskMount,
			bandwidthBytes,
			daVersion: v?.version ?? null,
			daUpdateAvailable: v?.update?.available ?? false,
			daUpdateVersion: v?.update?.version ?? null,
			daUpdateChannel: v?.update?.channel ?? null,
			daEol: v?.eol ?? false,
			daOs: v?.os ?? null,
			daDistro: v?.distro ?? null
		};
		METRICS_CACHE.set(cacheKey, { value, expiresAt: Date.now() + METRICS_TTL_MS });
		return value;
	} catch {
		METRICS_CACHE.set(cacheKey, { value: null, expiresAt: Date.now() + METRICS_TTL_MS });
		return null;
	}
}

/**
 * Same as `getDAServers` but joins counts of hosting accounts and active
 * packages per server, AND fetches live CPU/RAM/disk/bandwidth metrics from
 * DirectAdmin (`/api/resource-usage/latest` + `/api/admin-usage`) in parallel
 * with a 60s in-memory cache. Used by the redesigned servers page.
 *
 * Dead/slow servers degrade gracefully: their `metrics` field is `null` and
 * the UI shows "—" — the rest of the list still renders.
 */
export const getDAServersWithStats = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	const tenantId = event.locals.tenant.id;

	// Full rows — need encrypted creds for the live-metrics fetch below.
	// We strip them from the returned shape so credentials never reach the client.
	const fullRows = await db
		.select()
		.from(table.daServer)
		.where(
			and(eq(table.daServer.tenantId, tenantId), eq(table.daServer.isActive, true))
		);

	// One aggregate query per dimension keeps the SQL portable across libSQL /
	// Postgres. With <100 servers per tenant the join cost is negligible.
	const accountsAgg = await db
		.select({
			daServerId: table.hostingAccount.daServerId,
			total: count().as('total')
		})
		.from(table.hostingAccount)
		.where(eq(table.hostingAccount.tenantId, tenantId))
		.groupBy(table.hostingAccount.daServerId);

	const packagesAgg = await db
		.select({
			daServerId: table.daPackage.daServerId,
			total: count().as('total')
		})
		.from(table.daPackage)
		.where(
			and(eq(table.daPackage.tenantId, tenantId), eq(table.daPackage.isActive, true))
		)
		.groupBy(table.daPackage.daServerId);

	const accountsBySrv = new Map(accountsAgg.map((r) => [r.daServerId, r.total]));
	const packagesBySrv = new Map(packagesAgg.map((r) => [r.daServerId, r.total]));

	// Fan out metric fetches in parallel — each is independently catchable.
	const metricsList = await Promise.all(
		fullRows.map((row) => fetchLiveMetrics(tenantId, row))
	);
	const metricsBySrv = new Map(fullRows.map((r, i) => [r.id, metricsList[i]]));

	return fullRows.map((r) => ({
		id: r.id,
		name: r.name,
		hostname: r.hostname,
		port: r.port,
		useHttps: r.useHttps,
		isActive: r.isActive,
		lastCheckedAt: r.lastCheckedAt,
		lastError: redactLastError(actor, r.lastError),
		daVersion: r.daVersion,
		lastSyncResult: r.lastSyncResult,
		createdAt: r.createdAt,
		accountsCount: accountsBySrv.get(r.id) ?? 0,
		packagesCount: packagesBySrv.get(r.id) ?? 0,
		metrics: metricsBySrv.get(r.id) ?? null
	}));
});

export const getDAServer = query(IdSchema, async (serverId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	const [server] = await db
		.select({
			id: table.daServer.id,
			name: table.daServer.name,
			hostname: table.daServer.hostname,
			port: table.daServer.port,
			isActive: table.daServer.isActive,
			lastCheckedAt: table.daServer.lastCheckedAt,
			lastError: table.daServer.lastError,
			daVersion: table.daServer.daVersion,
			createdAt: table.daServer.createdAt
		})
		.from(table.daServer)
		.where(
			and(
				eq(table.daServer.id, serverId),
				eq(table.daServer.tenantId, event.locals.tenant.id),
				eq(table.daServer.isActive, true)
			)
		)
		.limit(1);

	if (!server) throw new Error('Server not found');

	const packages = await db
		.select()
		.from(table.daPackage)
		.where(
			and(
				eq(table.daPackage.daServerId, serverId),
				eq(table.daPackage.tenantId, event.locals.tenant.id)
			)
		);

	return {
		...server,
		lastError: redactLastError(actor, server.lastError),
		packages
	};
});

export const addDAServer = command(ServerSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.servers.manage');

	const tenantId = event.locals.tenant.id;

	// Sanitize hostname — strip protocol/port/path if user pasted a URL
	const parsed = parseHostname(data.hostname);
	const finalHost = parsed.host;
	const finalPort = parsed.port ?? data.port ?? 2222;
	const finalUseHttps = parsed.useHttps ?? data.useHttps ?? true;

	// SSRF hardening — block private IPs, loopback, link-local, cloud metadata.
	// Validate BEFORE persisting so we never store a malicious target.
	try {
		await assertHostnameSafe(finalHost);
	} catch (e) {
		if (e instanceof HostnameNotAllowedError) {
			throw new Error(`Hostname not allowed: ${e.message}`);
		}
		throw e;
	}

	const id = generateId();
	const usernameEncrypted = encrypt(tenantId, data.username);
	const passwordEncrypted = encrypt(tenantId, data.password);

	await db.insert(table.daServer).values({
		id,
		tenantId,
		name: data.name,
		hostname: finalHost,
		port: finalPort,
		useHttps: finalUseHttps,
		usernameEncrypted,
		passwordEncrypted,
		isActive: true
	});

	// Test connection immediately
	try {
		const daClient = createDAClient(tenantId, {
			hostname: finalHost,
			port: finalPort,
			useHttps: finalUseHttps,
			usernameEncrypted,
			passwordEncrypted
		});
		const result = await runWithAudit(
			{ tenantId, daServerId: id, action: 'test', trigger: 'manual' },
			() => daClient.ping()
		);
		await db
			.update(table.daServer)
			.set({
				lastCheckedAt: new Date().toISOString(),
				lastError: result.online ? null : 'Ping failed',
				updatedAt: new Date()
			})
			.where(eq(table.daServer.id, id));
		return { id, online: result.online, responseMs: result.responseMs };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		await db
			.update(table.daServer)
			.set({
				lastCheckedAt: new Date().toISOString(),
				lastError: msg,
				updatedAt: new Date()
			})
			.where(eq(table.daServer.id, id));
		return { id, online: false, responseMs: 0, error: msg };
	}
});

export const updateDAServer = command(UpdateServerSchema, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.servers.manage');

	const tenantId = event.locals.tenant.id;
	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (params.name) updates.name = params.name;
	if (params.hostname) {
		// Sanitize + SSRF validate on hostname change
		const parsed = parseHostname(params.hostname);
		const finalHost = parsed.host;
		try {
			await assertHostnameSafe(finalHost);
		} catch (e) {
			if (e instanceof HostnameNotAllowedError) {
				throw new Error(`Hostname not allowed: ${e.message}`);
			}
			throw e;
		}
		updates.hostname = finalHost;
		if (parsed.port !== undefined) updates.port = parsed.port;
		if (parsed.useHttps !== undefined) updates.useHttps = parsed.useHttps;
	}
	if (params.port !== undefined) updates.port = params.port;
	if (params.useHttps !== undefined) updates.useHttps = params.useHttps;
	if (params.isActive !== undefined) updates.isActive = params.isActive;
	if (params.username) updates.usernameEncrypted = encrypt(tenantId, params.username);
	if (params.password) updates.passwordEncrypted = encrypt(tenantId, params.password);

	await db
		.update(table.daServer)
		.set(updates)
		.where(and(eq(table.daServer.id, params.id), eq(table.daServer.tenantId, tenantId)));

	return { success: true };
});

export const deleteDAServer = command(IdSchema, async (serverId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.servers.manage');

	await db
		.update(table.daServer)
		.set({ isActive: false, updatedAt: new Date() })
		.where(
			and(
				eq(table.daServer.id, serverId),
				eq(table.daServer.tenantId, event.locals.tenant.id)
			)
		);

	return { success: true };
});

export const testDAServer = command(IdSchema, async (serverId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.servers.manage');

	const tenantId = event.locals.tenant.id;
	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, serverId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server not found');

	try {
		const daClient = createDAClient(tenantId, server);
		const result = await runWithAudit(
			{ tenantId, daServerId: serverId, action: 'test', trigger: 'manual' },
			() => daClient.ping()
		);
		await db
			.update(table.daServer)
			.set({
				lastCheckedAt: new Date().toISOString(),
				lastError: result.online ? null : 'Connection failed',
				updatedAt: new Date()
			})
			.where(eq(table.daServer.id, serverId));
		return { online: result.online, responseMs: result.responseMs };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		await db
			.update(table.daServer)
			.set({ lastCheckedAt: new Date().toISOString(), lastError: msg, updatedAt: new Date() })
			.where(eq(table.daServer.id, serverId));
		return { online: false, responseMs: 0, error: msg };
	}
});

export const syncDAPackages = command(IdSchema, async (serverId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.servers.manage');

	const tenantId = event.locals.tenant.id;
	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, serverId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server not found');

	logInfo('directadmin', 'sync.start', {
		tenantId,
		metadata: { serverId, serverName: server.name, hostname: server.hostname }
	});

	const daClient = createDAClient(tenantId, server);

	let packageNames: string[];
	try {
		packageNames = await runWithAudit(
			{ tenantId, daServerId: serverId, action: 'sync', trigger: 'manual' },
			() => daClient.listUserPackages()
		);
	} catch (e) {
		const { message } = serializeError(e);
		logError('directadmin', `sync.list_failed: ${message}`, {
			tenantId,
			metadata: { serverId }
		});
		throw new Error(`Nu am putut lista pachetele de pe DA: ${message}`);
	}

	logInfo('directadmin', 'sync.list_ok', {
		tenantId,
		metadata: { serverId, packageCount: packageNames.length, packages: packageNames }
	});

	const now = new Date().toISOString();
	let synced = 0;
	let updated = 0;
	const failures: { pkg: string; error: string }[] = [];
	const seenPackages = new Set(packageNames);

	for (const pkgName of packageNames) {
		// Fetch full limits — DA returns "unlimited" for unbounded, parsed to null.
		let details;
		try {
			details = await daClient.getPackageDetails(pkgName);
		} catch (e) {
			const errMsg = e instanceof Error ? e.message : String(e);
			failures.push({ pkg: pkgName, error: errMsg });
			logError('directadmin', `sync.detail_failed: ${errMsg}`, {
				tenantId,
				metadata: { serverId, pkg: pkgName }
			});
			continue;
		}

		// All 1:1 fields from DA Edit Package UI. Limits = nullable integer
		// (null = unlimited), flags = boolean, skin/language = nullable text.
		const limitFields = {
			bandwidth: details.bandwidth,
			quota: details.quota,
			maxEmailAccounts: details.maxEmailAccounts,
			maxEmailForwarders: details.maxEmailForwarders,
			maxMailingLists: details.maxMailingLists,
			maxAutoresponders: details.maxAutoresponders,
			maxDatabases: details.maxDatabases,
			maxFtpAccounts: details.maxFtpAccounts,
			maxDomains: details.maxDomains,
			maxSubdomains: details.maxSubdomains,
			maxDomainPointers: details.maxDomainPointers,
			maxInodes: details.maxInodes,
			emailDailyLimit: details.emailDailyLimit,
			anonymousFtp: details.anonymousFtp,
			cgi: details.cgi,
			php: details.php,
			ssl: details.ssl,
			ssh: details.ssh,
			dnsControl: details.dnsControl,
			cron: details.cron,
			spam: details.spam,
			clamav: details.clamav,
			wordpress: details.wordpress,
			git: details.git,
			redis: details.redis,
			suspendAtLimit: details.suspendAtLimit,
			oversold: details.oversold,
			skin: details.skin,
			language: details.language,
			rawData: details.raw as unknown as Record<string, unknown>,
			isActive: true,
			lastSyncedAt: now
		};

		const existing = await db
			.select({ id: table.daPackage.id })
			.from(table.daPackage)
			.where(
				and(
					eq(table.daPackage.daServerId, serverId),
					eq(table.daPackage.daName, pkgName),
					eq(table.daPackage.tenantId, tenantId)
				)
			)
			.limit(1);

		if (existing.length === 0) {
			await db.insert(table.daPackage).values({
				id: generateId(),
				tenantId,
				daServerId: serverId,
				daName: pkgName,
				type: 'user',
				...limitFields
			});
			synced++;
			logInfo('directadmin', 'sync.detail_inserted', {
				tenantId,
				metadata: { serverId, pkg: pkgName }
			});
		} else {
			await db
				.update(table.daPackage)
				.set({ ...limitFields, updatedAt: new Date() })
				.where(eq(table.daPackage.id, existing[0].id));
			updated++;
			logInfo('directadmin', 'sync.detail_updated', {
				tenantId,
				metadata: { serverId, pkg: pkgName }
			});
		}
	}

	// Soft-delete stale packages: those present in DB but absent from DA now.
	// Hard delete would break hostingProduct.daPackageId / hostingAccount.daPackageId FKs.
	const allDbPackages = await db
		.select({ id: table.daPackage.id, daName: table.daPackage.daName })
		.from(table.daPackage)
		.where(
			and(eq(table.daPackage.daServerId, serverId), eq(table.daPackage.tenantId, tenantId))
		);
	let deactivated = 0;
	for (const dbPkg of allDbPackages) {
		if (!seenPackages.has(dbPkg.daName)) {
			await db
				.update(table.daPackage)
				.set({ isActive: false, updatedAt: new Date() })
				.where(eq(table.daPackage.id, dbPkg.id));
			deactivated++;
		}
	}

	const result = {
		ranAt: now,
		packageCount: packageNames.length,
		synced,
		updated,
		deactivated,
		failures
	};

	// Persist sync summary on the server row so admins can see status without
	// tailing logs. Doubles as a record of the last-known package set.
	await db
		.update(table.daServer)
		.set({ lastSyncResult: result, updatedAt: new Date() })
		.where(eq(table.daServer.id, serverId));

	logInfo('directadmin', 'sync.complete', { tenantId, metadata: { serverId, ...result } });

	return { synced, updated, deactivated, total: packageNames.length, failures };
});

/**
 * List active DA packages on a given server, scoped to the caller's tenant.
 * Used by the hosting-products admin form to populate the package dropdown.
 */
export const getDAPackagesForServer = query(IdSchema, async (serverId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	const tenantId = event.locals.tenant.id;
	return db
		.select()
		.from(table.daPackage)
		.where(
			and(
				eq(table.daPackage.daServerId, serverId),
				eq(table.daPackage.tenantId, tenantId),
				eq(table.daPackage.isActive, true)
			)
		)
		.orderBy(table.daPackage.daName);
});

/**
 * Admin diagnostic — returns the raw text body of either the package-list
 * legacy endpoint or a specific package's details endpoint. Used by the
 * "Diagnose Sync" button to inspect what DA actually returns when sync fails
 * (different DA versions return different shapes, hard to debug from logs alone).
 */
const DebugRawSchema = v.object({
	serverId: v.pipe(v.string(), v.minLength(1)),
	packageName: v.optional(v.string())
});

export const debugRawPackageResponse = command(DebugRawSchema, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.servers.manage');

	const tenantId = event.locals.tenant.id;
	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, params.serverId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server not found');

	const daClient = createDAClient(tenantId, server);
	const path = params.packageName
		? `/CMD_API_PACKAGES_USER?package=${encodeURIComponent(params.packageName)}`
		: '/CMD_API_PACKAGES_USER';
	const raw = await daClient.getRawLegacyResponse(path);
	return { path, status: raw.status, body: raw.body.slice(0, 5000) };
});
