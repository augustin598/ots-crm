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
	if (ROMANIAN_MOBILE_RE.test(trimmed)) return `+4${trimmed}`;
	throw new InvalidPhoneError(input, 'must be E.164 (e.g. +40722123456)');
}
