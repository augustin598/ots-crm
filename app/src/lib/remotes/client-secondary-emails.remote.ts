import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, inArray, isNotNull, sql } from 'drizzle-orm';
import { getUserWhatsappPhonesBatch } from '$lib/server/whatsapp/resolve-phone';
import { listGroups, nameMatchScore, WhatsappNotConnectedError } from '$lib/server/whatsapp/groups';
import { normalizePhoneE164 } from '$lib/utils/phone';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { sendClientTeamInviteEmail } from '$lib/server/email';
import { logError } from '$lib/server/logger';
import { serializeError } from '$lib/server/error-serializer';
import { requireStaff } from '$lib/server/get-actor';
import { checkAuthRateLimit } from '$lib/server/rate-limiter';
import { generateMagicLinkToken, hashToken } from '$lib/server/client-auth';
import { deleteClientUserWithFKs } from '$lib/server/client-users';
import {
	ACCESS_CATEGORIES,
	parseAccessFlags,
	type AccessFlags
} from '$lib/server/portal-access';
// import static, NU dinamic: rolldown (Vite 8) compilează `await import(...)` din
// fișierele .remote.ts în `await void 0` → funcția pică pe build-ul de producție
import { enqueueFetch } from '$lib/server/whatsapp/avatar-fetcher';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const MAGIC_LINK_EXPIRY_HOURS = 24;

/** Only persist known categories, coerced to boolean. */
function sanitizeFlags(flags: AccessFlags): AccessFlags {
	return Object.fromEntries(ACCESS_CATEGORIES.map((c) => [c, !!flags[c]])) as AccessFlags;
}

/**
 * Authorize secondary-email management for a given clientId.
 * Allowed actors:
 *  - tenant users (admin staff) — verificat cu requireStaff, NU doar cu
 *    prezența locals.tenant: pe rutele /client/<slug>/* tenant-ul e setat și
 *    pentru useri fără tenantUser, iar pathname-ul e controlabil de client (F8)
 *  - primary client users — only for THEIR own client
 * Returns the tenantId so callers can scope their writes.
 */
async function authorizeSecondaryEmailAccess(
	event: ReturnType<typeof getRequestEvent>,
	clientId: string
): Promise<string> {
	if (!event?.locals.user) throw new Error('Unauthorized');
	if (event.locals.isClientUser) {
		if (!event.locals.clientUser?.isPrimary) throw new Error('Unauthorized');
		if (!event.locals.client || event.locals.client.id !== clientId) {
			throw new Error('Unauthorized');
		}
		return event.locals.client.tenantId;
	}
	if (!event.locals.tenant) throw new Error('Unauthorized');
	await requireStaff(event);
	return event.locals.tenant.id;
}

/** Get all secondary emails for a client (admin only) */
export const getClientSecondaryEmails = query(
	v.pipe(v.string(), v.minLength(1)),
	async (clientId) => {
		const event = getRequestEvent();
		const tenantId = await authorizeSecondaryEmailAccess(event, clientId);

		const rows = await db
			.select()
			.from(table.clientSecondaryEmail)
			.where(
				and(
					eq(table.clientSecondaryEmail.clientId, clientId),
					eq(table.clientSecondaryEmail.tenantId, tenantId)
				)
			);

		// Avatar WhatsApp per contact: email → user → user_whatsapp_link → contact cu
		// avatar stocat. Doar legături deterministe (fără potrivire după nume), la fel
		// ca în getAssignableClientUsers. Contactele fără telefon legat rămân cu inițiale.
		const { avatarPhoneByEmail, linkedPhoneByEmail } = await resolvePhonesByEmail(
			tenantId,
			rows.map((r) => r.email).filter((e): e is string => !!e)
		);

		// Resolve accessFlags so the UI gets a guaranteed-shape object per row.
		// Fallback to legacy notify* columns when access_flags is NULL (pre-backfill rows).
		return rows.map((r) => {
			const parsed = parseAccessFlags(r.accessFlags);
			const flags: AccessFlags = parsed ?? {
				invoices: !!r.notifyInvoices,
				contracts: !!r.notifyContracts,
				tasks: !!r.notifyTasks,
				marketing: false,
				reports: false,
				leads: false,
				accessData: false,
				backlinks: false,
				budgets: false,
				hosting: false,
				content: false,
				interviuri: false,
				seo: false
			};
			return {
				...r,
				accessFlagsResolved: flags,
				avatarPhone: avatarPhoneByEmail.get(r.email) ?? null,
				whatsappPhone: linkedPhoneByEmail.get(r.email) ?? null
			};
		});
	}
);

