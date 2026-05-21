/**
 * Pure validation + normalization helpers for the public checkout modal.
 * No DOM, no remote calls — these run client-side (Svelte $derived) and could
 * also be reused server-side (`public-hosting.remote.ts`) at submit time for
 * defense in depth.
 *
 * Romanian-first, foreign-tolerant: a CHF or .es-domain customer with a non-RO
 * phone / postal still completes checkout, we just can't auto-detect their
 * county.
 */

// ============================================================================
// Email
// ============================================================================

const EMAIL_RE = /^[\w+-]+(?:\.[\w+-]+)*@[\da-z]+(?:[.-][\da-z]+)*\.[a-z]{2,}$/i;

const PERSONAL_EMAIL_DOMAINS = new Set([
	'gmail.com',
	'yahoo.com',
	'yahoo.ro',
	'hotmail.com',
	'hotmail.ro',
	'outlook.com',
	'outlook.ro',
	'live.com',
	'icloud.com',
	'me.com',
	'protonmail.com',
	'proton.me',
	'aol.com',
	'mail.ru',
	'yandex.com'
]);

export function normalizeEmail(raw: string): string {
	return raw.trim().toLowerCase();
}

export function validateEmail(value: string): string | null {
	const v = value.trim();
	if (!v) return 'Introdu un email.';
	if (v.length > 255) return 'Email prea lung.';
	if (!EMAIL_RE.test(v)) return 'Format email invalid.';
	return null;
}

/**
 * Returns true when the email is on a well-known consumer mail provider — we
 * use this to nudge "Persoană juridică" customers toward a corporate email
 * without blocking them.
 */
export function isPersonalEmail(value: string): boolean {
	const at = value.lastIndexOf('@');
	if (at <= 0) return false;
	const domain = value.slice(at + 1).toLowerCase().trim();
	return PERSONAL_EMAIL_DOMAINS.has(domain);
}

// ============================================================================
// Password strength (advisory only — never blocking)
// ============================================================================

export type PasswordStrength = {
	level: 0 | 1 | 2 | 3 | 4; // 0=empty, 1=slab, 2=mediu, 3=bun, 4=excelent
	label: 'gol' | 'slab' | 'mediu' | 'bun' | 'excelent';
	score: number; // 0..100
};

export function scorePassword(value: string): PasswordStrength {
	if (!value) return { level: 0, label: 'gol', score: 0 };
	let score = 0;
	if (value.length >= 8) score += 25;
	if (value.length >= 12) score += 15;
	if (/[a-z]/.test(value)) score += 12;
	if (/[A-Z]/.test(value)) score += 12;
	if (/\d/.test(value)) score += 12;
	if (/[^A-Za-z0-9]/.test(value)) score += 16;
	if (/(.)\1{2,}/.test(value)) score -= 8; // repeated chars penalty
	const norm = Math.max(0, Math.min(100, score));
	let level: PasswordStrength['level'];
	let label: PasswordStrength['label'];
	if (norm < 30) {
		level = 1;
		label = 'slab';
	} else if (norm < 55) {
		level = 2;
		label = 'mediu';
	} else if (norm < 80) {
		level = 3;
		label = 'bun';
	} else {
		level = 4;
		label = 'excelent';
	}
	return { level, label, score: norm };
}

// ============================================================================
// CUI (Romanian VAT/fiscal code)
// ============================================================================

export function normalizeCui(raw: string): string {
	return raw.trim().toUpperCase().replace(/^RO/, '').trim();
}

export function validateCuiFormat(value: string): string | null {
	const cleaned = normalizeCui(value);
	if (!cleaned) return 'Introdu CUI-ul firmei.';
	if (!/^\d{2,12}$/.test(cleaned)) return 'CUI invalid — doar cifre, 2-12 caractere.';
	return null;
}

// ============================================================================
// Reg. Comerțului (Romanian trade registry — J##/####/####)
// ============================================================================

// J = comerciant; F = federație/asociație/societate civilă; C = cooperative
// (registered at ORC); all three legit on ANAF responses.
const REGCOM_RE = /^[CFJ]\d{1,2}\/\d{1,5}\/\d{4}$/i;

