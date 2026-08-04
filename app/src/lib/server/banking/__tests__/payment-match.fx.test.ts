import { describe, it, expect } from 'bun:test';
import {
	matchPayments,
	scoreMatch,
	pairWeights,
	fxDateKey,
	MAX_PAIR_SCORE,
	type PaymentRow,
	type InvoiceCandidate,
	type FxRates
} from '../payment-match';

/**
 * Cazul REAL raportat: referința 12268 din 02.07.2026. Extrasul BT raportează tranzacția
 * DIRECT în lei („valoare tranzactie: 51.81 RON"), deși INWX facturează în euro. Până la
 * conversie, scorul venea doar din comerciant (40) + proximitate (9) = 49 → „Probabilă".
 */
const INWX_COMMENT =
	'  Plata la POS non-BT cu card VISA;EPOS 02/07/2026 8HQ2RRDTKW TID:P0A1LMSE INWX GMBH  BERLIN DE 42444505 valoare tranzactie: 51.81 RON RRN:618811530700 comision tranzactie 0.00 RON;REF: 000NVPO261902xYz; ';

const PAYMENT_DATE = new Date('2026-07-02T00:00:00.000Z');
const INVOICE_DATE = new Date('2026-07-01T01:43:55.000Z');

/** Cursul BNR real pentru 02.07.2026, citit din `bnr_exchange_rate` (prod). */
const EUR_02_07 = 5.2359;

function payment(over: Partial<PaymentRow> = {}): PaymentRow {
	return {
		reference: '12268',
		date: PAYMENT_DATE,
		partner: null,
		amountRon: 5181,
		comment: INWX_COMMENT,
		originalAmount: 5181,
		originalCurrency: 'RON',
		...over
	};
}

function candidate(over: Partial<InvoiceCandidate> = {}): InvoiceCandidate {
	return {
		gmailMessageId: 'inwx-1',
		from: 'INWX GmbH <no-reply@inwx.com>',
		subject: 'New Invoice available',
		date: INVOICE_DATE,
		amount: 989, // 9,89 EUR — echivalentul a 51,81 lei la cursul zilei
		currency: 'EUR',
		supplierType: 'inwx',
		...over
	};
}

/** Cursuri indexate pe DATA PLĂȚII, forma pe care o produce `loadBnrFxRates`. */
function rates(ronPerUnit = EUR_02_07, currency = 'EUR', isoDate = '2026-07-02'): FxRates {
	return { [isoDate]: { [currency]: { ronPerUnit, rateDate: isoDate } } };
}

describe('fxDateKey', () => {
	it('dă ziua în ISO (UTC), cheia sub care sunt indexate cursurile', () => {
		expect(fxDateKey(PAYMENT_DATE)).toBe('2026-07-02');
	});
	it('null pe dată invalidă — o plată necitită nu poate cere curs', () => {
		expect(fxDateKey(new Date('nu e o dată'))).toBeNull();
	});
});

describe('cazul real INWX — plata în lei, factura în euro', () => {
	it('cu cursul zilei devine potrivire SIGURĂ, nu „Probabilă (49)"', () => {
		const [result] = matchPayments([payment()], [candidate()], { fxRates: rates() });
		expect(result.match?.gmailMessageId).toBe('inwx-1');
		expect(result.score).toBeGreaterThan(70);
		expect(result.confidence).toBe('sure');
	});

	it('expune conversia, ca utilizatorul să vadă DE CE s-a potrivit', () => {
		const [result] = matchPayments([payment()], [candidate()], { fxRates: rates() });
		// 9,89 € × 5,2359 = 51,78 lei față de 51,81 lei plătiți
		expect(result.fx?.invoiceRon).toBe(5178);
		expect(result.fx?.paymentRon).toBe(5181);
		expect(result.fx?.rateDate).toBe('2026-07-02');
	});

	it('și la cursul din enunț (4,97 lei/€) o factură de 10,42 € se potrivește', () => {
		const [result] = matchPayments([payment()], [candidate({ amount: 1042 })], {
			fxRates: rates(4.97)
		});
		expect(result.fx?.invoiceRon).toBe(5179); // 10,42 × 4,97 = 51,7874
		expect(result.confidence).toBe('sure');
	});

	it('fără cursuri rămâne exact comportamentul de azi: 49, „probabilă"', () => {
		const [result] = matchPayments([payment()], [candidate()]);
		expect(result.score).toBe(49); // 40 comerciant + 9 proximitate
		expect(result.confidence).toBe('probable');
		expect(result.fx).toBeUndefined();
	});
});

