// Match algorithm between bank payments (Keez "Documente Lipsa" export) and
// supplier invoices found in Gmail. Pure module — no DB, no network — for testability.

export interface PaymentRow {
	reference: string; // Referinta Keez
	date: Date;
	partner: string | null;
	amountRon: number; // cents, coloana Valoare (mereu RON) — semnal secundar
	comment: string;
	originalAmount: number | null; // cents, din "valoare tranzactie: X CUR" — semnal PRINCIPAL
	originalCurrency: string | null;
}

export interface InvoiceCandidate {
	gmailMessageId: string;
	from: string;
	subject: string;
	date: Date;
	amount?: number; // cents
	currency?: string;
	supplierType?: string;
}

export interface PaymentMatchResult extends PaymentRow {
	match?: InvoiceCandidate;
	score: number;
	confidence: 'sure' | 'probable' | 'none';
}

// Merchant tokens as they appear in BT statement descriptions, keyed by supplierType
const MERCHANT_ALIASES: Record<string, string[]> = {
	hetzner: ['HETZNER'],
	google: ['GOOGLE CLOUD', 'GOOGLE WORKSPACE', 'GOOGLE*', 'GOOGLE '],
	directadmin: ['DIRECTADMIN'],
	litespeed: ['LITESPEED', 'LITE SPEED'],
	anthropic: ['CLAUDE SUB', 'ANTHROPIC', 'CLAUDE.AI'],
	cursor: ['CURSOR', 'ANYSPHERE'],
	inwx: ['INWX'],
	openai: ['OPENAI', 'CHATGPT'],
	// Bucket GENERIC: ro-suppliers.ts pune acest tip pe TOȚI furnizorii români, deci
	// apartenența la bucket nu spune CARE furnizor e — vezi GENERIC_ALIAS_BUCKET.
	'ro-supplier': ['ROTLD', 'KESSELRING', 'FIDASOLUTIONS'],
	cloudflare: ['CLOUDFLARE'],
	digitalocean: ['DIGITALOCEAN'],
	ovh: ['OVH'],
	aws: ['AWS', 'AMAZON WEB'],
	tiktok: ['TIKTOK'],
	meta: ['FACEBOOK', 'META PLATFORMS', 'FACEBK']
};

const MATCH_WINDOW_DAYS = 10;
export const SURE_THRESHOLD = 70;
export const PROBABLE_THRESHOLD = 40;

/**
 * Un SINGUR parser zecimal pentru tot modulul (coloana Valoare și „valoare tranzactie").
 * Aceeași regulă ca în gmail/pdf-parser.ts: când apar ambii separatori, ULTIMUL e cel
 * zecimal — acoperă atât „1.234,56" (european) cât și „1,234.56" (american).
 * Returnează bani (cents) sau null.
 */
export function parseDecimalToCents(raw: string): number | null {
	let s = raw.trim();
	if (!s) return null;
	const hasComma = s.includes(',');
	const hasDot = s.includes('.');
	if (hasComma && hasDot) {
		s =
			s.lastIndexOf(',') > s.lastIndexOf('.')
				? s.replace(/\./g, '').replace(',', '.')
				: s.replace(/,/g, '');
	} else if (hasComma) {
		s = s.replace(',', '.');
	}
	const amount = Math.round(parseFloat(s) * 100);
	return isNaN(amount) ? null : amount;
}

export function extractPaymentDetails(comment: string): {
	originalAmount: number | null;
	originalCurrency: string | null;
} {
	const m = comment.match(/valoare\s+(?:tranzactie|trz):\s*([\d.,]+)\s*(RON|EUR|USD|GBP)/i);
	if (!m) return { originalAmount: null, originalCurrency: null };
	const amount = parseDecimalToCents(m[1]);
	if (amount === null) return { originalAmount: null, originalCurrency: null };
	return { originalAmount: amount, originalCurrency: m[2].toUpperCase() };
}

/** Excel 1900 date system: serial 1 = 1900-01-01, offset epoch 1899-12-30. */
function excelSerialToDate(serial: number): Date {
	return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
}

function parseRonValue(v: string | number): number {
	if (typeof v === 'number') return Math.round(v * 100);
	return parseDecimalToCents(v) ?? 0;
}

