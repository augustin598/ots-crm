import {
	compareWpVersions,
	pickMatch,
	scoreCandidate,
	type InstalledPluginRef,
	type MatchCandidate,
	type PluginIdentity
} from './plugin-match';
import { findBasePlugin, pluginFolder, type BaseMatchVia } from '$lib/logic/wordpress-plugin-dependencies';

/**
 * Pure comparison between the tenant's plugin library and the plugins
 * installed on one site (as reported by the connector). No I/O — the
 * endpoint fetches both lists and hands them here; the UI renders the
 * result as-is.
 */

export type LibraryCompareStatus =
	| 'update_available' // library version is newer than the installed one
	| 'up_to_date' // same version
	| 'downgrade' // site runs a NEWER version than the library
	| 'not_installed' // no plausible match on the site
	| 'ambiguous'; // several plausible matches, or the match was claimed by another library row

/** A library row reduced to what matching needs. */
export interface LibraryPluginRef extends PluginIdentity {
	id: string;
	version: string;
}

/** Connector plugin entry plus the bits we need for ordering and source choice. */
export interface InstalledPluginWithState extends InstalledPluginRef {
	active: boolean;
	/** Update WordPress itself knows about (wordpress.org or the vendor's updater). */
	updateAvailable?: boolean;
	newVersion?: string | null;
	/** Download URL; null when the vendor gates it behind a licence. */
	updatePackage?: string | null;
	/** Raw `Requires Plugins` header (connector ≥ 0.7.1). */
	requiresPlugins?: string;
}

/** An update WordPress offers for an installed plugin, outside the library. */
export interface WpSideUpdate {
	newVersion: string;
	/** False for licence-gated updates (no package URL). */
	installable: boolean;
}

/** The base (free) plugin a PRO depends on, as installed on the site. */
export interface LibraryDependency {
	slug: string; // folder
	plugin: string; // WP identifier
	name: string;
	installedVersion: string;
	active: boolean;
	via: BaseMatchVia;
	/** Library row matched to the base, when the base is in the library too. */
	libraryId: string | null;
	/** WordPress-side update for the base; null when the library covers it. */
	wpUpdate: WpSideUpdate | null;
}

export interface LibraryCompareCandidate {
	plugin: string;
	installedName: string;
	installedVersion: string;
	score: number;
}

export interface LibraryCompareItem {
	libraryId: string;
	slug: string;
	name: string;
	libraryVersion: string;
	status: LibraryCompareStatus;
	/** WP identifier of the matched installed plugin (null unless matched). */
	installedPlugin: string | null;
	installedVersion: string | null;
	installedName: string | null;
	/** Active state on the site; null unless matched. Drives `activate` on install. */
	active: boolean | null;
	matchScore: number | null;
	matchReasons: string[];
	/**
	 * True when the matched plugin is installed under a different folder than
	 * the library slug (e.g. installed `astra-addon`, ZIP folder `astra-addon-4`).
	 * Pushing such a ZIP through `Plugin_Upgrader::install()` would create a
	 * second copy next to the old one instead of replacing it, so the UI never
	 * auto-selects these and the install endpoint refuses them.
	 */
	folderMismatch: boolean;
	/** Update WordPress offers for the matched plugin (null when none / not matched). */
	wpUpdate: WpSideUpdate | null;
	/**
	 * Where the update should come from. `wporg` when WordPress offers an
	 * installable version newer than the library's (free plugins: the
	 * library ZIP is already behind wordpress.org).
	 */
	preferredSource: 'library' | 'wporg';
	/** Base plugin to update first (null when none detected). */
	dependsOn: LibraryDependency | null;
	/** Populated for `ambiguous` so the UI can show what it hesitated between. */
	candidates?: LibraryCompareCandidate[];
}

const STATUS_ORDER: Record<LibraryCompareStatus, number> = {
	update_available: 0,
	downgrade: 1,
	ambiguous: 2,
	up_to_date: 3,
	not_installed: 4
};

/** Folder part of a WP plugin identifier ("astra-addon/astra-addon.php" → "astra-addon"). */
function installedFolder(plugin: string): string {
	return plugin.split('/')[0].toLowerCase();
}

function toCandidate(c: MatchCandidate): LibraryCompareCandidate {
	return {
		plugin: c.plugin,
		installedName: c.installedName,
		installedVersion: c.installedVersion,
		score: c.score
	};
}

function wpSideUpdate(p: InstalledPluginWithState | undefined): WpSideUpdate | null {
	if (!p || !p.updateAvailable || !p.newVersion) return null;
	return { newVersion: p.newVersion, installable: Boolean(p.updatePackage) };
}

