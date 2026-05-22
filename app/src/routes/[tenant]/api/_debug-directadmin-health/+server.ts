import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { createDAClient } from '$lib/server/plugins/directadmin/factory';
import { DirectAdminApiError, classifyDaError } from '$lib/server/plugins/directadmin/client';
import { generateDaUsername, generateDaPassword } from '$lib/utils/da-generators';
import { runWithAudit, withAccountLock } from '$lib/server/plugins/directadmin/audit';
import { logInfo, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * DirectAdmin upstream + provisioning health probe — mirrors the keez/stripe
 * debug endpoints. Use to isolate "is DA down?" vs "is our wrapper amplifying a
 * single hiccup?" vs "is the create payload wrong?" without tailing dev server
 * logs or wrestling with the audit table.
 *
 * Read-only probes (GET):
 *   action=servers                       — list daServers for this tenant
 *   action=ping&serverId=X               — auth + connectivity check
 *   action=info&serverId=X               — admin usage + DA version
 *   action=list-ips&serverId=X           — IPs DA exposes for new user creation
 *   action=list-packages&serverId=X      — user packages available on DA
 *   action=list-users&serverId=X[&q=foo] — search users (admin's pool)
 *   action=check-username&serverId=X&username=foo
 *                                        — pre-flight `userExists` probe
 *   action=check-domain&serverId=X&domain=foo.ro[&deep=true]
 *                                        — pre-flight `domainExists` probe
 *   action=try-create&serverId=X&username=foo&domain=foo.ro&package=Basic
 *                                        — DRY RUN: runs all pre-flights, picks
 *                                          IP, validates package — does NOT call
 *                                          CMD_API_ACCOUNT_USER. Returns the
 *                                          exact payload that WOULD be sent.
 *   action=audit-log[&limit=20]          — recent da_audit_log entries (this tenant)
 *
 * Mutating actions (POST, require `?confirm=yes`):
 *   action=real-create&serverId=X        — create a real DA user from the body
 *                                          payload. Use sparingly — actually
 *                                          provisions. STRICT RULE: DA account
 *                                          deletion is admin-only via the DA
 *                                          panel — this endpoint will NEVER
 *                                          expose a delete action.
 *
 * Admin-only. Tenant-scoped on `locals.tenant`.
 */

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
}

function isValidUsername(s: string): boolean {
	// DA accepts lowercase alphanumeric, must start with letter, <=16 chars.
	return /^[a-z][a-z0-9]{1,15}$/.test(s);
}

function isValidDomain(s: string): boolean {
	return (
		/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) &&
		!s.startsWith('-') &&
		!s.endsWith('-') &&
		!s.includes('..') &&
		s.length <= 253
	);
}

