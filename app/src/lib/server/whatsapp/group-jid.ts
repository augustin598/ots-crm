/**
 * Partea pură a suportului pentru grupuri: recunoașterea JID-urilor, expeditorul
 * unui mesaj de grup și propunerea de client.
 *
 * Stă separat de `group-store.ts` fiindcă acela trage baza de date și sesiunea
 * Baileys. Aici nu se importă nimic din afara modulului, deci se poate testa
 * direct, ca `nameMatchScore` din `groups.ts`.
 */
import { jidToE164 } from './phone';

const GROUP_SUFFIX = '@g.us';
const PN_SUFFIX = '@s.whatsapp.net';

/** JID de grup („120363…@g.us"). */
export function isGroupJid(jid: string | null | undefined): boolean {
	return !!jid && jid.endsWith(GROUP_SUFFIX);
}

/** JID de telefon („40722123456@s.whatsapp.net"), spre deosebire de LID sau grup. */
export function isPhoneJid(jid: string | null | undefined): boolean {
	return !!jid && jid.endsWith(PN_SUFFIX);
}

/**
 * Difuzările, canalele și „status@broadcast" rămân excluse și după ce grupurile
 * intră: n-au firul unei conversații.
 */
export function isIgnorableChatJid(jid: string | null | undefined): boolean {
	if (!jid) return true;
	return jid.endsWith('@broadcast') || jid.endsWith('@newsletter');
}

export type GroupSender = {
	/** JID-ul brut, așa cum vine de la WhatsApp. Poate fi LID. */
	jid: string | null;
	phoneE164: string | null;
	pushName: string | null;
};

type MessageKeyLike = {
	fromMe?: boolean | null;
	participant?: string | null;
	/** Numărul pus de Baileys alături, când grupul e adresat pe LID. */
	participantAlt?: string | null;
};

type MessageLike = {
	key?: MessageKeyLike | null;
	pushName?: string | null;
};

/**
 * Cine a scris mesajul într-un grup.
 *
 * WhatsApp trimite tot mai des LID-uri opace („84027092512961@lid") în loc de
 * numărul de telefon. Când cheia mesajului n-aduce un JID de telefon, căutăm
 * LID-ul în fotografia membrilor luată la bifarea grupului, prin `phoneForRawId`.
 * Cerem metadate proaspete de la WhatsApp separat și rar, fiindcă traficul des
 * arată a scanare și riscă banarea sesiunii.
 *
 * Telefonul lipsă nu e o eroare: numele afișat ajunge ca să se vadă cine a scris.
 */
export function resolveGroupSender(
	msg: MessageLike,
	phoneForRawId: (rawId: string) => string | null = () => null
): GroupSender {
	const key = msg.key ?? {};
	const candidates = [key.participantAlt, key.participant];
	const jid = candidates.find((c): c is string => !!c) ?? null;

	let phoneE164: string | null = null;
	for (const candidate of candidates) {
		if (candidate && isPhoneJid(candidate)) {
			phoneE164 = jidToE164(candidate.split(':')[0]);
			break;
		}
	}
	if (!phoneE164) {
		for (const candidate of candidates) {
			if (!candidate) continue;
			const fromSnapshot = phoneForRawId(candidate);
			if (fromSnapshot) {
				phoneE164 = fromSnapshot;
				break;
			}
		}
	}

	// La mesajele proprii, `pushName` e numele contului nostru. Firul le arată
	// oricum ca „Tu", deci nu-l stocăm ca expeditor.
	const pushName = key.fromMe ? null : msg.pushName?.trim() || null;
	return { jid, phoneE164, pushName };
}

/**
 * Mențiunile vin în text ca număr brut, „@84027092512961", fiindcă WhatsApp ține
 * numele separat, în metadatele mesajului. Aplicația de pe telefon îl înlocuiește
 * la afișare; noi trebuie să facem la fel, altfel firul arată cifre în loc de
 * oameni. Textul stocat rămâne cel original.
 */
