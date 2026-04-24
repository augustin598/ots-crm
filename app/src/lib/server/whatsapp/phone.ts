export function jidToE164(jid: string): string {
	const bare = jid.split('@')[0].split(':')[0];
	return `+${bare}`;
}

export function e164ToJid(phoneE164: string): string {
	const digits = phoneE164.replace(/[^\d]/g, '');
	return `${digits}@s.whatsapp.net`;
}

const ROMANIAN_MOBILE_RE = /^07\d{8}$/;
const E164_RE = /^\+[1-9]\d{7,14}$/;

export class InvalidPhoneError extends Error {
	constructor(input: string, reason: string) {
		super(`Invalid phone "${input}": ${reason}`);
		this.name = 'InvalidPhoneError';
	}
}

export function toE164(input: string): string {
	const trimmed = input.trim().replace(/[\s\-().]/g, '');
	if (!trimmed) throw new InvalidPhoneError(input, 'empty');
	if (E164_RE.test(trimmed)) return trimmed;
	if (trimmed.startsWith('00')) {
		const candidate = `+${trimmed.slice(2)}`;
		if (E164_RE.test(candidate)) return candidate;
	}
	// Bare international form without + (e.g. "40753755327", "14155552671")
	const withPlus = `+${trimmed}`;
	if (E164_RE.test(withPlus)) return withPlus;
	if (ROMANIAN_MOBILE_RE.test(trimmed)) return `+4${trimmed}`;
	throw new InvalidPhoneError(input, 'must be E.164 (e.g. +40722123456)');
}

export function tryToE164(input: string | null | undefined): string | null {
	if (!input) return null;
	try {
		return toE164(input);
	} catch {
		return null;
	}
}

/**
 * Generate plausible CRM-stored variants for a canonical E.164 phone number,
 * so DB lookups against `client.phone` can match multiple formats users may have saved.
 * Covers: E.164 with +, without +, Romanian local form (0...).
 * For arbitrary-format stored phones (with spaces/dashes), prefer normalizing at the
 * other side via toE164().
 */
export function phoneE164Variants(phoneE164: string): string[] {
	const variants = new Set<string>();
	variants.add(phoneE164);
	if (phoneE164.startsWith('+')) variants.add(phoneE164.slice(1));
	if (phoneE164.startsWith('+40')) variants.add('0' + phoneE164.slice(3));
	return Array.from(variants);
}
