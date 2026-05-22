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
 * 17-char random password that passes DA's hardened `complexity_check=1`:
 *   - lowercase letter (from base32 body)
 *   - uppercase letter (1 explicit)
 *   - digit (2 explicit)
 *   - punctuation symbol (1 from a DA-safe set — no URL-encoding hazards)
 *
 * Previously we returned base32+digits only (all lowercase + digits), which is
 * rejected on servers with `complexity_check=1` set in `directadmin.conf` with
 * "Password is not strong enough". The new pattern adds one uppercase and one
 * symbol at deterministic positions, then shuffles via Fisher–Yates so position
 * isn't predictable (mitigates any "password starts with lowercase" heuristics).
 *
 * Symbol set picked to be safe in:
 *   - URL form encoding (CMD_API_ACCOUNT_USER body)
 *   - Bash quoting (admins might copy the password into terminal)
 *   - Most shell/email-quoting (no backticks, dollar, pipes)
 */
const SAFE_SYMBOLS = '!@#%*-_=+.?';

export function generateDaPassword(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	const base = encodeBase32LowerCase(bytes).slice(0, 14); // 14 lowercase + digits chars
	const upper = String.fromCharCode(
		65 + (crypto.getRandomValues(new Uint8Array(1))[0] % 26)
	); // A-Z
	const digit = String.fromCharCode(
		48 + (crypto.getRandomValues(new Uint8Array(1))[0] % 10)
	); // 0-9
	const symbol = SAFE_SYMBOLS[crypto.getRandomValues(new Uint8Array(1))[0] % SAFE_SYMBOLS.length];

	// Fisher–Yates shuffle so the mandatory chars don't land in predictable
	// positions (some DA password heuristics check the LAST few chars).
	const chars = (base + upper + digit + symbol).split('');
	for (let i = chars.length - 1; i > 0; i--) {
		const j = crypto.getRandomValues(new Uint8Array(1))[0] % (i + 1);
		[chars[i], chars[j]] = [chars[j], chars[i]];
	}
	return chars.join('');
}
