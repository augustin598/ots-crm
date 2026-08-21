/**
 * Partea cu bază de date a lease-ului: cine iese din `UPDATE`-ul condiționat.
 *
 * Testul nu urmărește SQL-ul, ci deciziile: cererea normală trece prin condiția
 * de preluare, cererea forțată nu, iar `rowsAffected = 0` înseamnă „nu tu".
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));

// Operatorii drizzle devin noduri simple, ca să se poată inspecta condiția.
mock.module('drizzle-orm', () => ({
	and: (...parts: unknown[]) => ({ op: 'and', parts }),
	or: (...parts: unknown[]) => ({ op: 'or', parts }),
	eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
	lt: (col: unknown, val: unknown) => ({ op: 'lt', col, val }),
	inArray: (col: unknown, val: unknown) => ({ op: 'inArray', col, val }),
	isNull: (col: unknown) => ({ op: 'isNull', col }),
	isNotNull: (col: unknown) => ({ op: 'isNotNull', col })
}));

mock.module('$lib/server/db/schema', () => ({
	whatsappSession: {
		tenantId: 'tenant_id',
		status: 'status',
		phoneE164: 'phone_e164',
		ownerInstanceId: 'owner_instance_id',
		heartbeatAt: 'heartbeat_at',
		staleAlertAt: 'stale_alert_at',
		updatedAt: 'updated_at',
		lastDisconnectedAt: 'last_disconnected_at'
	}
}));

let rowsAffected = 1;
const updateCalls: Array<{ values: Record<string, unknown>; where: any }> = [];
let selectRows: unknown[] = [];
const selectWheres: any[] = [];

function selectChain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, {
		from: () => selectChain(rows),
		where: (w: unknown) => {
			selectWheres.push(w);
			return selectChain(rows);
		},
		limit: () => selectChain(rows)
	});
}

mock.module('$lib/server/db', () => ({
	db: {
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: async (where: any) => {
					updateCalls.push({ values, where });
					return { rowsAffected };
				}
			})
		}),
		select: () => selectChain(selectRows)
	}
}));

const { claimLease, renewLease, releaseLease, listOrphanSessions, instanceId } = await import(
	'./session-lease'
);

/** Adună operatorii dintr-un arbore de condiții, ca să se poată căuta în el. */
function ops(node: any): string[] {
	if (!node || typeof node !== 'object') return [];
	const here = node.op ? [node.op] : [];
	const kids = Array.isArray(node.parts) ? node.parts.flatMap(ops) : [];
	return [...here, ...kids];
}

beforeEach(() => {
	rowsAffected = 1;
	updateCalls.length = 0;
	selectWheres.length = 0;
	selectRows = [];
});

describe('claimLease', () => {
	test('cererea normală cere ca lease-ul să fie liber sau expirat', async () => {
		const ok = await claimLease('t1');
		expect(ok).toBe(true);
		const where = updateCalls[0].where;
		// tenant ȘI (fără proprietar SAU eu SAU fără urmă SAU urmă veche)
		expect(where.op).toBe('and');
		expect(ops(where)).toContain('or');
		expect(ops(where)).toContain('lt');
		expect(updateCalls[0].values.ownerInstanceId).toBe(instanceId());
		expect(updateCalls[0].values.heartbeatAt).toBeInstanceOf(Date);
	});

	test('rowsAffected 0 înseamnă că socketul e ținut de altcineva', async () => {
		rowsAffected = 0;
		expect(await claimLease('t1')).toBe(false);
	});

	test('force ia lease-ul indiferent cine îl ține', async () => {
		await claimLease('t1', { force: true });
		const where = updateCalls[0].where;
		// Doar tenantul, fără condiția de preluare: omul a cerut-o explicit.
		expect(where.op).toBe('eq');
		expect(ops(where)).not.toContain('or');
	});

	test('preluarea șterge alarma anterioară', async () => {
		await claimLease('t1');
		expect(updateCalls[0].values.staleAlertAt).toBeNull();
	});
});

describe('renewLease', () => {
	test('scrie urma doar dacă lease-ul e încă al nostru', async () => {
		await renewLease('t1');
		const conditions = updateCalls[0].where.parts.map((p: any) => p.val);
		expect(conditions).toContain('t1');
		expect(conditions).toContain(instanceId());
	});

	test('întoarce false când lease-ul a trecut la altcineva', async () => {
		rowsAffected = 0;
		expect(await renewLease('t1')).toBe(false);
	});
});

describe('releaseLease', () => {
	test('golește proprietarul și urma, condiționat pe proprietar', async () => {
		await releaseLease('t1', { status: 'disconnected' });
		expect(updateCalls[0].values.ownerInstanceId).toBeNull();
		expect(updateCalls[0].values.heartbeatAt).toBeNull();
		expect(updateCalls[0].values.status).toBe('disconnected');
		const conditions = updateCalls[0].where.parts.map((p: any) => p.val);
		expect(conditions).toContain(instanceId());
	});
});

describe('listOrphanSessions', () => {
	test('cere sesiuni cu telefon, în stări preluabile și fără urmă proaspătă', async () => {
		selectRows = [{ tenantId: 't1', status: 'connected', heartbeatAt: null, ownerInstanceId: null }];
		const rows = await listOrphanSessions();
		expect(rows).toHaveLength(1);
		const where = selectWheres[0];
		const kinds = ops(where);
		expect(kinds).toContain('inArray'); // stările preluabile
		expect(kinds).toContain('isNotNull'); // telefon pus, adică sesiune împerecheată
		expect(kinds).toContain('or'); // fără proprietar, fără urmă sau urmă veche
	});
});
