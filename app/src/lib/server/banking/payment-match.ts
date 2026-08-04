// Match algorithm between bank payments (Keez "Documente Lipsa" export) and
// supplier invoices found in Gmail. Pure module — no DB, no network — for testability.

import { maxWeightMatching } from './assignment';

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

/**
 * Ponderile componentelor de scor. Sunt constante numite, nu literali împrăștiați, fiindcă
 * `MAX_PAIR_SCORE` se DERIVĂ din ele — vezi comentariul de acolo.
 */
const SCORE_AMOUNT_EXACT = 60;
/** Sumă în toleranța de 2% (curs valutar, rotunjiri). */
const SCORE_AMOUNT_NEAR = 40;
const SCORE_MERCHANT = 40;
const SCORE_PROXIMITY_MAX = 10;

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
		if (candidate.amount === payment.originalAmount) score += SCORE_AMOUNT_EXACT;
		else if (Math.abs(candidate.amount - payment.originalAmount) / payment.originalAmount <= 0.02)
			score += SCORE_AMOUNT_NEAR;
	}
	// Comerciantul singur trebuie să treacă pragul „probabil" (40), chiar și fără sumă
	const merchantMatched = merchantMatches(payment, candidate);
	if (merchantMatched) score += SCORE_MERCHANT;
	score += Math.max(0, Math.round(SCORE_PROXIMITY_MAX * (1 - days / MATCH_WINDOW_DAYS)));
	return { score, merchantMatched };
}

export interface Pair {
	pi: number;
	ci: number;
	score: number;
	merchantMatched: boolean;
	days: number;
}

/**
 * Scorul maxim pe care îl poate întoarce `scoreMatch` — sumă exactă + comerciant +
 * proximitate maximă.
 *
 * DERIVAT, nu hardcodat: separarea nivelurilor din `pairWeights` cere
 * `MAX_PAIR_SCORE >= scorul maxim atins`, iar cele două erau exact egale (110 = 110).
 * Cu o constantă hardcodată, ridicarea oricărei ponderi de mai sus (comerciant 40→50 ⇒
 * maxim 120) rupea TĂCUT dominarea nivelurilor și redeschidea bugul „un match speculativ
 * deposedează unul confirmat", fără ca vreun test să pice. Aici cuplajul e structural.
 */
export const MAX_PAIR_SCORE =
	Math.max(SCORE_AMOUNT_EXACT, SCORE_AMOUNT_NEAR) + SCORE_MERCHANT + SCORE_PROXIMITY_MAX;

/**
 * Plafonul bonusului de departajare (nivelul 4).
 *
 * Varianta anterioară dădea bonusul din RANGUL perechii în lista sortată după dată, deci
 * nivelul costa un factor de `m` = numărul de perechi (până la 22.500 cu plafonul de 150
 * de candidați) în greutatea finală — garda de MAX_SAFE_INTEGER se declanșa deja de la ~87
 * de rânduri de plată, o dimensiune atinsă de un export pe un trimestru.
 *
 * Departajarea trebuie doar să rupă egalitățile determinist, nu să ordoneze întreaga
 * mulțime de perechi: cuantizăm distanța în zecimi de zi, ceea ce dă un plafon CONSTANT,
 * independent de dimensiunea intrării. Perechile din aceeași zecime de zi rămân egale la
 * nivelul 4 și sunt departajate de solver, care e determinist (vezi assignment.ts: la
 * egalitate câștigă coloana cu indicele mai mic).
 */
const TIE_BONUS_CAP = MATCH_WINDOW_DAYS * 10;

/** Bonus de departajare: cu cât data e mai apropiată, cu atât mai mare. [0, TIE_BONUS_CAP] */
function tieBonus(days: number): number {
	const quantized = Math.round(days * 10);
	if (!Number.isFinite(quantized)) return 0;
	return Math.min(TIE_BONUS_CAP, Math.max(0, TIE_BONUS_CAP - quantized));
}

