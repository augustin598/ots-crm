// Teste pentru jobul săptămânal PageSpeed: potrivirea zi/oră pe Europe/Bucharest,
// idempotență pe (tenant, săptămână), gating onlyOnDrop, destinatari lipsă, status partial.
import { describe, test, expect, beforeEach, mock } from 'bun:test';

await import('$lib/server/db/schema'); // eager-load înainte de mock (mock.module e global)

const selectQueue: unknown[][] = [];
const inserted: Record<string, unknown>[] = [];

const dbMock = {
	select: () => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			leftJoin: () => chain,
			where: () => chain,
			orderBy: () => chain,
			limit: () => chain,
			then: (resolve: (rows: unknown[]) => void) => resolve(selectQueue.shift() ?? [])
		};
		return chain;
	},
	insert: () => ({
		values: async (val: Record<string, unknown>) => {
			inserted.push(val);
		}
	})
};

mock.module('$env/dynamic/private', () => ({ env: { PSI_API_KEY: 'k' } }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e) })
}));

const { processPagespeedWeeklyReport } = await import('../pagespeed-weekly-report');

// Luni 31 aug 2026, 07:00 la București (UTC+3) = 04:00 UTC
const MONDAY_7AM = new Date('2026-08-31T04:00:00Z');

const SETTINGS = {
	id: 'set1',
	tenantId: 't1',
	dayOfWeek: 1,
	hour: '07:00',
	strategies: ['mobile', 'desktop'],
	recipients: ['seo@onetopsolution.ro'],
	alertThreshold: 5,
	onlyOnDrop: false,
	includeOpportunities: true,
	attachPdf: false,
	sendToClient: false,
	isEnabled: true
};

const REPORT_DATA = {
	weekKey: '2026-W36',
	weekLabel: 'S36',
	interval: '31 aug. – 6 sept. 2026',
	siteCount: 2,
	avgMobile: 61,
	avgDesktop: 87,
	deltaMobile: -3,
	cwvPassCount: 1,
	cwvKnownCount: 2,
	alertCount: 0,
	failedCount: 0,
	rows: [],
	includeOpportunities: true,
	attachPdf: false
};

type Deps = NonNullable<Parameters<typeof processPagespeedWeeklyReport>[1]>;

function makeDeps(over: Partial<Deps> = {}) {
	const calls = { scans: 0, emails: [] as string[] };
	const deps: Deps = {
		runScan: async () => {
			calls.scans++;
			return { scanned: 4, failed: 0, skipped: false };
		},
		buildData: async () => ({ ...REPORT_DATA }),
		sendEmail: async (_tenantId: string, recipient: string) => {
			calls.emails.push(recipient);
		},
		...over
	};
	return { deps, calls };
}

beforeEach(() => {
	selectQueue.length = 0;
	inserted.length = 0;
});

describe('processPagespeedWeeklyReport', () => {
	test('ziua/ora nu se potrivesc → nu scanează, nu inserează', async () => {
		selectQueue.push([{ ...SETTINGS, dayOfWeek: 3 }]); // miercuri, dar azi e luni
		const { deps, calls } = makeDeps();
		const result = await processPagespeedWeeklyReport(MONDAY_7AM, deps);
		expect(calls.scans).toBe(0);
		expect(inserted.length).toBe(0);
		expect(result.processed).toBe(0);
	});

	test('raport deja existent pentru (tenant, săptămână) → idempotent, skip', async () => {
		selectQueue.push([SETTINGS]); // setările
		selectQueue.push([{ id: 'r-existent' }]); // raportul existent
		const { deps, calls } = makeDeps();
		await processPagespeedWeeklyReport(MONDAY_7AM, deps);
		expect(calls.scans).toBe(0);
		expect(inserted.length).toBe(0);
	});

	test('potrivire → scan + email către destinatari + raport „sent"', async () => {
		selectQueue.push([SETTINGS]);
		selectQueue.push([]); // niciun raport existent
		selectQueue.push([{ isEnabled: true }]); // emailSettings
		const { deps, calls } = makeDeps();
		const result = await processPagespeedWeeklyReport(MONDAY_7AM, deps);
		expect(calls.scans).toBe(1);
		expect(calls.emails).toEqual(['seo@onetopsolution.ro']);
		expect(inserted.length).toBe(1);
		expect(inserted[0]).toMatchObject({
			tenantId: 't1',
			weekKey: '2026-W36',
			status: 'sent',
			avgMobile: 61
		});
		expect(result.processed).toBe(1);
	});

	test('onlyOnDrop fără scăderi peste prag → fără email, raport „skipped"', async () => {
		selectQueue.push([{ ...SETTINGS, onlyOnDrop: true }]);
		selectQueue.push([]);
		selectQueue.push([{ isEnabled: true }]);
		const { deps, calls } = makeDeps(); // REPORT_DATA.alertCount = 0
		await processPagespeedWeeklyReport(MONDAY_7AM, deps);
		expect(calls.emails.length).toBe(0);
		expect(inserted[0]).toMatchObject({ status: 'skipped' });
	});

	test('măsurători eșuate la scan → raport „partial" cu notă', async () => {
		selectQueue.push([SETTINGS]);
		selectQueue.push([]);
		selectQueue.push([{ isEnabled: true }]);
		const { deps, calls } = makeDeps({
			runScan: async () => ({ scanned: 3, failed: 1, skipped: false }),
			buildData: async () => ({ ...REPORT_DATA, failedCount: 1 })
		});
		await processPagespeedWeeklyReport(MONDAY_7AM, deps);
		expect(calls.emails.length).toBe(1); // emailul pleacă totuși
		expect(inserted[0]).toMatchObject({ status: 'partial' });
		expect(String(inserted[0].note)).toContain('eșuat');
	});

	test('fără destinatari → fără email, raport „skipped" cu notă', async () => {
		selectQueue.push([{ ...SETTINGS, recipients: [] }]);
		selectQueue.push([]);
		selectQueue.push([{ isEnabled: true }]);
		const { deps, calls } = makeDeps();
		await processPagespeedWeeklyReport(MONDAY_7AM, deps);
		expect(calls.emails.length).toBe(0);
		expect(inserted[0]).toMatchObject({ status: 'skipped' });
		expect(String(inserted[0].note)).toContain('destinatari');
	});

	test('un email eșuează din două → status „partial", restul pleacă', async () => {
		selectQueue.push([{ ...SETTINGS, recipients: ['a@x.ro', 'b@x.ro'] }]);
		selectQueue.push([]);
		selectQueue.push([{ isEnabled: true }]);
		const sentTo: string[] = [];
		const { deps } = makeDeps({
			sendEmail: async (_t: string, recipient: string) => {
				if (recipient === 'a@x.ro') throw new Error('SMTP 550');
				sentTo.push(recipient);
			}
		});
		await processPagespeedWeeklyReport(MONDAY_7AM, deps);
		expect(sentTo).toEqual(['b@x.ro']);
		expect(inserted[0]).toMatchObject({ status: 'partial' });
	});
});
