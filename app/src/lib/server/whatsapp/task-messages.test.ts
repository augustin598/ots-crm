import { describe, expect, it } from 'bun:test';
import {
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
	it('cu număr cunoscut, numele devine mențiune reală și JID-ul intră în listă', () => {
		const { text, mentions } = buildMentionMessage({
			taskTitle: 'Raport lunar Beautyone',
			authorName: 'Andrei Pop',
			mentioned: { name: 'Ana Pop', phoneE164: '+40722123456' },
			commentHtml: '<p>Ana, poți verifica <strong>bugetul</strong> până mâine?</p>',
			taskUrl: url
		});
		expect(text).toBe(
			'💬 *Raport lunar Beautyone*\n' +
				'Mențiune de la Andrei Pop pentru @Ana Pop:\n' +
				'„Ana, poți verifica bugetul până mâine?"\n' +
				url
		);
		expect(mentions).toEqual(['40722123456@s.whatsapp.net']);
	});

	it('fără număr, numele rămâne simplu și lista de mențiuni e goală', () => {
		const { text, mentions } = buildMentionMessage({
			taskTitle: 'T',
			authorName: 'A',
			mentioned: { name: 'Ana Pop', phoneE164: null },
			commentHtml: '<p>salut</p>',
			taskUrl: url
		});
		expect(text).toContain('pentru Ana Pop:');
		expect(text).not.toContain('@Ana');
		expect(mentions).toEqual([]);
	});

	it('fragmentul se taie la 160 de caractere cu puncte de suspensie', () => {
		const long = 'a'.repeat(500);
		const { text } = buildMentionMessage({
			taskTitle: 'T',
			authorName: 'A',
			mentioned: { name: 'B', phoneE164: null },
			commentHtml: `<p>${long}</p>`,
			taskUrl: url
		});
		const quote = text.split('\n')[2];
		expect(quote).toBe(`„${'a'.repeat(160)}…"`);
	});

	it('pastila de mențiune din TipTap se citește ca text', () => {
		const { text } = buildMentionMessage({
			taskTitle: 'T',
			authorName: 'A',
			mentioned: { name: 'B', phoneE164: null },
			commentHtml: '<p>cc <span data-type="mention" data-id="u1">@Ana Pop</span> te rog</p>',
			taskUrl: url
		});
		expect(text).toContain('„cc @Ana Pop te rog"');
	});
});
