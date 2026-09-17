import { describe, test, expect } from 'bun:test';
import {
	roundToStep,
	netToEurCents,
	eurCentsToReferenceMinutes,
	invoiceCreditEligibility,
	overageDraftEditBlockReason,
	lowCreditTransition,
	availableForTask,
	consumptionWorkedLabel,
	startOfMonthUtc,
	splitTaskSettlement,
	overageMonthKey,
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
	test('exemplul din spec: 5.608 RON ≈ 1.130,65 € ÷ 55 €/h ≈ 20,5 h', () => {
		expect(eurCentsToReferenceMinutes(113065, 55, 15)).toBe(1230); // 20 h 30 min
	});

	test('10 h Development la 65 € = 650 € → 11 h 45 min la referința 55 €', () => {
		expect(eurCentsToReferenceMinutes(65000, 55, 15)).toBe(705);
	});

	test('sub jumătate de pas → 0 (nu se creditează nimic)', () => {
		expect(eurCentsToReferenceMinutes(100, 55, 15)).toBe(0);
	});

	test('validări', () => {
		expect(() => eurCentsToReferenceMinutes(-1, 55, 15)).toThrow();
		expect(() => eurCentsToReferenceMinutes(1000, 0, 15)).toThrow(/referință/);
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

describe('splitTaskSettlement', () => {
	// Creditul se consumă în ore REALE: 1 h cumpărată = 1 h lucrată, indiferent de
	// specializare. Tariful contează doar la prețul depășirii și la cumpărare.
	test('credit suficient: totul din credit, fără depășire', () => {
		expect(splitTaskSettlement({ realMinutes: 180, balanceMinutes: 180, stepMinutes: 15 })).toEqual(
			{ consumedMinutes: 180, overageRealMinutes: 0 }
		);
	});

	test('exemplul din spec: 1 h credit, task de 2 h → 1 h din credit, 1 h facturată', () => {
		expect(splitTaskSettlement({ realMinutes: 120, balanceMinutes: 60, stepMinutes: 15 })).toEqual({
			consumedMinutes: 60,
			overageRealMinutes: 60
		});
	});

	test('depășirea se rotunjește în sus la pas și nu depășește orele reale', () => {
		const r = splitTaskSettlement({ realMinutes: 120, balanceMinutes: 100, stepMinutes: 15 });
		expect(r).toEqual({ consumedMinutes: 100, overageRealMinutes: 30 }); // 20 → 30
		expect(splitTaskSettlement({ realMinutes: 50, balanceMinutes: 0, stepMinutes: 15 })).toEqual({
			consumedMinutes: 0,
			overageRealMinutes: 50
		});
	});

	test('sold negativ tratat ca zero', () => {
		expect(
			splitTaskSettlement({ realMinutes: 60, balanceMinutes: -30, stepMinutes: 15 }).consumedMinutes
		).toBe(0);
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

describe('consumptionWorkedLabel — orele lucrate cu prețul specializării', () => {
	test('specializarea cu tariful ei, fără explicații despre referință', () => {
		expect(
			consumptionWorkedLabel({
				rateLabel: 'Development',
				rateEur: 65,
				multiplierPct: 100,
				modeLabel: 'Standard'
			})
		).toBe('Development (65 €/h)');
	});

	test('regim cu majorare: tariful efectiv și numele regimului', () => {
		expect(
			consumptionWorkedLabel({
				rateLabel: 'Development',
				rateEur: 65,
				multiplierPct: 150,
				modeLabel: 'Urgență'
			})
		).toBe('Development, Urgență (98 €/h)');
	});
});
