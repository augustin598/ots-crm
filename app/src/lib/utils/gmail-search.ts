/**
 * Helperi puri pentru tabul „Căutare Gmail” din facturile de furnizor.
 *
 * Stau în afara componentei ca să poată fi testați cu `bun test` — componenta
 * conținea aceeași logică inline, unde nu ajungea niciun test.
 */

/**
 * Plafonul de emailuri pe care le acceptă endpointul ZIP într-o singură cerere.
 *
 * DUPLICAT INTENȚIONAT al lui `MAX_ITEMS` din
 * `src/routes/[tenant]/banking/supplier-invoices/download-gmail-zip/+server.ts`:
 * un `+server.ts` nu poate fi importat din cod de client (ar trage tot serverul în
 * bundle). Dacă se schimbă acolo, se schimbă și aici — UI-ul sparge selecția în
 * tranșe de exact atâtea emailuri, ca să nu primească 400 „Prea multe selectate”.
 */
export const MAX_ZIP_ITEMS = 100;

/**
 * Câte mesaje Gmail scanează potrivirea din modul „Documente lipsă”.
 *
 * SURSĂ UNICĂ: `matchMissingDocuments` din `$lib/remotes/supplier-invoices.remote.ts`
 * o folosește la `searchEmails(...)` și o întoarce în răspuns, iar
 * `MissingDocsMode.svelte` o afișează. Fereastra de căutare e min→max data plăților
 * ±10 zile (~50 de zile pentru un export lunar), deci plafonul chiar se atinge: fără
 * avertismentul din UI, o factură rămasă dincolo de el ar arăta identic cu un document
 * care chiar lipsește.
 */
export const MISSING_DOCS_SCAN_LIMIT = 200;

/** Câmpurile unei plăți de care depinde numele fișierului descărcat. */
export interface PaymentLabelInput {
	reference: string;
	partner: string | null;
	comment: string;
	amountRon: number;
	originalAmount: number | null;
	originalCurrency: string | null;
}

/**
 * Cuvinte care nu sunt niciodată numele comerciantului în descrierea bancară.
 *
 * DUPLICAT INTENȚIONAT al lui `MERCHANT_STOPWORDS` din
 * `$lib/server/banking/payment-match.ts` (modul de server, nu poate fi importat de
 * client). Lista de acolo e sursa de adevăr pentru POTRIVIRE; aici e folosită doar
 * pentru NUMELE fișierului descărcat. Ține-le sincronizate: o divergență nu strică
 * potrivirea, dar produce prefixuri greșite în arhivă („MPY” în loc de „KESSELRING”).
 */
const LABEL_STOPWORDS = new Set([
	'PLATA',
	'CARD',
	'VISA',
	'EPOS',
	'NON',
	'TID',
	'RRN',
	'REF',
	'MID',
	'ORDER',
	'VALOARE',
	'TRANZACTIE',
	'COMISION',
	'TRZ',
	'POS',
	'RON',
	'EUR',
	'USD',
	'GBP',
	'INVOICE',
	'FACTURA',
	'PAYMENT',
	'ONLINE',
	'GMBH',
	'SRL',
	'INC',
	'LTD',
	'LIMITED',
	'TECHNOLOGIES',
	'COM',
	'WWW',
	'NOREPLY',
	'BILLING',
	'MPY'
]);

/** Lungimea minimă a unui token de comerciant (aceeași ca pe server). */
const MIN_MERCHANT_TOKEN_LENGTH = 5;

/**
 * Numele scurt al comerciantului, pentru numele fișierului descărcat.
 * Aceeași euristică precum `merchantTokens` de pe server: aruncăm întâi tokenii
 * bruți care conțin cifre (coduri bancare: RRN, TID, referințe), abia apoi spargem
 * pe caractere non-alfabetice.
 */
export function merchantShort(payment: PaymentLabelInput): string {
	const fromPartner = (payment.partner || '').replace(/[^a-zA-Z0-9]+/g, '').toUpperCase();
	if (fromPartner.length >= 3) return fromPartner.slice(0, 20);
	const token = (payment.comment || '')
		.toUpperCase()
		.split(/\s+/)
		.filter((raw) => !/\d/.test(raw))
		.flatMap((raw) => raw.split(/[^A-Z]+/))
		.find((word) => word.length >= MIN_MERCHANT_TOKEN_LENGTH && !LABEL_STOPWORDS.has(word));
	return token ? token.slice(0, 20) : 'FURNIZOR';
}

