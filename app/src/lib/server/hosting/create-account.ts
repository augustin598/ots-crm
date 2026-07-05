import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { createDAClient } from '$lib/server/plugins/directadmin/factory';
import { runWithAudit, withAccountLock, type DaAuditTrigger } from '$lib/server/plugins/directadmin/audit';
import { DirectAdminApiError } from '$lib/server/plugins/directadmin/client';
import { encrypt } from '$lib/server/plugins/smartbill/crypto';
import { generateDaUsername, generateDaPassword } from '$lib/utils/da-generators';
import { logWarning, logError } from '$lib/server/logger';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import {
	notifyHostingAccountCreated,
	notifyHostingProvisioningFailed
} from './notifications';

/**
 * Shared "create one DA account" pipeline. Same logic the user-facing
 * `/hosting/accounts/new` form has been hitting via `createHostingAccount` — pulled
 * out so the Comenzi hosting drawer can call the exact same path with admin-typed
 * credentials.
 *
 * Caller MUST have already authorized the actor (`assertCan(..., 'admin.hosting.manage')`).
 * This helper does NOT read request context — `tenantId` is the trust boundary.
 *
 * Idempotency is the caller's responsibility (DA will reject duplicate usernames
 * server-side — we rely on that signal rather than pre-checking).
 */
export interface CreateHostingAccountPayload {
	clientId: string;
	daServerId: string;
	daPackageId?: string | undefined;
	hostingProductId?: string | undefined;
	daUsername: string;
	domain: string;
	password: string;
	recurringAmount?: number | undefined; // cents per cycle
	currency?: string | undefined;
	billingCycle?: string | undefined;
	nextDueDate?: string | undefined;
	notes?: string | undefined;
	stripeSubscriptionId?: string | null | undefined;
	/** What action attribution to write to da_audit_log. Defaults to 'manual'. */
	auditTrigger?: DaAuditTrigger;
	/**
	 * When provided, auto-regenerate `daUsername` (via `generateDaUsername`) on
	 * `username_exists` DA error, up to 3 retries. Pass the source seed (business
	 * name or email local-part) — same input `generateDaUsername` would receive.
	 * Manual-flow callers (admin typed exact username) omit this so we don't
	 * silently rewrite their input.
	 */
	autoUsernameSeed?: string;
}

