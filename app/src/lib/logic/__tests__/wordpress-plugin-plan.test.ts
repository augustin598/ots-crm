import { describe, test, expect } from 'bun:test';
import { buildBulkSitePlan, buildSitePlan, type PlanCompareItem } from '../wordpress-plugin-plan';

function item(over: Partial<PlanCompareItem> & { libraryId: string; name: string }): PlanCompareItem {
	return {
		slug: over.libraryId,
		libraryVersion: '2.0',
		status: 'update_available',
		installedPlugin: `${over.libraryId}/${over.libraryId}.php`,
		installedVersion: '1.0',
		active: true,
		folderMismatch: false,
		wpUpdate: null,
		preferredSource: 'library',
		dependsOn: null,
		...over
	};
}

const none = () => false;

describe('buildSitePlan', () => {
	test('PRO whose base only has a wordpress.org update: base step first, PRO waits for it', () => {
		const pro = item({
			libraryId: 'sn-pro',
			name: 'WP Social Ninja Pro',
			libraryVersion: '4.4.0',
			installedVersion: '4.0.1',
			dependsOn: {
				slug: 'wp-social-reviews',
				plugin: 'wp-social-reviews/wp-social-reviews.php',
				name: 'WP Social Ninja',
				installedVersion: '4.2.2',
				active: true,
				via: 'name',
				libraryId: null,
				wpUpdate: { newVersion: '4.4.0', installable: true }
			}
		});
		const steps = buildSitePlan([pro], none);
		expect(steps.map((s) => [s.kind, s.name, s.toVersion])).toEqual([
			['wporg', 'WP Social Ninja', '4.4.0'],
			['library', 'WP Social Ninja Pro', '4.4.0']
		]);
		expect(steps[0].autoIncluded).toBe(true);
		expect(steps[0].requiredBy).toBe('WP Social Ninja Pro');
		expect(steps[1].waitsFor).toEqual([steps[0].key]);
		expect(steps[1].plugin).toBe('sn-pro/sn-pro.php');
		expect(steps[1].activate).toBe(true);
	});

	test('base in the library comes first even when listed after the PRO; wp.org-preferred base runs as a wporg step', () => {
		const base = item({
			libraryId: 'el',
			name: 'Elementor',
			libraryVersion: '4.3.1',
			installedVersion: '4.1.2',
			wpUpdate: { newVersion: '4.3.2', installable: true },
			preferredSource: 'wporg'
		});
		const pro = item({
			libraryId: 'el-pro',
			name: 'Elementor Pro',
			libraryVersion: '4.3.0',
			installedVersion: '4.1.1',
			dependsOn: {
				slug: 'el',
				plugin: 'el/el.php',
				name: 'Elementor',
				installedVersion: '4.1.2',
				active: true,
				via: 'folder',
				libraryId: 'el',
				wpUpdate: null
			}
		});
		const steps = buildSitePlan([pro, base], none);
		expect(steps.map((s) => [s.kind, s.name, s.toVersion])).toEqual([
			['wporg', 'Elementor', '4.3.2'],
			['library', 'Elementor Pro', '4.3.0']
		]);
		expect(steps[1].waitsFor).toEqual([steps[0].key]);
		expect(steps[0].autoIncluded).toBe(false);
	});

	test('an unticked base is re-included automatically when its PRO is selected', () => {
		const base = item({ libraryId: 'rm', name: 'Rank Math SEO' });
		const pro = item({
			libraryId: 'rm-pro',
			name: 'Rank Math SEO PRO',
			dependsOn: {
				slug: 'rm',
				plugin: 'rm/rm.php',
				name: 'Rank Math SEO',
				installedVersion: '1.0',
				active: true,
				via: 'folder',
				libraryId: 'rm',
				wpUpdate: null
			}
		});
		const steps = buildSitePlan([base, pro], (id) => id === 'rm');
		expect(steps.map((s) => s.name)).toEqual(['Rank Math SEO', 'Rank Math SEO PRO']);
		expect(steps[0].autoIncluded).toBe(true);
		expect(steps[0].requiredBy).toBe('Rank Math SEO PRO');
	});

	test('a base that is already up to date adds no step and no wait', () => {
		const base = item({ libraryId: 'el', name: 'Elementor', status: 'up_to_date' });
		const pro = item({
			libraryId: 'el-pro',
			name: 'Elementor Pro',
			dependsOn: {
				slug: 'el',
				plugin: 'el/el.php',
				name: 'Elementor',
				installedVersion: '2.0',
				active: true,
				via: 'folder',
				libraryId: 'el',
				wpUpdate: null
			}
		});
		const steps = buildSitePlan([base, pro], none);
		expect(steps.map((s) => s.name)).toEqual(['Elementor Pro']);
		expect(steps[0].waitsFor).toEqual([]);
	});

	test('excluded, folder-mismatched and non-update items are left out', () => {
		const steps = buildSitePlan(
			[
				item({ libraryId: 'a', name: 'A' }),
				item({ libraryId: 'b', name: 'B', folderMismatch: true }),
				item({ libraryId: 'c', name: 'C', status: 'downgrade' }),
				item({ libraryId: 'd', name: 'D' })
			],
			(id) => id === 'd'
		);
		expect(steps.map((s) => s.name)).toEqual(['A']);
	});

	test('inactive plugins are installed without activation', () => {
		const steps = buildSitePlan([item({ libraryId: 'x', name: 'X', active: false })], none);
		expect(steps[0].activate).toBe(false);
	});
});