/** Prefixul fișierului din ZIP: referință + comerciant + suma (mereu cu valută). */
export function paymentLabel(payment: PaymentLabelInput): string {
	const amount =
		payment.originalAmount != null && payment.originalCurrency
			? `${(payment.originalAmount / 100).toFixed(2)}${payment.originalCurrency}`
			: `${(payment.amountRon / 100).toFixed(2)}RON`;
	return `${payment.reference}_${merchantShort(payment)}_${amount}`;
}

/**
 * Acord corect la numeral în română: 1 → singular, 2–19 → plural simplu,
 * de la 20 în sus (și la multiplii de 100) → plural cu „de”.
 * Ex.: „1 plată”, „3 plăți”, „21 de plăți”, „101 plăți”, „100 de plăți”.
 */
export function pluralRo(count: number, singular: string, plural: string): string {
	const abs = Math.abs(count);
	if (abs === 1) return `${count} ${singular}`;
	const lastTwo = abs % 100;
	const needsDe = abs !== 0 && (lastTwo === 0 || lastTwo >= 20);
	return needsDe ? `${count} de ${plural}` : `${count} ${plural}`;
}

/** Data în format ISO local (YYYY-MM-DD), fără drumul prin UTC. */
export function toIsoDate(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Ziua următoare unei date ISO. Necesară fiindcă operatorul `before:` al Gmail e
 * EXCLUSIV: pentru a include și 31 iulie în rezultate trebuie cerut `before:2026/8/1`.
 * Fără asta, facturile sosite în ultima zi a lunii (abonamentele!) nu apar niciodată.
 * O valoare neinterpretabilă se întoarce neschimbată — nu inventăm interval.
 */
export function nextDayIso(iso: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
	if (!m) return iso;
	const [, year, month, day] = m;
	// Constructorul normalizează depășirile de lună/an (31 dec + 1 = 1 ian)
	return toIsoDate(new Date(Number(year), Number(month) - 1, Number(day) + 1));
}

/**
 * Luna calendaristică ANTERIOARĂ, derivată din data curentă (niciodată hardcodată):
 * fluxul e lunar, facturile lunii trecute se urcă în Keez la începutul lunii curente.
 */
export function previousMonthRange(now: Date = new Date()): { from: string; to: string } {
	const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
	const last = new Date(now.getFullYear(), now.getMonth(), 0);
	return { from: toIsoDate(first), to: toIsoDate(last) };
}

// ---- Excluderi de expeditori ----

/**
 * Sugestiile de excludere oferite în UI.
 *
 * DUPLICAT INTENȚIONAT al lui `SUGGESTED_EXCLUDE_PATTERNS` din
 * `$lib/server/gmail/parsers/index.ts`: acela e modul de server (importă toți
 * parserii, deci și clientul Gmail) și n-are ce căuta în bundle-ul de client.
 * Divergența e prinsă de testul „sugestiile sunt identice cu cele de pe server”
 * din `gmail-search.test.ts`, care compară cele două liste.
 */
export const SUGGESTED_EXCLUDE_PATTERNS: string[] = [
	'tiktok.com',
	'facebook.com',
	'facebookmail.com',
	'meta.com',
	'instagram.com',
	'linkedin.com'
];

/** Un domeniu cu cel puțin un punct: etichete alfanumerice legate prin cratime. */
const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
/** Partea dinaintea lui „@” dintr-o adresă. */
const LOCAL_PART_PATTERN = /^[a-z0-9._%+-]+$/;

export type ExcludePatternResult =
	| { ok: true; pattern: string }
	| { ok: false; error: string };

/**
 * Validează un tipar scris de utilizator și îl aduce la forma stocată (trim +
 * minuscule), la fel ca `normalizeExcludePatterns` de pe server.
 *
 * Forme acceptate: `domeniu.com` (și subdomeniile lui), `@domeniu.com`,
 * `user@domeniu.com`.
 */
export function normalizeExcludePattern(raw: string): ExcludePatternResult {
	const pattern = raw.trim().toLowerCase();
	if (!pattern) {
		return { ok: false, error: 'Scrie un domeniu sau o adresă, de exemplu „tiktok.com”.' };
	}
	if (/\s/.test(pattern)) {
		return { ok: false, error: 'Tiparul nu poate conține spații — adaugă expeditorii pe rând.' };
	}
	if (pattern.indexOf('@') !== pattern.lastIndexOf('@')) {
		return { ok: false, error: 'Tiparul poate conține un singur „@”.' };
	}
	const at = pattern.indexOf('@');
	const local = at > 0 ? pattern.slice(0, at) : '';
	const domain = at === -1 ? pattern : pattern.slice(at + 1);
	if (at > 0 && !LOCAL_PART_PATTERN.test(local)) {
		return { ok: false, error: 'Partea dinaintea lui „@” conține caractere nepermise.' };
	}
	if (!DOMAIN_PATTERN.test(domain)) {
		return {
			ok: false,
			error:
				'Domeniul trebuie să arate ca „tiktok.com”: litere, cifre sau cratime și cel puțin un punct.'
		};
	}
	return { ok: true, pattern };
}

/**
 * Adaugă un tipar la listă, cu validare și fără duplicate. Întoarce lista NOUĂ —
 * nu mutăm niciodată lista primită (starea din componentă se reasignează).
 */
export function addExcludePattern(
	current: string[],
	raw: string
): { ok: true; patterns: string[] } | { ok: false; error: string } {
	const result = normalizeExcludePattern(raw);
	if (!result.ok) return result;
	if (current.some((existing) => existing.toLowerCase() === result.pattern)) {
		return { ok: false, error: `„${result.pattern}” e deja în listă.` };
	}
	return { ok: true, patterns: [...current, result.pattern] };
}

/**
 * Sugestiile pe care lista curentă nu le acoperă încă. `tiktok.com` e considerat
 * acoperit și de `@tiktok.com`: ambele opresc același expeditor, iar a-l oferi din
 * nou ar produce o a doua intrare fără efect.
 */
export function suggestedExclusionsToAdd(current: string[]): string[] {
	const used = new Set(current.map((pattern) => pattern.trim().toLowerCase().replace(/^@/, '')));
	return SUGGESTED_EXCLUDE_PATTERNS.filter((suggestion) => !used.has(suggestion));
}

/**
 * Fișierul tras peste zona de încărcare e exportul XLSX din Keez?
 * Verificăm extensia, nu doar `type`: în drag & drop din unele surse (arhive,
 * Outlook) MIME-ul ajunge gol sau `application/octet-stream`.
 */
export function isXlsxFile(file: { name: string; type?: string }): boolean {
	if (file.name.toLowerCase().endsWith('.xlsx')) return true;
	return file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

// ---- Erori Gmail văzute din client ----

/**
 * Statusul HTTP al unei erori remote/fetch, când există.
 *
 * `svelteError(status, mesaj)` de pe server ajunge pe client ca `HttpError`, care NU
 * e `instanceof Error`, dar poartă `status` și `body.message` — vezi `remoteErrorMessage`.
 */
export function errorStatus(err: unknown): number | undefined {
	const status = (err as { status?: unknown } | null)?.status;
	return typeof status === 'number' ? status : undefined;
}

/**
 * Autorizarea Gmail a expirat sau contul nu e conectat?
 *
 * 409 e statusul pe care `mapGmailError` ($lib/server/gmail/errors.ts) îl dă acestui
 * caz, iar comenzile remote de căutare îl rearuncă prin `svelteError`. Verificarea pe
 * text rămâne ca plasă de siguranță pentru erorile care nu trec prin acea traducere.
 */
export function isGmailAuthError(err: unknown, message: string): boolean {
	return errorStatus(err) === 409 || /reconect|nu este conectat|not connected/i.test(message);
}

/** Sparge o listă în felii de cel mult `size` elemente (selecția → tranșe ZIP). */
export function chunk<T>(items: T[], size: number): T[][] {
	if (size <= 0) return [items];
	const batches: T[][] = [];
	for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
	return batches;
}

/**
 * Numele arhivei pentru o tranșă. Când selecția depășește plafonul, browserul ar
 * primi mai multe fișiere cu ACELAȘI nume (și le-ar sufixa „(1)”, „(2)” fără să se
 * înțeleagă ordinea) — numerotăm noi tranșele.
 */
export function batchArchiveName(baseName: string, index: number, total: number): string {
	if (total <= 1) return baseName;
	const dot = baseName.lastIndexOf('.');
	const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
	const ext = dot > 0 ? baseName.slice(dot) : '';
	return `${stem}-parte${index + 1}-din-${total}${ext}`;
}
