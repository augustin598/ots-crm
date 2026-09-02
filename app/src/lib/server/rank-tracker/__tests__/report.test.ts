// Teste pentru agregarea raportului săptămânal + trimiterea alertelor.
import { describe, test, expect, mock } from 'bun:test';

await import('$lib/server/db/schema');
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$lib/server/db', () => ({ db: {} }));

const { buildRankReportData, sendRankAlertsForRun } = await import('../report');

const NOW = () => new Date('2026-09-02T08:00:00Z'); // miercuri, 2026-09-02

describe('buildRankReportData — agregate desktop', () => {
	test('poziție medie, vizibilitate, distribuție, movers, AI citat', async () => {
		const data = await buildRankReportData('t1', '2026-W36', {
			now: NOW,
			loadProjects: async () => [
				{ id: 'p1', domain: 'example.ro', clientName: 'Client X', clientEmail: 'c@x.ro' }
			],
			loadKeywords: async () => [
				{ id: 'k1', projectId: 'p1', keyword: 'seo bucuresti' },
				{ id: 'k2', projectId: 'p1', keyword: 'agentie seo' }
			],
			loadSnapshots: async () => [
				// k1: azi 2 (citat AI), acum 7 zile 5 → urcare +3
				{ keywordId: 'k1', device: 'desktop', dayKey: '2026-09-02', position: 2, aiOverview: 'cited' },
				{ keywordId: 'k1', device: 'desktop', dayKey: '2026-08-26', position: 5, aiOverview: 'absent' },
				// k2: azi 15, acum 7 zile 8 → scădere -7
				{ keywordId: 'k2', device: 'desktop', dayKey: '2026-09-02', position: 15, aiOverview: 'present' },
				{ keywordId: 'k2', device: 'desktop', dayKey: '2026-08-26', position: 8, aiOverview: 'absent' }
			]
		});

		expect(data.keywordCount).toBe(2);
		expect(data.avgPosition).toBe(8.5);
		expect(data.visibility).toBeCloseTo(40.7, 1);
		expect(data.distribution['1-3']).toBe(1);
		expect(data.distribution['11-20']).toBe(1);
		expect(data.topUp[0]).toMatchObject({ keyword: 'seo bucuresti', delta: 3 });
		expect(data.topDown[0]).toMatchObject({ keyword: 'agentie seo', delta: -7 });
		expect(data.aiCited).toBe(1);
		expect(data.aiPresent).toBe(2);
		expect(data.rows[0]).toMatchObject({ domain: 'example.ro', keywordCount: 2, top3: 1, top10: 1 });
	});

	test('deltaVisibility pozitivă când pozițiile se îmbunătățesc global', async () => {
		const data = await buildRankReportData('t1', '2026-W36', {
			now: NOW,
			loadProjects: async () => [{ id: 'p1', domain: 'example.ro', clientName: null, clientEmail: null }],
			loadKeywords: async () => [{ id: 'k1', projectId: 'p1', keyword: 'kw' }],
			loadSnapshots: async () => [
				{ keywordId: 'k1', device: 'desktop', dayKey: '2026-09-02', position: 1, aiOverview: 'absent' },
				{ keywordId: 'k1', device: 'desktop', dayKey: '2026-08-26', position: 9, aiOverview: 'absent' }
			]
		});
		expect(data.deltaVisibility).toBeGreaterThan(0);
	});
});

describe('sendRankAlertsForRun', () => {
	const alerts = [
		{ keyword: 'kw1', device: 'desktop' as const, type: 'drop' as const, fromPosition: 3, toPosition: 9, delta: -6 },
		{ keyword: 'kw2', device: 'mobile' as const, type: 'lost' as const, fromPosition: 8, toPosition: null, delta: null }
	];

	test('trimite câte un email per destinatar', async () => {
		const sentTo: string[] = [];
		const r = await sendRankAlertsForRun('t1', 'p1', 'run1', {
			loadAlerts: async () => alerts,
			loadRecipients: async () => ({ domain: 'example.ro', recipients: ['a@x.ro', 'b@x.ro'] }),
			sendEmail: async (_t, recipient, data) => {
				sentTo.push(recipient);
				expect(data.count).toBe(2);
				expect(data.projectDomain).toBe('example.ro');
			}
		});
		expect(r.sent).toBe(2);
		expect(sentTo).toEqual(['a@x.ro', 'b@x.ro']);
	});

	test('fără alerte → nu trimite', async () => {
		const r = await sendRankAlertsForRun('t1', 'p1', 'run1', {
			loadAlerts: async () => [],
			loadRecipients: async () => ({ domain: 'example.ro', recipients: ['a@x.ro'] }),
			sendEmail: async () => {}
		});
		expect(r.sent).toBe(0);
	});

	test('fără destinatari → nu trimite', async () => {
		const r = await sendRankAlertsForRun('t1', 'p1', 'run1', {
			loadAlerts: async () => alerts,
			loadRecipients: async () => ({ domain: 'example.ro', recipients: [] }),
			sendEmail: async () => {}
		});
		expect(r.sent).toBe(0);
	});
});
