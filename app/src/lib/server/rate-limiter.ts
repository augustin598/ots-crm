/**
 * Simple in-memory rate limiter for auth endpoints.
 * Tracks requests per key (email or IP) with fixed window.
 */

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

const MAX_STORE_SIZE = 50_000;
const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 10 minutes (unref to allow graceful shutdown)
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of store) {
		if (now > entry.resetAt) {
			store.delete(key);
		}
	}
}, 10 * 60 * 1000).unref();

export interface RateLimitOptions {
	/** Max requests allowed in the window */
	max: number;
	/** Window size in milliseconds */
	windowMs: number;
}

const AUTH_EMAIL_LIMIT: RateLimitOptions = { max: 5, windowMs: 60 * 60 * 1000 }; // 5/hour
const AUTH_IP_LIMIT: RateLimitOptions = { max: 20, windowMs: 60 * 60 * 1000 }; // 20/hour

/**
 * Check if a key is rate limited. Returns true if the request should be blocked.
 */
function isRateLimited(key: string, options: RateLimitOptions): boolean {
	const now = Date.now();
	const entry = store.get(key);

	if (!entry || now > entry.resetAt) {
		store.set(key, { count: 1, resetAt: now + options.windowMs });
		return false;
	}

	// Already over limit -- don't increment further
	if (entry.count >= options.max) {
		return true;
	}

	entry.count++;
	return entry.count > options.max;
}

/**
 * Generic fixed-window limiter for non-auth flows (ex. poarta cu parolă a
 * paginii publice `/servicii`). Returns true when the request must be BLOCKED.
 *
 * În proces, deci per pod — folosește-l ca plasă de siguranță lângă limitarea
 * distribuită din Redis (`$lib/server/redis` → `rateLimit`), care e fail-open
 * dacă Redis pică.
 */
export function checkFixedWindowLimit(key: string, options: RateLimitOptions): boolean {
	if (store.size > MAX_STORE_SIZE) {
		const now = Date.now();
		for (const [k, entry] of store) {
			if (now > entry.resetAt) store.delete(k);
		}
	}
	return isRateLimited(key, options);
}

/**
 * Check auth rate limits for both email and IP.
 * Returns null if allowed, or an error message if rate limited.
 */
export function checkAuthRateLimit(email: string, ip: string | null): string | null {
	// Safety: prevent unbounded Map growth under attack
	if (store.size > MAX_STORE_SIZE) {
		const now = Date.now();
		for (const [key, entry] of store) {
			if (now > entry.resetAt) store.delete(key);
		}
	}

	const emailKey = `auth:email:${email.toLowerCase()}`;
	if (isRateLimited(emailKey, AUTH_EMAIL_LIMIT)) {
		return 'Too many requests. Please try again later.';
	}

	if (ip) {
		const ipKey = `auth:ip:${ip}`;
		if (isRateLimited(ipKey, AUTH_IP_LIMIT)) {
			return 'Too many requests. Please try again later.';
		}
	}

	return null;
}