describe('toleranța asimetrică (adaosul băncii peste cursul BNR)', () => {
	const at = (invoiceEurCents: number, fx = rates()) =>
		scoreMatch(payment(), candidate({ amount: invoiceEurCents }), { fxRates: fx });

	// 51,81 lei plătiți / 5,2359 = 9,8951 € la paritate BNR. Sub această valoare a facturii,
	// diferența e adaosul băncii (plătim MAI MULT în lei decât conversia BNR).
	it('adaos de ~2%: factura de 9,70 € (50,79 lei) se potrivește', () => {
		const res = at(970); // 970 × 5,2359 = 5078,8 → 5079 bani; plata e cu 2,01% peste
		expect(res.score).toBeGreaterThan(70);
		expect(res.fx).toBeDefined();
	});

	it('adaos de ~5%: factura de 9,43 € (49,37 lei) încă se potrivește', () => {
		const res = at(943);
		expect(res.fx).toBeDefined();
	});

	it('adaos de ~8%: prea mult ca să fie diferență de curs — fără scor pe sumă', () => {
		const res = at(917); // 917 × 5,2359 = 4801 bani; plata e cu 7,9% peste
		expect(res.fx).toBeUndefined();
		expect(res.score).toBe(49);
	});

	// Asimetria: în jos banda e mult mai strânsă, fiindcă banca nu ne face cadouri.
	it('plata cu 1% SUB conversia BNR (drift normal de curs) se potrivește', () => {
		const res = at(999); // 999 × 5,2359 = 5231 bani; plata 5181 e cu 0,96% sub
		expect(res.fx).toBeDefined();
	});

	it('plata cu 4% SUB conversia BNR nu se potrivește — banda de jos e strânsă', () => {
		const res = at(1031); // 1031 × 5,2359 = 5398 bani; plata 5181 e cu 4,0% sub
		expect(res.fx).toBeUndefined();
		expect(res.score).toBe(49);
	});
});

describe('sume clar diferite', () => {
	it('o factură de valoare dublă NU se potrivește pe sumă', () => {
		const [result] = matchPayments([payment()], [candidate({ amount: 1978 })], {
			fxRates: rates()
		});
		// Comerciantul tot corespunde, deci rândul rămâne „probabil" — dar nu „sigur".
		expect(result.score).toBe(49);
		expect(result.confidence).toBe('probable');
		expect(result.fx).toBeUndefined();
	});

	it('o factură de 1,00 USD (parsare greșită) nu e confirmată de plata de 51,81 lei', () => {
		const [result] = matchPayments([payment()], [candidate({ amount: 100, currency: 'USD' })], {
			fxRates: { '2026-07-02': { USD: { ronPerUnit: 4.6227, rateDate: '2026-07-02' } } }
		});
		expect(result.fx).toBeUndefined();
		expect(result.confidence).toBe('probable');
	});
});

describe('absența cursurilor — degradare, nu excepție', () => {
	it('obiect de opțiuni gol', () => {
		expect(() => matchPayments([payment()], [candidate()], {})).not.toThrow();
		expect(matchPayments([payment()], [candidate()], {})[0].score).toBe(49);
	});

	it('cursuri pentru altă valută decât cea a facturii', () => {
		const fx: FxRates = { '2026-07-02': { HUF: { ronPerUnit: 0.014757, rateDate: '2026-07-02' } } };
		expect(matchPayments([payment()], [candidate()], { fxRates: fx })[0].score).toBe(49);
	});

	it('tabel gol (niciun curs sincronizat)', () => {
		expect(matchPayments([payment()], [candidate()], { fxRates: {} })[0].score).toBe(49);
	});

	it('curs nevalid (0 sau NaN) e ignorat, nu produce Infinity/NaN în scor', () => {
		for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			const res = scoreMatch(payment(), candidate(), { fxRates: rates(bad) });
			expect(res.score).toBe(49);
			expect(res.fx).toBeUndefined();
		}
	});
});

