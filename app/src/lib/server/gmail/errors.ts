/**
 * Traducerea erorilor Gmail în statusuri HTTP utile.
 *
 * Fără asta orice problemă (token revocat, email șters, Gmail picat) iese ca 500
 * opac — iar `gmail-attachment` e un GET pe care îl deschide direct browserul, deci
 * userul ar primi pagina de eroare HTML a SvelteKit în loc de fișier.
 */

export type GmailFailureKind = 'not-connected' | 'not-found' | 'upstream';

export interface MappedGmailError {
	status: 409 | 404 | 502;
	message: string;
	kind: GmailFailureKind;
}

const MESSAGES: Record<GmailFailureKind, string> = {
	'not-connected':
		'Contul Gmail nu este conectat sau autorizarea a expirat. Reconectează-l din Setări → Integrări.',
	'not-found': 'Emailul nu mai există în Gmail (a fost șters sau mutat).',
	upstream: 'Gmail nu a răspuns la timp. Încearcă din nou peste câteva momente.'
};

type ErrorLike = Record<string, unknown> & {
	message?: unknown;
	code?: unknown;
	status?: unknown;
	response?: { status?: unknown; data?: { error?: unknown; error_description?: unknown } };
	errors?: Array<{ reason?: unknown; message?: unknown }>;
};

/** Statusul HTTP raportat de googleapis/Gaxios, în oricare din formele lui. */
function httpStatusOf(err: ErrorLike): number | null {
	for (const raw of [err?.response?.status, err?.status, err?.code]) {
		const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
		if (Number.isInteger(n) && n >= 100 && n < 600) return n;
	}
	return null;
}

/** Toate stringurile utile din eroare, concatenate și lowercase. */
function haystackOf(err: ErrorLike): string {
	const parts: unknown[] = [
		err?.message,
		err?.code,
		err?.response?.data?.error,
		err?.response?.data?.error_description
	];
	if (Array.isArray(err?.errors)) {
		for (const e of err.errors) parts.push(e?.reason, e?.message);
	}
	return parts.filter((p) => typeof p === 'string').join(' ').toLowerCase();
}

const AUTH_MARKERS = [
	'gmail not connected',
	'invalid_grant',
	'invalid credentials',
	'invalid_credentials',
	'token has been expired or revoked',
	'insufficientpermissions',
	'insufficient permission',
	'unauthorized_client'
];

const NOT_FOUND_MARKERS = ['requested entity was not found', 'failed to find message'];

/**
 * Traduce orice eroare venită din `$lib/server/gmail/client` într-un status HTTP
 * și un mesaj în română, potrivit pentru `error(status, message)`.
 */
export function mapGmailError(err: unknown): MappedGmailError {
	const e = (typeof err === 'object' && err !== null ? err : {}) as ErrorLike;
	const text = haystackOf(e);
	const status = httpStatusOf(e);

	if (AUTH_MARKERS.some((m) => text.includes(m)) || status === 401) {
		return { status: 409, message: MESSAGES['not-connected'], kind: 'not-connected' };
	}

	if (status === 404 || NOT_FOUND_MARKERS.some((m) => text.includes(m))) {
		return { status: 404, message: MESSAGES['not-found'], kind: 'not-found' };
	}

	return { status: 502, message: MESSAGES.upstream, kind: 'upstream' };
}
