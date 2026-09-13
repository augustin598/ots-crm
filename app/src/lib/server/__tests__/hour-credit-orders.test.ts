/**
 * „Adaugă ore unui client" — fluxul din admin, pe bază REALĂ (libSQL pe fișier,
 * cu migrările aplicate).
 *
 * Ce apără testele de aici:
 *  - creditul intră ÎNAINTEA facturii și rămâne acordat chiar dacă Keez refuză;
 *  - un push Keez respins NU se raportează ca reușit (regresie: `pushInvoiceToKeez`
 *    întoarce `{ success: false }`, nu aruncă — prima versiune marca push-ul ca
 *    reușit și adminul nu vedea niciun avertisment);
 *  - factura poartă marcajul care o oprește să crediteze a doua oară la plată.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { mock } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));

const dbPath = join(tmpdir(), `ots-hour-orders-${crypto.randomUUID()}.db`);
const client = createClient({ url: `file:${dbPath}` });
const testDb = drizzle(client);

mock.module('$lib/server/db', () => ({ db: testDb }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({
		message: e instanceof Error ? e.message : String(e),
		stack: ''
	})
}));
mock.module('$lib/server/plugins/keez/db-retry', () => ({
	withTursoBusyRetry: (op: () => Promise<unknown>) => op()
}));
mock.module('$lib/server/hour-credit-notifications', () => ({
	notifyHourCreditEvent: async () => {}
}));
mock.module('$lib/server/invoice-utils', () => ({
	getNextInvoiceNumberFromPlugin: async () => 'OTS 100'
}));
// `$app/environment` ajunge aici prin lanțul de importuri al emitentului Keez.
mock.module('$app/environment', () => ({ dev: false, browser: false, building: false }));

/** Ce întoarce Keez la următorul push — fiecare test îl setează. */
let keezResult: { success: boolean; externalId?: string; error?: string } = {
	success: true,
	externalId: 'kz-1'
};
let keezCalls = 0;
mock.module('$lib/server/plugins/keez/auto-push', () => ({
	pushInvoiceToKeez: async () => {
		keezCalls++;
		return keezResult;
	},
	validateInvoiceInKeezForTenant: async () => ({ success: true })
}));

const emails: string[] = [];
let emailThrows = false;
mock.module('$lib/server/email', () => ({
	sendInvoiceEmail: async (invoiceId: string, to: string) => {
		if (emailThrows) throw new Error('SMTP down');
		emails.push(`${invoiceId}->${to}`);
	}
}));

// Cursul BNR: îl dăm direct, ca testul să nu depindă de tabelă/rețea.
let bnrRate: { rate: number; rateDate: Date } | null = {
	rate: 4.96,
	rateDate: new Date()
};
mock.module('$lib/server/bnr/client', () => ({
	getLatestBnrRateWithDate: async () => bnrRate,
	loadBnrFxRates: async () => ({})
}));

const table = await import('$lib/server/db/schema');
const { createHourCreditOrder, quoteHourCreditOrder } = await import('../hour-credit-orders');
const { invoiceCreditEligibility } = await import('$lib/logic/hour-credits');

const TENANT = 't-ord';
const USER = 'u-ord';
const CLIENT = 'c-ord';

const migrationsFolder = new URL('../../../../drizzle', import.meta.url).pathname;
await migrate(testDb, { migrationsFolder });
await testDb.insert(table.tenant).values({ id: TENANT, name: 'Test SRL', slug: 'test' });
await testDb.insert(table.user).values({
	id: USER,
	email: 'owner@test.ro',
	firstName: 'Owner',
	lastName: 'Test',
	passwordHash: 'x'
});
await testDb
	.insert(table.tenantUser)
	.values({ id: 'tu-ord', tenantId: TENANT, userId: USER, role: 'owner' });
await testDb
	.insert(table.invoiceSettings)
	.values({ id: 'is-ord', tenantId: TENANT, defaultTaxRate: 21 });

beforeEach(async () => {
	emails.length = 0;
	keezCalls = 0;
	keezResult = { success: true, externalId: 'kz-1' };
	emailThrows = false;
	bnrRate = { rate: 4.96, rateDate: new Date() };
	await testDb.delete(table.invoiceLineItem);
	await testDb.delete(table.clientHourLedger);
	await testDb.delete(table.invoice);
	await testDb.delete(table.client);
	await testDb.insert(table.client).values({
		id: CLIENT,
		tenantId: TENANT,
		name: 'Lucky Group',
		email: 'client@test.ro',
		hourCreditMinutes: 0,
		hourCreditFromInvoices: false
	});
});