export interface CreateHostingAccountResult {
	id: string;
	daUsername: string;
	domain: string;
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export async function createHostingAccountInternal(
	tenantId: string,
	payload: CreateHostingAccountPayload
): Promise<CreateHostingAccountResult> {
	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, payload.daServerId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server DA inexistent sau aparține altui tenant.');

	let packageName = 'default';
	if (payload.daPackageId) {
		// Defense-in-depth: also pin to the caller's tenant + the chosen DA server.
		// The caller already authorized the actor for this tenant; this prevents a
		// crafted payload that references a package id from a foreign tenant or a
		// different DA server (which would then get applied to this server's user
		// create with a name that may or may not collide).
		const [pkg] = await db
			.select({ daName: table.daPackage.daName })
			.from(table.daPackage)
			.where(
				and(
					eq(table.daPackage.id, payload.daPackageId),
					eq(table.daPackage.tenantId, tenantId),
					eq(table.daPackage.daServerId, payload.daServerId)
				)
			)
			.limit(1);
		if (pkg) packageName = pkg.daName;
	}

	const [clientData] = await db
		.select({ email: table.client.email })
		.from(table.client)
		.where(and(eq(table.client.id, payload.clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	if (!clientData) throw new Error('Clientul nu există pentru acest tenant.');

	const id = generateId();
	const daClient = createDAClient(tenantId, server);

	// Username collision retry strategy: caller-provided username gets ONE chance
	// (admin typed it explicitly), then on `username_exists` we auto-regenerate
	// from a name seed up to MAX_RETRIES times. Manual-flow callers pass exact
	// usernames they want; auto-provision passes a `generateDaUsername`-seeded
	// value that we can safely regenerate. The retry only kicks in when the
	// payload supplies an `autoUsernameSeed`.
	let daUsername = payload.daUsername;
	let daPassword = payload.password;
	const MAX_RETRIES = payload.autoUsernameSeed ? 3 : 0;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const credentialsEncrypted = encrypt(
			tenantId,
			JSON.stringify({ username: daUsername, password: daPassword })
		);

		const insertResult = await withAccountLock(`${tenantId}:${daUsername}`, async () => {
			// Pre-insert in `pending` so the audit row can satisfy the FK on
			// `da_audit_log.hosting_account_id` regardless of DA outcome. See
			// commit notes for the original FK-violation bug.
			await db.insert(table.hostingAccount).values({
				id,
				tenantId,
				clientId: payload.clientId,
				daServerId: payload.daServerId,
				daPackageId: payload.daPackageId,
				hostingProductId: payload.hostingProductId,
				daUsername,
				domain: payload.domain,
				status: 'pending',
				daCredentialsEncrypted: credentialsEncrypted,
				recurringAmount: payload.recurringAmount ?? 0,
				currency: payload.currency ?? 'RON',
				billingCycle: payload.billingCycle ?? 'monthly',
				nextDueDate: payload.nextDueDate,
				notes: payload.notes,
				stripeSubscriptionId: payload.stripeSubscriptionId ?? null
			});

			try {
				await runWithAudit(
					{
						tenantId,
						hostingAccountId: id,
						daServerId: payload.daServerId,
						action: 'create',
						trigger: payload.auditTrigger ?? 'manual'
					},
					() =>
						daClient.createUserAccount({
							username: daUsername,
							password: daPassword,
							domain: payload.domain,
							email: clientData.email ?? '',
							package: packageName
						})
				);

				// DA accepted — promote pending → active. Wrap in Turso-busy
				// retry: a write timeout here leaves a zombie (account live on
				// DA, status='pending' in CRM forever). withTursoBusyRetry tries
				// up to 5 times with exponential backoff.
				await withTursoBusyRetry(
					() =>
						db
							.update(table.hostingAccount)
							.set({ status: 'active', updatedAt: new Date() })
							.where(eq(table.hostingAccount.id, id)),
					{ tenantId, label: 'createHostingAccountInternal/promote-active' }
				).catch((err) => {
					// All retries exhausted — log the zombie so a reconciliation
					// job (future) can detect it. Do NOT throw: the account IS
					// live on DA and the audit log captured success. Best-effort
					// CRM repair is admin-driven from `/hosting/accounts`.
					logWarning(
						'directadmin',
						`zombie risk: DA account created but CRM status promote failed`,
						{
							tenantId,
							metadata: {
								hostingAccountId: id,
								daUsername,
								daServerId: payload.daServerId,
								error: err instanceof Error ? err.message : String(err)
							}
						}
					);
				});
				// Fire welcome email — best-effort, never block the provisioning return value.
				// Failure is logged (and dedupe-tracked inside the notifier) so it can be
				// surfaced via the admin UI without retrying forever.
				notifyHostingAccountCreated(tenantId, id).catch((err) => {
					logError('hosting-email', `welcome email dispatch failed`, {
						tenantId,
						metadata: {
							hostingAccountId: id,
							daUsername,
							error: err instanceof Error ? err.message : String(err)
						}
					});
				});
				return { ok: true as const };
			} catch (err) {
				// Forensic preserve: mark the row `failed` instead of DELETE so
				// the audit log's `hosting_account_id` FK stays valid AND staff
				// can see "X attempts failed" history on the inquiry. UI filters
				// out `status='failed'` from the live account list.
				await db
					.update(table.hostingAccount)
					.set({
						status: 'failed',
						suspendReason:
							err instanceof DirectAdminApiError
								? `da_${err.kind}`
								: 'da_create_failed',
						updatedAt: new Date()
					})
					.where(eq(table.hostingAccount.id, id))
					.catch(() => {});
				// Fire-and-forget admin alert. Rolling 5-min dedupe inside the
				// notifier prevents spam during username_exists retries (same
				// reason within window = dedupe hit). `attempt + 1` converts
				// the 0-indexed loop counter to the 1-indexed "Încercarea N"
				// shown in the admin UI / email body.
				const reason =
					err instanceof DirectAdminApiError ? `da_${err.kind}` : 'da_create_failed';
				notifyHostingProvisioningFailed(tenantId, id, reason, attempt + 1).catch(
					(notifyErr) => {
						logError('hosting-email', 'provisioning-failed alert dispatch failed', {
							tenantId,
							metadata: {
								hostingAccountId: id,
								reason,
								attemptNumber: attempt + 1,
								error:
									notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
							}
						});
					}
				);
				return { ok: false as const, error: err };
			}
		});

		if (insertResult.ok) {
			return { id, daUsername, domain: payload.domain };
		}

		// Classify the failure — retry only on `username_exists` when caller
		// supplied a regenerable seed.
		const err = insertResult.error;
		if (
			payload.autoUsernameSeed &&
			err instanceof DirectAdminApiError &&
			err.kind === 'username_exists' &&
			attempt < MAX_RETRIES
		) {
			daUsername = generateDaUsername(payload.autoUsernameSeed);
			daPassword = generateDaPassword();
			logWarning(
				'directadmin',
				`DA username collision — retry ${attempt + 1}/${MAX_RETRIES} with new candidate`,
				{
					tenantId,
					metadata: {
						hostingAccountId: id,
						oldUsername: payload.daUsername,
						newUsername: daUsername
					}
				}
			);
			continue;
		}
		throw err;
	}

	// Unreachable — loop either returns or throws. Type-narrowing aid.
	throw new Error('createHostingAccountInternal: exhausted retries without resolution');
}

// =============================================================================
//  DA → CRM discovery import (WHMCS retired; DirectAdmin is the source of truth)
// =============================================================================

export interface DiscoveredDaAccountInput {
	daServerId: string;
	daUsername: string;
	/** Primary domain as DA reports it (getUserConfig().domain / searchUsers().domain). */
	domain: string;
	/** All domains on the user MINUS the primary (addon/parked). */
	additionalDomains?: string[] | undefined;
	daPackageName?: string | null | undefined;
	/** DA suspension flag → status 'suspended' vs 'active'. NEVER derives 'terminated'. */
	suspended?: boolean | undefined;
	/** DA account email — stored in notes for reference (hosting_account has no email column). */
	daEmail?: string | null | undefined;
}

export interface DiscoveredImportResult {
	action: 'created' | 'skipped_exists';
	id: string | null;
	daPackageId: string | null;
	hostingProductId: string | null;
	recurringAmount: number;
	currency: string;
	billingCycle: string;
	/** true when the DA package resolved to a single active catalog product with price>0. */
	priced: boolean;
}

/**
 * Insert-only CRM row for a hosting account that ALREADY EXISTS live on DirectAdmin.
 *
 * This is the DA→CRM discovery/import path. WHMCS import is retired — DirectAdmin is now
 * the single source of truth — so accounts created directly on DA (never provisioned through
 * the CRM) need this to surface in `/hosting/accounts`.
 *
 * It is deliberately SEPARATE from `createHostingAccountInternal` because that helper ALWAYS
 * provisions a NEW DA user via `daClient.createUserAccount` — calling it for an already-live
 * user would error `username_exists` or, worse, mutate a live account. This helper performs
 * NO DirectAdmin write of any kind; it only reads the CRM catalog to auto-price, then inserts.
 *
 * Decisions baked in (2026-07-01):
 *  - clientId = null ("— Neasignat —"); staff assigns later from the accounts UI.
 *  - Auto-price: DA package name → daPackage → the single active linked hostingProduct's price.
 *    If no unique priced product maps, recurringAmount stays 0 and daSyncStatus='da_only' flags it.
 *  - status derived ONLY from DA `suspended` ('suspended' | 'active') — NEVER 'terminated'
 *    (strict CRM rule: no automated path sets terminated).
 *  - Idempotent on (tenantId, daServerId, daUsername), case-insensitive — re-running skips.
 *  - daCredentialsEncrypted stays null (DA does not expose plaintext passwords; do NOT reset
 *    the live account's password to backfill).
 *
 * Caller MUST have authorized the actor (`assertCan(..., 'admin.hosting.manage')`).
 */
export async function createHostingAccountFromDiscovery(
	tenantId: string,
	input: DiscoveredDaAccountInput
): Promise<DiscoveredImportResult> {
	const [server] = await db
		.select({ id: table.daServer.id })
		.from(table.daServer)
		.where(and(eq(table.daServer.id, input.daServerId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server DA inexistent sau aparține altui tenant.');

	const usernameNorm = input.daUsername.trim();
	if (!usernameNorm) throw new Error('daUsername gol.');
	if (!input.domain.trim()) throw new Error('domain gol.');

	// Idempotency: one CRM row per (tenant, server, DA username). Case-insensitive —
	// DA listings are lowercased but a stored value could differ in case.
	const [existing] = await db
		.select({ id: table.hostingAccount.id })
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.daServerId, input.daServerId),
				sql`lower(${table.hostingAccount.daUsername}) = ${usernameNorm.toLowerCase()}`
			)
		)
		.limit(1);
	if (existing) {
		return {
			action: 'skipped_exists',
			id: existing.id,
			daPackageId: null,
			hostingProductId: null,
			recurringAmount: 0,
			currency: 'RON',
			billingCycle: 'monthly',
			priced: false
		};
	}

	// Resolve daPackageId from the DA package name (scoped to this server + tenant).
	let daPackageId: string | null = null;
	if (input.daPackageName) {
		const [pkg] = await db
			.select({ id: table.daPackage.id })
			.from(table.daPackage)
			.where(
				and(
					eq(table.daPackage.tenantId, tenantId),
					eq(table.daPackage.daServerId, input.daServerId),
					eq(table.daPackage.daName, input.daPackageName)
				)
			)
			.limit(1);
		daPackageId = pkg?.id ?? null;
	}

	// Auto-price: a DA package mapping to exactly ONE active catalog product with price>0
	// yields the recurring amount + currency + cycle. Otherwise import at 0 and flag for review.
	let hostingProductId: string | null = null;
	let recurringAmount = 0;
	let currency = 'RON';
	let billingCycle = 'monthly';
	let priced = false;
	if (daPackageId) {
		const products = await db
			.select({
				id: table.hostingProduct.id,
				price: table.hostingProduct.price,
				currency: table.hostingProduct.currency,
				billingCycle: table.hostingProduct.billingCycle
			})
			.from(table.hostingProduct)
			.where(
				and(
					eq(table.hostingProduct.tenantId, tenantId),
					eq(table.hostingProduct.daPackageId, daPackageId),
					eq(table.hostingProduct.isActive, true)
				)
			);
		if (products.length === 1 && products[0].price > 0) {
			hostingProductId = products[0].id;
			recurringAmount = products[0].price;
			currency = (products[0].currency || 'RON').toUpperCase();
			billingCycle = products[0].billingCycle || 'monthly';
			priced = true;
		}
	}

	// status from DA suspension ONLY. Never 'terminated' (strict rule:
	// feedback_never_auto_terminate_status).
	const status = input.suspended ? 'suspended' : 'active';

	const primaryLower = input.domain.trim().toLowerCase();
	const additional = (input.additionalDomains ?? [])
		.map((d) => (typeof d === 'string' ? d.trim() : ''))
		.filter((d) => d && d.toLowerCase() !== primaryLower);

	const id = generateId();
	const now = new Date();

	await withTursoBusyRetry(
		() =>
			db.insert(table.hostingAccount).values({
				id,
				tenantId,
				clientId: null,
				daServerId: input.daServerId,
				daPackageId,
				hostingProductId,
				daUsername: usernameNorm,
				domain: input.domain.trim(),
				status,
				daCredentialsEncrypted: null,
				recurringAmount,
				currency,
				billingCycle,
				daPackageName: input.daPackageName ?? null,
				additionalDomains: additional.length ? additional : null,
				daSyncStatus: 'da_only',
				daSyncIssue: priced
					? 'Importat din DirectAdmin. Atribuie client.'
					: 'Importat din DirectAdmin. Atribuie client + verifică prețul (fără produs mapat).',
				notes: input.daEmail ? `Email DA la import: ${input.daEmail}` : null,
				lastSyncedAt: now.toISOString(),
				suspendedAt: input.suspended ? now : null
			}),
		{ tenantId, label: `createHostingAccountFromDiscovery:${usernameNorm}` }
	);

	// Best-effort audit (mirror updateHostingAccountClient's pattern: 'package-change'
	// reused as the "config change" enum value). A hiccup here must not fail the import.
	await db
		.insert(table.daAuditLog)
		.values({
			id: generateId(),
			tenantId,
			hostingAccountId: id,
			daServerId: input.daServerId,
			action: 'package-change',
			trigger: 'manual',
			success: true,
			errorMessage: `imported from DA (discovery): ${usernameNorm} / ${input.domain.trim()}${
				priced ? '' : ' [no price mapped]'
			}`
		})
		.catch(() => {});

	return {
		action: 'created',
		id,
		daPackageId,
		hostingProductId,
		recurringAmount,
		currency,
		billingCycle,
		priced
	};
}
