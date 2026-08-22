import { describe, expect, it } from 'bun:test';
import {
	buildApprovalMessage,
	buildRejectionMessage,
	buildLinkedTaskMessage,
	buildTaskCommandAck,
	buildMentionMessage,
	buildStatusMessage,
	notifiesGroup,
	statusLabelRo
} from './task-messages';

const url = 'https://clients.onetopsolution.ro/ots/tasks/abc123';

describe('mesajul de status', () => {
	it('spune cine, ce task, din ce în ce, cu link', () => {
		const text = buildStatusMessage({
			taskTitle: 'Raport lunar Beautyone',
			actorName: 'Andrei Pop',
			oldStatus: 'todo',
			newStatus: 'in-progress',
			taskUrl: url
		});
		expect(text).toBe(
			'🔧 *Raport lunar Beautyone*\n' +
				'Andrei Pop a trecut task-ul în *În lucru* (din De făcut).\n' +
				url
		);
	});

	it('are emoji și etichetă pentru fiecare status notificat', () => {
		expect(statusLabelRo('done')).toBe('Finalizat');
		expect(statusLabelRo('blocked')).toBe('Blocat');
		expect(statusLabelRo('cancelled')).toBe('Anulat');
		expect(statusLabelRo('review')).toBe('În verificare');
		expect(buildStatusMessage({
			taskTitle: 'X', actorName: 'A', oldStatus: 'review', newStatus: 'done', taskUrl: url
		})).toStartWith('✅ ');
	});

	it('nu conține liniuță lungă și nu strică bold-ul cu asteriscuri din titlu', () => {
		const text = buildStatusMessage({
			taskTitle: 'Campanie *Black Friday* — faza 2',
			actorName: 'A',
			oldStatus: 'todo',
			newStatus: 'blocked',
			taskUrl: url
		});
		expect(text).not.toContain('—');
		expect(text.split('\n')[0]).toBe('⛔ *Campanie Black Friday, faza 2*');
	});

	it('pending-approval nu ajunge în grup; celelalte șase da', () => {
		expect(notifiesGroup('pending-approval')).toBe(false);
		for (const s of ['todo', 'in-progress', 'review', 'done', 'blocked', 'cancelled']) {
			expect(notifiesGroup(s)).toBe(true);
		}
	});
});

describe('mesajul de mențiune', () => {
	it('ancora din text e numărul, nu numele: altfel WhatsApp nu randează mențiunea', () => {
		const { text, mentions } = buildMentionMessage({
			taskTitle: 'Raport lunar Beautyone',
			authorName: 'Andrei Pop',
			mentioned: [{ name: 'Ana Pop', phoneE164: '+40722123456' }],
			commentHtml: '<p>Ana, poți verifica <strong>bugetul</strong> până mâine?</p>',
			taskUrl: url
		});
		expect(text).toBe(
			'💬 *Raport lunar Beautyone*\n' +
				'Mențiune de la Andrei Pop pentru @40722123456:\n' +
				'„Ana, poți verifica bugetul până mâine?"\n' +
				url
		);
		expect(mentions).toEqual(['40722123456@s.whatsapp.net']);
	});

	it('fără număr, numele rămâne simplu și lista de mențiuni e goală', () => {
		const { text, mentions } = buildMentionMessage({
			taskTitle: 'T',
			authorName: 'A',
			mentioned: [{ name: 'Ana Pop', phoneE164: null }],
			commentHtml: '<p>salut</p>',
			taskUrl: url
		});
		expect(text).toContain('pentru Ana Pop:');
		expect(text).not.toContain('@');
		expect(mentions).toEqual([]);
	});

	it('doi menționați intră în același mesaj, legați cu „și"', () => {
		const { text, mentions } = buildMentionMessage({
			taskTitle: 'T',
			authorName: 'A',
			mentioned: [
				{ name: 'Ana Pop', phoneE164: '+40722123456' },
				{ name: 'Ion Rus', phoneE164: '+40733111222' }
			],
			commentHtml: '<p>x</p>',
			taskUrl: url
		});
		expect(text.split('\n')[1]).toBe('Mențiune de la A pentru @40722123456 și @40733111222:');
		expect(mentions).toEqual(['40722123456@s.whatsapp.net', '40733111222@s.whatsapp.net']);
	});

	it('trei menționați: virgulă, apoi „și" înaintea ultimului; cine n-are număr apare cu numele', () => {
		const { text, mentions } = buildMentionMessage({
			taskTitle: 'T',
			authorName: 'A',
			mentioned: [
				{ name: 'Ana Pop', phoneE164: '+40722123456' },
				{ name: 'Ion Rus', phoneE164: null },
				{ name: 'Dan Ilie', phoneE164: '+40744999888' }
			],
			commentHtml: '<p>x</p>',
			taskUrl: url
		});
		expect(text.split('\n')[1]).toBe('Mențiune de la A pentru @40722123456, Ion Rus și @40744999888:');
		expect(mentions).toHaveLength(2);
	});

	it('fragmentul se taie la 160 de caractere cu puncte de suspensie', () => {
		const long = 'a'.repeat(500);
		const { text } = buildMentionMessage({
			taskTitle: 'T',
			authorName: 'A',
			mentioned: [{ name: 'B', phoneE164: null }],
			commentHtml: `<p>${long}</p>`,
			taskUrl: url
		});
		const quote = text.split('\n')[2];
		expect(quote).toBe(`„${'a'.repeat(160)}…"`);
	});

	it('pastilele de mențiune ies din fragment: numele e deja în rândul de deasupra', () => {
		const { text } = buildMentionMessage({
			taskTitle: 'T',
			authorName: 'A',
			mentioned: [{ name: 'Ana Pop', phoneE164: '+40722123456' }],
			commentHtml: '<p>cc <span data-type="mention" data-id="u1">@Ana Pop</span> te rog</p>',
			taskUrl: url
		});
		expect(text).toContain('„cc te rog"');
		expect(text).not.toContain('@Ana Pop');
	});

	it('punctuația rămasă orfană după scoaterea pastilei se curăță', () => {
		const { text } = buildMentionMessage({
			taskTitle: 'T',
			authorName: 'A',
			mentioned: [{ name: 'Ana Pop', phoneE164: null }],
			commentHtml: '<p>Test, ignorați: <span data-type="mention" data-id="u1">@Ana Pop</span></p>',
			taskUrl: url
		});
		expect(text.split('\n')[2]).toBe('„Test, ignorați"');
	});

	it('comentariu format doar dintr-o mențiune: fără rând de citat', () => {
		const { text } = buildMentionMessage({
			taskTitle: 'T',
			authorName: 'A',
			mentioned: [{ name: 'Ana Pop', phoneE164: '+40722123456' }],
			commentHtml: '<p><span data-type="mention" data-id="u1">@Ana Pop</span></p>',
			taskUrl: url
		});
		expect(text).toBe('💬 *T*\nMențiune de la A pentru @40722123456:\n' + url);
	});
});

