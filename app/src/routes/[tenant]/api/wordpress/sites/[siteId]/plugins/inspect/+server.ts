import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logWarning } from '$lib/server/logger';
import { loadSiteAndClient } from '$lib/server/wordpress/site-client';
import {
	inspectPluginZip,
	PluginZipError,
	type PluginZipInfo
} from '$lib/server/wordpress/plugin-zip';
import {
	compareWpVersions,
	pickMatch,
	scoreCandidate,
	type InstalledPluginRef,
	type MatchCandidate
} from '$lib/server/wordpress/plugin-match';

export type { PluginZipInfo };

/**
 * Verdict returned to the UI. `kind` drives the badge; `confidence`
 * communicates whether the operator should review before install.
 *
 *   - `new`           → no candidate matched above threshold → install
 *   - `upgrade`       → clear match, ZIP version > installed
 *   - `same_version`  → clear match, same version → skip
 *   - `downgrade`     → clear match, ZIP version < installed → skip
 *   - `ambiguous`     → multiple plausible matches → operator picks
 */
type Verdict =
	| { kind: 'new' }
	| {
			kind: 'upgrade' | 'same_version' | 'downgrade';
			match: MatchCandidate;
			installedVersion: string;
	  }
	| { kind: 'ambiguous'; candidates: MatchCandidate[] };

/**
 * POST — inspect a plugin ZIP and classify it against the site's
 * installed plugins. Does NOT modify the site. Safe to call many
 * times in a row while the operator reviews an upload queue.
 *
 * Header parsing and matching live in `$lib/server/wordpress/plugin-zip`
 * and `plugin-match` (shared with the plugin library comparison).
 *
 * Body: { filename: string, dataBase64: string }
 * Response shape (200):
 *   {
 *     info: PluginZipInfo,
 *     verdict:
 *       | { kind: 'new' }
 *       | { kind: 'upgrade' | 'same_version' | 'downgrade', match, installedVersion }
 *       | { kind: 'ambiguous', candidates: MatchCandidate[] }
 *   }
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => null)) as {
		filename?: string;
		dataBase64?: string;
	} | null;
	if (!body?.dataBase64) {
		return json({ error: 'dataBase64 este obligatoriu' }, { status: 400 });
	}

	const binary = Buffer.from(body.dataBase64, 'base64');
	if (binary.length === 0) {
		return json({ error: 'ZIP gol' }, { status: 400 });
	}
	if (binary.length > 50 * 1024 * 1024) {
		return json({ error: 'ZIP depășește 50 MB' }, { status: 413 });
	}

	let info: PluginZipInfo;
	try {
		info = await inspectPluginZip(binary);
	} catch (err) {
		if (err instanceof PluginZipError) {
			if (err.code === 'invalid_zip') {
				logWarning('wordpress', `Plugin inspect failed: invalid ZIP ${body.filename ?? '?'}`, {
					tenantId: locals.tenant.id,
					userId: locals.user.id,
					metadata: { filename: body.filename, reason: err.message }
				});
			}
			return json({ error: err.message }, { status: 400 });
		}
		throw err;
	}

	// Fetch installed plugins to score against. If the site can't be
	// reached, fall back to "new" — better than blocking upload entirely.
	let installed: InstalledPluginRef[] = [];
	try {
		const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
		if (ctx) {
			const listRaw = await ctx.client.listPlugins({ siteId: ctx.site.id });
			installed = listRaw.items.map((p) => ({
				plugin: p.plugin,
				name: p.name,
				version: p.version,
				author: p.author,
				pluginUri: p.pluginUri,
				textDomain: p.textDomain
			}));
		}
	} catch (err) {
		logWarning('wordpress', `Plugin inspect: could not fetch installed plugins`, {
			tenantId: locals.tenant.id,
			userId: locals.user.id,
			metadata: {
				siteId: params.siteId,
				reason: err instanceof Error ? err.message : 'unknown'
			}
		});
		// Degrade gracefully.
	}

	const candidates = installed.map((i) => scoreCandidate(info, i));
	const { winner, ambiguous } = pickMatch(candidates);

	let verdict: Verdict;
	if (!winner && ambiguous.length === 0) {
		verdict = { kind: 'new' };
	} else if (!winner) {
		verdict = { kind: 'ambiguous', candidates: ambiguous };
	} else {
		const cmp = compareWpVersions(info.version, winner.installedVersion);
		if (cmp === 0) {
			verdict = { kind: 'same_version', match: winner, installedVersion: winner.installedVersion };
		} else if (cmp > 0) {
			verdict = { kind: 'upgrade', match: winner, installedVersion: winner.installedVersion };
		} else {
			verdict = { kind: 'downgrade', match: winner, installedVersion: winner.installedVersion };
		}
	}

	return json({ info, verdict });
};
