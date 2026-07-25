# Content editor — featured image upload + publish fix + editor surface

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Add featured-image upload to the `/ots/content` article editor, make the chosen featured image actually reach WordPress on publish, and give the editing surface a white "sheet" look.

**Architecture:** Featured images are public by design (they end up on public WP posts), so uploaded images go to a public-read MinIO prefix `content-media/<tenantId>/<uuid>.<ext>` served by a top-level unauthenticated GET route (uuid key = unguessable). Writes go through auth-gated dual wrappers (staff + client), mirroring the existing marketing upload split. On publish, `article.featuredImageUrl` is sideloaded into the WP media library (read straight from MinIO for our own URLs, `fetch` for external og:image URLs) and set as `featured_media`, falling back to the first inline body image only when absent/failed.

**Tech Stack:** SvelteKit 5 (runes), Bun, TypeScript, Drizzle, MinIO (`minio`), TipTap, `bun:test`.

---

## Audit findings (context)

- **BUG (high):** `publishArticleToWordpress` sets `featuredMediaId = attachmentIds[0]` (first inline body image) and **ignores `article.featuredImageUrl`** — the value shown/edited in the "IMAGINE FEATURED" card. The featured field is decorative today. → Task 4.
- **Missing feature:** the featured card has only a URL text input; no upload. → Tasks 1–3, 5.
- **UX:** the RichEditor surface is transparent, sitting on the gray canvas (`--cl-bg #f4f6fa`) → reads as a flat bright area. User wants a white document "sheet". → Task 6.
- Remotes (`content-articles.remote.ts`) are correctly guarded (`contentAuth` + `assert{Website,Article}ClientAccess`). No F8 issue found.

## File structure

- Create `src/lib/server/content/content-media.ts` — validation + `handleContentImageUpload` + `resolveFeaturedImage`.
- Create `src/routes/[tenant]/content/upload-image/+server.ts` — staff POST wrapper.
- Create `src/routes/client/[tenant]/(app)/content/upload-image/+server.ts` — client POST wrapper.
- Create `src/routes/content-media/[...path]/+server.ts` — public GET streaming.
- Create `src/lib/server/content/__tests__/content-media.test.ts`.
- Modify `src/lib/server/storage.ts` — add `uploadContentImage`.
- Modify `src/lib/server/content/publisher.ts` — sideload featured image.
- Modify `src/lib/server/content/__tests__/publisher.test.ts` — sideload tests.
- Modify `src/lib/components/content/article-editor-view.svelte` — upload UI.
- Modify `src/lib/components/content/content.css` — white sheet + upload styles.

---

## Task 1: `uploadContentImage` in storage.ts

**Files:** Modify `src/lib/server/storage.ts` (after `uploadBuffer`).

- [ ] **Step 1:** Add:

```ts
/**
 * Upload a content-article image to a PUBLIC-read prefix (`content-media/`).
 * These images end up on public WordPress posts, so they are served without
 * auth from /content-media/<key>; the uuid key makes them unguessable.
 */
export async function uploadContentImage(
	tenantId: string,
	buffer: Buffer,
	ext: string,
	mimeType: string
): Promise<{ key: string; size: number }> {
	try {
		await ensureBucket();
		const client = getMinioClient();
		const key = `content-media/${tenantId}/${crypto.randomUUID()}.${ext}`;
		await client.putObject(getBucketName(), key, buffer, buffer.length, { 'Content-Type': mimeType });
		return { key, size: buffer.length };
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('storage', `Failed to upload content image: ${message}`, { tenantId, stackTrace: stack });
		throw error;
	}
}
```

- [ ] **Step 2:** Commit `feat(content): storage.uploadContentImage (public content-media prefix)`.

---

## Task 2: content-media.ts (validation + handler + resolver) — TDD

**Files:** Create `src/lib/server/content/content-media.ts`; Test `src/lib/server/content/__tests__/content-media.test.ts`.

