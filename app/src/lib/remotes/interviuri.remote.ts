import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { requireStaff } from '$lib/server/get-actor';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, asc, isNull } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { DEFAULT_CHANNELS, NESPECIFICAT, classifySource } from '$lib/server/interviuri/classify';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

// Paletă pentru canale noi adăugate din UI (când nu se dă o culoare).
const NEW_CHANNEL_COLORS = [
	'#0ea5e9',
	'#d946ef',
	'#f97316',
	'#14b8a6',
	'#eab308',
	'#6366f1',
	'#ec4899',
	'#84cc16'
];

function requireCtx() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	return event;
}

/**
 * Context de scriere. În portalul clientului, clientScopeId e clientul din
 * sesiune: interviurile create primesc FORȚAT acel client_id, iar update/delete
 * ating doar rândurile care îi aparțin deja. Un clientId venit din UI e ignorat
 * — delimitarea între clienți nu depinde niciodată de payload.
 */
async function requireWriteCtx() {
	const event = requireCtx();
	const tenantId = event.locals.tenant!.id;
	if (event.locals.isClientUser && event.locals.client) {
		return { event, tenantId, clientScopeId: event.locals.client.id as string };
	}
	await requireStaff(event);
	return { event, tenantId, clientScopeId: null as string | null };
}

/** Seed-uiește canalele-sistem pentru tenant la prima folosire (idempotent). */
async function ensureChannelsSeeded(tenantId: string) {
	const existing = await db
		.select({ id: table.interviewChannel.id })
		.from(table.interviewChannel)
		.where(eq(table.interviewChannel.tenantId, tenantId))
		.limit(1);
	if (existing.length > 0) return;

	const now = new Date();
	await db.insert(table.interviewChannel).values(
		DEFAULT_CHANNELS.map((c) => ({
			id: generateId(),
			tenantId,
			name: c.name,
			color: c.color,
			icon: c.icon,
			isSystem: true,
			sortOrder: c.sortOrder,
			createdAt: now,
			updatedAt: now
		}))
	);
}

async function channelsForTenant(tenantId: string) {
	await ensureChannelsSeeded(tenantId);
	return db
		.select()
		.from(table.interviewChannel)
		.where(eq(table.interviewChannel.tenantId, tenantId))
		.orderBy(asc(table.interviewChannel.sortOrder), asc(table.interviewChannel.name));
}

/**
 * Validează că clientul aparține tenantului curent. Întoarce null pentru
 * '' / undefined (interviu fără client). Fără această validare, un clientId
 * venit din UI ar putea agăța interviul de clientul altui tenant.
 */
async function resolveClientId(
	tenantId: string,
	clientId: string | undefined
): Promise<string | null> {
	if (!clientId) return null;
	const found = await db
		.select({ id: table.client.id })
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	if (found.length === 0) throw new Error('Clientul selectat nu există');
	return clientId;
}

/** Rezolvă channelId: explicit (validat pe tenant) sau prin clasificarea sursei. */
async function resolveChannelId(
	tenantId: string,
	channelId: string | undefined,
	sursa: string | undefined
): Promise<string> {
	const channels = await channelsForTenant(tenantId);
	if (channelId) {
		const found = channels.find((c) => c.id === channelId);
		if (found) return found.id;
	}
	const name = classifySource(sursa);
	const byName =
		channels.find((c) => c.name === name) ?? channels.find((c) => c.name === NESPECIFICAT);
	if (!byName) throw new Error('Canalul nu a putut fi rezolvat');
	return byName.id;
}

// ===================== Queries =====================

export const getInterviewChannels = query(async () => {
	const event = requireCtx();
	// Portal: userii de tip client pot citi canalele (doar metadate de afișare);
	// orice alt user trece prin requireStaff.
	if (!(event.locals.isClientUser && event.locals.client)) {
		await requireStaff(event);
	}
	return channelsForTenant(event.locals.tenant!.id);
});

