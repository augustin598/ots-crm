import { describe, test, expect, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$lib/server/logger', () => ({
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' })
}));
mock.module('@sveltejs/kit', () => ({
	error: (status: number, message: string) => {
		const e = new Error(message) as Error & { status?: number };
		e.status = status;
		throw e;
	},
	json: (data: unknown) =>
		new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
}));

const files: Record<string, Buffer> = {};
mock.module('$lib/server/storage', () => ({
	getFileBuffer: async (key: string) => {
		if (files[key]) return files[key];
		throw new Error('not found');
	},
	uploadContentImage: async (tid: string, buf: Buffer, ext: string) => ({
		key: `content-media/${tid}/uuid.${ext}`,
		size: buf.length
	})
}));

const { resolveFeaturedImage, handleContentImageUpload } = await import('../content-media');

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];
function makeFile(type: string, bytes: number[]) {
	return new File([new Uint8Array(bytes)], 'x', { type });
}
function makeEvent(file: File | null, locals: Record<string, unknown>) {
	const fd = new FormData();
	if (file) fd.append('file', file);
	return { locals, request: { formData: async () => fd } } as never;
}
const staff = { tenant: { id: 'tn' }, user: { id: 'u' }, isClientUser: false, tenantUser: { id: 'tu' }, client: null };

describe('resolveFeaturedImage', () => {
	test('own /content-media/ URL -> reads MinIO, no fetch', async () => {
		files['content-media/tn/a.png'] = Buffer.from(PNG);
		const r = await resolveFeaturedImage('/content-media/tn/a.png');
		expect(r?.mimeType).toBe('image/png');
		expect(r?.dataBase64).toBe(Buffer.from(PNG).toString('base64'));
		expect(r?.filename).toMatch(/\.png$/);
	});
	test('external image URL -> fetch bytes', async () => {
		const orig = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(new Uint8Array([1, 2, 3]), {
				status: 200,
				headers: { 'content-type': 'image/jpeg' }
			})) as typeof fetch;
		try {
			const r = await resolveFeaturedImage('https://cdn.x/y.jpg');
			expect(r?.mimeType).toBe('image/jpeg');
			expect(r?.filename).toMatch(/\.jpg$/);
		} finally {
			globalThis.fetch = orig;
		}
	});
	test('external non-image -> null', async () => {
		const orig = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response('x', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
		try {
			expect(await resolveFeaturedImage('https://x/p')).toBeNull();
		} finally {
			globalThis.fetch = orig;
		}
	});
	test('empty / non-url -> null', async () => {
		expect(await resolveFeaturedImage('')).toBeNull();
		expect(await resolveFeaturedImage('ftp://x')).toBeNull();
	});
});

describe('handleContentImageUpload', () => {
	test('no auth (not client, no tenantUser) -> 403', async () => {
		await expect(
			handleContentImageUpload(
				makeEvent(makeFile('image/png', PNG), {
					tenant: { id: 'tn' },
					user: { id: 'u' },
					isClientUser: false,
					tenantUser: null
				})
			)
		).rejects.toThrow(/interzis/i);
	});
	test('no file -> 400', async () => {
		await expect(handleContentImageUpload(makeEvent(null, staff))).rejects.toThrow(/obligatoriu/i);
	});
	test('bad type -> 400', async () => {
		await expect(
			handleContentImageUpload(makeEvent(makeFile('image/svg+xml', PNG), staff))
		).rejects.toThrow(/neacceptat/i);
	});
	test('wrong magic bytes -> 400', async () => {
		await expect(
			handleContentImageUpload(makeEvent(makeFile('image/png', [1, 2, 3, 4, 5, 6, 7, 8]), staff))
		).rejects.toThrow(/nu corespunde/i);
	});
	test('valid png -> { url }', async () => {
		const res = await handleContentImageUpload(makeEvent(makeFile('image/png', PNG), staff));
		expect(await (res as Response).json()).toEqual({ url: '/content-media/tn/uuid.png' });
	});
});
