/**
 * Access engine — single point of authorization for both admin (tenant_user)
 * and client portal (client_user / client_secondary_email) actors.
 *
 * Every remote, +server.ts, and +page.server.ts that previously checked
 * `event.locals.tenantUser?.role !== 'X'` should now use:
 *   assertCan(event.locals.actor, 'admin.something');
 *
 * The actor is built once per request in hooks.server.ts via buildActor() and
 * stored in event.locals.actor.
 */

import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import {
	type Capability,
	type AdminRoleId,
	type ClientPresetId,
	CAPABILITY_CATALOG,
	CAPABILITY_IDS,
	getCapabilitiesForRole,
	CLIENT_PRESET_CAPABILITIES,
	legacyFlagsToCapabilities,
	isKnownCapability
} from '$lib/access/catalog';

// =============================================================================
// Actor types
// =============================================================================

export type TenantActor = {
	kind: 'tenant';
	tenantUserId: string;
	userId: string;
	tenantId: string;
	role: AdminRoleId;
	/** Resolved capability set (role defaults OR explicit override). */
	capabilities: Set<Capability>;
	/** True if user has explicit per-user override (capabilities column set). */
	hasOverride: boolean;
};

export type ClientActor = {
	kind: 'client';
	clientUserId: string;
	userId: string;
	tenantId: string;
	clientId: string;
	isPrimary: boolean;
	capabilities: Set<Capability>;
	/** Detected preset ('owner'|'manager'|'marketing'|'viewer'|'custom') or null for primary. */
	preset: ClientPresetId | 'custom' | null;
};

export type AnonActor = { kind: 'anon' };

export type Actor = TenantActor | ClientActor | AnonActor;

// =============================================================================
// buildActor — called from hooks.server.ts
// =============================================================================

/**
 * Build the Actor for the current request. Reads from event.locals.user/tenant/
 * tenantUser/clientUser populated earlier in the auth pipeline.
 *
 * Returns 'anon' if no authenticated user.
 */
export async function buildActor(event: RequestEvent): Promise<Actor> {
	const user = event.locals.user;
	if (!user) return { kind: 'anon' };

	// --- Tenant (admin) actor -------------------------------------------------
	if (event.locals.tenantUser && event.locals.tenant) {
		const tu = event.locals.tenantUser;
		const role = (tu.role as AdminRoleId) ?? 'viewer';

		// Read the per-user override from DB. We don't have it on locals because
		// auth pipeline pre-dates this column — read it lazily here.
		let overrideRaw: string | null = null;
		try {
			const [row] = await db
				.select({ capabilities: table.tenantUser.capabilities })
				.from(table.tenantUser)
				.where(eq(table.tenantUser.id, tu.id))
				.limit(1);
			overrideRaw = row?.capabilities ?? null;
		} catch {
			// If the column doesn't exist yet (pre-migration window), fall back to role defaults.
			overrideRaw = null;
		}

		const overrideSet = parseOverrideJson(overrideRaw);
		const capabilities = overrideSet ?? new Set<Capability>(getCapabilitiesForRole(role));

		return {
			kind: 'tenant',
			tenantUserId: tu.id,
			userId: user.id,
			tenantId: event.locals.tenant.id,
			role,
			capabilities,
			hasOverride: overrideSet !== null
		};
	}

	// --- Client portal actor --------------------------------------------------
	if (event.locals.clientUser && event.locals.client && event.locals.tenant) {
		const cu = event.locals.clientUser;
		const isPrimary = cu.isPrimary ?? false;

		if (isPrimary) {
			// Primary contacts get all portal.* capabilities.
			const caps = CAPABILITY_CATALOG.filter((c) => c.domain === 'portal').map((c) => c.id);
			return {
				kind: 'client',
				clientUserId: cu.id,
				userId: user.id,
				tenantId: event.locals.tenant.id,
				clientId: event.locals.client.id,
				isPrimary: true,
				capabilities: new Set(caps),
				preset: null
			};
		}

		// Secondary contact: read from client_secondary_email by user.email.
		const email = (user.email ?? '').toLowerCase();
		let caps = new Set<Capability>();
		let preset: ClientPresetId | 'custom' = 'custom';
		if (email) {
			try {
				const [se] = await db
					.select({
						accessFlags: table.clientSecondaryEmail.accessFlags,
						notifyInvoices: table.clientSecondaryEmail.notifyInvoices,
						notifyTasks: table.clientSecondaryEmail.notifyTasks,
						notifyContracts: table.clientSecondaryEmail.notifyContracts
					})
					.from(table.clientSecondaryEmail)
					.where(
						and(
							eq(table.clientSecondaryEmail.tenantId, event.locals.tenant.id),
							eq(table.clientSecondaryEmail.clientId, event.locals.client.id),
							eq(sql`lower(${table.clientSecondaryEmail.email})`, email)
						)
					)
					.limit(1);

				if (se) {
					const parsed = parseAccessFlagsJson(se.accessFlags);
					if (parsed) {
						caps = new Set(legacyFlagsToCapabilities(parsed));
					} else {
						// Fallback to legacy notify_* columns
						caps = new Set(
							legacyFlagsToCapabilities({
								invoices: !!se.notifyInvoices,
								tasks: !!se.notifyTasks,
								contracts: !!se.notifyContracts
							})
						);
					}
					preset = detectPreset(caps);
				}
			} catch {
				// On read failure, deny everything (safer than allow).
			}
		}

		return {
			kind: 'client',
			clientUserId: cu.id,
			userId: user.id,
			tenantId: event.locals.tenant.id,
			clientId: event.locals.client.id,
			isPrimary: false,
			capabilities: caps,
			preset
		};
	}

	return { kind: 'anon' };
}

