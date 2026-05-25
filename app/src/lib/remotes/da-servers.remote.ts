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
import { syncDAPackagesForServer } from '$lib/server/plugins/directadmin/sync-packages';
import {
	assertHostnameSafe,
	HostnameNotAllowedError
} from '$lib/server/plugins/directadmin/network-safety';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import type { Actor } from '$lib/server/access';
import { defaultPackageInput, type PackageInput } from '$lib/server/plugins/directadmin/package-serializer';
import { DirectAdminApiError } from '$lib/server/plugins/directadmin/errors';

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
	const result = await syncDAPackagesForServer(tenantId, serverId, 'manual');
	return {
		synced: result.synced,
		updated: result.updated,
		deactivated: result.deactivated,
		total: result.packageCount,
		failures: result.failures
	};
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

// ============================================================================
// DA package CRUD (CMD_API_MANAGE_USER_PACKAGES)
// ============================================================================
//
// Lets admins create / edit / delete DA user packages directly from the CRM.
// DA package names are global to the server, so we auto-prefix with the tenant
// slug to prevent cross-tenant collisions (e.g. tenant `ots` creating "Pro"
// would land as "ots-Pro" on DA, leaving room for tenant `t2` to have its own
// "t2-Pro" on the same server).
//
// Sync interaction:
// `sync-packages.ts` looks at `createdByTenant` and refuses to clobber CRM-
// owned rows. So an admin can safely edit a CRM-created package without
// worrying that the next sync overwrites their changes.

const PackageInputSchema = v.object({
	bandwidth: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	quota: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	maxInodes: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	maxDomains: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	maxSubdomains: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	maxDomainPointers: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	maxEmailAccounts: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	maxEmailForwarders: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	maxMailingLists: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	maxAutoresponders: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	maxDatabases: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	maxFtpAccounts: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	emailDailyLimit: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	anonymousFtp: v.boolean(),
	cgi: v.boolean(),
	php: v.boolean(),
	ssl: v.boolean(),
	ssh: v.boolean(),
	dnsControl: v.boolean(),
	cron: v.boolean(),
	spam: v.boolean(),
	clamav: v.boolean(),
	wordpress: v.boolean(),
	git: v.boolean(),
	redis: v.boolean(),
	suspendAtLimit: v.boolean(),
	oversold: v.boolean(),
	jailed: v.boolean(),
	securityTxt: v.boolean(),
	cpuQuota: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	ioReadBandwidthMax: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	iopsReadMax: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	ioWriteBandwidthMax: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	iopsWriteMax: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	memoryHigh: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	memoryMax: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	tasksMax: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
	skin: v.nullable(v.pipe(v.string(), v.maxLength(64))),
	language: v.nullable(v.pipe(v.string(), v.maxLength(16))),
	featureSetsPolicy: v.picklist(['allow_all_commands', 'allow_selected_features']),
	featureSetsSelected: v.array(v.string()),
	pluginsPolicy: v.picklist(['allow_all', 'deny_selected', 'allow_selected']),
	pluginsSelected: v.array(v.string())
});

const CreatePackageSchema = v.object({
	serverId: v.pipe(v.string(), v.minLength(1)),
	// DA accepts alphanumeric + underscore + hyphen + dot in package names.
	// We additionally trim and prefix with tenant slug before sending.
	name: v.pipe(
		v.string(),
		v.minLength(1, 'Numele este obligatoriu'),
		v.maxLength(64),
		v.regex(/^[A-Za-z0-9._-]+$/, 'Doar litere, cifre, "_", "-" sau "."')
	),
	options: PackageInputSchema
});

const UpdatePackageSchema = v.object({
	packageId: v.pipe(v.string(), v.minLength(1)),
	options: PackageInputSchema
});

const DeletePackageSchema = v.pipe(v.string(), v.minLength(1));

function generatePkgId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Build the canonical DA package name from the tenant slug + the admin-typed
 * suffix. Slug is lowercased + sanitised to ensure it's wire-safe.
 */
function finalPackageName(tenantSlug: string, suffix: string): string {
	const slug = tenantSlug.toLowerCase().replace(/[^a-z0-9_-]/g, '');
	return `${slug}-${suffix}`;
}