const MENTION_RE = /@(\d{5,})/g;

export function resolveMentions(
	body: string | null,
	labelForDigits: (digits: string) => string | null
): string | null {
	if (!body || !body.includes('@')) return body;
	return body.replace(MENTION_RE, (whole, digits: string) => {
		const label = labelForDigits(digits);
		return label ? `@${label}` : whole;
	});
}

export type BodyPart = { type: 'text' | 'mention'; value: string };

/**
 * Aceeași traducere, dar tăiată în bucăți, ca interfața să poată desena mențiunea
 * ca pastilă fără să insereze HTML în text. `null` înseamnă „nimic de evidențiat",
 * iar apelantul afișează textul simplu.
 */
export function splitMentions(
	body: string | null,
	labelForDigits: (digits: string) => string | null
): BodyPart[] | null {
	if (!body || !body.includes('@')) return null;

	const parts: BodyPart[] = [];
	let cursor = 0;
	for (const match of body.matchAll(MENTION_RE)) {
		const label = labelForDigits(match[1]);
		if (!label || match.index === undefined) continue;
		if (match.index > cursor) parts.push({ type: 'text', value: body.slice(cursor, match.index) });
		parts.push({ type: 'mention', value: `@${label}` });
		cursor = match.index + match[0].length;
	}
	if (parts.length === 0) return null;
	if (cursor < body.length) parts.push({ type: 'text', value: body.slice(cursor) });
	return parts;
}

/**
 * Cifrele dintr-o mențiune pot fi ale LID-ului sau ale telefonului, după cum a
 * scris WhatsApp mesajul, deci le indexăm pe amândouă. Numele vine din contacte;
 * dacă lipsește, telefonul e tot mai bun decât un șir de cifre fără sens.
 */
export function buildMentionLookup(
	participants: Array<{ rawId: string; phone: string | null }>,
	nameForPhone: (phone: string) => string | null = () => null
): (digits: string) => string | null {
	const byDigits = new Map<string, string>();
	for (const p of participants) {
		const label = (p.phone && nameForPhone(p.phone)) || p.phone;
		if (!label) continue;
		const rawDigits = p.rawId.split('@')[0].split(':')[0];
		if (rawDigits) byDigits.set(rawDigits, label);
		if (p.phone) byDigits.set(p.phone.replace(/\D/g, ''), label);
	}
	return (digits: string) => byDigits.get(digits) ?? null;
}

export type GroupClientSuggestion = {
	clientId: string;
	clientName: string;
	/** Câte numere din grup aparțin clientului. */
	matches: number;
};

/**
 * Ce client are cei mai mulți oameni în grup.
 *
 * Rămâne o propunere, nu o legare automată: un grup poate ține oameni de la mai
 * mulți clienți sau de la niciunul, iar o legare greșită mută firul în fișa altui
 * client. Egalitatea nu propune nimic, ca să nu aleagă mașina în locul omului.
 */
export function suggestGroupClient(
	memberPhones: Array<string | null>,
	clientByPhone: Map<string, { id: string; name: string }>
): GroupClientSuggestion | null {
	const counts = new Map<string, { name: string; matches: number }>();
	const seen = new Set<string>();

	for (const phone of memberPhones) {
		if (!phone || seen.has(phone)) continue;
		seen.add(phone);
		const client = clientByPhone.get(phone);
		if (!client) continue;
		const entry = counts.get(client.id);
		if (entry) entry.matches += 1;
		else counts.set(client.id, { name: client.name, matches: 1 });
	}

	let best: GroupClientSuggestion | null = null;
	let tied = false;
	for (const [clientId, { name, matches }] of counts) {
		if (!best || matches > best.matches) {
			best = { clientId, clientName: name, matches };
			tied = false;
		} else if (matches === best.matches) {
			tied = true;
		}
	}

	return tied ? null : best;
}
