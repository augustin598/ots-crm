import { DirectAdminApiError, classifyDaError, type DaErrorKind } from './client';

/**
 * Turn a DirectAdmin failure into a message + HTTP status that a staff member
 * can act on, for `svelteError(status, message)` inside remote functions.
 *
 * Why this exists: remote commands used to throw bare `new Error(daMessage)`.
 * SvelteKit redacts unexpected server errors through `handleError`, so the
 * client only ever received "A aparut o eroare interna." — and because the
 * client-side `HttpError` is not an `Error` instance, the `e instanceof Error`
 * toast pattern fell through to its generic fallback ("Eroare suspendare").
 * Result: DA said "Not logged in" and staff saw nothing. Every DA message worth
 * reading is operator-facing, never secret, so it goes through untouched with a
 * hint attached.
 */

const HINTS: Partial<Record<DaErrorKind, string>> = {
	not_authenticated:
		'DirectAdmin a refuzat autentificarea pentru această comandă (contul de serviciu nu are drept pe ea sau POST-ul e blocat de panou). Verifică login key-ul serverului în DirectAdmin → Login Keys.',
	access_denied:
		'Contul de serviciu DirectAdmin nu are permisiunea necesară (comanda cere admin/reseller).',
	license_restricted: 'Licența DirectAdmin nu permite această operațiune.',
	package_missing: 'Pachetul nu mai există pe DirectAdmin — sincronizează pachetele.',
	ip_unavailable: 'Serverul DirectAdmin nu are IP disponibil pentru această operațiune.'
};

/** DA rejected the call (kind known) → 409; upstream/unknown → 502. */
function statusFor(kind: DaErrorKind): number {
	if (kind === 'not_authenticated' || kind === 'access_denied') return 502;
	if (kind === 'unknown') return 502;
	return 409;
}

export function daErrorDetails(
	err: unknown,
	fallback: string
): { status: number; message: string; kind: DaErrorKind } {
	const raw = err instanceof Error ? err.message.trim() : '';
	const kind = err instanceof DirectAdminApiError ? err.kind : raw ? classifyDaError(raw) : 'unknown';
	const hint = HINTS[kind];
	const parts = [fallback, raw ? `DirectAdmin: ${raw}` : null, hint].filter(
		(s): s is string => !!s
	);
	return { status: statusFor(kind), message: parts.join(' '), kind };
}
