/**
 * Resolve a WHMCS client payload to a CRM `client` row.
 *
 * Cascade (per user preference: WHMCS clients usually exist in Keez already,
 * matched by CUI in ~80% of cases; email is a tiebreak; create is rare):
 *
 *   1. Exact match on `client.whmcs_client_id`     → matchType = 'WHMCS_ID'
 *   2. Exact match on `client.cui`  (normalized)   → matchType = 'CUI'
 *      + update the row's whmcs_client_id so future lookups skip to step 1
 *   3. Exact match on `client.email` (lowercased)  → matchType = 'EMAIL'
 *      + update whmcs_client_id and (if CUI missing) cui as well
 *   4. No match → create a new client from the payload   → matchType = 'NEW'
 *
 * All queries tenant-scoped via `and(eq(tenantId), eq(…))`.
 *
 * Design notes:
 *   - We INTENTIONALLY take the first match on CUI or email and skip
 *     ambiguity detection in v1. The CRM has a `cui unique` constraint on
 *     tenant.cui but NOT on client.cui (legitimate duplicates occur: same
 *     person registered as SRL + PFA). Tiebreak by email closes most cases;
 *     rare ambiguous rows surface via DEAD_LETTER at the invoice step and
 *     can be fixed manually.
 *   - We do NOT fuzzy-match names. False positives on near-matches would
 *     corrupt billing data — hard-fail into NEW is safer.
 */
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logInfo, logWarning } from '$lib/server/logger';

import type { WhmcsClientPayload, WhmcsMatchType } from './types';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

export interface MatchOrCreateResult {
	clientId: string;
	matchType: WhmcsMatchType;
	/** true if the row was just created; false if we reused an existing one. */
	created: boolean;
}

function generateClientId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Normalize a Romanian CUI for comparison: strip `RO` prefix, trim, lowercase,
 * drop non-digits. Returns empty string for nullish/blank input.
 * WHMCS sometimes sends "RO40015841", sometimes "40015841", sometimes "ro40015841".
 * The CRM stores the bare digits (convention in schema comments).
 */
export function normalizeCui(raw: string | null | undefined): string {
	if (!raw) return '';
	return String(raw)
		.trim()
		.toLowerCase()
		.replace(/^ro/, '')
		.replace(/\D/g, '');
}

function normalizeEmail(raw: string | null | undefined): string {
	return (raw ?? '').trim().toLowerCase();
}

/**
 * Pick a display name for a new client. Prefers companyName for legal
 * entities; falls back to "firstName lastName"; last resort: the CUI or
 * email. Never returns empty (schema requires `name NOT NULL`).
 */
function pickDisplayName(payload: WhmcsClientPayload): string {
	if (payload.companyName && payload.companyName.trim()) {
		return payload.companyName.trim();
	}
	const personal = [payload.firstName, payload.lastName]
		.map((s) => s?.trim())
		.filter(Boolean)
		.join(' ')
		.trim();
	if (personal) return personal;
	if (payload.email && payload.email.trim()) return payload.email.trim();
	if (payload.taxId && payload.taxId.trim()) return `WHMCS #${payload.whmcsClientId}`;
	return `WHMCS #${payload.whmcsClientId}`;
}

// ─────────────────────────────────────────────
// Cascade
// ─────────────────────────────────────────────

export async function matchOrCreateClient(
	tenantId: string,
	payload: WhmcsClientPayload
): Promise<MatchOrCreateResult> {
	// 1. whmcs_client_id — the stable key after first sync.
	const byWhmcsId = await db
		.select()
		.from(table.client)
		.where(
			and(
				eq(table.client.tenantId, tenantId),
				eq(table.client.whmcsClientId, payload.whmcsClientId)
			)
		)
		.get();

	if (byWhmcsId) {
		return { clientId: byWhmcsId.id, matchType: 'WHMCS_ID', created: false };
	}

	// 2. CUI (if present) — most common branch on first sync for legal persons.
	const cui = normalizeCui(payload.taxId);
	if (cui) {
		const byCui = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.tenantId, tenantId), eq(table.client.cui, cui)))
			.get();

		if (byCui) {
			await db
				.update(table.client)
				.set({
					whmcsClientId: payload.whmcsClientId,
					updatedAt: new Date()
				})
				.where(eq(table.client.id, byCui.id));
			logInfo('whmcs', 'Client matched by CUI — stamped whmcsClientId', {
				tenantId,
				metadata: { clientId: byCui.id, cui, whmcsClientId: payload.whmcsClientId }
			});
			return { clientId: byCui.id, matchType: 'CUI', created: false };
		}
	}

	// 3. Email (if present) — tiebreak / natural-person branch.
	const email = normalizeEmail(payload.email);
	if (email) {
		const byEmail = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.tenantId, tenantId), eq(table.client.email, email)))
			.get();

		if (byEmail) {
			// Backfill cui if the CRM row doesn't have one yet.
			const cuiUpdate = !byEmail.cui && cui ? { cui } : {};
			await db
				.update(table.client)
				.set({
					whmcsClientId: payload.whmcsClientId,
					...cuiUpdate,
					updatedAt: new Date()
				})
				.where(eq(table.client.id, byEmail.id));
			logInfo('whmcs', 'Client matched by email — stamped whmcsClientId', {
				tenantId,
				metadata: {
					clientId: byEmail.id,
					email,
					whmcsClientId: payload.whmcsClientId,
					backfilledCui: !byEmail.cui && cui ? cui : null
				}
			});
			return { clientId: byEmail.id, matchType: 'EMAIL', created: false };
		}
	}

	// 4. Create.
	if (!cui && !email) {
		logWarning(
			'whmcs',
			'Creating client with neither CUI nor email — may cause matching ambiguity later',
			{
				tenantId,
				metadata: { whmcsClientId: payload.whmcsClientId, name: pickDisplayName(payload) }
			}
		);
	}

	const newId = generateClientId();
	await db.insert(table.client).values({
		id: newId,
		tenantId,
		name: pickDisplayName(payload),
		businessName: payload.isLegalPerson ? payload.companyName ?? null : null,
		email: email || null,
		phone: payload.phone ?? null,
		website: null,
		status: 'active',
		companyType: payload.isLegalPerson ? 'SRL' : null,
		cui: cui || null,
		registrationNumber: null,
		tradeRegister: null,
		vatNumber: null,
		legalRepresentative: null,
		iban: null,
		bankName: null,
		address: payload.address ?? null,
		city: payload.city ?? null,
		county: payload.countyName ?? null,
		postalCode: payload.postalCode ?? null,
		country: payload.countryName ?? 'România',
		keezPartnerId: null,
		notes: null,
		googleAdsCustomerId: null,
		restrictedAccess: null,
		monthlyBudget: null,
		budgetWarningThreshold: null,
		avatarPath: null,
		avatarSource: 'whatsapp',
		whmcsClientId: payload.whmcsClientId
	});

	logInfo('whmcs', 'Client created from WHMCS payload', {
		tenantId,
		metadata: {
			clientId: newId,
			whmcsClientId: payload.whmcsClientId,
			cui: cui || null,
			email: email || null
		}
	});

	return { clientId: newId, matchType: 'NEW', created: true };
}
