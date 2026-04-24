import { describe, expect, test } from 'bun:test';
import { classifyKeezError } from './error-classification';
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