describe('mesajul de prezentare la legarea task-ului', () => {
	it('spune cine l-a legat, responsabilul, termenul și statusul curent', () => {
		const text = buildLinkedTaskMessage({
			taskTitle: 'Raport lunar Beautyone',
			actorName: 'Augustin Constantin',
			status: 'in-progress',
			assigneeName: 'Ana Pop',
			dueDate: new Date('2026-08-28T00:00:00Z'),
			taskUrl: url
		});
		expect(text).toBe(
			'📌 *Raport lunar Beautyone*\n' +
				'Task nou în grup, adăugat de Augustin Constantin. Status: În lucru.\n' +
				'Responsabil: Ana Pop · Termen: 28 aug. 2026\n' +
				url
		);
	});

	it('fără responsabil și termen, rândul lor lipsește', () => {
		const text = buildLinkedTaskMessage({
			taskTitle: 'T',
			actorName: 'A',
			status: 'todo',
			assigneeName: null,
			dueDate: null,
			taskUrl: url
		});
		expect(text).toBe('📌 *T*\nTask nou în grup, adăugat de A. Status: De făcut.\n' + url);
	});

	it('doar termen, fără responsabil', () => {
		const text = buildLinkedTaskMessage({
			taskTitle: 'T',
			actorName: 'A',
			status: 'todo',
			assigneeName: null,
			dueDate: new Date('2026-09-01T00:00:00Z'),
			taskUrl: url
		});
		expect(text.split('\n')[2]).toBe('Termen: 1 sept. 2026');
	});
});

describe('confirmarea comenzii /task', () => {
	it('spune ce a fost notat și că urmează aprobarea', () => {
		expect(
			buildTaskCommandAck({ taskTitle: 'Refacem bannerele', authorName: 'Claudia Darie' })
		).toBe('📥 Am notat de la Claudia Darie: „Refacem bannerele". Așteaptă aprobare.');
	});
});

describe('mesajul de acceptare', () => {
	it('cu termen', () => {
		expect(
			buildApprovalMessage({
				taskTitle: 'Refacem bannerele',
				actorName: 'Augustin Constantin',
				dueDate: new Date('2026-08-28T00:00:00Z'),
				taskUrl: url
			})
		).toBe(
			'✅ *Refacem bannerele*\n' +
				'Augustin Constantin a acceptat task-ul.\n' +
				'Termen: 28 aug. 2026\n' +
				url
		);
	});

	it('fără termen, rândul lipsește', () => {
		expect(
			buildApprovalMessage({
				taskTitle: 'T',
				actorName: 'A',
				dueDate: null,
				taskUrl: url
			})
		).toBe('✅ *T*\nA a acceptat task-ul.\n' + url);
	});
});

describe('eticheta statusului de aprobare', () => {
	it('pending-approval are nume în română, dar NU declanșează mesaj în grup', () => {
		expect(statusLabelRo('pending-approval')).toBe('Așteaptă aprobare');
		expect(notifiesGroup('pending-approval')).toBe(false);
	});

	it('la aprobare, rândul „din" nu mai arată slugul englezesc', () => {
		const text = buildStatusMessage({
			taskTitle: 'T',
			actorName: 'A',
			oldStatus: 'pending-approval',
			newStatus: 'todo',
			taskUrl: url
		});
		expect(text).toContain('(din Așteaptă aprobare)');
		expect(text).not.toContain('pending-approval');
	});
});

describe('mesajul de respingere', () => {
	it('spune că nu a fost acceptat, nu „a trecut în Anulat"', () => {
		expect(
			buildRejectionMessage({ taskTitle: 'Refacem bannerele', actorName: 'Augustin', taskUrl: url })
		).toBe('🚫 *Refacem bannerele*\nAugustin nu a acceptat task-ul.\n' + url);
	});
});