/**
 * Leagă (sau dezleagă, cu string gol) numărul de WhatsApp al unui contact secundar.
 *
 * De ce e nevoie: contactul principal își ia numărul din `client.phone`, dar
 * contactele secundare n-aveau niciun loc unde să-l primească — deci nu puteau
 * căpăta avatar niciodată. Scriem direct în `user_whatsapp_link` (sursa canonică),
 * la fel ca editarea telefonului din profilul de echipă.
 */
export const setClientContactWhatsappPhone = command(
	v.object({
		secondaryEmailId: v.pipe(v.string(), v.minLength(1)),
		phone: v.string()
	}),
	async (data) => {
		const event = getRequestEvent();
		const tenantHint = event?.locals.tenant?.id ?? event?.locals.client?.tenantId;
		if (!tenantHint) throw new Error('Unauthorized');

		const [record] = await db
			.select({
				id: table.clientSecondaryEmail.id,
				clientId: table.clientSecondaryEmail.clientId,
				email: table.clientSecondaryEmail.email
			})
			.from(table.clientSecondaryEmail)
			.where(
				and(
					eq(table.clientSecondaryEmail.id, data.secondaryEmailId),
					eq(table.clientSecondaryEmail.tenantId, tenantHint)
				)
			)
			.limit(1);
		if (!record) throw new Error('Email secundar negăsit');
		const tenantId = await authorizeSecondaryEmailAccess(event, record.clientId);

		const [targetUser] = await db
			.select({ id: table.user.id })
			.from(table.user)
			.where(eq(table.user.email, record.email))
			.limit(1);
		if (!targetUser) {
			throw new Error('Contactul nu are încă un cont — invită-l întâi în portal.');
		}

		const trimmed = data.phone.trim();
		const e164 = trimmed ? normalizePhoneE164(trimmed) : null;
		if (trimmed && !e164) throw new Error('Număr de telefon invalid');

		await db
			.delete(table.userWhatsappLink)
			.where(
				and(
					eq(table.userWhatsappLink.tenantId, tenantId),
					eq(table.userWhatsappLink.userId, targetUser.id)
				)
			);

		if (e164) {
			await db.insert(table.userWhatsappLink).values({
				id: generateId(),
				tenantId,
				userId: targetUser.id,
				phoneE164: e164,
				source: 'manual'
			});
			// Cerem avatarul imediat, ca poza să apară fără să aștepți un mesaj nou.
			try {
				enqueueFetch(tenantId, e164);
			} catch (err) {
				logError('whatsapp', 'enqueueFetch avatar eșuat', {
					tenantId,
					metadata: { err: serializeError(err) }
				});
			}
		}

		return { ok: true, phoneE164: e164 };
	}
);

// ============================================================================
// Import numere din grupuri WhatsApp
// ============================================================================

/**
 * Grupurile WhatsApp în care e contul conectat, cu membrii fiecăruia și o
 * PROPUNERE de potrivire cu contactele clientului (principal + secundare), după
 * nume. Propunerea e doar un punct de plecare: omul confirmă/modifică în UI,
 * apoi aplică prin `applyWhatsappGroupLinks`.
 *
 * De ce după nume și nu automat: „George D" din grup și „George" din CRM pot fi
 * aceeași persoană sau nu. Scorul 1 (nume + prenume comune) e aproape sigur,
 * 0.5 (un singur cuvânt comun) e doar o sugestie.
 */
