import { describe, test, expect } from 'bun:test';
import {
	roundToStep,
	ceilToStep,
	netToEurCents,
	eurCentsToReferenceMinutes,
	invoiceCreditEligibility,
	overageDraftEditBlockReason,
	overageLineAmountCents,
	overageLineShape,
	lowCreditTransition,
	availableForTask,
	consumptionWorkedLabel,
	startOfMonthUtc,
	splitTaskSettlement,
	invoicedOverageMinutes,
	overageNoticeSentence,
	OVERAGE_BLOCK_MINUTES,
	overageMonthKey,
	LEDGER_KIND_LABELS,
	type InvoiceCreditCandidate
} from '../hour-credits';

describe('roundToStep', () => {
	test('rotunjește la cel mai apropiat pas', () => {
		expect(roundToStep(0, 15)).toBe(0);
		expect(roundToStep(7, 15)).toBe(0);
		expect(roundToStep(8, 15)).toBe(15);
		expect(roundToStep(1232.7, 15)).toBe(1230);
		expect(roundToStep(100, 30)).toBe(90);
		expect(roundToStep(100, 60)).toBe(120);
	});

	test('pas invalid → minut întreg; NaN → 0', () => {
		expect(roundToStep(37.4, 0)).toBe(37);
		expect(roundToStep(NaN, 15)).toBe(0);
	});
});

describe('netToEurCents', () => {
	test('EUR rămâne, RON se împarte la cursul BNR', () => {
		expect(netToEurCents(65000, 'EUR', null)).toBe(65000);
		expect(netToEurCents(560800, 'ron', 4.96)).toBe(113065); // 5.608 lei / 4,96 = 1.130,65 €
	});

	test('aruncă pe sumă invalidă, curs lipsă la RON sau monedă neacceptată', () => {
		expect(() => netToEurCents(0, 'EUR', null)).toThrow();
		expect(() => netToEurCents(100, 'RON', null)).toThrow(/Curs BNR/);
		expect(() => netToEurCents(100, 'USD', 4.5)).toThrow(/neacceptată/);
	});
});

describe('eurCentsToReferenceMinutes', () => {
	test('floor la minut: creditul nu depășește banii plătiți', () => {
		expect(eurCentsToReferenceMinutes(113065, 55)).toBe(1233); // 20 h 33 min
		expect(eurCentsToReferenceMinutes(5500, 55)).toBe(60);
		expect(eurCentsToReferenceMinutes(91, 55)).toBe(0); // sub un minut
		expect((1233 * 55 * 100) / 60).toBeLessThanOrEqual(113065);
	});

	test('validări', () => {
		expect(() => eurCentsToReferenceMinutes(-1, 55)).toThrow();
		expect(() => eurCentsToReferenceMinutes(1000, 0)).toThrow(/referință/);
	});
});

describe('invoiceCreditEligibility', () => {
	const paid = (over: Partial<InvoiceCreditCandidate> = {}): InvoiceCreditCandidate => ({
		status: 'paid',
		hostingAccountId: null,
		externalSource: null,
		amount: 100000,
		currency: 'RON',
		...over
	});
	const ok = { clientOptedIn: true, isHoursOrderInvoice: false };

	test('factura plătită a unui client bifat e eligibilă', () => {
		expect(invoiceCreditEligibility(paid(), ok)).toEqual({ eligible: true, reason: null });
		expect(invoiceCreditEligibility(paid({ currency: 'eur' }), ok).eligible).toBe(true);
	});

	test('excluderile structurale vin înaintea bifei clientului', () => {
		const noOptIn = { clientOptedIn: false, isHoursOrderInvoice: false };
		expect(
			invoiceCreditEligibility(paid({ externalSource: 'hour-overage' }), noOptIn).reason
		).toMatch(/depășire/);
		expect(invoiceCreditEligibility(paid({ hostingAccountId: 'h1' }), noOptIn).reason).toMatch(
			/hosting/
		);
		// Factura din „Adaugă ore": creditul a intrat deja la emitere, deci plata ei
		// NU mai creditează — altfel clientul ar primi orele de două ori.
		expect(
			invoiceCreditEligibility(paid({ externalSource: 'hour-credit' }), { ...noOptIn }).eligible
		).toBe(false);
		expect(
			invoiceCreditEligibility(paid({ externalSource: 'hour-credit' }), { ...noOptIn }).reason
		).toMatch(/emitere/);
		expect(invoiceCreditEligibility(paid({ externalSource: 'meta-ads' }), noOptIn).reason).toMatch(
			/ads/
		);
		expect(
			invoiceCreditEligibility(paid(), { clientOptedIn: true, isHoursOrderInvoice: true }).reason
		).toMatch(/comenzi de ore/);
	});

	test('neplătită, nebifat, sumă zero, monedă neacceptată', () => {
		expect(invoiceCreditEligibility(paid({ status: 'sent' }), ok).reason).toMatch(/nu e plătită/);
		expect(invoiceCreditEligibility(paid(), { ...ok, clientOptedIn: false }).reason).toMatch(
			/bifa/
		);
		expect(invoiceCreditEligibility(paid({ amount: 0 }), ok).reason).toMatch(/zero/);
		expect(invoiceCreditEligibility(paid({ currency: 'USD' }), ok).reason).toMatch(/USD/);
	});

	test('`structural` separă „nu se creditează niciodată" de „adminul poate rezolva"', () => {
		const structural = (over: Partial<InvoiceCreditCandidate>, ctx = ok) =>
			invoiceCreditEligibility(paid(over), ctx).structural === true;
		// Nu au ce căuta în lista „Necreditate".
		expect(structural({ externalSource: 'hour-overage' })).toBe(true);
		expect(structural({ externalSource: 'hour-credit' })).toBe(true);
		expect(structural({ hostingAccountId: 'h1' })).toBe(true);
		expect(structural({ externalSource: 'google-ads' })).toBe(true);
		expect(structural({}, { clientOptedIn: true, isHoursOrderInvoice: true })).toBe(true);
		// Rezolvabile: apar în listă cu motivul.
		expect(structural({ currency: 'USD' })).toBe(false);
		expect(structural({ amount: 0 })).toBe(false);
		expect(structural({}, { ...ok, clientOptedIn: false })).toBe(false);
	});
});

