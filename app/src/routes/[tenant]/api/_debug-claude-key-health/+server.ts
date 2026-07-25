import { json, error } from '@sveltejs/kit';
import { getClaudeClient } from '$lib/server/plugins/claude';
import type { RequestHandler } from './$types';

/**
 * Probe direct pe cheia Claude stocată a tenantului (fără retry, fără failover).
 *
 *   GET ?key=oat   — testează cheia de abonament (default)
 *   GET ?key=api   — testează cheia API
 *
 * Trimite un mesaj minimal (max_tokens=1) și întoarce statusul, headerele de
 * rate-limit și corpul brut al răspunsului. Există ca să deosebim un 429 de
 * „viteză" (burst pe minut, trece în secunde — vezi retry-after) de un 429 de
 * „limită de utilizare a abonamentului" (fereastra de 5h/7z consumată de
 * claude.ai + Claude Code + API — aștepți resetul). Corpul 429 spune care e.
 *
 * Admin-only. Tenant-scoped. Nu expune cheia.
 */

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
}

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const raw = event.url.searchParams.get('key');
	const keyType = raw === 'api' ? 'api' : 'oat';

	const client = await getClaudeClient(tenantId, keyType, 30_000);
	if (!client) {
		return json({ ok: false, keyType, error: 'Slotul cerut nu e stocat sau pluginul e inactiv.' });
	}

	const t0 = Date.now();
	const res = await client.createMessage({
		model: client.defaultModel,
		max_tokens: 1,
		messages: [{ role: 'user', content: 'ping' }]
	});
	const body = await res.text().catch(() => '');
	const headers: Record<string, string> = {};
	res.headers.forEach((v, k) => {
		if (k === 'retry-after' || k.startsWith('anthropic-ratelimit')) headers[k] = v;
	});

	return json({
		ok: res.ok,
		status: res.status,
		keyType,
		model: client.defaultModel,
		ms: Date.now() - t0,
		headers,
		body: body.slice(0, 600)
	});
};
