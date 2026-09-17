/**
 * Creditul de ore, cap-coadă pe o bază REALĂ (libSQL în memorie, cu migrările
 * aplicate). Aici se verifică exact ce nu poate verifica un test cu DB mock-uit:
 * tranzacția de consum cu UPDATE condiționat, idempotența pe indexul unic parțial,
 * draftul lunar de depășire cu linia lui și stornarea la reopen.
 *
 * Notificările (email/WhatsApp) sunt mock-uite: ele pleacă după commit și au
 * propriul flux.
 */
import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { mock } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));

// Fișier temporar, NU `:memory:`: prima tranzacție libSQL deschide o conexiune
// nouă, iar pe `:memory:` aceea e o bază GOALĂ (tabelele „dispar" în mijlocul testului).
const dbPath = join(tmpdir(), `ots-hour-credits-${crypto.randomUUID()}.db`);
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
// `withTursoBusyRetry` rămâne REAL: pe prod, o tranzacție care pică cu SQLITE_BUSY
// e reluată de la capăt, iar testele de concurență trebuie să vadă exact reluarea.
// Notificările pleacă după commit; aici nu ne interesează conținutul lor.
const notifications: Array<{ clientId: string; kind: string }> = [];
mock.module('$lib/server/hour-credit-notifications', () => ({
	notifyHourCreditEvent: async (p: { clientId: string; event: { kind: string } }) => {
		notifications.push({ clientId: p.clientId, kind: p.event.kind });
	}
}));
// Numerotarea reală citește integrarea Keez; în test e irelevantă.
let invoiceSeq = 0;
// Cârlig de o singură folosire: rulează în mijlocul decontării, DUPĂ commit-ul
// consumului și ÎNAINTE de linia de depășire — fereastra în care intră un reopen
// concurent sau în care pică emiterea draftului.
let beforeInvoiceNumber: (() => Promise<unknown>) | null = null;
mock.module('$lib/server/invoice-utils', () => ({
	generateInvoiceNumber: async () => {
		const hook = beforeInvoiceNumber;
		beforeInvoiceNumber = null;
		if (hook) await hook();
		return `TEST-${++invoiceSeq}`;
	}
}));

const table = await import('$lib/server/db/schema');
const {
	creditPaidInvoice,
	getClientHourCredit,
	listUncreditedInvoices,
	listClientCreditTasks,
	listHoursOrders,
	creditPaidHoursOrder,
	listCancelledCreditedInvoices,
	reverseCancelledInvoiceCredit,
	applyLedgerEntry
} = await import('../hour-credits');
const {
	settleTaskCredit,
	reverseTaskCredit,
	computeReservedMinutes,
	assertTaskReopenAllowed,
	listUnbilledOverages,
	regenerateOverageDraft,
	detachOverageInvoiceTasks,
	listUnsettledDoneTasks
} = await import('../task-credit');

const { processHourCreditExpiry } = await import('../scheduler/tasks/hour-credit-expiry');
const { getHourlyCatalog } = await import('../hourly-catalog');
const { getZeroVatLegalNote } = await import('../vat/classify-client');

const TENANT = 't-int';
const USER = 'u-int';
const CLIENT = 'c-int';

async function balance(): Promise<number> {
	const [row] = await testDb
		.select({ b: table.client.hourCreditMinutes })
		.from(table.client)
		.where(eq(table.client.id, CLIENT))
		.limit(1);
	return row?.b ?? 0;
}

async function ledgerKinds(): Promise<string[]> {
	const rows = await testDb
		.select({ kind: table.clientHourLedger.kind, delta: table.clientHourLedger.deltaMinutes })
		.from(table.clientHourLedger)
		.where(eq(table.clientHourLedger.clientId, CLIENT));
	return rows.map((r) => `${r.kind}:${r.delta}`);
}

async function insertTask(id: string, over: Partial<typeof table.task.$inferInsert> = {}) {
	await testDb.insert(table.task).values({
		id,
		tenantId: TENANT,
		clientId: CLIENT,
		title: `Task ${id}`,
		status: 'in-progress',
		estimatedMinutes: 180,
		actualMinutes: 180,
		rateSlug: 'development',
		modeSlug: 'standard',
		createdAt: new Date(),
		updatedAt: new Date(),
		...over
	});
}

// Migrarea și fixture-urile rulează la încărcarea modulului (top-level await):
// hook-urile Bun nu garantează ordinea față de `beforeEach` într-un fișier cu import-uri async.
// Cale absolută: runner-ul pornește fiecare fișier cu cwd propriu.
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
	.values({ id: 'tu-int', tenantId: TENANT, userId: USER, role: 'owner' });
await testDb
	.insert(table.invoiceSettings)
	.values({ id: 'is-int', tenantId: TENANT, defaultTaxRate: 21 });
// Cursul BNR al zilei plății (RON → EUR).
await testDb.insert(table.bnrExchangeRate).values({
	id: 'bnr-int',
	currency: 'EUR',
	rate: 4.96,
	multiplier: 1,
	rateDate: new Date().toISOString().slice(0, 10)
});

beforeEach(async () => {
	notifications.length = 0;
	beforeInvoiceNumber = null;
	await testDb.delete(table.invoiceLineItem);
	await testDb.delete(table.clientHourLedger);
	await testDb.delete(table.task);
	await testDb.delete(table.invoice);
	await testDb.delete(table.serviceHoursOrder);
	await testDb.delete(table.client);
	await testDb.insert(table.client).values({
		id: CLIENT,
		tenantId: TENANT,
		name: 'Lucky Group',
		email: 'client@test.ro',
		hourCreditMinutes: 0,
		hourCreditFromInvoices: true
	});
});

