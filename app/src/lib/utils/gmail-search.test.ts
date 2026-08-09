import { describe, expect, test } from 'bun:test';
import { error as svelteError } from '@sveltejs/kit';
import {
	MAX_ZIP_ITEMS,
	MERCHANT_STOPWORDS,
	MIN_MERCHANT_TOKEN_LENGTH,
	MISSING_DOCS_SCAN_LIMIT,
	SUGGESTED_EXCLUDE_PATTERNS,
	addExcludePattern,
	batchArchiveName,
	chunk,
	errorStatus,
	isGmailAuthError,
	isXlsxFile,
	merchantShort,
	nextDayIso,
	normalizeExcludePattern,
	paymentLabel,
	pluralRo,
	previousMonthRange,
	suggestedExclusionsToAdd,
	toIsoDate
} from './gmail-search';
// Import de TEST, nu de client: verificăm că lista duplicată nu a divergat de sursă.
import { SUGGESTED_EXCLUDE_PATTERNS as SERVER_SUGGESTIONS } from '../server/gmail/parsers/index';
import { merchantTokens } from '../server/banking/payment-match';

const basePayment = {
	reference: '12326',
	partner: null,
	comment: '',
	amountRon: 0,
	originalAmount: null,
	originalCurrency: null
};

describe('merchantShort', () => {
	test('preferă partenerul când există', () => {
		expect(merchantShort({ ...basePayment, partner: 'Hetzner Online GmbH' })).toBe(
			'HETZNERONLINEGMBH'
		);
	});

	test('extrage comerciantul din descrierea bancară (MPY nu mai scapă)', () => {
		expect(
			merchantShort({
				...basePayment,
				comment: 'PLATA POS 000NVPO261975UOO MPY*KESSELRING SRL valoare tranzactie: 120,00 RON'
			})
		).toBe('KESSELRING');
	});

	test('nu confundă codurile bancare cu numele comerciantului', () => {
		expect(
			merchantShort({ ...basePayment, comment: 'PLATA CARD TID:G0A3LMSE RRN 000NVPO261975' })
		).toBe('FURNIZOR');
	});
});

describe('stopwords-urile de comerciant sunt aceleași pentru potrivire și pentru etichetă', () => {
	/** `merchantTokens` (potrivire, server) cere un rând întreg de plată. */
	const paymentRow = (comment: string) => ({
		reference: '12326',
		date: new Date(2026, 6, 17),
		partner: null,
		amountRon: 0,
		comment,
		originalAmount: null,
		originalCurrency: null
	});

	test('niciun stopword nu ajunge nici token de potrivire, nici prefix de fișier', () => {
		// Lista are o singură definiție (`$lib/utils/gmail-search`), dar cele două
		// funcții o aplică separat: testul prinde și o filtrare care ar sări peste ea.
		expect(MERCHANT_STOPWORDS.size).toBeGreaterThan(0);
		for (const word of MERCHANT_STOPWORDS) {
			expect(merchantTokens(paymentRow(`PLATA POS ${word} SRL`))).toEqual([]);
			expect(merchantShort({ ...basePayment, comment: `PLATA POS ${word} SRL` })).toBe('FURNIZOR');
		}
	});

	test('pragul de lungime e același în ambele părți', () => {
		const short = 'A'.repeat(MIN_MERCHANT_TOKEN_LENGTH - 1);
		const long = 'A'.repeat(MIN_MERCHANT_TOKEN_LENGTH);
		expect(merchantTokens(paymentRow(short))).toEqual([]);
		expect(merchantShort({ ...basePayment, comment: short })).toBe('FURNIZOR');
		expect(merchantTokens(paymentRow(long))).toEqual([long]);
		expect(merchantShort({ ...basePayment, comment: long })).toBe(long);
	});
});

describe('paymentLabel', () => {
	test('folosește suma originală, cu valuta ei', () => {
		expect(
			paymentLabel({
				...basePayment,
				partner: 'Hetzner',
				amountRon: 90_000,
				originalAmount: 18_004,
				originalCurrency: 'EUR'
			})
		).toBe('12326_HETZNER_180.04EUR');
	});

	test('fără sumă originală cade pe lei — niciodată fără valută', () => {
		expect(paymentLabel({ ...basePayment, partner: 'Rotld', amountRon: 12_345 })).toBe(
			'12326_ROTLD_123.45RON'
		);
	});
});

