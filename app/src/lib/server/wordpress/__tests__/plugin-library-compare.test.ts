import { describe, test, expect } from 'bun:test';
import { compareLibraryWithInstalled, decideLibraryUpsert } from '../plugin-library-compare';

const lib = (over: Record<string, string> = {}) => ({
	id: 'lib-astra',
	slug: 'astra-addon',
	name: 'Astra Pro',
	version: '4.8.1',
	author: 'Brainstorm Force',
	textDomain: 'astra-addon',
	pluginUri: 'https://wpastra.com/pro/',
	updateUri: '',
	...over
});

const inst = (over: Record<string, string | boolean> = {}) => ({
	plugin: 'astra-addon/astra-addon.php',
	name: 'Astra Pro',
	version: '4.8.0',
	author: 'Brainstorm Force',
	pluginUri: 'https://wpastra.com/pro/',
	textDomain: 'astra-addon',
	active: true,
	...over
});

describe('compareLibraryWithInstalled', () => {
	test('library newer → update_available with installed details', () => {
		const [item] = compareLibraryWithInstalled([lib()], [inst()]);
		expect(item.status).toBe('update_available');
		expect(item.installedPlugin).toBe('astra-addon/astra-addon.php');
		expect(item.installedVersion).toBe('4.8.0');
		expect(item.libraryVersion).toBe('4.8.1');
		expect(item.active).toBe(true);
		expect(item.matchScore).toBeGreaterThanOrEqual(85);
		expect(item.matchReasons).toContain('text_domain_exact');
	});

	test('same version → up_to_date', () => {
		const [item] = compareLibraryWithInstalled([lib()], [inst({ version: '4.8.1' })]);
		expect(item.status).toBe('up_to_date');
	});

	test('site newer than library → downgrade', () => {
		const [item] = compareLibraryWithInstalled([lib()], [inst({ version: '4.9.0' })]);
		expect(item.status).toBe('downgrade');
	});

	test('no plausible match → not_installed with null installed fields', () => {
		const [item] = compareLibraryWithInstalled(
			[lib()],
			[
				inst({
					plugin: 'akismet/akismet.php',
					name: 'Akismet',
					author: 'Automattic',
					textDomain: 'akismet',
					pluginUri: 'https://akismet.com'
				})
			]
		);
		expect(item.status).toBe('not_installed');
		expect(item.installedPlugin).toBeNull();
		expect(item.installedVersion).toBeNull();
		expect(item.active).toBeNull();
	});

	test('inactive installed plugin keeps active=false', () => {
		const [item] = compareLibraryWithInstalled([lib()], [inst({ active: false })]);
		expect(item.active).toBe(false);
	});

	test('matches across a folder rename via text domain', () => {
		const [item] = compareLibraryWithInstalled([lib({ slug: 'astra-addon-4' })], [inst()]);
		expect(item.status).toBe('update_available');
		expect(item.installedPlugin).toBe('astra-addon/astra-addon.php');
	});

	test('two equally plausible installed plugins → ambiguous with candidates', () => {
		const weakLib = lib({ slug: 'zzz', textDomain: '', pluginUri: '' });
		const a = inst({ plugin: 'astra-a/a.php', textDomain: '', pluginUri: '' });
		const b = inst({ plugin: 'astra-b/b.php', textDomain: '', pluginUri: '' });
		const [item] = compareLibraryWithInstalled([weakLib], [a, b]);
		expect(item.status).toBe('ambiguous');
		expect(item.installedPlugin).toBeNull();
		expect(item.candidates?.map((c) => c.plugin).sort()).toEqual(['astra-a/a.php', 'astra-b/b.php']);
	});

	test('same installed plugin claimed by two library rows → higher score keeps it, other becomes ambiguous', () => {
		const strong = lib();
		const weak = lib({ id: 'lib-weak', slug: 'astra-pro-copy', textDomain: '', pluginUri: '' });
		const items = compareLibraryWithInstalled([weak, strong], [inst()]);
		const s = items.find((i) => i.libraryId === 'lib-astra');
		const w = items.find((i) => i.libraryId === 'lib-weak');
		expect(s?.status).toBe('update_available');
		expect(w?.status).toBe('ambiguous');
		expect(w?.installedPlugin).toBeNull();
		expect(w?.candidates?.[0]?.plugin).toBe('astra-addon/astra-addon.php');
	});

	test('sorted by status priority, then by name', () => {
		const items = compareLibraryWithInstalled(
			[
				lib({ id: 'up', slug: 'up-to-date', name: 'B Up', textDomain: 'up', version: '1.0', pluginUri: '' }),
				lib({ id: 'upd-z', slug: 'update-z', name: 'Z Update', textDomain: 'updz', version: '2.0', pluginUri: '' }),
				lib({ id: 'upd-a', slug: 'update-a', name: 'A Update', textDomain: 'upda', version: '2.0', pluginUri: '' }),
				lib({ id: 'miss', slug: 'missing', name: 'C Missing', textDomain: 'miss', pluginUri: '' })
			],
			[
				inst({ plugin: 'up-to-date/p.php', name: 'B Up', textDomain: 'up', version: '1.0', pluginUri: '' }),
				inst({ plugin: 'update-z/p.php', name: 'Z Update', textDomain: 'updz', version: '1.0', pluginUri: '' }),
				inst({ plugin: 'update-a/p.php', name: 'A Update', textDomain: 'upda', version: '1.0', pluginUri: '' })
			]
		);
		expect(items.map((i) => i.libraryId)).toEqual(['upd-a', 'upd-z', 'up', 'miss']);
	});
});