describe('alimentare din facturi plătite', () => {
	async function paidInvoice(id: string, over: Partial<typeof table.invoice.$inferInsert> = {}) {
		await testDb.insert(table.invoice).values({
			id,
			tenantId: TENANT,
			clientId: CLIENT,
			createdByUserId: USER,
			invoiceNumber: `OTS-${id}`,
			status: 'paid',
			amount: 560800, // 5.608,00 RON net
			currency: 'RON',
			paidDate: new Date(),
			...over
		});
	}

	test('5.608 RON la cursul 4,96 și referința 55 €/h → 20 h 30 min, idempotent', async () => {
		await paidInvoice('inv-1');
		const first = await creditPaidInvoice({
			tenantId: TENANT,
			invoiceId: 'inv-1',
			trigger: 'hook'
		});
		expect(first).toEqual({ status: 'credited', minutes: 1230 });
		expect(await balance()).toBe(1230);
		expect(notifications).toEqual([{ clientId: CLIENT, kind: 'credited' }]);

		// A doua livrare a aceluiași eveniment nu mai mișcă nimic (index unic parțial).
		const second = await creditPaidInvoice({
			tenantId: TENANT,
			invoiceId: 'inv-1',
			trigger: 'hook'
		});
		expect(second).toEqual({ status: 'already_credited' });
		expect(await balance()).toBe(1230);
		expect(await ledgerKinds()).toEqual(['invoice_credit:1230']);
	});

	test('excluderile nu creditează: hosting, ads, depășire', async () => {
		await paidInvoice('inv-host', { hostingAccountId: 'h1' });
		await paidInvoice('inv-ads', { externalSource: 'meta-ads' });
		await paidInvoice('inv-over', { externalSource: 'hour-overage' });
		for (const id of ['inv-host', 'inv-ads', 'inv-over']) {
			const r = await creditPaidInvoice({ tenantId: TENANT, invoiceId: id, trigger: 'hook' });
			expect(r.status).toBe('skipped');
		}
		expect(await balance()).toBe(0);
		// Nu apar nici în lista „Necreditate" (sunt ne-eligibile structural).
		expect(await listUncreditedInvoices(TENANT)).toEqual([]);
	});

	test('factura creditată, apoi anulată, e semnalată și se poate storna o singură dată', async () => {
		await paidInvoice('inv-cancel');
		await creditPaidInvoice({ tenantId: TENANT, invoiceId: 'inv-cancel', trigger: 'hook' });
		// Ore din „Adaugă ore": creditul e legat de factură ca `purchase`.
		await paidInvoice('inv-hc-cancel', { externalSource: 'hour-credit', status: 'sent' });
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 180,
			kind: 'purchase',
			sourceType: 'invoice',
			sourceId: 'inv-hc-cancel',
			note: '3 h adăugate din admin'
		});
		expect(await balance()).toBe(1230 + 180);
		expect(await listCancelledCreditedInvoices(TENANT)).toEqual([]);

		await testDb
			.update(table.invoice)
			.set({ status: 'cancelled' })
			.where(eq(table.invoice.tenantId, TENANT));
		const flagged = await listCancelledCreditedInvoices(TENANT);
		expect(flagged.map((f) => [f.invoiceId, f.creditedMinutes]).sort()).toEqual([
			['inv-cancel', 1230],
			['inv-hc-cancel', 180]
		]);

		const r1 = await reverseCancelledInvoiceCredit({
			tenantId: TENANT,
			invoiceId: 'inv-cancel',
			userId: USER
		});
		expect(r1).toEqual({ status: 'reversed', minutes: 1230 });
		await reverseCancelledInvoiceCredit({
			tenantId: TENANT,
			invoiceId: 'inv-hc-cancel',
			userId: USER
		});
		expect(await balance()).toBe(0);
		expect(await ledgerKinds()).toContain('invoice_credit_reversal:-1230');
		expect(await ledgerKinds()).toContain('purchase_reversal:-180');
		expect(await listCancelledCreditedInvoices(TENANT)).toEqual([]);

		const again = await reverseCancelledInvoiceCredit({
			tenantId: TENANT,
			invoiceId: 'inv-cancel',
			userId: USER
		});
		expect(again.status).toBe('already_reversed');
		expect(await balance()).toBe(0);
	});

	test('storna refuzată pe o factură care nu e anulată', async () => {
		await paidInvoice('inv-live');
		await creditPaidInvoice({ tenantId: TENANT, invoiceId: 'inv-live', trigger: 'hook' });
		const r = await reverseCancelledInvoiceCredit({
			tenantId: TENANT,
			invoiceId: 'inv-live',
			userId: USER
		});
		expect(r.status).toBe('skipped');
		expect(await balance()).toBe(1230);
	});

	test('factura plătită din „Adaugă ore" nu apare în „Necreditate"', async () => {
		// Orele ei au intrat la emitere; în listă ar invita la o creditare care e refuzată.
		await paidInvoice('inv-hc', { externalSource: 'hour-credit' });
		const r = await creditPaidInvoice({ tenantId: TENANT, invoiceId: 'inv-hc', trigger: 'hook' });
		expect(r.status).toBe('skipped');
		expect(await listUncreditedInvoices(TENANT)).toEqual([]);
	});

	test('clientul nebifat nu se creditează, dar factura apare în „Necreditate"', async () => {
		await testDb
			.update(table.client)
			.set({ hourCreditFromInvoices: false })
			.where(eq(table.client.id, CLIENT));
		await paidInvoice('inv-2');
		const r = await creditPaidInvoice({ tenantId: TENANT, invoiceId: 'inv-2', trigger: 'hook' });
		expect(r.status).toBe('skipped');
		// Lista cere bifa pe client, deci e goală până la bifare.
		expect(await listUncreditedInvoices(TENANT)).toEqual([]);

		await testDb
			.update(table.client)
			.set({ hourCreditFromInvoices: true })
			.where(eq(table.client.id, CLIENT));
		const pending = await listUncreditedInvoices(TENANT);
		expect(pending.map((p) => p.invoiceId)).toEqual(['inv-2']);
		// Creditarea manuală din Bugete ore o scoate din listă.
		await creditPaidInvoice({
			tenantId: TENANT,
			invoiceId: 'inv-2',
			trigger: 'manual',
			userId: USER
		});
		expect(await listUncreditedInvoices(TENANT)).toEqual([]);
	});
});

