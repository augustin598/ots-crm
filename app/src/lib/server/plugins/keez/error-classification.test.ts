import { describe, expect, test } from 'bun:test';
import { classifyKeezError, isMissingOnKeez } from './error-classification';
import { KeezClientError } from './errors';

describe('classifyKeezError', () => {
	test('KeezClientError 502 → transient', () => {
		expect(classifyKeezError(new KeezClientError('any text', 502))).toBe('transient');
	});

	test('KeezClientError 503 → transient', () => {
		expect(classifyKeezError(new KeezClientError('x', 503))).toBe('transient');
	});

	test('KeezClientError 422 → permanent', () => {
		expect(classifyKeezError(new KeezClientError('validation', 422))).toBe('permanent');
	});

	test('plain Error with 502 in message → transient (fallback path)', () => {
		expect(classifyKeezError(new Error('Keez API error: 502 nginx'))).toBe('transient');
	});

	test('AbortError → transient', () => {
		const e = new Error('aborted');
		e.name = 'AbortError';
		expect(classifyKeezError(e)).toBe('transient');
	});
});

describe('KeezClientError discriminates retry behaviour by status', () => {
	test('400-499 means stop retrying', () => {
		const e = new KeezClientError('bad request', 400);
		expect(e.status < 500).toBe(true);
	});

	test('500-599 means keep retrying', () => {
		const e = new KeezClientError('upstream', 502);
		expect(e.status < 500).toBe(false);
	});
});

describe('isMissingOnKeez', () => {
	test('plain Error("Not found") (the 404 path from client.ts) → true', () => {
		expect(isMissingOnKeez(new Error('Not found'))).toBe(true);
	});

	test('KeezClientError with status 404 → true', () => {
		expect(isMissingOnKeez(new KeezClientError('whatever', 404))).toBe(true);
	});

	test('KeezClientError 400 with VALIDATION_ERROR + "nu exista" → true (the actual Keez signal)', () => {
		const body = '{"Code":"VALIDATION_ERROR","Message":"Erori de validare;Factura (xxx) nu exista!"}';
		expect(isMissingOnKeez(new KeezClientError(`Keez API client error 400: ${body}`, 400))).toBe(true);
	});

	test('KeezClientError 400 with VALIDATION_ERROR + Not Found in inner errors → true', () => {
		const body = '{"Code":"VALIDATION_ERROR","errors":[{"code":"Not Found","message":"x"}]}';
		expect(isMissingOnKeez(new KeezClientError(`Keez API client error 400: ${body}`, 400))).toBe(true);
	});

	test('KeezClientError 400 with VALIDATION_ERROR but no "nu exista" / "Not Found" → false (other validation)', () => {
		const body = '{"Code":"VALIDATION_ERROR","Message":"Camp obligatoriu lipseste"}';
		expect(isMissingOnKeez(new KeezClientError(`Keez API client error 400: ${body}`, 400))).toBe(false);
	});

	test('KeezClientError 400 without VALIDATION_ERROR → false', () => {
		expect(isMissingOnKeez(new KeezClientError('Keez API client error 400: bad', 400))).toBe(false);
	});

	test('KeezClientError 502 → false (transient, not "missing")', () => {
		expect(isMissingOnKeez(new KeezClientError('upstream', 502))).toBe(false);
	});

	test('plain Error with random message → false', () => {
		expect(isMissingOnKeez(new Error('something else'))).toBe(false);
	});

	test('non-Error value → false', () => {
		expect(isMissingOnKeez('string error')).toBe(false);
		expect(isMissingOnKeez(null)).toBe(false);
		expect(isMissingOnKeez(undefined)).toBe(false);
	});
});
