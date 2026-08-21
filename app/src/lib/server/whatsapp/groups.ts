/**
 * Grupuri WhatsApp → membri cu număr de telefon.
 *
 * De ce există: contactele secundare ale unui client n-au telefon în CRM, iar
 * fără telefon nu capătă avatar. În grupurile WhatsApp cu clientul, numerele
 * membrilor sunt vizibile, deci le putem lega în `user_whatsapp_link` fără să le
 * copiem de mână din telefon.
 *
 * Participanții vin de la Baileys ca LID-uri opace (`84027092512961@lid`) cu
 * `phoneNumber` atașat alături; de acolo scoatem E.164.
 *
 * Importurile spre session-manager sunt lazy (ca în avatar-fetcher.ts): acela
 * trage DB-ul și `$env`, iar `nameMatchScore` trebuie testabil fără SvelteKit.
 */
import { jidToE164 } from './phone';

export type GroupMember = {
	phone: string | null;
	rawId: string;
	pushName: string | null;
	admin: 'admin' | 'superadmin' | null;
};

export type GroupSummary = {
	id: string;
	subject: string;
	size: number;
	members: GroupMember[];
};

type ParticipantLike = {
	id: string;
	phoneNumber?: string;
	lid?: string;
	name?: string;
	notify?: string;
	admin?: 'admin' | 'superadmin' | null;
};

type GroupLike = {
	id: string;
	subject: string;
	size?: number;
	participants: ParticipantLike[];
};

export class WhatsappNotConnectedError extends Error {
	constructor() {
		super('Sesiunea WhatsApp nu e conectată pe această instanță.');
		this.name = 'WhatsappNotConnectedError';
	}
}

function participantPhone(p: ParticipantLike): string | null {
	for (const c of [p.phoneNumber, p.id]) {
		if (!c || !c.endsWith('@s.whatsapp.net')) continue;
		try {
			return jidToE164(c.split(':')[0]);
		} catch {
			// încearcă următorul candidat
		}
	}
	return null;
}

function toSummary(g: GroupLike): GroupSummary {
	return {
		id: g.id,
		subject: g.subject ?? '',
		size: g.size ?? g.participants.length,
		members: g.participants.map((p) => ({
			phone: participantPhone(p),
			rawId: p.id,
			pushName: p.notify ?? p.name ?? null,
			admin: p.admin ?? null
		}))
	};
}

/** Toate grupurile în care e contul conectat. Aruncă WhatsappNotConnectedError fără sesiune. */
export async function listGroups(tenantId: string): Promise<GroupSummary[]> {
	const { getActiveSession } = await import('./session-manager');
	const session = getActiveSession(tenantId);
	if (!session) throw new WhatsappNotConnectedError();
	const all = await session.sock.groupFetchAllParticipating();
	return Object.values(all as Record<string, GroupLike>).map(toSummary);
}

/**
 * Are numărul cont de WhatsApp?
 *
 * `null` înseamnă „nu știm": sesiunea e deconectată sau WhatsApp n-a răspuns.
 * Apelantul salvează atunci numărul nverificat, în loc să blocheze omul pentru
 * o defecțiune de partea noastră. Se cheamă o singură dată, la salvare: trafic
 * inutil spre WhatsApp arată a scanare și riscă banarea sesiunii.
 */
export async function isOnWhatsapp(tenantId: string, phoneE164: string): Promise<boolean | null> {
	const { getActiveSession } = await import('./session-manager');
	const session = getActiveSession(tenantId);
	if (!session) return null;
	try {
		const results = await session.sock.onWhatsApp(phoneE164);
		const hit = results?.find((r) => r.jid?.startsWith(phoneE164.replace('+', '')));
		return hit ? !!hit.exists : (results?.[0]?.exists ?? false);
	} catch {
		return null;
	}
}

/** Un singur grup, după JID. */
export async function getGroup(tenantId: string, groupJid: string): Promise<GroupSummary> {
	const { getActiveSession } = await import('./session-manager');
	const session = getActiveSession(tenantId);
	if (!session) throw new WhatsappNotConnectedError();
	const meta = await session.sock.groupMetadata(groupJid);
	return toSummary(meta as unknown as GroupLike);
}

/**
 * Potrivire după nume între un membru de grup și un contact CRM.
 * Întoarce un scor 0–1; 0 = nicio potrivire. Folosit doar ca PROPUNERE — decizia
 * o ia omul, fiindcă „George D" și „George Lucky Studio" pot fi persoane diferite.
 */
export function nameMatchScore(pushName: string | null, crmName: string | null): number {
	const a = tokens(pushName);
	const b = tokens(crmName);
	if (a.length === 0 || b.length === 0) return 0;
	const common = a.filter((t) => b.includes(t));
	if (common.length === 0) return 0;
	// Două token-uri comune (nume + prenume) = potrivire tare; unul singur = slabă.
	return common.length >= 2 ? 1 : 0.5;
}

function tokens(s: string | null): string[] {
	if (!s) return [];
	return s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '') // fără diacritice: Mădălina → Madalina
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length >= 3); // ignoră „&", „de", inițiale
}