export function normalizeRegCom(raw: string): string {
	return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function validateRegCom(value: string): string | null {
	const v = normalizeRegCom(value);
	if (!v) return 'Introdu Reg. Comerțului (ex: J33/1520/2018).';
	if (!REGCOM_RE.test(v))
		return 'Format invalid — folosește forma J/F/C ##/####/#### (ex: J33/1520/2018).';
	return null;
}

// ============================================================================
// Phone number — RO mobile/landline + international fallback
// ============================================================================

export type PhoneKind = 'ro-mobile' | 'ro-landline' | 'international' | 'invalid';

export type PhoneCheck = {
	kind: PhoneKind;
	normalized: string; // e164-ish: "+40721234567" or "+34612345678"
	display: string; // pretty: "+40 721 234 567"
};

/** Strip all formatting so we can run digit-only checks. */
function stripPhone(raw: string): string {
	return raw.replace(/[^\d+]/g, '');
}

// RO mobile prefixes (2024): 07XX. Landline area codes by judet — 02X/03X with
// known second digits. We don't try to enumerate every area code; instead we
// match the structural shape and let the digit count decide.
const RO_MOBILE_RE = /^(?:40)?7\d{8}$/; // 9 digits after optional 40 prefix
const RO_LANDLINE_RE = /^(?:40)?(?:2\d|3\d)\d{7}$/; // 21x/22x/23x/.../39x + 7 digits

/**
 * Detect obviously-fake phone numbers (all same digit, sequential ladder).
 * We accept legitimate international formats but block patterns that are
 * almost certainly bot/spam input.
 */
function looksFake(digits: string): boolean {
	if (digits.length < 7) return true;
	if (/^(\d)\1{6,}$/.test(digits)) return true; // 7+ identical digits
	const SEQ_UP = '0123456789';
	const SEQ_DOWN = '9876543210';
	if (SEQ_UP.includes(digits.slice(0, 7)) || SEQ_DOWN.includes(digits.slice(0, 7))) return true;
	return false;
}

export function checkPhone(raw: string): PhoneCheck {
	const cleaned = stripPhone(raw);
	if (!cleaned) return { kind: 'invalid', normalized: '', display: '' };

	// Drop "00" international prefix if present (treat as "+")
	const noLeadZeros = cleaned.replace(/^00/, '+');
	// Detect RO patterns: strip leading "+" or "0" so the regexes see a normalized digit run.
	let digits = noLeadZeros.replace(/^\+/, '');
	if (digits.startsWith('0') && !digits.startsWith('00')) digits = digits.slice(1); // drop leading 0 (RO local)

	// Reject obvious fakes early — applies to RO + international alike.
	if (looksFake(digits)) return { kind: 'invalid', normalized: '', display: '' };

	// RO mobile (after stripping leading 0): "7XXXXXXXX" or "407XXXXXXXX"
	if (RO_MOBILE_RE.test(digits)) {
		const local9 = digits.startsWith('40') ? digits.slice(2) : digits;
		const normalized = '+40' + local9;
		const display = `+40 ${local9.slice(0, 3)} ${local9.slice(3, 6)} ${local9.slice(6, 9)}`;
		return { kind: 'ro-mobile', normalized, display };
	}
	if (RO_LANDLINE_RE.test(digits)) {
		const local = digits.startsWith('40') ? digits.slice(2) : digits;
		const normalized = '+40' + local;
		const display = `+40 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
		return { kind: 'ro-landline', normalized, display };
	}

	// International: requires a leading + or 00 in the original
	if (noLeadZeros.startsWith('+')) {
		const intl = noLeadZeros.slice(1);
		if (/^[1-9]\d{6,14}$/.test(intl)) {
			return {
				kind: 'international',
				normalized: '+' + intl,
				display: '+' + intl
			};
		}
	}

	return { kind: 'invalid', normalized: '', display: '' };
}

export function validatePhone(value: string): string | null {
	const v = value.trim();
	if (!v) return 'Introdu un număr de telefon.';
	const c = checkPhone(v);
	if (c.kind === 'invalid')
		return 'Telefon invalid. Folosește 07XX XXX XXX, 021 XXX XXXX, sau +40 / +XX...';
	return null;
}

// ============================================================================
// Postal code — strict 6 digits for RO, tolerant for foreign
// ============================================================================

export type PostalContext = {
	countryHint?: 'RO' | 'foreign' | null;
};

export function validatePostal(value: string, ctx: PostalContext = {}): string | null {
	const v = value.trim();
	if (!v) return null; // optional in our form
	const country = ctx.countryHint ?? 'RO';
	if (country === 'RO') {
		if (!/^\d{6}$/.test(v)) return 'Codul poștal RO are 6 cifre (ex: 720117).';
		return null;
	}
	if (!/^[A-Z0-9 -]{3,12}$/i.test(v)) return 'Cod poștal invalid.';
	return null;
}
