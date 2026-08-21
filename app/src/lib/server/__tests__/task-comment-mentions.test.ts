import { beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/dynamic/public', () => ({ env: { PUBLIC_APP_URL: 'https://crm.test' } }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({
	logWarning: () => {},
	logError: () => {},
	logInfo: () => {}
}));

const notifications: Array<{ userId: string; type: string }> = [];
mock.module('$lib/server/notifications', () => ({
	createNotification: async (p: { userId: string; type: string }) => {
		notifications.push({ userId: p.userId, type: p.type });
	}
}));

const telegram: Array<{ mentionedUserId: string }> = [];
mock.module('$lib/server/telegram/task-notifications', () => ({
	notifyTaskMention: async (p: { mentionedUserId: string }) => {
		telegram.push(p);
	}
}));

const whatsapp: Array<{ mentioned: Array<{ userId: string; name: string }> }> = [];
mock.module('$lib/server/whatsapp/task-notifications', () => ({
	notifyTaskMentionInGroup: async (p: { mentioned: Array<{ userId: string; name: string }> }) => {
		whatsapp.push(p);
	}
}));

// Doar oamenii din tenant sunt întorși de interogarea de nume.
let knownUsers: Array<{ id: string; firstName: string; lastName: string; email: string }> = [];
function chain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, {
		from: () => chain(rows),
		leftJoin: () => chain(rows),
		where: () => chain(rows),
		limit: () => chain(rows)
	});
}
mock.module('$lib/server/db', () => ({
	db: { selectDistinct: () => chain(knownUsers) }
}));
mock.module('$lib/server/db/schema', () => ({
	user: { id: 'id', firstName: 'f', lastName: 'l', email: 'e' },
	tenantUser: { userId: 'user_id', tenantId: 'tenant_id' },
	clientUser: { userId: 'user_id', tenantId: 'tenant_id' }
}));

const { extractMentionIds, newMentionIds, notifyMentionTargets } = await import(
	'../task-comment-mentions'
);

const mention = (id: string, label: string) =>
	`<span class="mention" data-type="mention" data-id="${id}" data-label="${label}">@${label}</span>`;

describe('extractMentionIds', () => {
	test('citește id-urile din pastilele TipTap', () => {
		const html = `<p>Salut ${mention('u1', 'Ana')} și ${mention('u2', 'Mihai')}</p>`;
		expect(extractMentionIds(html)).toEqual(['u1', 'u2']);
	});

	test('merge și cu atributele în ordine inversă', () => {
		const html = '<p><span data-id="u9" data-type="mention">@Ana</span></p>';
		expect(extractMentionIds(html)).toEqual(['u9']);
	});

	test('aceeași persoană menționată de două ori apare o dată', () => {
		const html = `<p>${mention('u1', 'Ana')} ${mention('u1', 'Ana')}</p>`;
		expect(extractMentionIds(html)).toEqual(['u1']);
	});

	test('text fără mențiuni', () => {
		expect(extractMentionIds('<p>gata, mulțumesc</p>')).toEqual([]);
	});
});

describe('newMentionIds', () => {
	test('o mențiune adăugată la editare e nouă', () => {
		const before = `<p>Salut ${mention('u1', 'Ana')}</p>`;
		const after = `<p>Salut ${mention('u1', 'Ana')} și ${mention('u2', 'Mihai')}</p>`;
		expect(newMentionIds(before, after)).toEqual(['u2']);
	});

	test('o corectură de virgulă nu re-anunță pe nimeni', () => {
		const before = `<p>Salut ${mention('u1', 'Ana')} , poți verifica?</p>`;
		const after = `<p>Salut ${mention('u1', 'Ana')}, poți verifica?</p>`;
		expect(newMentionIds(before, after)).toEqual([]);
	});

	test('o mențiune ștearsă nu produce nimic', () => {
		const before = `<p>${mention('u1', 'Ana')} ${mention('u2', 'Mihai')}</p>`;
		const after = `<p>${mention('u1', 'Ana')}</p>`;
		expect(newMentionIds(before, after)).toEqual([]);
	});

	test('ordinea din textul nou se păstrează', () => {
		const before = '<p>nimic</p>';
		const after = `<p>${mention('u3', 'C')} ${mention('u1', 'A')}</p>`;
		expect(newMentionIds(before, after)).toEqual(['u3', 'u1']);
	});
});

describe('notifyMentionTargets', () => {
	const base = {
		tenantId: 't1',
		tenantSlug: 'ots',
		taskId: 'task1',
		taskTitle: 'Raport lunar',
		taskClientId: 'c1',
		commentId: 'com1',
		actorUserId: 'autor',
		actorName: 'Augustin Constantin',
		contentHtml: '<p>verificați bugetul</p>'
	};

	beforeEach(() => {
		notifications.length = 0;
		telegram.length = 0;
		whatsapp.length = 0;
		knownUsers = [
			{ id: 'u1', firstName: 'Ana', lastName: 'Pop', email: 'ana@x.ro' },
			{ id: 'u2', firstName: '', lastName: '', email: 'mihai@x.ro' }
		];
	});

	test('anunță fiecare persoană în aplicație și pe Telegram, iar în grup o singură dată', async () => {
		await notifyMentionTargets({ ...base, mentionedUserIds: ['u1', 'u2'] });
		expect(notifications.map((n) => n.userId)).toEqual(['u1', 'u2']);
		expect(telegram).toHaveLength(2);
		expect(whatsapp).toHaveLength(1);
		expect(whatsapp[0].mentioned).toEqual([
			{ userId: 'u1', name: 'Ana Pop' },
			{ userId: 'u2', name: 'mihai@x.ro' }
		]);
	});

	test('autoreferirea se sare', async () => {
		await notifyMentionTargets({ ...base, mentionedUserIds: ['autor'] });
		expect(notifications).toHaveLength(0);
		expect(whatsapp).toHaveLength(0);
	});

	test('un id care nu aparține tenantului nu ajunge în grup', async () => {
		// Numele vine dintr-o interogare filtrată pe apartenență; un id fabricat
		// nu are nume, deci nu are ce căuta în mesajul din grup.
		knownUsers = [{ id: 'u1', firstName: 'Ana', lastName: 'Pop', email: 'ana@x.ro' }];
		await notifyMentionTargets({ ...base, mentionedUserIds: ['u1', 'strain'] });
		expect(whatsapp[0].mentioned).toEqual([{ userId: 'u1', name: 'Ana Pop' }]);
	});

	test('fără mențiuni nu se atinge niciun canal', async () => {
		await notifyMentionTargets({ ...base, mentionedUserIds: [] });
		expect(notifications).toHaveLength(0);
		expect(telegram).toHaveLength(0);
		expect(whatsapp).toHaveLength(0);
	});
});
