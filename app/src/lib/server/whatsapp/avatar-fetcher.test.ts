import { describe, it, expect, beforeEach } from 'bun:test';
import {
	_resetAvatarFetcherForTests,
	_inspectQueueForTests,
	enqueueFetch
} from './avatar-fetcher';

describe('avatar-fetcher queue', () => {
	beforeEach(() => _resetAvatarFetcherForTests());

	it('dedups same phone within a tenant', () => {
		enqueueFetch('tenant-a', '+40111', { skipWorker: true });
		enqueueFetch('tenant-a', '+40111', { skipWorker: true });
		enqueueFetch('tenant-a', '+40222', { skipWorker: true });
		const q = _inspectQueueForTests('tenant-a');
		expect(q.pending).toEqual(['+40111', '+40222']);
	});

	it('does not dedup across tenants', () => {
		enqueueFetch('tenant-a', '+40111', { skipWorker: true });
		enqueueFetch('tenant-b', '+40111', { skipWorker: true });
		expect(_inspectQueueForTests('tenant-a').pending).toEqual(['+40111']);
		expect(_inspectQueueForTests('tenant-b').pending).toEqual(['+40111']);
	});

	it('dedups against in-flight set', () => {
		enqueueFetch('tenant-a', '+40111', { skipWorker: true });
		const q = _inspectQueueForTests('tenant-a');
		// simulate worker pulling the job: move from pending to inFlight
		q.pending.shift();
		q.inFlight.add('+40111');

		enqueueFetch('tenant-a', '+40111', { skipWorker: true });
		expect(q.pending).toEqual([]);
	});
});
