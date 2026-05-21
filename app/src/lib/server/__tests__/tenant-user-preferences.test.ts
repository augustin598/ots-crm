import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));

// ─── Fake DB ──────────────────────────────────────────────────────────────────

const queryQueue: Array<unknown[]> = [];

function makeChain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, {
		from: () => makeChain(rows),
		where: () => makeChain(rows),
		limit: () => makeChain(rows)
	});
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeChain(queryQueue.length > 0 ? (queryQueue.shift() as unknown[]) : [])
	}
}));

// Schema mock — only the columns the helper reads
const col = (n: string) => n;
mock.module('$lib/server/db/schema', () => ({
	tenantUserPreferences: {
		userId: col('userId'),
		tenantId: col('tenantId'),
		notifyTaskAssigned: col('notifyTaskAssigned'),
		notifyNewComment: col('notifyNewComment'),
		notifyTaskStatusChange: col('notifyTaskStatusChange'),
		notifyTaskApprovedRejected: col('notifyTaskApprovedRejected'),
		notifyTaskReopened: col('notifyTaskReopened'),
		notifyMention: col('notifyMention')
	}
}));

const { tenantUserPrefAllows, tenantUserPrefAllowsBatch } = await import(
	'../tenant-user-preferences'
);

describe('tenantUserPrefAllows', () => {
	beforeEach(() => {
		queryQueue.length = 0;
	});

	test('returns true when no preferences row exists (default allow)', async () => {
		queryQueue.push([]); // empty row set
		const allowed = await tenantUserPrefAllows('user-1', 'tenant-a', 'notifyTaskAssigned');
		expect(allowed).toBe(true);
	});

	test('returns true when stored value is true', async () => {
		queryQueue.push([{ value: true }]);
		const allowed = await tenantUserPrefAllows('user-1', 'tenant-a', 'notifyNewComment');
		expect(allowed).toBe(true);
	});

	test('returns false when stored value is false', async () => {
		queryQueue.push([{ value: false }]);
		const allowed = await tenantUserPrefAllows(
			'user-1',
			'tenant-a',
			'notifyTaskStatusChange'
		);
		expect(allowed).toBe(false);
	});

	test('treats undefined value as allow (column missing on legacy rows)', async () => {
		queryQueue.push([{ value: undefined }]);
		const allowed = await tenantUserPrefAllows('user-1', 'tenant-a', 'notifyTaskReopened');
		expect(allowed).toBe(true);
	});

	test('works across all six notify keys', async () => {
		const keys = [
			'notifyTaskAssigned',
			'notifyNewComment',
			'notifyTaskStatusChange',
			'notifyTaskApprovedRejected',
			'notifyTaskReopened',
			'notifyMention'
		] as const;
		for (const key of keys) {
			queryQueue.push([{ value: false }]);
			const allowed = await tenantUserPrefAllows('user-1', 'tenant-a', key);
			expect(allowed).toBe(false);
		}
	});
});

describe('tenantUserPrefAllowsBatch', () => {
	beforeEach(() => {
		queryQueue.length = 0;
	});

	test('returns empty Map for empty userIds (no DB call)', async () => {
		const map = await tenantUserPrefAllowsBatch([], 'tenant-a', 'notifyTaskAssigned');
		expect(map.size).toBe(0);
		// Confirm no queryQueue consumption
		expect(queryQueue.length).toBe(0);
	});

	test('defaults all userIds to true when no rows exist', async () => {
		queryQueue.push([]); // empty result
		const map = await tenantUserPrefAllowsBatch(
			['u1', 'u2', 'u3'],
			'tenant-a',
			'notifyNewComment'
		);
		expect(map.get('u1')).toBe(true);
		expect(map.get('u2')).toBe(true);
		expect(map.get('u3')).toBe(true);
	});

	test('respects per-user stored prefs and defaults missing rows to true', async () => {
		queryQueue.push([
			{ userId: 'u1', value: false },
			{ userId: 'u3', value: true }
		]);
		const map = await tenantUserPrefAllowsBatch(
			['u1', 'u2', 'u3'],
			'tenant-a',
			'notifyTaskStatusChange'
		);
		expect(map.get('u1')).toBe(false);
		expect(map.get('u2')).toBe(true); // no row → default allow
		expect(map.get('u3')).toBe(true);
	});

	test('returns a map keyed by every requested userId (no missing keys)', async () => {
		queryQueue.push([{ userId: 'u2', value: false }]);
		const map = await tenantUserPrefAllowsBatch(
			['u1', 'u2', 'u3'],
			'tenant-a',
			'notifyMention'
		);
		expect(map.has('u1')).toBe(true);
		expect(map.has('u2')).toBe(true);
		expect(map.has('u3')).toBe(true);
		expect(map.get('u1')).toBe(true);
		expect(map.get('u2')).toBe(false);
		expect(map.get('u3')).toBe(true);
	});
});
