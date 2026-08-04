import { describe, it, expect } from 'bun:test';
import {
	extractPaymentDetails,
	parseMissingDocumentsRows,
	matchPayments,
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
	it('furnizor FĂRĂ parser: match pe tokenul din descriere (KESSELRING)', () => {
		const KESSELRING_COMMENT =
			'  Plata la POS non-BT cu card VISA;EPOS 17/07/2026 4210252 TID:PAYW0006 MPY*KESSELRING SRL    ROZ  NOV RO 42444505 valoare tranzactie: 81.09 RON RRN:619811671945 comision tranzactie 0.00 RON;REF: 000NVPO262012NnP; ';
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
					amount: 8109,
					currency: 'RON',
					supplierType: undefined
				})
			]
		);
		expect(res[0].confidence).toBe('sure');
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

	it('CLAUDE SUB face match pe aliasul anthropic', () => {
		const res = matchPayments(
			[payment({ comment: CLAUDE_COMMENT, originalAmount: 21156, date: new Date('2026-07-24') })],
			[
				candidate({
					from: 'Anthropic <receipts@anthropic.com>',
					subject: 'Your receipt',
					supplierType: 'anthropic',
					amount: 21156,
					date: new Date('2026-07-24')
				})
			]
		);
		expect(res[0].confidence).toBe('sure');
	});
});