describe('consumul task-urilor', () => {
	test('credit suficient: 3 h Development consumă exact 3 h (ore reale, nu ponderate)', async () => {
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 600,
			kind: 'manual',
			sourceType: 'manual',
			sourceId: 'seed-1',
			note: 'seed test'
		});
		await insertTask('task-1');
		const r = await settleTaskCredit({ tenantId: TENANT, taskId: 'task-1', userId: USER });
		expect(r).toEqual({
			status: 'settled',
			consumedMinutes: 180,
			overageRealMinutes: 0,
			overageInvoiceId: null
		});
		expect(await balance()).toBe(600 - 180);
		// Fără depășire → niciun draft de factură.
		const drafts = await testDb.select().from(table.invoice);
		expect(drafts).toHaveLength(0);
	});

	test('a doua decontare a aceluiași task e no-op (credit_settled_at)', async () => {
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 600,
			kind: 'manual',
			sourceType: 'manual',
			sourceId: 'seed-2',
			note: 'seed test'
		});
		await insertTask('task-2');
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-2', userId: USER });
		const again = await settleTaskCredit({ tenantId: TENANT, taskId: 'task-2', userId: USER });
		expect(again).toEqual({ status: 'skipped', reason: 'deja decontat' });
		expect(await balance()).toBe(420);
	});

	test('credit insuficient: se scade cât există, restul intră în draftul lunar', async () => {
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 60,
			kind: 'manual',
			sourceType: 'manual',
			sourceId: 'seed-3',
			note: 'seed test'
		});
		await insertTask('task-3');
		const r = await settleTaskCredit({ tenantId: TENANT, taskId: 'task-3', userId: USER });
		expect(r.status).toBe('settled');
		if (r.status !== 'settled') return;
		expect(r.consumedMinutes).toBe(60);
		// 180 min reale − 60 acoperite = 120.
		expect(r.overageRealMinutes).toBe(120);
		expect(await balance()).toBe(0);

		const [draft] = await testDb.select().from(table.invoice);
		expect(draft.status).toBe('draft');
		expect(draft.externalSource).toBe('hour-overage');
		expect(draft.notes?.startsWith('hour-overage:')).toBe(true);
		expect(draft.currency).toBe('EUR');
		const [line] = await testDb
			.select()
			.from(table.invoiceLineItem)
			.where(eq(table.invoiceLineItem.invoiceId, draft.id));
		expect(line.taskId).toBe('task-3');
		expect(line.quantity).toBe(2); // 120 min
		expect(line.rate).toBe(6500); // 65 €/h în cenți
		expect(line.amount).toBe(13000); // 2 h × 65 € = 130 €
		expect(draft.amount).toBe(13000);
		expect(draft.taxAmount).toBe(Math.round((13000 * 2100) / 10000));
		expect(draft.totalAmount).toBe(13000 + draft.taxAmount!);
		expect(await ledgerKinds()).toEqual([
			'manual:60',
			'task_consumption:-60',
			'overage_invoiced:0'
		]);
	});

	test('linia de depășire: suma vine din minute (10 min × 65 € = 10,83 €, nu 11,05 €)', async () => {
		// Pas 10 ca să existe o depășire de 10 min; la final revine la 15.
		const setStep = (stepMinutes: number) =>
			testDb
				.insert(table.hourCreditSettings)
				.values({ id: 'hcs-int', tenantId: TENANT, stepMinutes })
				.onConflictDoUpdate({
					target: table.hourCreditSettings.tenantId,
					set: { stepMinutes }
				});
		await setStep(10);
		try {
			await insertTask('t-amt', { estimatedMinutes: 10, actualMinutes: 10 });
			const r = await settleTaskCredit({ tenantId: TENANT, taskId: 't-amt', userId: USER });
			if (r.status !== 'settled' || !r.overageInvoiceId) throw new Error('fără draft');
			const [line] = await testDb
				.select()
				.from(table.invoiceLineItem)
				.where(eq(table.invoiceLineItem.taskId, 't-amt'));
			expect(line.amount).toBe(1083);
			expect(line.rate).toBe(6500);
			expect(line.note).toContain('10 min × 65 €/h');
		} finally {
			await setStep(15);
		}
	});

	test('draftul de depășire: client intracomunitar → TVA 0% și mențiunea legală la FINALUL notelor', async () => {
		await testDb
			.update(table.client)
			.set({ country: 'DE', cui: 'DE123456789' })
			.where(eq(table.client.id, CLIENT));
		await insertTask('t-vat0');
		const r = await settleTaskCredit({ tenantId: TENANT, taskId: 't-vat0', userId: USER });
		if (r.status !== 'settled' || !r.overageInvoiceId) throw new Error('fără draft');
		const [draft] = await testDb.select().from(table.invoice);
		const [line] = await testDb
			.select()
			.from(table.invoiceLineItem)
			.where(eq(table.invoiceLineItem.taskId, 't-vat0'));
		expect(line.taxRate).toBe(0);
		expect(draft.taxRate).toBe(0);
		expect(draft.taxAmount).toBe(0);
		expect(draft.totalAmount).toBe(draft.amount);
		// Markerul rămâne primul: findOrCreateOverageDraft caută draftul după prefix.
		expect(draft.notes?.startsWith('hour-overage:')).toBe(true);
		expect(draft.notes?.endsWith(getZeroVatLegalNote('intracom')!)).toBe(true);
	});

	test('al doilea task al aceleiași luni intră pe ACELAȘI draft', async () => {
		await insertTask('task-4a');
		await insertTask('task-4b');
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-4a', userId: USER });
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-4b', userId: USER });
		const drafts = await testDb.select().from(table.invoice);
		expect(drafts).toHaveLength(1);
		const lines = await testDb.select().from(table.invoiceLineItem);
		expect(lines).toHaveLength(2);
		expect(drafts[0].amount).toBe(lines[0].amount! + lines[1].amount!);
	});

	test('reopen: stornează consumul, scoate linia și șterge draftul rămas gol', async () => {
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 60,
			kind: 'manual',
			sourceType: 'manual',
			sourceId: 'seed-5',
			note: 'seed test'
		});
		await insertTask('task-5');
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-5', userId: USER });
		expect(await balance()).toBe(0);

		const rev = await reverseTaskCredit({ tenantId: TENANT, taskId: 'task-5', userId: USER });
		expect(rev).toEqual({ reversedMinutes: 60 });
		expect(await balance()).toBe(60);
		expect(await testDb.select().from(table.invoice)).toHaveLength(0);
		expect(await testDb.select().from(table.invoiceLineItem)).toHaveLength(0);
		const [task] = await testDb.select().from(table.task).where(eq(table.task.id, 'task-5'));
		expect(task.creditSettledAt).toBeNull();
		expect(task.actualMinutes).toBeNull();
		expect(task.overageInvoiceId).toBeNull();
	});

	test('reopen după un Done fără consum nu restituie consumul unui ciclu anterior', async () => {
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 180,
			kind: 'manual',
			sourceType: 'manual',
			sourceId: 'seed-cycle',
			note: 'seed test'
		});
		await insertTask('task-cycle');
		// Ciclul 1: Done consumă 180, reopen le dă înapoi.
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-cycle', userId: USER });
		await reverseTaskCredit({ tenantId: TENANT, taskId: 'task-cycle', userId: USER });
		expect(await balance()).toBe(180);

		// Soldul se golește din altă parte; ciclul 2 nu mai are ce consuma.
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: -180,
			kind: 'manual',
			sourceType: 'manual',
			sourceId: 'drain-cycle',
			note: 'golire test'
		});
		// Reopen-ul golește (deocamdată) orele efective, deci ciclul 2 le primește explicit.
		const second = await settleTaskCredit({
			tenantId: TENANT,
			taskId: 'task-cycle',
			userId: USER,
			actualMinutes: 180
		});
		expect(second.status === 'settled' && second.consumedMinutes).toBe(0);

		// Reopen-ul ciclului 2 nu are ce storna: nimic nu s-a scăzut.
		const rev = await reverseTaskCredit({ tenantId: TENANT, taskId: 'task-cycle', userId: USER });
		expect(rev).toEqual({ reversedMinutes: 0 });
		expect(await balance()).toBe(0);
	});

	test('două Done simultane pe același task consumă o singură dată', async () => {
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 600,
			kind: 'manual',
			sourceType: 'manual',
			sourceId: 'seed-race',
			note: 'seed test'
		});
		await insertTask('task-race');
		const results = await Promise.all([
			settleTaskCredit({ tenantId: TENANT, taskId: 'task-race', userId: USER }),
			settleTaskCredit({ tenantId: TENANT, taskId: 'task-race', userId: USER })
		]);
		expect(results.filter((r) => r.status === 'settled')).toHaveLength(1);
		expect(await balance()).toBe(600 - 180);
		expect((await ledgerKinds()).filter((k) => k.startsWith('task_consumption'))).toHaveLength(1);
	});

	test('două reopen simultane pe același task stornează o singură dată', async () => {
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 600,
			kind: 'manual',
			sourceType: 'manual',
			sourceId: 'seed-race-rev',
			note: 'seed test'
		});
		await insertTask('task-race-rev');
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-race-rev', userId: USER });
		await Promise.all([
			reverseTaskCredit({ tenantId: TENANT, taskId: 'task-race-rev', userId: USER }),
			reverseTaskCredit({ tenantId: TENANT, taskId: 'task-race-rev', userId: USER })
		]);
		expect(await balance()).toBe(600);
		expect((await ledgerKinds()).filter((k) => k.startsWith('task_reversal'))).toHaveLength(1);
	});

	test('reopen refuzat după ce draftul de depășire a fost emis fiscal', async () => {
		await insertTask('task-6');
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-6', userId: USER });
		const [draft] = await testDb.select().from(table.invoice);
		// Adminul a confirmat draftul → a plecat în Keez.
		await testDb
			.update(table.invoice)
			.set({ status: 'sent', keezStatus: 'Valid' })
			.where(eq(table.invoice.id, draft.id));
		await expect(assertTaskReopenAllowed(TENANT, 'task-6')).rejects.toThrow(
			/nu mai poate fi redeschis/
		);
		await expect(
			reverseTaskCredit({ tenantId: TENANT, taskId: 'task-6', userId: USER })
		).rejects.toThrow();

		// Un task nou al lunii nu mai scrie pe factura emisă: deschide draftul lunii următoare.
		await insertTask('task-7');
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-7', userId: USER });
		const invoices = await testDb.select().from(table.invoice);
		expect(invoices).toHaveLength(2);
		const fresh = invoices.find((i) => i.status === 'draft');
		expect(fresh).toBeDefined();
		const lines = await testDb
			.select()
			.from(table.invoiceLineItem)
			.where(eq(table.invoiceLineItem.invoiceId, fresh!.id));
		expect(lines.map((l) => l.taskId)).toEqual(['task-7']);
	});

	test('Done fără ore efective nu consumă estimarea și rămâne în „De rezolvat"', async () => {
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 600,
			kind: 'manual',
			sourceType: 'manual',
			sourceId: 'seed-d8',
			note: 'seed test'
		});
		await insertTask('t-d8', { status: 'done', actualMinutes: null });
		const r = await settleTaskCredit({ tenantId: TENANT, taskId: 't-d8', userId: USER });
		expect(r).toEqual({ status: 'skipped', reason: 'fără ore efective' });
		expect(await balance()).toBe(600);
		expect((await listUnsettledDoneTasks(TENANT)).map((t) => t.taskId)).toContain('t-d8');
	});

	test('timpul lucrat se rotunjește o singură dată: 142 min cu sold 100 → 100 din credit, 50 depășire', async () => {
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 100,
			kind: 'manual',
			sourceType: 'manual',
			sourceId: 'seed-round',
			note: 'seed test'
		});
		await insertTask('t-round', { actualMinutes: 142 });
		const r = await settleTaskCredit({ tenantId: TENANT, taskId: 't-round', userId: USER });
		expect(r.status).toBe('settled');
		if (r.status !== 'settled') return;
		expect(r.consumedMinutes).toBe(100);
		expect(r.overageRealMinutes).toBe(50);
		expect(await balance()).toBe(0);
		const rows = await testDb
			.select()
			.from(table.clientHourLedger)
			.where(eq(table.clientHourLedger.sourceId, 't-round'));
		const consumption = rows.find((x) => x.kind === 'task_consumption');
		expect(consumption?.deltaMinutes).toBe(-100);
		expect(consumption?.realMinutes).toBe(142);
		const overage = rows.find((x) => x.kind === 'overage_invoiced');
		expect(overage?.deltaMinutes).toBe(0);
		expect(overage?.realMinutes).toBe(50);
	});

	test('sold 0: 7 min lucrate → nimic din credit, 15 min depășire, soldul rămâne 0', async () => {
		await insertTask('t-zero', { actualMinutes: 7 });
		const r = await settleTaskCredit({ tenantId: TENANT, taskId: 't-zero', userId: USER });
		expect(r.status).toBe('settled');
		if (r.status !== 'settled') return;
		expect(r.consumedMinutes).toBe(0);
		expect(r.overageRealMinutes).toBe(15);
		expect(await balance()).toBe(0);
	});

	test('sold negativ (−20): 60 min lucrate → nimic din credit, 60 min depășire, soldul rămâne −20', async () => {
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: -20,
			kind: 'manual',
			sourceType: 'manual',
			sourceId: 'seed-negative',
			note: 'seed test'
		});
		expect(await balance()).toBe(-20);
		await insertTask('t-neg', { actualMinutes: 60 });
		const r = await settleTaskCredit({ tenantId: TENANT, taskId: 't-neg', userId: USER });
		expect(r.status).toBe('settled');
		if (r.status !== 'settled') return;
		expect(r.consumedMinutes).toBe(0);
		expect(r.overageRealMinutes).toBe(60);
		expect(await balance()).toBe(-20);
	});

	test('credit suficient: 142 min lucrate scad 150 din credit', async () => {
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 600,
			kind: 'manual',
			sourceType: 'manual',
			sourceId: 'seed-round2',
			note: 'seed test'
		});
		await insertTask('t-round2', { actualMinutes: 142 });
		await settleTaskCredit({ tenantId: TENANT, taskId: 't-round2', userId: USER });
		expect(await balance()).toBe(450);
	});
});