/**
 * Obiectiv lexicografic turtit într-o singură greutate scalară, în ordinea:
 *
 *   1. numărul de match-uri CONFIRMATE DE COMERCIANT
 *   2. suma scorurilor acelor match-uri
 *   3. suma scorurilor match-urilor speculative (doar pe sumă)
 *   4. departajarea (data mai apropiată, cuantizată la zecimi de zi; egalitățile rămase
 *      revin ordinii deterministe a solverului — indicele mai mic de coloană)
 *
 * De ce numărul de match-uri NU e criteriul dominant: dacă ar fi, algoritmul ar rupe un
 * match confirmat de comerciant ca să bifeze încă unul pe simpla coincidență de sumă
 * (110 confirmat → 70 speculativ + 50 confirmat), adică exact eroarea pe care o previne
 * regula „sure cere dovadă de comerciant". Cu tierele de mai sus, un match speculativ e
 * adăugat doar când NU deposedează un match confirmat.
 *
 * De ce NU există un nivel de NUMĂR speculativ între 2 și 3 (adică de ce un match
 * speculativ de 100 bate două de 40+41): un astfel de nivel ar costa un factor de
 * `maxMatches` în greutatea finală, fiindcă unitatea de „număr" trebuie să domine suma
 * scorurilor de sub el. Măsurat: garda de mai jos s-ar declanșa de la 94 de match-uri în
 * loc de 294 — adică sub pragul de AZI (87 de rânduri de plată), exact regresiunea de
 * dimensiune pe care o repară plafonarea departajării. Câștigul ar fi doar cosmetic (nimic
 * nu se ascunde: plățile nepotrivite apar oricum, cu încredere 'none'), deci nu merită marja.
 *
 * De reținut la triaj: adăugarea unui candidat poate REASIGNA o plată fără legătură (B a
 * trecut de la c2 la c3 în timp ce confirmata A→c1 a rămas neatinsă). E inerent unei
 * optimizări globale, e mereu o îmbunătățire a totalului și NU e un bug.
 *
 * Multiplicatorii se derivă din `maxMatches`, ca fiecare nivel să domine exact suma maximă
 * a nivelurilor de sub el. Spre deosebire de varianta inițială, NU mai depind de numărul
 * de perechi: bonusul de departajare e plafonat la `TIE_BONUS_CAP` (vezi acolo).
 */
export function pairWeights(pairs: Pair[], maxMatches: number): number[] {
	const wTie = 1;
	const wSpeculativeScore = maxMatches * TIE_BONUS_CAP * wTie + 1;
	const wMerchantScore = (maxMatches * MAX_PAIR_SCORE + 1) * wSpeculativeScore;
	const wMerchantCount = (maxMatches * MAX_PAIR_SCORE + 1) * wMerchantScore;

	const maxTotal = maxMatches * (wMerchantCount + MAX_PAIR_SCORE * wMerchantScore + TIE_BONUS_CAP);
	if (maxTotal > Number.MAX_SAFE_INTEGER) {
		throw new Error(
			`payment-match: intrare prea mare pentru codificarea exactă a greutăților (${maxMatches} match-uri posibile, ${pairs.length} perechi)`
		);
	}

	return pairs.map((pair) => {
		// Plasă de siguranță pentru cuplajul dintre scoring și codificare: dacă apare o
		// componentă de scor nouă care nu intră în MAX_PAIR_SCORE, nivelurile se suprapun
		// și rezultatul devine tăcut greșit. Mai bine cădem zgomotos.
		if (pair.score > MAX_PAIR_SCORE) {
			throw new Error(
				`payment-match: scor ${pair.score} peste MAX_PAIR_SCORE (${MAX_PAIR_SCORE}) — actualizează constantele de scoring`
			);
		}
		const tie = tieBonus(pair.days);
		return pair.merchantMatched
			? wMerchantCount + pair.score * wMerchantScore + tie
			: pair.score * wSpeculativeScore + tie;
	});
}

/**
 * Asignare optimă plăți ↔ facturi prin potrivire bipartită de greutate maximă.
 * Perechile sub PROBABLE_THRESHOLD sunt neeligibile și nu apar deloc în matrice.
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

	const weights = pairWeights(pairs, Math.min(payments.length, candidates.length));
	const matrix: (number | null)[][] = payments.map(() =>
		new Array<number | null>(candidates.length).fill(null)
	);
	pairs.forEach((pair, index) => {
		matrix[pair.pi][pair.ci] = weights[index];
	});

	const byPosition = new Map<number, Pair>();
	pairs.forEach((pair) => byPosition.set(pair.pi * candidates.length + pair.ci, pair));

	const assignment = maxWeightMatching(matrix);
	return payments.map((p, pi) => {
		const ci = assignment[pi];
		const pair = ci >= 0 ? byPosition.get(pi * candidates.length + ci) : undefined;
		if (!pair) return { ...p, score: 0, confidence: 'none' as const };
		// 'sure' cere ȘI dovadă de comerciant: sumă exactă + aceeași zi dau exact 70, iar
		// pe abonamente recurente cu aceeași sumă asta ar eticheta „sigur" factura greșită.
		const confidence =
			pair.score >= SURE_THRESHOLD && pair.merchantMatched
				? ('sure' as const)
				: ('probable' as const);
		return { ...p, match: candidates[ci], score: pair.score, confidence };
	});
}
