import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { sendClientTeamInviteEmail } from '$lib/server/email';
import { logError } from '$lib/server/logger';
import { serializeError } from '$lib/server/error-serializer';
import { requireStaff } from '$lib/server/get-actor';
import { checkAuthRateLimit } from '$lib/server/rate-limiter';
import { generateMagicLinkToken, hashToken } from '$lib/server/client-auth';
import {
	ACCESS_CATEGORIES,
	parseAccessFlags,
	type AccessFlags
} from '$lib/server/portal-access';

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
				interviuri: false
			};
			return { ...r, accessFlagsResolved: flags };
		});
	}
);

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

		return { success: true };
	}
);
