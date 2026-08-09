// Match algorithm between bank payments (Keez "Documente Lipsa" export) and
// supplier invoices found in Gmail. Pure module — no DB, no network — for testability.

import { maxWeightMatching } from './assignment';
// Modul PUR de utilitare (fără cod de server): îl importăm ca stopwords-urile și pragul
// de lungime să aibă o singură definiție, comună cu numele fișierelor din arhivă.
import { MERCHANT_STOPWORDS, MIN_MERCHANT_TOKEN_LENGTH } from '$lib/utils/gmail-search';

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
	/**
	 * Textul de IDENTIFICARE din documentul atașat — în practică denumirea furnizorului
	 * din antetul PDF-ului („FIDA SOLUTIONS"), completată de apelant. Modulul rămâne PUR:
	 * nu descarcă și nu citește nimic, primește câmpul gata făcut.
	 *
	 * De ce e nevoie de el: la facturile trimise printr-un intermediar, comerciantul din
	 * extrasul bancar nu apare nici în expeditor, nici în subiect. Plata la FIDA SOLUTIONS
	 * (parcare) vine pe un email de la `noreply@primariasv.ro` cu subiectul „Plata parcare
	 * Municipiu Suceava" — fără textul documentului nu există nicio dovadă de comerciant,
	 * iar potrivirea nu poate ajunge niciodată „sigură".
	 *
	 * De ce DOAR denumirea și nu tot textul PDF-ului: tokenii de comerciant se extrag din
	 * descrierea bancară, unde apar și cuvinte fără legătură cu furnizorul (localitatea
	 * terminalului: „Maramures"). Un asemenea cuvânt se lovește ușor de corpul unei
	 * facturi oarecare — adresă, descrierea serviciului — și ar produce o dovadă falsă,
	 * exact semnalul care ridică o potrivire la „sigur".
	 */
	documentText?: string;
}

export interface PaymentMatchResult extends PaymentRow {
	match?: InvoiceCandidate;
	score: number;
	confidence: 'sure' | 'probable' | 'none';
	/** Prezent DOAR când sumele au fost comparate după conversie (vezi FxConversion). */
	fx?: FxConversion;
}

/**
 * Curs BNR normalizat: lei pentru O unitate de valută.
 *
 * BNR cotează unele valute pentru 100 de unități (HUF, JPY, KRW…), iar coloana
 * `bnr_exchange_rate.multiplier` păstrează acel 100. Împărțirea se face O SINGURĂ dată,
 * la citire (`rate-lookup.ts`), ca modulul de potrivire să nu mai aibă de ales: aici
 * `ronPerUnit` e mereu lei/unitate. Un curs brut de 1,4757 pentru HUF în loc de 0,014757
 * face conversia de 100 de ori mai mare și nicio factură nu s-ar mai potrivi.
 */
export interface FxRate {
	ronPerUnit: number;
	/** Data cotației efectiv folosite (ISO). Poate fi anterioară plății (weekend, sărbători). */
	rateDate: string;
}

/**
 * Cursurile pre-rezolvate, indexate întâi pe DATA PLĂȚII (ISO, UTC) și apoi pe valută.
 *
 * De ce e datată și nu o simplă hartă valută → curs: un export „Documente Lipsă" acoperă
 * o lună sau un trimestru, iar EUR/RON se mișcă cu procente în interval. O hartă plată ar
 * aplica tăcut cursul unei singure zile peste tot, exact eroarea pe care conversia trebuie
 * să o evite. Rezolvarea „cea mai apropiată cotație anterioară" (BNR nu cotează în weekend)
 * o face apelantul, în `rate-lookup.ts`, ca modulul de față să rămână PUR: fără DB, fără
 * rețea, fără reguli de calendar.
 */
export type FxRates = Record<string, Record<string, FxRate>>;

export interface MatchOptions {
	/** Absente sau incomplete ⇒ comportamentul de dinaintea conversiei, fără excepție. */
	fxRates?: FxRates;
}

/** Ce a însemnat concret conversia, pentru explicația din interfață. */
export interface FxConversion {
	/** Suma facturii convertită în bani (RON). */
	invoiceRon: number;
	/** Suma plătită convertită în bani (RON); identitate când plata e deja în lei. */
	paymentRon: number;
	/** Data cotației BNR folosite (ISO, YYYY-MM-DD). */
	rateDate: string;
}

/**
 * Cheia sub care sunt indexate cursurile: ziua plății în ISO (UTC).
 *
 * UTC, nu ora locală: datele plăților vin din seriale Excel convertite la miezul nopții
 * UTC, iar `toLocaleDateString` ar muta ziua înapoi pentru fusurile negative.
 * Null pe dată invalidă — un rând necitit nu are voie să ceară un curs oarecare.
 */
