/**
 * Turn one site's library comparison into an ordered list of update steps.
 *
 * Rules (confirmed by the operator, 2026-09-25): the base plugin is
 * updated before its PRO, and a PRO never runs when its base failed. A base
 * that only has a wordpress.org update (WP Social Ninja in
 * `wp-social-reviews/`) becomes a `wporg` step; a library row whose
 * wordpress.org version is newer than the library ZIP (free plugins) also
 * runs as `wporg`. Pure, shared by the page and its tests.
 */
import { findBasePlugin, orderBaseFirst, type BaseMatchVia } from './wordpress-plugin-dependencies';

export interface PlanWpUpdate {
	newVersion: string;
	installable: boolean;
}

export interface PlanCompareItem {
	libraryId: string;
	slug: string;
	name: string;
	libraryVersion: string;
	status: 'update_available' | 'up_to_date' | 'downgrade' | 'not_installed' | 'ambiguous';
	installedPlugin: string | null;
	installedVersion: string | null;
	active: boolean | null;
	folderMismatch: boolean;
	wpUpdate: PlanWpUpdate | null;
	preferredSource: 'library' | 'wporg';
	dependsOn: {
		slug: string;
		plugin: string;
		name: string;
		installedVersion: string;
		active: boolean;
		via: BaseMatchVia;
		libraryId: string | null;
		wpUpdate: PlanWpUpdate | null;
	} | null;
}

export interface PlanStep {
	/** Unique within the site: `lib:<libraryId>` or `wporg:<plugin>`. */
	key: string;
	/** `library` = ZIP from the library through /plugins/install; `wporg` = WordPress' own updater. */
	kind: 'library' | 'wporg';
	libraryId: string | null;
	name: string;
	/** WP identifier on the site ("folder/file.php"). */
	plugin: string;
	fromVersion: string | null;
	toVersion: string;
	/** Re-activate after install (only when it was active). wporg steps keep state on their own. */
	activate: boolean;
	/** Added by the planner because a selected PRO needs it. */
	autoIncluded: boolean;
	requiredBy: string | null;
	/** Keys of steps that must succeed first. */
	waitsFor: string[];
}

export function libraryStepKey(libraryId: string): string {
	return `lib:${libraryId}`;
}

export function wporgStepKey(plugin: string): string {
	return `wporg:${plugin}`;
}

function updatable(i: PlanCompareItem): boolean {
	return i.status === 'update_available' && !i.folderMismatch && i.installedPlugin !== null;
}

export function buildSitePlan(
	items: PlanCompareItem[],
	isExcluded: (libraryId: string) => boolean
): PlanStep[] {
	const byId = new Map(items.map((i) => [i.libraryId, i]));
	const selected = new Map<string, { item: PlanCompareItem; requiredBy: string | null }>();
	for (const i of items) {
		if (updatable(i) && !isExcluded(i.libraryId))
			selected.set(i.libraryId, { item: i, requiredBy: null });
	}

	// Pull in library bases the operator unticked: a PRO must not run ahead of its base.
	let grew = true;
	while (grew) {
		grew = false;
		for (const { item } of [...selected.values()]) {
			const baseId = item.dependsOn?.libraryId;
			if (!baseId || selected.has(baseId)) continue;
			const base = byId.get(baseId);
			if (base && updatable(base)) {
				selected.set(baseId, { item: base, requiredBy: item.name });
				grew = true;
			}
		}
	}

	const ordered = orderBaseFirst(
		[...selected.values()].map((s) => ({
			slug: s.item.libraryId,
			dependsOnSlug:
				s.item.dependsOn?.libraryId && selected.has(s.item.dependsOn.libraryId)
					? s.item.dependsOn.libraryId
					: null,
			...s
		}))
	);

	const steps: PlanStep[] = [];
	const wporgBaseAdded = new Set<string>();
	for (const { item, requiredBy } of ordered) {
		const waitsFor: string[] = [];
		const dep = item.dependsOn;
		if (dep?.libraryId && selected.has(dep.libraryId)) {
			waitsFor.push(libraryStepKey(dep.libraryId));
		} else if (dep && !dep.libraryId && dep.wpUpdate?.installable) {
			const key = wporgStepKey(dep.plugin);
			if (!wporgBaseAdded.has(key)) {
				wporgBaseAdded.add(key);
				steps.push({
					key,
					kind: 'wporg',
					libraryId: null,
					name: dep.name,
					plugin: dep.plugin,
					fromVersion: dep.installedVersion,
					toVersion: dep.wpUpdate.newVersion,
					activate: false,
					autoIncluded: true,
					requiredBy: item.name,
					waitsFor: []
				});
			}
			waitsFor.push(key);
		}

		const viaWporg = item.preferredSource === 'wporg' && item.wpUpdate?.installable === true;
		steps.push({
			key: libraryStepKey(item.libraryId),
			kind: viaWporg ? 'wporg' : 'library',
			libraryId: item.libraryId,
			name: item.name,
			plugin: item.installedPlugin as string,
			fromVersion: item.installedVersion,
			toVersion: viaWporg && item.wpUpdate ? item.wpUpdate.newVersion : item.libraryVersion,
			activate: item.active === true,
			autoIncluded: requiredBy !== null,
			requiredBy,
			waitsFor
		});
	}
	return steps;
}

