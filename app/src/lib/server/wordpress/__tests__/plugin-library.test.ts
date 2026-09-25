import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

// mock.module e GLOBAL în bun; oferim setul complet de operatori drizzle ca
// nimic co-rulat să nu pice pe un export lipsă (vezi sync-scope.test.ts).
const passthrough = () => ({});
mock.module('drizzle-orm', () => ({
	eq: (col: unknown, val: unknown) => ({ kind: 'eq', col, val }),
	and: (...conds: unknown[]) => ({ kind: 'and', conds }),
	asc: passthrough,
	desc: passthrough,
	lte: passthrough,
	gte: passthrough,
	lt: passthrough,
	gt: passthrough,
	or: passthrough,
	ne: passthrough,
	isNull: passthrough,
	isNotNull: passthrough,
	inArray: passthrough,
	sql: passthrough
}));

const col = (name: string) => ({ name });
const wordpressPluginLibrary = {
	id: col('id'),
	tenantId: col('tenant_id'),
	slug: col('slug'),
	name: col('name'),
	version: col('version'),
	objectKey: col('object_key'),
	sha256: col('sha256')
};
mock.module('$lib/server/db/schema', () => ({
	wordpressPluginLibrary,
	wordpressSite: {},
	wordpressUpdateJob: {},
	tenant: {},
	user: {}
}));

type Row = Record<string, unknown>;
let selectRows: Row[] = [];
const selectWheres: unknown[] = [];
const inserted: Row[] = [];
const updated: Array<{ set: Row; where: unknown }> = [];
const deleted: unknown[] = [];
const dbMock = {
	select: () => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			where: (w: unknown) => {
				selectWheres.push(w);
				return chain;
			},
			orderBy: () => chain,
			limit: () => chain,
			then: (r: (rows: Row[]) => unknown) => r(selectRows)
		};
		return chain;
	},
	insert: () => ({
		values: async (v: Row) => {
			inserted.push(v);
		}
	}),
	update: () => ({
		set: (s: Row) => ({
			where: async (w: unknown) => {
				updated.push({ set: s, where: w });
			}
		})
	}),
	delete: () => ({
		where: async (w: unknown) => {
			deleted.push(w);
		}
	})
};
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$env/dynamic/private', () => ({ env: { MINIO_BUCKET_NAME: 'test-bucket' } }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' })
}));

const putCalls: Array<{ bucket: string; key: string; size: number }> = [];
const removeCalls: string[] = [];
let objectStore = new Map<string, Buffer>();
mock.module('minio', () => ({
	Client: class {
		async putObject(bucket: string, key: string, buf: Buffer, size: number) {
			putCalls.push({ bucket, key, size });
			objectStore.set(key, buf);
		}
		async removeObject(_bucket: string, key: string) {
			removeCalls.push(key);
			objectStore.delete(key);
		}
		async getObject(_bucket: string, key: string) {
			const buf = objectStore.get(key);
			if (!buf) {
				const e = new Error('NoSuchKey') as Error & { code: string };
				e.code = 'NoSuchKey';
				throw e;
			}
			return (async function* () {
				yield buf;
			})();
		}
	}
}));

const {
	addLibraryPlugin,
	addLibraryUpload,
	fetchLibraryPluginZip,
	libraryObjectKey,
	deleteLibraryPlugin
} = await import('../plugin-library');
const { PluginZipError } = await import('../plugin-zip');

const HEADER = (v: string) =>
	`<?php\n/*\nPlugin Name: Astra Pro\nVersion: ${v}\nAuthor: Brainstorm Force\nText Domain: astra-addon\n*/`;

async function zipWith(version: string): Promise<Buffer> {
	const z = new JSZip();
	z.file('astra-addon/astra-addon.php', HEADER(version));
	return z.generateAsync({ type: 'nodebuffer' });
}

function reset() {
	selectRows = [];
	selectWheres.length = 0;
	inserted.length = 0;
	updated.length = 0;
	deleted.length = 0;
	putCalls.length = 0;
	removeCalls.length = 0;
	objectStore = new Map();
}

