/**
 * Numărul de WhatsApp al utilizatorului de portal, pus de el însuși.
 *
 * Contactele secundare ale unui client n-aveau niciun loc unde să-și dea
 * numărul, deci nu puteau căpăta avatar. Aici și-l pun singuri, la login.
 * Sursa canonică rămâne `user_whatsapp_link`; `client.phone` (telefonul firmei,
 * cel de pe facturi) nu se atinge.
 */
import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { normalizePhoneE164 } from '$lib/utils/phone';
import { isOnWhatsapp } from '$lib/server/whatsapp/groups';
import { checkFixedWindowLimit } from '$lib/server/rate-limiter';
import { logError } from '$lib/server/logger';
import { serializeError } from '$lib/server/error-serializer';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/** Trei încercări la 24 de ore: destul pentru o greșeală de tastare, prea puțin pentru scanare. */
const SAVE_LIMIT = { max: 3, windowMs: 24 * 60 * 60 * 1000 };

type PortalActor = { userId: string; tenantId: string; clientUserId: string };

/** Doar utilizatori de portal autentificați. tenantId vine din sesiune, niciodată din input. */
function requirePortalUser(): PortalActor {
	const event = getRequestEvent();
	if (!event?.locals.user || !event.locals.isClientUser || !event.locals.clientUser) {
		throw new Error('Unauthorized');
	}
	const tenantId = event.locals.tenant?.id ?? event.locals.client?.tenantId;
	if (!tenantId) throw new Error('Unauthorized');
	return {
		userId: event.locals.user.id,
		tenantId,
		clientUserId: event.locals.clientUser.id
	};
}

/**
 * Știe CRM-ul deja al cui e numărul, și nu al celui care îl salvează?
 *
 * Trei surse: legăturile existente ale altor utilizatori, telefoanele oamenilor
 * din agenție și telefoanele firmelor-client. Comparația se face pe forma
 * normalizată, fiindcă în CRM numerele sunt scrise în fel și chip.
 */
async function isClaimedBySomeoneElse(actor: PortalActor, e164: string): Promise<boolean> {
	const links = await db
		.select({ userId: table.userWhatsappLink.userId, phoneE164: table.userWhatsappLink.phoneE164 })
		.from(table.userWhatsappLink)
		.where(eq(table.userWhatsappLink.tenantId, actor.tenantId));
	if (links.some((l) => l.userId !== actor.userId && normalizePhoneE164(l.phoneE164) === e164)) {
		return true;
	}

	const staff = await db
		.select({ userId: table.tenantUser.userId, phone: table.tenantUser.phone })
		.from(table.tenantUser)
		.where(eq(table.tenantUser.tenantId, actor.tenantId));
	if (staff.some((s) => s.userId !== actor.userId && normalizePhoneE164(s.phone) === e164)) {
		return true;
	}

	const clients = await db
		.select({ phone: table.client.phone })
		.from(table.client)
		.where(eq(table.client.tenantId, actor.tenantId));
	return clients.some((c) => normalizePhoneE164(c.phone) === e164);
}

/** Numărul propriu, pentru pagina de Setări. */
export const getMyWhatsappPhone = query(async () => {
	const actor = requirePortalUser();
	const [row] = await db
		.select({
			phoneE164: table.userWhatsappLink.phoneE164,
			whatsappVerified: table.userWhatsappLink.whatsappVerified,
			source: table.userWhatsappLink.source
		})
		.from(table.userWhatsappLink)
		.where(
			and(
				eq(table.userWhatsappLink.tenantId, actor.tenantId),
				eq(table.userWhatsappLink.userId, actor.userId)
			)
		)
		.limit(1);
	return row ?? null;
});

/**
 * Salvează numărul. Verificarea e „soft": dacă sesiunea WhatsApp a agenției e
 * conectată și spune că numărul nu există, refuzăm; dacă sesiunea e picată, nu
 * știm, deci salvăm nverificat în loc să blocăm omul pentru o problemă de-a
 * noastră. Reverificarea vine la un login următor.
 */
