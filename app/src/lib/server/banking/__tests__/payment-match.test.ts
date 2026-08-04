import { describe, it, expect } from 'bun:test';
import {
	extractPaymentDetails,
	parseMissingDocumentsRows,
	matchPayments,
	merchantTokens,
	scoreMatch,
	type PaymentRow,
	type InvoiceCandidate
} from '../payment-match';

const HETZNER_COMMENT =
	'  Plata la POS non-BT cu card VISA;EPOS 14/07/2026 472721821 TID:02B00111 HETZNER ONLINE GMBH  HETZNER.COM/ DE 42444505 valoare tranzactie: 180.04 EUR RRN:619502159763 comision tranzactie 0.00 RON;REF: 000NVPO261975UOO; ';
const DA_COMMENT =
	'  Plata la POS non-BT cu card VISA;EPOS 07/07/2026 9RRDTDHDRM9WVW9 TID:H9JRYLIO DIRECTADMIN.COM  +15879214476 CA 42444505 valoare tranzactie: 29.00 USD RRN:618811530698 comision tranzactie 0.00 RON;REF: 000NVPO261904iEK; ';
const CLAUDE_COMMENT =
	'  Plata la POS non-BT cu card VISA;EPOS 24/07/2026 Q0RRUWQV26H30SO TID:G0A3LMSE * CLAUDE SUB  +14152360599 US 42444505 valoare tranzactie: 211.56 EUR RRN:620514488579 comision tranzactie 0.00 RON;REF: 000NVPO262084soF; ';
const FIDA_COMMENT =
	'  Plata la POS;EPOS 03/08/2026 MID 644214659202RON MPY*fidasolutions Maramures ROM valoare trz: 8.00 RON RRN:322793237391 comision trz 0.00 RON  OD Order 533710000-853464267;REF: 044POSP2621517B3; ';
const KESSELRING_COMMENT =
	'  Plata la POS non-BT cu card VISA;EPOS 17/07/2026 4210252 TID:PAYW0006 MPY*KESSELRING SRL    ROZ  NOV RO 42444505 valoare tranzactie: 81.09 RON RRN:619811671945 comision tranzactie 0.00 RON;REF: 000NVPO262012NnP; ';
const CARTON_COMMENT =
	'  Plata la POS non-BT cu card VISA;EPOS 17/07/2026 4210252 TID:PAYW0006 MPY*CARTON SRL    ROZ  NOV RO 42444505 valoare tranzactie: 50.00 RON RRN:619811671945 comision tranzactie 0.00 RON;REF: 000NVPO262012NnP; ';
const MEDICI_COMMENT =
	'  Plata la POS non-BT cu card VISA;EPOS 17/07/2026 4210252 TID:PAYW0006 MPY*MEDICI SRL    ROZ  NOV RO 42444505 valoare tranzactie: 50.00 RON RRN:619811671945 comision tranzactie 0.00 RON;REF: 000NVPO262012NnP; ';

describe('extractPaymentDetails', () => {
	it('extrage suma și valuta ORIGINALĂ (nu RON) din comentariu', () => {
		const d = extractPaymentDetails(HETZNER_COMMENT);
		expect(d.originalAmount).toBe(18004);
		expect(d.originalCurrency).toBe('EUR');
	});
	it('suportă varianta prescurtată "valoare trz:"', () => {
		const d = extractPaymentDetails(FIDA_COMMENT);
		expect(d.originalAmount).toBe(800);
		expect(d.originalCurrency).toBe('RON');
	});
	it('USD la DirectAdmin', () => {
		const d = extractPaymentDetails(DA_COMMENT);
		expect(d.originalAmount).toBe(2900);
		expect(d.originalCurrency).toBe('USD');
	});
});