const OLD_KEY = 'wordpress-plugin-library/tn/astra-addon/4.8.0-aaaaaaaaaaaa.zip';

describe('libraryObjectKey', () => {
	test('versioned, tenant-scoped key with a sha prefix', () => {
		expect(libraryObjectKey('tn', 'astra-addon', '4.8.1', 'abcdef0123456789')).toBe(
			'wordpress-plugin-library/tn/astra-addon/4.8.1-abcdef012345.zip'
		);
	});
	test('sanitizes odd characters in the version', () => {
		expect(libraryObjectKey('tn', 's', '1.0 beta/x', 'abcdef0123456789')).toBe(
			'wordpress-plugin-library/tn/s/1.0_beta_x-abcdef012345.zip'
		);
	});
});

describe('addLibraryPlugin', () => {
	beforeEach(reset);

	test('new slug → uploads to a versioned key and inserts the row', async () => {
		const buffer = await zipWith('4.8.1');
		const res = await addLibraryPlugin({
			tenantId: 'tn',
			userId: 'u1',
			filename: 'astra-addon-4.8.1.zip',
			buffer
		});
		expect(res.outcome).toBe('added');
		expect(putCalls).toHaveLength(1);
		expect(putCalls[0].bucket).toBe('test-bucket');
		expect(putCalls[0].key).toMatch(
			/^wordpress-plugin-library\/tn\/astra-addon\/4\.8\.1-[0-9a-f]{12}\.zip$/
		);
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toMatchObject({
			tenantId: 'tn',
			slug: 'astra-addon',
			version: '4.8.1',
			pluginFile: 'astra-addon/astra-addon.php',
			name: 'Astra Pro',
			textDomain: 'astra-addon',
			uploadedBy: 'u1',
			filename: 'astra-addon-4.8.1.zip',
			objectKey: putCalls[0].key,
			sizeBytes: buffer.length,
			sha256: createHash('sha256').update(buffer).digest('hex')
		});
		expect(updated).toHaveLength(0);
	});

	test('existing-row lookup is scoped by tenant AND slug', async () => {
		await addLibraryPlugin({ tenantId: 'tn', userId: 'u1', filename: 'x.zip', buffer: await zipWith('1.0') });
		const lookup = selectWheres[0] as { kind: string; conds?: Array<{ col: unknown; val: unknown }> };
		expect(lookup.kind).toBe('and');
		const cols = (lookup.conds ?? []).map((c) => c.col);
		expect(cols).toContain(wordpressPluginLibrary.tenantId);
		expect(cols).toContain(wordpressPluginLibrary.slug);
	});

	test('newer version of an existing slug → updates the row and removes the old object', async () => {
		selectRows = [{ id: 'row1', tenantId: 'tn', slug: 'astra-addon', version: '4.8.0', objectKey: OLD_KEY }];
		const res = await addLibraryPlugin({
			tenantId: 'tn',
			userId: 'u1',
			filename: 'x.zip',
			buffer: await zipWith('4.8.1')
		});
		expect(res.outcome).toBe('replaced');
		if (res.outcome === 'replaced') {
			expect(res.relation).toBe('newer');
			expect(res.previousVersion).toBe('4.8.0');
		}
		expect(inserted).toHaveLength(0);
		expect(updated).toHaveLength(1);
		expect(updated[0].set).toMatchObject({ version: '4.8.1', objectKey: putCalls[0].key });
		expect(removeCalls).toEqual([OLD_KEY]);
	});

	test('older version without force → rejected, nothing written', async () => {
		selectRows = [{ id: 'row1', tenantId: 'tn', slug: 'astra-addon', version: '4.9.0', objectKey: OLD_KEY }];
		const res = await addLibraryPlugin({
			tenantId: 'tn',
			userId: 'u1',
			filename: 'x.zip',
			buffer: await zipWith('4.8.1')
		});
		expect(res.outcome).toBe('rejected_older');
		if (res.outcome === 'rejected_older') {
			expect(res.existingVersion).toBe('4.9.0');
			expect(res.info.version).toBe('4.8.1');
		}
		expect(putCalls).toHaveLength(0);
		expect(inserted).toHaveLength(0);
		expect(updated).toHaveLength(0);
		expect(removeCalls).toHaveLength(0);
	});

	test('older version with force → replaced', async () => {
		selectRows = [{ id: 'row1', tenantId: 'tn', slug: 'astra-addon', version: '4.9.0', objectKey: OLD_KEY }];
		const res = await addLibraryPlugin({
			tenantId: 'tn',
			userId: 'u1',
			filename: 'x.zip',
			buffer: await zipWith('4.8.1'),
			force: true
		});
		expect(res.outcome).toBe('replaced');
		if (res.outcome === 'replaced') expect(res.relation).toBe('older');
		expect(updated).toHaveLength(1);
	});
});