describe('depășirea: ferestre dintre consum și draft', () => {
	async function overageLines(taskId: string) {
		return testDb
			.select()
			.from(table.invoiceLineItem)
			.where(eq(table.invoiceLineItem.taskId, taskId));
	}
	async function taskRow(taskId: string) {
		const [row] = await testDb.select().from(table.task).where(eq(table.task.id, taskId));
		return row;
	}

	test('reopen concurent între consum și linia de depășire nu lasă linie orfană', async () => {
		await insertTask('task-gap');
		// Reopen-ul intră exact după commit-ul consumului, înainte să existe linia.
		beforeInvoiceNumber = () =>
			reverseTaskCredit({ tenantId: TENANT, taskId: 'task-gap', userId: USER });
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-gap', userId: USER });

		const task = await taskRow('task-gap');
		expect(task.creditSettledAt).toBeNull();
		expect(task.overageInvoiceId).toBeNull();
		// Fără linie rămasă: altfel Done-ul următor ar factura depășirea a doua oară.
		expect(await overageLines('task-gap')).toHaveLength(0);

		// Reopen-ul golește (deocamdată) orele efective, deci Done-ul următor le primește explicit.
		await settleTaskCredit({
			tenantId: TENANT,
			taskId: 'task-gap',
			userId: USER,
			actualMinutes: 180
		});
		expect(await overageLines('task-gap')).toHaveLength(1);
	});

	test('reopen scoate linia taskului chiar dacă task.overage_invoice_id n-a apucat să se scrie', async () => {
		await insertTask('task-orphan');
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-orphan', userId: USER });
		// Legătura pierdută (update eșuat după inserarea liniei).
		await testDb
			.update(table.task)
			.set({ overageInvoiceId: null })
			.where(eq(table.task.id, 'task-orphan'));

		await reverseTaskCredit({ tenantId: TENANT, taskId: 'task-orphan', userId: USER });
		expect(await overageLines('task-orphan')).toHaveLength(0);
		// Draftul rămas gol dispare.
		expect(await testDb.select().from(table.invoice)).toHaveLength(0);
	});

	test('draftul care pică după consum lasă urmă și se poate regenera, o singură dată', async () => {
		await insertTask('task-fail');
		beforeInvoiceNumber = async () => {
			throw new Error('numerotare indisponibilă');
		};
		const r = await settleTaskCredit({ tenantId: TENANT, taskId: 'task-fail', userId: USER });
		expect(r.status === 'settled' && r.overageInvoiceId).toBeNull();
		expect(await overageLines('task-fail')).toHaveLength(0);
		// Depășirea NU se pierde: rândul de urmă există și taskul apare ca nefacturat.
		expect(await ledgerKinds()).toContain('overage_invoiced:0');
		const unbilled = await listUnbilledOverages(TENANT);
		expect(unbilled.map((u) => [u.taskId, u.overageRealMinutes])).toEqual([['task-fail', 180]]);

		const regen = await regenerateOverageDraft({ tenantId: TENANT, taskId: 'task-fail' });
		expect(regen.status).toBe('billed');
		const lines = await overageLines('task-fail');
		expect(lines).toHaveLength(1);
		expect(lines[0].quantity).toBe(3);
		expect(lines[0].rate).toBe(6500);
		expect((await taskRow('task-fail')).overageInvoiceId).toBe(lines[0].invoiceId);
		expect(await listUnbilledOverages(TENANT)).toEqual([]);

		const again = await regenerateOverageDraft({ tenantId: TENANT, taskId: 'task-fail' });
		expect(again.status).toBe('already_billed');
		expect(await overageLines('task-fail')).toHaveLength(1);
	});

	test('regenerarea refolosește linia existentă dacă doar legătura s-a pierdut', async () => {
		await insertTask('task-relink');
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-relink', userId: USER });
		const [line] = await overageLines('task-relink');
		await testDb
			.update(table.task)
			.set({ overageInvoiceId: null })
			.where(eq(table.task.id, 'task-relink'));

		expect((await listUnbilledOverages(TENANT)).map((u) => u.taskId)).toEqual(['task-relink']);
		const regen = await regenerateOverageDraft({ tenantId: TENANT, taskId: 'task-relink' });
		expect(regen.status).toBe('billed');
		expect(await overageLines('task-relink')).toHaveLength(1);
		expect((await taskRow('task-relink')).overageInvoiceId).toBe(line.invoiceId);
	});

	test('ștergerea draftului desprinde taskurile, care devin „depășire nefacturată"', async () => {
		await insertTask('task-del');
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-del', userId: USER });
		const [draft] = await testDb.select().from(table.invoice);
		await testDb.transaction(async (tx) => {
			await detachOverageInvoiceTasks(
				tx as unknown as Parameters<typeof detachOverageInvoiceTasks>[0],
				TENANT,
				draft.id
			);
			await tx.delete(table.invoice).where(eq(table.invoice.id, draft.id));
		});
		expect((await taskRow('task-del')).overageInvoiceId).toBeNull();
		expect((await listUnbilledOverages(TENANT)).map((u) => u.taskId)).toEqual(['task-del']);
	});

	test('taskurile Done cu ore, rămase nedecontate, sunt listate', async () => {
		await insertTask('task-done-open', { status: 'done', estimatedMinutes: 60 });
		await insertTask('task-done-settled', { status: 'done', estimatedMinutes: 60 });
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-done-settled', userId: USER });
		await insertTask('task-open', { status: 'in-progress', estimatedMinutes: 60 });
		await insertTask('task-done-no-hours', {
			status: 'done',
			estimatedMinutes: null,
			actualMinutes: null
		});

		const rows = await listUnsettledDoneTasks(TENANT);
		expect(rows.map((r) => r.taskId)).toEqual(['task-done-open']);
		expect(rows[0].clientName).toBe('Lucky Group');
	});
});