- [ ] **Step 1: Write failing tests** `content-media.test.ts`:

```ts
import { describe, test, expect, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$lib/server/logger', () => ({ logError: () => {}, serializeError: (e: unknown) => ({ message: String(e), stack: '' }) }));
mock.module('@sveltejs/kit', () => ({
	error: (status: number, message: string) => { const e = new Error(message) as Error & { status?: number }; e.status = status; throw e; },
	json: (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
}));
const files: Record<string, Buffer> = {};
mock.module('$lib/server/storage', () => ({
	getFileBuffer: async (key: string) => { if (files[key]) return files[key]; throw new Error('not found'); },
	uploadContentImage: async (tid: string, buf: Buffer, ext: string) => ({ key: `content-media/${tid}/uuid.${ext}`, size: buf.length })
}));

const { resolveFeaturedImage, handleContentImageUpload } = await import('../content-media');

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];
function makeFile(type: string, bytes: number[]) { return new File([new Uint8Array(bytes)], 'x', { type }); }
function makeEvent(file: File | null, locals: Record<string, unknown>) {
	const fd = new FormData(); if (file) fd.append('file', file);
	return { locals, request: { formData: async () => fd } } as never;
}
const staff = { tenant: { id: 'tn' }, user: { id: 'u' }, isClientUser: false, tenantUser: { id: 'tu' }, client: null };

describe('resolveFeaturedImage', () => {
	test('own /content-media/ URL → reads MinIO, no fetch', async () => {
		files['content-media/tn/a.png'] = Buffer.from(PNG);
		const r = await resolveFeaturedImage('/content-media/tn/a.png');
		expect(r?.mimeType).toBe('image/png');
		expect(r?.dataBase64).toBe(Buffer.from(PNG).toString('base64'));
		expect(r?.filename).toMatch(/\.png$/);
	});
	test('external image URL → fetch bytes', async () => {
		const orig = globalThis.fetch;
		globalThis.fetch = (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } })) as typeof fetch;
		try { const r = await resolveFeaturedImage('https://cdn.x/y.jpg'); expect(r?.mimeType).toBe('image/jpeg'); expect(r?.filename).toMatch(/\.jpg$/); }
		finally { globalThis.fetch = orig; }
	});
	test('external non-image → null', async () => {
		const orig = globalThis.fetch;
		globalThis.fetch = (async () => new Response('x', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
		try { expect(await resolveFeaturedImage('https://x/p')).toBeNull(); } finally { globalThis.fetch = orig; }
	});
	test('empty / non-url → null', async () => { expect(await resolveFeaturedImage('')).toBeNull(); expect(await resolveFeaturedImage('ftp://x')).toBeNull(); });
});

describe('handleContentImageUpload', () => {
	test('no auth (not client, no tenantUser) → 403', async () => {
		await expect(handleContentImageUpload(makeEvent(makeFile('image/png', PNG), { tenant: { id: 'tn' }, user: { id: 'u' }, isClientUser: false, tenantUser: null }))).rejects.toThrow(/interzis/i);
	});
	test('no file → 400', async () => { await expect(handleContentImageUpload(makeEvent(null, staff))).rejects.toThrow(/obligatoriu/i); });
	test('bad type → 400', async () => { await expect(handleContentImageUpload(makeEvent(makeFile('image/svg+xml', PNG), staff))).rejects.toThrow(/neacceptat/i); });
	test('wrong magic bytes → 400', async () => { await expect(handleContentImageUpload(makeEvent(makeFile('image/png', [1, 2, 3, 4, 5, 6, 7, 8]), staff))).rejects.toThrow(/nu corespunde/i); });
	test('valid png → { url }', async () => {
		const res = await handleContentImageUpload(makeEvent(makeFile('image/png', PNG), staff));
		expect(await (res as Response).json()).toEqual({ url: '/content-media/tn/uuid.png' });
	});
});
```

