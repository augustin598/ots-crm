import { redis as bunRedis } from 'bun';
import { untrackPageForRevalidation } from './revalidation';

export const redis = bunRedis;

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

export async function getCachedResponse(key: string) {
	try {
		const cached = await redis.get(key);
		if (!cached) {
			debugLog(`[ISR Redis] 🔍 Cache GET: ${key} - MISS`);
			return null;
		}
		const parsed = JSON.parse(cached);
		debugLog(`[ISR Redis] ✅ Cache GET: ${key} - HIT`);
		return parsed;
	} catch (e) {
		if (isDebugMode()) {
			console.error(`[ISR Redis] ❌ Cache GET failed for ${key}:`, e);
		}
		return null;
	}
}

export async function setCachedResponse(key: string, response: unknown, ttl: number) {
	try {
		// Bun's redis.set supports 'ex' for seconds
		await redis.setex(key, ttl, JSON.stringify(response));
		debugLog(`[ISR Redis] 💾 Cache SET: ${key} - TTL: ${ttl}s`);
	} catch (e) {
		if (isDebugMode()) {
			console.error(`[ISR Redis] ❌ Cache SET failed for ${key}:`, e);
		}
		throw e;
	}
}

export async function invalidateCache(path: string) {
	try {
		// If path is provided, we can either delete exact key or use a pattern
		// Since keys are isr:${pathname}${search}, we might want to delete all variations of a path
		const pattern = `isr:${path}*`;
		const keys = await redis.keys(pattern);
		if (keys && keys.length > 0) {
			await redis.del(...keys);
			debugLog(
				`[ISR Redis] 🗑️  Cache INVALIDATED: ${keys.length} key(s) matching pattern "${pattern}"`
			);
			if (isDebugMode()) {
				keys.forEach((key) => debugLog(`[ISR Redis]   - Deleted: ${key}`));
			}

			// Also untrack pages from revalidation
			for (const key of keys) {
				// Extract pathname and search from key (format: isr:${pathname}${search})
				const keyWithoutPrefix = key.replace(/^isr:/, '');
				const url = new URL(keyWithoutPrefix, 'http://localhost');
				await untrackPageForRevalidation(url.pathname, url.search);
			}
		} else {
			debugLog(`[ISR Redis] ℹ️  Cache INVALIDATE: No keys found matching pattern "${pattern}"`);
		}
	} catch (e) {
		if (isDebugMode()) {
			console.error(`[ISR Redis] ❌ Cache INVALIDATE failed for pattern "${path}*":`, e);
		}
		throw e;
	}
}
