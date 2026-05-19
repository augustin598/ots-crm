/**
 * Phone number utilities — primarily for converting messy DB phone numbers
 * to E164 format used by WhatsApp avatar lookups.
 *
 * Romanian focus: default country code is +40. National format starts with
 * 0 + 9 digits → +40 + 9 digits.
 */

/**
 * Normalize a phone to E164 format.
 *
 * - "+40744431469"   → "+40744431469" (already E164)
 * - "40744431469"    → "+40744431469"
 * - "0744431469"     → "+40744431469" (RO national → E164)
 * - "0040744431469"  → "+40744431469" (RO with international prefix)
 * - "0744 431 469"   → "+40744431469" (strips spaces/dashes/parens)
 * - "" / null / weirdness → null
 *
 * @param phone raw phone from DB or user input
 * @param defaultCountryCode default to RO (40) if no country code detected
 */
export function normalizePhoneE164(
	phone: string | null | undefined,
	defaultCountryCode: string = '40'
): string | null {
	if (!phone) return null;

	// Strip everything except digits and leading +
	const cleaned = phone.replace(/[^\d+]/g, '');
	if (!cleaned) return null;

	// Already E164 (starts with +)
	if (cleaned.startsWith('+')) {
		// Validate: + followed by 7-15 digits
		const digits = cleaned.slice(1);
		if (digits.length >= 7 && digits.length <= 15 && /^\d+$/.test(digits)) {
			return cleaned;
		}
		return null;
	}

	// "00" international prefix → "+"
	if (cleaned.startsWith('00')) {
		const rest = cleaned.slice(2);
		if (rest.length >= 7 && rest.length <= 15) return `+${rest}`;
		return null;
	}

	// RO national format: 0xxxxxxxxx (10 digits starting with 0)
	if (cleaned.startsWith('0') && cleaned.length === 10) {
		return `+${defaultCountryCode}${cleaned.slice(1)}`;
	}

	// Bare country-code prefix (e.g. "40744431469" — 11 digits)
	if (cleaned.length >= 11 && cleaned.length <= 15) {
		return `+${cleaned}`;
	}

	return null;
}

/**
 * Build the WhatsApp avatar URL for a phone in a tenant.
 * Normalizes the phone to E164 first; returns null if phone can't be normalized.
 *
 * URL hits the existing avatar API endpoint which returns the binary or 404.
 * ContactAvatar handles 404 fallback to initials.
 */
export function whatsappAvatarUrl(
	tenantSlug: string | null | undefined,
	phone: string | null | undefined
): string | null {
	if (!tenantSlug) return null;
	const e164 = normalizePhoneE164(phone);
	if (!e164) return null;
	return `/${tenantSlug}/api/whatsapp/avatar/${encodeURIComponent(e164)}`;
}