describe('pluralRo', () => {
	test('1 cere singular', () => {
		expect(pluralRo(1, 'plată', 'plăți')).toBe('1 plată');
		expect(pluralRo(1, 'email', 'emailuri')).toBe('1 email');
	});

	test('2–19 cer plural simplu', () => {
		expect(pluralRo(3, 'plată', 'plăți')).toBe('3 plăți');
		expect(pluralRo(19, 'plată', 'plăți')).toBe('19 plăți');
	});

	test('de la 20 în sus cer „de”', () => {
		expect(pluralRo(20, 'plată', 'plăți')).toBe('20 de plăți');
		expect(pluralRo(100, 'email', 'emailuri')).toBe('100 de emailuri');
	});

	test('101 revine la pluralul simplu', () => {
		expect(pluralRo(101, 'plată', 'plăți')).toBe('101 plăți');
	});

	test('zero rămâne plural fără „de”', () => {
		expect(pluralRo(0, 'plată', 'plăți')).toBe('0 plăți');
	});
});

describe('nextDayIso', () => {
	test('avansează o zi (before: din Gmail e exclusiv)', () => {
		expect(nextDayIso('2026-07-30')).toBe('2026-07-31');
	});

	test('trece corect peste sfârșitul lunii', () => {
		expect(nextDayIso('2026-07-31')).toBe('2026-08-01');
	});

	test('trece corect peste sfârșitul anului', () => {
		expect(nextDayIso('2026-12-31')).toBe('2027-01-01');
	});

	test('anul bisect', () => {
		expect(nextDayIso('2028-02-28')).toBe('2028-02-29');
	});

	test('o valoare neinterpretabilă rămâne neschimbată', () => {
		expect(nextDayIso('')).toBe('');
		expect(nextDayIso('31.07.2026')).toBe('31.07.2026');
	});
});

describe('previousMonthRange', () => {
	test('luna anterioară, derivată din data dată (nu hardcodată)', () => {
		expect(previousMonthRange(new Date(2026, 7, 4))).toEqual({
			from: '2026-07-01',
			to: '2026-07-31'
		});
	});

	test('în ianuarie sare în decembrie anul trecut', () => {
		expect(previousMonthRange(new Date(2026, 0, 15))).toEqual({
			from: '2025-12-01',
			to: '2025-12-31'
		});
	});

	test('februarie bisect', () => {
		expect(previousMonthRange(new Date(2028, 2, 3))).toEqual({
			from: '2028-02-01',
			to: '2028-02-29'
		});
	});
});

describe('toIsoDate', () => {
	test('folosește data locală, nu UTC', () => {
		expect(toIsoDate(new Date(2026, 0, 1))).toBe('2026-01-01');
	});
});

describe('chunk', () => {
	test('sparge selecția în tranșe de MAX_ZIP_ITEMS', () => {
		const items = Array.from({ length: 250 }, (_, i) => i);
		const batches = chunk(items, MAX_ZIP_ITEMS);
		expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
		expect(batches.flat()).toEqual(items);
	});

	test('o selecție sub plafon rămâne o singură tranșă', () => {
		expect(chunk([1, 2, 3], MAX_ZIP_ITEMS)).toEqual([[1, 2, 3]]);
	});

	test('lista goală nu produce tranșe', () => {
		expect(chunk([], MAX_ZIP_ITEMS)).toEqual([]);
	});
});

describe('erori Gmail văzute din client', () => {
	/**
	 * Exact forma care ajunge în `catch`-ul unei comenzi remote: serverul aruncă
	 * `error(status, mesaj)`, SvelteKit trimite `status` + `body` pe fir, iar clientul
	 * reface un `HttpError` din aceleași două valori (aceeași clasă). HttpError NU e
	 * `instanceof Error`, deci tiparele obișnuite de citire a mesajului nu merg pe el.
	 */
	function remoteError(status: number, message: string): { status: number; body: App.Error } {
		try {
			svelteError(status, message);
		} catch (e) {
			return e as { status: number; body: App.Error };
		}
		throw new Error('svelteError trebuie să arunce');
	}

	test('409-ul dat de mapGmailError declanșează reconectarea', () => {
		const message =
			'Contul Gmail nu este conectat sau autorizarea a expirat. Reconectează-l din Setări → Integrări.';
		const err = remoteError(409, message);
		expect(err).not.toBeInstanceOf(Error);
		expect(err.body.message).toBe(message);
		expect(errorStatus(err)).toBe(409);
		expect(isGmailAuthError(err, err.body.message)).toBe(true);
	});

	test('502-ul de la Gmail picat NU cere reconectare', () => {
		const message = 'Gmail nu a răspuns la timp. Încearcă din nou peste câteva momente.';
		const err = remoteError(502, message);
		expect(errorStatus(err)).toBe(502);
		expect(isGmailAuthError(err, err.body.message)).toBe(false);
	});

	test('plasa de siguranță pe text prinde erorile netraduse', () => {
		expect(isGmailAuthError(new Error('Gmail not connected'), 'Gmail not connected')).toBe(true);
		expect(isGmailAuthError(null, 'Contul nu este conectat')).toBe(true);
		expect(isGmailAuthError(null, 'Potrivirea documentelor a eșuat')).toBe(false);
	});

	test('o eroare fără status nu inventează unul', () => {
		expect(errorStatus(new Error('boom'))).toBeUndefined();
		expect(errorStatus(null)).toBeUndefined();
		expect(errorStatus({ status: '409' })).toBeUndefined();
	});
});

