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
	'ro-supplier': ['ROTLD', 'ICI ', 'KESSELRING', 'FIDASOLUTIONS'],
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

export function extractPaymentDetails(comment: string): {
	originalAmount: number | null;
	originalCurrency: string | null;
} {
	const m = comment.match(/valoare\s+(?:tranzactie|trz):\s*([\d.,]+)\s*(RON|EUR|USD|GBP)/i);
	if (!m) return { originalAmount: null, originalCurrency: null };
	const normalized =
		m[1].includes(',') && !m[1].includes('.') ? m[1].replace(',', '.') : m[1].replace(/,/g, '');
	const amount = Math.round(parseFloat(normalized) * 100);
	if (isNaN(amount)) return { originalAmount: null, originalCurrency: null };
	return { originalAmount: amount, originalCurrency: m[2].toUpperCase() };
}

/** Excel 1900 date system: serial 1 = 1900-01-01, offset epoch 1899-12-30. */
function excelSerialToDate(serial: number): Date {
	return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
}

function parseRonValue(v: string | number): number {
	if (typeof v === 'number') return Math.round(v * 100);
	const s = v.replace(/,/g, '');
	return Math.round(parseFloat(s) * 100) || 0;
}

export function parseMissingDocumentsRows(rows: unknown[][]): {
	payments: PaymentRow[];
	ignoredIncomes: number;
} {
	const payments: PaymentRow[] = [];
	let ignoredIncomes = 0;
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
		payments.push({
			reference: String(referinta ?? ''),
			date:
				typeof dataSerial === 'number'
					? excelSerialToDate(dataSerial)
					: new Date(String(dataSerial)),
			partner: partener ? String(partener) : null,
			amountRon: parseRonValue(valoare ?? 0),
			comment,
			originalAmount,
			originalCurrency
		});
	}
	return { payments, ignoredIncomes };
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

function merchantMatches(payment: PaymentRow, candidate: InvoiceCandidate): boolean {
	const haystack = (payment.comment + ' ' + (payment.partner || '')).toUpperCase();
	const aliases = MERCHANT_ALIASES[candidate.supplierType || ''];
	if (aliases && aliases.some((a) => haystack.includes(a))) return true;

	// Fallback for senders without a parser: does a merchant token from the
	// statement appear in the sender address or subject?
	const emailHaystack = `${candidate.from} ${candidate.subject}`.toUpperCase();
	return merchantTokens(payment).some((token) => emailHaystack.includes(token));
}

export function scoreMatch(payment: PaymentRow, candidate: InvoiceCandidate): number {
	if (daysBetween(payment.date, candidate.date) > MATCH_WINDOW_DAYS) return 0;
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
	if (merchantMatches(payment, candidate)) score += 40;
	const days = daysBetween(payment.date, candidate.date);
	score += Math.max(0, Math.round(10 * (1 - days / MATCH_WINDOW_DAYS)));
	return score;
}

/** Greedy unique assignment: sort all pairs by score desc, tie-break on date proximity. */
export function matchPayments(
	payments: PaymentRow[],
	candidates: InvoiceCandidate[]
): PaymentMatchResult[] {
	const pairs: Array<{ pi: number; ci: number; score: number; days: number }> = [];
	payments.forEach((p, pi) => {
		candidates.forEach((c, ci) => {
			const score = scoreMatch(p, c);
			if (score >= PROBABLE_THRESHOLD) {
				pairs.push({ pi, ci, score, days: daysBetween(p.date, c.date) });
			}
		});
	});
	pairs.sort((a, b) => b.score - a.score || a.days - b.days);

	const usedPayments = new Set<number>();
	const usedCandidates = new Set<number>();
	const assignment = new Map<number, { ci: number; score: number }>();
	for (const { pi, ci, score } of pairs) {
		if (usedPayments.has(pi) || usedCandidates.has(ci)) continue;
		usedPayments.add(pi);
		usedCandidates.add(ci);
		assignment.set(pi, { ci, score });
	}

	return payments.map((p, pi) => {
		const a = assignment.get(pi);
		if (!a) return { ...p, score: 0, confidence: 'none' as const };
		return {
			...p,
			match: candidates[a.ci],
			score: a.score,
			confidence: a.score >= SURE_THRESHOLD ? ('sure' as const) : ('probable' as const)
		};
	});
}