describe('decideLibraryUpsert', () => {
	test('nothing in library → added', () => {
		expect(decideLibraryUpsert(null, '1.0', false)).toEqual({ outcome: 'added', relation: 'none' });
	});
	test('newer than library → replaced', () => {
		expect(decideLibraryUpsert('1.0', '1.1', false)).toEqual({ outcome: 'replaced', relation: 'newer' });
	});
	test('same version → replaced (re-upload)', () => {
		expect(decideLibraryUpsert('1.1', '1.1', false)).toEqual({ outcome: 'replaced', relation: 'same' });
	});
	test('older than library → rejected_older', () => {
		expect(decideLibraryUpsert('1.1', '1.0', false)).toEqual({ outcome: 'rejected_older', relation: 'older' });
	});
	test('older but forced → replaced', () => {
		expect(decideLibraryUpsert('1.1', '1.0', true)).toEqual({ outcome: 'replaced', relation: 'older' });
	});
});

describe('folderMismatch', () => {
	test('true when the matched plugin lives in a different folder than the library slug', () => {
		const [item] = compareLibraryWithInstalled([lib({ slug: 'astra-addon-4' })], [inst()]);
		expect(item.status).toBe('update_available');
		expect(item.folderMismatch).toBe(true);
	});
	test('false on a normal match and on no match', () => {
		const [matched] = compareLibraryWithInstalled([lib()], [inst()]);
		expect(matched.folderMismatch).toBe(false);
		const [missing] = compareLibraryWithInstalled([lib()], []);
		expect(missing.folderMismatch).toBe(false);
	});
});