export const getWhatsappGroupsForClient = query(
	v.pipe(v.string(), v.minLength(1)),
	async (clientId) => {
		const event = getRequestEvent();
		const tenantId = await authorizeSecondaryEmailAccess(event, clientId);
		if (event?.locals.isClientUser) throw new Error('Unauthorized');

		let groups;
		try {
			groups = await listGroups(tenantId);
		} catch (err) {
			if (err instanceof WhatsappNotConnectedError) {
				return { connected: false as const, groups: [] };
			}
			throw err;
		}

		// Contactele clientului: principal (din client.email/name) + secundare (label/email).
		const [cli] = await db
			.select({ name: table.client.name, email: table.client.email, phone: table.client.phone })
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		const secondaries = await db
			.select({
				id: table.clientSecondaryEmail.id,
				email: table.clientSecondaryEmail.email,
				label: table.clientSecondaryEmail.label
			})
			.from(table.clientSecondaryEmail)
			.where(
				and(
					eq(table.clientSecondaryEmail.clientId, clientId),
					eq(table.clientSecondaryEmail.tenantId, tenantId)
				)
			);

		type CrmContact = { kind: 'primary' | 'secondary'; id: string | null; email: string | null; name: string };
		const crmContacts: CrmContact[] = [];
		if (cli) crmContacts.push({ kind: 'primary', id: null, email: cli.email, name: cli.name });
		for (const s of secondaries) {
			crmContacts.push({
				kind: 'secondary',
				id: s.id,
				email: s.email,
				// Fără label folosim partea locală a emailului: „madalina.apetre2" → „madalina apetre2"
				name: s.label?.trim() || s.email.split('@')[0].replace(/[._-]+/g, ' ')
			});
		}

		// Legăturile existente, ca UI-ul să marcheze cine e deja legat.
		const { linkedPhoneByEmail } = await resolvePhonesByEmail(
			tenantId,
			crmContacts.map((c) => c.email).filter((e): e is string => !!e)
		);
		const primaryPhone = cli?.phone ? normalizePhoneE164(cli.phone) : null;

		// Numărul contului conectat nu e niciodată un contact de client.
		const ownPhone = (await db
			.select({ phoneE164: table.whatsappSession.phoneE164 })
			.from(table.whatsappSession)
			.where(eq(table.whatsappSession.tenantId, tenantId))
			.limit(1))[0]?.phoneE164 ?? null;

		// Baileys dă `notify` doar pentru o parte din participanți; pentru restul avem
		// numele în whatsapp_contact (push name sau numele pus de noi). Fără el,
		// potrivirea după nume n-are cu ce lucra și grupul bun nu urcă primul.
		const allPhones = [
			...new Set(groups.flatMap((g) => g.members.map((m) => m.phone)).filter((p): p is string => !!p))
		];
		const nameByPhone = new Map<string, string>();
		for (let i = 0; i < allPhones.length; i += 200) {
			const chunk = allPhones.slice(i, i + 200);
			const rows = await db
				.select({
					phoneE164: table.whatsappContact.phoneE164,
					pushName: table.whatsappContact.pushName,
					displayName: table.whatsappContact.displayName
				})
				.from(table.whatsappContact)
				.where(and(eq(table.whatsappContact.tenantId, tenantId), inArray(table.whatsappContact.phoneE164, chunk)));
			for (const r of rows) {
				const n = r.displayName?.trim() || r.pushName?.trim();
				if (n) nameByPhone.set(r.phoneE164, n);
			}
		}

		return {
			connected: true as const,
			contacts: crmContacts.map((c) => ({
				...c,
				linkedPhone: c.kind === 'primary' ? primaryPhone : (c.email ? linkedPhoneByEmail.get(c.email) ?? null : null)
			})),
			groups: groups
				.map((g) => ({
					id: g.id,
					subject: g.subject,
					size: g.size,
					members: g.members
						.filter((m) => m.phone && m.phone !== ownPhone)
						.map((m) => {
							const pushName = m.pushName ?? nameByPhone.get(m.phone as string) ?? null;
							// Cea mai bună propunere pentru acest membru.
							let best: { contact: CrmContact; score: number } | null = null;
							for (const c of crmContacts) {
								const score = nameMatchScore(pushName, c.name);
								if (score > 0 && (!best || score > best.score)) best = { contact: c, score };
							}
							return {
								phone: m.phone as string,
								pushName,
								admin: m.admin,
								suggestion: best
									? { kind: best.contact.kind, id: best.contact.id, email: best.contact.email, name: best.contact.name, score: best.score }
									: null
							};
						})
				}))
				// Grupurile cu măcar o propunere primele — cel mai probabil e grupul clientului.
				.sort((a, b) => {
					const sa = a.members.filter((m) => m.suggestion).length;
					const sb = b.members.filter((m) => m.suggestion).length;
					return sb - sa || a.subject.localeCompare(b.subject);
				})
		};
	}
);

