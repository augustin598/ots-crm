import { describe, expect, test } from 'bun:test';
import { createClaudeClient } from './client';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('createClaudeClient — headers', () => {
	test('api key → x-api-key, fără authorization', () => {
		const c = createClaudeClient({ apiKey: 'sk-ant-api03-KEY', defaultModel: 'claude-sonnet-5' });
		const h = c.buildHeaders();
		expect(c.keyType).toBe('api');
		expect(h['x-api-key']).toBe('sk-ant-api03-KEY');
		expect(h['authorization']).toBeUndefined();
		expect(h['anthropic-version']).toBe('2023-06-01');
	});

	test('oat token → Authorization Bearer + anthropic-beta, fără x-api-key', () => {
		const c = createClaudeClient({ apiKey: 'sk-ant-oat01-TOK', defaultModel: 'claude-sonnet-5' });
		const h = c.buildHeaders();
		expect(c.keyType).toBe('oat');
		expect(h['authorization']).toBe('Bearer sk-ant-oat01-TOK');
		expect(h['anthropic-beta']).toContain('oauth');
		expect(h['x-api-key']).toBeUndefined();
	});
});

describe('createClaudeClient — testConnection', () => {
	test('200 la /v1/models → ok via models', async () => {
		const c = createClaudeClient({
			apiKey: 'sk-ant-api03-KEY',
			defaultModel: 'claude-sonnet-5',
			fetchImpl: async () => jsonResponse({ data: [{ id: 'claude-sonnet-5' }, { id: 'claude-opus-4-8' }] })
		});
		const r = await c.testConnection();
		expect(r.ok).toBe(true);
		expect(r.via).toBe('models');
		expect(r.models).toEqual(['claude-sonnet-5', 'claude-opus-4-8']);
	});

	test('api key 401 → aruncă cu status 401', async () => {
		const c = createClaudeClient({
			apiKey: 'sk-ant-api03-BAD',
			defaultModel: 'claude-sonnet-5',
			fetchImpl: async () => new Response('unauthorized', { status: 401 })
		});
		await expect(c.testConnection()).rejects.toThrow('401');
	});

	test('oat: /v1/models 403 apoi /v1/messages 200 → ok via messages', async () => {
		let call = 0;
		const c = createClaudeClient({
			apiKey: 'sk-ant-oat01-TOK',
			defaultModel: 'claude-sonnet-5',
			fetchImpl: async (url: string | URL) => {
				call++;
				const u = String(url);
				if (u.includes('/v1/models')) return new Response('forbidden', { status: 403 });
				if (u.includes('/v1/messages')) return jsonResponse({ id: 'msg_1' }, 200);
				return new Response('nope', { status: 404 });
			}
		});
		const r = await c.testConnection();
		expect(r.ok).toBe(true);
		expect(r.via).toBe('messages');
		expect(call).toBe(2);
	});

	test('200 la /v1/models cu body non-JSON → respinge, NU întoarce ok:true cu models goale', async () => {
		const c = createClaudeClient({
			apiKey: 'sk-ant-api03-KEY',
			defaultModel: 'claude-sonnet-5',
			fetchImpl: async () =>
				new Response('<html>not json</html>', {
					status: 200,
					headers: { 'content-type': 'text/html' }
				})
		});
		await expect(c.testConnection()).rejects.toThrow();
	});
});

describe('createClaudeClient — listModels', () => {
	test('200 la /v1/models cu body non-JSON → respinge', async () => {
		const c = createClaudeClient({
			apiKey: 'sk-ant-api03-KEY',
			defaultModel: 'claude-sonnet-5',
			fetchImpl: async () =>
				new Response('<html>not json</html>', {
					status: 200,
					headers: { 'content-type': 'text/html' }
				})
		});
		await expect(c.listModels()).rejects.toThrow();
	});
});