export function fxDateKey(date: Date): string | null {
	if (isNaN(date.getTime())) return null;
	return date.toISOString().slice(0, 10);
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

/**
 * Tokenul e concatenarea unor cuvinte CONSECUTIVE din text?
 *
 * Descriptorul de card lipește cuvintele denumirii („MPY*fidasolutions"), în timp ce
 * factura le scrie separat („FIDA SOLUTIONS", „S.C. FIDA SOLUTIONS S.R.L."), deci
 * potrivirea pe cuvânt întreg nu are ce găsi. Comparăm concatenări de cuvinte
 * consecutive, nu subșiruri oarecare: egalitatea exactă pe o secvență de cuvinte
 * păstrează garanția de la `containsWord` — „CARTON" nu se lipește niciodată de
 * „SCARTONIS", iar ordinea contează („SOLUTIONS FIDA" ≠ „FIDASOLUTIONS").
 */
function matchesWordRun(words: string[], token: string): boolean {
	for (let i = 0; i < words.length; i++) {
		let run = '';
		for (let j = i; j < words.length && run.length < token.length; j++) {
			run += words[j];
			if (run === token) return true;
		}
	}
	return false;
}

function merchantMatches(payment: PaymentRow, candidate: InvoiceCandidate): boolean {
	const haystack = (payment.comment + ' ' + (payment.partner || '')).toUpperCase();
	const documentText = (candidate.documentText || '').toUpperCase();
	const emailHaystack = `${candidate.from} ${candidate.subject} ${documentText}`.toUpperCase();
	// Denumirea din document, spartă în cuvinte pur alfabetice: „S.C. FIDA SOLUTIONS
	// S.R.L." → [S, C, FIDA, SOLUTIONS, S, R, L]. Plafonat, ca un apelant care ar trimite
	// din greșeală tot textul PDF-ului să nu ducă la o buclă pătratică pe mii de cuvinte.
	const documentWords = documentText
		.split(/[^A-Z]+/)
		.filter(Boolean)
		.slice(0, 24);
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
	// appear as a WHOLE WORD in the sender address, subject or supplier name from the
	// document? Substring matching would let „CARTON" match „SCARTONIS".
	return merchantTokens(payment).some(
		(token) => containsWord(emailHaystack, token) || matchesWordRun(documentWords, token)
	);
}

export interface MatchScore {
	score: number;
	/** Dacă există dovadă că factura vine de la comerciantul plății (cerută pentru 'sure'). */
	merchantMatched: boolean;
	/** Prezent doar când scorul pe sumă a venit din comparația după conversie. */
	fx?: FxConversion;
}

/**
 * Ponderile componentelor de scor. Sunt constante numite, nu literali împrăștiați, fiindcă
 * `MAX_PAIR_SCORE` se DERIVĂ din ele — vezi comentariul de acolo.
 */
const SCORE_AMOUNT_EXACT = 60;
/** Sumă în toleranța de 2% (curs valutar, rotunjiri). */
const SCORE_AMOUNT_NEAR = 40;
/**
 * Sume egale DUPĂ conversie la cursul BNR al zilei plății, în DOUĂ trepte după cât de
 * departe cade deriva. Treapta contează la fel de mult ca valoarea: un scor BINAR pe toată
 * banda ar lăsa departajarea a două facturi de la același furnizor exclusiv pe seama datei.
 *
 * De ce e nevoie de gradient: banda de conversie e largă (−2%…+6%), iar la INWX — registrar
 * de domenii, cu facturi grupate în 8-15 € — două înnoiri la câteva zile distanță cad
 * rutinier amândouă în fereastră. Pentru plata reală de 51,81 lei, orice factură între 9,34
 * și 10,09 € intră în bandă. Cu un scor unic, factura la paritate (9,89 €) și cea de la
 * marginea benzii (9,40 €) primeau ambele 35, iar câștiga cea cu data mai apropiată — adică
 * factura greșită, etichetată „sigur".
 *
 * Ecartul dintre trepte (35 − 19 = 16) e strict mai mare decât `SCORE_PROXIMITY_MAX` (10),
 * exact cum ecartul dintre potrivirea exactă și cea aproximativă pe aceeași valută (60 − 40
 * = 20) e mai mare decât aceeași proximitate: fidelitatea sumei bate mereu apropierea de
 * dată, pe ambele drumuri.
 *
 * Treapta strânsă rămâne 35, cât să treacă pragul de 'sigur' împreună cu dovada de
 * comerciant (40) și o dată apropiată: 35 + 40 + 9 = 84 pe cazul INWX din raport. Treapta
 * largă e aleasă astfel încât maximul ei să rămână SUB prag (19 + 40 + 10 = 69 < 70): o
 * potrivire de la marginea benzii nu se mai poate declara „sigură" de una singură.
 *
 * Efect secundar dorit: SINGURĂ (fără comerciant) treapta largă dă cel mult 19 + 10 = 29,
 * sub `PROBABLE_THRESHOLD` — deci coada benzii nu mai produce deloc potriviri speculative
 * cu furnizori fără nicio legătură, iar treapta strânsă le produce (35 + 10 = 45) doar la
 * cel mult 5 zile distanță.
 *
 * CENTRUL treptei strânse NU e paritatea, ci adaosul tipic de conversie (vezi
 * `FX_TYPICAL_MARKUP`). Pe datele reale ale extrasului, o plată în lei către un furnizor
 * care facturează în valută iese SISTEMATIC peste conversia BNR; o treaptă strânsă centrată
 * pe paritate ar retrograda tocmai potrivirile corecte și, între două candidate, ar da
 * scorul mai mare celei mai apropiate de cursul BNR — adică celei GREȘITE.
 */
const SCORE_AMOUNT_FX_TIGHT = 35;
const SCORE_AMOUNT_FX_LOOSE = 19;
/**
 * Adaosul de conversie AȘTEPTAT, adică centrul treptei strânse.
 *
 * Măsurat pe extrasul real: plata către HETZNER din 14.07.2026 e raportată ca „valoare
 * tranzactie: 180.04 EUR", iar coloana Valoare arată 968,77 lei debitați — 5,3809 lei/€,
 * cu 2,8% peste cotația BNR a acelei săptămâni (~5,23). Când transacția e raportată direct
 * în lei, conversia a făcut-o comerciantul sau procesatorul lui (DCC), unde adaosul e și
 * mai mare. Deriva așteptată a unei potriviri CORECTE nu e deci 0, ci ~2-4%.
 */
const FX_TYPICAL_MARKUP = 0.025;
/**
 * Cât de departe de adaosul tipic mai poate cădea o conversie și să rămână „strânsă":
 * ±2,5 puncte procentuale, adică deriva din intervalul [0%, +5%]. Restul benzii — plata
 * SUB conversia BNR (adaos negativ, imposibil de explicat prin comisioane) și adaosul de
 * peste 5% — rămâne pe treapta largă.
 */
const FX_TIGHT_SPREAD = 0.025;
const SCORE_MERCHANT = 40;
const SCORE_PROXIMITY_MAX = 10;

/**
 * Banda de toleranță pentru comparația după conversie, ASIMETRICĂ în mod deliberat.
 *
 * Suma în lei debitată de bancă pentru o factură în valută nu e conversia BNR: schema de
 * card (Visa/Mastercard) folosește cursul ei de referință, peste care emitentul pune un
 * adaos, iar decontarea se face la o zi–două după autorizare. Adaosul e aproape mereu ÎN
 * DEFAVOAREA clientului, tipic 1-3%, cu vârfuri peste 5% când moneda se mișcă sau când
 * comerciantul face conversie dinamică (DCC). De aceea plafonul de SUS e 6%.
 *
 * În jos, plata poate ieși sub conversia BNR doar prin driftul cursului între momentul în
 * care schema își fixează referința și cotația BNR a zilei — o abatere mică. 2% (aceeași
 * mărime cu toleranța de la aceeași valută) o acoperă și, în plus, ține banda îngustă
 * acolo unde o factură mai mare ar fi confundată cu una mai mică.
 */
const FX_TOLERANCE_ABOVE = 0.06;
const FX_TOLERANCE_BELOW = 0.02;

/**
 * Suma, în bani RON, la cursul zilei. `null` = nu se poate converti (curs lipsă sau
 * nevalid) — apelantul trebuie să renunțe la scorul pe sumă, NU să presupună paritatea.
 */
function toRon(
	amount: number,
	currency: string,
	dayRates: Record<string, FxRate> | undefined
): { ron: number; rate: FxRate | null } | null {
	// Leul e baza: nu are cotație în tabelul BNR și nici nu are nevoie de una.
	if (currency === 'RON') return { ron: amount, rate: null };
	const fx = dayRates?.[currency];
	if (!fx || !Number.isFinite(fx.ronPerUnit) || fx.ronPerUnit <= 0) return null;
	return { ron: Math.round(amount * fx.ronPerUnit), rate: fx };
}

export function scoreMatch(
	payment: PaymentRow,
	candidate: InvoiceCandidate,
	options: MatchOptions = {}
): MatchScore {
	const days = daysBetween(payment.date, candidate.date);
	// isNaN prinde datele invalide: `NaN > MATCH_WINDOW_DAYS` e false, deci fără verificare
	// explicită o plată cu dată coruptă ar trece de fereastră și ar aduna scor NaN.
	if (isNaN(days) || days > MATCH_WINDOW_DAYS) return { score: 0, merchantMatched: false };
	let score = 0;
	let fx: FxConversion | undefined;
	// Semnal principal: suma + valuta ORIGINALĂ a tranzacției (NU valoarea în RON —
	// contul e în lei, facturile sunt adesea în EUR/USD)
	if (
		payment.originalAmount != null &&
		payment.originalCurrency != null &&
		candidate.amount != null &&
		candidate.currency != null
	) {
		if (candidate.currency === payment.originalCurrency) {
			if (candidate.amount === payment.originalAmount) score += SCORE_AMOUNT_EXACT;
			else if (Math.abs(candidate.amount - payment.originalAmount) / payment.originalAmount <= 0.02)
				score += SCORE_AMOUNT_NEAR;
		} else {
			// Valute diferite: extrasul BT raportează uneori tranzacția direct în lei, deși
			// furnizorul extern facturează în EUR/USD. Fără conversie, semnalul cel mai
			// puternic — suma — se pierde complet și rămân doar comerciantul și data.
			const dayKey = fxDateKey(payment.date);
			const dayRates = dayKey ? options.fxRates?.[dayKey] : undefined;
			const paid = toRon(payment.originalAmount, payment.originalCurrency, dayRates);
			const billed = toRon(candidate.amount, candidate.currency, dayRates);
			if (paid && billed && billed.ron > 0) {
				const drift = (paid.ron - billed.ron) / billed.ron;
				if (drift <= FX_TOLERANCE_ABOVE && drift >= -FX_TOLERANCE_BELOW) {
					const tight = Math.abs(drift - FX_TYPICAL_MARKUP) <= FX_TIGHT_SPREAD;
					score += tight ? SCORE_AMOUNT_FX_TIGHT : SCORE_AMOUNT_FX_LOOSE;
					fx = {
						invoiceRon: billed.ron,
						paymentRon: paid.ron,
						// Data cotației care a făcut conversia netrivială: cea a facturii dacă
						// factura e în valută, altfel cea a plății. Una dintre ele există mereu,
						// fiindcă valutele diferă și cel mult una e RON.
						rateDate: (billed.rate ?? paid.rate)?.rateDate ?? ''
					};
				}
			}
		}
	}
	// Comerciantul singur trebuie să treacă pragul „probabil" (40), chiar și fără sumă
	const merchantMatched = merchantMatches(payment, candidate);
	if (merchantMatched) score += SCORE_MERCHANT;
	score += Math.max(0, Math.round(SCORE_PROXIMITY_MAX * (1 - days / MATCH_WINDOW_DAYS)));
	return { score, merchantMatched, fx };
}

export interface Pair {
	pi: number;
	ci: number;
	score: number;
	merchantMatched: boolean;
	days: number;
	fx?: FxConversion;
}

/**
 * Scorul maxim pe care îl poate întoarce `scoreMatch` — cea mai grea componentă de sumă
 * (toate se exclud reciproc: aceeași valută dă exact SAU apropiat, valute diferite dau
 * conversia strânsă SAU pe cea largă) + comerciant + proximitate maximă.
 *
 * DERIVAT, nu hardcodat: separarea nivelurilor din `pairWeights` cere
 * `MAX_PAIR_SCORE >= scorul maxim atins`, iar cele două erau exact egale (110 = 110).
 * Cu o constantă hardcodată, ridicarea oricărei ponderi de mai sus (comerciant 40→50 ⇒
 * maxim 120) rupea TĂCUT dominarea nivelurilor și redeschidea bugul „un match speculativ
 * deposedează unul confirmat", fără ca vreun test să pice. Aici cuplajul e structural.
 */
export const MAX_PAIR_SCORE =
	Math.max(SCORE_AMOUNT_EXACT, SCORE_AMOUNT_NEAR, SCORE_AMOUNT_FX_TIGHT, SCORE_AMOUNT_FX_LOOSE) +
	SCORE_MERCHANT +
	SCORE_PROXIMITY_MAX;

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
	candidates: InvoiceCandidate[],
	options: MatchOptions = {}
): PaymentMatchResult[] {
	const pairs: Pair[] = [];
	payments.forEach((p, pi) => {
		candidates.forEach((c, ci) => {
			const { score, merchantMatched, fx } = scoreMatch(p, c, options);
			if (score >= PROBABLE_THRESHOLD) {
				pairs.push({ pi, ci, score, merchantMatched, days: daysBetween(p.date, c.date), fx });
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
		return { ...p, match: candidates[ci], score: pair.score, confidence, fx: pair.fx };
	});
}
