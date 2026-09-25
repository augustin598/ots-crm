/**
 * Server side of the cache purge (OTS Connector ≥ 0.8.4, `POST /cache/purge`).
 * Called by the browser (`cache-purge` endpoint) once per site after a batch
 * of updates and after a restore. Best effort:
 * a failure is reported, never thrown — the updates themselves already ran.
 */
import { compareConnectorVersions } from './connector-release';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import type { CachePurgeOutcome, CachePurgeScope } from '$lib/logic/wordpress-cache-purge';
import type { WpCachePurgeResponse } from './client';

export const CACHE_PURGE_MIN_CONNECTOR = '0.8.4';

export function supportsCachePurge(connectorVersion: string | null | undefined): boolean {
	return (
		!!connectorVersion &&
		compareConnectorVersions(connectorVersion, CACHE_PURGE_MIN_CONNECTOR) >= 0
	);
}

export async function purgeSiteCache(args: {
	client: {
		purgeCache(opts?: { scope?: CachePurgeScope; siteId?: string }): Promise<WpCachePurgeResponse>;
	};
	site: { id: string; tenantId: string; siteUrl: string; connectorVersion: string | null };
	userId: string | null;
	scope?: CachePurgeScope;
}): Promise<CachePurgeOutcome> {
	const { client, site, userId } = args;
	const scope = args.scope ?? 'update';
	if (!supportsCachePurge(site.connectorVersion)) {
		return { status: 'unsupported', connectorVersion: site.connectorVersion };
	}
	try {
		const r = await client.purgeCache({ scope, siteId: site.id });
		const items = Array.isArray(r.purged) ? r.purged : [];
		logInfo('wordpress', `Cache purge on ${site.siteUrl}: ${items.map((i) => `${i.id}=${i.ok ? 'ok' : 'fail'}`).join(', ') || 'nothing'}`, {
			tenantId: site.tenantId,
			userId: userId ?? undefined,
			metadata: { siteId: site.id, scope, items }
		});
		return items.length > 0 ? { status: 'purged', items } : { status: 'nothing' };
	} catch (err) {
		const { message } = serializeError(err);
		logWarning('wordpress', `Cache purge FAILED on ${site.siteUrl}: ${message}`, {
			tenantId: site.tenantId,
			userId: userId ?? undefined,
			metadata: { siteId: site.id }
		});
		return { status: 'failed', error: message };
	}
}