describe('startOfMonthUtc', () => {
	test('prima zi a lunii, ora 00:00 UTC', () => {
		expect(startOfMonthUtc(new Date('2026-09-11T10:00:00Z')).toISOString()).toBe(
			'2026-09-01T00:00:00.000Z'
		);
	});
});

describe('ceilToStep', () => {
	test('rotunjește în sus la pas; multiplii rămân', () => {
		expect(ceilToStep(0, 15)).toBe(0);
		expect(ceilToStep(1, 15)).toBe(15);
		expect(ceilToStep(15, 15)).toBe(15);
		expect(ceilToStep(142, 15)).toBe(150);
		expect(ceilToStep(142, 10)).toBe(150);
		expect(ceilToStep(7, 10)).toBe(10);
	});
	test('pas invalid → minut întreg', () => {
		expect(ceilToStep(37, 0)).toBe(37);
	});
});

describe('splitTaskSettlement', () => {
	// O singură rotunjire, pe timpul lucrat. din_credit + depășire == facturabil.
	// Depășirea se facturează în ore întregi; surplusul rămâne credit (addendum §10).
	const cases: Array<[number, number, number, number, number, number, number, number]> = [
		// sold, actual, pas → facturabil, din credit, depășire, facturat, surplus
		[600, 150, 15, 150, 150, 0, 0, 0],
		[100, 142, 15, 150, 100, 50, 60, 10],
		[0, 7, 15, 15, 0, 15, 60, 45],
		[-20, 60, 15, 60, 0, 60, 60, 0],
		[10, 20, 15, 30, 10, 20, 60, 40]
	];
	for (const [balance, actual, step, billed, consumed, overage, invoiced, surplus] of cases) {
		test(`sold ${balance}, lucrat ${actual}, pas ${step}`, () => {
			const r = splitTaskSettlement({
				realMinutes: actual,
				balanceMinutes: balance,
				stepMinutes: step
			});
			expect(r).toEqual({
				billedMinutes: billed,
				consumedMinutes: consumed,
				overageRealMinutes: overage,
				invoicedMinutes: invoiced,
				surplusMinutes: surplus
			});
			expect(r.consumedMinutes + r.overageRealMinutes).toBe(r.billedMinutes);
		});
	}

	test('tabelul din addendum: sold după = sold − din credit + surplus', () => {
		// sold, lucrat → din credit, depășire, facturat, sold după
		const table: Array<[number, number, number, number, number, number]> = [
			[120, 150, 120, 30, 60, 30],
			[0, 15, 0, 15, 60, 45],
			[60, 195, 60, 135, 180, 45],
			[300, 150, 150, 0, 0, 150],
			[-20, 60, 0, 60, 60, -20]
		];
		for (const [balance, actual, consumed, overage, invoiced, after] of table) {
			const r = splitTaskSettlement({
				realMinutes: actual,
				balanceMinutes: balance,
				stepMinutes: 15
			});
			expect(r.consumedMinutes).toBe(consumed);
			expect(r.overageRealMinutes).toBe(overage);
			expect(r.invoicedMinutes).toBe(invoiced);
			expect(balance - r.consumedMinutes + r.surplusMinutes).toBe(after);
		}
	});

	test('invarianții 17–18, pentru orice (sold, lucrat, pas)', () => {
		expect(OVERAGE_BLOCK_MINUTES).toBe(60);
		for (const step of [1, 10, 15, 30, 60]) {
			for (const balance of [-45, 0, 7, 30, 60, 125, 600]) {
				for (let actual = 0; actual <= 400; actual += 7) {
					const r = splitTaskSettlement({
						realMinutes: actual,
						balanceMinutes: balance,
						stepMinutes: step
					});
					expect(r.invoicedMinutes % 60).toBe(0);
					expect(r.invoicedMinutes).toBeGreaterThanOrEqual(r.overageRealMinutes);
					expect(r.surplusMinutes).toBe(r.invoicedMinutes - r.overageRealMinutes);
					expect(r.surplusMinutes).toBeGreaterThanOrEqual(0);
					expect(r.surplusMinutes).toBeLessThan(60);
					// Minimum 1 h la orice depășire; nimic facturat fără depășire.
					expect(r.invoicedMinutes === 0).toBe(r.overageRealMinutes === 0);
					// Surplusul nu poate depăși ce s-a facturat peste consum: soldul de după
					// e soldul de dinainte, minus consumul, plus surplusul.
					const after = balance - r.consumedMinutes + r.surplusMinutes;
					expect(after).toBe(balance - r.billedMinutes + r.invoicedMinutes);
				}
			}
		}
	});
});

