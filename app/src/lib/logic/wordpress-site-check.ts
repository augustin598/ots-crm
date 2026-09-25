/**
 * Front-end check after updates / restore: the CRM server opens the homepage
 * and the first product-sitemap pages like a visitor (see
 * `$lib/server/wordpress/site-check`). Browser-safe: result types, the call
 * and the line shown in the update panels.
 */

export type SiteCheckPage = {
	label: string;
	url: string;
	/** null = no HTTP answer (timeout, DNS, TLS). */
	status: number | null;
	ms: number;
	problem: string | null;
};

/** `ok` null = the check itself could not run. */
export type SiteCheckOutcome =
	| { ok: boolean; pages: SiteCheckPage[] }
	| { ok: null; error: string; pages: [] };

/** `siteApi` is `/<tenant>/api/wordpress/sites/<siteId>`. Never throws. */
export async function requestSiteCheck(
	siteApi: string,
	opts: { fetchFn?: typeof fetch } = {}
): Promise<SiteCheckOutcome> {
	const fetchFn = opts.fetchFn ?? fetch;
	try {
		const res = await fetchFn(`${siteApi}/site-check`, { method: 'POST' });
		const body = (await res.json().catch(() => ({}))) as Partial<{ ok: boolean; pages: SiteCheckPage[] }> & {
			error?: string;
		};
		if (res.ok && typeof body.ok === 'boolean' && Array.isArray(body.pages)) {
			return { ok: body.ok, pages: body.pages };
		}
		return { ok: null, error: body.error || `HTTP ${res.status}`, pages: [] };
	} catch (err) {
		return { ok: null, error: err instanceof Error ? err.message : 'Eroare de rețea', pages: [] };
	}
}

function seconds(ms: number): string {
	return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

export type SiteCheckView = { text: string; tone: 'ok' | 'warning' | 'error' };

/** One line of Romanian for the update / restore panels. */
export function describeSiteCheck(o: SiteCheckOutcome): SiteCheckView {
	if (o.ok === null) return { text: `Nu am putut verifica site-ul: ${o.error}`, tone: 'warning' };
	const parts = o.pages.map((p) =>
		p.problem ? `${p.label} (${p.url}) — ${p.problem}` : `${p.label} ${p.status} (${seconds(p.ms)})`
	);
	return o.ok
		? { text: `Site online: ${parts.join(' · ')}`, tone: 'ok' }
		: { text: `Site cu probleme după update: ${parts.join(' · ')}`, tone: 'error' };
}