async function loadServer(tenantId: string, serverId: string) {
	if (!serverId) throw error(400, 'serverId required');
	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, serverId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw error(404, `daServer ${serverId} not found for this tenant`);
	return server;
}

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const action = event.url.searchParams.get('action') ?? 'servers';

	// === servers ============================================================
	if (action === 'servers') {
		const rows = await db
			.select({
				id: table.daServer.id,
				name: table.daServer.name,
				hostname: table.daServer.hostname,
				port: table.daServer.port,
				useHttps: table.daServer.useHttps,
				isActive: table.daServer.isActive,
				lastCheckedAt: table.daServer.lastCheckedAt,
				lastError: table.daServer.lastError,
				daVersion: table.daServer.daVersion
			})
			.from(table.daServer)
			.where(eq(table.daServer.tenantId, tenantId));
		return json({ count: rows.length, servers: rows });
	}

	// === audit-log =========================================================
	if (action === 'audit-log') {
		const limit = Math.min(
			200,
			Math.max(1, Number(event.url.searchParams.get('limit') ?? '20'))
		);
		const successFilter = event.url.searchParams.get('success'); // '0' | '1' | null
		const where = [eq(table.daAuditLog.tenantId, tenantId)];
		if (successFilter === '0') where.push(eq(table.daAuditLog.success, false));
		else if (successFilter === '1') where.push(eq(table.daAuditLog.success, true));
		const rows = await db
			.select({
				id: table.daAuditLog.id,
				action: table.daAuditLog.action,
				trigger: table.daAuditLog.trigger,
				success: table.daAuditLog.success,
				errorMessage: table.daAuditLog.errorMessage,
				durationMs: table.daAuditLog.durationMs,
				hostingAccountId: table.daAuditLog.hostingAccountId,
				daServerId: table.daAuditLog.daServerId,
				createdAt: table.daAuditLog.createdAt
			})
			.from(table.daAuditLog)
			.where(and(...where))
			.orderBy(desc(table.daAuditLog.createdAt))
			.limit(limit);
		return json({ count: rows.length, entries: rows });
	}

	// All remaining actions need a daServer.
	const serverId = event.url.searchParams.get('serverId') ?? '';
	const server = await loadServer(tenantId, serverId);
	const client = createDAClient(tenantId, server);

	// === ping ===============================================================
	if (action === 'ping') {
		const start = performance.now();
		try {
			const r = await client.ping();
			return json({
				ok: r.online,
				durationMs: Math.round(performance.now() - start),
				server: { id: server.id, name: server.name, hostname: server.hostname },
				detail: r
			});
		} catch (err) {
			return errorResponse(err, performance.now() - start);
		}
	}

	// === info ===============================================================
	if (action === 'info') {
		const start = performance.now();
		try {
			const usage = await client.getAdminUsage();
			return json({
				ok: true,
				durationMs: Math.round(performance.now() - start),
				server: { id: server.id, name: server.name, daVersion: server.daVersion },
				adminUsage: usage
			});
		} catch (err) {
			return errorResponse(err, performance.now() - start);
		}
	}

	// === list-ips ===========================================================
	if (action === 'list-ips') {
		const start = performance.now();
		try {
			const chosen = await client.resolveDefaultIp();
			return json({
				ok: true,
				durationMs: Math.round(performance.now() - start),
				selectedIp: chosen,
				note: 'IP-ul ăsta ar fi folosit pentru următoarea creare. Vezi `additional-ips-raw` / `show-user-ips-raw` mai jos pentru lista completă.'
			});
		} catch (err) {
			return errorResponse(err, performance.now() - start);
		}
	}

	// === list-packages =====================================================
	if (action === 'list-packages') {
		const start = performance.now();
		try {
			const pkgs = await client.listUserPackages();
			// Cross-reference cu daPackage din CRM pentru a evidenția gap-uri
			// (package există pe DA dar lipsă în CRM, sau invers).
			const crmPackages = await db
				.select({ id: table.daPackage.id, daName: table.daPackage.daName })
				.from(table.daPackage)
				.where(
					and(
						eq(table.daPackage.tenantId, tenantId),
						eq(table.daPackage.daServerId, server.id)
					)
				);
			const daNames = new Set(pkgs.map((p) => p.toLowerCase()));
			const crmNames = new Set(crmPackages.map((p) => p.daName.toLowerCase()));
			return json({
				ok: true,
				durationMs: Math.round(performance.now() - start),
				daPackages: pkgs,
				crmPackages: crmPackages.map((p) => p.daName),
				inDaNotCrm: pkgs.filter((p) => !crmNames.has(p.toLowerCase())),
				inCrmNotDa: crmPackages.filter((p) => !daNames.has(p.daName.toLowerCase())).map((p) => p.daName)
			});
		} catch (err) {
			return errorResponse(err, performance.now() - start);
		}
	}

	// === list-users ========================================================
	if (action === 'list-users') {
		const start = performance.now();
		const q = event.url.searchParams.get('q') ?? undefined;
		try {
			const users = await client.searchUsers(q);
			return json({
				ok: true,
				durationMs: Math.round(performance.now() - start),
				count: users.length,
				query: q ?? null,
				users: users.slice(0, 100) // cap response
			});
		} catch (err) {
			return errorResponse(err, performance.now() - start);
		}
	}

	// === check-username ====================================================
	if (action === 'check-username') {
		const username = (event.url.searchParams.get('username') ?? '').toLowerCase();
		if (!isValidUsername(username))
			throw error(400, 'username invalid (lowercase, start with letter, max 16 chars)');
		const start = performance.now();
		try {
			const exists = await client.userExists(username);
			return json({
				ok: true,
				durationMs: Math.round(performance.now() - start),
				username,
				exists,
				wouldBlockCreate: exists
			});
		} catch (err) {
			return errorResponse(err, performance.now() - start);
		}
	}

	// === check-domain ======================================================
	if (action === 'check-domain') {
		const domain = (event.url.searchParams.get('domain') ?? '').toLowerCase();
		const deep = event.url.searchParams.get('deep') === 'true';
		if (!isValidDomain(domain)) throw error(400, 'domain invalid');
		const start = performance.now();
		try {
			const exists = await client.domainExists(domain, { deep });
			return json({
				ok: true,
				durationMs: Math.round(performance.now() - start),
				domain,
				deep,
				exists,
				wouldBlockCreate: exists
			});
		} catch (err) {
			return errorResponse(err, performance.now() - start);
		}
	}

	// === try-create (DRY RUN) ==============================================
	if (action === 'try-create') {
		const username = (event.url.searchParams.get('username') ?? '').toLowerCase();
		const domain = (event.url.searchParams.get('domain') ?? '').toLowerCase();
		const pkg = event.url.searchParams.get('package') ?? '';
		const email = event.url.searchParams.get('email') ?? 'test@example.com';
		if (!isValidUsername(username))
			throw error(400, 'username invalid (lowercase, start with letter, max 16 chars)');
		if (!isValidDomain(domain)) throw error(400, 'domain invalid');
		if (!pkg) throw error(400, 'package required');

		const checks: Record<string, unknown> = {};
		const start = performance.now();
		try {
			checks.usernameTaken = await client.userExists(username);
			checks.domainTaken = await client.domainExists(domain);
			checks.packagesOnDa = await client.listUserPackages();
			checks.packageExists =
				(checks.packagesOnDa as string[]).some((p) => p.toLowerCase() === pkg.toLowerCase());
			checks.selectedIp = await client.resolveDefaultIp();

			const wouldSucceed =
				!checks.usernameTaken &&
				!checks.domainTaken &&
				checks.packageExists &&
				!!checks.selectedIp;

			return json({
				ok: true,
				dryRun: true,
				durationMs: Math.round(performance.now() - start),
				wouldSucceed,
				blockers: [
					checks.usernameTaken ? 'username_exists' : null,
					checks.domainTaken ? 'domain_exists' : null,
					!checks.packageExists ? 'package_missing' : null,
					!checks.selectedIp ? 'ip_unavailable' : null
				].filter(Boolean),
				wouldSendPayload: {
					username,
					domain,
					email,
					package: pkg,
					ip: checks.selectedIp,
					passwd: '[generated 17-char with 4 char classes]',
					notify: 'no'
				},
				checks
			});
		} catch (err) {
			return errorResponse(err, performance.now() - start);
		}
	}

	throw error(400, `Unknown action: ${action}`);
};

