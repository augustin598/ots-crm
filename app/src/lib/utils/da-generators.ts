import { encodeBase32LowerCase } from '@oslojs/encoding';

/**
 * DA-side rules: lowercase, alphanumeric, max 16 chars, must start with a letter.
 * Strategy: take a normalized prefix from a seed (business name or email local-part)
 * + a 4-char random suffix to avoid collisions with existing DA users.
 *
 * Works in both Node (server) and browser (Vite) — uses Web Crypto API.
 */
export function generateDaUsername(seed: string): string {
	const normalized = seed
		.toLowerCase()
		.normalize('NFD')
		// Strip Unicode combining diacritical marks (U+0300-U+036F). Using the
		// numeric escape rather than inline grave-to-tilde literals so the regex
		// can't silently break if file encoding ever changes.
		.replace(/[\u0300-\u036F]/g, '')
		.replace(/[^a-z0-9]/g, '')
		.slice(0, 10);
	const prefix = normalized.length > 0 && /^[a-z]/.test(normalized) ? normalized : `ots${normalized}`;
	const suffix = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(3))).slice(0, 4);
	return `${prefix.slice(0, 12)}${suffix}`.slice(0, 16);
}

/**
 * 16-char random password compatible with DA (no special chars that break URL-form
 * encoding). 14 chars base32 + 2 digits at the tail to satisfy DA's complexity check.
 */
export function generateDaPassword(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	const base = encodeBase32LowerCase(bytes).slice(0, 14);
	const digits = String(crypto.getRandomValues(new Uint8Array(1))[0] % 100).padStart(2, '0');
	return `${base}${digits}`;
}
