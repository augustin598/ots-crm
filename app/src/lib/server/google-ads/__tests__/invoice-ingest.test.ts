import { describe, test, expect, mock, beforeEach } from 'bun:test';

/**
 * persistGoogleInvoicePdf is the single write path for Google Ads invoice PDFs
 * (server-side download AND the browser userscript). DB + MinIO are mocked;
 * the queue below feeds successive SELECTs in call order.
 */
const selectQueue: unknown[][] = [];
const inserts: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];
const uploads: { fileName: string; size: number }[] = [];

mock.module('$lib/server/db', () => {
	const chain: Record<string, unknown> = {};
	const self = () => chain;
	Object.assign(chain, {
		from: self,
		leftJoin: self,
		where: self,
		orderBy: self,
		limit: async () => selectQueue.shift() ?? [],
		then: (resolve: (v: unknown) => void) => resolve(selectQueue.shift() ?? [])
	});
	const updateChain = {
		set: (fields: Record<string, unknown>) => {
			updates.push(fields);
			return updateChain;
		},
		where: () => Promise.resolve()
	};
	return {
		db: {
			select: () => chain,
			update: () => updateChain,
			insert: () => ({ values: (v: Record<string, unknown>) => { inserts.push(v); return Promise.resolve(); } })
		}
	};
});
mock.module('$lib/server/db/schema', () => ({
	googleAdsAccount: new Proxy({}, { get: (_t, p) => p }),
	googleAdsInvoice: new Proxy({}, { get: (_t, p) => p }),
	client: new Proxy({}, { get: (_t, p) => p })
}));
mock.module('drizzle-orm', () => ({ eq: () => ({}), and: () => ({}), inArray: () => ({}), isNotNull: () => ({}) }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e) })
}));
mock.module('$lib/server/storage', () => ({
	uploadBuffer: async (_tenantId: string, buffer: Buffer, fileName: string) => {
		uploads.push({ fileName, size: buffer.length });
		return { path: `tenant-1/1700000000000-${fileName}`, size: buffer.length, mimeType: 'application/pdf' };
	}
}));

const { persistGoogleInvoicePdf, GoogleAccountNotMappedError } = await import('../invoice-ingest');

const mappedAccount = { clientId: 'client-1', accountName: 'Heylux.ro', currencyCode: 'USD', clientName: 'Lucky Group' };
const pdf = Buffer.from('%PDF-1.4\n' + 'x'.repeat(300));
const baseInput = {
	tenantId: 'tenant-1',
	customerId: '524-929-9051',
	invoiceId: '5562077861',
	issueDate: new Date('2026-08-31T00:00:00.000Z'),
	amountText: '2.210,21 USD',
	pdfBuffer: pdf,
	source: 'userscript' as const
};

beforeEach(() => {
	selectQueue.length = 0;
	inserts.length = 0;
	updates.length = 0;
	uploads.length = 0;
});

describe('persistGoogleInvoicePdf', () => {
	test('account not mapped to a client → GoogleAccountNotMappedError, nothing uploaded', async () => {
		selectQueue.push([{ ...mappedAccount, clientId: null }]);
		await expect(persistGoogleInvoicePdf(baseInput)).rejects.toBeInstanceOf(GoogleAccountNotMappedError);
		expect(uploads).toHaveLength(0);
		expect(inserts).toHaveLength(0);
	});

	test('new invoice → upload + insert scoped to tenant/client with parsed amount', async () => {
		selectQueue.push([mappedAccount]); // resolveMappedAccount
		selectQueue.push([]); // findExistingInvoice
		const result = await persistGoogleInvoicePdf(baseInput);
		expect(result.status).toBe('imported');
		expect(uploads).toHaveLength(1);
		expect(uploads[0].fileName).toBe('google-ads-invoice-5249299051_5562077861.pdf');
		expect(inserts).toHaveLength(1);
		const row = inserts[0];
		expect(row.tenantId).toBe('tenant-1');
		expect(row.clientId).toBe('client-1');
		expect(row.googleAdsCustomerId).toBe('5249299051');
		expect(row.googleInvoiceId).toBe('5562077861');
		expect(row.invoiceNumber).toBe('5562077861');
		expect((row.issueDate as Date).toISOString()).toBe('2026-08-31T00:00:00.000Z');
		expect(row.totalAmountMicros).toBe(2210210000);
		expect(row.currencyCode).toBe('USD');
		expect(row.status).toBe('synced');
		expect(row.pdfPath).toBe('tenant-1/1700000000000-google-ads-invoice-5249299051_5562077861.pdf');
	});

	test('existing row without PDF (download_failed) → upload + update, keeps the row id', async () => {
		selectQueue.push([mappedAccount]);
		selectQueue.push([{ id: 'inv-row-1', pdfPath: null, totalAmountMicros: null, googleAdsCustomerId: '5249299051', clientId: 'client-1' }]);
		const result = await persistGoogleInvoicePdf(baseInput);
		expect(result).toEqual({ status: 'updated', invoiceRowId: 'inv-row-1' });
		expect(uploads).toHaveLength(1);
		expect(inserts).toHaveLength(0);
		expect(updates).toHaveLength(1);
		expect(updates[0].pdfPath).toContain('5562077861.pdf');
		expect(updates[0].status).toBe('synced');
		expect(updates[0].totalAmountMicros).toBe(2210210000);
	});

	test('existing row with PDF → skipped, no upload, amount backfilled when missing', async () => {
		selectQueue.push([mappedAccount]);
		selectQueue.push([{ id: 'inv-row-2', pdfPath: 'tenant-1/old.pdf', totalAmountMicros: null, googleAdsCustomerId: '5249299051', clientId: 'client-1' }]);
		const result = await persistGoogleInvoicePdf(baseInput);
		expect(result).toEqual({ status: 'skipped', invoiceRowId: 'inv-row-2' });
		expect(uploads).toHaveLength(0);
		expect(updates).toHaveLength(1);
		expect(updates[0].totalAmountMicros).toBe(2210210000);
	});

	test('existing row with PDF and amount, same attribution → skipped without any write', async () => {
		selectQueue.push([mappedAccount]);
		selectQueue.push([{ id: 'inv-row-3', pdfPath: 'tenant-1/old.pdf', totalAmountMicros: 2210210000, googleAdsCustomerId: '5249299051', clientId: 'client-1' }]);
		const result = await persistGoogleInvoicePdf(baseInput);
		expect(result.status).toBe('skipped');
		expect(updates).toHaveLength(0);
	});
});
