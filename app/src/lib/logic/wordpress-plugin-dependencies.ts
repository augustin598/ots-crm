/**
 * PRO → base plugin detection and base-first ordering.
 *
 * Most premium plugins are add-ons that need their free edition installed
 * and recent enough (Elementor Pro → Elementor, Rank Math PRO → Rank Math,
 * WP Social Ninja Pro → WP Social Ninja, Essential Addons Pro → Essential
 * Addons Lite). Updating the PRO first leaves the site with "PRO requires
 * base ≥ x.y" until the base catches up, so the base always goes first.
 *
 * Signals, strongest first:
 *   1. `Requires Plugins` header (WordPress 6.5+) on the installed PRO, when
 *      one of the required slugs also looks like its base;
 *   2. folder rule: `<base>-pro`, `<base>-premium`, `<base>-addon`, … plus a
 *      short list of vendor folders the rule cannot derive;
 *   3. name rule: "WP Social Ninja Pro" → "WP Social Ninja" (the free plugin
 *      lives in `wp-social-reviews/`, so the folder rule alone misses it).
 * Heuristic matches (2, 3) need the base to be ACTIVE: standalone PROs such
 * as WP Mail SMTP Pro replace their lite edition, which stays inactive.
 * Pure functions, no I/O.
 */

const FOLDER_SUFFIXES = ['-pro', '-premium', '-plus', '-add-on', '-addon', '-extended'];

/** Vendor folders whose free edition cannot be derived from the name. PRO folder → base folders. */
const KNOWN_BASE_FOLDERS: Record<string, string[]> = {
	'essential-addons-elementor': ['essential-addons-for-elementor-lite']
};

/** "WP Social Ninja Pro", "Rank Math SEO PRO", "Essential Addons for Elementor - Pro", "Foo Premium". */
const NAME_PRO_SUFFIX = /(?:\s+|\s*[-–—:|]\s*)(?:pro|premium)\s*$/i;

export type BaseMatchVia = 'requires_plugins' | 'folder' | 'name';

export interface DependencyCandidate {
	plugin: string; // WP identifier, "folder/file.php"
	name: string;
	active: boolean;
	/** Raw `Requires Plugins` header, comma separated slugs (connector ≥ 0.7.1). */
	requiresPlugins?: string;
}

export function pluginFolder(plugin: string): string {
	return plugin.split('/')[0].toLowerCase();
}

/** Folder names the free edition of `slug` may use, most likely first. */
export function baseSlugCandidates(slug: string): string[] {
	const s = slug.toLowerCase();
	const out: string[] = [...(KNOWN_BASE_FOLDERS[s] ?? [])];
	for (const suffix of FOLDER_SUFFIXES) {
		if (s.endsWith(suffix) && s.length > suffix.length) {
			const base = s.slice(0, -suffix.length);
			for (const candidate of [base, `${base}-lite`, `${base}-free`]) {
				if (candidate !== s && !out.includes(candidate)) out.push(candidate);
			}
			break;
		}
	}
	return out;
}

/** Lower-cased plugin name of the free edition, or [] when the name has no PRO marker. */
export function baseNameCandidates(name: string): string[] {
	const trimmed = name.trim();
	if (!NAME_PRO_SUFFIX.test(trimmed)) return [];
	const base = trimmed.replace(NAME_PRO_SUFFIX, '').trim().toLowerCase();
	return base ? [base] : [];
}

/**
 * The installed plugin `pro` depends on, or null. `installed` is the full
 * plugin list of the site (the PRO itself included; it is never returned).
 */
export function findBasePlugin<T extends DependencyCandidate>(
	pro: T,
	installed: T[]
): (T & { via: BaseMatchVia }) | null {
	const others = installed.filter((p) => p.plugin !== pro.plugin);
	const folderCandidates = baseSlugCandidates(pluginFolder(pro.plugin));
	const nameCandidates = baseNameCandidates(pro.name);
	const looksLikeBase = (p: T) =>
		folderCandidates.includes(pluginFolder(p.plugin)) ||
		nameCandidates.includes(p.name.trim().toLowerCase());

	// 1) Requires Plugins: authoritative, but only for the slug that is this
	//    PRO's own base (not generic deps like woocommerce).
	const required = (pro.requiresPlugins ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	for (const slug of required) {
		const hit = others.find((p) => pluginFolder(p.plugin) === slug);
		if (hit && looksLikeBase(hit)) return { ...hit, via: 'requires_plugins' };
	}

	// 2) Folder rule, active base only.
	for (const slug of folderCandidates) {
		const hit = others.find((p) => p.active && pluginFolder(p.plugin) === slug);
		if (hit) return { ...hit, via: 'folder' };
	}

	// 3) Name rule, active base only.
	const byName = others.find(
		(p) => p.active && nameCandidates.includes(p.name.trim().toLowerCase())
	);
	return byName ? { ...byName, via: 'name' } : null;
}

/**
 * Stable order where every item comes after the item it depends on (when
 * that item is in the list). Items without a dependency keep their place.
 */
export function orderBaseFirst<T extends { slug: string; dependsOnSlug: string | null }>(
	items: T[]
): T[] {
	const bySlug = new Map(items.map((i) => [i.slug, i]));
	const out: T[] = [];
	const done = new Set<string>();
	const visiting = new Set<string>();
	const visit = (item: T) => {
		if (done.has(item.slug) || visiting.has(item.slug)) return;
		visiting.add(item.slug);
		const base = item.dependsOnSlug ? bySlug.get(item.dependsOnSlug) : undefined;
		if (base) visit(base);
		visiting.delete(item.slug);
		if (!done.has(item.slug)) {
			done.add(item.slug);
			out.push(item);
		}
	};
	for (const item of items) visit(item);
	return out;
}