// =============================================================================
// Authorization API
// =============================================================================

export function can(actor: Actor, cap: Capability): boolean {
	if (actor.kind === 'anon') return false;
	if (!isKnownCapability(cap)) return false;
	return actor.capabilities.has(cap);
}

export function assertCan(actor: Actor, cap: Capability): void {
	if (actor.kind === 'anon') {
		throw error(401, 'Autentificare necesară.');
	}
	if (!isKnownCapability(cap)) {
		throw error(500, `Capability necunoscut: ${cap}`);
	}
	if (!actor.capabilities.has(cap)) {
		throw error(403, `Permisiune insuficientă (${cap}).`);
	}
}

export function assertAny(actor: Actor, caps: Capability[]): void {
	if (actor.kind === 'anon') throw error(401, 'Autentificare necesară.');
	for (const cap of caps) {
		if (actor.capabilities.has(cap)) return;
	}
	throw error(403, `Permisiune insuficientă (necesar oricare din: ${caps.join(', ')}).`);
}

export function assertAll(actor: Actor, caps: Capability[]): void {
	if (actor.kind === 'anon') throw error(401, 'Autentificare necesară.');
	for (const cap of caps) {
		if (!actor.capabilities.has(cap)) {
			throw error(403, `Permisiune insuficientă (${cap}).`);
		}
	}
}

// =============================================================================
// Override parsing & validation
// =============================================================================

function parseOverrideJson(raw: string | null): Set<Capability> | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		const out = new Set<Capability>();
		for (const v of parsed) {
			if (typeof v === 'string' && isKnownCapability(v)) out.add(v);
		}
		return out;
	} catch {
		return null;
	}
}

function parseAccessFlagsJson(raw: string | null): Record<string, boolean> | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') return null;
		const out: Record<string, boolean> = {};
		for (const [k, v] of Object.entries(parsed)) {
			if (typeof v === 'boolean') out[k] = v;
		}
		return out;
	} catch {
		return null;
	}
}

/**
 * Validate an override array before persisting. Returns the sanitized set or
 * throws if any unsafe-unless-role caps are granted to a user without that role.
 */
export function validateOverride(
	caps: Capability[] | string[],
	targetRole: AdminRoleId
): Capability[] {
	const sanitized: Capability[] = [];
	for (const cap of caps) {
		if (!isKnownCapability(cap)) continue;
		const def = CAPABILITY_CATALOG.find((c) => c.id === cap);
		if (!def) continue;
		if (def.unsafeUnlessRole && def.unsafeUnlessRole !== targetRole) {
			throw error(
				403,
				`Capability "${cap}" poate fi acordată doar utilizatorilor cu rolul ${def.unsafeUnlessRole}.`
			);
		}
		sanitized.push(cap as Capability);
	}
	return Array.from(new Set(sanitized));
}

// =============================================================================
// Preset detection
// =============================================================================

function detectPreset(caps: Set<Capability>): ClientPresetId | 'custom' {
	for (const presetId of ['owner', 'manager', 'marketing', 'viewer'] as const) {
		const preset = CLIENT_PRESET_CAPABILITIES[presetId];
		if (caps.size !== preset.length) continue;
		const allMatch = preset.every((c) => caps.has(c));
		if (allMatch) return presetId;
	}
	return 'custom';
}

// =============================================================================
// Re-exports (convenience)
// =============================================================================

export { CAPABILITY_IDS, CAPABILITY_CATALOG };
export type { Capability, AdminRoleId, ClientPresetId };