- [ ] **Step 2: Run, verify fail** `cd app && bun test src/lib/server/content/__tests__/content-media.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `content-media.ts`:

```ts
import type { RequestEvent } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import * as storage from '$lib/server/storage';

const TYPE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const EXT_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const MAX_UPLOAD = 8 * 1024 * 1024;
const MAX_SIDELOAD = 12 * 1024 * 1024;

async function validImageMagic(file: File): Promise<boolean> {
	const h = new Uint8Array(await file.slice(0, 12).arrayBuffer());
	switch (file.type) {
		case 'image/jpeg': return h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
		case 'image/png': return h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
		case 'image/gif': return h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46;
		case 'image/webp': return h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50;
		default: return false;
	}
}

/** Upload a featured/body image for a content article. Auth mirrors marketing upload. */
export async function handleContentImageUpload(event: RequestEvent): Promise<Response> {
	const tenantId = event.locals.tenant?.id;
	const userId = event.locals.user?.id;
	if (!userId || !tenantId) throw error(401, 'Unauthorized');
	if (!event.locals.isClientUser && !event.locals.tenantUser) throw error(403, 'Acces interzis pentru acest tenant');
	if (event.locals.isClientUser && !event.locals.client) throw error(403, 'Sesiune client invalidă');

	const form = await event.request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) throw error(400, 'Fișierul este obligatoriu');
	const ext = TYPE_EXT[file.type];
	if (!ext) throw error(400, 'Tip de fișier neacceptat. Acceptăm: JPG, PNG, WebP, GIF');
	if (file.size === 0) throw error(400, 'Fișierul nu poate fi gol');
	if (file.size > MAX_UPLOAD) throw error(400, `Imaginea depășește ${MAX_UPLOAD / (1024 * 1024)}MB`);
	if (!(await validImageMagic(file))) throw error(400, 'Fișierul nu corespunde tipului declarat');

	const buffer = Buffer.from(await file.arrayBuffer());
	const { key } = await storage.uploadContentImage(tenantId, buffer, ext, file.type);
	return json({ url: `/${key}` }); // /content-media/<tenantId>/<uuid>.<ext>
}

/**
 * Resolve a featured-image URL to bytes for WP sideload. Own content-media URLs
 * are read straight from MinIO (no HTTP, no expiry); external URLs are fetched.
 * Returns null when it can't be resolved as a supported image.
 */
export async function resolveFeaturedImage(
	url: string
): Promise<{ dataBase64: string; mimeType: string; filename: string } | null> {
	if (!url) return null;
	if (url.startsWith('/content-media/')) {
		const buf = await storage.getFileBuffer(url.slice(1));
		if (buf.length === 0 || buf.length > MAX_SIDELOAD) return null;
		const ext = (url.split('.').pop() || 'jpg').toLowerCase();
		return { dataBase64: buf.toString('base64'), mimeType: EXT_MIME[ext] || 'image/jpeg', filename: `featured-${Date.now()}.${ext}` };
	}
	if (/^https?:\/\//i.test(url)) {
		const res = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'follow' });
		if (!res.ok) return null;
		const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
		const ext = Object.entries(EXT_MIME).find(([, m]) => m === ct)?.[0];
		if (!ext) return null;
		const ab = await res.arrayBuffer();
		if (ab.byteLength === 0 || ab.byteLength > MAX_SIDELOAD) return null;
		return { dataBase64: Buffer.from(ab).toString('base64'), mimeType: ct, filename: `featured-${Date.now()}.${ext}` };
	}
	return null;
}
```

- [ ] **Step 4:** Run tests → PASS. **Step 5:** Commit `feat(content): content-media handler + featured-image resolver (+tests)`.

---

## Task 3: upload + media routes

**Files:** Create the 3 `+server.ts` routes.

- [ ] **Step 1:** `src/routes/[tenant]/content/upload-image/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { handleContentImageUpload } from '$lib/server/content/content-media';