/**
 * Aplică legăturile confirmate de om: pentru fiecare pereche (contact secundar →
 * telefon) scrie în user_whatsapp_link și cere avatarul. Contactul principal NU
 * se leagă de aici — numărul lui e `client.phone` și se editează din „Editează
 * client", care îl propagă deja.
 */
export const applyWhatsappGroupLinks = command(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1)),
		links: v.pipe(
			v.array(
				v.object({
					secondaryEmailId: v.pipe(v.string(), v.minLength(1)),
					phone: v.pipe(v.string(), v.minLength(5))
				})
			),
			v.minLength(1),
			v.maxLength(100)
		)
	}),
	async ({ clientId, links }) => {
		const event = getRequestEvent();
		const tenantId = await authorizeSecondaryEmailAccess(event, clientId);
		if (event?.locals.isClientUser) throw new Error('Unauthorized');

		const rows = await db
			.select({ id: table.clientSecondaryEmail.id, email: table.clientSecondaryEmail.email })
			.from(table.clientSecondaryEmail)
			.where(
				and(
					eq(table.clientSecondaryEmail.clientId, clientId),
					eq(table.clientSecondaryEmail.tenantId, tenantId),
					inArray(table.clientSecondaryEmail.id, links.map((l) => l.secondaryEmailId))
				)
			);
		const emailById = new Map(rows.map((r) => [r.id, r.email]));

		const users = await db
			.select({ id: table.user.id, email: table.user.email })
			.from(table.user)
			.where(inArray(table.user.email, [...emailById.values()]));
		const userByEmail = new Map(users.map((u) => [u.email, u.id]));

		const applied: Array<{ secondaryEmailId: string; phoneE164: string }> = [];
		const skipped: Array<{ secondaryEmailId: string; reason: string }> = [];

		for (const l of links) {
			const email = emailById.get(l.secondaryEmailId);
			if (!email) {
				skipped.push({ secondaryEmailId: l.secondaryEmailId, reason: 'Contact negăsit la acest client' });
				continue;
			}
			const userId = userByEmail.get(email);
			if (!userId) {
				skipped.push({ secondaryEmailId: l.secondaryEmailId, reason: 'Contactul nu are încă un cont — invită-l întâi în portal' });
				continue;
			}
			const e164 = normalizePhoneE164(l.phone);
			if (!e164) {
				skipped.push({ secondaryEmailId: l.secondaryEmailId, reason: `Număr invalid: ${l.phone}` });
				continue;
			}

			await db
				.delete(table.userWhatsappLink)
				.where(and(eq(table.userWhatsappLink.tenantId, tenantId), eq(table.userWhatsappLink.userId, userId)));
			await db.insert(table.userWhatsappLink).values({
				id: generateId(),
				tenantId,
				userId,
				phoneE164: e164,
				source: 'whatsapp_chat'
			});
			applied.push({ secondaryEmailId: l.secondaryEmailId, phoneE164: e164 });

			try {
				enqueueFetch(tenantId, e164);
			} catch (err) {
				logError('whatsapp', 'enqueueFetch avatar eșuat (import grup)', {
					tenantId,
					metadata: { err: serializeError(err) }
				});
			}
		}

		return { applied, skipped };
	}
);