export const POST: RequestHandler = async (event) => {
	requireAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const action = event.url.searchParams.get('action') ?? '';
	const confirm = event.url.searchParams.get('confirm') === 'yes';

	if (!confirm)
		throw error(400, 'Mutating actions require ?confirm=yes — verifică acțiunea ÎNAINTE.');

	const serverId = event.url.searchParams.get('serverId') ?? '';
	const server = await loadServer(tenantId, serverId);
	const client = createDAClient(tenantId, server);

	// === real-create =======================================================
	if (action === 'real-create') {
		const body = (await event.request.json().catch(() => null)) as
			| {
					username?: string;
					domain?: string;
					package?: string;
					email?: string;
					notify?: boolean;
			  }
			| null;
		if (!body) throw error(400, 'JSON body required');

		const username = (body.username ?? '').toLowerCase() || generateDaUsername('debug');
		const domain = (body.domain ?? `${username}.debug-temp.ots`).toLowerCase();
		const pkg = body.package ?? '';
		const email = body.email ?? 'debug@example.com';
		const password = generateDaPassword();

		if (!isValidUsername(username))
			throw error(400, 'username invalid (lowercase, start with letter, max 16 chars)');
		if (!isValidDomain(domain)) throw error(400, 'domain invalid');
		if (!pkg) throw error(400, 'package required');

		const start = performance.now();
		try {
			// Wrap în audit ca să avem trail (action='create', trigger='manual').
			// Folosim hostingAccountId=null pentru ca DA-create-ul ăsta să nu
			// apară ca legat de un row hosting_account (nu e o comandă reală).
			await withAccountLock(`${tenantId}:${username}`, async () => {
				await runWithAudit(
					{
						tenantId,
						hostingAccountId: null,
						daServerId: server.id,
						action: 'create',
						trigger: 'manual'
					},
					() =>
						client.createUserAccount({
							username,
							password,
							domain,
							email,
							package: pkg,
							notify: body.notify ?? false
						})
				);
			});
			logInfo('directadmin', `_debug real-create OK: ${username}`, {
				tenantId,
				metadata: { username, domain, package: pkg, serverId: server.id }
			});
			return json({
				ok: true,
				durationMs: Math.round(performance.now() - start),
				created: { username, domain, password, package: pkg, email },
				cleanup:
					'Cleanup: ștergerea contului DA se face MANUAL din DirectAdmin panel ' +
					'(Admin → User Manager → Delete). Nu există action delete pe acest endpoint — ' +
					'politica e că ștergerea DA e ireversibilă și admin-only.'
			});
		} catch (err) {
			return errorResponse(err, performance.now() - start);
		}
	}

	throw error(400, `Unknown action: ${action}`);
};

function errorResponse(err: unknown, durationMs: number) {
	const { message } = serializeError(err);
	const kind = err instanceof DirectAdminApiError ? err.kind : classifyDaError(message);
	const daCode = err instanceof DirectAdminApiError ? err.daCode : undefined;
	const statusCode = err instanceof DirectAdminApiError ? err.statusCode : undefined;
	return json(
		{
			ok: false,
			durationMs: Math.round(durationMs),
			error: { message, kind, daCode, statusCode }
		},
		{ status: 200 }
	);
}