async function balance(): Promise<number> {
	const [row] = await testDb
		.select({ b: table.client.hourCreditMinutes })
		.from(table.client)
		.where(eq(table.client.id, CLIENT))
		.limit(1);
	return row?.b ?? 0;
}

const baseInput = {
	tenantId: TENANT,
	clientId: CLIENT,
	userId: USER,
	rateSlug: 'development',
	modeSlug: 'urgent',
	hours: 3,
	sendEmail: true
};

describe('quoteHourCreditOrder', () => {
	test('tariful efectiv se rotunjește la euro întreg (65 × 150% = 97,5 → 98)', async () => {
		const q = await quoteHourCreditOrder({
			tenantId: TENANT,
			rateSlug: 'development',
			modeSlug: 'urgent',
			hours: 3
		});
		expect(q.ok).toBe(true);
		if (!q.ok) return;
		expect(q.effectiveRateEur).toBe(98);
		expect(q.netCents).toBe(29400);
		expect(q.vatPercent).toBe(21);
	});

	test('creditul se rotunjește la pasul configurat, ca la creditarea din facturi', async () => {
		const q = await quoteHourCreditOrder({
			tenantId: TENANT,
			rateSlug: 'development',
			modeSlug: 'urgent',
			hours: 3
		});
		expect(q.ok).toBe(true);
		if (!q.ok) return;
		// stepMinutes implicit = 15. Fără rotunjire ar ieși 320,7 → 321, care ar face
		// soldul clientului să nu mai fie multiplu de pas (spre deosebire de toate
		// celelalte alimentări).
		expect(q.creditMinutes % 15).toBe(0);
	});

	test('cota de TVA vine din setările tenantului, nu hardcodată', async () => {
		const q = await quoteHourCreditOrder({
			tenantId: TENANT,
			rateSlug: 'development',
			modeSlug: 'standard',
			hours: 1
		});
		expect(q.ok).toBe(true);
		if (!q.ok) return;
		// invoiceSettings.defaultTaxRate = 21 în fixture.
		expect(q.vatPercent).toBe(21);
		expect(q.vatCents).toBe(Math.round(q.netCents * 0.21));
		expect(q.zeroVatNote).toBeNull();
	});

	test('client intracomunitar → TVA 0% + mențiunea legală', async () => {
		await testDb
			.update(table.client)
			.set({ country: 'Germania', cui: 'DE123456789' })
			.where(eq(table.client.id, CLIENT));

		const q = await quoteHourCreditOrder({
			tenantId: TENANT,
			clientId: CLIENT,
			rateSlug: 'development',
			modeSlug: 'standard',
			hours: 1
		});
		expect(q.ok).toBe(true);
		if (!q.ok) return;
		expect(q.vatPercent).toBe(0);
		expect(q.vatCents).toBe(0);
		expect(q.grossCents).toBe(q.netCents);
		expect(q.zeroVatNote).toMatch(/intracomunitar/i);
	});

	test('client din România → cota normală', async () => {
		await testDb
			.update(table.client)
			.set({ country: 'România', cui: 'RO39988493' })
			.where(eq(table.client.id, CLIENT));

		const q = await quoteHourCreditOrder({
			tenantId: TENANT,
			clientId: CLIENT,
			rateSlug: 'development',
			modeSlug: 'standard',
			hours: 1
		});
		expect(q.ok).toBe(true);
		if (!q.ok) return;
		expect(q.vatPercent).toBe(21);
		expect(q.zeroVatNote).toBeNull();
	});

	test('peste plafonul regimului → refuz, cu motiv", fără efecte', async () => {
		const q = await quoteHourCreditOrder({
			tenantId: TENANT,
			rateSlug: 'development',
			modeSlug: 'urgent',
			hours: 9999
		});
		expect(q.ok).toBe(false);
	});
});

