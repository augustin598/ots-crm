/**
 * Unit tests for the pure checkout validators. These are the most regression-prone
 * pieces of the public order flow — phone formats, RegCom prefixes, CUI cleanup,
 * postal codes, password strength. Lock them down with concrete inputs so we
 * don't drift silently.
 */

import { describe, test, expect } from 'bun:test';
import {
	normalizeEmail,
	validateEmail,
	isPersonalEmail,
	scorePassword,
	normalizeCui,
	validateCuiFormat,
	normalizeRegCom,
	validateRegCom,
	checkPhone,
	validatePhone,
	validatePostal
} from '../validators';

describe('normalizeEmail', () => {
	test('lowercases and trims', () => {
		expect(normalizeEmail('  TEST@Example.RO  ')).toBe('test@example.ro');
	});
});

describe('validateEmail', () => {
	test('accepts standard format', () => {
		expect(validateEmail('test@example.ro')).toBeNull();
		expect(validateEmail('user.name+tag@sub.domain.co')).toBeNull();
	});
	test('rejects missing @ or TLD', () => {
		expect(validateEmail('not-an-email')).not.toBeNull();
		expect(validateEmail('foo@bar')).not.toBeNull();
	});
	test('rejects empty', () => {
		expect(validateEmail('')).toBe('Introdu un email.');
	});
	test('rejects too long', () => {
		// `validateEmail` rejects strings strictly longer than 255 chars.
		expect(validateEmail('a'.repeat(260) + '@x.ro')).toBe('Email prea lung.');
	});
});

describe('isPersonalEmail', () => {
	test('detects gmail/yahoo/outlook etc', () => {
		expect(isPersonalEmail('foo@gmail.com')).toBe(true);
		expect(isPersonalEmail('user@yahoo.ro')).toBe(true);
		expect(isPersonalEmail('user@protonmail.com')).toBe(true);
	});
	test('returns false for corporate domains', () => {
		expect(isPersonalEmail('contact@firma.ro')).toBe(false);
		expect(isPersonalEmail('admin@onetopsolution.ro')).toBe(false);
	});
});

describe('scorePassword', () => {
	test('returns level 0 for empty', () => {
		const s = scorePassword('');
		expect(s.level).toBe(0);
		expect(s.score).toBe(0);
	});
	test('short passwords land in slab', () => {
		expect(scorePassword('abc').level).toBeLessThanOrEqual(1);
	});
	test('long mixed passwords reach excelent', () => {
		const s = scorePassword('SuperSecure!Password2024Z');
		expect(s.level).toBe(4);
		expect(s.label).toBe('excelent');
	});
	test('repeated chars penalty applies', () => {
		const a = scorePassword('Abcdef1!').score;
		const b = scorePassword('Aaaaaa1!').score;
		expect(b).toBeLessThan(a);
	});
});

describe('normalizeCui', () => {
	test('strips RO prefix and uppercases', () => {
		expect(normalizeCui('ro12345678')).toBe('12345678');
		expect(normalizeCui('  RO 12345678 ')).toBe('12345678');
	});
	test('leaves bare digits alone', () => {
		expect(normalizeCui('12345678')).toBe('12345678');
	});
});

describe('validateCuiFormat', () => {
	test('accepts 2-12 digits', () => {
		expect(validateCuiFormat('39988493')).toBeNull();
		expect(validateCuiFormat('RO39988493')).toBeNull();
		expect(validateCuiFormat('12')).toBeNull();
	});
	test('rejects empty', () => {
		expect(validateCuiFormat('')).toBe('Introdu CUI-ul firmei.');
	});
	test('rejects letters', () => {
		expect(validateCuiFormat('ABC123')).not.toBeNull();
	});
});

describe('normalizeRegCom', () => {
	test('uppercases and strips whitespace', () => {
		expect(normalizeRegCom('  j33/1520/2018 ')).toBe('J33/1520/2018');
		expect(normalizeRegCom('J 33 / 1520 / 2018')).toBe('J33/1520/2018');
	});
});

