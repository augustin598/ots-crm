import * as v from 'valibot';
import { and, eq, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { sendMagicLinkEmail } from '$lib/server/email';
import { generateMagicLinkToken, hashToken } from '$lib/server/client-auth';

/**
 * Cont de portal creat singur de pe /pachete-hosting sau /client/[tenant]/signup.
 *
 * Modelul (ca la Hostico): întâi contul — nume + email —, datele de facturare
 * (PF/PJ, CUI, adresă) vin la prima comandă. Clientul pornește cu
 * `portalScope = 'hosting'`, adică vede doar Dashboard, Hosting, Facturi, Setări.
 * Login-ul rămâne cel existent: magic link pe email sau Google.
 */

const MAGIC_LINK_EXPIRY_HOURS = 24;

/**
 * Formularul „Cont nou" (minimal, ca la Hostico). Stă aici, nu în fișierul
 * .remote.ts, pentru că un modul remote poate exporta doar funcții remote.
 */
export const HostingSignupSchema = v.object({
	tenantSlug: v.pipe(v.string(), v.minLength(1)),
	name: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(3, 'Scrie numele complet.'),
		v.maxLength(120, 'Numele e prea lung.')
	),
	email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email('Adresa de email nu e validă.')),
	phone: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40, 'Telefonul e prea lung.'))),
	consentTerms: v.literal(true, 'Bifează termenii și condițiile.')
});
export type HostingSignupInput = v.InferOutput<typeof HostingSignupSchema>;

export type MatchedClient = { id: string; name: string };

function newId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/** Toți clienții tenantului la care emailul e primar sau secundar, fără dubluri. */
export async function findClientIdsForEmail(tenantId: string, email: string): Promise<MatchedClient[]> {
	const normalized = email.trim().toLowerCase();
	const primary = await db
		.select({ id: table.client.id, name: table.client.name })
		.from(table.client)
		.where(and(eq(table.client.tenantId, tenantId), eq(sql`lower(${table.client.email})`, normalized)));
	const secondary = await db
		.select({ id: table.client.id, name: table.client.name })
		.from(table.clientSecondaryEmail)
		.innerJoin(table.client, eq(table.clientSecondaryEmail.clientId, table.client.id))
		.where(
			and(
				eq(table.clientSecondaryEmail.tenantId, tenantId),
				eq(sql`lower(${table.clientSecondaryEmail.email})`, normalized)
			)
		);
	const seen = new Set<string>();
	const out: MatchedClient[] = [];
	for (const c of [...primary, ...secondary]) {
		if (seen.has(c.id)) continue;
		seen.add(c.id);
		out.push(c);
	}
	return out;
}

/**
 * Găsește clientul (clienții) emailului sau creează unul nou, fără CUI.
 * Răspunsul e același în ambele cazuri — apelanții nu trebuie să dezvăluie
 * dacă emailul exista deja (anti-enumerare, ca la magic link).
 */
export async function findOrCreateHostingSignupClient(input: {
	tenantId: string;
	name: string;
	email: string;
	phone: string | null;
	/** true când emailul vine verificat de Google — contul e activ pe loc. */
	emailVerified?: boolean;
}): Promise<{ clients: MatchedClient[]; created: boolean }> {
	const email = input.email.trim().toLowerCase();
	const name = input.name.trim();
	const existing = await findClientIdsForEmail(input.tenantId, email);
	if (existing.length > 0) return { clients: existing, created: false };

	try {
		const [row] = await db
			.insert(table.client)
			.values({
				id: newId(),
				tenantId: input.tenantId,
				name,
				businessName: null,
				email,
				phone: input.phone || null,
				status: 'prospect',
				cui: null,
				vatNumber: null,
				legalType: null,
				country: 'RO',
				signupSource: 'hosting-signup',
				onboardingStatus: input.emailVerified ? 'active' : 'pending_email',
				portalScope: 'hosting'
			})
			.returning();
		return { clients: [{ id: row.id, name: row.name }], created: true };
	} catch (err) {
		// Două signup-uri simultane cu același email: UNIQUE(tenant, email) l-a
		// lăsat pe celălalt să câștige → îl folosim pe al lui.
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.toLowerCase().includes('unique')) throw err;
		const winner = await findClientIdsForEmail(input.tenantId, email);
		if (winner.length === 0) throw err;
		return { clients: winner, created: false };
	}
}

/**
 * Clientul activ al unui user logat. Pe rutele publice (ex. /pachete-hosting)
 * hooks-ul nu populează `locals.client`, deci îl citim direct din client_user.
 */
export async function resolvePortalClientForUser(tenantId: string, userId: string) {
	const [row] = await db
		.select({
			id: table.client.id,
			name: table.client.name,
			email: table.client.email,
			portalScope: table.client.portalScope,
			// Doar contactul primar poate comanda „pe contul lui” și modifica rândul.
			isPrimary: table.clientUser.isPrimary,
			// Datele de facturare deja cunoscute — checkout-ul le precompletează.
			businessName: table.client.businessName,
			legalType: table.client.legalType,
			cui: table.client.cui,
			vatNumber: table.client.vatNumber,
			registrationNumber: table.client.registrationNumber,
			phone: table.client.phone,
			address: table.client.address,
			city: table.client.city,
			county: table.client.county,
			postalCode: table.client.postalCode
		})
		.from(table.clientUser)
		.innerJoin(table.client, eq(table.clientUser.clientId, table.client.id))
		.where(and(eq(table.clientUser.userId, userId), eq(table.clientUser.tenantId, tenantId)))
		.orderBy(sql`${table.clientUser.lastSelectedAt} DESC NULLS LAST`)
		.limit(1);
	return row ?? null;
}

/** Invalidează token-urile vechi ale emailului, emite unul nou pentru clienții dați și trimite emailul. */
export async function issueMagicLink(
	tenant: { id: string; slug: string },
	email: string,
	clients: MatchedClient[]
): Promise<void> {
	if (clients.length === 0) throw new Error('issueMagicLink: no clients to authorize');
	const normalized = email.trim().toLowerCase();
	await db
		.update(table.magicLinkToken)
		.set({ used: true, usedAt: new Date() })
		.where(
			and(
				eq(table.magicLinkToken.email, normalized),
				eq(table.magicLinkToken.tenantId, tenant.id),
				eq(table.magicLinkToken.used, false)
			)
		);
	const plainToken = generateMagicLinkToken();
	await db.insert(table.magicLinkToken).values({
		id: newId(),
		token: hashToken(plainToken),
		email: normalized,
		clientId: clients[0].id,
		matchedClientIds: JSON.stringify(clients.map((c) => c.id)),
		tenantId: tenant.id,
		expiresAt: new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000),
		used: false
	});
	await sendMagicLinkEmail(normalized, plainToken, tenant.slug, clients[0].name);
}
