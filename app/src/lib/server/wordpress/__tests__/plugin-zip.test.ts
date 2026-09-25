import { describe, test, expect } from 'bun:test';
import JSZip from 'jszip';
import {
	inspectPluginZip,
	listNestedZips,
	parsePluginHeader,
	repackAtSlugRoot,
	normalizePluginZip,
	PluginZipError,
	type PluginZipErrorCode
} from '../plugin-zip';

const HEADER = `<?php
/**
 * Plugin Name: Astra Pro
 * Plugin URI: https://wpastra.com/pro/
 * Description: Premium addon for Astra.
 * Version: 4.8.1
 * Author: Brainstorm Force
 * Text Domain: astra-addon
 * Requires at least: 5.3
 * Requires PHP: 7.4
 */
`;

async function buildZip(files: Record<string, string>): Promise<Buffer> {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(files)) zip.file(path, content);
	return zip.generateAsync({ type: 'nodebuffer' });
}

async function expectZipError(p: Promise<unknown>, code: PluginZipErrorCode) {
	let err: unknown;
	try {
		await p;
	} catch (e) {
		err = e;
	}
	expect(err).toBeInstanceOf(PluginZipError);
	expect((err as PluginZipError).code).toBe(code);
}

describe('parsePluginHeader', () => {
	test('reads fields behind comment prefixes and CRLF line endings', () => {
		const h = parsePluginHeader(
			'<?php\r\n/*\r\n * Plugin Name: WP Mail SMTP Pro\r\n * Version: 4.5.0\r\n * Text Domain: wp-mail-smtp-pro\r\n */\r\n'
		);
		expect(h.name).toBe('WP Mail SMTP Pro');
		expect(h.version).toBe('4.5.0');
		expect(h.textDomain).toBe('wp-mail-smtp-pro');
	});

	test('ignores headers past the first 16 KB (matches WP get_file_data)', () => {
		const h = parsePluginHeader('x'.repeat(17_000) + '\nPlugin Name: Late\n');
		expect(h.name).toBeUndefined();
	});
});

describe('inspectPluginZip', () => {
	test('standard layout → slug, WP plugin identifier and header fields', async () => {
		const buf = await buildZip({ 'astra-addon/astra-addon.php': HEADER, 'astra-addon/readme.txt': 'x' });
		const info = await inspectPluginZip(buf);
		expect(info.slug).toBe('astra-addon');
		expect(info.pluginFile).toBe('astra-addon/astra-addon.php');
		expect(info.name).toBe('Astra Pro');
		expect(info.version).toBe('4.8.1');
		expect(info.textDomain).toBe('astra-addon');
		expect(info.author).toBe('Brainstorm Force');
		expect(info.requiresPhp).toBe('7.4');
		expect(info.sizeBytes).toBe(buf.length);
	});

	test('vendor wrapper folder → slug is the folder holding the main php, not the wrapper', async () => {
		const buf = await buildZip({ 'download/astra-addon/astra-addon.php': HEADER });
		const info = await inspectPluginZip(buf);
		expect(info.slug).toBe('astra-addon');
		expect(info.pluginFile).toBe('astra-addon/astra-addon.php');
	});

	test('picks the php that carries the header, not helper files', async () => {
		const buf = await buildZip({
			'elementor-pro/includes/helper.php': '<?php // no header here',
			'elementor-pro/elementor-pro.php': HEADER.replace('Astra Pro', 'Elementor Pro')
		});
		const info = await inspectPluginZip(buf);
		expect(info.pluginFile).toBe('elementor-pro/elementor-pro.php');
		expect(info.name).toBe('Elementor Pro');
	});

	test('no plugin header anywhere → no_plugin_file', async () => {
		const buf = await buildZip({ 'theme/style.css': 'x', 'theme/functions.php': '<?php // theme' });
		await expectZipError(inspectPluginZip(buf), 'no_plugin_file');
	});

	test('header without Version → no_version', async () => {
		const buf = await buildZip({ 'p/p.php': '<?php\n/*\nPlugin Name: No Version\n*/' });
		await expectZipError(inspectPluginZip(buf), 'no_version');
	});

	test('garbage bytes → invalid_zip', async () => {
		await expectZipError(inspectPluginZip(Buffer.from('definitely not a zip')), 'invalid_zip');
	});
});

