import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import JSZip from 'jszip';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient } from '$lib/server/wordpress/client';
import { logWarning } from '$lib/server/logger';

/**
 * Full header snapshot parsed from a WP plugin ZIP. All fields are
 * normalized (trimmed, lowercase where appropriate for matching).
 */
export type PluginZipInfo = {
	slug: string;
	pluginFile: string; // e.g. "astra-pro/astra-pro.php"
	name: string;
	version: string;
	description: string;
	author: string;
	requiresWp: string;
	requiresPhp: string;
	textDomain: string;
	pluginUri: string;
	updateUri: string;
	sizeBytes: number;
};

/**
 * A single candidate for a match. Higher `score` = higher confidence.
 * `reasons` lists the heuristics that fired, in priority order.
 */
type MatchCandidate = {
	plugin: string; // installed plugin path (slug/file.php)
	installedVersion: string;
	installedName: string;
	score: number;
	reasons: string[];
};

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

const HEADER_FIELDS: Record<string, string> = {
	name: 'Plugin Name',
	version: 'Version',
	description: 'Description',
	author: 'Author',
	requiresWp: 'Requires at least',
	requiresPhp: 'Requires PHP',
	textDomain: 'Text Domain',
	pluginUri: 'Plugin URI',
	updateUri: 'Update URI'
};

/**
 * Parse a WP plugin header. Matches WP core's own regex behaviour
 * (`get_file_data()` in `wp-includes/functions.php`): lines starting
 * with comment markers, flexible whitespace, first 8 KB only. We read
 * 16 KB for safety since some vendors add long docblocks.
 */
function parseHeader(text: string): Record<string, string> {
	const sample = text.slice(0, 16_384);
	const out: Record<string, string> = {};
	for (const [field, header] of Object.entries(HEADER_FIELDS)) {
		const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const pattern = new RegExp(
			`^[ \\t\\*\\/\\#@]*${escaped}\\s*:\\s*(.*)$`,
			'im'
		);
		const m = sample.match(pattern);
		if (m && m[1]) {
			out[field] = m[1].trim().replace(/\r$/, '');
		}
	}
	return out;
}

/**
 * Find the plugin's main file inside a loaded ZIP.
 *
 * WP plugin ZIPs can be shaped three different ways:
 *   1) `astra-pro/astra-pro.php`           (standard)
 *   2) `astra-pro/some/deep/structure/...` with main PHP at root of
 *      `astra-pro/`
 *   3) `download-wrapper/astra-pro/astra-pro.php` (vendor wraps)
 *
 * Scan up to depth 3 for any `.php` file and pick the one whose header
 * has a non-empty "Plugin Name". If multiple match, prefer shallower.
 * For shape #3, the slug is extracted from the folder that contains
 * the winning PHP file (NOT the outer wrapper).
 */
async function findPluginFile(
	zip: JSZip
): Promise<{ slug: string; file: JSZip.JSZipObject; text: string } | null> {
	const candidates: Array<{
		slug: string;
		path: string;
		depth: number;
		file: JSZip.JSZipObject;
	}> = [];
	zip.forEach((relativePath, entry) => {
		if (entry.dir) return;
		if (!relativePath.toLowerCase().endsWith('.php')) return;
		const parts = relativePath.split('/').filter(Boolean);
		if (parts.length < 2 || parts.length > 4) return; // too shallow (no folder) or too deep
		// The plugin's "slug" folder is the one that directly contains
		// the main .php. Which one is main? We'll decide by header match
		// below; for now, remember the immediate parent.
		const slug = parts[parts.length - 2];
		candidates.push({ slug, path: relativePath, depth: parts.length, file: entry });
	});

	// Shallower first — standard ZIPs beat wrapper ZIPs.
	candidates.sort((a, b) => a.depth - b.depth);

	for (const c of candidates) {
		const text = await c.file.async('string');
		const header = parseHeader(text);
		if (header.name && header.name.trim().length > 0) {
			return { slug: c.slug, file: c.file, text };
		}
	}
	return null;
}

/** Clip + sanitize free-form text that goes into a JSON response. */
function snip(s: string, max = 500): string {
	if (!s) return '';
	const t = s.trim();
	return t.length > max ? t.slice(0, max) + '…' : t;
}

/**
 * WordPress-aligned version comparator.
 *
 * WP's own `version_compare()` (PHP) handles these cases we care about:
 *   - "1.0" < "1.0.1" < "1.0.1.1" < "1.1"
 *   - "1.0-beta" < "1.0-rc1" < "1.0-rc2" < "1.0"
 *   - Any non-number part is ordered by a fixed table: dev < alpha < beta
 *     < rc < # (numeric) < pl/patch
 *
 * We implement the most common subset. Full WP compat is a rabbit hole
 * (it even distinguishes "1.0p1" vs "1.0pl1"); this covers real-world
 * plugin versioning seen in the last 10 years of WordPress.
 */
