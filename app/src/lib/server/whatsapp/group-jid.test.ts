import { describe, expect, it } from 'bun:test';
import {
	buildMentionLookup,
	isGroupJid,
	isIgnorableChatJid,
	isPhoneJid,
	resolveGroupSender,
	resolveMentions,
	suggestGroupClient
} from './group-jid';

describe('recunoașterea JID-urilor', () => {
	it('separă grupul de o persoană', () => {
		expect(isGroupJid('120363123456789012@g.us')).toBe(true);
		expect(isGroupJid('40722123456@s.whatsapp.net')).toBe(false);
		expect(isGroupJid('84027092512961@lid')).toBe(false);
		expect(isGroupJid(null)).toBe(false);
	});

	it('doar „@s.whatsapp.net" e JID de telefon', () => {
		expect(isPhoneJid('40722123456@s.whatsapp.net')).toBe(true);
		expect(isPhoneJid('84027092512961@lid')).toBe(false);
		expect(isPhoneJid('120363123456789012@g.us')).toBe(false);
	});

	it('difuzările și canalele rămân excluse', () => {
		expect(isIgnorableChatJid('status@broadcast')).toBe(true);
		expect(isIgnorableChatJid('1234@broadcast')).toBe(true);
		expect(isIgnorableChatJid('1234@newsletter')).toBe(true);
		expect(isIgnorableChatJid(null)).toBe(true);
		// Grupul NU e „de ignorat": are cale proprie în handleInbound.
		expect(isIgnorableChatJid('120363123456789012@g.us')).toBe(false);
		expect(isIgnorableChatJid('40722123456@s.whatsapp.net')).toBe(false);
	});
});

describe('expeditorul unui mesaj de grup', () => {
	it('ia telefonul direct din „participant"', () => {
		const sender = resolveGroupSender({
			key: { participant: '40722123456@s.whatsapp.net' },
			pushName: 'Ana Pop'
		});
		expect(sender.phoneE164).toBe('+40722123456');
		expect(sender.pushName).toBe('Ana Pop');
		expect(sender.jid).toBe('40722123456@s.whatsapp.net');
	});

	it('preferă numărul alăturat când WhatsApp trimite un LID', () => {
		// Baileys pune PN-ul pe `participantAlt` la mesajele de grup adresate pe LID.
		const sender = resolveGroupSender({
			key: { participant: '84027092512961@lid', participantAlt: '40733222111@s.whatsapp.net' },
			pushName: 'Mihai'
		});
		expect(sender.phoneE164).toBe('+40733222111');
		// JID-ul brut rămâne cel primit, ca o rezolvare ulterioară să aibă de ce se lega.
		expect(sender.jid).toBe('40733222111@s.whatsapp.net');
	});

	it('taie sufixul de dispozitiv din JID', () => {
		const sender = resolveGroupSender({ key: { participant: '40722123456:12@s.whatsapp.net' } });
		expect(sender.phoneE164).toBe('+40722123456');
	});

	it('caută LID-ul în fotografia membrilor când cheia n-are număr', () => {
		const snapshot = new Map([['84027092512961@lid', '+40744555666']]);
		const sender = resolveGroupSender(
			{ key: { participant: '84027092512961@lid' }, pushName: 'Ioana' },
			(rawId) => snapshot.get(rawId) ?? null
		);
		expect(sender.phoneE164).toBe('+40744555666');
	});

	it('fără telefon rămâne doar numele, nu o eroare', () => {
		const sender = resolveGroupSender({ key: { participant: '84027092512961@lid' }, pushName: 'X' });
		expect(sender.phoneE164).toBeNull();
		expect(sender.pushName).toBe('X');
	});

	it('la mesajele proprii nu stocăm numele contului nostru', () => {
		const sender = resolveGroupSender({
			key: { fromMe: true, participant: '40700000000@s.whatsapp.net' },
			pushName: 'One Top Solution'
		});
		expect(sender.pushName).toBeNull();
		expect(sender.phoneE164).toBe('+40700000000');
	});

	it('numele gol nu devine șir gol', () => {
		expect(resolveGroupSender({ key: {}, pushName: '   ' }).pushName).toBeNull();
		expect(resolveGroupSender({}).jid).toBeNull();
	});
});

describe('mențiunile din text', () => {
	// Cazul real: Iulia Mitu scrie „@84027092512961 am structurat tabelul", iar
	// 84027092512961 e LID-ul contului nostru din grupul „Ads Retail Beautyone".
	const participants = [
		{ rawId: '84027092512961@lid', phone: '+40771491770' },
		{ rawId: '135777170288732@lid', phone: '+40726090767' },
		{ rawId: '249645057994761@lid', phone: null }
	];
	const names = new Map([['+40771491770', 'One Top Solution']]);
	const lookup = buildMentionLookup(participants, (p) => names.get(p) ?? null);

	it('înlocuiește LID-ul cu numele contactului', () => {
		expect(resolveMentions('@84027092512961 am structurat tabelul', lookup)).toBe(
			'@One Top Solution am structurat tabelul'
		);
	});

	it('fără nume în contacte, telefonul e tot mai bun decât cifrele', () => {
		expect(resolveMentions('salut @135777170288732', lookup)).toBe('salut @+40726090767');
	});

	it('recunoaște și mențiunea scrisă cu telefonul', () => {
		expect(resolveMentions('@40771491770 vezi asta', lookup)).toBe('@One Top Solution vezi asta');
	});

	it('mai multe mențiuni în același mesaj', () => {
		expect(resolveMentions('@84027092512961 și @135777170288732', lookup)).toBe(
			'@One Top Solution și @+40726090767'
		);
	});

	it('lasă neatins ce nu poate traduce', () => {
		expect(resolveMentions('@99999999999999 cine e?', lookup)).toBe('@99999999999999 cine e?');
		expect(resolveMentions('scrie-mi pe email@firma.ro', lookup)).toBe('scrie-mi pe email@firma.ro');
		expect(resolveMentions('fără mențiuni aici', lookup)).toBe('fără mențiuni aici');
		expect(resolveMentions(null, lookup)).toBeNull();
	});

	it('membrul fără telefon nu intră în traducere', () => {
		expect(resolveMentions('@249645057994761', lookup)).toBe('@249645057994761');
	});
});

describe('propunerea de client pentru un grup', () => {
	const clients = new Map([
		['+40722111111', { id: 'c1', name: 'Lucky Studio' }],
		['+40722222222', { id: 'c1', name: 'Lucky Studio' }],
		['+40733333333', { id: 'c2', name: 'Beauty One' }]
	]);

	it('propune clientul cu cele mai multe numere în grup', () => {
		const s = suggestGroupClient(['+40722111111', '+40722222222', '+40733333333', null], clients);
		expect(s).toEqual({ clientId: 'c1', clientName: 'Lucky Studio', matches: 2 });
	});

	it('la egalitate nu propune nimic, ca să aleagă omul', () => {
		expect(suggestGroupClient(['+40722111111', '+40733333333'], clients)).toBeNull();
	});

	it('același număr de două ori nu umflă scorul', () => {
		const s = suggestGroupClient(['+40722111111', '+40722111111', '+40733333333'], clients);
		expect(s).toBeNull();
	});

	it('niciun membru cunoscut înseamnă nicio propunere', () => {
		expect(suggestGroupClient([null, '+40799999999'], clients)).toBeNull();
		expect(suggestGroupClient([], clients)).toBeNull();
	});
});