describe('invoicedOverageMinutes', () => {
	test('în sus, la oră întreagă; minimum 1 h', () => {
		expect(invoicedOverageMinutes(0)).toBe(0);
		expect(invoicedOverageMinutes(-5)).toBe(0);
		expect(invoicedOverageMinutes(1)).toBe(60);
		expect(invoicedOverageMinutes(60)).toBe(60);
		expect(invoicedOverageMinutes(61)).toBe(120);
		expect(invoicedOverageMinutes(135)).toBe(180);
	});
});

describe('overageNoticeSentence — fraza de depășire din email și WhatsApp', () => {
	test('cu surplus, fără surplus, fără tarif', () => {
		expect(
			overageNoticeSentence({
				overageMinutes: 30,
				invoicedMinutes: 60,
				surplusMinutes: 30,
				unitRateEur: 65
			})
		).toBe('30 min peste credit → 1 h facturate la 65 €/h; 30 min rămân credit.');
		expect(
			overageNoticeSentence({
				overageMinutes: 120,
				invoicedMinutes: 120,
				surplusMinutes: 0,
				unitRateEur: 98
			})
		).toBe('2 h peste credit → 2 h facturate la 98 €/h.');
		expect(
			overageNoticeSentence({
				overageMinutes: 135,
				invoicedMinutes: 180,
				surplusMinutes: 45,
				unitRateEur: null
			})
		).toBe('2 h 15 min peste credit → 3 h facturate; 45 min rămân credit.');
	});
});

describe('overageLineAmountCents', () => {
	test('suma se calculează din minute, nu din ore rotunjite', () => {
		expect(overageLineAmountCents(10, 65)).toBe(1083); // nu 1105
		expect(overageLineAmountCents(15, 65)).toBe(1625);
		expect(overageLineAmountCents(60, 98)).toBe(9800);
	});
});

describe('overageLineShape', () => {
	test('cantitate × preț === sumă, pentru orice număr de minute', () => {
		for (const rate of [50, 65, 98, 147]) {
			for (let minutes = 1; minutes <= 600; minutes++) {
				const s = overageLineShape(minutes, rate);
				expect(s.amountCents).toBe(overageLineAmountCents(minutes, rate));
				expect(s.quantity * s.rateCents).toBe(s.amountCents);
				// Keez primește cantitatea cu 2 zecimale: rotunjirea nu are voie să o schimbe.
				expect(Math.round(s.quantity * 100) / 100).toBe(s.quantity);
			}
		}
	});

	test('multiplu de 15 min → ore × tarif orar; altfel 1 × suma', () => {
		expect(overageLineShape(45, 65)).toEqual({
			quantity: 0.75,
			rateCents: 6500,
			amountCents: 4875,
			unit: 'hour'
		});
		expect(overageLineShape(50, 65)).toEqual({
			quantity: 1,
			rateCents: 5417,
			amountCents: 5417,
			unit: 'piece'
		});
	});
});

describe('overageLineShape — ore întregi (singura formă care pleacă din decontare)', () => {
	test('cantitate întreagă, UM oră, cantitate × tarif === sumă, la orice tarif', () => {
		for (const rate of [50, 65, 98, 147]) {
			for (let hours = 1; hours <= 12; hours++) {
				const s = overageLineShape(hours * 60, rate);
				expect(s).toEqual({
					quantity: hours,
					rateCents: rate * 100,
					amountCents: hours * rate * 100,
					unit: 'hour'
				});
				expect(Number.isInteger(s.quantity)).toBe(true);
			}
		}
	});
});

