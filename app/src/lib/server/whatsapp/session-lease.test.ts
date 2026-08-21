import { describe, expect, it, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/db/schema', () => ({ whatsappSession: {} }));

const {
	ALERT_AFTER_MS,
	ALERT_REPEAT_MS,
	HEARTBEAT_INTERVAL_MS,
	LEASE_STALE_MS,
	canClaim,
	instanceId,
	isLeaseFresh,
	shouldAlert,
	staleForMs
} = await import('./session-lease');

const NOW = new Date('2026-08-22T10:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('isLeaseFresh', () => {
	it('un rând fără proprietar nu e ținut de nimeni', () => {
		expect(isLeaseFresh({ ownerInstanceId: null, heartbeatAt: NOW }, NOW)).toBe(false);
	});

	it('un proprietar fără urmă nu contează ca viu', () => {
		// Exact starea de acum: `status = connected` de la un pod mort de ore.
		expect(isLeaseFresh({ ownerInstanceId: 'pod-a', heartbeatAt: null }, NOW)).toBe(false);
	});

	it('urma de acum un minut e proaspătă', () => {
		expect(
			isLeaseFresh({ ownerInstanceId: 'pod-a', heartbeatAt: ago(HEARTBEAT_INTERVAL_MS) }, NOW)
		).toBe(true);
	});

	it('urma mai veche decât pragul nu mai ține pe nimeni', () => {
		expect(
			isLeaseFresh({ ownerInstanceId: 'pod-a', heartbeatAt: ago(LEASE_STALE_MS + 1) }, NOW)
		).toBe(false);
	});
});

describe('canClaim', () => {
	it('al doilea pod de la rollout nu ia socketul cât timp primul dă semn', () => {
		const row = { ownerInstanceId: 'pod-vechi', heartbeatAt: ago(10_000) };
		expect(canClaim(row, 'pod-nou', NOW)).toBe(false);
	});

	it('îl ia după ce primul tace de trei bătăi', () => {
		const row = { ownerInstanceId: 'pod-vechi', heartbeatAt: ago(LEASE_STALE_MS + 1000) };
		expect(canClaim(row, 'pod-nou', NOW)).toBe(true);
	});

	it('rândul liber e al oricui', () => {
		expect(canClaim({ ownerInstanceId: null, heartbeatAt: null }, 'pod-nou', NOW)).toBe(true);
	});

	it('propriul lease se poate relua oricând (reconectarea automată)', () => {
		const row = { ownerInstanceId: 'pod-a', heartbeatAt: ago(LEASE_STALE_MS * 5) };
		expect(canClaim(row, 'pod-a', NOW)).toBe(true);
	});
});

describe('staleForMs', () => {
	it('fără urmă nu se poate spune de cât e liniște', () => {
		expect(staleForMs({ ownerInstanceId: 'pod-a', heartbeatAt: null }, NOW)).toBeNull();
	});

	it('întoarce vechimea urmei', () => {
		expect(staleForMs({ ownerInstanceId: 'pod-a', heartbeatAt: ago(90_000) }, NOW)).toBe(90_000);
	});
});

describe('shouldAlert', () => {
	it('tăcerea sub prag nu e alarmă (o repornire normală durează secunde)', () => {
		expect(shouldAlert({ heartbeatAt: ago(60_000), staleAlertAt: null }, NOW)).toBe(false);
	});

	it('peste prag, fără alarmă anterioară, se dă alarma', () => {
		expect(shouldAlert({ heartbeatAt: ago(ALERT_AFTER_MS + 1), staleAlertAt: null }, NOW)).toBe(true);
	});

	it('nu repetă alarma dată acum cinci minute', () => {
		expect(
			shouldAlert({ heartbeatAt: ago(20 * 60_000), staleAlertAt: ago(5 * 60_000) }, NOW)
		).toBe(false);
	});

	it('repetă după fereastra de liniște', () => {
		expect(
			shouldAlert({ heartbeatAt: ago(60 * 60_000), staleAlertAt: ago(ALERT_REPEAT_MS + 1000) }, NOW)
		).toBe(true);
	});

	it('o sesiune care n-a scris niciodată o urmă e tratată ca tăcere completă', () => {
		// Rândurile dinainte de migrare: `connected`, dar fără heartbeat.
		expect(shouldAlert({ heartbeatAt: null, staleAlertAt: null }, NOW)).toBe(true);
	});
});

describe('instanceId', () => {
	it('e stabil în același proces', () => {
		expect(instanceId()).toBe(instanceId());
	});

	it('nu e doar numele gazdei, ca un pod repornit să nu moștenească lease-ul', () => {
		const host = process.env.HOSTNAME || process.env.POD_NAME || 'local';
		expect(instanceId()).not.toBe(host);
		expect(instanceId().startsWith(`${host}-`)).toBe(true);
	});
});