describe('dependsOn (base plugin before PRO)', () => {
	test('a PRO item reports its installed base (matched by name) and the wp.org update pending on it', () => {
		const pro = lib({ id: 'lib-sn-pro', slug: 'wp-social-ninja-pro', name: 'WP Social Ninja Pro', version: '4.4.0', textDomain: 'wp-social-ninja-pro', pluginUri: '' });
		const installedPro = inst({ plugin: 'wp-social-ninja-pro/wp-social-ninja-pro.php', name: 'WP Social Ninja Pro', version: '4.0.1', textDomain: 'wp-social-ninja-pro', pluginUri: '' });
		const installedBase = {
			...inst({ plugin: 'wp-social-reviews/wp-social-reviews.php', name: 'WP Social Ninja', version: '4.2.2', textDomain: 'wp-social-reviews', pluginUri: '' }),
			updateAvailable: true,
			newVersion: '4.4.0',
			updatePackage: 'https://downloads.wordpress.org/plugin/wp-social-reviews.4.4.0.zip'
		};
		const [item] = compareLibraryWithInstalled([pro], [installedPro, installedBase]);
		expect(item.status).toBe('update_available');
		expect(item.dependsOn).toEqual({
			slug: 'wp-social-reviews',
			plugin: 'wp-social-reviews/wp-social-reviews.php',
			name: 'WP Social Ninja',
			installedVersion: '4.2.2',
			active: true,
			via: 'name',
			libraryId: null,
			wpUpdate: { newVersion: '4.4.0', installable: true }
		});
	});

	test('when the base is also in the library, dependsOn points at that library row and has no wp.org update', () => {
		const base = lib({ id: 'lib-el', slug: 'elementor', name: 'Elementor', version: '4.3.1', textDomain: 'elementor', pluginUri: '' });
		const pro = lib({ id: 'lib-el-pro', slug: 'elementor-pro', name: 'Elementor Pro', version: '4.3.0', textDomain: 'elementor-pro', pluginUri: '' });
		const items = compareLibraryWithInstalled(
			[pro, base],
			[
				inst({ plugin: 'elementor/elementor.php', name: 'Elementor', version: '4.1.2', textDomain: 'elementor', pluginUri: '' }),
				inst({ plugin: 'elementor-pro/elementor-pro.php', name: 'Elementor Pro', version: '4.1.1', textDomain: 'elementor-pro', pluginUri: '' })
			]
		);
		const proItem = items.find((i) => i.libraryId === 'lib-el-pro')!;
		expect(proItem.dependsOn?.libraryId).toBe('lib-el');
		expect(proItem.dependsOn?.wpUpdate).toBeNull();
		expect(items.find((i) => i.libraryId === 'lib-el')?.dependsOn).toBeNull();
	});

	test('no base installed → dependsOn is null', () => {
		const [item] = compareLibraryWithInstalled([lib()], [inst()]);
		expect(item.dependsOn).toBeNull();
	});
});

describe('wordpress.org vs library (free plugins)', () => {
	test('wp.org offers a newer version than the library → preferredSource wporg', () => {
		const base = lib({ id: 'lib-el', slug: 'elementor', name: 'Elementor', version: '4.3.1', textDomain: 'elementor', pluginUri: '' });
		const installed = {
			...inst({ plugin: 'elementor/elementor.php', name: 'Elementor', version: '4.1.2', textDomain: 'elementor', pluginUri: '' }),
			updateAvailable: true,
			newVersion: '4.3.2',
			updatePackage: 'https://downloads.wordpress.org/plugin/elementor.4.3.2.zip'
		};
		const [item] = compareLibraryWithInstalled([base], [installed]);
		expect(item.status).toBe('update_available');
		expect(item.wpUpdate).toEqual({ newVersion: '4.3.2', installable: true });
		expect(item.preferredSource).toBe('wporg');
	});

	test('library newer than wp.org (or no wp.org update) → preferredSource library', () => {
		const [item] = compareLibraryWithInstalled([lib()], [inst()]);
		expect(item.wpUpdate).toBeNull();
		expect(item.preferredSource).toBe('library');
	});

	test('license-gated update (no package) is reported but never preferred', () => {
		const installed = { ...inst(), updateAvailable: true, newVersion: '9.9.9', updatePackage: null };
		const [item] = compareLibraryWithInstalled([lib()], [installed]);
		expect(item.wpUpdate).toEqual({ newVersion: '9.9.9', installable: false });
		expect(item.preferredSource).toBe('library');
	});
});
