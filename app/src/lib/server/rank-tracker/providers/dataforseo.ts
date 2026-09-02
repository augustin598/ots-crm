// Provider SERP opțional: DataForSEO SERP API (Google Organic, live/advanced).
// Fallback plătit per tenant (credențiale criptate în serp_integration). Parserul
// răspunsului e PUR; apelul de rețea are timeout, auth Basic și clasificare de erori.
import { matchDomain } from './serp-parser';
import {
	SerpProviderError,
	type SerpQuery,
	type SerpResult,
	type SerpOrganicResult,
	type SerpProvider
} from './types';

const ENDPOINT = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';
const TIMEOUT_MS = 30_000;

export interface DataforseoCreds {
	login: string;
	password: string;
}
export interface DataforseoDeps {
	fetch?: typeof fetch;
}

// gl (2 litere) → numele de locație cerut de DataForSEO când nu avem o locație explicită.
const GL_TO_LOCATION: Record<string, string> = {
	ro: 'Romania',
	de: 'Germany',
	fr: 'France',
	it: 'Italy',
	es: 'Spain',
	gb: 'United Kingdom',
	uk: 'United Kingdom',
	us: 'United States'
};

function locationName(q: SerpQuery): string {
	if (q.location) return q.location;
	return GL_TO_LOCATION[q.gl] ?? 'Romania';
}

const FEATURE_BY_TYPE: Record<string, string> = {
	paid: 'ads',
	ai_overview: 'ai',
	people_also_ask: 'paa',
	local_pack: 'local',
	images: 'images',
	video: 'video',
	shopping: 'shopping',
	featured_snippet: 'snippet'
};

/** Parsează răspunsul DataForSEO în același `SerpResult` ca parserul HTML. */
export function parseDataforseoResponse(
	json: unknown,
	opts: { targetDomain: string; competitors?: string[] }
): SerpResult {
	const result = (json as { tasks?: Array<{ result?: Array<{ items?: unknown[] }> }> })?.tasks?.[0]
		?.result?.[0];
	const items = (result?.items ?? []) as Array<Record<string, unknown>>;

	const organic: SerpOrganicResult[] = [];
	const featureSet = new Set<string>();
	let aiOverview: SerpResult['aiOverview'] = 'absent';

	for (const item of items) {
		const type = String(item.type ?? '');
		if (FEATURE_BY_TYPE[type]) featureSet.add(FEATURE_BY_TYPE[type]);

		if (type === 'organic') {
			const url = String(item.url ?? '');
			const domainRaw = String(item.domain ?? '');
			const domain = domainRaw.replace(/^www\./i, '').toLowerCase();
			if (!url || !domain) continue;
			organic.push({
				position: organic.length + 1,
				url,
				domain,
				title: String(item.title ?? ''),
				snippet: String(item.description ?? '')
			});
		} else if (type === 'ai_overview') {
			aiOverview = 'present';
			const refs = (item.references ?? []) as Array<Record<string, unknown>>;
			for (const ref of refs) {
				const refUrl = String(ref.url ?? '');
				const refDomain = String(ref.domain ?? '');
				if (
					matchDomain(refUrl, opts.targetDomain) ||
					matchDomain(`https://${refDomain}`, opts.targetDomain)
				) {
					aiOverview = 'cited';
					break;
				}
			}
		}
	}

	return { organic, features: [...featureSet], aiOverview, raw: { blocked: false } };
}

/** Rulează o interogare SERP prin DataForSEO. Aruncă `SerpProviderError` clasificat. */
export async function fetchSerpDataforseo(
	q: SerpQuery,
	targetDomain: string,
	creds: DataforseoCreds,
	deps: DataforseoDeps = {}
): Promise<SerpResult> {
	const fetchImpl = deps.fetch ?? fetch;
	const auth = Buffer.from(`${creds.login}:${creds.password}`).toString('base64');
	const body = [
		{
			keyword: q.keyword,
			language_code: q.hl,
			location_name: locationName(q),
			device: q.device,
			depth: q.depth
		}
	];

	let res: Response;
	try {
		res = await fetchImpl(ENDPOINT, {
			method: 'POST',
			headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (e) {
		if ((e as Error)?.name === 'TimeoutError') {
			throw new SerpProviderError('timeout DataForSEO', 'timeout', true);
		}
		throw new SerpProviderError('eroare de rețea DataForSEO', 'network', true);
	}

	if (res.status === 401 || res.status === 402 || res.status === 403) {
		throw new SerpProviderError(
			`credențiale DataForSEO respinse (${res.status})`,
			'config',
			false
		);
	}
	if (res.status >= 500) {
		throw new SerpProviderError(`DataForSEO ${res.status}`, 'network', true);
	}
	if (!res.ok) {
		throw new SerpProviderError(`DataForSEO ${res.status}`, 'network', false);
	}

	const json = await res.json();
	return parseDataforseoResponse(json, { targetDomain });
}

/** Providerul DataForSEO ca `SerpProvider` (credențiale + fetch prin closure). */
export function createDataforseoProvider(
	creds: DataforseoCreds,
	deps: DataforseoDeps = {}
): SerpProvider {
	return {
		name: 'dataforseo',
		fetchSerp: (q, targetDomain) => fetchSerpDataforseo(q, targetDomain, creds, deps)
	};
}