export const getInterviews = query(
	v.optional(v.object({ clientId: v.optional(v.pipe(v.string(), v.minLength(1))) })),
	async (filters) => {
		const event = requireCtx();
		const tenantId = event.locals.tenant!.id;

		let conditions = eq(table.interview.tenantId, tenantId);
		if (event.locals.isClientUser && event.locals.client) {
			// Portal: fiecare client își vede DOAR interviurile lui — scoping forțat
			// din sesiune, filtrul din UI e ignorat (pattern getSeoLinks).
			conditions = and(
				conditions,
				eq(table.interview.clientId, event.locals.client.id)
			) as typeof conditions;
		} else {
			await requireStaff(event);
			if (filters?.clientId) {
				conditions = and(conditions, eq(table.interview.clientId, filters.clientId)) as typeof conditions;
			}
		}
		await ensureChannelsSeeded(tenantId);

		const rows = await db
			.select({
				id: table.interview.id,
				nume: table.interview.nume,
				dataInterviu: table.interview.dataInterviu,
				dataInceput: table.interview.dataInceput,
				dataSfarsit: table.interview.dataSfarsit,
				studio: table.interview.studio,
				sursa: table.interview.sursa,
				status: table.interview.status,
				observatii: table.interview.observatii,
				channelId: table.interview.channelId,
				channelName: table.interviewChannel.name,
				channelColor: table.interviewChannel.color,
				channelIcon: table.interviewChannel.icon,
				clientId: table.interview.clientId,
				clientName: table.client.name
			})
			.from(table.interview)
			.leftJoin(table.interviewChannel, eq(table.interview.channelId, table.interviewChannel.id))
			.leftJoin(
				table.client,
				and(eq(table.interview.clientId, table.client.id), eq(table.client.tenantId, tenantId))
			)
			.where(conditions);

		return rows;
	}
);

// ===================== Commands =====================

const interviewSchema = v.object({
	nume: v.pipe(v.string(), v.minLength(1, 'Numele este obligatoriu'), v.maxLength(255)),
	clientId: v.optional(v.pipe(v.string(), v.maxLength(64))),
	dataInterviu: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/, 'Dată invalidă')),
	dataInceput: v.optional(v.pipe(v.string(), v.maxLength(10))),
	dataSfarsit: v.optional(v.pipe(v.string(), v.maxLength(10))),
	studio: v.optional(v.pipe(v.string(), v.maxLength(100))),
	sursa: v.optional(v.pipe(v.string(), v.maxLength(500))),
	channelId: v.optional(v.pipe(v.string(), v.maxLength(64))),
	status: v.optional(v.picklist(['admisa', 'respinsa', 'in_evaluare'])),
	observatii: v.optional(v.pipe(v.string(), v.maxLength(2000)))
});

function validateDates(dataInterviu: string, dataInceput?: string) {
	if (dataInceput && dataInceput >= '1000-01-01' && dataInceput < dataInterviu) {
		throw new Error('Începutul colaborării nu poate fi înainte de data interviului');
	}
}

export const createInterview = command(interviewSchema, async (data) => {
	const { tenantId, clientScopeId } = await requireWriteCtx();

	validateDates(data.dataInterviu, data.dataInceput);
	const clientId = clientScopeId ?? (await resolveClientId(tenantId, data.clientId));
	const channelId = await resolveChannelId(tenantId, data.channelId, data.sursa);

	const id = generateId();
	const now = new Date();
	await db.insert(table.interview).values({
		id,
		tenantId,
		clientId,
		nume: data.nume.trim(),
		dataInterviu: data.dataInterviu,
		dataInceput: data.dataInceput || null,
		dataSfarsit: data.dataSfarsit || null,
		studio: data.studio?.trim() || 'Heylux Studio',
		sursa: data.sursa?.trim() || null,
		channelId,
		status: data.status || 'in_evaluare',
		observatii: data.observatii?.trim() || null,
		createdAt: now,
		updatedAt: now
	});
	return { success: true, id };
});

const updateSchema = v.object({ ...interviewSchema.entries, id: v.pipe(v.string(), v.minLength(1)) });