describe('parseMissingDocumentsRows', () => {
	it('reține doar plățile, convertește data din serial Excel', () => {
		const rows = parseMissingDocumentsRows([
			['Tip', 'Referinta', 'Data', 'Partener', 'Valoare', 'Valuta', 'Comentariu', 'IBAN'],
			['Plati fara document', '12326', 46219, null, '968.77', 'RON', HETZNER_COMMENT, 'RO86...'],
			[
				'Incasari fara document',
				'9794',
				46071,
				null,
				'1,479.83',
				'RON',
				'Incasare OP...',
				'RO86...'
			]
		]);
		expect(rows.payments.length).toBe(1);
		expect(rows.ignoredIncomes).toBe(1);
		const p = rows.payments[0];
		expect(p.reference).toBe('12326');
		// serial 46219 = 2026-07-16 (sistemul 1900, offset 1899-12-30)
		expect(p.date.toISOString().slice(0, 10)).toBe('2026-07-16');
		expect(p.originalAmount).toBe(18004);
		expect(p.originalCurrency).toBe('EUR');
	});
});

function payment(over: Partial<PaymentRow>): PaymentRow {
	return {
		reference: '1',
		date: new Date('2026-07-16'),
		partner: null,
		amountRon: 96877,
		comment: HETZNER_COMMENT,
		originalAmount: 18004,
		originalCurrency: 'EUR',
		...over
	};
}
function candidate(over: Partial<InvoiceCandidate>): InvoiceCandidate {
	return {
		gmailMessageId: 'g1',
		from: 'Hetzner Online GmbH <invoice@hetzner.com>',
		subject: 'Invoice R0012345678',
		date: new Date('2026-07-14'),
		amount: 18004,
		currency: 'EUR',
		supplierType: 'hetzner',
		...over
	};
}

describe('merchantTokens — fără fragmente din codurile bancare', () => {
	// Codurile bancare (REF, RRN, TID, autorizări) sunt alfanumerice; dacă le spargem
	// pe caractere non-alfabetice rămân fragmente ca NVPO care apar în ORICE plată cu cardul.
	it('HETZNER: păstrează comerciantul, elimină NVPO din 000NVPO261975UOO', () => {
		const tokens = merchantTokens(payment({ comment: HETZNER_COMMENT }));
		expect(tokens).toContain('HETZNER');
		expect(tokens).not.toContain('NVPO');
	});
	it('DIRECTADMIN: elimină RRDTDHDRM (9RRDTDHDRM9WVW9) și JRYLIO (TID:H9JRYLIO)', () => {
		const tokens = merchantTokens(payment({ comment: DA_COMMENT }));
		expect(tokens).toContain('DIRECTADMIN');
		expect(tokens).not.toContain('RRDTDHDRM');
		expect(tokens).not.toContain('JRYLIO');
		expect(tokens).not.toContain('NVPO');
	});
	it('CLAUDE: elimină RRUWQV (Q0RRUWQV26H30SO) și LMSE (TID:G0A3LMSE)', () => {
		const tokens = merchantTokens(payment({ comment: CLAUDE_COMMENT }));
		expect(tokens).toContain('CLAUDE');
		expect(tokens).not.toContain('RRUWQV');
		expect(tokens).not.toContain('LMSE');
		expect(tokens).not.toContain('NVPO');
	});
	it('FIDASOLUTIONS: elimină POSP (044POSP2621517B3), păstrează MARAMURES', () => {
		const tokens = merchantTokens(payment({ comment: FIDA_COMMENT }));
		expect(tokens).toContain('FIDASOLUTIONS');
		expect(tokens).toContain('MARAMURES'); // face parte din descriptorul comerciantului
		expect(tokens).not.toContain('POSP');
	});
	it('KESSELRING supraviețuiește (MPY*KESSELRING nu conține cifre)', () => {
		const tokens = merchantTokens(payment({ comment: KESSELRING_COMMENT }));
		expect(tokens).toContain('KESSELRING');
		expect(tokens).not.toContain('NVPO');
		expect(tokens).not.toContain('PAYW');
	});
});