function cmpVersion(a: string, b: string): number {
	if (a === b) return 0;
	const norm = (v: string) =>
		v
			.toLowerCase()
			.replace(/[-_+]/g, '.')
			.replace(/([0-9])([a-z])/g, '$1.$2')
			.replace(/([a-z])([0-9])/g, '$1.$2');
	const tierOrder: Record<string, number> = {
		dev: -4,
		alpha: -3,
		a: -3,
		beta: -2,
		b: -2,
		rc: -1,
		pl: 1,
		p: 1
	};
	const parts = (v: string) => norm(v).split('.').filter(Boolean);
	const pa = parts(a);
	const pb = parts(b);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const x = pa[i] ?? '0';
		const y = pb[i] ?? '0';
		if (x === y) continue;
		const nx = /^\d+$/.test(x) ? Number(x) : null;
		const ny = /^\d+$/.test(y) ? Number(y) : null;
		if (nx !== null && ny !== null) {
			if (nx < ny) return -1;
			if (nx > ny) return 1;
			continue;
		}
		// At least one side is non-numeric. Map to tier; unknown tier = 0.
		const tx = nx !== null ? 0 : (tierOrder[x] ?? 0);
		const ty = ny !== null ? 0 : (tierOrder[y] ?? 0);
		if (tx !== ty) return tx < ty ? -1 : 1;
		// Same tier, compare lexicographically (stable for "rc1" vs "rc2"
		// because norm splits them as "rc","1" vs "rc","2" handled above).
		return x < y ? -1 : 1;
	}
	return 0;
}

/** Simple Levenshtein distance, O(n*m) memory — fine for short plugin names. */
function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	const prev: number[] = Array(b.length + 1);
	const cur: number[] = Array(b.length + 1);
	for (let j = 0; j <= b.length; j++) prev[j] = j;
	for (let i = 1; i <= a.length; i++) {
		cur[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			cur[j] = Math.min(
				prev[j] + 1, // deletion
				cur[j - 1] + 1, // insertion
				prev[j - 1] + cost // substitution
			);
		}
		for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
	}
	return prev[b.length];
}

/** 0..1 similarity derived from Levenshtein distance. */
function similarity(a: string, b: string): number {
	const na = a.toLowerCase().trim();
	const nb = b.toLowerCase().trim();
	if (!na || !nb) return 0;
	if (na === nb) return 1;
	const maxLen = Math.max(na.length, nb.length);
	return 1 - levenshtein(na, nb) / maxLen;
}

/** Installed plugin shape returned by the connector. */
type InstalledPlugin = {
	plugin: string;
	name: string;
	version: string;
	author: string;
	pluginUri?: string;
	textDomain?: string;
};

/**
 * Core of the matching algorithm. We score each installed plugin
 * against the ZIP's metadata and pick the winner. Scores are
 * additive so multiple weak signals can combine into a confident
 * match, but no single signal can exceed its ceiling.
 *
 * Ceilings (max contribution per signal):
 *   100 — Text Domain exact match (WP's own canonical identifier)
 *    95 — Update URI exact match (set deliberately by plugin authors)
 *    90 — Plugin URI exact match
 *    85 — Slug exact match (`astra-pro` vs `astra-pro`)
 *    75 — Name + Author both exact (case-insensitive, trimmed)
 *    60 — Name Levenshtein >= 0.85 similarity
 *
 * We take the max signal score and add a small bonus (up to 10) if
 * multiple signals agree. This promotes "good on two fronts" matches
 * past "excellent on one front" false positives.
 */
function scoreCandidate(zip: PluginZipInfo, installed: InstalledPlugin): MatchCandidate {
	const reasons: string[] = [];
	const scores: number[] = [];

	const zipSlug = zip.slug.toLowerCase();
	const installedSlug = installed.plugin.split('/')[0].toLowerCase();

	if (zip.textDomain && installed.textDomain && zip.textDomain === installed.textDomain) {
		scores.push(100);
		reasons.push('text_domain_exact');
	}
	if (zip.updateUri && installed.pluginUri && zip.updateUri === installed.pluginUri) {
		scores.push(95);
		reasons.push('update_uri_match');
	}
	if (zip.pluginUri && installed.pluginUri && zip.pluginUri === installed.pluginUri) {
		scores.push(90);
		reasons.push('plugin_uri_exact');
	}
	if (zipSlug === installedSlug) {
		scores.push(85);
		reasons.push('slug_exact');
	}

	const zipName = zip.name.toLowerCase().trim();
	const installedName = installed.name.toLowerCase().trim();
	const zipAuthor = zip.author.toLowerCase().trim();
	const installedAuthor = installed.author.toLowerCase().trim();
	if (zipName && zipName === installedName && zipAuthor && zipAuthor === installedAuthor) {
		scores.push(75);
		reasons.push('name_and_author_exact');
	}

	// Fuzzy name fallback when text domain / URIs are missing (common in
	// older plugins). Only fire when slug also fails — prevents this
	// from drowning out a clean slug match.
	if (!scores.length && zipName && installedName) {
		const sim = similarity(zipName, installedName);
		if (sim >= 0.85) {
			scores.push(Math.round(60 * sim));
			reasons.push(`name_fuzzy_${Math.round(sim * 100)}`);
		}
	}

	if (scores.length === 0) {
		return {
			plugin: installed.plugin,
			installedVersion: installed.version,
			installedName: installed.name,
			score: 0,
			reasons: []
		};
	}

	// Base = best single signal; agreement bonus = +5 per extra signal
	// that also fired, capped at +10 so we never exceed 110.
	const base = Math.max(...scores);
	const bonus = Math.min((scores.length - 1) * 5, 10);
	return {
		plugin: installed.plugin,
		installedVersion: installed.version,
		installedName: installed.name,
		score: Math.min(base + bonus, 110),
		reasons
	};
}