export const POST: RequestHandler = (event) => handleContentImageUpload(event);
```

- [ ] **Step 2:** `src/routes/client/[tenant]/(app)/content/upload-image/+server.ts` — identical body.

- [ ] **Step 3:** `src/routes/content-media/[...path]/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import * as storage from '$lib/server/storage';

const EXT_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const KEY_RE = /^[a-z0-9_-]+\/[a-zA-Z0-9._-]+\.(jpg|jpeg|png|webp|gif)$/;

export const GET: RequestHandler = async ({ params }) => {
	const path = params.path;
	if (!path || path.includes('..') || !KEY_RE.test(path)) throw error(404, 'Not found');
	const ext = path.split('.').pop()!.toLowerCase();
	let buf: Buffer;
	try { buf = await storage.getFileBuffer(`content-media/${path}`); }
	catch { throw error(404, 'Not found'); }
	return new Response(new Uint8Array(buf), {
		headers: { 'Content-Type': EXT_MIME[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Length': String(buf.length) }
	});
};
```

- [ ] **Step 4:** Verify `src/hooks.server.ts` has no global auth redirect that would 302 `/content-media/*`. If a catch-all guard exists, allowlist paths starting with `/content-media/`.

- [ ] **Step 5:** Commit `feat(content): upload-image (staff+client) + public content-media route`.

---

## Task 4: publisher sideloads featured image — TDD

**Files:** Modify `src/lib/server/content/publisher.ts`; Test `__tests__/publisher.test.ts`.

- [ ] **Step 1: Extend the test mock** — in `publisher.test.ts` add near the other mocks:

```ts
mock.module('$lib/server/content/content-media', () => ({ resolveFeaturedImage: async (url: string) => (url ? { dataBase64: 'AAA', mimeType: 'image/png', filename: 'f.png' } : null) }));
```

Add `uploadMedia` to the WpClient mock class:

```ts
		async uploadMedia() { return { id: 999, url: 'https://x.ro/wp/999.png' }; }
```

- [ ] **Step 2: Add failing tests:**

```ts
	test('featuredImageUrl setat → sideload pe WP, featured_media = id uploadat', async () => {
		created.length = 0; updates.length = 0;
		const article = { id: 'a1', tenantId: 'tn', websiteId: 'w1', generatedHtml: '<p>x</p>', generatedTitle: 'T', slug: 's', targetWpSiteId: null, featuredImageUrl: '/content-media/tn/a.png' };
		const site = { id: 'wp1', tenantId: 'tn', siteUrl: 'https://x.ro', secretKey: 'enc' };
		const { publishArticleToWordpress } = await loadSUT([[article], [{ wpSiteId: 'wp1' }], [site]]);
		await publishArticleToWordpress('tn', 'a1', { status: 'publish' });
		expect(created[0].featuredMediaId).toBe(999);
	});
	test('fără featuredImageUrl → featured_media rămâne undefined (fallback inline gol)', async () => {
		created.length = 0;
		const article = { id: 'a1', tenantId: 'tn', websiteId: 'w1', generatedHtml: '<p>x</p>', targetWpSiteId: null };
		const site = { id: 'wp1', tenantId: 'tn', siteUrl: 'https://x.ro', secretKey: 'enc' };
		const { publishArticleToWordpress } = await loadSUT([[article], [{ wpSiteId: 'wp1' }], [site]]);
		await publishArticleToWordpress('tn', 'a1', { status: 'publish' });
		expect(created[0].featuredMediaId).toBeUndefined();
	});
```

- [ ] **Step 3: Run → FAIL** (`featuredMediaId` is currently `attachmentIds[0]` = undefined for the first test).

- [ ] **Step 4: Implement.** Add import at top of `publisher.ts`:

```ts
import { resolveFeaturedImage } from './content-media';
```

Replace the featured line in `createPost` (currently `featuredMediaId: attachmentIds.length > 0 ? attachmentIds[0] : undefined`) with a computed variable inserted just before `const created = await client.createPost(`:

```ts
			// Featured image: prefer the editor's choice (article.featuredImageUrl),
			// sideloaded into the WP media library. Fall back to the first inline body
			// image only when absent or when the sideload fails.
			let featuredMediaId: number | undefined = attachmentIds.length > 0 ? attachmentIds[0] : undefined;
			if (article.featuredImageUrl) {
				try {
					const resolved = await resolveFeaturedImage(article.featuredImageUrl);
					if (resolved) {
						const media = await client.uploadMedia(
							{ filename: resolved.filename, mimeType: resolved.mimeType, dataBase64: resolved.dataBase64 },
							{ siteId: site.id }
						);
						featuredMediaId = media.id;
					}
				} catch (mediaErr) {
					const { message } = serializeError(mediaErr);
					logWarning('content', `[publish] sideload imagine featured a eșuat (${article.featuredImageUrl}): ${message} — folosesc fallback`, { tenantId, metadata: { articleId, siteId: site.id } });
				}
			}
```

And set `featuredMediaId` (the variable) in the `createPost` payload.

- [ ] **Step 5:** Run publisher tests → PASS. **Step 6:** Commit `fix(content): publish uses chosen featured image (sideload to WP), not first body image`.

---

## Task 5: featured-image upload UI in the editor

**Files:** Modify `src/lib/components/content/article-editor-view.svelte`.

- [ ] **Step 1:** Add imports: `UploadIcon` (`@lucide/svelte/icons/upload`), `ImagePlusIcon` (`@lucide/svelte/icons/image-plus`), `XIcon` (`@lucide/svelte/icons/x`).

- [ ] **Step 2:** Add state + handlers (near other `$state`):

```ts
	let uploadingImage = $state(false);
	let imageDragOver = $state(false);
	const uploadImageUrl = $derived(`${basePath}/upload-image`);
	const featInputId = 'ct-featured-file';

	async function uploadFeaturedFile(file: File) {
		if (uploadingImage) return;
		if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { toast.error('Tip neacceptat (JPG, PNG, WebP, GIF)'); return; }
		if (file.size > 8 * 1024 * 1024) { toast.error('Imaginea depășește 8MB'); return; }
		uploadingImage = true;
		try {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch(uploadImageUrl, { method: 'POST', body: fd });
			if (!res.ok) { const e = await res.json().catch(() => ({ message: 'Upload eșuat' })); throw new Error(e.message || `HTTP ${res.status}`); }
			const { url } = await res.json();
			featuredImageUrl = url;
			toast.success('Imagine încărcată');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Upload eșuat');
		} finally {
			uploadingImage = false;
		}
	}
	function onFeaturedInput(e: Event) { const i = e.target as HTMLInputElement; if (i.files?.[0]) uploadFeaturedFile(i.files[0]); i.value = ''; }
	function onFeaturedDrop(e: DragEvent) { e.preventDefault(); imageDragOver = false; if (e.dataTransfer?.files?.[0]) uploadFeaturedFile(e.dataTransfer.files[0]); }
```

- [ ] **Step 3:** Replace the "Imagine featured" card body (the `{#if featuredImageUrl}…{/if}` + URL input) with:

```svelte
					<div class="ct-seo-card">
						<h4>Imagine featured</h4>
						{#if featuredImageUrl}
							<div class="ct-fav-wrap">
								<img class="ct-fav-preview" src={featuredImageUrl} alt="" />
								<button type="button" class="ct-fav-clear" title="Elimină imaginea" onclick={() => (featuredImageUrl = '')}>
									<XIcon size={14} />
								</button>
							</div>
						{:else}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="ct-fav-drop {imageDragOver ? 'over' : ''}"
								role="button"
								tabindex="0"
								onclick={() => document.getElementById(featInputId)?.click()}
								onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById(featInputId)?.click(); } }}
								ondragover={(e) => { e.preventDefault(); imageDragOver = true; }}
								ondragleave={() => (imageDragOver = false)}
								ondrop={onFeaturedDrop}
							>
								{#if uploadingImage}
									<Loader2Icon size={18} class="ct-spin" /><span>Se încarcă…</span>
								{:else}
									<ImagePlusIcon size={18} />
									<span>Trage o imagine sau <b>click pentru upload</b></span>
									<small>JPG, PNG, WebP, GIF — max 8MB</small>
								{/if}
							</div>
						{/if}
						<input id={featInputId} type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="ct-fav-file" onchange={onFeaturedInput} />
						<div class="ct-fav-orurl">
							<button type="button" class="cl-btn-secondary cl-btn-sm" onclick={() => document.getElementById(featInputId)?.click()} disabled={uploadingImage}>
								<UploadIcon size={13} /> Încarcă
							</button>
							<input class="ct-seo-input" style="flex:1" bind:value={featuredImageUrl} placeholder="sau lipește URL…" aria-label="URL imagine featured" />
						</div>
					</div>
```

- [ ] **Step 4:** In the component `<style>`, extend the spin-animation selector list to include `.ct-seo :global(.ct-spin)` so the dropzone/SEO spinners animate.

- [ ] **Step 5:** `svelte-autofixer` on the component; fix any issues. Commit `feat(content): upload imagine featured (drag+drop / click / URL)`.

---

## Task 6: white "sheet" editor surface + upload styles

**Files:** Modify `src/lib/components/content/content.css`.

- [ ] **Step 1:** Append:

```css
/* editorul = foaie albă pe canvas (surface theme-aware + umbră discretă) */
.ct-editor-main .rich-editor { background: var(--cl-surface); border-color: var(--cl-border); box-shadow: 0 1px 2px rgba(15,23,42,.05), 0 6px 16px rgba(15,23,42,.06); }
:global(.dark) .ct-editor-main .rich-editor { box-shadow: 0 1px 2px rgba(0,0,0,.35), 0 6px 16px rgba(0,0,0,.4); }

/* upload imagine featured */
.ct-fav-wrap { position: relative; }
.ct-fav-clear { position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; border-radius: 6px; border: 0; background: rgba(15,23,42,.6); color: #fff; display: grid; place-items: center; cursor: pointer; }
.ct-fav-clear:hover { background: rgba(15,23,42,.82); }
.ct-fav-drop { width: 100%; aspect-ratio: 16/9; border-radius: 8px; background: var(--cl-surface-2); border: 1px dashed var(--cl-border-strong); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: var(--cl-text-3); font-size: 12px; text-align: center; cursor: pointer; margin-bottom: 8px; padding: 8px; transition: all .12s; }
.ct-fav-drop:hover, .ct-fav-drop.over { border-color: var(--cl-accent); background: var(--cl-accent-50); color: var(--cl-text-2); }
.ct-fav-drop b { color: var(--cl-accent); font-weight: 600; }
.ct-fav-drop small { font-size: 10.5px; color: var(--cl-text-3); }
.ct-fav-file { display: none; }
.ct-fav-orurl { display: flex; gap: 6px; align-items: center; margin-top: 8px; }
```

- [ ] **Step 2:** Commit `style(content): white sheet editor surface + featured upload styles`.

---

## Task 7: verify

- [ ] `cd app && bun test src/lib/server/content/__tests__/` → all pass.
- [ ] `/build-check` → no new errors above baseline (16 err / 56 warn).
- [ ] Browser (testermcp) on `/ots/content/<websiteId>/<articleId>`: upload featured (drag + click), preview shows, Save persists; editor surface is a white sheet; toggle dark mode.
- [ ] Confirm `/content-media/<...>` serves the uploaded image (200 + image content-type) with no login.