// Scoruri EXACTE, nu etichete derivate: o etichetă ('sure'/'probable') ascunde
// modificări ale ponderilor, pragurilor și ferestrei. Componente: sumă exactă 60 /
// sumă în toleranța de 2% 40, comerciant 40, proximitate dată round(10*(1-zile/10)).
describe('scoreMatch — scoruri exacte pe componente', () => {
	const cases: Array<{
		name: string;
		p: Partial<PaymentRow>;
		c: Partial<InvoiceCandidate>;
		score: number;
		merchant: boolean;
	}> = [
		{
			name: 'sumă exactă + alias + aceeași zi = 60+40+10',
			p: {},
			c: { date: new Date('2026-07-16') },
			score: 110,
			merchant: true
		},
		{
			name: 'sumă exactă + alias + 5 zile = 60+40+5',
			p: {},
			c: { date: new Date('2026-07-21') },
			score: 105,
			merchant: true
		},
		{
			name: 'exact pe marginea ferestrei (10 zile) = 60+40+0',
			p: {},
			c: { date: new Date('2026-07-26') },
			score: 100,
			merchant: true
		},
		{
			name: 'în afara ferestrei (11 zile) = 0',
			p: {},
			c: { date: new Date('2026-07-27') },
			score: 0,
			merchant: false
		},
		{
			name: 'doar comerciant (fără sumă) = 40+10',
			p: {},
			c: { date: new Date('2026-07-16'), amount: undefined, currency: undefined },
			score: 50,
			merchant: true
		},
		{
			name: 'sumă în toleranța de 2% (18300 vs 18004) = 40+40+10',
			p: {},
			c: { date: new Date('2026-07-16'), amount: 18300 },
			score: 90,
			merchant: true
		},
		{
			name: 'sumă în afara toleranței (18500 = 2.75%) nu punctează = 40+10',
			p: {},
			c: { date: new Date('2026-07-16'), amount: 18500 },
			score: 50,
			merchant: true
		},
		{
			name: 'valută diferită nu punctează suma = 40+10',
			p: {},
			c: { date: new Date('2026-07-16'), currency: 'USD' },
			score: 50,
			merchant: true
		},
		{
			name: 'C1: sumă exactă fără NICIO dovadă de comerciant = 60+0+10',
			p: {},
			c: {
				date: new Date('2026-07-16'),
				from: 'Totally Unrelated Zzz <b@zzz.io>',
				subject: 'Receipt',
				supplierType: undefined
			},
			score: 70,
			merchant: false
		},
		{
			name: 'token scurt (NOV) nu e comerciant — prag de lungime',
			p: { comment: KESSELRING_COMMENT, originalAmount: 8109, originalCurrency: 'RON' },
			c: {
				date: new Date('2026-07-16'),
				from: 'NOV Solutions <a@nov-solutions.ro>',
				subject: 'Invoice',
				amount: undefined,
				currency: undefined,
				supplierType: undefined
			},
			score: 10,
			merchant: false
		},
		{
			name: 'I7: CARTON nu face match în interiorul lui SCARTONIS (limită de cuvânt)',
			p: { comment: CARTON_COMMENT, originalAmount: 5000, originalCurrency: 'RON' },
			c: {
				date: new Date('2026-07-16'),
				from: 'Scartonis Ltd <a@scartonis.com>',
				subject: 'Invoice',
				amount: undefined,
				currency: undefined,
				supplierType: undefined
			},
			score: 10,
			merchant: false
		},
		{
			name: 'I8: KESSELRING nu face match cu o factură FIDASOLUTIONS din același bucket ro-supplier',
			p: { comment: KESSELRING_COMMENT, originalAmount: 8109, originalCurrency: 'RON' },
			c: {
				date: new Date('2026-07-16'),
				from: 'Fida Solutions <facturi@fidasolutions.ro>',
				subject: 'Factura 99',
				amount: undefined,
				currency: undefined,
				supplierType: 'ro-supplier'
			},
			score: 10,
			merchant: false
		},
		{
			name: 'I8: MEDICI nu activează bucket-ul ro-supplier (aliasul „ICI" e eliminat)',
			p: { comment: MEDICI_COMMENT, originalAmount: 5000, originalCurrency: 'RON' },
			c: {
				date: new Date('2026-07-16'),
				from: 'ROTLD <facturi@rotld.ro>',
				subject: 'Factura',
				amount: undefined,
				currency: undefined,
				supplierType: 'ro-supplier'
			},
			score: 10,
			merchant: false
		},
		{
			name: 'I8: ro-supplier funcționează când aliasul e în AMBELE (KESSELRING)',
			p: { comment: KESSELRING_COMMENT, originalAmount: 8109, originalCurrency: 'RON' },
			c: {
				date: new Date('2026-07-16'),
				from: 'Kesselring SRL <facturi@kesselring.ro>',
				subject: 'Factura 1234',
				amount: undefined,
				currency: undefined,
				supplierType: 'ro-supplier'
			},
			score: 50,
			merchant: true
		}
	];

	for (const tc of cases) {
		it(tc.name, () => {
			const res = scoreMatch(payment(tc.p), candidate(tc.c));
			expect(res.score).toBe(tc.score);
			expect(res.merchantMatched).toBe(tc.merchant);
		});
	}
});

