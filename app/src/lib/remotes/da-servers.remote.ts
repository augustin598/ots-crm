import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
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
