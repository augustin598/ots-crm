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
mock.module('$lib/server/plugins/keez/db-retry', () => ({
	withTursoBusyRetry: (op: () => Promise<unknown>) => op()
}));
// Notificările pleacă după commit; aici nu ne interesează conținutul lor.
const notifications: Array<{ clientId: string; kind: string }> = [];
mock.module('$lib/server/hour-credit-notifications', () => ({
	notifyHourCreditEvent: async (p: { clientId: string; event: { kind: string } }) => {
		notifications.push({ clientId: p.clientId, kind: p.event.kind });
	}
}));
// Numerotarea reală citește integrarea Keez; în test e irelevantă.
let invoiceSeq = 0;
mock.module('$lib/server/invoice-utils', () => ({
	generateInvoiceNumber: async () => `TEST-${++invoiceSeq}`
}));

const table = await import('$lib/server/db/schema');
const { creditPaidInvoice, getClientHourCredit, listUncreditedInvoices, applyLedgerEntry } =
	await import('../hour-credits');
const { settleTaskCredit, reverseTaskCredit, computeReservedMinutes, assertTaskReopenAllowed } =
	await import('../task-credit');

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
	await testDb.delete(table.invoiceLineItem);
	await testDb.delete(table.clientHourLedger);
	await testDb.delete(table.task);
	await testDb.delete(table.invoice);
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
	test('credit suficient: 3 h Development consumă 3 h 33 min ponderat', async () => {
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
			consumedMinutes: 213,
			overageRealMinutes: 0,
			overageInvoiceId: null
		});
		expect(await balance()).toBe(600 - 213);
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
		expect(await balance()).toBe(387);
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
		// 180 min reale − 60/1,1818 min acoperite = 129,2 → 135 (pas 15).
		expect(r.overageRealMinutes).toBe(135);
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
		expect(line.quantity).toBe(2.25); // 135 min
		expect(line.rate).toBe(6500); // 65 €/h în cenți
		expect(line.amount).toBe(14625); // 2,25 h × 65 € = 146,25 €
		expect(draft.amount).toBe(14625);
		expect(draft.taxAmount).toBe(Math.round((14625 * 2100) / 10000));
		expect(draft.totalAmount).toBe(14625 + draft.taxAmount!);
		expect(await ledgerKinds()).toEqual([
			'manual:60',
			'task_consumption:-60',
			'overage_invoiced:0'
		]);
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
});

describe('rezervări și sold', () => {
	test('estimările task-urilor deschise se ponderează; cele decontate nu mai contează', async () => {
		await insertTask('task-open', { estimatedMinutes: 120, rateSlug: 'development' });
		await insertTask('task-pm', { estimatedMinutes: 60, rateSlug: 'project-management' });
		await insertTask('task-done', { estimatedMinutes: 600, status: 'done' });
		await insertTask('task-cancelled', { estimatedMinutes: 600, status: 'cancelled' });

		const reserved = await computeReservedMinutes(TENANT, [CLIENT]);
		// 120 × 65/55 = 141,8 → 142; PM 60 × 1 = 60.
		expect(reserved.get(CLIENT)).toBe(142 + 60);
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
		await insertTask('task-8', { estimatedMinutes: 60, rateSlug: 'project-management' });
		await settleTaskCredit({ tenantId: TENANT, taskId: 'task-8', userId: USER });
		const view = await getClientHourCredit(TENANT, CLIENT);
		const sum = view!.entries.reduce((s, e) => s + e.deltaMinutes, 0);
		expect(sum).toBe(view!.balanceMinutes);
		expect(view!.balanceMinutes).toBe(240);
	});
});

afterAll(() => {
	client.close();
	rmSync(dbPath, { force: true });
});
