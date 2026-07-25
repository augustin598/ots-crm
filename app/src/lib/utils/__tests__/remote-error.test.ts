import { describe, it, expect } from 'bun:test';
import { remoteErrorMessage } from '../remote-error';

describe('remoteErrorMessage', () => {
	it('extrage mesajul din HttpError-ul SvelteKit (e.body.message, NU instanceof Error)', () => {
		// forma exactă aruncată de clientul remote functions la svelteError(status, msg)
		const httpError = { status: 500, body: { message: 'Claude a răspuns 429 …' } };
		expect(remoteErrorMessage(httpError, 'fallback')).toBe('Claude a răspuns 429 …');
	});

	it('extrage mesajul din Error clasic', () => {
		expect(remoteErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
	});

	it('fallback pentru forme necunoscute sau mesaje goale', () => {
		expect(remoteErrorMessage(null, 'fallback')).toBe('fallback');
		expect(remoteErrorMessage('string', 'fallback')).toBe('fallback');
		expect(remoteErrorMessage({ body: { message: '' } }, 'fallback')).toBe('fallback');
		expect(remoteErrorMessage(new Error(''), 'fallback')).toBe('fallback');
	});

	it('body.message non-string nu aruncă', () => {
		expect(remoteErrorMessage({ body: { message: 42 } }, 'fallback')).toBe('fallback');
	});
});