describe('listNestedZips', () => {
	test('returns inner .zip entries (sorted by name) with their bytes, skipping __MACOSX and non-zip files', async () => {
		const inner1 = await buildZip({ 'elementor-pro/elementor-pro.php': HEADER.replace('Astra Pro', 'Elementor Pro') });
		const inner2 = await buildZip({ 'elementor/elementor.php': HEADER.replace('Astra Pro', 'Elementor') });
		const outer = new JSZip();
		outer.file('elementor-pro-4.3.0.zip', inner1);
		outer.file('extras/elementor-4.3.0.zip', inner2);
		outer.file('__MACOSX/._elementor-pro-4.3.0.zip', Buffer.from('junk'));
		outer.file('readme.txt', 'unzip first');
		const buf = await outer.generateAsync({ type: 'nodebuffer' });

		const nested = await listNestedZips(buf);
		expect(nested.map((n) => n.filename)).toEqual(['elementor-4.3.0.zip', 'elementor-pro-4.3.0.zip']);
		const pro = nested.find((n) => n.filename === 'elementor-pro-4.3.0.zip')!;
		expect(pro.buffer?.equals(inner1)).toBe(true);
	});

	test('a plain plugin zip has no nested zips', async () => {
		const buf = await buildZip({ 'astra-addon/astra-addon.php': HEADER });
		expect(await listNestedZips(buf)).toEqual([]);
	});

	test('garbage bytes → invalid_zip with the decoder reason in the message', async () => {
		let err: unknown;
		try {
			await listNestedZips(Buffer.from('definitely not a zip'));
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(PluginZipError);
		expect((err as PluginZipError).code).toBe('invalid_zip');
		expect((err as PluginZipError).message).toMatch(/ZIP invalid sau corupt \(.+\)/);
	});
});

describe('review fixes', () => {
	test('a slug with unsafe characters is not accepted as a plugin folder', async () => {
		const buf = await buildZip({ 'bad slug!/plugin.php': HEADER });
		await expectZipError(inspectPluginZip(buf), 'no_plugin_file');
	});

	test('wrapper-shaped zip reports its root prefix; standard zip has none', async () => {
		const wrapped = await inspectPluginZip(await buildZip({ 'download/astra-addon/astra-addon.php': HEADER }));
		expect(wrapped.rootPrefix).toBe('download/');
		const standard = await inspectPluginZip(await buildZip({ 'astra-addon/astra-addon.php': HEADER }));
		expect(standard.rootPrefix).toBe('');
	});

	test('repackAtSlugRoot moves a wrapped plugin to the archive root so Plugin_Upgrader accepts it', async () => {
		const wrapped = await buildZip({
			'download/astra-addon/astra-addon.php': HEADER,
			'download/astra-addon/inc/helper.php': '<?php // helper',
			'download/readme.txt': 'ignore me'
		});
		const repacked = await repackAtSlugRoot(wrapped, 'download/', 'astra-addon');
		const zip = await JSZip.loadAsync(repacked);
		const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
		expect(names).toEqual(['astra-addon/astra-addon.php', 'astra-addon/inc/helper.php']);
		const info = await inspectPluginZip(repacked);
		expect(info.rootPrefix).toBe('');
		expect(info.pluginFile).toBe('astra-addon/astra-addon.php');
	});

	test('listNestedZips skips inner zips above the size cap with an explicit reason', async () => {
		const small = await buildZip({ 'p/p.php': HEADER });
		const outer = new JSZip();
		outer.file('small.zip', small);
		outer.file('huge.zip', Buffer.alloc(3000, 1));
		const buf = await outer.generateAsync({ type: 'nodebuffer' });
		const nested = await listNestedZips(buf, { maxBytes: 2000 });
		expect(nested.map((n) => n.filename)).toEqual(['huge.zip', 'small.zip']);
		expect(nested.find((n) => n.filename === 'huge.zip')?.skipped).toMatch(/2000/);
		expect(nested.find((n) => n.filename === 'small.zip')?.buffer?.length).toBeGreaterThan(0);
	});
});

describe('normalizePluginZip — fișiere în plus lângă folderul plugin-ului', () => {
	test('ZIP de vendor cu un .zip bonus la rădăcină (Product Catalog Feed Pro) → rămâne doar folderul', async () => {
		const buf = await buildZip({
			'product-catalog-feed-pro/product-catalog-feed-pro.php': HEADER,
			'product-catalog-feed-pro/inc/a.php': '<?php // a',
			'woocommerce-pip.zip': 'PK-bonus'
		});
		const before = await inspectPluginZip(buf);
		expect(before.strayEntries).toBe(1);

		const out = await normalizePluginZip(buf);
		expect(out.repacked).toBe(true);
		expect(out.info.strayEntries).toBe(0);
		const zip = await JSZip.loadAsync(out.buffer);
		expect(Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()).toEqual([
			'product-catalog-feed-pro/inc/a.php',
			'product-catalog-feed-pro/product-catalog-feed-pro.php'
		]);
	});

	test('wrapper + fișiere în plus → folderul ajunge la rădăcină, restul dispare', async () => {
		const buf = await buildZip({
			'download/astra-addon/astra-addon.php': HEADER,
			'download/licence.txt': 'x',
			'readme.html': 'x'
		});
		const out = await normalizePluginZip(buf);
		expect(out.repacked).toBe(true);
		expect(out.info).toMatchObject({ rootPrefix: '', strayEntries: 0, pluginFile: 'astra-addon/astra-addon.php' });
	});

	test('ZIP standard → neatins (același buffer)', async () => {
		const buf = await buildZip({ 'astra-addon/astra-addon.php': HEADER, 'astra-addon/readme.txt': 'x' });
		const out = await normalizePluginZip(buf);
		expect(out.repacked).toBe(false);
		expect(out.buffer).toBe(buf);
	});

	test('intrările __MACOSX nu contează ca fișiere în plus', async () => {
		const buf = await buildZip({ 'astra-addon/astra-addon.php': HEADER, '__MACOSX/astra-addon/._astra-addon.php': 'x' });
		expect((await inspectPluginZip(buf)).strayEntries).toBe(1);
		expect((await normalizePluginZip(buf)).repacked).toBe(true);
	});
});
