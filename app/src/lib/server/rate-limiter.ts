/**
 * Simple in-memory rate limiter for auth endpoints.
 * Tracks requests per key (email or IP) with sliding window.
 */

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 10 minutes
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of store) {
		if (now > entry.resetAt) {
			store.delete(key);
		}
	}
}, 10 * 60 * 1000);

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

	entry.count++;
	return entry.count > options.max;
}

/**
 * Check auth rate limits for both email and IP.
 * Returns null if allowed, or an error message if rate limited.
 */
export function checkAuthRateLimit(email: string, ip: string | null): string | null {
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