describe('matchPayments — scoring', () => {
	it('sumă+valută+comerciant+dată apropiată => match sigur (>=70)', () => {
		const res = matchPayments([payment({})], [candidate({})]);
		expect(res[0].match?.gmailMessageId).toBe('g1');
		expect(res[0].score).toBeGreaterThanOrEqual(70);
		expect(res[0].confidence).toBe('sure');
	});
	it('plata în RON nu face match pe suma RON cu factura în EUR', () => {
		const res = matchPayments(
			[payment({ originalAmount: 96877, originalCurrency: 'RON' })],
			[
				candidate({
					amount: 96877,
					currency: 'EUR',
					supplierType: 'openai',
					from: 'x <a@b.c>',
					subject: 'x'
				})
			]
		);
		// Garda pe valută e invariantul central al modulului: fără ea, 968.77 RON s-ar
		// lipi de o factură de 968.77 EUR. Verificăm ABSENȚA match-ului, nu doar 'sure'.
		expect(res[0].match).toBeUndefined();
		expect(res[0].confidence).not.toBe('sure');
	});
	it('doar comerciant, fără sumă => probabil, nu sigur', () => {
		const res = matchPayments(
			[payment({})],
			[candidate({ amount: undefined, currency: undefined })]
		);
		expect(res[0].confidence).toBe('probable');
	});
	it('în afara ferestrei de date => fără match', () => {
		const res = matchPayments([payment({})], [candidate({ date: new Date('2026-09-20') })]);
		expect(res[0].match).toBeUndefined();
	});
	it('o factură se atașează unei singure plăți (greedy pe scor)', () => {
		const p1 = payment({ reference: 'a' });
		const p2 = payment({ reference: 'b', date: new Date('2026-07-20') });
		const res = matchPayments([p1, p2], [candidate({})]);
		const matched = res.filter((r) => r.match);
		expect(matched.length).toBe(1);
		expect(matched[0].reference).toBe('a'); // data mai apropiată de factură
	});
	it('C1: sumă exactă fără dovadă de comerciant NU poate fi „sigur"', () => {
		// 60 (sumă) + 10 (aceeași zi) = exact 70 = SURE_THRESHOLD, dar expeditorul nu are
		// nicio legătură cu plata. Cu abonamente recurente pe aceeași sumă (două de 29.00
		// USD, mai multe de 8.00 RON) asta ar da „sigur" facturii furnizorului greșit.
		const res = matchPayments(
			[payment({})],
			[
				candidate({
					date: new Date('2026-07-16'),
					from: 'Totally Unrelated Zzz <b@zzz.io>',
					subject: 'Receipt',
					supplierType: undefined
				})
			]
		);
		expect(res[0].score).toBe(70);
		expect(res[0].confidence).toBe('probable');
	});

	it('doar comerciant, aceeași zi (scor 50) rămâne „probabil"', () => {
		const res = matchPayments(
			[payment({})],
			[candidate({ date: new Date('2026-07-16'), amount: undefined, currency: undefined })]
		);
		expect(res[0].score).toBe(50);
		expect(res[0].confidence).toBe('probable');
	});

	it('la scor egal câștigă factura cu data mai apropiată', () => {
		// Ambele perechi dau 108 (60+40+8): 2.4 zile și 2.0 zile rotunjesc la același bonus.
		const p1 = payment({ reference: 'departe', date: new Date('2026-07-16T09:36:00Z') });
		const p2 = payment({ reference: 'aproape', date: new Date('2026-07-16T00:00:00Z') });
		const res = matchPayments([p1, p2], [candidate({ date: new Date('2026-07-14T00:00:00Z') })]);
		expect(res[0].score).toBe(0);
		expect(res[1].score).toBe(108);
		expect(res[1].match?.gmailMessageId).toBe('g1');
		expect(res[0].match).toBeUndefined();
	});

	it('I3: plata rămasă fără opțiuni recuperează factura printr-o rocadă', () => {
		// Greedy pur ia P_early×C_new (110) și lasă P_late nematchuit, deși C_old e liberă
		// pentru P_early. Pasul de recuperare mută P_early pe C_old și dă C_new lui P_late.
		const pEarly = payment({ reference: 'early', date: new Date('2026-07-14') });
		const pLate = payment({ reference: 'late', date: new Date('2026-07-22') });
		const cOld = candidate({ gmailMessageId: 'old', date: new Date('2026-07-08') });
		const cNew = candidate({ gmailMessageId: 'new', date: new Date('2026-07-14') });
		const res = matchPayments([pEarly, pLate], [cOld, cNew]);
		expect(res[0].match?.gmailMessageId).toBe('old');
		expect(res[0].score).toBe(104);
		expect(res[1].match?.gmailMessageId).toBe('new');
		expect(res[1].score).toBe(102);
	});

	it('furnizor FĂRĂ parser: match pe tokenul din descriere (KESSELRING)', () => {
		const res = matchPayments(
			[
				payment({
					comment: KESSELRING_COMMENT,
					originalAmount: 8109,
					originalCurrency: 'RON',
					date: new Date('2026-07-17')
				})
			],
			[
				candidate({
					from: 'Kesselring SRL <facturi@kesselring.ro>',
					subject: 'Factura 1234',
					date: new Date('2026-07-17'),
					amount: undefined,
					currency: undefined,
					supplierType: undefined
				})
			]
		);
		// Fără sumă/valută, DOAR tokenul de comerciant poate ridica scorul: 40 + 10.
		expect(res[0].score).toBe(50);
		expect(res[0].match?.gmailMessageId).toBe('g1');
	});

	it('nu face match pe cuvinte generice din descriere', () => {
		const res = matchPayments(
			[payment({ originalAmount: null, originalCurrency: null })],
			[
				candidate({
					from: 'Online Payment <noreply@random.com>',
					subject: 'Invoice',
					amount: undefined,
					currency: undefined,
					supplierType: undefined
				})
			]
		);
		expect(res[0].match).toBeUndefined();
	});

	it('nu face match pe un fragment de referință bancară (NVPO)', () => {
		// 000NVPO… e prefixul de referință BT prezent în ORICE plată cu cardul;
		// un expeditor care conține din întâmplare „NVPO" nu e comerciantul plății.
		const res = matchPayments(
			[payment({})],
			[
				candidate({
					from: 'NVPO Services <a@nvpo-invest.ro>',
					subject: 'Invoice',
					amount: undefined,
					currency: undefined,
					supplierType: undefined
				})
			]
		);
		expect(res[0].match).toBeUndefined();
	});

	it('CLAUDE SUB face match pe aliasul anthropic', () => {
		const res = matchPayments(
			[payment({ comment: CLAUDE_COMMENT, originalAmount: 21156, date: new Date('2026-07-24') })],
			[
				candidate({
					from: 'Anthropic <receipts@anthropic.com>',
					subject: 'Your receipt',
					supplierType: 'anthropic',
					amount: undefined,
					currency: undefined,
					date: new Date('2026-07-24')
				})
			]
		);
		// Nici „CLAUDE" ca token nu apare în emailul Anthropic: doar aliasul poate puncta.
		expect(res[0].score).toBe(50);
		expect(res[0].match?.gmailMessageId).toBe('g1');
	});
});