describe('createHourCreditOrder', () => {
	test('creditează, emite factura și trimite emailul', async () => {
		const res = await createHourCreditOrder(baseInput);

		expect(res.creditMinutes).toBeGreaterThan(0);
		expect(await balance()).toBe(res.creditMinutes);
		expect(res.invoiceId).not.toBeNull();
		expect(res.keezPushed).toBe(true);
		expect(res.emailSent).toBe(true);
		expect(res.warnings).toEqual([]);
		expect(emails).toHaveLength(1);
	});

	test('factura poartă marcajul care oprește a doua creditare la plată', async () => {
		const res = await createHourCreditOrder(baseInput);
		const [inv] = await testDb
			.select()
			.from(table.invoice)
			.where(eq(table.invoice.id, res.invoiceId!))
			.limit(1);

		expect(inv.externalSource).toBe('hour-credit');
		// Chiar plătită și cu clientul bifat, factura asta NU mai poate credita.
		const eligibility = invoiceCreditEligibility(
			{
				status: 'paid',
				hostingAccountId: null,
				externalSource: inv.externalSource,
				amount: inv.amount,
				currency: inv.currency
			},
			{ clientOptedIn: true, isHoursOrderInvoice: false }
		);
		expect(eligibility.eligible).toBe(false);
	});

	test('antetul e în RON la cursul BNR, linia rămâne în EUR', async () => {
		const res = await createHourCreditOrder(baseInput);
		const [inv] = await testDb
			.select()
			.from(table.invoice)
			.where(eq(table.invoice.id, res.invoiceId!))
			.limit(1);
		const [line] = await testDb
			.select()
			.from(table.invoiceLineItem)
			.where(eq(table.invoiceLineItem.invoiceId, res.invoiceId!))
			.limit(1);

		expect(inv.currency).toBe('RON');
		expect(inv.exchangeRate).toBe('4.9600');
		expect(inv.amount).toBe(Math.round(29400 * 4.96));
		expect(line.currency).toBe('EUR');
		expect(line.amount).toBe(29400);
		expect(line.quantity).toBe(3);
	});

	// Regresia: Keez refuză (ex. clientul are același CUI ca firma emitentă).
	test('push Keez respins → NU se raportează ca reușit și apare avertisment', async () => {
		keezResult = { success: false, error: 'CUI identic cu al emitentului' };

		const res = await createHourCreditOrder(baseInput);

		expect(keezCalls).toBe(1);
		expect(res.keezPushed).toBe(false);
		expect(res.warnings.join(' ')).toMatch(/Keez/);
		expect(res.warnings.join(' ')).toMatch(/CUI identic/);
		// Creditul rămâne acordat: orele sunt deja la client.
		expect(await balance()).toBe(res.creditMinutes);
		expect(res.invoiceId).not.toBeNull();
	});

	test('push Keez care aruncă → tot avertisment, creditul rămâne', async () => {
		mock.module('$lib/server/plugins/keez/auto-push', () => ({
			pushInvoiceToKeez: async () => {
				throw new Error('timeout');
			},
			validateInvoiceInKeezForTenant: async () => ({ success: true })
		}));
		const { createHourCreditOrder: fresh } = await import('../hour-credit-orders');

		const res = await fresh(baseInput);
		expect(res.keezPushed).toBe(false);
		expect(res.warnings.length).toBeGreaterThan(0);
		expect(await balance()).toBe(res.creditMinutes);

		// Restaurăm mock-ul pentru testele următoare.
		mock.module('$lib/server/plugins/keez/auto-push', () => ({
			pushInvoiceToKeez: async () => {
				keezCalls++;
				return keezResult;
			},
			validateInvoiceInKeezForTenant: async () => ({ success: true })
		}));
	});

	test('factura pentru client intracomunitar: 0% și taxApplicationType none', async () => {
		await testDb
			.update(table.client)
			.set({ country: 'Germania', cui: 'DE123456789' })
			.where(eq(table.client.id, CLIENT));

		const res = await createHourCreditOrder(baseInput);
		const [inv] = await testDb
			.select()
			.from(table.invoice)
			.where(eq(table.invoice.id, res.invoiceId!))
			.limit(1);

		expect(inv.taxAmount).toBe(0);
		expect(inv.taxApplicationType).toBe('none');
		expect(inv.totalAmount).toBe(inv.amount);
		expect(inv.notes).toMatch(/taxare inversă/i);
	});

	test('fără bifa de email nu pleacă nimic spre client', async () => {
		const res = await createHourCreditOrder({ ...baseInput, sendEmail: false });
		expect(res.emailSent).toBe(false);
		expect(emails).toHaveLength(0);
		expect(res.invoiceId).not.toBeNull();
	});

	test('email eșuat → avertisment, dar creditul și factura rămân', async () => {
		emailThrows = true;
		const res = await createHourCreditOrder(baseInput);
		expect(res.emailSent).toBe(false);
		expect(res.warnings.join(' ')).toMatch(/email/i);
		expect(res.invoiceId).not.toBeNull();
		expect(await balance()).toBe(res.creditMinutes);
	});

	test('fără curs BNR: creditul se acordă, factura NU se emite', async () => {
		bnrRate = null;
		const res = await createHourCreditOrder(baseInput);

		expect(await balance()).toBe(res.creditMinutes);
		expect(res.invoiceId).toBeNull();
		expect(res.emailSent).toBe(false);
		expect(res.warnings.join(' ')).toMatch(/BNR/);
	});
});