export function parseMissingDocumentsRows(rows: unknown[][]): {
	payments: PaymentRow[];
	ignoredIncomes: number;
	/** Rânduri cu dată neinterpretabilă: rămân în listă, dar nu pot fi matchuite. */
	invalidDates: number;
} {
	const payments: PaymentRow[] = [];
	let ignoredIncomes = 0;
	let invalidDates = 0;
	for (const row of rows) {
		const [tip, referinta, dataSerial, partener, valoare, , comentariu] = row as [
			string,
			string | number,
			number | string,
			string | null,
			string | number,
			string,
			string
		];
		if (typeof tip !== 'string') continue; // header / rânduri goale
		if (tip.trim() === 'Incasari fara document') {
			ignoredIncomes++;
			continue;
		}
		if (tip.trim() !== 'Plati fara document') continue;
		const comment = String(comentariu ?? '');
		const { originalAmount, originalCurrency } = extractPaymentDetails(comment);
		const date =
			typeof dataSerial === 'number' ? excelSerialToDate(dataSerial) : new Date(String(dataSerial));
		// Un export cu date text („16.07.2026") produce Invalid Date; fără numărătoare ar
		// trece tăcut mai departe, iar garda de fereastră nu se declanșează (NaN > 10 = false).
		if (isNaN(date.getTime())) invalidDates++;
		payments.push({
			reference: String(referinta ?? ''),
			date,
			partner: partener ? String(partener) : null,
			amountRon: parseRonValue(valoare ?? 0),
			comment,
			originalAmount,
			originalCurrency
		});
	}
	return { payments, ignoredIncomes, invalidDates };
}