describe('jobul de expirare, pe bază reală', () => {
	const DAY = 86_400_000;

	async function enableExpiry() {
		await testDb
			.insert(table.hourCreditSettings)
			.values({ id: 'hcs-int', tenantId: TENANT, creditExpiryDays: 30 })
			.onConflictDoUpdate({
				target: table.hourCreditSettings.tenantId,
				set: { creditExpiryDays: 30 }
			});
	}

	test('reopen după termen: minutele expiră la rularea următoare, o singură dată', async () => {
		await enableExpiry();
		const now = Date.now();
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 600,
			kind: 'purchase',
			sourceType: 'hours_order',
			sourceId: 'ord-exp',
			note: 'lot care a expirat ieri',
			expiresAt: new Date(now - DAY)
		});
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 300,
			kind: 'manual',
			sourceType: 'manual',
			sourceId: 'noexp',
			note: 'credit fără termen'
		});
		// Taskul consumase din lot înainte de termen: 500 min lucrate → 510 facturabile (pas 15).
		await insertTask('task-exp', {
			estimatedMinutes: 500,
			actualMinutes: 500,
			rateSlug: 'project-management'
		});
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-exp', userId: USER });
		expect(await balance()).toBe(390);

		// Rularea 1: expiră restul de 90 al lotului.
		const r1 = await processHourCreditExpiry({ tenantId: TENANT });
		expect(r1.minutesExpired).toBe(90);
		expect(await balance()).toBe(300);

		// Reopen după termen: cele 510 restituite aparțin lotului expirat.
		await reverseTaskCredit({ tenantId: TENANT, taskId: 'task-exp', userId: USER });
		expect(await balance()).toBe(810);
		const [r2, r2bis] = await Promise.all([
			processHourCreditExpiry({ tenantId: TENANT }),
			processHourCreditExpiry({ tenantId: TENANT })
		]);
		// Rulări paralele: doar una scrie; cealaltă vede conflictul (sau recitește) și raportează 0.
		expect(r2.minutesExpired + r2bis.minutesExpired).toBe(510);
		expect(await balance()).toBe(300);
		expect((await ledgerKinds()).filter((k) => k.startsWith('expire'))).toEqual([
			'expire:-90',
			'expire:-510'
		]);

		// Creditul fără termen nu e atins, iar rularea 3 nu mai are nimic de expirat.
		const r3 = await processHourCreditExpiry({ tenantId: TENANT });
		expect(r3.minutesExpired).toBe(0);
		expect(await balance()).toBe(300);
	});
});

