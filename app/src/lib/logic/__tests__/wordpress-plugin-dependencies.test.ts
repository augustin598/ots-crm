import { describe, test, expect } from 'bun:test';
import {
	baseNameCandidates,
	baseSlugCandidates,
	findBasePlugin,
	orderBaseFirst
} from '../wordpress-plugin-dependencies';

describe('baseSlugCandidates (folder rule)', () => {
	test('strips PRO-style suffixes and offers lite/free variants', () => {
		expect(baseSlugCandidates('wp-social-ninja-pro')).toEqual([
			'wp-social-ninja',
			'wp-social-ninja-lite',
			'wp-social-ninja-free'
		]);
		expect(baseSlugCandidates('elementor-pro')).toContain('elementor');
		expect(baseSlugCandidates('seo-by-rank-math-pro')).toContain('seo-by-rank-math');
		expect(baseSlugCandidates('astra-addon')).toContain('astra');
	});
	test('knows vendor folders the suffix rule cannot derive', () => {
		expect(baseSlugCandidates('essential-addons-elementor')).toContain('essential-addons-for-elementor-lite');
	});
	test('a plain base plugin has no candidates', () => {
		expect(baseSlugCandidates('elementor')).toEqual([]);
		expect(baseSlugCandidates('akismet')).toEqual([]);
	});
});

describe('baseNameCandidates (name rule)', () => {
	test('drops a trailing Pro / PRO / Premium / "- Pro"', () => {
		expect(baseNameCandidates('WP Social Ninja Pro')).toEqual(['wp social ninja']);
		expect(baseNameCandidates('Rank Math SEO PRO')).toEqual(['rank math seo']);
		expect(baseNameCandidates('Essential Addons for Elementor - Pro')).toEqual(['essential addons for elementor']);
		expect(baseNameCandidates('Foo Premium')).toEqual(['foo']);
	});
	test('names without a PRO marker yield nothing', () => {
		expect(baseNameCandidates('Elementor')).toEqual([]);
		expect(baseNameCandidates('Pro')).toEqual([]);
	});
});

const p = (plugin: string, name: string, active = true, requiresPlugins = '') => ({
	plugin,
	name,
	active,
	requiresPlugins
});

describe('findBasePlugin', () => {
	test('matches by name when the base lives in an unrelated folder (wp-social-reviews)', () => {
		const installed = [
			p('wp-social-reviews/wp-social-reviews.php', 'WP Social Ninja'),
			p('wp-social-ninja-pro/wp-social-ninja-pro.php', 'WP Social Ninja Pro')
		];
		const base = findBasePlugin(installed[1], installed);
		expect(base?.plugin).toBe('wp-social-reviews/wp-social-reviews.php');
		expect(base?.via).toBe('name');
	});

	test('matches by folder rule', () => {
		const installed = [p('elementor/elementor.php', 'Elementor'), p('elementor-pro/elementor-pro.php', 'Elementor Pro')];
		expect(findBasePlugin(installed[1], installed)?.plugin).toBe('elementor/elementor.php');
	});

	test('"Requires Plugins" header wins and does not need the base to be active', () => {
		const installed = [
			p('woocommerce/woocommerce.php', 'WooCommerce', false),
			p('woo-variation-swatches-pro/woo-variation-swatches-pro.php', 'Variation Swatches Pro', true, 'woocommerce, woo-variation-swatches'),
			p('woo-variation-swatches/woo-variation-swatches.php', 'Variation Swatches for WooCommerce')
		];
		const base = findBasePlugin(installed[1], installed);
		expect(base?.plugin).toBe('woo-variation-swatches/woo-variation-swatches.php');
		expect(base?.via).toBe('requires_plugins');
	});

	test('heuristic matches need an ACTIVE base (standalone PROs keep an inactive lite around)', () => {
		const installed = [p('wp-mail-smtp/wp_mail_smtp.php', 'WP Mail SMTP', false), p('wp-mail-smtp-pro/wp_mail_smtp.php', 'WP Mail SMTP Pro')];
		expect(findBasePlugin(installed[1], installed)).toBeNull();
	});

	test('no base installed → null; never pairs a plugin with itself', () => {
		const installed = [p('seo-by-rank-math-pro/rank-math-pro.php', 'Rank Math SEO PRO')];
		expect(findBasePlugin(installed[0], installed)).toBeNull();
	});
});

describe('orderBaseFirst', () => {
	const item = (slug: string, dependsOnSlug: string | null = null) => ({ slug, dependsOnSlug });
	test('puts a base plugin before the PRO that depends on it, keeps the rest in place', () => {
		const ordered = orderBaseFirst([
			item('elementor-pro', 'elementor'),
			item('akismet'),
			item('elementor'),
			item('seo-by-rank-math-pro', 'seo-by-rank-math'),
			item('seo-by-rank-math')
		]);
		expect(ordered.map((i) => i.slug)).toEqual([
			'elementor',
			'elementor-pro',
			'akismet',
			'seo-by-rank-math',
			'seo-by-rank-math-pro'
		]);
	});
	test('a PRO whose base is not in the list stays where it is', () => {
		const ordered = orderBaseFirst([item('wp-social-ninja-pro', 'wp-social-reviews'), item('akismet')]);
		expect(ordered.map((i) => i.slug)).toEqual(['wp-social-ninja-pro', 'akismet']);
	});
	test('cycles do not loop forever', () => {
		const ordered = orderBaseFirst([item('a', 'b'), item('b', 'a')]);
		expect(ordered.map((i) => i.slug).sort()).toEqual(['a', 'b']);
	});
});
