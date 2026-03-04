/* global ENV_PREFIX */
/* global BUILD_OPTIONS */
/* global ENV_PREFIX */
//@ts-expect-error MANIFEST is not typed
import { manifest, base, prerendered } from 'MANIFEST';
//@ts-expect-error SERVER is not typed
import { Server } from 'SERVER';
//@ts-expect-error ENV is not typed
import { env } from 'ENV';
import type { Server as SvelteKitServer } from '@sveltejs/kit';
import { existsSync } from 'node:fs';
import type { RequestHandler } from './sirv';
import sirv from './sirv';
import { getCachedResponse, setCachedResponse } from './redis';
import { trackPageForRevalidation } from './revalidation';
import { createGzip, createBrotliCompress } from 'node:zlib';

/**
 * Check if debug mode is enabled
 */
function isDebugMode(): boolean {
	return Bun.env.NODE_ENV === 'debug';
}

/**
 * Debug log - only logs if NODE_ENV=debug
 */
function debugLog(...args: unknown[]) {
	if (isDebugMode()) {
		console.log(...args);
	}
}

/**
 * Compress a response if the client accepts compression and the content type is compressible
 */
async function compressResponse(response: Response, request: Request): Promise<Response> {
	// Only compress if precompress is enabled
	if (!precompress) {
		return response;
	}

	// Only compress successful responses
	if (response.status !== 200) {
		return response;
	}

	// Check if response is already compressed
	const contentEncoding = response.headers.get('content-encoding');
	if (
		contentEncoding &&
		(contentEncoding === 'gzip' || contentEncoding === 'br' || contentEncoding === 'deflate')
	) {
		return response;
	}

	// Only compress HTML responses
	const contentType = response.headers.get('content-type');
	if (!contentType || !contentType.includes('text/html')) {
		return response;
	}

	// Check what encodings the client accepts
	const acceptEncoding = request.headers.get('accept-encoding') || '';
	const acceptsBrotli = /(br|brotli)/i.test(acceptEncoding);
	const acceptsGzip = acceptEncoding.includes('gzip');

	// If client doesn't accept any compression, return as-is
	if (!acceptsBrotli && !acceptsGzip) {
		return response;
	}

	// Prefer brotli over gzip if both are supported
	const encodingHeader = acceptsBrotli ? 'br' : 'gzip';

	try {
		// Check if response body is available
		if (!response.body) {
			// If body is null, return the original response
			return response;
		}

		// Read the response body
		const bodyBuffer = Buffer.from(await response.arrayBuffer());

		// Use node:zlib for compression (Bun supports this natively)
		const compress = acceptsBrotli ? createBrotliCompress() : createGzip();

		// Compress the body
		const compressedBuffer = await new Promise<Buffer>((resolve, reject) => {
			const chunks: Buffer[] = [];
			compress.on('data', (chunk: Buffer) => chunks.push(chunk));
			compress.on('end', () => resolve(Buffer.concat(chunks)));
			compress.on('error', reject);
			compress.end(bodyBuffer);
		});

		// Create new headers with compression info, also remove ISR headers
		const newHeaders = new Headers(response.headers);
		newHeaders.set('Content-Encoding', encodingHeader);
		newHeaders.set('Content-Length', compressedBuffer.length.toString());
		newHeaders.set('Vary', 'Accept-Encoding');
		newHeaders.delete('x-isr-expiration');
		newHeaders.delete('x-revalidate');

		return new Response(Buffer.from(compressedBuffer), {
			status: response.status,
			statusText: response.statusText,
			headers: newHeaders
		});
	} catch (error) {
		// If compression fails, return the original response
		if (isDebugMode()) {
			console.error('Compression failed:', error);
		}
		return response;
	}
}

const server = new Server(manifest) as SvelteKitServer & {
	websocket(): unknown;
};

//@ts-expect-error BUILD_OPTIONS is not typed
const { serveAssets, precompress = true, isr = true } = BUILD_OPTIONS;

const origin = env('ORIGIN', undefined);
const xff_depth = parseInt(env('XFF_DEPTH', '1'), 10);
const address_header = env('ADDRESS_HEADER', '').toLowerCase();
const protocol_header = env('PROTOCOL_HEADER', '').toLowerCase();
const host_header = env('HOST_HEADER', '').toLowerCase();
const port_header = env('PORT_HEADER', '').toLowerCase();

const asset_dir = `${import.meta.dir}/client${base}`;