export const updateInterview = command(updateSchema, async (data) => {
	const { tenantId, clientScopeId } = await requireWriteCtx();

	validateDates(data.dataInterviu, data.dataInceput);
	const clientId = clientScopeId ?? (await resolveClientId(tenantId, data.clientId));
	const channelId = await resolveChannelId(tenantId, data.channelId, data.sursa);

	// Portalul poate atinge doar rândurile propriului client.
	let where = and(eq(table.interview.id, data.id), eq(table.interview.tenantId, tenantId));
	if (clientScopeId) {
		where = and(where, eq(table.interview.clientId, clientScopeId));
	}

	const updated = await db
		.update(table.interview)
		.set({
			clientId,
			nume: data.nume.trim(),
			dataInterviu: data.dataInterviu,
			dataInceput: data.dataInceput || null,
			dataSfarsit: data.dataSfarsit || null,
			studio: data.studio?.trim() || 'Heylux Studio',
			sursa: data.sursa?.trim() || null,
			channelId,
			status: data.status || 'in_evaluare',
			observatii: data.observatii?.trim() || null,
			updatedAt: new Date()
		})
		.where(where)
		.returning({ id: table.interview.id });
	if (updated.length === 0) throw new Error('Interviul nu a fost găsit');
	return { success: true };
});

/**
 * Asociază în masă interviurile tenantului cu un client (mecanismul folosit
 * pentru datele importate istoric, fără client). Cu onlyUnassigned=true
 * atinge doar rândurile cu client_id NULL.
 */
export const assignInterviewsClient = command(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1, 'Clientul este obligatoriu')),
		onlyUnassigned: v.boolean()
	}),
	async ({ clientId, onlyUnassigned }) => {
		const event = requireCtx();
		await requireStaff(event);
		const tenantId = event.locals.tenant!.id;
		await resolveClientId(tenantId, clientId);

		let conditions = eq(table.interview.tenantId, tenantId);
		if (onlyUnassigned) {
			conditions = and(conditions, isNull(table.interview.clientId)) as typeof conditions;
		}
		const updated = await db
			.update(table.interview)
			.set({ clientId, updatedAt: new Date() })
			.where(conditions)
			.returning({ id: table.interview.id });
		return { success: true, count: updated.length };
	}
);

export const deleteInterview = command(v.pipe(v.string(), v.minLength(1)), async (id) => {
	const { tenantId, clientScopeId } = await requireWriteCtx();

	let where = and(eq(table.interview.id, id), eq(table.interview.tenantId, tenantId));
	if (clientScopeId) {
		where = and(where, eq(table.interview.clientId, clientScopeId));
	}

	const deleted = await db.delete(table.interview).where(where).returning({ id: table.interview.id });
	if (deleted.length === 0) throw new Error('Interviul nu a fost găsit');
	return { success: true };
});

const channelSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Numele canalului este obligatoriu'), v.maxLength(60)),
	color: v.optional(v.pipe(v.string(), v.regex(/^#[0-9a-fA-F]{6}$/, 'Culoare hex invalidă'))),
	icon: v.optional(v.pipe(v.string(), v.maxLength(40)))
});

export const createInterviewChannel = command(channelSchema, async (data) => {
	const event = requireCtx();
	await requireStaff(event);
	const tenantId = event.locals.tenant!.id;

	const channels = await channelsForTenant(tenantId);
	const name = data.name.trim();
	const existing = channels.find((c) => c.name.toLowerCase() === name.toLowerCase());
	if (existing) return { success: true, id: existing.id, name: existing.name };

	const color = data.color || NEW_CHANNEL_COLORS[channels.length % NEW_CHANNEL_COLORS.length];
	const id = generateId();
	const now = new Date();
	// Se inserează înainte de „Nespecificat" (sortOrder 999).
	await db.insert(table.interviewChannel).values({
		id,
		tenantId,
		name,
		color,
		icon: data.icon || 'megaphone',
		isSystem: false,
		sortOrder: 500 + channels.length,
		createdAt: now,
		updatedAt: now
	});
	return { success: true, id, name, color };
});