describe('fetchLibraryPluginZip', () => {
	beforeEach(reset);

	test('returns the bytes when the checksum matches', async () => {
		const buf = Buffer.from('zip-bytes');
		objectStore.set('k1', buf);
		const out = await fetchLibraryPluginZip({
			objectKey: 'k1',
			sha256: createHash('sha256').update(buf).digest('hex'),
			slug: 's',
			version: '1'
		});
		expect(out.equals(buf)).toBe(true);
	});

	test('throws on checksum mismatch', async () => {
		objectStore.set('k1', Buffer.from('zip-bytes'));
		await expect(
			fetchLibraryPluginZip({ objectKey: 'k1', sha256: 'deadbeef', slug: 's', version: '1' })
		).rejects.toThrow(/checksum/i);
	});
});

describe('deleteLibraryPlugin', () => {
	beforeEach(reset);

	test('deletes the row scoped by tenant and removes the object', async () => {
		selectRows = [{ id: 'row1', tenantId: 'tn', slug: 'astra-addon', version: '4.8.0', objectKey: OLD_KEY }];
		const row = await deleteLibraryPlugin('tn', 'row1');
		expect(row?.id).toBe('row1');
		expect(deleted).toHaveLength(1);
		expect(removeCalls).toEqual([OLD_KEY]);
	});

	test('unknown id → null and nothing removed', async () => {
		const row = await deleteLibraryPlugin('tn', 'nope');
		expect(row).toBeNull();
		expect(deleted).toHaveLength(0);
		expect(removeCalls).toHaveLength(0);
	});
});

async function zipNamed(slug: string, name: string, version: string): Promise<Buffer> {
	const z = new JSZip();
	z.file(`${slug}/${slug}.php`, `<?php\n/*\nPlugin Name: ${name}\nVersion: ${version}\nText Domain: ${slug}\n*/`);
	return z.generateAsync({ type: 'nodebuffer' });
}