export const createDAPackage = command(CreatePackageSchema, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.servers.manage');

	const tenantId = event.locals.tenant.id;
	const tenantSlug = event.locals.tenant.slug;
	const userId = event.locals.user.id;

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, params.serverId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Serverul DA nu există sau nu aparține acestui tenant.');

	const daName = finalPackageName(tenantSlug, params.name);
	const opts: PackageInput = { ...defaultPackageInput(), ...params.options };

	// Idempotency: if a package with this exact name already exists on this
	// server in our DB, refuse — admin should edit it instead. Surfaces obvious
	// double-clicks and prevents creating two rows that point at the same DA
	// package (DA would error too, but the message is friendlier from here).
	const [dup] = await db
		.select({ id: table.daPackage.id, createdByTenant: table.daPackage.createdByTenant })
		.from(table.daPackage)
		.where(
			and(
				eq(table.daPackage.daServerId, server.id),
				eq(table.daPackage.daName, daName),
				eq(table.daPackage.tenantId, tenantId)
			)
		)
		.limit(1);
	if (dup) {
		throw new Error(
			`Există deja un pachet cu numele „${daName}" pe acest server. Folosește un alt nume sau editează-l pe cel existent.`
		);
	}

	const daClient = createDAClient(tenantId, server);
	try {
		await runWithAudit(
			{ tenantId, daServerId: server.id, action: 'sync', trigger: 'manual' },
			() => daClient.createPackage(daName, opts)
		);
	} catch (e) {
		const { message } = serializeError(e);
		logError('directadmin', `package.create_failed: ${message}`, {
			tenantId,
			metadata: { serverId: server.id, daName }
		});
		if (e instanceof DirectAdminApiError) throw new Error(`DA: ${e.message}`);
		throw new Error(message);
	}

	// Upsert locally — we know the values we just wrote, so no extra round-trip
	// to DA to fetch them back.
	const id = generatePkgId();
	const now = new Date().toISOString();
	await db.insert(table.daPackage).values({
		id,
		tenantId,
		daServerId: server.id,
		daName,
		type: 'user',
		bandwidth: opts.bandwidth,
		quota: opts.quota,
		maxInodes: opts.maxInodes,
		maxDomains: opts.maxDomains,
		maxSubdomains: opts.maxSubdomains,
		maxDomainPointers: opts.maxDomainPointers,
		maxEmailAccounts: opts.maxEmailAccounts,
		maxEmailForwarders: opts.maxEmailForwarders,
		maxMailingLists: opts.maxMailingLists,
		maxAutoresponders: opts.maxAutoresponders,
		maxDatabases: opts.maxDatabases,
		maxFtpAccounts: opts.maxFtpAccounts,
		emailDailyLimit: opts.emailDailyLimit,
		anonymousFtp: opts.anonymousFtp,
		cgi: opts.cgi,
		php: opts.php,
		ssl: opts.ssl,
		ssh: opts.ssh,
		dnsControl: opts.dnsControl,
		cron: opts.cron,
		spam: opts.spam,
		clamav: opts.clamav,
		wordpress: opts.wordpress,
		git: opts.git,
		redis: opts.redis,
		suspendAtLimit: opts.suspendAtLimit,
		oversold: opts.oversold,
		jailed: opts.jailed,
		securityTxt: opts.securityTxt,
		cpuQuota: opts.cpuQuota,
		ioReadBandwidthMax: opts.ioReadBandwidthMax,
		iopsReadMax: opts.iopsReadMax,
		ioWriteBandwidthMax: opts.ioWriteBandwidthMax,
		iopsWriteMax: opts.iopsWriteMax,
		memoryHigh: opts.memoryHigh,
		memoryMax: opts.memoryMax,
		tasksMax: opts.tasksMax,
		featureSetsPolicy: opts.featureSetsPolicy,
		featureSetsSelected: opts.featureSetsSelected,
		pluginsPolicy: opts.pluginsPolicy,
		pluginsSelected: opts.pluginsSelected,
		skin: opts.skin,
		language: opts.language,
		createdByTenant: true,
		createdByUserId: userId,
		isActive: true,
		lastSyncedAt: now
	});

	logInfo('directadmin', 'package.created', {
		tenantId,
		metadata: { serverId: server.id, daName, packageId: id }
	});
	return { id, daName };
});

