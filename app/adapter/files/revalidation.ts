import { redis } from './redis';
import { env } from './env';

const REVALIDATION_TRACKING_KEY = 'isr:revalidation:pages';
const REVALIDATION_INTERVAL = 30; // Check every 30 seconds
const REVALIDATION_BUFFER = 10; // Revalidate 10 seconds before expiration

let revalidationInterval: Timer | null = null;
let bunServer: Bun.Server<unknown> | null = null;
let handlerFetch: ((request: Request) => Response | Promise<Response>) | null = null;

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
 * Debug error - always logs errors
 */
function debugError(...args: unknown[]) {
	if (isDebugMode()) {
		console.error(...args);
	}
}

/**
 * Track a page for revalidation
 * Called when a page is cached with ISR
 */
export async function trackPageForRevalidation(
	pathname: string,
	search: string,
	expiration: number,
	generatedAt: number
) {
	try {
		const fullPath = `${pathname}${search}`;
		const expiresAt = generatedAt + expiration * 1000;
		const pageInfo = {
			path: fullPath,
			pathname,
			search,
			expiration
		};

		// Store in a sorted set with expiresAt as score for efficient querying
		// Using fullPath as member key so we can update expiration time for the same page
		await redis.zadd(REVALIDATION_TRACKING_KEY, expiresAt, JSON.stringify(pageInfo));
		debugLog(
			`[ISR Revalidation] 📝 Tracking page for revalidation: ${fullPath} (expires in ${expiration}s, expiresAt: ${new Date(expiresAt).toISOString()})`
		);
	} catch (e) {
		debugError(`[ISR Revalidation] ❌ Failed to track page for revalidation:`, e);
	}
}

/**
 * Remove a page from revalidation tracking
 * Called when cache is invalidated
 */
export async function untrackPageForRevalidation(pathname: string, search: string) {
	try {
		const fullPath = `${pathname}${search}`;

		// Get all members and find matching ones
		const members = await redis.zrange(REVALIDATION_TRACKING_KEY, 0, -1);
		for (const member of members) {
			try {
				const pageInfo = JSON.parse(member);
				if (pageInfo.path === fullPath) {
					await redis.zrem(REVALIDATION_TRACKING_KEY, member);
					debugLog(`[ISR Revalidation] 🗑️  Untracked page: ${fullPath}`);
				}
			} catch {
				// Skip invalid JSON
			}
		}
	} catch (e) {
		debugError(`[ISR Revalidation] ❌ Failed to untrack page:`, e);
	}
}

/**
 * Revalidate a single page by making an internal request
 */
async function revalidatePage(pageInfo: {
	path: string;
	pathname: string;
	search: string;
	expiration: number;
}) {
	if (!handlerFetch || !bunServer) {
		debugError('[ISR Revalidation] ❌ Handler or server not initialized');
		return;
	}

	try {
		const origin = env('ORIGIN', undefined);
		const baseUrl = origin || `http://${bunServer.hostname}:${bunServer.port}`;
		const url = `${baseUrl}${pageInfo.path}`;

		debugLog(`[ISR Revalidation] 🔄 Revalidating page: ${pageInfo.path}`);

		// Create an internal request (no auth cookies, no user headers)
		const request = new Request(url, {
			method: 'GET',
			headers: {
				'user-agent': 'ISR-Revalidation-Bot/1.0',
				'x-isr-revalidation': 'true' // Internal header to identify revalidation requests
			}
		});

		const response = await handlerFetch(request);

		if (response.status === 200) {
			debugLog(`[ISR Revalidation] ✅ Successfully revalidated: ${pageInfo.path}`);
		} else {
			debugLog(
				`[ISR Revalidation] ⚠️  Revalidation returned status ${response.status} for: ${pageInfo.path}`
			);
		}
	} catch (e) {
		debugError(`[ISR Revalidation] ❌ Failed to revalidate ${pageInfo.path}:`, e);
	}
}

/**
 * Check for expired or soon-to-expire pages and revalidate them
 */
async function checkAndRevalidatePages() {
	if (!handlerFetch || !bunServer) {
		return;
	}

	try {
		const now = Date.now();
		const checkTime = now + REVALIDATION_BUFFER * 1000; // Check pages expiring in the next buffer period

		// Get all pages that have expired or will expire soon
		const expiredPages = await redis.zrangebyscore(REVALIDATION_TRACKING_KEY, 0, checkTime);

		if (expiredPages.length === 0) {
			return;
		}

		debugLog(`[ISR Revalidation] 🔍 Found ${expiredPages.length} page(s) needing revalidation`);

		// Revalidate pages in parallel (but limit concurrency)
		const revalidationPromises: Promise<void>[] = [];
		for (const pageJson of expiredPages) {
			try {
				const pageInfo = JSON.parse(pageJson);
				revalidationPromises.push(revalidatePage(pageInfo));

				// Limit to 5 concurrent revalidations
				if (revalidationPromises.length >= 5) {
					await Promise.all(revalidationPromises);
					revalidationPromises.length = 0;
				}
			} catch (e) {
				debugError(`[ISR Revalidation] ❌ Failed to parse page info:`, e);
			}
		}

		// Wait for remaining revalidations
		if (revalidationPromises.length > 0) {
			await Promise.all(revalidationPromises);
		}

		// Clean up old entries (pages that expired more than 1 hour ago)
		const oldThreshold = now - 3600 * 1000;
		await redis.zremrangebyscore(REVALIDATION_TRACKING_KEY, 0, oldThreshold);
	} catch (e) {
		debugError(`[ISR Revalidation] ❌ Error checking pages for revalidation:`, e);
	}
}

/**
 * Start the background revalidation scheduler
 */
export function startRevalidationScheduler(
	server: Bun.Server<unknown>,
	fetchHandler: (request: Request) => Response | Promise<Response>
) {
	if (revalidationInterval) {
		debugLog('[ISR Revalidation] ⚠️  Scheduler already running');
		return;
	}

	bunServer = server;
	handlerFetch = fetchHandler;

	debugLog(
		`[ISR Revalidation] 🚀 Starting background revalidation scheduler (interval: ${REVALIDATION_INTERVAL}s, buffer: ${REVALIDATION_BUFFER}s)`
	);

	// Run immediately on start
	checkAndRevalidatePages().catch((e) => {
		debugError('[ISR Revalidation] ❌ Error in initial revalidation check:', e);
	});

	// Then run periodically
	revalidationInterval = setInterval(() => {
		checkAndRevalidatePages().catch((e) => {
			debugError('[ISR Revalidation] ❌ Error in periodic revalidation check:', e);
		});
	}, REVALIDATION_INTERVAL * 1000);
}

/**
 * Stop the background revalidation scheduler
 */
export function stopRevalidationScheduler() {
	if (revalidationInterval) {
		clearInterval(revalidationInterval);
		revalidationInterval = null;
		bunServer = null;
		handlerFetch = null;
		debugLog('[ISR Revalidation] 🛑 Stopped background revalidation scheduler');
	}
}