describe('validateRegCom', () => {
	test('accepts J prefix (commercial)', () => {
		expect(validateRegCom('J33/1520/2018')).toBeNull();
		expect(validateRegCom('J40/123/2018')).toBeNull();
	});
	test('accepts F prefix (associations)', () => {
		expect(validateRegCom('F40/123/2020')).toBeNull();
	});
	test('accepts C prefix (cooperatives)', () => {
		expect(validateRegCom('C40/1/2010')).toBeNull();
	});
	test('rejects other prefixes', () => {
		expect(validateRegCom('M40/123/2018')).not.toBeNull();
		expect(validateRegCom('X40/123/2018')).not.toBeNull();
	});
	test('accepts compact numeric form (no slashes)', () => {
		expect(validateRegCom('J2021001800334')).toBeNull();
		expect(validateRegCom('F202100180033')).toBeNull();
		expect(validateRegCom('C202100180033')).toBeNull();
	});
	test('rejects malformed', () => {
		expect(validateRegCom('J40-123-2018')).not.toBeNull();
		expect(validateRegCom('J40/123')).not.toBeNull();
		// Compact: too short / too long
		expect(validateRegCom('J123456789')).not.toBeNull();
		expect(validateRegCom('J1234567890123456')).not.toBeNull();
	});
});

describe('checkPhone', () => {
	test('RO mobile various formats', () => {
		expect(checkPhone('0721234567').kind).toBe('ro-mobile');
		expect(checkPhone('+40721234567').kind).toBe('ro-mobile');
		expect(checkPhone('0040721234567').kind).toBe('ro-mobile');
		expect(checkPhone('0721 234 567').kind).toBe('ro-mobile');
		expect(checkPhone('07-21-23-45-67').kind).toBe('ro-mobile');
	});
	test('RO mobile normalized display', () => {
		expect(checkPhone('0721234567').display).toBe('+40 721 234 567');
	});
	test('RO landline', () => {
		// București landline 021 + 7 digits = 10 digits total = 7 digits after stripping leading 0+area
		// Format: 0 21 xxx xxxx -> after dropping 0: 21xxxxxxx (9 digits)
		// Regex: /^(?:40)?(?:2\d|3\d)\d{7}$/ — area '21' (2 chars) + 7 chars = 9 total
		const c = checkPhone('0212345678');
		expect(c.kind).toBe('ro-landline');
	});
	test('international with +', () => {
		const c = checkPhone('+34612345678');
		expect(c.kind).toBe('international');
		expect(c.display).toBe('+34612345678');
	});
	test('rejects all-identical digits (fake)', () => {
		expect(checkPhone('+11111111111').kind).toBe('invalid');
		expect(checkPhone('0777777777').kind).toBe('invalid');
	});
	test('rejects too short', () => {
		expect(checkPhone('+12345').kind).toBe('invalid');
		expect(checkPhone('123').kind).toBe('invalid');
	});
	test('rejects empty', () => {
		expect(checkPhone('').kind).toBe('invalid');
	});
});

describe('validatePhone', () => {
	test('returns null on valid', () => {
		expect(validatePhone('0721234567')).toBeNull();
		expect(validatePhone('+34612345678')).toBeNull();
	});
	test('returns error on empty', () => {
		expect(validatePhone('')).toContain('Introdu');
	});
	test('returns error on garbage', () => {
		expect(validatePhone('xyz123')).not.toBeNull();
	});
});

describe('validatePostal', () => {
	test('RO 6-digit accepted', () => {
		expect(validatePostal('720117', { countryHint: 'RO' })).toBeNull();
		expect(validatePostal('010101', { countryHint: 'RO' })).toBeNull();
	});
	test('RO non-6-digit rejected', () => {
		expect(validatePostal('12345', { countryHint: 'RO' })).not.toBeNull();
		expect(validatePostal('AB1234', { countryHint: 'RO' })).not.toBeNull();
	});
	test('foreign tolerant accepts UK postal', () => {
		expect(validatePostal('SW1A 1AA', { countryHint: 'foreign' })).toBeNull();
		expect(validatePostal('10115', { countryHint: 'foreign' })).toBeNull();
	});
	test('empty is allowed (optional)', () => {
		expect(validatePostal('', { countryHint: 'RO' })).toBeNull();
	});
});
