/**
 * Regression tests for the "DA said why, staff saw nothing" failure.
 *
 * On 2026-09-16 `suspendHostingAccount` failed against Server1 with DA's login
 * payload (`401 {"error":"Not logged in","success":"no"}`). The remote threw a
 * bare `Error`, `handleError` redacted it to "A aparut o eroare interna.", and
 * because SvelteKit's client-side `HttpError` is not an `Error` instance the
 * panel's `e instanceof Error ? e.message : 'Eroare suspendare'` toast printed
 * only its fallback. The DA message must survive to the operator, classified as
 * an authentication refusal (NOT `access_denied` — DA words it as a login
 * failure even when the credential is valid for other endpoints).
 */

import { describe, it, expect } from 'bun:test';
import { DirectAdminApiError, classifyDaError } from '../client';
import { daErrorDetails } from '../error-message';

describe('classifyDaError — not_authenticated', () => {
	it('recunoaște răspunsul handler-ului de login DA', () => {
		expect(classifyDaError('Not logged in')).toBe('not_authenticated');
		// Legacy shape: `details=Unauthorized&error=1&text=Not+logged+in`, joined
		// by request() as "text — details".
		expect(classifyDaError('Not logged in — Unauthorized')).toBe('not_authenticated');
	});

	it('prinde și mesajele despre login key sau sesiune expirată', () => {
		expect(classifyDaError('Login key does not allow this command')).toBe('not_authenticated');
		expect(classifyDaError('Session expired')).toBe('not_authenticated');
	});

	it('nu fură clasificările existente', () => {
		expect(classifyDaError('Access denied')).toBe('access_denied');
		expect(classifyDaError('Username already exists')).toBe('username_exists');
		expect(classifyDaError('A valid IP was not provided')).toBe('ip_unavailable');
	});
});

describe('daErrorDetails', () => {
	it('păstrează mesajul DA și adaugă indicația de login key', () => {
		const err = new DirectAdminApiError('Not logged in', 401, 'da_legacy_error');
		const { status, message, kind } = daErrorDetails(err, 'Suspendarea a eșuat.');

		expect(kind).toBe('not_authenticated');
		expect(status).toBe(502);
		expect(message).toContain('Suspendarea a eșuat.');
		expect(message).toContain('DirectAdmin: Not logged in');
		expect(message).toContain('Login Keys');
	});

	it('clasifică după mesaj și pentru Error simplu (fără DirectAdminApiError)', () => {
		const { kind, message } = daErrorDetails(new Error('Not logged in'), 'X');
		expect(kind).toBe('not_authenticated');
		expect(message).toContain('DirectAdmin: Not logged in');
	});

	it('eșec DA cunoscut (pachet lipsă) → 409, nu 502', () => {
		const err = new DirectAdminApiError('No such package', 200, 'da_legacy_error');
		const { status, kind } = daErrorDetails(err, 'X');
		expect(kind).toBe('package_missing');
		expect(status).toBe(409);
	});

	it('valoare aruncată care nu e Error → doar fallback-ul, fără „DirectAdmin:”', () => {
		const { status, message, kind } = daErrorDetails('boom', 'Suspendarea a eșuat.');
		expect(kind).toBe('unknown');
		expect(status).toBe(502);
		expect(message).toBe('Suspendarea a eșuat.');
	});
});
