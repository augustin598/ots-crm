import { describe, it, expect, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: { SQLITE_PATH: ':memory:' } }));
mock.module('$env/static/private', () => ({ SQLITE_PATH: ':memory:' }));

mock.module('$lib/server/db', () => ({
	db: {
		select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
		update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
		insert: () => ({ values: () => Promise.resolve() })
	}
}));

mock.module('$lib/server/db/schema', () => ({
	personalopsInstance: {
		id: 'id',
		instanceId: 'instance_id',
		tenantId: 'tenant_id',
		lastHeartbeatAt: 'last_heartbeat_at',
		version: 'version',
		metadata: 'metadata',
		createdAt: 'created_at',
		updatedAt: 'updated_at'
	}
}));

mock.module('$lib/server/api-keys/middleware', () => ({
	withApiKey: async (
		event: Request,
		_scope: string,
		handler: (e: Request, ctx: unknown) => unknown
	) => {
		const ctx = { tenantId: 'tenant-1', apiKeyId: 'key-1' };
		const result = await handler(event, ctx);
		if (result instanceof Response) return result;
		const r = result as { status: number; body: unknown };
		return new Response(JSON.stringify(r.body), {
			status: r.status,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}));

const { POST } = await import('../+server.js');

function makeEvent(body: unknown) {
	const url = new URL('http://localhost/api/external/heartbeat');
	return {
		request: new Request(url.toString(), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
			body: JSON.stringify(body)
		}),
		url
	} as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/external/heartbeat', () => {
	it('returns 400 when instanceId is missing', async () => {
		const res = await POST(makeEvent({}));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe('missing_instance_id');
	});

	it('returns 400 when instanceId is not a valid UUID', async () => {
		const res = await POST(makeEvent({ instanceId: 'not-a-uuid' }));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe('invalid_instance_id');
	});

	it('returns 400 for short non-UUID strings', async () => {
		const res = await POST(makeEvent({ instanceId: 'test' }));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe('invalid_instance_id');
	});

	it('accepts a valid UUID v4', async () => {
		const res = await POST(
			makeEvent({ instanceId: '550e8400-e29b-41d4-a716-446655440000', version: '1.0.0' })
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
	});
});