describe('kind-ul correction', () => {
	test('are etichetă', () => {
		expect(LEDGER_KIND_LABELS.correction).toBe('Corecție');
	});
});

describe('overageMonthKey', () => {
	test('luna calendaristică în Europe/Bucharest', () => {
		expect(overageMonthKey(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10'); // 01:30 ora RO
		expect(overageMonthKey(new Date('2026-09-11T10:00:00Z'))).toBe('2026-09');
	});
});

describe('overageDraftEditBlockReason', () => {
	const draft = {
		externalSource: 'hour-overage',
		notes: 'hour-overage:2026-09 — ore peste creditul clientului',
		amount: 14625,
		taxRate: 2100,
		currency: 'EUR',
		clientId: 'c1'
	};

	test('facturile obișnuite nu sunt atinse', () => {
		expect(
			overageDraftEditBlockReason({ ...draft, externalSource: null }, { amount: 1, clientId: 'x' })
		).toBeNull();
	});

	test('formularul care retrimite aceleași valori trece', () => {
		// Formularul trimite și câmpuri pe care garda nu le privește (ex. scadența).
		const formPayload = {
			amount: 146.25,
			taxRate: 21,
			currency: 'EUR',
			clientId: 'c1',
			notes: draft.notes + ' — verificat',
			dueDate: '2026-10-01'
		};
		expect(overageDraftEditBlockReason(draft, formPayload)).toBeNull();
	});

	test('suma, cota, moneda și clientul vin din linii — nu se editează din antet', () => {
		expect(overageDraftEditBlockReason(draft, { amount: 200 })).toMatch(/depășire/);
		expect(overageDraftEditBlockReason(draft, { taxRate: 19 })).toMatch(/depășire/);
		expect(overageDraftEditBlockReason(draft, { currency: 'RON' })).toMatch(/depășire/);
		expect(overageDraftEditBlockReason(draft, { clientId: 'c2' })).toMatch(/depășire/);
	});

	test('nota trebuie să păstreze marcajul lunii (după el se găsește draftul)', () => {
		expect(overageDraftEditBlockReason(draft, { notes: 'altă notă' })).toMatch(
			/hour-overage:2026-09/
		);
		expect(overageDraftEditBlockReason(draft, { notes: '' })).toMatch(/hour-overage:2026-09/);
	});
});

describe('lowCreditTransition — alerta „credit scăzut" pe DISPONIBIL', () => {
	const base = { balanceMinutes: 600, reservedMinutes: 0, thresholdMinutes: 120, notified: false };

	test('soldul e peste prag, dar rezervările îl duc sub → alertă (sold 600, rezervat 500)', () => {
		expect(lowCreditTransition({ ...base, reservedMinutes: 500 })).toEqual({
			action: 'notify',
			availableMinutes: 100
		});
	});

	test('deja notificat → nu se repetă', () => {
		expect(lowCreditTransition({ ...base, reservedMinutes: 500, notified: true }).action).toBe(
			'none'
		);
	});

	test('disponibilul urcă înapoi peste prag → se reînarmează', () => {
		expect(lowCreditTransition({ ...base, notified: true }).action).toBe('rearm');
	});

	test('peste prag și nenotificat → nimic', () => {
		expect(lowCreditTransition(base).action).toBe('none');
	});
});

describe('availableForTask — avertizarea din formularul de task', () => {
	test('task nou: disponibil = sold − rezervat', () => {
		expect(
			availableForTask({ balanceMinutes: 600, reservedMinutes: 400, ownReservedMinutes: 0 })
		).toBe(200);
	});

	test('task existent: propria rezervare nu se scade de două ori', () => {
		// Taskul editat rezervă deja 300 din cele 400.
		expect(
			availableForTask({ balanceMinutes: 600, reservedMinutes: 400, ownReservedMinutes: 300 })
		).toBe(500);
	});

	test('rezervarea proprie mai mare decât totalul (catalog schimbat) nu umflă disponibilul', () => {
		expect(
			availableForTask({ balanceMinutes: 600, reservedMinutes: 100, ownReservedMinutes: 300 })
		).toBe(600);
	});
});

describe('consumptionWorkedLabel — orele lucrate, cu specializarea și fără tarif', () => {
	test('doar specializarea: fără tarif și fără explicații despre referință', () => {
		expect(
			consumptionWorkedLabel({
				rateLabel: 'Development',
				rateEur: 65,
				multiplierPct: 100,
				modeLabel: 'Standard'
			})
		).toBe('Development');
	});

	test('regim cu majorare: numele regimului, fără tarif', () => {
		expect(
			consumptionWorkedLabel({
				rateLabel: 'Development',
				rateEur: 65,
				multiplierPct: 150,
				modeLabel: 'Urgență'
			})
		).toBe('Development, Urgență');
	});
});
