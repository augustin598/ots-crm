/**
 * Cache purge after updates / restore (OTS Connector ≥ 0.8.4). The connector
 * empties whatever it finds on the site (LiteSpeed, WP Rocket, W3TC,
 * Perfmatters' used CSS, Elementor's generated CSS, …) and reports each one;
 * pages are otherwise served from a cache built before the update, with
 * stale CSS/JS. Browser-safe: the result types and the text shown in the
 * update panels live here, the server side is `$lib/server/wordpress/cache-purge`.
 */

/** `restore` also flushes the object cache and OPcache (see the connector). */
export type CachePurgeScope = 'update' | 'restore';

export type CachePurgeItem = { id: string; name: string; ok: boolean; error?: string | null };

export type CachePurgeOutcome =
	| { status: 'purged'; items: CachePurgeItem[] }
	| { status: 'nothing' }
	| { status: 'unsupported'; connectorVersion: string | null }
	| { status: 'failed'; error: string };

const STATUSES = new Set(['purged', 'nothing', 'unsupported', 'failed']);

/** `siteApi` is `/<tenant>/api/wordpress/sites/<siteId>`. Never throws. */
export async function requestCachePurge(
	siteApi: string,
	opts: { scope?: CachePurgeScope; fetchFn?: typeof fetch } = {}
): Promise<CachePurgeOutcome> {
	const fetchFn = opts.fetchFn ?? fetch;
	try {
		const res = await fetchFn(`${siteApi}/cache-purge`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ scope: opts.scope ?? 'update' })
		});
		const body = (await res.json().catch(() => ({}))) as Partial<CachePurgeOutcome> & { error?: string };
		if (res.ok && body.status && STATUSES.has(body.status)) return body as CachePurgeOutcome;
		return { status: 'failed', error: body.error || `HTTP ${res.status}` };
	} catch (err) {
		return { status: 'failed', error: err instanceof Error ? err.message : 'Eroare de rețea' };
	}
}

export type CachePurgeView = { text: string; tone: 'ok' | 'warning' | 'muted' };

/** One line of Romanian for the update / restore panels. */
export function describeCachePurge(o: CachePurgeOutcome): CachePurgeView {
	switch (o.status) {
		case 'purged': {
			const ok = o.items.filter((i) => i.ok).map((i) => i.name);
			const bad = o.items
				.filter((i) => !i.ok)
				.map((i) => (i.error ? `${i.name} (${i.error})` : i.name));
			const parts = [
				ok.length > 0 ? `Cache golit: ${ok.join(', ')}` : '',
				bad.length > 0 ? `${ok.length > 0 ? 'negolit' : 'Cache negolit'}: ${bad.join(', ')}` : ''
			].filter(Boolean);
			return { text: parts.join(' · '), tone: bad.length > 0 ? 'warning' : 'ok' };
		}
		case 'nothing':
			return { text: 'Niciun cache de golit pe site', tone: 'muted' };
		case 'unsupported':
			return {
				text: `Cache-ul NU a fost golit: conectorul v${o.connectorVersion ?? '?'} nu știe să-l golească (actualizează conectorul)`,
				tone: 'warning'
			};
		case 'failed':
			return { text: `Golirea cache-ului a eșuat: ${o.error}`, tone: 'warning' };
	}
}