/**
 * Pentru o listă de emailuri întoarce două hărți:
 *  - `linkedPhoneByEmail` — numărul din user_whatsapp_link (ce arătăm în formular);
 *  - `avatarPhoneByEmail` — doar numerele care au ȘI un avatar chiar stocat, ca UI-ul
 *    să ceară imaginea numai când există (altfel fiecare contact fără poză ar da 404).
 */
async function resolvePhonesByEmail(
	tenantId: string,
	emails: string[]
): Promise<{ avatarPhoneByEmail: Map<string, string>; linkedPhoneByEmail: Map<string, string> }> {
	const avatarPhoneByEmail = new Map<string, string>();
	const linkedPhoneByEmail = new Map<string, string>();
	if (emails.length === 0) return { avatarPhoneByEmail, linkedPhoneByEmail };

	const users = await db
		.select({ id: table.user.id, email: table.user.email })
		.from(table.user)
		.where(inArray(table.user.email, [...new Set(emails)]));
	if (users.length === 0) return { avatarPhoneByEmail, linkedPhoneByEmail };

	const phonesByUser = await getUserWhatsappPhonesBatch(
		tenantId,
		users.map((u) => u.id)
	);
	for (const u of users) {
		const phone = phonesByUser.get(u.id);
		if (phone) linkedPhoneByEmail.set(u.email, phone);
	}

	const phones = [...new Set(phonesByUser.values())];
	if (phones.length === 0) return { avatarPhoneByEmail, linkedPhoneByEmail };

	const withAvatar = await db
		.select({ phoneE164: table.whatsappContact.phoneE164 })
		.from(table.whatsappContact)
		.where(
			and(
				eq(table.whatsappContact.tenantId, tenantId),
				inArray(table.whatsappContact.phoneE164, phones),
				isNotNull(table.whatsappContact.avatarPath)
			)
		);
	const stored = new Set(withAvatar.map((r) => r.phoneE164));

	for (const [email, phone] of linkedPhoneByEmail) {
		if (stored.has(phone)) avatarPhoneByEmail.set(email, phone);
	}
	return { avatarPhoneByEmail, linkedPhoneByEmail };
}

// Generată din ACCESS_CATEGORIES — o singură sursă de adevăr; o categorie
// nouă adăugată în portal-access.ts intră automat și în schema de validare.
const accessFlagsSchema = v.object(
	Object.fromEntries(ACCESS_CATEGORIES.map((c) => [c, v.boolean()])) as Record<
		(typeof ACCESS_CATEGORIES)[number],
		ReturnType<typeof v.boolean>
	>
);

const createSchema = v.object({
	clientId: v.pipe(v.string(), v.minLength(1)),
	email: v.pipe(v.string(), v.email('Email invalid')),
	label: v.optional(v.string()),
	/** Set the portal access flags atomically at creation (no two-step race). */
	accessFlags: v.optional(accessFlagsSchema),
	/** Send the colleague a portal invite email with a single-use magic link. */
	sendInvite: v.optional(v.boolean())
});