describe('cursul e cel de la DATA PLĂȚII', () => {
	it('cursurile altei zile nu se aplică — indexarea e pe ziua plății', () => {
		const fx = rates(EUR_02_07, 'EUR', '2026-06-15');
		expect(matchPayments([payment()], [candidate()], { fxRates: fx })[0].score).toBe(49);
	});

	it('două plăți din zile diferite folosesc fiecare cursul zilei ei', () => {
		// Aceeași factură de 9,89 €, două zile cu cursuri mult diferite: doar plata a cărei
		// zi are cursul potrivit se confirmă pe sumă.
		const fx: FxRates = {
			'2026-07-02': { EUR: { ronPerUnit: EUR_02_07, rateDate: '2026-07-02' } },
			'2026-07-03': { EUR: { ronPerUnit: 4.0, rateDate: '2026-07-03' } }
		};
		const later = payment({
			reference: '12269',
			date: new Date('2026-07-03T00:00:00.000Z')
		});
		const [a, b] = matchPayments(
			[payment(), later],
			[candidate(), candidate({ gmailMessageId: 'inwx-2' })],
			{ fxRates: fx }
		);
		expect(a.fx).toBeDefined();
		expect(b.fx).toBeUndefined();
	});

	it('data cotației returnate poate fi anterioară plății (weekend)', () => {
		const monday = payment({ date: new Date('2026-07-06T00:00:00.000Z') });
		const fx: FxRates = {
			'2026-07-06': { EUR: { ronPerUnit: EUR_02_07, rateDate: '2026-07-03' } }
		};
		const [result] = matchPayments([monday], [candidate({ date: monday.date })], { fxRates: fx });
		expect(result.fx?.rateDate).toBe('2026-07-03');
	});
});

describe('valute cotate la 100 de unități (multiplicator)', () => {
	// HUF: BNR publică 1,4757 lei pentru 100 HUF, deci 0,014757 lei/unitate. Dacă
	// multiplicatorul se pierde, conversia iese de 100 de ori mai mare și nimic nu se potrivește.
	const HUF_PER_UNIT = 1.4757 / 100;

	it('o factură de 3.511 HUF se potrivește cu o plată de 51,81 lei', () => {
		const fx: FxRates = {
			'2026-07-02': { HUF: { ronPerUnit: HUF_PER_UNIT, rateDate: '2026-07-02' } }
		};
		const res = scoreMatch(payment(), candidate({ amount: 351_100, currency: 'HUF' }), {
			fxRates: fx
		});
		expect(res.fx?.invoiceRon).toBe(5181);
		expect(res.score).toBeGreaterThan(70);
	});

	it('cu cursul brut (fără împărțirea la 100) nu s-ar potrivi nimic', () => {
		const fx: FxRates = { '2026-07-02': { HUF: { ronPerUnit: 1.4757, rateDate: '2026-07-02' } } };
		const res = scoreMatch(payment(), candidate({ amount: 351_100, currency: 'HUF' }), {
			fxRates: fx
		});
		expect(res.fx).toBeUndefined();
	});
});

