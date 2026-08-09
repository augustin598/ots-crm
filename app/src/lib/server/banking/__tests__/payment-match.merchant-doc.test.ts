import { describe, it, expect } from 'bun:test';
import {
	extractPaymentDetails,
	matchPayments,
	scoreMatch,
	type InvoiceCandidate,
	type PaymentRow
} from '../payment-match';
import { parseInvoiceText } from '$lib/server/gmail/pdf-parser';

/**
 * Cazul real raportat: plată cu cardul la FIDA SOLUTIONS (parcare Suceava, 8,00 lei,
 * 03.08.2026). Emailul vine de la primărie, subiectul e despre parcare, iar numele
 * furnizorului apare DOAR în PDF-ul atașat. Fără textul documentului în „fân", nicio
 * dovadă de comerciant nu există și potrivirea nu poate ajunge „sigură".
 */
const FIDA_COMMENT =
	'Plata la POS;EPOS 03/08/2026 MID 644214659202RON MPY*fidasolutions Maramures ROM valoare trz: 8.00 RON RRN:322793237391';

function payment(comment: string, overrides: Partial<PaymentRow> = {}): PaymentRow {
	return {
		reference: '12361',
		date: new Date(Date.UTC(2026, 7, 3)),
		partner: null,
		amountRon: 800,
		comment,
		...extractPaymentDetails(comment),
		...overrides
	};
}

function candidate(overrides: Partial<InvoiceCandidate> = {}): InvoiceCandidate {
	return {
		gmailMessageId: 'msg-fida',
		from: 'noreply@primariasv.ro',
		subject: 'Plata parcare Municipiu Suceava',
		date: new Date(Date.UTC(2026, 7, 3)),
		amount: 800,
		currency: 'RON',
		...overrides
	};
}

describe('potrivire de comerciant pe textul documentului', () => {
	it('FIDA: fără textul documentului rămâne doar „probabil" (sumă + dată, fără comerciant)', () => {
		const [result] = matchPayments([payment(FIDA_COMMENT)], [candidate()]);
		expect(result.confidence).toBe('probable');
		expect(result.score).toBe(70);
	});

	it('FIDA: cu numele furnizorului din PDF potrivirea devine „sigură"', () => {
		const [result] = matchPayments(
			[payment(FIDA_COMMENT)],
			[candidate({ documentText: 'FIDA SOLUTIONS' })]
		);
		expect(result.match?.gmailMessageId).toBe('msg-fida');
		expect(result.confidence).toBe('sure');
		// 60 (sumă exactă) + 40 (comerciant) + 10 (aceeași zi)
		expect(result.score).toBe(110);
	});

	it('tokenul lipit din extras („FIDASOLUTIONS") acoperă cuvinte CONSECUTIVE din denumire', () => {
		expect(
			scoreMatch(payment(FIDA_COMMENT), candidate({ documentText: 'S.C. FIDA SOLUTIONS S.R.L.' }))
				.merchantMatched
		).toBe(true);
	});

	it('ordinea cuvintelor contează: „SOLUTIONS FIDA GRUP" nu confirmă „FIDASOLUTIONS"', () => {
		expect(
			scoreMatch(payment(FIDA_COMMENT), candidate({ documentText: 'SOLUTIONS FIDA GRUP' }))
				.merchantMatched
		).toBe(false);
	});
});

describe('potrivire de comerciant pe document — fals pozitive', () => {
	it('tokenul din interiorul unui cuvânt („CARTON" în „SCARTONIS") nu e dovadă', () => {
		const p = payment('Plata la POS;EPOS 03/08/2026 MPY*CARTON valoare trz: 8.00 RON');
		const c = candidate({
			gmailMessageId: 'msg-scartonis',
			from: 'facturi@scartonis.ro',
			subject: 'Document contabil',
			documentText: 'SCARTONIS PRINT SRL'
		});
		expect(scoreMatch(p, c).merchantMatched).toBe(false);
	});

	/**
	 * De ce „fânul" e numele furnizorului și nu tot textul PDF-ului: descrierea bancară
	 * a plății FIDA conține și „Maramures" (localitatea terminalului), care apare
	 * întâmplător în corpul facturii ALTUI furnizor. Cu textul întreg în fân, plata ar
	 * primi dovadă de comerciant pentru factura greșită și ar fi etichetată „sigură".
	 */
	it('un cuvânt din CORPUL facturii altui furnizor nu produce dovadă de comerciant', () => {
		const altInvoice = `Furnizor
ALFA PRINT SRL
CIF: RO12345678
FACTURA Nr. 100200
Data: 03.08.2026
1 Livrare colete in judetul Maramures 1 8,00 8,00
Total plata 8,00 LEI`;
		const parsed = parseInvoiceText(altInvoice);
		expect(parsed.supplierName).toBe('ALFA PRINT SRL');
		// riscul e real: cuvântul chiar există în document
		expect(altInvoice.toUpperCase()).toContain('MARAMURES');

		const c = candidate({
			gmailMessageId: 'msg-alfa',
			from: 'facturi@alfaprint.ro',
			subject: 'Document contabil',
			documentText: parsed.supplierName
		});
		expect(scoreMatch(payment(FIDA_COMMENT), c).merchantMatched).toBe(false);
	});

	it('fără documentText comportamentul rămâne exact cel de dinainte', () => {
		const p = payment(FIDA_COMMENT);
		const c = candidate({ from: 'billing@fidasolutions.ro', subject: 'Factura' });
		expect(scoreMatch(p, c).merchantMatched).toBe(true);
		expect(scoreMatch(p, candidate()).merchantMatched).toBe(false);
	});
});