/** Add a secondary email to a client */
export const createClientSecondaryEmail = command(createSchema, async (data) => {
	const event = getRequestEvent();
	const tenantId = await authorizeSecondaryEmailAccess(event, data.clientId);

	// Validate clientId belongs to tenant
	const [client] = await db
		.select({ id: table.client.id, email: table.client.email })
		.from(table.client)
		.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	if (!client) throw new Error('Client not found');

	// Cannot duplicate the primary email of THIS client.
	if (client.email?.toLowerCase() === data.email.toLowerCase()) {
		throw new Error('Această adresă este deja emailul principal al clientului.');
	}

	// Per-client uniqueness only — same email may legitimately appear on multiple
	// clients (one user managing multiple companies). Cross-client checks lifted:
	// uniqueness for a client = CUI, not email/phone.
	const [existing] = await db
		.select({ id: table.clientSecondaryEmail.id })
		.from(table.clientSecondaryEmail)
		.where(
			and(
				eq(table.clientSecondaryEmail.tenantId, tenantId),
				eq(table.clientSecondaryEmail.clientId, data.clientId),
				eq(sql`lower(${table.clientSecondaryEmail.email})`, data.email.toLowerCase())
			)
		)
		.limit(1);
	if (existing) throw new Error('Acest email este deja secundar pentru acest client.');

	const now = new Date();
	const id = generateId();
	const sanitized = data.accessFlags ? sanitizeFlags(data.accessFlags) : null;
	await db.insert(table.clientSecondaryEmail).values({
		id,
		tenantId,
		clientId: data.clientId,
		email: data.email,
		label: data.label || null,
		...(sanitized
			? {
					accessFlags: JSON.stringify(sanitized),
					// Dual-write legacy notify* columns until email-sending callers migrate.
					notifyInvoices: sanitized.invoices,
					notifyTasks: sanitized.tasks,
					notifyContracts: sanitized.contracts
				}
			: {}),
		createdAt: now,
		updatedAt: now
	});

	// Optional invite email: single-use magic link so the colleague lands straight
	// in the portal. Email failure does NOT roll back the row — the caller gets
	// inviteSent=false and can surface a retry hint.
	let inviteSent = false;
	if (data.sendInvite) {
		// Rate limit pe adresa invitată (același limiter ca requestMagicLink) —
		// altfel un contact primar poate face email bombing prin invitații.
		const clientIp = event ? event.getClientAddress() : null;
		const rateLimitError = checkAuthRateLimit(data.email.toLowerCase(), clientIp);
		if (rateLimitError) {
			return { success: true, id, inviteSent: false };
		}
		let tokenId: string | null = null;
		try {
			const [tenant] = await db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, tenantId))
				.limit(1);
			if (!tenant) throw new Error('Tenant not found');

			const [clientRow] = await db
				.select({ name: table.client.name })
				.from(table.client)
				.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, tenantId)))
				.limit(1);

			// Invalidate any existing unused tokens for this email+tenant (same
			// policy as requestMagicLink) — no accumulation of live tokens.
			await db
				.update(table.magicLinkToken)
				.set({ used: true, usedAt: new Date() })
				.where(
					and(
						eq(table.magicLinkToken.email, data.email.toLowerCase()),
						eq(table.magicLinkToken.tenantId, tenantId),
						eq(table.magicLinkToken.used, false)
					)
				);

			const plainToken = generateMagicLinkToken();
			const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);
			tokenId = generateId();
			await db.insert(table.magicLinkToken).values({
				id: tokenId,
				token: hashToken(plainToken),
				email: data.email.toLowerCase(),
				clientId: data.clientId,
				matchedClientIds: JSON.stringify([data.clientId]),
				tenantId,
				expiresAt,
				used: false
			});

			const inviter = event!.locals.user!;
			const inviterName =
				`${inviter.firstName ?? ''} ${inviter.lastName ?? ''}`.trim() || inviter.email || 'Un coleg';
			await sendClientTeamInviteEmail(
				data.email,
				plainToken,
				tenant.slug,
				clientRow?.name ?? 'portal',
				inviterName
			);
			inviteSent = true;
		} catch (err) {
			// Emailul n-a plecat → tokenul nelivrat nu are de ce să rămână valid.
			if (tokenId) {
				await db
					.delete(table.magicLinkToken)
					.where(and(eq(table.magicLinkToken.id, tokenId), eq(table.magicLinkToken.tenantId, tenantId)))
					.catch(() => {});
			}
			logError('email', 'Failed to send client team invite email', {
				tenantId,
				stackTrace: serializeError(err).stack,
				metadata: { clientId: data.clientId, email: data.email }
			});
		}
	}

	return { success: true, id, inviteSent };
});

/**
 * Update per-user portal access flags for a secondary contact (admin only).
 * Persists JSON in `access_flags` and dual-writes the 3 legacy notify* columns
 * so existing email-sending logic keeps working until callers migrate.
 */
