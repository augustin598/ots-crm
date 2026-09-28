import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Legătura hook → creditul de ore. `invoice.paid` vine din plățile din CRM,
// `invoice.paid.synced` din sincronizarea Keez (bug 2026-09-28, OTS 561).

const creditCalls: Array<Record<string, unknown>> = [];
let creditResult: Record<string, unknown> = { status: 'credited', minutes: 60 };
mock.module('../hour-credits', () => ({
	creditPaidInvoice: async (params: Record<string, unknown>) => {
		creditCalls.push(params);
		if (creditResult.throw) throw new Error(String(creditResult.throw));
		return creditResult;
	}
}));

const infoLogs: string[] = [];
const warnLogs: string[] = [];
const errorLogs: string[] = [];
mock.module('$lib/server/logger', () => ({
	logInfo: (_c: string, m: string) => {
		infoLogs.push(m);
	},
	logWarning: (_c: string, m: string) => {
		warnLogs.push(m);
	},
	logError: (_c: string, m: string) => {
		errorLogs.push(m);
	},
	serializeError: (err: unknown) => ({
		message: err instanceof Error ? err.message : String(err)
	})
}));

const { getHooksManager, resetHooksManager } = await import('../plugins/hooks');
const { registerHourCreditHooks } = await import('./hour-credit-hooks');

const REGISTERED = Symbol.for('ots_crm_hour_credit_hooks_registered');

beforeEach(() => {
	creditCalls.length = 0;
	infoLogs.length = 0;
	warnLogs.length = 0;
	errorLogs.length = 0;
	creditResult = { status: 'credited', minutes: 60 };
	resetHooksManager();
	Reflect.deleteProperty(globalThis, REGISTERED);
	registerHourCreditHooks();
});

describe('registerHourCreditHooks', () => {
	it('invoice.paid.synced creditează factura cu trigger keez-sync, fără user', async () => {
		await getHooksManager().emit({
			type: 'invoice.paid.synced',
			tenantId: 't1',
			invoiceId: 'inv1',
			invoiceNumber: 'OTS 561',
			source: 'keez'
		});
		expect(creditCalls).toEqual([
			{ tenantId: 't1', invoiceId: 'inv1', trigger: 'keez-sync', userId: null }
		]);
	});

	it('invoice.paid creditează cu trigger hook și userul care a marcat plata', async () => {
		await getHooksManager().emit({
			type: 'invoice.paid',
			invoice: { id: 'inv2' } as never,
			tenantId: 't1',
			userId: 'u1'
		});
		expect(creditCalls).toEqual([
			{ tenantId: 't1', invoiceId: 'inv2', trigger: 'hook', userId: 'u1' }
		]);
	});

	it('înregistrarea e idempotentă (HMR nu dublează ascultătorii)', async () => {
		registerHourCreditHooks();
		await getHooksManager().emit({
			type: 'invoice.paid.synced',
			tenantId: 't1',
			invoiceId: 'inv1',
			invoiceNumber: null,
			source: 'keez'
		});
		expect(creditCalls).toHaveLength(1);
	});

	it('`failed` din sync-ul Keez se loghează ca avertisment — singura recuperare e manuală', async () => {
		creditResult = { status: 'failed', reason: 'curs BNR indisponibil pentru 2026-09-22' };
		await getHooksManager().emit({
			type: 'invoice.paid.synced',
			tenantId: 't1',
			invoiceId: 'inv1',
			invoiceNumber: 'OTS 561',
			source: 'keez'
		});
		expect(warnLogs.some((m) => m.includes('inv1') && m.includes('curs BNR'))).toBe(true);
		expect(errorLogs).toHaveLength(0);
	});

	it('`skipped` (client fără bifă) rămâne la nivel info', async () => {
		creditResult = { status: 'skipped', reason: 'clientul nu are bifa' };
		await getHooksManager().emit({
			type: 'invoice.paid.synced',
			tenantId: 't1',
			invoiceId: 'inv1',
			invoiceNumber: 'OTS 561',
			source: 'keez'
		});
		expect(infoLogs.some((m) => m.includes('inv1') && m.includes('skipped'))).toBe(true);
		expect(warnLogs).toHaveLength(0);
	});

	it('o excepție din creditare nu se propagă în emit (nu strică sync-ul sau plata)', async () => {
		creditResult = { throw: 'DB locked' };
		await expect(
			getHooksManager().emit({
				type: 'invoice.paid.synced',
				tenantId: 't1',
				invoiceId: 'inv1',
				invoiceNumber: 'OTS 561',
				source: 'keez'
			})
		).resolves.toBeUndefined();
		expect(errorLogs.some((m) => m.includes('DB locked'))).toBe(true);
	});
});