/** Thresholds calibrated against real plugin data (see scoring comments). */
const DEFINITE_MATCH_THRESHOLD = 85;
const AMBIGUOUS_MIN = 60;

/**
 * Pick the best match from a list of candidates, or classify as
 * "new" / "ambiguous" based on the scores.
 *
 * Ambiguity rule: if the #1 candidate is below the definite-match
 * threshold AND #2 is within 10 points of it, we bail and hand
 * the decision to the operator. A gap >10 means the #1 is confident
 * enough, even if below 85.
 */
function pickMatch(candidates: MatchCandidate[]): {
	winner: MatchCandidate | null;
	ambiguous: MatchCandidate[];
} {
	const sorted = [...candidates].filter((c) => c.score >= AMBIGUOUS_MIN).sort((a, b) => b.score - a.score);
	if (sorted.length === 0) return { winner: null, ambiguous: [] };
	const top = sorted[0];
	if (top.score >= DEFINITE_MATCH_THRESHOLD) return { winner: top, ambiguous: [] };
	const second = sorted[1];
	if (second && top.score - second.score < 10) {
		return {
			winner: null,
			ambiguous: sorted.slice(0, 3)
		};
	}
	// Confident enough — winner.
	return { winner: top, ambiguous: [] };
}

/**
 * Load a WordPress site + authenticated client. Mirrors the pattern
 * used by sibling routes so secret decryption handles the Turso
 * truncated-read retry dance.
 */
async function loadSiteAndClient(siteId: string, tenantId: string) {
	const [site] = await db
		.select()
		.from(table.wordpressSite)
		.where(and(eq(table.wordpressSite.id, siteId), eq(table.wordpressSite.tenantId, tenantId)))
		.limit(1);
	if (!site) return null;
	let secret: string;
	try {
		secret = decrypt(site.tenantId, site.secretKey);
	} catch (err) {
		if (err instanceof DecryptionError) {
			await new Promise((r) => setTimeout(r, 1000));
			const [fresh] = await db
				.select()
				.from(table.wordpressSite)
				.where(eq(table.wordpressSite.id, site.id))
				.limit(1);
			secret = decrypt(fresh!.tenantId, fresh!.secretKey);
		} else {
			throw err;
		}
	}
	return { site, client: new WpClient(site.siteUrl, secret) };
}

/**
 * POST — inspect a plugin ZIP and classify it against the site's
 * installed plugins. Does NOT modify the site. Safe to call many
 * times in a row while the operator reviews an upload queue.
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

	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(binary);
	} catch (err) {
		logWarning('wordpress', `Plugin inspect failed: invalid ZIP ${body.filename ?? '?'}`, {
			tenantId: locals.tenant.id,
			userId: locals.user.id,
			metadata: { filename: body.filename, reason: err instanceof Error ? err.message : 'unknown' }
		});
		return json({ error: 'ZIP invalid sau corupt' }, { status: 400 });
	}

	const found = await findPluginFile(zip);
	if (!found) {
		return json(
			{
				error:
					'Nu am găsit un fișier de plugin valid în ZIP (trebuie <folder>/<plugin>.php cu header "Plugin Name")'
			},
			{ status: 400 }
		);
	}

	const header = parseHeader(found.text);
	if (!header.version) {
		return json(
			{ error: `Plugin-ul nu are header "Version" în ${found.slug}` },
			{ status: 400 }
		);
	}

	const info: PluginZipInfo = {
		slug: found.slug,
		pluginFile: found.file.name,
		name: snip(header.name ?? found.slug, 200),
		version: snip(header.version, 50),
		description: snip(header.description ?? '', 500),
		author: snip(header.author ?? '', 200),
		requiresWp: snip(header.requiresWp ?? '', 20),
		requiresPhp: snip(header.requiresPhp ?? '', 20),
		textDomain: snip(header.textDomain ?? '', 100),
		pluginUri: snip(header.pluginUri ?? '', 500),
		updateUri: snip(header.updateUri ?? '', 500),
		sizeBytes: binary.length
	};

	// Fetch installed plugins to score against. If the site can't be
	// reached, fall back to "new" — better than blocking upload entirely.
	let installed: InstalledPlugin[] = [];
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
				textDomain: (p as { textDomain?: string }).textDomain
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
		const cmp = cmpVersion(info.version, winner.installedVersion);
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