export const updateClientSecondaryEmailAccess = command(
	v.object({
		secondaryEmailId: v.pipe(v.string(), v.minLength(1)),
		accessFlags: accessFlagsSchema
	}),
	async (data) => {
		const event = getRequestEvent();
		// Look up the row first so we can derive the clientId for authorization.
		const tenantHint = event?.locals.tenant?.id ?? event?.locals.client?.tenantId;
		if (!tenantHint) throw new Error('Unauthorized');
		const [record] = await db
			.select({ id: table.clientSecondaryEmail.id, clientId: table.clientSecondaryEmail.clientId })
			.from(table.clientSecondaryEmail)
			.where(
				and(
					eq(table.clientSecondaryEmail.id, data.secondaryEmailId),
					eq(table.clientSecondaryEmail.tenantId, tenantHint)
				)
			)
			.limit(1);
		if (!record) throw new Error('Email secundar negăsit');
		await authorizeSecondaryEmailAccess(event, record.clientId);

		const flags: AccessFlags = data.accessFlags;
		// Sanity: only persist known categories.
		const sanitized = Object.fromEntries(
			ACCESS_CATEGORIES.map((c) => [c, !!flags[c]])
		) as AccessFlags;

		await db
			.update(table.clientSecondaryEmail)
			.set({
				accessFlags: JSON.stringify(sanitized),
				notifyInvoices: sanitized.invoices,
				notifyTasks: sanitized.tasks,
				notifyContracts: sanitized.contracts,
				updatedAt: new Date()
			})
			.where(and(eq(table.clientSecondaryEmail.id, data.secondaryEmailId), eq(table.clientSecondaryEmail.tenantId, tenantHint)));

		return { success: true };
	}
);

/** Delete a secondary email */
export const deleteClientSecondaryEmail = command(
	v.object({ secondaryEmailId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ secondaryEmailId }) => {
		const event = getRequestEvent();
		const tenantHint = event?.locals.tenant?.id ?? event?.locals.client?.tenantId;
		if (!tenantHint) throw new Error('Unauthorized');
		const [record] = await db
			.select()
			.from(table.clientSecondaryEmail)
			.where(
				and(
					eq(table.clientSecondaryEmail.id, secondaryEmailId),
					eq(table.clientSecondaryEmail.tenantId, tenantHint)
				)
			)
			.limit(1);
		if (!record) throw new Error('Email secundar negăsit');
		await authorizeSecondaryEmailAccess(event, record.clientId);

		await db
			.delete(table.clientSecondaryEmail)
			.where(and(eq(table.clientSecondaryEmail.id, secondaryEmailId), eq(table.clientSecondaryEmail.tenantId, tenantHint)));

		// Revocation must also drop the contact's client_user link (created at
		// their first portal login) — hooks authorize portal requests purely on
		// that row's existence, so leaving it orphaned keeps portal access, team
		// visibility and company selection alive indefinitely. The primary link
		// (client.email holder) is never touched here.
		const removedEmail = record.email.trim().toLowerCase();
		const [linkedUser] = await db
			.select({ id: table.user.id })
			.from(table.user)
			.where(eq(sql`lower(${table.user.email})`, removedEmail))
			.limit(1);
		if (linkedUser) {
			const [clientRow] = await db
				.select({ email: table.client.email })
				.from(table.client)
				.where(and(eq(table.client.id, record.clientId), eq(table.client.tenantId, tenantHint)))
				.limit(1);
			const isAlsoPrimaryEmail =
				(clientRow?.email || '').trim().toLowerCase() === removedEmail;

			if (!isAlsoPrimaryEmail) {
				const [cu] = await db
					.select({ id: table.clientUser.id, isPrimary: table.clientUser.isPrimary })
					.from(table.clientUser)
					.where(
						and(
							eq(table.clientUser.userId, linkedUser.id),
							eq(table.clientUser.clientId, record.clientId),
							eq(table.clientUser.tenantId, tenantHint)
						)
					)
					.limit(1);
				if (cu && !cu.isPrimary) {
					await db.transaction(async (tx) => {
						await deleteClientUserWithFKs(tx, cu.id);
					});
				}
			}
		}

		return { success: true };
	}
);