describe('matchPayments — asignare optimă', () => {
	// „Comerciant" = plată Hetzner + factură cu alias hetzner; „străin" = expeditor fără
	// nicio legătură, care coincide doar pe sumă și valută.
	const hetznerPayment = (over: Partial<PaymentRow>) => payment(over);

	it('N1: nu destramă un match confirmat de comerciant pentru a bifa unul pe coincidență de sumă', () => {
		// owner→C_best 110 (comerciant), owner→C_alt 70 (doar suma), newcomer→C_best 50
		// (comerciant), newcomer→C_alt 10 (neeligibil). Maximizarea numărului de match-uri
		// ar da owner→C_alt + newcomer→C_best: owner ar primi factura altui furnizor.
		const owner = hetznerPayment({ reference: 'owner', date: new Date('2026-07-16') });
		const newcomer = hetznerPayment({
			reference: 'newcomer',
			date: new Date('2026-07-16'),
			originalAmount: 9999
		});
		const cBest = candidate({ gmailMessageId: 'best', date: new Date('2026-07-16') });
		const cAlt = candidate({
			gmailMessageId: 'alt',
			date: new Date('2026-07-16'),
			from: 'Totally Unrelated Zzz <b@zzz.io>',
			subject: 'Receipt',
			supplierType: undefined
		});

		// Verificăm întâi scorurile pe care se bazează scenariul.
		expect(scoreMatch(owner, cBest)).toEqual({ score: 110, merchantMatched: true });
		expect(scoreMatch(owner, cAlt)).toEqual({ score: 70, merchantMatched: false });
		expect(scoreMatch(newcomer, cBest)).toEqual({ score: 50, merchantMatched: true });
		expect(scoreMatch(newcomer, cAlt).score).toBeLessThan(40); // neeligibil

		const res = matchPayments([owner, newcomer], [cBest, cAlt]);
		expect(res[0].match?.gmailMessageId).toBe('best');
		expect(res[0].confidence).toBe('sure');
		expect(res[1].match).toBeUndefined();
	});

	it('N2: două match-uri confirmate de comerciant bat unul singur mai puternic', () => {
		// owner→D_best 100, owner→D_alt 40, newcomer→D_best 41, newcomer→D_alt în afara
		// ferestrei. Toate au dovadă de comerciant, deci nu riscăm furnizorul greșit.
		const owner = hetznerPayment({ reference: 'owner', date: new Date('2026-07-16') });
		const newcomer = hetznerPayment({
			reference: 'newcomer',
			date: new Date('2026-07-17'),
			originalAmount: 9999
		});
		const dBest = candidate({ gmailMessageId: 'best', date: new Date('2026-07-26') });
		const dAlt = candidate({
			gmailMessageId: 'alt',
			date: new Date('2026-07-06'),
			amount: undefined,
			currency: undefined
		});

		expect(scoreMatch(owner, dBest)).toEqual({ score: 100, merchantMatched: true });
		expect(scoreMatch(owner, dAlt)).toEqual({ score: 40, merchantMatched: true });
		expect(scoreMatch(newcomer, dBest)).toEqual({ score: 41, merchantMatched: true });
		expect(scoreMatch(newcomer, dAlt).score).toBe(0); // în afara ferestrei

		const res = matchPayments([owner, newcomer], [dBest, dAlt]);
		expect(res[0].match?.gmailMessageId).toBe('alt');
		expect(res[1].match?.gmailMessageId).toBe('best');
	});

	it('N3: lanț de adâncime 2 — toate cele trei plăți primesc factură', () => {
		const p1 = hetznerPayment({ reference: 'p1', date: new Date('2026-07-08') });
		const p2 = hetznerPayment({ reference: 'p2', date: new Date('2026-07-20') });
		const p3 = hetznerPayment({ reference: 'p3', date: new Date('2026-07-21') });
		const i1 = candidate({ gmailMessageId: 'i1', date: new Date('2026-06-30') });
		const i2 = candidate({ gmailMessageId: 'i2', date: new Date('2026-07-10') });
		const i3 = candidate({ gmailMessageId: 'i3', date: new Date('2026-07-20') });

		const res = matchPayments([p1, p2, p3], [i1, i2, i3]);
		expect(res.map((r) => r.match?.gmailMessageId)).toEqual(['i1', 'i2', 'i3']);
	});

	it('determinist: aceeași intrare, același rezultat', () => {
		const payments = [
			hetznerPayment({ reference: 'a', date: new Date('2026-07-16') }),
			hetznerPayment({ reference: 'b', date: new Date('2026-07-17') }),
			hetznerPayment({ reference: 'c', date: new Date('2026-07-18') })
		];
		const candidates = [
			candidate({ gmailMessageId: 'x', date: new Date('2026-07-16') }),
			candidate({ gmailMessageId: 'y', date: new Date('2026-07-17') }),
			candidate({ gmailMessageId: 'z', date: new Date('2026-07-18') })
		];
		const first = matchPayments(payments, candidates).map((r) => [
			r.match?.gmailMessageId,
			r.score
		]);
		for (let i = 0; i < 5; i++) {
			expect(
				matchPayments(payments, candidates).map((r) => [r.match?.gmailMessageId, r.score])
			).toEqual(first);
		}
	});
});