describe('jobul de expirare: concurență și repornire', () => {
	const DAY = 86_400_000;

	async function setExpiry(days: number, enabledAt: Date | null) {
		await testDb
			.insert(table.hourCreditSettings)
			.values({
				id: 'hcs-int',
				tenantId: TENANT,
				creditExpiryDays: days,
				creditExpiryEnabledAt: enabledAt
			})
			.onConflictDoUpdate({
				target: table.hourCreditSettings.tenantId,
				set: { creditExpiryDays: days, creditExpiryEnabledAt: enabledAt }
			});
	}

	test('Done strecurat între citirea și scrierea expirării: soldul nu devine negativ, depășirea se facturează', async () => {
		await setExpiry(30, null);
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 600,
			kind: 'purchase',
			sourceType: 'hours_order',
			sourceId: 'ord-race',
			note: 'singurul credit, expirat ieri',
			expiresAt: new Date(Date.now() - DAY)
		});
		await insertTask('task-race-exp', { estimatedMinutes: 180, rateSlug: 'project-management' });
		await getHourlyCatalog(TENANT); // seed-ul catalogului în afara ferestrei de concurență

		let pending: ReturnType<typeof settleTaskCredit> | null = null;
		await processHourCreditExpiry({
			tenantId: TENANT,
			beforeWrite: async () => {
				if (pending) return;
				// Done-ul pornește după ce jobul a citit ledgerul; îi dăm timp să se comită.
				pending = settleTaskCredit({ tenantId: TENANT, taskId: 'task-race-exp', userId: USER });
				await new Promise((r) => setTimeout(r, 100));
			}
		});
		expect(pending).not.toBeNull();
		const settled = await pending!;

		// Orice ordine validă lasă soldul la 0: fie expiră 600 și Done-ul factură 180,
		// fie Done-ul consumă 180 și expiră doar 420.
		expect(await balance()).toBe(0);
		expect(settled.status).toBe('settled');
		const expired = (await ledgerKinds())
			.filter((k) => k.startsWith('expire'))
			.reduce((sum, k) => sum - Number(k.split(':')[1]), 0);
		const consumed = settled.status === 'settled' ? settled.consumedMinutes : -1;
		expect(expired + consumed).toBe(600);
	});

	test('repornire: termenele trecute cât expirarea a fost oprită nu mai expiră', async () => {
		const now = Date.now();
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 300,
			kind: 'purchase',
			sourceType: 'hours_order',
			sourceId: 'ord-while-off',
			note: 'termen în perioada oprită',
			expiresAt: new Date(now - 10 * DAY)
		});
		// Oprită până acum 2 zile, repornită atunci.
		await setExpiry(30, new Date(now - 2 * DAY));
		const r = await processHourCreditExpiry({ tenantId: TENANT });
		expect(r.minutesExpired).toBe(0);
		expect(await balance()).toBe(300);

		// Iar fișa nu mai arată creditul ca „expiră".
		const view = await getClientHourCredit(TENANT, CLIENT);
		expect(view!.expiring).toBeNull();
	});

	test('expirare oprită: fișa nu arată „expiră la…" pentru loturile vechi cu termen', async () => {
		await setExpiry(0, null);
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 300,
			kind: 'purchase',
			sourceType: 'hours_order',
			sourceId: 'ord-off',
			note: 'lot cu termen, expirare oprită',
			expiresAt: new Date(Date.now() + 5 * DAY)
		});
		const view = await getClientHourCredit(TENANT, CLIENT);
		expect(view!.expiring).toBeNull();
		expect(view!.expiringTotalMinutes).toBe(0);
	});
});

