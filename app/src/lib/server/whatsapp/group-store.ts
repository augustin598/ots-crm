/**
 * Grupurile WhatsApp urmărite: ce se stochează, ce apare în inbox, ce se propune.
 *
 * De ce e nevoie de o listă bifată: contul e în zeci de grupuri, unele cu peste o
 * mie de membri. Fără o listă, inboxul devine de necitit, iar media lor umple
 * stocarea. Doar grupurile bifate ajung în `whatsapp_message`.
 *
 * Verificarea „e bifat?" se face pe fiecare mesaj primit, deci trece printr-un
 * cache în memorie cu viață scurtă, nu prin baza de date. Cache-ul se golește la
 * bifare, iar TTL-ul acoperă instanțele care n-au făcut ele schimbarea.
 *
 * Metadatele de grup se cer rar și doar la nevoie: `groupFetchAllParticipating`
 * n-are niciun limitator în Baileys, iar traficul des spre WhatsApp arată a
 * scanare și riscă banarea sesiunii.
 */
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logWarning } from '$lib/server/logger';
import { tryToE164 } from './phone';
import { suggestGroupClient, type GroupClientSuggestion } from './group-jid';
import type { GroupSummary } from './groups';

const WATCHED_TTL_MS = 60_000;
const METADATA_TTL_MS = 60_000;
const PROFILE_URL_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 15_000;

export type GroupParticipantSnapshot = {
	rawId: string;
	phone: string | null;
	pushName: string | null;
};

type WatchedEntry = {
	expiresAt: number;
	/** JID de grup → fotografia membrilor, pentru traducerea LID → telefon. */
	byJid: Map<string, GroupParticipantSnapshot[]>;
};

type MetadataEntry = { expiresAt: number; groups: GroupSummary[] };

const WATCHED_SYMBOL = Symbol.for('ots_crm_whatsapp_watched_groups');
const METADATA_SYMBOL = Symbol.for('ots_crm_whatsapp_group_metadata');

type GlobalCaches = typeof globalThis & {
	[WATCHED_SYMBOL]?: Map<string, WatchedEntry>;
	[METADATA_SYMBOL]?: Map<string, MetadataEntry>;
};

const g = globalThis as GlobalCaches;
const watchedCache = (g[WATCHED_SYMBOL] ??= new Map<string, WatchedEntry>());
const metadataCache = (g[METADATA_SYMBOL] ??= new Map<string, MetadataEntry>());

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export function invalidateWatchedGroups(tenantId: string): void {
	watchedCache.delete(tenantId);
}

export function invalidateGroupMetadata(tenantId: string): void {
	metadataCache.delete(tenantId);
}

async function loadWatched(tenantId: string): Promise<WatchedEntry> {
	const cached = watchedCache.get(tenantId);
	if (cached && cached.expiresAt > Date.now()) return cached;

	const rows = await db
		.select({
			groupJid: table.whatsappGroup.groupJid,
			participantsJson: table.whatsappGroup.participantsJson
		})
		.from(table.whatsappGroup)
		.where(and(eq(table.whatsappGroup.tenantId, tenantId), eq(table.whatsappGroup.watched, true)));

	const entry: WatchedEntry = {
		expiresAt: Date.now() + WATCHED_TTL_MS,
		byJid: new Map(rows.map((r) => [r.groupJid, r.participantsJson ?? []]))
	};
	watchedCache.set(tenantId, entry);
	return entry;
}

/** E grupul bifat pentru inbox? Cheia de filtrare a mesajelor la intrare. */
export async function isWatchedGroup(tenantId: string, groupJid: string): Promise<boolean> {
	const entry = await loadWatched(tenantId);
	return entry.byJid.has(groupJid);
}

/**
 * Traducerea JID brut → telefon pentru un grup, din fotografia luată la bifare.
 * Nu cere nimic de la WhatsApp. Întoarce o funcție sincronă, ca să se poată da
 * mai departe către `resolveGroupSender`, care rămâne pur.
 */
export async function participantPhoneLookup(
	tenantId: string,
	groupJid: string
): Promise<(rawId: string) => string | null> {
	const entry = await loadWatched(tenantId);
	const members = entry.byJid.get(groupJid);
	if (!members || members.length === 0) return () => null;

	const byRawId = new Map<string, string | null>();
	for (const m of members) {
		byRawId.set(m.rawId, m.phone);
		byRawId.set(m.rawId.split(':')[0], m.phone);
	}
	return (rawId: string) => byRawId.get(rawId) ?? byRawId.get(rawId.split(':')[0]) ?? null;
}