function daysBetween(a: Date, b: Date): number {
	return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

/** Words in statement descriptions that are never a merchant name. */
const MERCHANT_STOPWORDS = new Set([
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

/** Lungimea minimă a unui token de comerciant folosit ca semnal de rezervă. */
const MIN_MERCHANT_TOKEN_LENGTH = 5;

/**
 * Merchant tokens extracted from the statement description, for suppliers that
 * have no parser (and therefore no alias entry): "MPY*KESSELRING SRL" -> KESSELRING.
 *
 * Codurile bancare (REF, RRN, TID, coduri de autorizare) sunt alfanumerice: dacă le-am
 * sparge direct pe caractere non-alfabetice ar rămâne fragmente pur alfabetice —
 * „000NVPO261975UOO" -> NVPO, „TID:G0A3LMSE" -> LMSE — care nu au nicio legătură cu
 * comerciantul. NVPO e chiar prefixul de referință BT, deci apare în ORICE plată cu
 * cardul și ar produce match-uri false pe orice expeditor care îl conține întâmplător.
 * De aceea aruncăm întâi orice token brut (delimitat de spații) care conține o cifră.
 */
export function merchantTokens(payment: PaymentRow): string[] {
	const source = (payment.comment + ' ' + (payment.partner || '')).toUpperCase();
	const words = source
		.split(/\s+/)
		.filter((raw) => !/\d/.test(raw)) // afară codurile bancare, înainte de spargere
		.flatMap((raw) => raw.split(/[^A-Z]+/));
	return [...new Set(words)].filter(
		(w) => w.length >= MIN_MERCHANT_TOKEN_LENGTH && !MERCHANT_STOPWORDS.has(w)
	);
}

/**
 * Tipuri care NU identifică un furnizor anume, ci o categorie întreagă. Pentru ele,
 * aliasul trebuie să apară în AMBELE părți (extras + emailul candidat), altfel o plată
 * la KESSELRING ar „confirma" o factură FIDASOLUTIONS doar fiindcă ambele sunt românești.
 */
const GENERIC_ALIAS_BUCKETS = new Set(['ro-supplier']);

/** Tokenii sunt garantat [A-Z]+, deci pot fi interpolați direct în regex. */
function containsWord(haystack: string, word: string): boolean {
	return new RegExp(`\\b${word}\\b`).test(haystack);
}

function merchantMatches(payment: PaymentRow, candidate: InvoiceCandidate): boolean {
	const haystack = (payment.comment + ' ' + (payment.partner || '')).toUpperCase();
	const emailHaystack = `${candidate.from} ${candidate.subject}`.toUpperCase();
	const supplierType = candidate.supplierType || '';
	const aliases = MERCHANT_ALIASES[supplierType];
	if (
		aliases?.some(
			(a) =>
				haystack.includes(a) &&
				(!GENERIC_ALIAS_BUCKETS.has(supplierType) || emailHaystack.includes(a.trim()))
		)
	) {
		return true;
	}

	// Fallback for senders without a parser: does a merchant token from the statement
	// appear as a WHOLE WORD in the sender address or subject? Substring matching would
	// let „CARTON" match „SCARTONIS".
	return merchantTokens(payment).some((token) => containsWord(emailHaystack, token));
}

export interface MatchScore {
	score: number;
	/** Dacă există dovadă că factura vine de la comerciantul plății (cerută pentru 'sure'). */
	merchantMatched: boolean;
}

export function scoreMatch(payment: PaymentRow, candidate: InvoiceCandidate): MatchScore {
	const days = daysBetween(payment.date, candidate.date);
	// isNaN prinde datele invalide: `NaN > MATCH_WINDOW_DAYS` e false, deci fără verificare
	// explicită o plată cu dată coruptă ar trece de fereastră și ar aduna scor NaN.
	if (isNaN(days) || days > MATCH_WINDOW_DAYS) return { score: 0, merchantMatched: false };
	let score = 0;
	// Semnal principal: suma + valuta ORIGINALĂ a tranzacției (NU valoarea în RON —
	// contul e în lei, facturile sunt adesea în EUR/USD)
	if (
		payment.originalAmount != null &&
		payment.originalCurrency != null &&
		candidate.amount != null &&
		candidate.currency === payment.originalCurrency
	) {
		if (candidate.amount === payment.originalAmount) score += 60;
		else if (Math.abs(candidate.amount - payment.originalAmount) / payment.originalAmount <= 0.02)
			score += 40;
	}
	// Comerciantul singur trebuie să treacă pragul „probabil" (40), chiar și fără sumă
	const merchantMatched = merchantMatches(payment, candidate);
	if (merchantMatched) score += 40;
	score += Math.max(0, Math.round(10 * (1 - days / MATCH_WINDOW_DAYS)));
	return { score, merchantMatched };
}

interface Pair {
	pi: number;
	ci: number;
	score: number;
	merchantMatched: boolean;
	days: number;
}

/**
 * Atribuire unică: întâi greedy (perechi sortate după scor, departajate pe proximitatea
 * datei), apoi un pas de recuperare pentru plățile rămase pe dinafară.
 */
export function matchPayments(
	payments: PaymentRow[],
	candidates: InvoiceCandidate[]
): PaymentMatchResult[] {
	const pairs: Pair[] = [];
	payments.forEach((p, pi) => {
		candidates.forEach((c, ci) => {
			const { score, merchantMatched } = scoreMatch(p, c);
			if (score >= PROBABLE_THRESHOLD) {
				pairs.push({ pi, ci, score, merchantMatched, days: daysBetween(p.date, c.date) });
			}
		});
	});
	pairs.sort((a, b) => b.score - a.score || a.days - b.days);

	const assignment = new Map<number, Pair>();
	const candidateOwner = new Map<number, number>();
	for (const pair of pairs) {
		if (assignment.has(pair.pi) || candidateOwner.has(pair.ci)) continue;
		assignment.set(pair.pi, pair);
		candidateOwner.set(pair.ci, pair.pi);
	}

	// Pas de recuperare: greedy poate lăsa o plată fără nicio factură deși o atribuire
	// mai bună există — dă-i unei plăți nematchuite o factură liberă, iar dacă singura ei
	// factură e ocupată, mută deținătorul pe o factură liberă când totalul crește.
	const pairsFor = (pi: number) => pairs.filter((p) => p.pi === pi);
	for (const pi of payments.map((_, i) => i)) {
		if (assignment.has(pi)) continue;
		for (const pair of pairsFor(pi)) {
			const owner = candidateOwner.get(pair.ci);
			if (owner === undefined) {
				assignment.set(pi, pair);
				candidateOwner.set(pair.ci, pi);
				break;
			}
			const ownerPair = assignment.get(owner);
			const alternative = pairsFor(owner).find((alt) => !candidateOwner.has(alt.ci));
			if (!ownerPair || !alternative) continue;
			if (alternative.score + pair.score <= ownerPair.score) continue;
			assignment.set(owner, alternative);
			candidateOwner.set(alternative.ci, owner);
			assignment.set(pi, pair);
			candidateOwner.set(pair.ci, pi);
			break;
		}
	}

	return payments.map((p, pi) => {
		const a = assignment.get(pi);
		if (!a) return { ...p, score: 0, confidence: 'none' as const };
		// 'sure' cere ȘI dovadă de comerciant: sumă exactă + aceeași zi dau exact 70, iar
		// pe abonamente recurente cu aceeași sumă asta ar eticheta „sigur" factura greșită.
		const confidence =
			a.score >= SURE_THRESHOLD && a.merchantMatched ? ('sure' as const) : ('probable' as const);
		return { ...p, match: candidates[a.ci], score: a.score, confidence };
	});
}
