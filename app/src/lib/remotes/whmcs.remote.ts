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
import { decrypt, encryptVerified, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { generateSecret, signRequest, verifySignature } from '$lib/server/whmcs/hmac';
import { pushInvoiceNumberToWhmcs } from '$lib/server/whmcs/push-number-to-whmcs';

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
			whmcsAutoPushToKeez: table.invoiceSettings.whmcsAutoPushToKeez,
			whmcsZeroVatNoteIntracom: table.invoiceSettings.whmcsZeroVatNoteIntracom,
			whmcsZeroVatNoteExport: table.invoiceSettings.whmcsZeroVatNoteExport,
			whmcsZeroVatAutoDetect: table.invoiceSettings.whmcsZeroVatAutoDetect,
			whmcsStrictBnrConversion: table.invoiceSettings.whmcsStrictBnrConversion
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
			invoiceId: table.whmcsInvoiceSync.invoiceId,
			keezPushStatus: table.whmcsInvoiceSync.keezPushStatus,
			retryCount: table.whmcsInvoiceSync.retryCount,
			nextRetryAt: table.whmcsInvoiceSync.nextRetryAt,
			lastPushAttemptAt: table.whmcsInvoiceSync.lastPushAttemptAt
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

	// Includes Keez-push failures (state=INVOICE_CREATED + keezPushStatus=failed)
	// alongside DEAD_LETTER / FAILED rows — operators care about both.
	return db
		.select({
			id: table.whmcsInvoiceSync.id,
			whmcsInvoiceId: table.whmcsInvoiceSync.whmcsInvoiceId,
			state: table.whmcsInvoiceSync.state,
			lastEvent: table.whmcsInvoiceSync.lastEvent,
			lastErrorClass: table.whmcsInvoiceSync.lastErrorClass,
			lastErrorMessage: table.whmcsInvoiceSync.lastErrorMessage,
			receivedAt: table.whmcsInvoiceSync.receivedAt,
			processedAt: table.whmcsInvoiceSync.processedAt,
			keezPushStatus: table.whmcsInvoiceSync.keezPushStatus,
			retryCount: table.whmcsInvoiceSync.retryCount,
			nextRetryAt: table.whmcsInvoiceSync.nextRetryAt,
			invoiceId: table.whmcsInvoiceSync.invoiceId
		})
		.from(table.whmcsInvoiceSync)
		.where(
			and(
				eq(table.whmcsInvoiceSync.tenantId, tenantId),
				sql`(${table.whmcsInvoiceSync.state} IN ('DEAD_LETTER', 'FAILED')
					OR ${table.whmcsInvoiceSync.keezPushStatus} = 'failed')`
			)
		)
		.orderBy(desc(table.whmcsInvoiceSync.receivedAt))
		.limit(50);
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
// saveWhmcsHostingSeries — REMOVED. Hosting series, zero-VAT, strict BNR settings
// migrated to /[tenant]/settings/keez. Use `updateInvoiceSettings` from
// $lib/remotes/invoice-settings.remote with the relevant fields.

/**
 * End-to-end self-test for the admin UI "Testează conexiunea" button.
 * Validates the full webhook pipeline:
 *   1. Integration row exists + active
 *   2. Shared secret decrypts (AES-GCM round-trip)
 *   3. HMAC self-verify passes (sign locally, verify locally)
 *   4. Health endpoint reachable (real HTTP round-trip to /health)
 *   5. Endpoint returns ok=true with correct tenant slug
 *
 * Intentionally separate from the WHMCS-side Test Connection button:
 *   - WHMCS side tests that WHMCS can reach CRM + signature is accepted.
 *   - CRM side (this one) tests that DB+crypto are healthy and the endpoint
 *     self-round-trips. Useful when debugging "why does WHMCS say 401?".
 */
export const testWhmcsConnection = command(async () => {
	const { tenantId, tenantSlug } = requireTenantAdmin();
	const event = getRequestEvent();
	const origin = event?.url.origin ?? '';

	// 1. Load integration
	const integration = await db
		.select()
		.from(table.whmcsIntegration)
		.where(eq(table.whmcsIntegration.tenantId, tenantId))
		.get();
	if (!integration) {
		return {
			ok: false as const,
			step: 'load_integration',
			reason: 'not_configured',
			detail: 'Nu există row în whmcs_integration pentru tenant-ul curent. Apasă Configurează mai întâi.'
		};
	}
	if (!integration.isActive) {
		return {
			ok: false as const,
			step: 'check_active',
			reason: 'integration_inactive',
			detail: 'Toggle-ul "Integrare activă" e oprit. Activează-l pentru a testa.'
		};
	}

	// 2. Decrypt secret
	let secret: string;
	try {
		secret = decrypt(tenantId, integration.sharedSecret);
	} catch (e) {
		return {
			ok: false as const,
			step: 'decrypt_secret',
			reason: e instanceof DecryptionError ? 'decrypt_failed' : 'decrypt_unexpected',
			detail: e instanceof Error ? e.message : String(e)
		};
	}
	if (secret.length !== 64) {
		return {
			ok: false as const,
			step: 'validate_secret',
			reason: 'secret_wrong_length',
			detail: `Secretul are ${secret.length} caractere, așteptat 64 hex. Regenerează.`
		};
	}

	// 3. HMAC self-verify (math sanity check)
	const ts = Math.floor(Date.now() / 1000);
	const nonce = crypto.randomUUID();
	const pathname = `/${tenantSlug}/api/webhooks/whmcs/health`;
	const signature = signRequest(secret, ts, 'GET', pathname, tenantSlug, nonce, '');
	const hmacOk = verifySignature(secret, ts, 'GET', pathname, tenantSlug, nonce, '', signature);
	if (!hmacOk) {
		return {
			ok: false as const,
			step: 'hmac_self_verify',
			reason: 'hmac_bug',
			detail: 'Sign/verify asimetric — bug intern în hmac.ts.'
		};
	}

	// 4. Real HTTP round-trip to /health (tests the route + handler + Redis nonce claim)
	const url = `${origin}${pathname}`;
	let httpStatus = 0;
	let responseBody: unknown = null;
	try {
		const res = await fetch(url, {
			method: 'GET',
			headers: {
				'X-OTS-Timestamp': ts.toString(),
				'X-OTS-Signature': signature,
				'X-OTS-Tenant': tenantSlug,
				'X-OTS-Nonce': nonce
			},
			signal: AbortSignal.timeout(10_000)
		});
		httpStatus = res.status;
		responseBody = await res.json().catch(() => null);
	} catch (e) {
		return {
			ok: false as const,
			step: 'http_roundtrip',
			reason: 'network_error',
			detail: e instanceof Error ? e.message : String(e),
			url
		};
	}

	if (httpStatus !== 200 || !responseBody || (responseBody as { ok?: boolean }).ok !== true) {
		return {
			ok: false as const,
			step: 'http_response',
			reason: 'unexpected_response',
			detail: JSON.stringify(responseBody).slice(0, 200),
			httpStatus,
			url
		};
	}

	const body = responseBody as {
		ok: true;
		tenantSlug: string;
		connectorVersion: string;
		dryRun: boolean;
		receivedAt: number;
	};

	return {
		ok: true as const,
		tenantSlug: body.tenantSlug,
		connectorVersion: body.connectorVersion,
		dryRun: body.dryRun,
		roundTripMs: Math.abs(Date.now() - body.receivedAt * 1000),
		httpStatus,
		url
	};
});

/**
 * Reset a DEAD_LETTER / FAILED sync row back to PENDING so a retry WHMCS
 * webhook will re-process it cleanly. Intended for manual review of stuck
 * invoices from the admin UI.
 */
/**
 * Push the CRM-assigned invoice number back to WHMCS so client-facing
 * artifacts (PDF, emails, client portal) show the fiscal number instead
 * of WHMCS's auto-generated one. Only works for invoices whose
 * externalSource is 'whmcs'.
 *
 * Manually triggered from the sync event log — useful in dry-run mode or
 * when the auto-trigger after Keez push didn't fire (e.g. Keez push is off
 * or failed). Idempotent on the WHMCS side: re-pushing the same number is
 * a no-op.
 */
export const pushWhmcsInvoiceNumber = command(
	v.object({ invoiceId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ invoiceId }) => {
		const { tenantId } = requireTenantAdmin();
		return pushInvoiceNumberToWhmcs(tenantId, invoiceId);
	}
);

/**
 * Admin replay for a stuck/failed sync row. Two modes depending on row state:
 *
 * 1. Push failed but invoice exists in CRM (invoiceId set, state stayed
 *    INVOICE_CREATED, keezPushStatus in {failed,retrying,in_flight}):
 *    cancel pending BullMQ retries, reset error state, kick off a fresh
 *    push attempt immediately via the retry queue (delay=0, attempt=1).
 *
 * 2. Otherwise (no invoiceId, or in DEAD_LETTER): just reset to PENDING
 *    so the next webhook resend re-runs the full create flow.
 */
export const replayWhmcsSync = command(
	v.object({ syncId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ syncId }) => {
		const { tenantId } = requireTenantAdmin();

		const [row] = await db
			.select({
				invoiceId: table.whmcsInvoiceSync.invoiceId,
				whmcsInvoiceId: table.whmcsInvoiceSync.whmcsInvoiceId,
				state: table.whmcsInvoiceSync.state,
				keezPushStatus: table.whmcsInvoiceSync.keezPushStatus
			})
			.from(table.whmcsInvoiceSync)
			.where(
				and(
					eq(table.whmcsInvoiceSync.tenantId, tenantId),
					eq(table.whmcsInvoiceSync.id, syncId)
				)
			)
			.limit(1);

		if (!row) {
			return { replayed: false, reason: 'sync row not found' };
		}

		const isPushReplay =
			row.invoiceId &&
			(row.keezPushStatus === 'failed' ||
				row.keezPushStatus === 'retrying' ||
				row.keezPushStatus === 'in_flight');

		if (isPushReplay && row.invoiceId) {
			// Lazy import to keep the remote command out of the scheduler import graph.
			const {
				cancelPendingWhmcsKeezPushRetry,
				enqueueWhmcsKeezPushRetry
			} = await import('$lib/server/scheduler/tasks/whmcs-keez-push-retry');

			await cancelPendingWhmcsKeezPushRetry(tenantId, row.invoiceId);

			await db
				.update(table.whmcsInvoiceSync)
				.set({
					lastErrorClass: null,
					lastErrorMessage: null,
					retryCount: 0,
					nextRetryAt: null,
					keezPushStatus: 'retrying',
					processedAt: null
				})
				.where(
					and(
						eq(table.whmcsInvoiceSync.tenantId, tenantId),
						eq(table.whmcsInvoiceSync.id, syncId)
					)
				);

			// delay=0 so the worker picks it up immediately; attempt=1 keeps the
			// jobId fresh so any leftover hop with the prior id can't dedup it.
			await enqueueWhmcsKeezPushRetry(tenantId, row.invoiceId, row.whmcsInvoiceId, 0, 1);

			return { replayed: true, mode: 'push_retry_enqueued' };
		}

		await db
			.update(table.whmcsInvoiceSync)
			.set({
				state: 'PENDING',
				lastErrorClass: null,
				lastErrorMessage: null,
				retryCount: 0,
				nextRetryAt: null,
				keezPushStatus: null,
				processedAt: null
			})
			.where(
				and(
					eq(table.whmcsInvoiceSync.tenantId, tenantId),
					eq(table.whmcsInvoiceSync.id, syncId)
				)
			);

		return { replayed: true, mode: 'reset_to_pending' };
	}
);

/**
 * Batch replay all push-failed rows for the tenant. Useful after a Keez/WHMCS
 * outage when many invoices piled up in keezPushStatus='failed'. Each row gets
 * the same push_retry_enqueued treatment as single replay (cancel pending hops,
 * reset counters, enqueue immediate retry). DEAD_LETTER rows are skipped — they
 * need individual review.
 *
 * Returns a count, not a list, to keep the response cheap; admins can refresh
 * the event log to see updated rows.
 */
export const replayAllFailedWhmcsPushes = command(
	v.object({
		// Optional cap so a runaway tenant can't enqueue thousands at once.
		limit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(500)), 100)
	}),
	async ({ limit }) => {
		const { tenantId } = requireTenantAdmin();

		const rows = await db
			.select({
				id: table.whmcsInvoiceSync.id,
				invoiceId: table.whmcsInvoiceSync.invoiceId,
				whmcsInvoiceId: table.whmcsInvoiceSync.whmcsInvoiceId
			})
			.from(table.whmcsInvoiceSync)
			.where(
				and(
					eq(table.whmcsInvoiceSync.tenantId, tenantId),
					eq(table.whmcsInvoiceSync.keezPushStatus, 'failed'),
					sql`${table.whmcsInvoiceSync.invoiceId} IS NOT NULL`
				)
			)
			.limit(limit);

		if (rows.length === 0) {
			return { replayed: 0, message: 'no failed push rows found' };
		}

		const { cancelPendingWhmcsKeezPushRetry, enqueueWhmcsKeezPushRetry } = await import(
			'$lib/server/scheduler/tasks/whmcs-keez-push-retry'
		);

		let replayed = 0;
		for (const row of rows) {
			if (!row.invoiceId) continue;
			try {
				await cancelPendingWhmcsKeezPushRetry(tenantId, row.invoiceId);
				await db
					.update(table.whmcsInvoiceSync)
					.set({
						lastErrorClass: null,
						lastErrorMessage: null,
						retryCount: 0,
						nextRetryAt: null,
						keezPushStatus: 'retrying',
						processedAt: null
					})
					.where(eq(table.whmcsInvoiceSync.id, row.id));
				await enqueueWhmcsKeezPushRetry(tenantId, row.invoiceId, row.whmcsInvoiceId, 0, 1);
				replayed += 1;
			} catch {
				// Best-effort batch — don't let one bad row stall the rest.
			}
		}

		return { replayed, totalCandidates: rows.length };
	}
);

/**
 * Save the zero-VAT compliance settings + the BNR strict-mode toggle.
 * All four fields are nullable on the DB side so the UI can clear them
 * (auto-detect with code defaults) or set custom per-tenant text.
 */
// saveWhmcsZeroVatSettings — REMOVED. See note on saveWhmcsHostingSeries above; the
// fields are now managed via `updateInvoiceSettings` exposed by the Keez settings page.