describe('parseMissingDocumentsRows — sume și date invalide', () => {
	const row = (over: { data?: unknown; valoare?: unknown }) => [
		'Plati fara document',
		'12326',
		over.data ?? 46219,
		null,
		over.valoare ?? '968.77',
		'RON',
		HETZNER_COMMENT,
		'RO86...'
	];

	it('I5: „968,77" (virgulă zecimală) = 96877 bani, nu 9687700', () => {
		const { payments } = parseMissingDocumentsRows([row({ valoare: '968,77' })]);
		expect(payments[0].amountRon).toBe(96877);
	});
	it('I5: „1,479.83" (virgulă ca separator de mii) = 147983 bani', () => {
		const { payments } = parseMissingDocumentsRows([row({ valoare: '1,479.83' })]);
		expect(payments[0].amountRon).toBe(147983);
	});
	it('I5: „1.234,56" (format european) = 123456 bani', () => {
		const { payments } = parseMissingDocumentsRows([row({ valoare: '1.234,56' })]);
		expect(payments[0].amountRon).toBe(123456);
	});

	it('I4: data nevalidă e numărată, nu strecurată ca Invalid Date', () => {
		const res = parseMissingDocumentsRows([row({ data: '16.07.2026' })]);
		expect(res.invalidDates).toBe(1);
		expect(res.payments.length).toBe(1);
	});
	it('I4: o plată cu dată nevalidă nu primește match', () => {
		const { payments } = parseMissingDocumentsRows([row({ data: '16.07.2026' })]);
		const res = matchPayments(payments, [candidate({})]);
		expect(res[0].match).toBeUndefined();
		expect(res[0].score).toBe(0);
	});
	it('I4: scorul unei plăți cu dată nevalidă e 0, nu NaN', () => {
		// Prin matchPayments NaN e înghițit (NaN >= prag e false); doar aici se vede
		// diferența dintre o gardă explicită și propagarea accidentală a lui NaN.
		const { payments } = parseMissingDocumentsRows([row({ data: '16.07.2026' })]);
		const res = scoreMatch(payments[0], candidate({}));
		expect(res.score).toBe(0);
		expect(res.merchantMatched).toBe(false);
	});
	it('rândurile valide nu sunt numărate ca date nevalide', () => {
		const res = parseMissingDocumentsRows([row({})]);
		expect(res.invalidDates).toBe(0);
	});
});

describe('extractPaymentDetails — formate de număr', () => {
	const withValue = (v: string) =>
		`valoare tranzactie: ${v} EUR RRN:1 comision tranzactie 0.00 RON`;

	it('I5: „1.234,56" european = 123456 bani', () => {
		expect(extractPaymentDetails(withValue('1.234,56')).originalAmount).toBe(123456);
	});
	it('I5: „1,234.56" american = 123456 bani', () => {
		expect(extractPaymentDetails(withValue('1,234.56')).originalAmount).toBe(123456);
	});
	it('„180,04" cu virgulă zecimală = 18004 bani', () => {
		expect(extractPaymentDetails(withValue('180,04')).originalAmount).toBe(18004);
	});
});
