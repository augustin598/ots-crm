import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, or } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { normalizeCui } from '$lib/server/cui-validator';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { serializeError } from '$lib/server/logger';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export interface ResolveClientInput {
	type: 'person' | 'company';
	/** Contact name (persoană) sau denumire firmă (persoană juridică). */
	name: string;
	email: string;
	companyName?: string | null;
	/** CUI brut (poate avea prefix RO); folosit doar pentru `company`. */
	vatNumber?: string | null;
}

async function findClientByEmail(tenantId: string, email: string): Promise<string | null> {
	const [row] = await db
		.select({ id: table.client.id })
		.from(table.client)
		.where(and(eq(table.client.tenantId, tenantId), eq(table.client.email, email)))
		.limit(1);
	return row?.id ?? null;
}

/**
 * Găsește sau creează un client CRM pentru o **comandă manuală** (context admin).
 *
 * Provisioning-ul DA (`provisionDirectAdminAccount`) cere obligatoriu un client
 * cu email, dar comenzile manuale se inserează cu `clientId = null`. Helper-ul
 * acoperă golul: dedup pe identitate fiscală/email, altfel inserează clientul.
 *
 *  - **Firmă**: caută pe `cui` / `vatNumber` (RO + plain), apoi pe email; altfel insert.
 *  - **Persoană**: caută pe email; altfel insert.
 *
 * Mai simplu decât fluxul public din `/pachete-hosting` (fără anti-enumeration —
 * adminul are deja acces autentificat). Tratează cursa pe UNIQUE
 * `(tenant, cui)` / email re-căutând clientul existent.
 *
 * Returnează `clientId`-ul (existent sau nou-creat) + dacă a fost creat acum.
 */
export async function resolveOrCreateClientForManualOrder(
	tenantId: string,
	input: ResolveClientInput
): Promise<{ clientId: string; created: boolean }> {
	const email = input.email.trim().toLowerCase();
	if (!email) throw new Error('Email obligatoriu pentru a crea/lega clientul');

	if (input.type === 'company') {
		const cleanCui = input.vatNumber ? normalizeCui(input.vatNumber) : '';
		const companyName = (input.companyName ?? input.name).trim();

		// 1. Dedup pe identitate fiscală.
		if (cleanCui) {
			const [byCui] = await db
				.select({ id: table.client.id })
				.from(table.client)
				.where(
					and(
						eq(table.client.tenantId, tenantId),
						or(
							eq(table.client.cui, cleanCui),
							eq(table.client.vatNumber, `RO${cleanCui}`),
							eq(table.client.vatNumber, cleanCui)
						)
					)
				)
				.limit(1);
			if (byCui) return { clientId: byCui.id, created: false };
		}

		// 2. Dedup pe email.
		const byEmail = await findClientByEmail(tenantId, email);
		if (byEmail) return { clientId: byEmail, created: false };

		// 3. Insert client nou (firmă).
		const clientId = generateId();
		try {
			await withTursoBusyRetry(
				() =>
					db.insert(table.client).values({
						id: clientId,
						tenantId,
						name: companyName || input.name.trim() || email,
						businessName: companyName || null,
						email,
						status: 'active',
						cui: cleanCui || null,
						vatNumber: cleanCui ? `RO${cleanCui}` : null,
						country: 'RO',
						legalType: 'srl',
						signupSource: 'admin-created',
						onboardingStatus: 'active'
					}),
				{ tenantId, label: 'manual-order/insertClient(company)' }
			);
			return { clientId, created: true };
		} catch (err) {
			// Cursă pe UNIQUE (tenant, cui) SAU email — re-caută și atașează.
			const { message } = serializeError(err);
			if (message.toLowerCase().includes('unique')) {
				const conds = [eq(table.client.email, email)];
				if (cleanCui) {
					conds.push(
						eq(table.client.cui, cleanCui),
						eq(table.client.vatNumber, `RO${cleanCui}`),
						eq(table.client.vatNumber, cleanCui)
					);
				}
				const [race] = await db
					.select({ id: table.client.id })
					.from(table.client)
					.where(and(eq(table.client.tenantId, tenantId), or(...conds)))
					.limit(1);
				if (race) return { clientId: race.id, created: false };
			}
			throw err;
		}
	}

	// === Persoană fizică — identitate doar pe email ===
	const byEmail = await findClientByEmail(tenantId, email);
	if (byEmail) return { clientId: byEmail, created: false };

	const clientId = generateId();
	try {
		await withTursoBusyRetry(
			() =>
				db.insert(table.client).values({
					id: clientId,
					tenantId,
					name: input.name.trim() || email,
					email,
					status: 'active',
					country: 'RO',
					legalType: 'pf',
					signupSource: 'admin-created',
					onboardingStatus: 'active'
				}),
			{ tenantId, label: 'manual-order/insertClient(person)' }
		);
		return { clientId, created: true };
	} catch (err) {
		const { message } = serializeError(err);
		if (message.toLowerCase().includes('unique')) {
			const race = await findClientByEmail(tenantId, email);
			if (race) return { clientId: race, created: false };
		}
		throw err;
	}
}