await server.init({
	env: Bun.env as Record<string, string>,
	read: (file) => Bun.file(`${asset_dir}/${file}`).stream()
});

function serve(path: string, client: boolean = false) {
	if (existsSync(path)) {
		return sirv(path, {
			etag: true,
			gzip: precompress,
			brotli: precompress,
			setHeaders: (headers, pathname) => {
				// Determine cache control based on path and file type
				let cacheControl: string;

				if (client) {
					// Client assets (JS, CSS, images, fonts, etc.)
					if (pathname.startsWith(`/${manifest.appDir}/immutable/`)) {
						// Immutable assets with hashed filenames - cache forever
						cacheControl = 'public,max-age=31536000,immutable';
					} else {
						// Other client assets - cache for 1 year
						cacheControl = 'public,max-age=31536000';
					}
				} else {
					// Pre-rendered HTML pages - shorter cache, can be revalidated
					cacheControl = 'public,max-age=3600,must-revalidate';
				}

				headers.set('cache-control', cacheControl);
				return headers;
			}
		});
	}
}

// required because the static file server ignores trailing slashes
function serve_prerendered(): RequestHandler {
	const handler = serve(`${import.meta.dir}/prerendered`, false)!;

	return (req, next) => {
		const url = new URL(req.url);
		let { pathname } = url;
		const { search } = url;

		try {
			pathname = decodeURIComponent(pathname);
		} catch {
			// ignore invalid URI
		}

		if (prerendered.has(pathname)) {
			return handler(req, next);
		}

		// remove or add trailing slash as appropriate
		let location = pathname.at(-1) === '/' ? pathname.slice(0, -1) : pathname + '/';
		if (prerendered.has(location)) {
			if (search) location += search;
			return new Response(null, { status: 308, headers: { location } });
		} else {
			return next?.() || new Response(null, { status: 404 });
		}
	};
}

/**
 * ISR configuration map
 * Routes can export config with isr: { expiration: <seconds> } or revalidate: <seconds>
 * This map is populated at build time or can be set manually
 * Format: path pattern -> expiration in seconds
 */
const isrConfigMap: Map<string | RegExp, number> = new Map();

/**
 * Get ISR expiration for a pathname
 * Checks the ISR config map for matching routes
 */
function get_isr_config(pathname: string): number | null {
	// Check exact path match first
	if (isrConfigMap.has(pathname)) {
		return isrConfigMap.get(pathname)!;
	}

	// Check pattern matches
	for (const [pattern, expiration] of isrConfigMap.entries()) {
		if (pattern instanceof RegExp && pattern.test(pathname)) {
			return expiration;
		}
	}

	return null;
}

/**
 * Register ISR config for a route pattern
 * Can be called from route files or build scripts
 */
export function registerIsrConfig(pattern: string | RegExp, expiration: number) {
	isrConfigMap.set(pattern, expiration);
}