describe('buildBulkSitePlan', () => {
	type P = Parameters<typeof buildBulkSitePlan>[1][number];
	function wp(over: Partial<P> & { plugin: string; name: string }): P {
		return {
			version: '1.0',
			active: true,
			updateAvailable: false,
			newVersion: null,
			updatePackage: null,
			...over
		};
	}

	test('library + WordPress selectate împreună, fără dubluri', () => {
		const lib = item({ libraryId: 'ame', name: 'Admin Menu Editor Pro', installedPlugin: 'ame/menu-editor.php' });
		const installed = [
			wp({ plugin: 'ame/menu-editor.php', name: 'Admin Menu Editor Pro', updateAvailable: true, newVersion: '2.0', updatePackage: 'https://x' }),
			wp({ plugin: 'aio/aio.php', name: 'All-in-One', updateAvailable: true, newVersion: '7.111', updatePackage: 'https://y' })
		];
		const steps = buildBulkSitePlan([lib], installed, new Set(['ame/menu-editor.php', 'aio/aio.php']));
		expect(steps.map((s) => [s.key, s.kind])).toEqual([
			['lib:ame', 'library'],
			['wporg:aio/aio.php', 'wporg']
		]);
	});

	test('PRO din WordPress: baza cu update e inclusă automat și rulează prima', () => {
		const installed = [
			wp({ plugin: 'elementor-pro/elementor-pro.php', name: 'Elementor Pro', updateAvailable: true, newVersion: '4.3.0', updatePackage: 'https://p' }),
			wp({ plugin: 'elementor/elementor.php', name: 'Elementor', updateAvailable: true, newVersion: '4.3.1', updatePackage: 'https://b' })
		];
		const steps = buildBulkSitePlan([], installed, new Set(['elementor-pro/elementor-pro.php']));
		expect(steps.map((s) => s.key)).toEqual([
			'wporg:elementor/elementor.php',
			'wporg:elementor-pro/elementor-pro.php'
		]);
		expect(steps[0]).toMatchObject({ autoIncluded: true, requiredBy: 'Elementor Pro' });
		expect(steps[1].waitsFor).toEqual(['wporg:elementor/elementor.php']);
	});

	test('baza selectată după PRO în listă tot rulează prima', () => {
		const installed = [
			wp({ plugin: 'seo-by-rank-math-pro/rank-math-pro.php', name: 'Rank Math SEO PRO', updateAvailable: true, newVersion: '3.1', updatePackage: 'https://p' }),
			wp({ plugin: 'seo-by-rank-math/rank-math.php', name: 'Rank Math SEO', updateAvailable: true, newVersion: '1.1', updatePackage: 'https://b' })
		];
		const steps = buildBulkSitePlan(
			[],
			installed,
			new Set(['seo-by-rank-math-pro/rank-math-pro.php', 'seo-by-rank-math/rank-math.php'])
		);
		expect(steps.map((s) => s.plugin)).toEqual([
			'seo-by-rank-math/rank-math.php',
			'seo-by-rank-math-pro/rank-math-pro.php'
		]);
		expect(steps[0].autoIncluded).toBe(false);
	});

	test('update blocat de licență (fără pachet) sau fără update → ignorat', () => {
		const installed = [
			wp({ plugin: 'astra-addon/astra-addon.php', name: 'Astra Pro', updateAvailable: true, newVersion: '4.13.10', updatePackage: null }),
			wp({ plugin: 'chaty-pro/cht-icons.php', name: 'Chaty Pro' })
		];
		expect(
			buildBulkSitePlan([], installed, new Set(['astra-addon/astra-addon.php', 'chaty-pro/cht-icons.php']))
		).toEqual([]);
	});
});
