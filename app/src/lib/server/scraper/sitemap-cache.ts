/**
 * DB-backed cache for sitemap XML content.
 *
 * - Stores gzip-compressed XML as base64 text (libSQL handles text well, blobs less so).
 * - 6h default TTL, invalidated when the parent sitemap-index reports a newer lastmod.
 * - Shared across tenants — sitemaps are public.
 */

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, lt } from 'drizzle-orm';
import { fetchSitemapContent } from './sitemap-parser';

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/** Gzip-compress a string and encode as base64. */
async function compressToBase64(xml: string): Promise<{ content: string; byteSize: number }> {
	const bytes = new TextEncoder().encode(xml);
	const stream = new Response(bytes).body?.pipeThrough(new CompressionStream('gzip'));
	if (!stream) {
		// Fallback: store uncompressed base64
		const b64 = btoa(String.fromCharCode(...bytes));
		return { content: 'raw:' + b64, byteSize: bytes.byteLength };
	}
	const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
	// Chunk to avoid "too many arguments" on very large buffers.
	let binary = '';
	const chunkSize = 8192;
	for (let i = 0; i < compressed.length; i += chunkSize) {
		binary += String.fromCharCode(...compressed.slice(i, i + chunkSize));
	}
	return { content: 'gz:' + btoa(binary), byteSize: compressed.byteLength };
}

/** Decompress from the format returned by compressToBase64. */
async function decompressFromBase64(content: string): Promise<string> {
	if (content.startsWith('raw:')) {
		const b64 = content.slice(4);
		const bin = atob(b64);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		return new TextDecoder().decode(bytes);
	}
	if (content.startsWith('gz:')) {
		const b64 = content.slice(3);
		const bin = atob(b64);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		const stream = new Response(bytes).body?.pipeThrough(new DecompressionStream('gzip'));
		if (!stream) return '';
		return await new Response(stream).text();
	}
	return content;
}

/** Get cached sitemap content if still valid. Returns null otherwise. */
export async function getCachedSitemap(
	url: string,
	expectedLastmod?: string | null
): Promise<string | null> {
	try {
		const [row] = await db
			.select()
			.from(table.sitemapCache)
			.where(eq(table.sitemapCache.url, url))
			.limit(1);
		if (!row) return null;
		if (row.expiresAt.getTime() < Date.now()) return null;
		// Invalidate if lastmod differs (sitemap was updated upstream)
		if (expectedLastmod && row.contentLastmod && expectedLastmod !== row.contentLastmod) {
			return null;
		}
		return await decompressFromBase64(row.content);
	} catch {
		return null;
	}
}

/** Store a sitemap in cache. */
export async function setCachedSitemap(
	url: string,
	xml: string,
	lastmod: string | null,
	ttlMs: number = DEFAULT_TTL_MS
): Promise<void> {
	try {
		const { content, byteSize } = await compressToBase64(xml);
		const now = new Date();
		const expiresAt = new Date(now.getTime() + ttlMs);
		await db
			.insert(table.sitemapCache)
			.values({
				url,
				content,
				contentLastmod: lastmod,
				byteSize,
				fetchedAt: now,
				expiresAt
			})
			.onConflictDoUpdate({
				target: table.sitemapCache.url,
				set: {
					content,
					contentLastmod: lastmod,
					byteSize,
					fetchedAt: now,
					expiresAt
				}
			});
	} catch (err) {
		console.warn(`[sitemap-cache] set failed for ${url}:`, err instanceof Error ? err.message : err);
	}
}

/** Fetch with cache — returns XML content, using cache when valid. */
export async function fetchSitemapCached(
	url: string,
	opts?: { signal?: AbortSignal; lastmod?: string | null; timeoutMs?: number }
): Promise<string> {
	const cached = await getCachedSitemap(url, opts?.lastmod ?? null);
	if (cached) return cached;

	const fresh = await fetchSitemapContent(url, {
		signal: opts?.signal,
		timeoutMs: opts?.timeoutMs
	});
	if (fresh) {
		// Fire-and-forget write
		void setCachedSitemap(url, fresh, opts?.lastmod ?? null);
	}
	return fresh;
}

/** Delete cache entries older than their expiresAt. Called periodically. */
export async function cleanupExpiredSitemapCache(): Promise<number> {
	try {
		const res = await db
			.delete(table.sitemapCache)
			.where(lt(table.sitemapCache.expiresAt, new Date()));
		return (res as { rowsAffected?: number })?.rowsAffected ?? 0;
	} catch {
		return 0;
	}
}