describe('rezervări și sold', () => {
	test('estimările task-urilor deschise rezervă ore reale; cele decontate nu mai contează', async () => {
		await insertTask('task-open', { estimatedMinutes: 120, rateSlug: 'development' });
		await insertTask('task-pm', { estimatedMinutes: 60, rateSlug: 'project-management' });
		await insertTask('task-done', { estimatedMinutes: 600, status: 'done' });
		await insertTask('task-cancelled', { estimatedMinutes: 600, status: 'cancelled' });

		const reserved = await computeReservedMinutes(TENANT, [CLIENT]);
		// Ore reale, indiferent de specializare.
		expect(reserved.get(CLIENT)).toBe(120 + 60);
	});

	test('soldul din cache e mereu suma ledger-ului', async () => {
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			deltaMinutes: 300,
			kind: 'purchase',
			sourceType: 'hours_order',
			sourceId: 'ord-1',
			note: 'ore cumpărate'
		});
		await insertTask('task-8', {
			estimatedMinutes: 60,
			actualMinutes: 60,
			rateSlug: 'project-management'
		});
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-8', userId: USER });
		const view = await getClientHourCredit(TENANT, CLIENT);
		const sum = view!.entries.reduce((s, e) => s + e.deltaMinutes, 0);
		expect(sum).toBe(view!.balanceMinutes);
		expect(view!.balanceMinutes).toBe(240);
	});
});

