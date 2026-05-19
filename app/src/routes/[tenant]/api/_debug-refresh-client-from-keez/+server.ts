/**
 * Pulls a client's identifying address data (county, city, street) from ANAF
 * by CUI and patches the local CRM `client` row. ANAF is the authoritative
 * source for Romanian company data — Keez itself pulls from ANAF, so going
 * direct skips an indirection and avoids stale Keez partner records.
 *
 *   POST /[tenant]/api/_debug-refresh-client-from-keez?clientId=<id>            (dry-run)
 *   POST /[tenant]/api/_debug-refresh-client-from-keez?clientId=<id>&apply=true (mutate)
 *
 * Triggered when Keez push fails with `ERROR_PARTNER_COUNTY_NAME` or similar
 * partner-data validation errors — patches the local client with ANAF-sourced
 * county/city/address so the next push validates cleanly.
 *
 * Admin-only. Path name kept for back-compat ("from-keez" reflects the
 * downstream consumer of the fixed data).
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const ANAF_API_URL =
	env.ANAF_API_URL || 'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva';

interface AnafAddress {
	street?: string;
	city?: string;
	county?: string;
	postalCode?: string;
}

/**
 * Probe ANAF for a CUI. Returns merged address from `adresa_sediu_social`
 * (preferred) falling back to `adresa_domiciliu_fiscal`. ANAF prefixes fields
 * with `s` for sediu and `d` for domiciliu — we just normalize.
 */
async function fetchAnafCompany(
	cui: string
): Promise<{ name?: string; address: AnafAddress; raw: unknown } | null> {
	const cuiNumeric = parseInt(cui.replace(/^RO/i, '').trim(), 10);
	if (!Number.isFinite(cuiNumeric)) return null;

	const today = new Date().toISOString().split('T')[0];
	const res = await fetch(ANAF_API_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify([{ cui: cuiNumeric, data: today }]),
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) {
		throw new Error(`ANAF HTTP ${res.status}: ${await res.text().catch(() => '')}`);
	}
	const data = (await res.json()) as {
		found?: Array<{
			date_generale?: { denumire?: string };
			adresa_sediu_social?: {
				sdenumire_Judet?: string;
				sdenumire_Localitate?: string;
				sdetalii_Adresa?: string;
				scod_Postal?: string;
				sdenumire_Strada?: string;
				snumar_Strada?: string;
			};
			adresa_domiciliu_fiscal?: {
				ddenumire_Judet?: string;
				ddenumire_Localitate?: string;
				ddetalii_Adresa?: string;
				dcod_Postal?: string;
				ddenumire_Strada?: string;
				dnumar_Strada?: string;
			};
		}>;
	};
	const company = data.found?.[0];
	if (!company) return null;

	const sediu = company.adresa_sediu_social;
	const domiciliu = company.adresa_domiciliu_fiscal;
	// Prefer sediu social (registered HQ) — that's what Keez expects.
	const address: AnafAddress = {
		street:
			sediu?.sdetalii_Adresa ||
			[sediu?.sdenumire_Strada, sediu?.snumar_Strada].filter(Boolean).join(' ').trim() ||
			domiciliu?.ddetalii_Adresa ||
			[domiciliu?.ddenumire_Strada, domiciliu?.dnumar_Strada].filter(Boolean).join(' ').trim() ||
			undefined,
		city: sediu?.sdenumire_Localitate || domiciliu?.ddenumire_Localitate,
		county: sediu?.sdenumire_Judet || domiciliu?.ddenumire_Judet,
		postalCode: sediu?.scod_Postal || domiciliu?.dcod_Postal
	};
	return { name: company.date_generale?.denumire, address, raw: company };
}

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	const tenantId = event.locals.tenant.id;
	const apply = event.url.searchParams.get('apply') === 'true';
	const clientId = event.url.searchParams.get('clientId');

	if (!clientId) throw error(400, 'clientId query param is required');
	if (!/^[a-z0-9]{20,32}$/i.test(clientId)) {
		throw error(400, 'clientId must be a CRM id (20-32 alphanumeric chars)');
	}

	const [clientRow] = await db
		.select()
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	if (!clientRow) throw error(404, 'Client not found in this tenant');
	if (!clientRow.cui) {
		throw error(409, 'Client has no CUI — cannot look up in ANAF');
	}

	let anaf;
	try {
		anaf = await fetchAnafCompany(clientRow.cui);
	} catch (err) {
		const e = serializeError(err);
		logWarning(
			'anaf-spv',
			`Refresh client: ANAF lookup failed for CUI ${clientRow.cui}: ${e.message}`,
			{ tenantId, stackTrace: e.stack, metadata: { clientId } }
		);
		return json({ ok: false, phase: 'anaf_lookup', error: e.message }, { status: 500 });
	}
	if (!anaf) {
		return json(
			{ ok: false, reason: 'cui_not_found_in_anaf', clientId, cui: clientRow.cui },
			{ status: 404 }
		);
	}

	const changes: Record<string, { before: unknown; after: unknown }> = {};
	const patch: Partial<typeof table.client.$inferInsert> = {};

	const fieldsToSync: Array<{ local: keyof typeof clientRow; value: string | undefined }> = [
		{ local: 'businessName', value: anaf.name },
		{ local: 'address', value: anaf.address.street },
		{ local: 'city', value: anaf.address.city },
		{ local: 'county', value: anaf.address.county },
		{ local: 'postalCode', value: anaf.address.postalCode }
	];

	for (const { local, value } of fieldsToSync) {
		if (value && value.trim() && clientRow[local] !== value) {
			changes[local] = { before: clientRow[local], after: value };
			(patch as Record<string, unknown>)[local] = value;
		}
	}

	if (Object.keys(changes).length === 0) {
		return json({
			ok: true,
			apply,
			noChanges: true,
			clientId,
			cui: clientRow.cui,
			anaf: { name: anaf.name, address: anaf.address }
		});
	}

	if (apply) {
		patch.updatedAt = new Date();
		await db
			.update(table.client)
			.set(patch)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)));
		logInfo(
			'anaf-spv',
			`Refreshed client ${clientId} from ANAF (CUI ${clientRow.cui}): ${Object.keys(changes).join(', ')}`,
			{ tenantId, metadata: { clientId, changes } }
		);
	}

	return json({ ok: true, apply, clientId, cui: clientRow.cui, changes });
};
