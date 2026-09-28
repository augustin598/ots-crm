import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Bug 2026-09-28 (OTS 561, Lucky Group): încasarea înregistrată în Keez ajunge în
// CRM prin sync ca `status='paid'`, dar fără niciun hook → creditul de ore nu se
// alimentează, deși clientul are bifa „facturile plătite alimentează creditul".
// Sync-ul emite `invoice.paid.synced` DOAR la tranziția în `paid` — nu hook-ul
// complet `invoice.paid`, ca să nu declanșeze DirectAdmin și notificările staff.

const errorLogs: string[] = [];
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: (_cat: string, msg: string) => {
		errorLogs.push(msg);
	},
	serializeError: (err: unknown) => ({
		message: err instanceof Error ? err.message : String(err)
	})
}));

const { isPaidTransition, emitKeezPaidTransition } = await import('./paid-transition');
import type { InvoicePaidSyncedEvent } from '../types';

function makeEmit() {
	const events: InvoicePaidSyncedEvent[] = [];
	const emit = async (event: InvoicePaidSyncedEvent) => {
		events.push(event);
	};
	return { emit, events };
}

beforeEach(() => {
	errorLogs.length = 0;
});

describe('isPaidTransition', () => {
	it('sent → paid este tranziție de încasare', () => {
		expect(isPaidTransition('sent', 'paid')).toBe(true);
	});

	it('overdue → paid este tranziție de încasare', () => {
		expect(isPaidTransition('overdue', 'paid')).toBe(true);
	});

	it('paid → paid NU re-emite (sync-ul rulează zilnic pe aceeași factură)', () => {
		expect(isPaidTransition('paid', 'paid')).toBe(false);
	});

	it('paid → sent nu e încasare', () => {
		expect(isPaidTransition('paid', 'sent')).toBe(false);
	});

	it('status nou lipsă (update fără schimbare de status) nu e încasare', () => {
		expect(isPaidTransition('sent', undefined)).toBe(false);
		expect(isPaidTransition('sent', null)).toBe(false);
	});
});

describe('emitKeezPaidTransition', () => {
	it('emite invoice.paid.synced cu sursa keez la tranziția în paid', async () => {
		const { emit, events } = makeEmit();
		const emitted = await emitKeezPaidTransition({
			tenantId: 't1',
			invoiceId: 'inv1',
			invoiceNumber: 'OTS 561',
			previousStatus: 'sent',
			newStatus: 'paid',
			emit
		});
		expect(emitted).toBe(true);
		expect(events).toEqual([
			{
				type: 'invoice.paid.synced',
				tenantId: 't1',
				invoiceId: 'inv1',
				invoiceNumber: 'OTS 561',
				source: 'keez'
			}
		]);
	});

	it('nu emite nimic când statusul nu trece în paid', async () => {
		const { emit, events } = makeEmit();
		const emitted = await emitKeezPaidTransition({
			tenantId: 't1',
			invoiceId: 'inv1',
			invoiceNumber: 'OTS 561',
			previousStatus: 'paid',
			newStatus: 'paid',
			emit
		});
		expect(emitted).toBe(false);
		expect(events).toHaveLength(0);
	});

	it('o excepție din ascultători nu strică sincronizarea și ajunge în log', async () => {
		const emit = async () => {
			throw new Error('BNR indisponibil');
		};
		const emitted = await emitKeezPaidTransition({
			tenantId: 't1',
			invoiceId: 'inv1',
			invoiceNumber: 'OTS 561',
			previousStatus: 'sent',
			newStatus: 'paid',
			emit
		});
		expect(emitted).toBe(false);
		expect(errorLogs.some((m) => m.includes('OTS 561') && m.includes('BNR indisponibil'))).toBe(
			true
		);
	});
});
