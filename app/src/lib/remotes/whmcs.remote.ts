/**
 * Remote functions for the WHMCS integration settings UI.
 *
 * All reads/writes go through here instead of +server.ts endpoints so
 * the UI gets the SvelteKit `command()` / `query()` ergonomics + built-in
 * auth (via `event.locals.user`/`event.locals.tenant`).
 *
 * Permission model: any authenticated tenantUser can READ; owner/admin
 * only can WRITE. Consistent with keez.remote.ts.
 *
 * The shared secret is NEVER returned to the client. It's either freshly
 * generated (via `regenerateWhmcsSecret`, returned ONCE after encryption)
 * or kept server-side only.
 */
import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encryptVerified } from '$lib/server/plugins/smartbill/crypto';
import { generateSecret } from '$lib/server/whmcs/hmac';

// ─────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────

interface AuthContext {
	tenantId: string;
	tenantSlug: string;
	userId: string;
	role: string;
}

/** Returns auth context for any signed-in tenant member. Throws on anonymous. */
function requireTenantMember(): AuthContext {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	return {
		tenantId: event.locals.tenant.id,
		tenantSlug: event.locals.tenant.slug,
		userId: event.locals.user.id,
		role: event.locals.tenantUser?.role ?? 'member'
	};
}

/** Same as above but rejects non-owner/admin. Use for WRITE commands. */
function requireTenantAdmin(): AuthContext {
	const ctx = requireTenantMember();
	if (ctx.role !== 'owner' && ctx.role !== 'admin') {
		throw new Error('Insufficient permissions');
	}
	return ctx;
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

// ─────────────────────────────────────────────
// Queries (read)
// ─────────────────────────────────────────────

/**
 * Status + config surface for the settings page. Explicitly omits the
 * encrypted secret — secrets only leave the DB during regeneration.
 */
export const getWhmcsStatus = query(async () => {
	const { tenantId, tenantSlug } = requireTenantMember();

	const integration = await db
		.select({
			id: table.whmcsIntegration.id,
			whmcsUrl: table.whmcsIntegration.whmcsUrl,
			isActive: table.whmcsIntegration.isActive,
			enableKeezPush: table.whmcsIntegration.enableKeezPush,
			circuitBreakerUntil: table.whmcsIntegration.circuitBreakerUntil,
			consecutiveFailures: table.whmcsIntegration.consecutiveFailures,
			lastSuccessfulSyncAt: table.whmcsIntegration.lastSuccessfulSyncAt,
			lastFailureReason: table.whmcsIntegration.lastFailureReason,
			createdAt: table.whmcsIntegration.createdAt,
			updatedAt: table.whmcsIntegration.updatedAt
		})
		.from(table.whmcsIntegration)
		.where(eq(table.whmcsIntegration.tenantId, tenantId))
		.get();

	const settings = await db
		.select({
			keezSeries: table.invoiceSettings.keezSeries,
			keezSeriesHosting: table.invoiceSettings.keezSeriesHosting,
			keezStartNumberHosting: table.invoiceSettings.keezStartNumberHosting,
			keezLastSyncedNumberHosting: table.invoiceSettings.keezLastSyncedNumberHosting,
			whmcsAutoPushToKeez: table.invoiceSettings.whmcsAutoPushToKeez
		})
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.get();

	const now = Date.now();
	const circuitBreakerOpen =
		integration?.circuitBreakerUntil !== null &&
		integration?.circuitBreakerUntil !== undefined &&
		integration.circuitBreakerUntil.getTime() > now;

	return {
		connected: !!integration,
		tenantSlug,
		webhookBase: `/${tenantSlug}/api/webhooks/whmcs`,
		integration: integration ?? null,
		settings: settings ?? null,
		circuitBreakerOpen,
		circuitBreakerUntil: integration?.circuitBreakerUntil ?? null
	};
});

/**
 * Recent invoice sync rows (last 50) — powers the event-log card.
 */
export const getWhmcsRecentSyncs = query(async () => {
	const { tenantId } = requireTenantMember();

	return db
		.select({
			id: table.whmcsInvoiceSync.id,
			whmcsInvoiceId: table.whmcsInvoiceSync.whmcsInvoiceId,
			state: table.whmcsInvoiceSync.state,
			lastEvent: table.whmcsInvoiceSync.lastEvent,
			matchType: table.whmcsInvoiceSync.matchType,
			originalAmount: table.whmcsInvoiceSync.originalAmount,
			originalCurrency: table.whmcsInvoiceSync.originalCurrency,
			lastErrorClass: table.whmcsInvoiceSync.lastErrorClass,
			lastErrorMessage: table.whmcsInvoiceSync.lastErrorMessage,
			receivedAt: table.whmcsInvoiceSync.receivedAt,
			processedAt: table.whmcsInvoiceSync.processedAt,
			invoiceId: table.whmcsInvoiceSync.invoiceId
		})
		.from(table.whmcsInvoiceSync)
		.where(eq(table.whmcsInvoiceSync.tenantId, tenantId))
		.orderBy(desc(table.whmcsInvoiceSync.receivedAt))
		.limit(50);
});

/**
 * Count of match outcomes in the last 24 h. Powers the "match stats" card
 * so the admin can spot WHMCS/Keez configuration drift (many NEW rows =
 * CUI mismatch between systems).
 */
export const getWhmcsMatchStats = query(async () => {
	const { tenantId } = requireTenantMember();

	const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

	const rows = await db
		.select({
			matchType: table.whmcsInvoiceSync.matchType,
			count: sql<number>`count(*)`.as('count')
		})
		.from(table.whmcsInvoiceSync)
		.where(
			and(
				eq(table.whmcsInvoiceSync.tenantId, tenantId),
				gte(table.whmcsInvoiceSync.receivedAt, cutoff)
			)
		)
		.groupBy(table.whmcsInvoiceSync.matchType);

	const stats: Record<string, number> = {
		WHMCS_ID: 0,
		CUI: 0,
		EMAIL: 0,
		NEW: 0,
		unknown: 0
	};
	for (const r of rows) {
		const k = r.matchType ?? 'unknown';
		stats[k] = (stats[k] ?? 0) + Number(r.count);
	}
	return stats;
});

/**
 * Rows stuck in DEAD_LETTER or FAILED — for the admin's manual-review card.
 */
export const getWhmcsDeadLetters = query(async () => {
	const { tenantId } = requireTenantMember();

	return db
		.select({
			id: table.whmcsInvoiceSync.id,
			whmcsInvoiceId: table.whmcsInvoiceSync.whmcsInvoiceId,
			state: table.whmcsInvoiceSync.state,
			lastEvent: table.whmcsInvoiceSync.lastEvent,
			lastErrorClass: table.whmcsInvoiceSync.lastErrorClass,
			lastErrorMessage: table.whmcsInvoiceSync.lastErrorMessage,
			receivedAt: table.whmcsInvoiceSync.receivedAt,
			processedAt: table.whmcsInvoiceSync.processedAt
		})
		.from(table.whmcsInvoiceSync)
		.where(
			and(
				eq(table.whmcsInvoiceSync.tenantId, tenantId),
				sql`${table.whmcsInvoiceSync.state} IN ('DEAD_LETTER', 'FAILED')`
			)
		)
		.orderBy(desc(table.whmcsInvoiceSync.receivedAt))
		.limit(20);
});

// ─────────────────────────────────────────────
// Commands (write) — owner/admin only
// ─────────────────────────────────────────────

/**
 * Initial setup: create the whmcs_integration row and return a fresh
 * shared secret (shown once in the UI). Safe to call again on an
 * already-provisioned tenant — it rotates the secret.
 */
export const setupOrRotateWhmcsIntegration = command(
	v.object({
		whmcsUrl: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const { tenantId } = requireTenantAdmin();

		// Generate plaintext secret, encrypt it, persist ciphertext.
		const plainSecret = generateSecret();
		const encryptedSecret = encryptVerified(tenantId, plainSecret);

		const existing = await db
			.select({ id: table.whmcsIntegration.id })
			.from(table.whmcsIntegration)
			.where(eq(table.whmcsIntegration.tenantId, tenantId))
			.get();

		if (existing) {
			await db
				.update(table.whmcsIntegration)
				.set({
					whmcsUrl: data.whmcsUrl.trim(),
					sharedSecret: encryptedSecret,
					updatedAt: new Date()
				})
				.where(eq(table.whmcsIntegration.id, existing.id));
		} else {
			await db.insert(table.whmcsIntegration).values({
				id: generateId(),
				tenantId,
				whmcsUrl: data.whmcsUrl.trim(),
				sharedSecret: encryptedSecret,
				isActive: false, // admin toggles on AFTER configuring WHMCS side
				enableKeezPush: false,
				consecutiveFailures: 0
			});
		}

		// Plain secret leaves the server exactly once — the UI shows it on
		// a dialog that the admin must copy before closing.
		return { plainSecret };
	}
);

/**
 * Regenerate the shared secret without touching the URL. Old secret is
 * invalidated immediately; WHMCS must be reconfigured to use the new one.
 */
export const regenerateWhmcsSecret = command(async () => {
	const { tenantId } = requireTenantAdmin();

	const existing = await db
		.select({ id: table.whmcsIntegration.id })
		.from(table.whmcsIntegration)
		.where(eq(table.whmcsIntegration.tenantId, tenantId))
		.get();

	if (!existing) throw new Error('WHMCS integration not configured');

	const plainSecret = generateSecret();
	const encryptedSecret = encryptVerified(tenantId, plainSecret);

	await db
		.update(table.whmcsIntegration)
		.set({ sharedSecret: encryptedSecret, updatedAt: new Date() })
		.where(eq(table.whmcsIntegration.id, existing.id));

	return { plainSecret };
});

/** Master on/off toggle for accepting webhooks. */
export const setWhmcsActive = command(
	v.object({ isActive: v.boolean() }),
	async ({ isActive }) => {
		const { tenantId } = requireTenantAdmin();

		await db
			.update(table.whmcsIntegration)
			.set({ isActive, updatedAt: new Date() })
			.where(eq(table.whmcsIntegration.tenantId, tenantId));

		return { isActive };
	}
);

/** Dry-run gate: false = only CRM-side processing, no Keez push. */
export const setEnableKeezPush = command(
	v.object({ enabled: v.boolean() }),
	async ({ enabled }) => {
		const { tenantId } = requireTenantAdmin();

		await db
			.update(table.whmcsIntegration)
			.set({ enableKeezPush: enabled, updatedAt: new Date() })
			.where(eq(table.whmcsIntegration.tenantId, tenantId));

		return { enabled };
	}
);

/**
 * Save hosting-series config on invoice_settings. Creates the row if the
 * tenant has never configured invoice settings before.
 */
export const saveWhmcsHostingSeries = command(
	v.object({
		keezSeriesHosting: v.nullable(v.string()),
		keezStartNumberHosting: v.nullable(v.string()),
		whmcsAutoPushToKeez: v.boolean()
	}),
	async (data) => {
		const { tenantId } = requireTenantAdmin();

		const existing = await db
			.select({ id: table.invoiceSettings.id })
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, tenantId))
			.get();

		const normalizedSeries = data.keezSeriesHosting?.trim() || null;
		const normalizedStart = data.keezStartNumberHosting?.trim() || null;

		if (existing) {
			await db
				.update(table.invoiceSettings)
				.set({
					keezSeriesHosting: normalizedSeries,
					keezStartNumberHosting: normalizedStart,
					whmcsAutoPushToKeez: data.whmcsAutoPushToKeez,
					updatedAt: new Date()
				})
				.where(eq(table.invoiceSettings.id, existing.id));
		} else {
			await db.insert(table.invoiceSettings).values({
				id: generateId(),
				tenantId,
				keezSeriesHosting: normalizedSeries,
				keezStartNumberHosting: normalizedStart,
				whmcsAutoPushToKeez: data.whmcsAutoPushToKeez
			});
		}

		return { saved: true };
	}
);

/**
 * Reset a DEAD_LETTER / FAILED sync row back to PENDING so a retry WHMCS
 * webhook will re-process it cleanly. Intended for manual review of stuck
 * invoices from the admin UI.
 */
export const replayWhmcsSync = command(
	v.object({ syncId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ syncId }) => {
		const { tenantId } = requireTenantAdmin();

		await db
			.update(table.whmcsInvoiceSync)
			.set({
				state: 'PENDING',
				lastErrorClass: null,
				lastErrorMessage: null,
				retryCount: 0,
				processedAt: null
			})
			.where(
				and(
					eq(table.whmcsInvoiceSync.tenantId, tenantId),
					eq(table.whmcsInvoiceSync.id, syncId)
				)
			);

		return { replayed: true };
	}
);
