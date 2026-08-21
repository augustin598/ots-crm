import { beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));

const logs: Array<{ level: string; message: string }> = [];
mock.module('$lib/server/logger', () => ({
	logError: (_s: string, message: string) => {
		logs.push({ level: 'error', message });
	},
	logWarning: (_s: string, message: string) => {
		logs.push({ level: 'warning', message });
	},
	logInfo: (_s: string, message: string) => {
		logs.push({ level: 'info', message });
	},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e) })
}));

const notifications: Array<{ userId: string; type: string }> = [];
mock.module('$lib/server/notifications', () => ({
	createNotification: async (p: { userId: string; type: string }) => {
		notifications.push({ userId: p.userId, type: p.type });
	}
}));

const telegrams: Array<{ userId: string; text: string }> = [];
mock.module('$lib/server/telegram/sender', () => ({
	sendTelegramMessage: async (a: { userId: string; text: string }) => {
		telegrams.push(a);
		return { ok: true };
	}
}));

// Rândurile de sesiune, apoi rândurile de membri, în ordinea interogărilor.
let sessionRows: unknown[] = [];
let memberRows: unknown[] = [];
let selectCount = 0;
const updates: Array<Record<string, unknown>> = [];

function chain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, {
		from: () => chain(rows),
		innerJoin: () => chain(rows),
		where: () => chain(rows),
		limit: () => chain(rows)
	});
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => {
			selectCount++;
			return chain(selectCount === 1 ? sessionRows : memberRows);
		},
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: async () => {
					updates.push(values);
					return { rowsAffected: 1 };
				}
			})
		})
	}
}));

mock.module('$lib/server/db/schema', () => ({
	whatsappSession: {
		tenantId: 'tenant_id',
		status: 'status',
		phoneE164: 'phone_e164',
		heartbeatAt: 'heartbeat_at',
		staleAlertAt: 'stale_alert_at',
		ownerInstanceId: 'owner_instance_id'
	},
	tenant: { id: 'id', slug: 'slug' },
	tenantUser: { tenantId: 'tenant_id', userId: 'user_id', role: 'role' }
}));

const { processWhatsappSessionWatchdog } = await import('../whatsapp-session-watchdog');

const ago = (ms: number) => new Date(Date.now() - ms);

beforeEach(() => {
	logs.length = 0;
	notifications.length = 0;
	telegrams.length = 0;
	updates.length = 0;
	selectCount = 0;
	sessionRows = [];
	memberRows = [
		{ userId: 'u-admin', role: 'admin' },
		{ userId: 'u-membru', role: 'member' }
	];
});

describe('processWhatsappSessionWatchdog', () => {
	test('o sesiune cu urmă proaspătă nu produce nimic', async () => {
		sessionRows = [
			{
				tenantId: 't1',
				tenantSlug: 'ots',
				status: 'connected',
				heartbeatAt: ago(30_000),
				staleAlertAt: null,
				ownerInstanceId: 'pod-a'
			}
		];
		const res = await processWhatsappSessionWatchdog();
		expect(res).toEqual({ checked: 1, silent: 0, alerted: 0 });
		expect(updates).toHaveLength(0);
		expect(notifications).toHaveLength(0);
	});

	test('urma veche: statusul mincinos „connected" devine „disconnected"', async () => {
		sessionRows = [
			{
				tenantId: 't1',
				tenantSlug: 'ots',
				status: 'connected',
				heartbeatAt: ago(20 * 60_000),
				staleAlertAt: null,
				ownerInstanceId: 'pod-mort'
			}
		];
		const res = await processWhatsappSessionWatchdog();
		expect(res.silent).toBe(1);
		expect(updates[0].status).toBe('disconnected');
		// Alarma se marchează, ca să nu se repete la fiecare rulare.
		expect(updates.some((u) => 'staleAlertAt' in u)).toBe(true);
	});

	test('alarma ajunge la administratori, nu la toată lumea', async () => {
		sessionRows = [
			{
				tenantId: 't1',
				tenantSlug: 'ots',
				status: 'connected',
				heartbeatAt: ago(20 * 60_000),
				staleAlertAt: null,
				ownerInstanceId: 'pod-mort'
			}
		];
		await processWhatsappSessionWatchdog();
		expect(notifications).toEqual([{ userId: 'u-admin', type: 'whatsapp.session_down' }]);
		expect(telegrams).toHaveLength(1);
		expect(telegrams[0].userId).toBe('u-admin');
		expect(logs.some((l) => l.level === 'error' && l.message.includes('WhatsApp fără socket'))).toBe(
			true
		);
	});

	test('alarma dată acum zece minute nu se repetă', async () => {
		sessionRows = [
			{
				tenantId: 't1',
				tenantSlug: 'ots',
				status: 'disconnected',
				heartbeatAt: ago(60 * 60_000),
				staleAlertAt: ago(10 * 60_000),
				ownerInstanceId: 'pod-mort'
			}
		];
		const res = await processWhatsappSessionWatchdog();
		expect(res.silent).toBe(1);
		expect(res.alerted).toBe(0);
		expect(notifications).toHaveLength(0);
	});

	test('o sesiune fără urmă deloc e tratată ca tăcere completă', async () => {
		// Rândurile dinainte de migrare, sau un pod care a murit înainte de prima bătaie.
		sessionRows = [
			{
				tenantId: 't1',
				tenantSlug: 'ots',
				status: 'connected',
				heartbeatAt: null,
				staleAlertAt: null,
				ownerInstanceId: null
			}
		];
		const res = await processWhatsappSessionWatchdog();
		expect(res.alerted).toBe(1);
		expect(updates[0].status).toBe('disconnected');
	});
});
