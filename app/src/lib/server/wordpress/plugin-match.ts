/**
 * Plugin identity matching + WordPress-style version comparison.
 *
 * Shared by the per-site ZIP inspect endpoint (`plugins/inspect`) and the
 * plugin library comparison (`plugin-library-compare.ts`) so both flows
 * agree on what "the same plugin" means and on which version is newer.
 * Pure functions, no I/O.
 */

/** The identity fields we can read from a plugin header (ZIP or library row). */
export interface PluginIdentity {
	slug: string;
	name: string;
	author: string;
	textDomain: string;
	pluginUri: string;
	updateUri: string;
}

/** Installed plugin shape returned by the connector's `GET /plugins`. */
export interface InstalledPluginRef {
	plugin: string; // e.g. "astra-addon/astra-addon.php"
	name: string;
	version: string;
	author: string;
	pluginUri?: string;
	textDomain?: string;
}

/**
 * A single candidate for a match. Higher `score` = higher confidence.
 * `reasons` lists the heuristics that fired, in priority order.
 */
export interface MatchCandidate {
	plugin: string; // installed plugin path (slug/file.php)
	installedVersion: string;
	installedName: string;
	score: number;
	reasons: string[];
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
export function compareWpVersions(a: string, b: string): number {
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
export function scoreCandidate(zip: PluginIdentity, installed: InstalledPluginRef): MatchCandidate {
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
export const DEFINITE_MATCH_THRESHOLD = 85;
export const AMBIGUOUS_MIN = 60;

/**
 * Pick the best match from a list of candidates, or classify as
 * "new" / "ambiguous" based on the scores.
 *
 * Ambiguity rule: if the #1 candidate is below the definite-match
 * threshold AND #2 is within 10 points of it, we bail and hand
 * the decision to the operator. A gap >10 means the #1 is confident
 * enough, even if below 85.
 */
export function pickMatch(candidates: MatchCandidate[]): {
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