describe('plăți în valută față de facturi în ALTĂ valută', () => {
	const USD_COMMENT =
		'  Plata la POS non-BT cu card VISA;EPOS 02/07/2026 9RRDTDHD TID:H9JRYLIO DIRECTADMIN.COM  +15879214476 CA 42444505 valoare tranzactie: 29.00 USD RRN:618811530698 comision tranzactie 0.00 RON;REF: 000NVPO261904iEK; ';
	const fx: FxRates = {
		'2026-07-02': {
			USD: { ronPerUnit: 4.6227, rateDate: '2026-07-02' },
			EUR: { ronPerUnit: EUR_02_07, rateDate: '2026-07-02' }
		}
	};

	it('29,00 USD plătiți se potrivesc cu o factură de 25,60 € (ambele ≈ 134 lei)', () => {
		const p = payment({ comment: USD_COMMENT, originalAmount: 2900, originalCurrency: 'USD' });
		const c = candidate({
			from: 'DirectAdmin <sales@directadmin.com>',
			subject: 'Invoice 12345',
			amount: 2560,
			currency: 'EUR',
			supplierType: 'directadmin'
		});
		const res = scoreMatch(p, c, { fxRates: fx });
		expect(res.fx?.paymentRon).toBe(13406); // 29,00 × 4,6227
		expect(res.fx?.invoiceRon).toBe(13404); // 25,60 × 5,2359
		expect(res.score).toBeGreaterThan(70);
	});

	it('lipsa cursului pentru UNA dintre valute anulează conversia', () => {
		const p = payment({ comment: USD_COMMENT, originalAmount: 2900, originalCurrency: 'USD' });
		const c = candidate({
			from: 'DirectAdmin <sales@directadmin.com>',
			subject: 'Invoice 12345',
			amount: 2560,
			currency: 'EUR',
			supplierType: 'directadmin'
		});
		const onlyUsd: FxRates = {
			'2026-07-02': { USD: { ronPerUnit: 4.6227, rateDate: '2026-07-02' } }
		};
		expect(scoreMatch(p, c, { fxRates: onlyUsd }).fx).toBeUndefined();
	});
});

describe('conversia nu atinge drumurile existente', () => {
	it('aceeași valută rămâne pe potrivirea exactă (60), nu pe cea convertită', () => {
		const p = payment({ originalAmount: 989, originalCurrency: 'EUR' });
		const res = scoreMatch(p, candidate(), { fxRates: rates() });
		expect(res.score).toBe(109); // 60 exact + 40 comerciant + 9 proximitate
		expect(res.fx).toBeUndefined();
	});

	it('aceeași valută, în toleranța de 2%, rămâne pe 40', () => {
		const p = payment({ originalAmount: 1000, originalCurrency: 'EUR' });
		const res = scoreMatch(p, candidate({ amount: 989 }), { fxRates: rates() });
		expect(res.score).toBe(89); // 40 apropiat + 40 comerciant + 9 proximitate
		expect(res.fx).toBeUndefined();
	});

	it('fereastra de 10 zile bate conversia: o factură prea veche nu se potrivește', () => {
		const old = candidate({ date: new Date('2026-06-01T00:00:00.000Z') });
		expect(scoreMatch(payment(), old, { fxRates: rates() }).score).toBe(0);
	});
});

describe('MAX_PAIR_SCORE acoperă și componenta de conversie', () => {
	it('rămâne 110 — conversia (35) e sub potrivirea exactă (60)', () => {
		expect(MAX_PAIR_SCORE).toBe(110);
	});

	it('niciun scor cu conversie nu depășește plafonul', () => {
		const res = scoreMatch(payment(), candidate({ date: PAYMENT_DATE }), { fxRates: rates() });
		expect(res.score).toBeLessThanOrEqual(MAX_PAIR_SCORE);
		expect(() =>
			pairWeights([{ pi: 0, ci: 0, score: res.score, merchantMatched: true, days: 0 }], 1)
		).not.toThrow();
	});

	it('conversia singură (fără comerciant) trece pragul „probabil" doar cu dată apropiată', () => {
		const anonim = candidate({
			from: 'Billing <billing@necunoscut.example>',
			subject: 'Your receipt',
			supplierType: undefined,
			date: PAYMENT_DATE
		});
		const res = scoreMatch(payment(), anonim, { fxRates: rates() });
		expect(res.merchantMatched).toBe(false);
		expect(res.score).toBe(45); // 35 conversie + 10 proximitate maximă
	});
});