function buildItem(
	row: LibraryPluginRef,
	status: LibraryCompareStatus,
	winner: MatchCandidate | null,
	active: boolean | null,
	candidates: MatchCandidate[]
): Omit<LibraryCompareItem, 'wpUpdate' | 'preferredSource' | 'dependsOn'> {
	return {
		libraryId: row.id,
		slug: row.slug,
		name: row.name,
		libraryVersion: row.version,
		status,
		installedPlugin: winner?.plugin ?? null,
		installedVersion: winner?.installedVersion ?? null,
		installedName: winner?.installedName ?? null,
		active: winner ? active : null,
		matchScore: winner?.score ?? null,
		matchReasons: winner?.reasons ?? [],
		folderMismatch: winner ? installedFolder(winner.plugin) !== row.slug.toLowerCase() : false,
		...(candidates.length > 0 ? { candidates: candidates.map(toCandidate) } : {})
	};
}

/**
 * Match every library row against the installed plugins and classify it.
 *
 * Two passes: first the per-row best match (same scoring as the inspect
 * endpoint), then a conflict pass — an installed plugin can belong to at
 * most one library row. When two rows claim the same plugin, the higher
 * score keeps it and the other is reported as `ambiguous` (never
 * auto-updated) rather than silently overwriting the same plugin twice.
 */
export function compareLibraryWithInstalled(
	library: LibraryPluginRef[],
	installed: InstalledPluginWithState[]
): LibraryCompareItem[] {
	const activeByPlugin = new Map(installed.map((p) => [p.plugin, p.active]));

	const matched = library.map((row) => {
		const candidates = installed.map((i) => scoreCandidate(row, i));
		const { winner, ambiguous } = pickMatch(candidates);
		return { row, winner, ambiguous };
	});

	const claims = new Map<string, { rowId: string; score: number }>();
	for (const m of matched) {
		if (!m.winner) continue;
		const prev = claims.get(m.winner.plugin);
		if (!prev || m.winner.score > prev.score) {
			claims.set(m.winner.plugin, { rowId: m.row.id, score: m.winner.score });
		}
	}

	const base = matched.map(({ row, winner, ambiguous }) => {
		if (winner && claims.get(winner.plugin)?.rowId !== row.id) {
			return buildItem(row, 'ambiguous', null, null, [winner]);
		}
		if (winner) {
			const cmp = compareWpVersions(row.version, winner.installedVersion);
			const status: LibraryCompareStatus =
				cmp > 0 ? 'update_available' : cmp === 0 ? 'up_to_date' : 'downgrade';
			return buildItem(row, status, winner, activeByPlugin.get(winner.plugin) ?? false, []);
		}
		if (ambiguous.length > 0) {
			return buildItem(row, 'ambiguous', null, null, ambiguous);
		}
		return buildItem(row, 'not_installed', null, null, []);
	});

	const installedByPlugin = new Map(installed.map((p) => [p.plugin, p]));
	const libraryIdByPlugin = new Map(
		base.filter((i) => i.installedPlugin).map((i) => [i.installedPlugin as string, i.libraryId])
	);

	const items: LibraryCompareItem[] = base.map((item) => {
		const matchedPlugin = item.installedPlugin ? installedByPlugin.get(item.installedPlugin) : undefined;
		const wpUpdate = wpSideUpdate(matchedPlugin);
		const preferredSource: 'library' | 'wporg' =
			item.status === 'update_available' &&
			wpUpdate?.installable === true &&
			compareWpVersions(wpUpdate.newVersion, item.libraryVersion) > 0
				? 'wporg'
				: 'library';

		let dependsOn: LibraryDependency | null = null;
		if (matchedPlugin) {
			const found = findBasePlugin(matchedPlugin, installed);
			if (found) {
				const baseLibraryId = libraryIdByPlugin.get(found.plugin) ?? null;
				dependsOn = {
					slug: pluginFolder(found.plugin),
					plugin: found.plugin,
					name: found.name,
					installedVersion: found.version,
					active: found.active,
					via: found.via,
					libraryId: baseLibraryId,
					wpUpdate: baseLibraryId ? null : wpSideUpdate(found)
				};
			}
		}
		return { ...item, wpUpdate, preferredSource, dependsOn };
	});

	items.sort(
		(a, b) =>
			STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
			a.name.localeCompare(b.name, 'ro', { sensitivity: 'base' })
	);
	return items;
}

export type LibraryUpsertOutcome = 'added' | 'replaced' | 'rejected_older';
export type LibraryUpsertRelation = 'none' | 'newer' | 'same' | 'older';

/**
 * Decide what an upload does to the library row with the same slug.
 * Same version is accepted (vendors re-package without bumping); an
 * older version is refused unless the operator forces it.
 */
export function decideLibraryUpsert(
	existingVersion: string | null,
	incomingVersion: string,
	force: boolean
): { outcome: LibraryUpsertOutcome; relation: LibraryUpsertRelation } {
	if (existingVersion === null) return { outcome: 'added', relation: 'none' };
	const cmp = compareWpVersions(incomingVersion, existingVersion);
	if (cmp > 0) return { outcome: 'replaced', relation: 'newer' };
	if (cmp === 0) return { outcome: 'replaced', relation: 'same' };
	return { outcome: force ? 'replaced' : 'rejected_older', relation: 'older' };
}