describe('plafoane', () => {
	test('plafonul de scanare al potrivirii e o constantă comună, nu un literal', () => {
		// Serverul o folosește la `searchEmails` și o întoarce în răspuns; clientul o
		// afișează și compară `totalFound` cu ea ca să avertizeze la trunchiere.
		expect(MISSING_DOCS_SCAN_LIMIT).toBeGreaterThan(MAX_ZIP_ITEMS);
		expect(Number.isInteger(MISSING_DOCS_SCAN_LIMIT)).toBe(true);
	});
});

describe('excluderi de expeditori', () => {
	test('sugestiile din client sunt identice cu cele de pe server', () => {
		// Lista din `$lib/utils` e un duplicat deliberat (modulul de server nu poate
		// ajunge în bundle-ul de client). Testul e singurul lucru care le ține la fel.
		expect(SUGGESTED_EXCLUDE_PATTERNS).toEqual(SERVER_SUGGESTIONS);
	});

	test('acceptă domeniu, @domeniu și adresă completă', () => {
		expect(normalizeExcludePattern('tiktok.com')).toEqual({ ok: true, pattern: 'tiktok.com' });
		expect(normalizeExcludePattern('@Facebook.com')).toEqual({ ok: true, pattern: '@facebook.com' });
		expect(normalizeExcludePattern('  Billing@Meta.com ')).toEqual({
			ok: true,
			pattern: 'billing@meta.com'
		});
	});

	test('refuză intrările care nu pot fi un expeditor', () => {
		expect(normalizeExcludePattern('')).toMatchObject({ ok: false });
		// Fără punct nu e nici domeniu, nici adresă — serverul oricum ar arunca intrarea
		expect(normalizeExcludePattern('tiktok')).toMatchObject({ ok: false });
		expect(normalizeExcludePattern('tik tok.com')).toMatchObject({ ok: false });
		expect(normalizeExcludePattern('a@b@c.com')).toMatchObject({ ok: false });
		expect(normalizeExcludePattern('-tiktok.com')).toMatchObject({ ok: false });
		expect(normalizeExcludePattern('tiktok..com')).toMatchObject({ ok: false });
	});

	test('mesajele de eroare sunt în română', () => {
		const result = normalizeExcludePattern('tiktok');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('Domeniul trebuie să arate');
	});

	test('adăugarea nu mută lista primită și refuză duplicatele', () => {
		const current = ['tiktok.com'];
		const added = addExcludePattern(current, 'Facebook.com');
		expect(added).toEqual({ ok: true, patterns: ['tiktok.com', 'facebook.com'] });
		expect(current).toEqual(['tiktok.com']);
		expect(addExcludePattern(current, ' TIKTOK.com ')).toMatchObject({ ok: false });
	});

	test('sugestiile deja folosite nu mai sunt oferite (nici sub forma @domeniu)', () => {
		expect(suggestedExclusionsToAdd([])).toEqual(SUGGESTED_EXCLUDE_PATTERNS);
		expect(suggestedExclusionsToAdd(['tiktok.com', '@facebook.com'])).toEqual([
			'facebookmail.com',
			'meta.com',
			'instagram.com',
			'linkedin.com'
		]);
	});
});

describe('isXlsxFile', () => {
	test('acceptă extensia, indiferent de MIME', () => {
		expect(isXlsxFile({ name: 'Documente Lipsa.XLSX', type: '' })).toBe(true);
		expect(isXlsxFile({ name: 'export.xlsx', type: 'application/octet-stream' })).toBe(true);
	});

	test('acceptă MIME-ul corect chiar și fără extensie', () => {
		expect(
			isXlsxFile({
				name: 'export',
				type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			})
		).toBe(true);
	});

	test('refuză celelalte formate', () => {
		expect(isXlsxFile({ name: 'documente.xls', type: 'application/vnd.ms-excel' })).toBe(false);
		expect(isXlsxFile({ name: 'factura.pdf', type: 'application/pdf' })).toBe(false);
		expect(isXlsxFile({ name: 'export.csv', type: 'text/csv' })).toBe(false);
	});
});

describe('batchArchiveName', () => {
	test('o singură arhivă păstrează numele serverului', () => {
		expect(batchArchiveName('facturi-gmail-2026-08-04.zip', 0, 1)).toBe(
			'facturi-gmail-2026-08-04.zip'
		);
	});

	test('mai multe arhive primesc numărul tranșei', () => {
		expect(batchArchiveName('facturi-gmail-2026-08-04.zip', 1, 3)).toBe(
			'facturi-gmail-2026-08-04-parte2-din-3.zip'
		);
	});
});