describe('addLibraryUpload (unzip-first packages)', () => {
	beforeEach(reset);

	test('a plain plugin zip → kind plugin', async () => {
		const r = await addLibraryUpload({ tenantId: 'tn', userId: 'u1', filename: 'x.zip', buffer: await zipWith('1.0') });
		expect(r.kind).toBe('plugin');
		if (r.kind === 'plugin') expect(r.result.outcome).toBe('added');
	});

	test('package with two inner plugin zips → both added, entries sorted by inner filename', async () => {
		const outer = new JSZip();
		outer.file('elementor-pro-4.3.0.zip', await zipNamed('elementor-pro', 'Elementor Pro', '4.3.0'));
		outer.file('elementor-4.3.0.zip', await zipNamed('elementor', 'Elementor', '4.3.0'));
		const r = await addLibraryUpload({
			tenantId: 'tn',
			userId: 'u1',
			filename: 'elementor-pro-unzip-first-4.3.0.zip',
			buffer: await outer.generateAsync({ type: 'nodebuffer' })
		});
		expect(r.kind).toBe('package');
		if (r.kind === 'package') {
			expect(r.entries.map((e) => e.filename)).toEqual(['elementor-4.3.0.zip', 'elementor-pro-4.3.0.zip']);
			expect(r.entries.map((e) => e.outcome)).toEqual(['added', 'added']);
		}
		expect(inserted.map((i) => i.slug)).toEqual(['elementor', 'elementor-pro']);
		expect(putCalls).toHaveLength(2);
	});

	test('package with a broken inner zip → that entry reports the error, the valid one is added', async () => {
		const outer = new JSZip();
		outer.file('wordfence.zip', await zipNamed('wordfence', 'Wordfence Security', '9.0.1'));
		outer.file('broken.zip', Buffer.from('not really a zip'));
		const r = await addLibraryUpload({
			tenantId: 'tn',
			userId: 'u1',
			filename: 'wordfence-unzip-first-9.0.1.zip',
			buffer: await outer.generateAsync({ type: 'nodebuffer' })
		});
		expect(r.kind).toBe('package');
		if (r.kind === 'package') {
			const broken = r.entries.find((e) => e.filename === 'broken.zip');
			const ok = r.entries.find((e) => e.filename === 'wordfence.zip');
			expect(broken?.outcome).toBe('error');
			if (broken?.outcome === 'error') expect(broken.code).toBe('invalid_zip');
			expect(ok?.outcome).toBe('added');
		}
		expect(inserted).toHaveLength(1);
	});

	test('zip with neither a plugin nor inner zips → PluginZipError no_plugin_file', async () => {
		const z = new JSZip();
		z.file('docs/readme.txt', 'nothing here');
		let err: unknown;
		try {
			await addLibraryUpload({ tenantId: 'tn', userId: 'u1', filename: 'docs.zip', buffer: await z.generateAsync({ type: 'nodebuffer' }) });
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(PluginZipError);
		expect((err as { code: string }).code).toBe('no_plugin_file');
	});
});

describe('review fixes (library)', () => {
	beforeEach(reset);

	test('a wrapper-shaped zip is stored re-packed at the slug root', async () => {
		const z = new JSZip();
		z.file('download/astra-addon/astra-addon.php', HEADER('4.8.1'));
		const wrapped = await z.generateAsync({ type: 'nodebuffer' });
		const res = await addLibraryPlugin({ tenantId: 'tn', userId: 'u1', filename: 'astra.zip', buffer: wrapped });
		expect(res.outcome).toBe('added');
		const stored = objectStore.get(putCalls[0].key)!;
		const names = Object.keys((await JSZip.loadAsync(stored)).files).filter((n) => !n.endsWith('/'));
		expect(names).toEqual(['astra-addon/astra-addon.php']);
		expect(inserted[0]).toMatchObject({ sizeBytes: stored.length, sha256: createHash('sha256').update(stored).digest('hex') });
	});

	test('a zip above the size cap is refused at module level (not only in the route)', async () => {
		const z = new JSZip();
		z.file('big/big.php', HEADER('1.0'));
		z.file('big/blob.bin', Buffer.alloc(5000, 7));
		const buf = await z.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
		let err: unknown;
		try {
			await addLibraryPlugin({ tenantId: 'tn', userId: 'u1', filename: 'big.zip', buffer: buf, maxBytes: 4000 });
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(PluginZipError);
		expect((err as { code: string }).code).toBe('too_large');
		expect(putCalls).toHaveLength(0);
	});

	test('package: an oversized inner zip becomes an error entry, the rest are stored', async () => {
		const outer = new JSZip();
		outer.file('ok.zip', await zipNamed('okplugin', 'OK Plugin', '1.0'));
		outer.file('huge.zip', Buffer.alloc(6000, 1));
		const r = await addLibraryUpload({
			tenantId: 'tn',
			userId: 'u1',
			filename: 'pack.zip',
			buffer: await outer.generateAsync({ type: 'nodebuffer' }),
			maxBytes: 5000
		});
		expect(r.kind).toBe('package');
		if (r.kind === 'package') {
			const huge = r.entries.find((e) => e.filename === 'huge.zip');
			expect(huge?.outcome).toBe('error');
			if (huge?.outcome === 'error') expect(huge.code).toBe('too_large');
			expect(r.entries.find((e) => e.filename === 'ok.zip')?.outcome).toBe('added');
		}
		expect(putCalls).toHaveLength(1);
	});
});
