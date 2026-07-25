/**
 * Mesajul de eroare dintr-un apel remote SvelteKit, pentru toast-uri.
 *
 * `svelteError(status, msg)` de pe server ajunge pe client ca HttpError — o clasă
 * proprie SvelteKit care NU extinde Error (mesajul e în `e.body.message`). Tiparul
 * `e instanceof Error ? e.message : fallback` afișează deci mereu fallback-ul și
 * înghite mesajul real. Folosește acest helper în orice catch de remote command/query.
 *
 * Loghează eroarea brută în consolă pentru debug (formă completă, cu status/body).
 */
export function remoteErrorMessage(e: unknown, fallback: string): string {
	console.error('[remote]', fallback, e);
	const body = (e as { body?: { message?: unknown } } | null)?.body;
	if (body && typeof body.message === 'string' && body.message) return body.message;
	if (e instanceof Error && e.message) return e.message;
	return fallback;
}