export const updateDAPackage = command(UpdatePackageSchema, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.servers.manage');

	const tenantId = event.locals.tenant.id;

	const [pkg] = await db
		.select()
		.from(table.daPackage)
		.where(and(eq(table.daPackage.id, params.packageId), eq(table.daPackage.tenantId, tenantId)))
		.limit(1);
	if (!pkg) throw new Error('Pachetul DA nu există sau nu aparține acestui tenant.');

	if (!pkg.createdByTenant) {
		// Refuse to edit a package that was synced from DA — the sync cron
		// would re-overwrite our changes on the next pass. The user can clone
		// it into a CRM-owned package if they want CRM-side control.
		throw new Error(
			'Acest pachet a fost importat din DirectAdmin și nu poate fi editat din CRM. Creează un pachet nou bazat pe el dacă vrei să-l modifici.'
		);
	}

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, pkg.daServerId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server DA invalid.');

	const opts: PackageInput = { ...defaultPackageInput(), ...params.options };

	const daClient = createDAClient(tenantId, server);
	try {
		await runWithAudit(
			{ tenantId, daServerId: server.id, action: 'sync', trigger: 'manual' },
			() => daClient.modifyPackage(pkg.daName, opts)
		);
	} catch (e) {
		const { message } = serializeError(e);
		logError('directadmin', `package.update_failed: ${message}`, {
			tenantId,
			metadata: { serverId: server.id, daName: pkg.daName }
		});
		if (e instanceof DirectAdminApiError) throw new Error(`DA: ${e.message}`);
		throw new Error(message);
	}

	const now = new Date().toISOString();
	await db
		.update(table.daPackage)
		.set({
			bandwidth: opts.bandwidth,
			quota: opts.quota,
			maxInodes: opts.maxInodes,
			maxDomains: opts.maxDomains,
			maxSubdomains: opts.maxSubdomains,
			maxDomainPointers: opts.maxDomainPointers,
			maxEmailAccounts: opts.maxEmailAccounts,
			maxEmailForwarders: opts.maxEmailForwarders,
			maxMailingLists: opts.maxMailingLists,
			maxAutoresponders: opts.maxAutoresponders,
			maxDatabases: opts.maxDatabases,
			maxFtpAccounts: opts.maxFtpAccounts,
			emailDailyLimit: opts.emailDailyLimit,
			anonymousFtp: opts.anonymousFtp,
			cgi: opts.cgi,
			php: opts.php,
			ssl: opts.ssl,
			ssh: opts.ssh,
			dnsControl: opts.dnsControl,
			cron: opts.cron,
			spam: opts.spam,
			clamav: opts.clamav,
			wordpress: opts.wordpress,
			git: opts.git,
			redis: opts.redis,
			suspendAtLimit: opts.suspendAtLimit,
			oversold: opts.oversold,
			jailed: opts.jailed,
			securityTxt: opts.securityTxt,
			cpuQuota: opts.cpuQuota,
			ioReadBandwidthMax: opts.ioReadBandwidthMax,
			iopsReadMax: opts.iopsReadMax,
			ioWriteBandwidthMax: opts.ioWriteBandwidthMax,
			iopsWriteMax: opts.iopsWriteMax,
			memoryHigh: opts.memoryHigh,
			memoryMax: opts.memoryMax,
			tasksMax: opts.tasksMax,
			featureSetsPolicy: opts.featureSetsPolicy,
			featureSetsSelected: opts.featureSetsSelected,
			pluginsPolicy: opts.pluginsPolicy,
			pluginsSelected: opts.pluginsSelected,
			skin: opts.skin,
			language: opts.language,
			lastSyncedAt: now,
			updatedAt: new Date()
		})
		.where(eq(table.daPackage.id, pkg.id));

	logInfo('directadmin', 'package.updated', {
		tenantId,
		metadata: { serverId: server.id, daName: pkg.daName, packageId: pkg.id }
	});
	return { success: true };
});

export const deleteDAPackage = command(DeletePackageSchema, async (packageId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.servers.manage');

	const tenantId = event.locals.tenant.id;

	const [pkg] = await db
		.select()
		.from(table.daPackage)
		.where(and(eq(table.daPackage.id, packageId), eq(table.daPackage.tenantId, tenantId)))
		.limit(1);
	if (!pkg) throw new Error('Pachetul DA nu există sau nu aparține acestui tenant.');

	// Refuse to delete if any hosting account uses this package — DA itself
	// would refuse, but checking here gives a clearer error and avoids a wasted
	// DA round-trip.
	const [accRow] = await db
		.select({ count: count() })
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.daPackageId, pkg.id),
				eq(table.hostingAccount.tenantId, tenantId)
			)
		);
	if (Number(accRow?.count ?? 0) > 0) {
		throw new Error(
			`Pachetul „${pkg.daName}" este folosit de ${accRow.count} conturi de hosting. Mută acele conturi pe alt pachet înainte să-l ștergi.`
		);
	}

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, pkg.daServerId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server DA invalid.');

	const daClient = createDAClient(tenantId, server);
	try {
		await runWithAudit(
			{ tenantId, daServerId: server.id, action: 'sync', trigger: 'manual' },
			() => daClient.deletePackage(pkg.daName)
		);
	} catch (e) {
		const { message } = serializeError(e);
		logError('directadmin', `package.delete_failed: ${message}`, {
			tenantId,
			metadata: { serverId: server.id, daName: pkg.daName }
		});
		if (e instanceof DirectAdminApiError) throw new Error(`DA: ${e.message}`);
		throw new Error(message);
	}

	// Soft-delete locally — hostingProduct.daPackageId FK has `onDelete: 'set null'`
	// already, so any product still linked just loses the limits source.
	await db
		.update(table.daPackage)
		.set({ isActive: false, updatedAt: new Date() })
		.where(eq(table.daPackage.id, pkg.id));

	logInfo('directadmin', 'package.deleted', {
		tenantId,
		metadata: { serverId: server.id, daName: pkg.daName, packageId: pkg.id }
	});
	return { success: true };
});