/** A plugin as the site's own plugins page lists it (connector `/plugins`). */
export interface PlanInstalledPlugin {
	plugin: string;
	name: string;
	version: string;
	active: boolean;
	requiresPlugins?: string;
	updateAvailable: boolean;
	newVersion: string | null;
	/** Download URL; null when the vendor gates the update behind a licence. */
	updatePackage?: string | null;
}

function wpInstallable(p: PlanInstalledPlugin): boolean {
	return p.updateAvailable && Boolean(p.updatePackage) && Boolean(p.newVersion);
}

function wporgStep(p: PlanInstalledPlugin, requiredBy: string | null): PlanStep {
	return {
		key: wporgStepKey(p.plugin),
		kind: 'wporg',
		libraryId: null,
		name: p.name,
		plugin: p.plugin,
		fromVersion: p.version,
		toVersion: p.newVersion as string,
		activate: false,
		autoIncluded: requiredBy !== null,
		requiredBy,
		waitsFor: []
	};
}

/**
 * Plan for the plugins ticked on ONE site's plugins page: library updates
 * (through `buildSitePlan`, same rules as the library page) plus updates
 * WordPress can install itself. Licence-gated updates are left out.
 *
 * Base-first holds across both sources: when a selected PRO's base has an
 * installable update it is added (auto-included) and the PRO waits for it,
 * whatever order the operator ticked them in.
 */
export function buildBulkSitePlan(
	items: PlanCompareItem[],
	installed: PlanInstalledPlugin[],
	selected: Set<string>
): PlanStep[] {
	const selectedLib = new Set(
		items
			.filter((i) => i.installedPlugin !== null && selected.has(i.installedPlugin))
			.map((i) => i.libraryId)
	);
	const steps: PlanStep[] =
		selectedLib.size > 0 ? buildSitePlan(items, (id) => !selectedLib.has(id)) : [];
	const covered = new Set(steps.map((s) => s.plugin));
	const byPlugin = new Map(installed.map((p) => [p.plugin, p]));

	for (const plugin of selected) {
		const p = byPlugin.get(plugin);
		if (!p || covered.has(plugin) || !wpInstallable(p)) continue;
		steps.push(wporgStep(p, null));
		covered.add(plugin);
	}

	// Pull in the base of every PRO in the plan (bases of bases too).
	for (let i = 0; i < steps.length; i++) {
		const pro = byPlugin.get(steps[i].plugin);
		const base = pro ? findBasePlugin(pro, installed) : null;
		if (base && !covered.has(base.plugin) && wpInstallable(base)) {
			steps.push(wporgStep(base, steps[i].name));
			covered.add(base.plugin);
		}
	}

	const keyByPlugin = new Map(steps.map((s) => [s.plugin, s.key]));
	const linked = steps.map((step) => {
		const pro = byPlugin.get(step.plugin);
		const base = pro ? findBasePlugin(pro, installed) : null;
		const baseKey = base ? (keyByPlugin.get(base.plugin) ?? null) : null;
		const waitsFor =
			baseKey && !step.waitsFor.includes(baseKey) ? [...step.waitsFor, baseKey] : step.waitsFor;
		return { slug: step.key, dependsOnSlug: waitsFor[0] ?? null, step: { ...step, waitsFor } };
	});
	return orderBaseFirst(linked).map((l) => l.step);
}
