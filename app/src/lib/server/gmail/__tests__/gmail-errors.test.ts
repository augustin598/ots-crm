import { describe, it, expect } from 'bun:test';
import { mapGmailError } from '../errors';

describe('mapGmailError', () => {
	it('409 când integrarea Gmail nu e conectată', () => {
		const m = mapGmailError(new Error('Gmail not connected'));
		expect(m.status).toBe(409);
		expect(m.kind).toBe('not-connected');
		expect(m.message).toContain('Gmail');
	});

	it('409 pentru invalid_grant (refresh token revocat)', () => {
		const gaxios = Object.assign(new Error('invalid_grant'), {
			response: { status: 400, data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }
		});
		expect(mapGmailError(gaxios).status).toBe(409);
	});

	it('409 pentru invalid_grant ascuns doar în response.data', () => {
		const gaxios = Object.assign(new Error('Request failed with status code 400'), {
			response: { status: 400, data: { error: 'invalid_grant' } }
		});
		expect(mapGmailError(gaxios).status).toBe(409);
	});

	it('409 pentru 401 de la Gmail', () => {
		const gaxios = Object.assign(new Error('Invalid Credentials'), { code: 401 });
		expect(mapGmailError(gaxios).status).toBe(409);
	});

	it('409 pentru 403 insufficientPermissions (scope lipsă)', () => {
		const gaxios = Object.assign(new Error('Request had insufficient authentication scopes.'), {
			code: 403,
			errors: [{ reason: 'insufficientPermissions', message: 'Insufficient Permission' }]
		});
		expect(mapGmailError(gaxios).status).toBe(409);
	});

	it('404 când mesajul nu mai există', () => {
		const gaxios = Object.assign(new Error('Requested entity was not found.'), {
			code: 404,
			response: { status: 404 }
		});
		const m = mapGmailError(gaxios);
		expect(m.status).toBe(404);
		expect(m.kind).toBe('not-found');
	});

	it('502 pentru 5xx de la Google', () => {
		const gaxios = Object.assign(new Error('Backend Error'), { code: 503 });
		const m = mapGmailError(gaxios);
		expect(m.status).toBe(502);
		expect(m.kind).toBe('upstream');
	});

	it('502 pentru timeout / abort', () => {
		expect(mapGmailError(new Error('timeout of 30000ms exceeded')).status).toBe(502);
		expect(mapGmailError(Object.assign(new Error('aborted'), { code: 'ECONNABORTED' })).status).toBe(
			502
		);
	});

	it('502 pentru 429 rate limit', () => {
		expect(mapGmailError(Object.assign(new Error('Rate Limit Exceeded'), { code: 429 })).status).toBe(
			502
		);
	});

	it('502 pentru erori de formă necunoscută', () => {
		expect(mapGmailError(null).status).toBe(502);
		expect(mapGmailError('boom').status).toBe(502);
		expect(mapGmailError({}).status).toBe(502);
	});

	it('mesajele sunt în română și nu expun detalii interne', () => {
		for (const err of [new Error('Gmail not connected'), { code: 404 }, { code: 500 }]) {
			const m = mapGmailError(err);
			expect(m.message).not.toContain('Error:');
			expect(m.message.length).toBeGreaterThan(10);
		}
	});
});