/**
 * Toate grupurile cunoscute, cu tot ce ține de afișare. Folosit de inbox.
 *
 * Nu doar cele bifate: o conversație care a rămas în listă după debifare trebuie
 * să-și păstreze numele și numărul de membri, altfel devine „Grup" fără explicație.
 */
export async function listStoredGroupRows(tenantId: string) {
	return db
		.select({
			groupJid: table.whatsappGroup.groupJid,
			subject: table.whatsappGroup.subject,
			participantCount: table.whatsappGroup.participantCount,
			watched: table.whatsappGroup.watched,
			clientId: table.whatsappGroup.clientId,
			avatarPath: table.whatsappGroup.avatarPath,
			participantsJson: table.whatsappGroup.participantsJson
		})
		.from(table.whatsappGroup)
		.where(eq(table.whatsappGroup.tenantId, tenantId));
}

export async function getStoredGroup(tenantId: string, groupJid: string) {
	const [row] = await db
		.select()
		.from(table.whatsappGroup)
		.where(
			and(eq(table.whatsappGroup.tenantId, tenantId), eq(table.whatsappGroup.groupJid, groupJid))
		)
		.limit(1);
	return row ?? null;
}

/**
 * Grupurile de la WhatsApp, cu un cache scurt.
 *
 * `groupFetchAllParticipating` întoarce metadatele tuturor grupurilor la un
 * singur apel și n-are niciun limitator, deci redeschiderea dialogului nu are
 * voie s-o cheme de fiecare dată.
 */
export async function fetchLiveGroups(tenantId: string): Promise<GroupSummary[]> {
	const cached = metadataCache.get(tenantId);
	if (cached && cached.expiresAt > Date.now()) return cached.groups;

	const { listGroups } = await import('./groups');
	const groups = await listGroups(tenantId);
	metadataCache.set(tenantId, { expiresAt: Date.now() + METADATA_TTL_MS, groups });
	return groups;
}

function toSnapshot(summary: GroupSummary): GroupParticipantSnapshot[] {
	return summary.members.map((m) => ({ rawId: m.rawId, phone: m.phone, pushName: m.pushName }));
}

/** Scrie subiectul, numărul de membri și fotografia membrilor pentru un grup. */
export async function upsertGroupMetadata(
	tenantId: string,
	summary: GroupSummary
): Promise<void> {
	const now = new Date();
	const existing = await getStoredGroup(tenantId, summary.id);
	if (existing) {
		await db
			.update(table.whatsappGroup)
			.set({
				subject: summary.subject,
				participantCount: summary.size,
				participantsJson: toSnapshot(summary),
				lastSyncedAt: now,
				updatedAt: now
			})
			.where(eq(table.whatsappGroup.id, existing.id));
	} else {
		await db
			.insert(table.whatsappGroup)
			.values({
				id: generateId(),
				tenantId,
				groupJid: summary.id,
				subject: summary.subject,
				participantCount: summary.size,
				participantsJson: toSnapshot(summary),
				lastSyncedAt: now,
				createdAt: now,
				updatedAt: now
			})
			.onConflictDoNothing();
	}
	invalidateWatchedGroups(tenantId);
}

export async function setGroupWatched(
	tenantId: string,
	summary: GroupSummary,
	watched: boolean
): Promise<void> {
	await upsertGroupMetadata(tenantId, summary);
	await db
		.update(table.whatsappGroup)
		.set({ watched, updatedAt: new Date() })
		.where(
			and(eq(table.whatsappGroup.tenantId, tenantId), eq(table.whatsappGroup.groupJid, summary.id))
		);
	invalidateWatchedGroups(tenantId);
}

export async function setGroupClient(
	tenantId: string,
	groupJid: string,
	clientId: string | null
): Promise<void> {
	await db
		.update(table.whatsappGroup)
		.set({ clientId, updatedAt: new Date() })
		.where(
			and(eq(table.whatsappGroup.tenantId, tenantId), eq(table.whatsappGroup.groupJid, groupJid))
		);
	invalidateWatchedGroups(tenantId);
}

