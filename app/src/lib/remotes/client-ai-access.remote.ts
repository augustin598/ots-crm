import { query, command, getRequestEvent } from '$app/server';
import { error as svelteError } from '@sveltejs/kit';
import { requireStaff } from '$lib/server/get-actor';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

/**
 * Acces AI per client (panoul din pagina clientului). Deocamdată doar utilizarea
 * `copywriting` (modulul Content) e conectată la portal; restul use-case-urilor din
 * CLAUDE_USE_CASES sunt placeholdere în UI (dezactivate). Stocarea efectivă a gate-ului
 * e per-website (`websiteContentProfile.allowClientAi`) — un switch pe client scrie pe
 * TOATE site-urile clientului, iar portalul filtrează per-website (vezi content-articles.remote).
 */

function genId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/** Ids-urile website-urilor unui client, scopate pe tenant. */
async function clientWebsiteIds(tenantId: string, clientId: string): Promise<string[]> {
	const rows = await db
		.select({ id: table.clientWebsite.id })
		.from(table.clientWebsite)
		.where(and(eq(table.clientWebsite.tenantId, tenantId), eq(table.clientWebsite.clientId, clientId)));
	return rows.map((r) => r.id);
}

/**
 * Starea accesului AI al unui client, per use-case. `copywriting` e ON dacă clientul
 * are ≥1 website cu `allowClientAi = true` — ACEEAȘI semantică (ANY) ca gate-ul
 * portalului (`contentEnabled` / getContentWebsites). Aliniat intenționat: switch-ul
 * reflectă „clientul are acces" (revocare într-un click; un site adăugat ulterior
 * rămâne dezactivat = fail-closed, iar switch-ul NU se stinge fals). Staff-only.
 */
export const getClientAiAccess = query(v.string(), async (clientId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
	await requireStaff(event);
	const tenantId = event.locals.tenant.id;

	const ids = await clientWebsiteIds(tenantId, clientId);
	let enabledCount = 0;
	if (ids.length) {
		const enabled = await db
			.select({ websiteId: table.websiteContentProfile.websiteId })
			.from(table.websiteContentProfile)
			.where(
				and(
					eq(table.websiteContentProfile.tenantId, tenantId),
					inArray(table.websiteContentProfile.websiteId, ids),
					eq(table.websiteContentProfile.allowClientAi, true)
				)
			);
		enabledCount = enabled.length;
	}

	return {
		websiteCount: ids.length,
		enabledCount,
		// ANY: aliniat cu gate-ul portalului — switch-ul reflectă accesul real al clientului.
		copywriting: enabledCount > 0
	};
});

/**
 * Switch admin „Copywriting / conținut": pornește/oprește Content AI în portal pentru
 * TOATE website-urile clientului. Upsert `allowClientAi` pe profilul fiecărui website.
 * Staff-only.
 */
export const setClientContentAiAccess = command(
	v.object({ clientId: v.string(), allow: v.boolean() }),
	async ({ clientId, allow }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
		await requireStaff(event);
		const tenantId = event.locals.tenant.id;

		const ids = await clientWebsiteIds(tenantId, clientId);
		if (!ids.length) return { ok: true as const, affected: 0 };

		// Profilele existente printre website-urile clientului.
		const profiles = await db
			.select({ websiteId: table.websiteContentProfile.websiteId })
			.from(table.websiteContentProfile)
			.where(
				and(
					eq(table.websiteContentProfile.tenantId, tenantId),
					inArray(table.websiteContentProfile.websiteId, ids)
				)
			);
		const withProfile = new Set(profiles.map((p) => p.websiteId));

		// Update pe cele care au deja profil.
		if (withProfile.size) {
			await db
				.update(table.websiteContentProfile)
				.set({ allowClientAi: allow, updatedAt: new Date() })
				.where(
					and(
						eq(table.websiteContentProfile.tenantId, tenantId),
						inArray(table.websiteContentProfile.websiteId, [...withProfile])
					)
				);
		}

		// La activare, creează profil pt website-urile care n-au (ca să fie enabled în portal).
		if (allow) {
			const missing = ids.filter((id) => !withProfile.has(id));
			if (missing.length) {
				const now = new Date();
				await db.insert(table.websiteContentProfile).values(
					missing.map((websiteId) => ({
						id: genId(),
						tenantId,
						websiteId,
						allowClientAi: true,
						createdAt: now,
						updatedAt: now
					}))
				);
			}
		}

		return { ok: true as const, affected: ids.length };
	}
);
