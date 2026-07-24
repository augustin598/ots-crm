import { detectKeyType, type ClaudeKeyType } from './key-utils';

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
/** Beta flag folosit de Claude Code OAuth tokens; ajustează dacă Anthropic îl schimbă. */
const OAUTH_BETA = 'oauth-2025-04-20';
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Semnătura minimă de fetch pe care o folosește clientul. Evită să cerem tot
 * `typeof fetch` (care în Bun/Node cere și `preconnect`), ca mock-urile din teste
 * să fie acceptate fără cast.
 */
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ClaudeClientOptions {
	apiKey: string;
	keyType?: ClaudeKeyType;
	defaultModel: string;
	/** Injectabil pentru teste; default = global fetch. */
	fetchImpl?: FetchLike;
	timeoutMs?: number;
}

export interface ClaudeTestResult {
	ok: true;
	via: 'models' | 'messages';
	models: string[];
}

export interface ClaudeClient {
	readonly keyType: ClaudeKeyType;
	readonly defaultModel: string;
	buildHeaders(extra?: Record<string, string>): Record<string, string>;
	listModels(): Promise<string[]>;
	createMessage(body: Record<string, unknown>): Promise<Response>;
	testConnection(): Promise<ClaudeTestResult>;
}

export function createClaudeClient(opts: ClaudeClientOptions): ClaudeClient {
	const apiKey = opts.apiKey.trim();
	const keyType: ClaudeKeyType = opts.keyType ?? detectKeyType(apiKey);
	const doFetch: FetchLike = opts.fetchImpl ?? fetch;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
		const h: Record<string, string> = { 'anthropic-version': ANTHROPIC_VERSION, ...extra };
		if (keyType === 'oat') {
			h['authorization'] = `Bearer ${apiKey}`;
			h['anthropic-beta'] = OAUTH_BETA;
		} else {
			h['x-api-key'] = apiKey;
		}
		return h;
	}

	async function req(path: string, init: RequestInit = {}): Promise<Response> {
		return doFetch(`${ANTHROPIC_BASE}${path}`, {
			...init,
			headers: { ...buildHeaders(), ...((init.headers as Record<string, string>) ?? {}) },
			signal: AbortSignal.timeout(timeoutMs)
		});
	}

	async function parseModelIds(res: Response): Promise<string[]> {
		let json: { data?: Array<{ id: string }> };
		try {
			json = (await res.json()) as { data?: Array<{ id: string }> };
		} catch (err) {
			throw new Error(`Anthropic /v1/models: răspuns JSON invalid (${err instanceof Error ? err.message : String(err)})`);
		}
		return (json.data ?? []).map((m) => m.id);
	}

	async function listModels(): Promise<string[]> {
		const res = await req('/v1/models');
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`Anthropic /v1/models ${res.status}: ${body.slice(0, 200)}`);
		}
		return parseModelIds(res);
	}

	async function createMessage(body: Record<string, unknown>): Promise<Response> {
		return req('/v1/messages', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	async function testConnection(): Promise<ClaudeTestResult> {
		const res = await req('/v1/models');
		if (res.ok) {
			return { ok: true, via: 'models', models: await parseModelIds(res) };
		}
		// OAuth tokens pot să nu fie acceptate pe /v1/models — fallback la un mesaj minimal.
		if (keyType === 'oat' && [401, 403, 404].includes(res.status)) {
			const msgRes = await createMessage({
				model: opts.defaultModel,
				max_tokens: 1,
				messages: [{ role: 'user', content: 'ping' }]
			});
			if (msgRes.ok) return { ok: true, via: 'messages', models: [] };
			const body = await msgRes.text().catch(() => '');
			throw new Error(`Anthropic /v1/messages ${msgRes.status}: ${body.slice(0, 200)}`);
		}
		const body = await res.text().catch(() => '');
		throw new Error(`Anthropic /v1/models ${res.status}: ${body.slice(0, 200)}`);
	}

	return { keyType, defaultModel: opts.defaultModel, buildHeaders, listModels, createMessage, testConnection };
}