/**
 * Ce client are cei mai mulți oameni în grup, pentru fiecare grup deodată.
 *
 * Numerele vin din `client.phone` și din `user_whatsapp_link`, ambele citite o
 * singură dată pentru tot tenantul, ca dialogul să nu facă o interogare pe grup.
 */
export async function suggestClientsForGroups(
	tenantId: string,
	groups: GroupSummary[]
): Promise<Map<string, GroupClientSuggestion>> {
	const clients = await db
		.select({ id: table.client.id, name: table.client.name, phone: table.client.phone })
		.from(table.client)
		.where(eq(table.client.tenantId, tenantId));

	const clientByPhone = new Map<string, { id: string; name: string }>();
	for (const c of clients) {
		if (!c.phone) continue;
		const normalized = tryToE164(c.phone);
		if (normalized) clientByPhone.set(normalized, { id: c.id, name: c.name });
	}

	// Numerele puse de utilizatori din portal nu intră în propunere: nimeni n-a
	// dovedit că sunt ale lor, iar un număr revendicat greșit ar muta firul unui
	// grup în fișa altui client. Rămân doar legăturile făcute de agenție.
	const links = await db
		.select({
			phoneE164: table.userWhatsappLink.phoneE164,
			userId: table.userWhatsappLink.userId
		})
		.from(table.userWhatsappLink)
		.where(
			and(
				eq(table.userWhatsappLink.tenantId, tenantId),
				ne(table.userWhatsappLink.source, 'self_service')
			)
		);

	if (links.length > 0) {
		// Toate legăturile tenantului dintr-o dată. Un `inArray` peste lista de
		// utilizatori ar putea depăși limita de parametri a SQLite pe tenanții mari.
		const clientUsers = await db
			.select({ userId: table.clientUser.userId, clientId: table.clientUser.clientId })
			.from(table.clientUser)
			.where(eq(table.clientUser.tenantId, tenantId));
		const clientById = new Map(clients.map((c) => [c.id, c]));
		const clientByUser = new Map(clientUsers.map((cu) => [cu.userId, cu.clientId]));
		for (const link of links) {
			if (clientByPhone.has(link.phoneE164)) continue;
			const clientId = clientByUser.get(link.userId);
			const client = clientId ? clientById.get(clientId) : null;
			if (client) clientByPhone.set(link.phoneE164, { id: client.id, name: client.name });
		}
	}

	const out = new Map<string, GroupClientSuggestion>();
	for (const group of groups) {
		const suggestion = suggestGroupClient(
			group.members.map((m) => m.phone),
			clientByPhone
		);
		if (suggestion) out.set(group.id, suggestion);
	}
	return out;
}

function groupAvatarKey(tenantId: string, groupJid: string): string {
	return `${tenantId}/whatsapp/group-avatars/${groupJid.replace(/[^A-Za-z0-9_-]/g, '_')}.jpg`;
}

/**
 * Poza grupului, adusă o singură dată la bifare.
 *
 * Un apel per grup bifat, deci trafic neglijabil. Eșecul e normal (grup fără
 * poză, confidențialitate) și nu întrerupe bifarea.
 */
export async function fetchGroupAvatar(tenantId: string, groupJid: string): Promise<void> {
	const { getActiveSession } = await import('./session-manager');
	const session = getActiveSession(tenantId);
	if (!session) return;

	let url: string | undefined;
	try {
		url = await session.sock.profilePictureUrl(groupJid, 'preview', PROFILE_URL_TIMEOUT_MS);
	} catch {
		return; // fără poză sau blocat de confidențialitate
	}
	if (!url) return;

	let buf: Buffer;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!res.ok) return;
		buf = Buffer.from(await res.arrayBuffer());
	} catch (err) {
		logWarning('whatsapp', 'group avatar download failed', {
			tenantId,
			metadata: { groupJid, err: err instanceof Error ? err.message : String(err) }
		});
		return;
	}

	const { detectImageMime } = await import('./image-validation');
	const mime = detectImageMime(buf);
	if (!mime) return;

	const key = groupAvatarKey(tenantId, groupJid);
	const { putStable } = await import('./minio-helpers');
	await putStable(key, buf, mime);

	await db
		.update(table.whatsappGroup)
		.set({ avatarPath: key, avatarMimeType: mime, avatarFetchedAt: new Date(), updatedAt: new Date() })
		.where(
			and(eq(table.whatsappGroup.tenantId, tenantId), eq(table.whatsappGroup.groupJid, groupJid))
		);
}
