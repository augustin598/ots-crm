import { describe, test, expect } from 'bun:test';
import { translateDeclineCode } from '../decline-codes';

describe('translateDeclineCode', () => {
	test('translates insufficient_funds', () => {
		expect(translateDeclineCode('insufficient_funds', 'Your card was declined.')).toBe(
			'Card refuzat de bancă · cod 51 (fonduri insuficiente)'
		);
	});

	test('translates expired_card', () => {
		expect(translateDeclineCode('expired_card', 'fallback')).toBe('Card expirat');
	});

	test('translates card_declined as generic decline', () => {
		expect(translateDeclineCode('card_declined', 'fallback')).toBe('Card refuzat de bancă');
	});

	test('translates incorrect_cvc', () => {
		expect(translateDeclineCode('incorrect_cvc', 'fallback')).toBe('CVC incorect');
	});

	test('translates processing_error', () => {
		expect(translateDeclineCode('processing_error', 'fallback')).toBe(
			'Eroare de procesare la bancă · încercați din nou'
		);
	});

	test('translates authentication_required', () => {
		expect(translateDeclineCode('authentication_required', 'fallback')).toBe(
			'Autentificare 3D Secure eșuată'
		);
	});

	test('falls back to Stripe message for unknown code', () => {
		expect(translateDeclineCode('something_weird', 'Card was refused by issuer.')).toBe(
			'Card was refused by issuer.'
		);
	});

	test('falls back to generic message when no fallback provided', () => {
		expect(translateDeclineCode('weird_code', null)).toBe(
			'Plata a fost respinsă · contactați banca emitentă'
		);
	});

	test('null code returns generic decline', () => {
		expect(translateDeclineCode(null, null)).toBe(
			'Plata a fost respinsă · contactați banca emitentă'
		);
	});
});
