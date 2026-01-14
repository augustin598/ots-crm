/**
 * OAuth state token management for CSRF protection
 * Uses in-memory cache with expiration
 */

interface StateToken {
	state: string;
	tenantId: string;
	redirectUri: string;
	expiresAt: Date;
}

// In-memory cache for state tokens
// In production, consider using Redis or database for distributed systems
const stateTokens = new Map<string, StateToken>();

// Cleanup expired tokens every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const STATE_EXPIRY = 10 * 60 * 1000; // 10 minutes

setInterval(() => {
	const now = new Date();
	for (const [state, token] of stateTokens.entries()) {
		if (token.expiresAt < now) {
			stateTokens.delete(state);
		}
	}
}, CLEANUP_INTERVAL);

/**
 * Generate and store a state token
 */
export function generateStateToken(tenantId: string, redirectUri: string): string {
	const state = crypto.randomUUID();
	const expiresAt = new Date(Date.now() + STATE_EXPIRY);

	stateTokens.set(state, {
		state,
		tenantId,
		redirectUri,
		expiresAt
	});

	return state;
}

/**
 * Validate and consume a state token
 * Returns the redirect URI if valid, null otherwise
 */
export function validateStateToken(state: string, tenantId: string): string | null {
	const token = stateTokens.get(state);

	if (!token) {
		return null;
	}

	// Check expiration
	if (token.expiresAt < new Date()) {
		stateTokens.delete(state);
		return null;
	}

	// Check tenant match
	if (token.tenantId !== tenantId) {
		return null;
	}

	// Get redirect URI before consuming
	const redirectUri = token.redirectUri;

	// Consume token (one-time use)
	stateTokens.delete(state);
	return redirectUri;
}

/**
 * Clean up expired tokens manually (for testing or manual cleanup)
 */
export function cleanupExpiredTokens(): number {
	const now = new Date();
	let cleaned = 0;

	for (const [state, token] of stateTokens.entries()) {
		if (token.expiresAt < now) {
			stateTokens.delete(state);
			cleaned++;
		}
	}

	return cleaned;
}
