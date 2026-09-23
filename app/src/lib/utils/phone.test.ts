import { describe, expect, test } from 'bun:test';
import { normalizePhoneE164 } from './phone';

describe('normalizePhoneE164', () => {
	test('formele obișnuite ale unui mobil RO dau același E.164', () => {
		for (const input of [
			'0748011266',
			'0748 011 266',
			'+40748011266',
			'+40 748 011 266',
			'+40.748 011 266',
			'0040748011266',
			'40748011266'
		]) {
			expect(normalizePhoneE164(input)).toBe('+40748011266');
		}
	});

	// Greșeala tipică: prefixul țării plus 0-ul național. După +40 nu urmează
	// niciodată 0, deci îl scoatem în loc să salvăm un număr care nu există.
	test('+40 urmat de 0-ul național', () => {
		expect(normalizePhoneE164('+40 0748 011 266')).toBe('+40748011266');
		expect(normalizePhoneE164('+40 (0) 748 011 266')).toBe('+40748011266');
		expect(normalizePhoneE164('+400748011266')).toBe('+40748011266');
		expect(normalizePhoneE164('00400748011266')).toBe('+40748011266');
		expect(normalizePhoneE164('400748011266')).toBe('+40748011266');
	});

	test('numerele altor țări rămân neatinse', () => {
		expect(normalizePhoneE164('+44 7700 900123')).toBe('+447700900123');
		expect(normalizePhoneE164('+373 69 123 456')).toBe('+37369123456');
	});

	test('intrări invalide', () => {
		expect(normalizePhoneE164('')).toBeNull();
		expect(normalizePhoneE164(null)).toBeNull();
		expect(normalizePhoneE164('abc')).toBeNull();
		expect(normalizePhoneE164('+40')).toBeNull();
		expect(normalizePhoneE164('748011266')).toBeNull();
	});
});
