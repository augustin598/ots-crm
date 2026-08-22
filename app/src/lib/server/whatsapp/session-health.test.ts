import { describe, expect, it, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/db/schema', () => ({ whatsappSession: {} }));
mock.module('$lib/server/logger', () => ({ logError: () => {}, logInfo: () => {} }));

const { HEARTBEAT_STALE_MS, decideSessionAction } = await import('./session-health');

const now = new Date('2026-08-22T10:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('ce face gardianul cu o sesiune', () => {
	it('o sesiune care nu trebuie să fie conectată se lasă în pace', () => {
		for (const status of ['disconnected', 'qr_pending', 'needs_reauth', 'connecting']) {
			expect(
				decideSessionAction({ status, lastHeartbeatAt: null, activeInThisProcess: false, now })
			).toEqual({ action: 'none', reason: 'not-wanted' });
		}
	});

	it('dacă socketul e chiar aici, doar batem', () => {
		expect(
			decideSessionAction({
				status: 'connected',
				lastHeartbeatAt: ago(10 * 60_000),
				activeInThisProcess: true,
				now
			})
		).toEqual({ action: 'heartbeat', reason: 'we-hold-it' });
	});

	it('bătaie proaspătă de la alt pod: nu ne atingem de ea', () => {
		expect(
			decideSessionAction({
				status: 'connected',
				lastHeartbeatAt: ago(HEARTBEAT_STALE_MS - 1000),
				activeInThisProcess: false,
				now
			})
		).toEqual({ action: 'none', reason: 'fresh' });
	});

	it('bătaie învechită: preluăm', () => {
		expect(
			decideSessionAction({
				status: 'connected',
				lastHeartbeatAt: ago(HEARTBEAT_STALE_MS + 1000),
				activeInThisProcess: false,
				now
			})
		).toEqual({ action: 'takeover', reason: 'stale' });
	});

	it('fără nicio bătaie (pod oprit care a curățat-o): preluăm imediat', () => {
		expect(
			decideSessionAction({
				status: 'connected',
				lastHeartbeatAt: null,
				activeInThisProcess: false,
				now
			})
		).toEqual({ action: 'takeover', reason: 'stale' });
	});

	it('pragul e de trei bătăi ratate', () => {
		expect(HEARTBEAT_STALE_MS).toBe(180_000);
	});
});