describe('listClientCreditTasks — tabelul „Consum pe taskuri"', () => {
	test('arată estimatul și pontatul, marcând ce e decontat', async () => {
		await insertTask('task-list-1', {
			title: 'Configurare GA4',
			estimatedMinutes: 90,
			actualMinutes: 150,
			rateSlug: 'development'
		});
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-list-1', userId: USER });
		await insertTask('task-list-2', { title: 'Optimizare viteză', estimatedMinutes: 120 });

		const rows = await listClientCreditTasks(TENANT, CLIENT);
		const settled = rows.find((r) => r.id === 'task-list-1')!;
		const open = rows.find((r) => r.id === 'task-list-2')!;

		expect(settled.estimatedMinutes).toBe(90);
		expect(settled.actualMinutes).toBe(150);
		// Depășirea (pontat > estimat) e ce colorează bara în roșu în UI.
		expect(settled.actualMinutes!).toBeGreaterThan(settled.estimatedMinutes!);
		expect(settled.creditSettledAt).not.toBeNull();

		// Taskul deschis încă rezervă: nu e decontat.
		expect(open.creditSettledAt).toBeNull();
		expect(open.estimatedMinutes).toBe(120);
	});

	test('taskurile fără ore nu apar', async () => {
		await insertTask('task-no-hours', { estimatedMinutes: null, actualMinutes: null });
		const rows = await listClientCreditTasks(TENANT, CLIENT);
		expect(rows.find((r) => r.id === 'task-no-hours')).toBeUndefined();
	});

	test('limita se aplică DUPĂ filtrul de ore: taskurile fără ore nu le împing afară', async () => {
		const old = new Date(Date.now() - 86_400_000);
		await insertTask('task-hours-old', { estimatedMinutes: 60, updatedAt: old });
		for (let i = 0; i < 5; i++) {
			await insertTask(`task-noise-${i}`, { estimatedMinutes: null, actualMinutes: null });
		}
		const rows = await listClientCreditTasks(TENANT, CLIENT, 3);
		expect(rows.map((r) => r.id)).toEqual(['task-hours-old']);
	});
});

describe('listHoursOrders — tabul „Comenzi ore"', () => {
	async function insertOrder(
		id: string,
		over: Partial<typeof table.serviceHoursOrder.$inferInsert> = {}
	) {
		await testDb.insert(table.serviceHoursOrder).values({
			id,
			tenantId: TENANT,
			clientId: CLIENT,
			rateSlug: 'development',
			rateLabel: 'Development',
			rateEur: 65,
			hours: 10,
			netCents: 65_000,
			vatCents: 13_650,
			grossCents: 78_650,
			vatPercent: 21,
			contactName: 'Test',
			contactEmail: 'client@test.ro',
			status: 'paid',
			...over
		});
	}

	test('creditul afișat e cel din ledger; neplătită = orele comandate (ore reale)', async () => {
		await testDb.delete(table.serviceHoursOrder);
		await insertOrder('ord-credited');
		await applyLedgerEntry({
			tenantId: TENANT,
			clientId: CLIENT,
			// Orele cumpărate intră ca ore reale: 10 h = 600 min, indiferent de specializare.
			deltaMinutes: 600,
			kind: 'purchase',
			sourceType: 'hours_order',
			sourceId: 'ord-credited',
			note: 'ore cumpărate'
		});
		await insertOrder('ord-pending', { status: 'pending_payment' });

		const rows = await listHoursOrders(TENANT);
		const credited = rows.find((r) => r.id === 'ord-credited')!;
		const pending = rows.find((r) => r.id === 'ord-pending')!;
		expect(credited.credited).toBe(true);
		expect(credited.creditMinutes).toBe(600);
		expect(pending.credited).toBe(false);
		expect(pending.creditMinutes).toBe(600);
	});

	test('comanda plătită de pe /servicii creditează orele cumpărate (ore reale)', async () => {
		await insertOrder('ord-paid-real', { hours: 3, netCents: 19_500 });
		const r = await creditPaidHoursOrder({ tenantId: TENANT, orderId: 'ord-paid-real' });
		expect(r).toEqual({ status: 'credited', minutes: 180 });
		expect(await balance()).toBe(180);
	});
});

afterAll(() => {
	client.close();
	rmSync(dbPath, { force: true });
});