const ssr = async (request: Request, bunServer: Bun.Server<unknown>) => {
	const { pathname, search } = new URL(request.url);
	const originalUrl = new URL(request.url);

	// For CSRF protection: preserve origin/referer headers to match request URL
	// SvelteKit validates that origin/referer match the request URL
	let requestUrl: string;
	let headers: Headers;

	if (origin) {
		// Reverse proxy scenario: reconstruct URL with ORIGIN
		const url = request.url.slice(request.url.split('/', 3).join('/').length);
		requestUrl = origin + url;
		headers = new Headers(request.headers);

		// Update origin and host to match the ORIGIN env var
		headers.set('origin', origin);
		try {
			const originUrl = new URL(origin);
			headers.set('host', originUrl.host);
		} catch {
			// Keep original host if origin is invalid
		}

		// Update referer to match the new origin for CSRF validation
		if (request.referrer) {
			try {
				const refererUrl = new URL(request.referrer);
				const newReferer = origin + refererUrl.pathname + refererUrl.search;
				headers.set('referer', newReferer);
			} catch {
				// Keep original referer if it can't be parsed
			}
		}
	} else {
		// Direct access: use original URL to preserve CSRF validation
		requestUrl = request.url;
		headers = new Headers(request.headers);

		// Ensure origin header exists and matches the request URL
		// This is critical for CSRF validation
		const expectedOrigin = `${originalUrl.protocol}//${originalUrl.host}`;
		const currentOrigin = headers.get('origin');

		// Log CSRF debugging info for POST requests (only in debug mode)
		if (request.method === 'POST' && isDebugMode()) {
			debugLog(
				`[CSRF] POST request - Origin: ${currentOrigin || 'missing'}, Expected: ${expectedOrigin}, URL: ${requestUrl}`
			);
			debugLog(`[CSRF] Referer: ${headers.get('referer') || 'missing'}`);
		}

		// Set origin if missing or doesn't match
		if (!currentOrigin || currentOrigin !== expectedOrigin) {
			headers.set('origin', expectedOrigin);
		}

		// Ensure referer matches origin for CSRF validation
		const referer = headers.get('referer');
		if (referer && !referer.startsWith(expectedOrigin)) {
			// Update referer to match origin
			try {
				const refererUrl = new URL(referer);
				const newReferer = expectedOrigin + refererUrl.pathname + refererUrl.search;
				headers.set('referer', newReferer);
			} catch {
				// If referer can't be parsed, set it to the origin
				headers.set('referer', expectedOrigin);
			}
		} else if (!referer && request.method === 'POST') {
			// For POST requests, set referer if missing
			headers.set('referer', expectedOrigin);
		}
	}

	const newRequest = new Request(requestUrl, {
		method: request.method,
		headers: headers,
		body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
		redirect: request.redirect,
		signal: request.signal,
		referrer: headers.get('referer') || request.referrer,
		referrerPolicy: request.referrerPolicy
	});

	// Log request start
	if (request.method === 'GET') {
		debugLog(`[ISR] 📥 ${request.method} ${pathname}${search}`);
	}

	const getClientAddress = () => {
		if (address_header) {
			if (!request.headers.has(address_header)) {
				throw new Error(
					`Address header was specified with ${
						ENV_PREFIX + 'ADDRESS_HEADER'
					}=${address_header} but is absent from request`
				);
			}

			const value = request.headers.get(address_header) || '';

			if (address_header === 'x-forwarded-for') {
				const addresses = value.split(',');

				if (xff_depth < 1) {
					throw new Error(`${ENV_PREFIX + 'XFF_DEPTH'} must be a positive integer`);
				}

				if (xff_depth > addresses.length) {
					throw new Error(
						`${ENV_PREFIX + 'XFF_DEPTH'} is ${xff_depth}, but only found ${
							addresses.length
						} addresses`
					);
				}
				return addresses[addresses.length - xff_depth]?.trim() || '';
			}

			return value;
		}

		return bunServer.requestIP(request)?.address || '';
	};

	const respond = (req: Request) =>
		server.respond(req, {
			// @ts-expect-error custom platform data not in App.Platform
			platform: { server: bunServer, request },
			getClientAddress
		});

	// Check if user is authenticated (bypass ISR for authenticated users)
	const authCookie = request.headers.get('cookie');
	const hasAuthCookie =
		authCookie &&
		(authCookie.includes('auth-session=') ||
			authCookie.includes('auth_session=') ||
			authCookie.includes('app_session='));

	if (hasAuthCookie && request.method === 'GET') {
		debugLog(`[ISR] 🔐 Authenticated user detected - Bypassing ISR for ${pathname}${search}`);
		// Skip ISR for authenticated users - always serve fresh content
		const response = await respond(newRequest);
		return compressResponse(response, request);
	}

	// If ISR is disabled, skip all caching logic but still remove ISR headers
	if (!isr) {
		const response = await respond(newRequest);
		// Remove ISR headers since they're not being used
		const newHeaders = new Headers(response.headers);
		newHeaders.delete('x-isr-expiration');
		newHeaders.delete('x-revalidate');

		const cleanedResponse = new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: newHeaders
		});
		return compressResponse(cleanedResponse, request);
	}

	// Check ISR config from map first (fast path)
	let expiration = get_isr_config(pathname);
	const cacheKey = `isr:${pathname}${search}`;

	// For GET requests, check cache if ISR is configured
	if (expiration && request.method === 'GET') {
		debugLog(`[ISR] Checking cache for: ${pathname}${search} (expiration: ${expiration}s)`);
		const cached = await getCachedResponse(cacheKey);

		if (cached) {
			const now = Date.now();
			const age = Math.floor((now - cached.generatedAt) / 1000);
			const isStale = now - cached.generatedAt > expiration * 1000;

			if (isStale) {
				debugLog(
					`[ISR] ⚠️  Cache HIT (STALE) for ${pathname}${search} - Age: ${age}s, Expiration: ${expiration}s - Serving stale while revalidating`
				);
				// Background revalidation - serve stale content while updating
				(async () => {
					try {
						debugLog(`[ISR] 🔄 Starting background revalidation for ${pathname}${search}`);
						const response = await respond(newRequest.clone());

						if (response.status === 200) {
							const body = await response.text();
							const headers: Record<string, string> = {};
							response.headers.forEach((v, k) => (headers[k] = v));

							// Remove ISR headers from cached response
							delete headers['x-isr-expiration'];
							delete headers['x-revalidate'];

							const generatedAt = Date.now();
							await setCachedResponse(
								cacheKey,
								{
									status: response.status,
									headers,
									body,
									generatedAt
								},
								expiration * 10
							);
							// Track for automatic revalidation
							await trackPageForRevalidation(pathname, search, expiration, generatedAt);
							debugLog(`[ISR] ✅ Background revalidation completed for ${pathname}${search}`);
						} else {
							debugLog(
								`[ISR] ⚠️  Background revalidation returned status ${response.status} for ${pathname}${search}`
							);
						}
					} catch (e) {
						if (isDebugMode()) {
							console.error(`[ISR] ❌ Background revalidation failed for ${pathname}${search}:`, e);
						}
					}
				})();
			} else {
				debugLog(
					`[ISR] ✅ Cache HIT (FRESH) for ${pathname}${search} - Age: ${age}s, Expiration: ${expiration}s`
				);
			}

			// Create response from cached body and compress it
			const cachedResponse = new Response(cached.body, {
				status: cached.status,
				headers: new Headers(cached.headers)
			});
			return compressResponse(cachedResponse, request);
		} else {
			debugLog(`[ISR] ❌ Cache MISS for ${pathname}${search} - Rendering fresh`);
		}
	}

	// Render the request
	let response = await respond(newRequest);

	// Check if response has ISR headers (routes can set these in load functions)
	// Only process ISR caching if ISR is enabled
	if (isr && response.status === 200 && request.method === 'GET' && !hasAuthCookie) {
		if (!expiration) {
			const isrHeader =
				response.headers.get('x-isr-expiration') || response.headers.get('x-revalidate');
			if (isrHeader) {
				const headerExpiration = parseInt(isrHeader, 10);
				if (!isNaN(headerExpiration) && headerExpiration > 0) {
					expiration = headerExpiration;
					debugLog(
						`[ISR] 📋 ISR config found in headers for ${pathname}${search} - Expiration: ${expiration}s`
					);
				}
			}
		}

		// Cache the response if ISR is configured (skip for authenticated users)
		if (expiration) {
			const clonedResponse = response.clone();
			const body = await clonedResponse.text();
			const bodySize = Math.round(body.length / 1024); // Size in KB
			const headers: Record<string, string> = {};
			clonedResponse.headers.forEach((v, k) => (headers[k] = v));

			// Remove ISR headers from cached response (they're metadata, not for clients)
			delete headers['x-isr-expiration'];
			delete headers['x-revalidate'];

			const generatedAt = Date.now();
			await setCachedResponse(
				cacheKey,
				{
					status: response.status,
					headers,
					body,
					generatedAt
				},
				expiration * 10
			);
			// Track for automatic revalidation
			await trackPageForRevalidation(pathname, search, expiration, generatedAt);
			debugLog(
				`[ISR] 💾 Cached response for ${pathname}${search} - Expiration: ${expiration}s, Size: ${bodySize}KB, TTL: ${expiration * 10}s`
			);
		} else if (request.method === 'GET') {
			debugLog(`[ISR] ℹ️  No ISR config for ${pathname}${search} - Not caching`);
		}
	}

	// Compress the response before returning
	// Note: compressResponse will also remove ISR headers
	return compressResponse(response, request);
};

export const getHandler = () => {
	const websocket = server.websocket();

	const staticHandlers = [
		serveAssets && serve(`${import.meta.dir}/client${base}`, true),
		serveAssets && serve_prerendered()
	].filter(Boolean) as RequestHandler[];

	const handler = (request: Request, server: Bun.Server<unknown>) => {
		function handle(i: number): Response | Promise<Response> {
			if (i < staticHandlers.length) {
				return staticHandlers[i]!(request, () => handle(i + 1));
			} else {
				return ssr(request, server);
			}
		}

		return handle(0);
	};

	return {
		fetch: handler,
		websocket
	};
};
