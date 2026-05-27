/**
 * Translate Stripe decline / error codes into Romanian-language messages
 * suitable for the admin Comenzi hosting UI and Keez invoice notes.
 *
 * Falls back to:
 *   1. Stripe's English `error.message` if provided,
 *   2. a generic Romanian fallback otherwise.
 *
 * Codes from https://docs.stripe.com/declines/codes and
 * https://docs.stripe.com/error-codes.
 */

const TRANSLATIONS: Record<string, string> = {
	insufficient_funds: 'Card refuzat de bancă · cod 51 (fonduri insuficiente)',
	card_declined: 'Card refuzat de bancă',
	expired_card: 'Card expirat',
	incorrect_cvc: 'CVC incorect',
	incorrect_number: 'Număr card incorect',
	invalid_number: 'Număr card invalid',
	invalid_cvc: 'CVC invalid',
	invalid_expiry_month: 'Lună de expirare invalidă',
	invalid_expiry_year: 'An de expirare invalid',
	processing_error: 'Eroare de procesare la bancă · încercați din nou',
	authentication_required: 'Autentificare 3D Secure eșuată',
	card_velocity_exceeded: 'Limită de încercări depășită · reîncercați mai târziu',
	do_not_honor: 'Banca a respins plata · contactați emitentul',
	pickup_card: 'Card respins · contactați banca emitentă',
	lost_card: 'Card raportat pierdut',
	stolen_card: 'Card raportat furat',
	generic_decline: 'Card refuzat de bancă',
	fraudulent: 'Tranzacție respinsă pentru risc de fraudă',
	withdrawal_count_limit_exceeded: 'Limită de tranzacții depășită'
};

export function translateDeclineCode(
	code: string | null | undefined,
	fallbackMessage: string | null | undefined
): string {
	if (code && TRANSLATIONS[code]) return TRANSLATIONS[code];
	if (fallbackMessage && fallbackMessage.trim()) return fallbackMessage;
	return 'Plata a fost respinsă · contactați banca emitentă';
}
