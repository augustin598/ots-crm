import { redis } from 'bun';

const REVALIDATION_TRACKING_KEY = 'isr:revalidation:pages';

/**
 * Check if debug mode is enabled
 */
function isDebugMode(): boolean {
	return process.env.NODE_ENV === 'debug';
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
 * Untrack pages from revalidation tracking
 * Called when cache is invalidated to prevent revalidation of invalidated pages
 */
async function untrackPagesForRevalidation(path: string) {
	try {
		// Get all cache keys matching the path pattern
		const pattern = `isr:${path}*`;
		const keys = await redis.keys(pattern);

		if (!keys || keys.length === 0) {
			return;
		}

		// Get all tracked pages from revalidation tracking
		const members = await redis.zrange(REVALIDATION_TRACKING_KEY, 0, -1);

		// Find and remove matching pages
		for (const member of members) {
			try {
				const pageInfo = JSON.parse(member);
				// Check if this page's path matches the invalidated path pattern
				if (pageInfo.path && pageInfo.path.startsWith(path)) {
					await redis.zrem(REVALIDATION_TRACKING_KEY, member);
					debugLog(`[ISR Cache] 🗑️  Untracked page from revalidation: ${pageInfo.path}`);
				}
			} catch {
				// Skip invalid JSON
			}
		}
	} catch (e) {
		if (isDebugMode()) {
			console.error(`[ISR Cache] ❌ Failed to untrack pages for revalidation:`, e);
		}
	}
}

export async function invalidate(path: string) {
	// If path is provided, we can either delete exact key or use a pattern
	// Since keys are isr:${pathname}${search}, we might want to delete all variations of a path
	const pattern = `isr:${path}*`;
	const keys = await redis.keys(pattern);
	if (keys && keys.length > 0) {
		await redis.del(...keys);
	}
}

/**
 * Invalidates the ISR cache for a given path.
 * Also untracks the pages from automatic revalidation.
 * @param path The path to invalidate (e.g., '/blog', '/blog/my-post')
 */
export async function invalidateCache(path: string) {
	try {
		await invalidate(path);
		// Also untrack from revalidation tracking
		await untrackPagesForRevalidation(path);
	} catch (e) {
		if (isDebugMode()) {
			console.error(`Failed to invalidate cache for ${path}:`, e);
		}
	}
}
