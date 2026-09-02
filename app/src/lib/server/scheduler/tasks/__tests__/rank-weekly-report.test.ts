// Teste pentru jobul de raport săptămânal Rank Tracker (potrivire zi/oră + idempotență).
import { describe, test, expect, mock } from 'bun:test';

await import('$lib/server/db/schema');
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: (e as Error)?.message ?? String(e) })
}));

const { processRankWeeklyReport } = await import('../rank-weekly-report');

// 2026-09-02T03:00:00Z = miercuri (dayOfWeek 3), ora 06 în București.
const NOW = new Date('2026-09-02T03:00:00Z');

const reportData = {
	weekKey: '2026-W36',
	weekLabel: 'S36',
	interval: '31 aug. – 6 sept.',
	projectCount: 2,
	keywordCount: 20,
	avgPosition: 8.5,
	visibility: 42,
	deltaVisibility: 1.5,
	distribution: { '1-3': 3, '4-10': 5, '11-20': 4, '21-50': 4, '51-100': 2, '100+': 2 },
	topUp: [],
	topDown: [],
	aiPresent: 3,
	aiCited: 1,
	alertCount: 2,
	rows: []
} as never;

function baseDeps(over: Record<string, unknown> = {}) {
	return {
		loadEnabledSettings: async () => [
			{ tenantId: 't1', reportDay: 3, reportHour: '06:00', recipients: ['a@x.ro', 'b@x.ro'] }
		],
		reportExists: async () => false,
		buildData: async () => reportData,
		sendEmail: async () => {},
		insertReport: async () => {},
		...over
	};
}

describe('processRankWeeklyReport', () => {
	test('potrivire zi+oră → trimite și inserează raportul', async () => {
		const emails: string[] = [];
		let inserted: Record<string, unknown> | null = null;
		const r = await processRankWeeklyReport(NOW, baseDeps({
			sendEmail: async (_t: string, rec: string) => {
				emails.push(rec);
			},
			insertReport: async (row: Record<string, unknown>) => {
				inserted = row;
			}
		}));
		expect(r.processed).toBe(1);
		expect(r.emailsSent).toBe(2);
		expect(emails).toEqual(['a@x.ro', 'b@x.ro']);
		expect(inserted!.status).toBe('sent');
		expect(inserted!.weekKey).toBe('2026-W36');
	});

	test('zi nepotrivită → nimic', async () => {
		const r = await processRankWeeklyReport(NOW, baseDeps({
			loadEnabledSettings: async () => [
				{ tenantId: 't1', reportDay: 1, reportHour: '06:00', recipients: ['a@x.ro'] }
			]
		}));
		expect(r.checked).toBe(0);
		expect(r.processed).toBe(0);
	});

	test('raport deja existent pe săptămână → idempotent, nu trimite', async () => {
		let sent = 0;
		const r = await processRankWeeklyReport(NOW, baseDeps({
			reportExists: async () => true,
			sendEmail: async () => {
				sent++;
			}
		}));
		expect(r.checked).toBe(1);
		expect(r.processed).toBe(0);
		expect(sent).toBe(0);
	});

	test('fără destinatari → inserează raport cu notă, fără email', async () => {
		let inserted: Record<string, unknown> | null = null;
		let sent = 0;
		const r = await processRankWeeklyReport(NOW, baseDeps({
			loadEnabledSettings: async () => [
				{ tenantId: 't1', reportDay: 3, reportHour: '06:00', recipients: [] }
			],
			sendEmail: async () => {
				sent++;
			},
			insertReport: async (row: Record<string, unknown>) => {
				inserted = row;
			}
		}));
		expect(sent).toBe(0);
		expect(r.processed).toBe(1);
		expect(inserted!.note).toBe('fără destinatari');
	});

	test('un email eșuat → status partial', async () => {
		let inserted: Record<string, unknown> | null = null;
		const r = await processRankWeeklyReport(NOW, baseDeps({
			sendEmail: async (_t: string, rec: string) => {
				if (rec === 'b@x.ro') throw new Error('SMTP');
			},
			insertReport: async (row: Record<string, unknown>) => {
				inserted = row;
			}
		}));
		expect(inserted!.status).toBe('partial');
		expect(r.emailsSent).toBe(1);
	});
});