export const setMyWhatsappPhone = command(
	v.object({ phone: v.pipe(v.string(), v.minLength(1)) }),
	async ({ phone }) => {
		const actor = requirePortalUser();

		const e164 = normalizePhoneE164(phone);
		if (!e164) {
			return { ok: false as const, reason: 'format' as const };
		}

		if (checkFixedWindowLimit(`wa-phone:${actor.userId}`, SAVE_LIMIT)) {
			return { ok: false as const, reason: 'rate_limited' as const };
		}

		// Numărul altcuiva nu poate fi revendicat.
		//
		// Nu avem cum să dovedim că numărul îi aparține celui care îl salvează:
		// pentru asta ar trebui un cod trimis pe WhatsApp și confirmat înapoi. Ce
		// putem face e să refuzăm numerele despre care CRM-ul știe deja ale cui
		// sunt, fiindcă tocmai alea fac rău: cu numărul unui coleg sau al altui
		// client, cel care îl revendică ar căpăta avatarul acelei persoane în
		// panoul de echipă și ar strica propunerea de client la grupuri.
		if (await isClaimedBySomeoneElse(actor, e164)) {
			return { ok: false as const, reason: 'already_linked' as const };
		}

		const exists = await isOnWhatsapp(actor.tenantId, e164);
		if (exists === false) {
			return { ok: false as const, reason: 'not_on_whatsapp' as const };
		}

		const now = new Date();
		await db
			.delete(table.userWhatsappLink)
			.where(
				and(
					eq(table.userWhatsappLink.tenantId, actor.tenantId),
					eq(table.userWhatsappLink.userId, actor.userId)
				)
			);
		await db.insert(table.userWhatsappLink).values({
			id: generateId(),
			tenantId: actor.tenantId,
			userId: actor.userId,
			phoneE164: e164,
			source: 'self_service',
			whatsappVerified: exists === true,
			verifiedAt: exists === true ? now : null,
			consentedAt: now
		});

		// Cerem avatarul acum, ca poza să apară fără să aștepte un mesaj nou.
		try {
			const { enqueueFetch } = await import('$lib/server/whatsapp/avatar-fetcher');
			enqueueFetch(actor.tenantId, e164);
		} catch (err) {
			logError('whatsapp', 'enqueueFetch avatar eșuat (portal)', {
				tenantId: actor.tenantId,
				metadata: { err: serializeError(err) }
			});
		}

		return { ok: true as const, phoneE164: e164, verified: exists === true };
	}
);

/** „Nu acum". După al treilea, modalul nu mai apare. */
export const dismissWhatsappPrompt = command(async () => {
	const actor = requirePortalUser();
	const now = new Date();

	const [existing] = await db
		.select({ count: table.clientUserPreferences.whatsappPromptDismissedCount })
		.from(table.clientUserPreferences)
		.where(eq(table.clientUserPreferences.clientUserId, actor.clientUserId))
		.limit(1);

	if (existing) {
		await db
			.update(table.clientUserPreferences)
			.set({
				whatsappPromptDismissedCount: (existing.count ?? 0) + 1,
				whatsappPromptLastDismissedAt: now,
				updatedAt: now
			})
			.where(eq(table.clientUserPreferences.clientUserId, actor.clientUserId));
		return { dismissedCount: (existing.count ?? 0) + 1 };
	}

	await db.insert(table.clientUserPreferences).values({
		id: generateId(),
		clientUserId: actor.clientUserId,
		tenantId: actor.tenantId,
		whatsappPromptDismissedCount: 1,
		whatsappPromptLastDismissedAt: now
	});
	return { dismissedCount: 1 };
});

/** Ștergerea numărului propriu, din Setări. */
export const deleteMyWhatsappPhone = command(async () => {
	const actor = requirePortalUser();
	await db
		.delete(table.userWhatsappLink)
		.where(
			and(
				eq(table.userWhatsappLink.tenantId, actor.tenantId),
				eq(table.userWhatsappLink.userId, actor.userId)
			)
		);
	return { ok: true };
});
