/**
 * Corpul emailului de consum (Task 10, spec §5): timpul lucrat arată rotunjirea
 * doar când diferă de facturabil („taxate X"), iar tariful €/h apare STRICT în
 * fraza de depășire — niciodată lângă orele consumate din credit.
 */
import { describe, test, expect } from 'bun:test';
import { buildHourCreditEmailBody } from '../hour-credit-email-body';
import type { HourCreditEvent } from '../hour-credit-notifications';

const base = {
	clientName: 'Lucky Group SRL',
	balanceMinutes: 500,
	portalUrl: 'https://clients.onetopsolution.ro/client/ots/hour-credits',
	servicesUrl: 'https://clients.onetopsolution.ro/servicii',
	themeColor: '#1877F2'
};

describe('buildHourCreditEmailBody — consumed', () => {
	test('rotunjit cu depășire: 142 min lucrate, 100 din credit, 50 depășire → „taxate" + tariful la depășire', () => {
		const event: HourCreditEvent = {
			kind: 'consumed',
			taskId: 't1',
			taskTitle: 'Landing page',
			realMinutes: 142,
			consumedMinutes: 100,
			overageRealMinutes: 50,
			pricing: { rateLabel: 'Development', rateEur: 65, multiplierPct: 100, modeLabel: 'Standard' }
		};
		const html = buildHourCreditEmailBody({ ...base, event });

		expect(html).toContain('taxate 2 h 30 min');
		expect(html).toContain('50 min depășesc creditul');
		expect(html).toContain('la 65 €/h');
		// tariful nu apare lângă orele lucrate, doar în fraza de depășire
		expect(html.indexOf('€/h')).toBeGreaterThan(html.indexOf('depășesc creditul'));
	});

	test('fără depășire: facturabil == lucrat → fără „taxate" și fără niciun €/h în mesaj', () => {
		const event: HourCreditEvent = {
			kind: 'consumed',
			taskId: 't2',
			taskTitle: 'Mentenanță lunară',
			realMinutes: 150,
			consumedMinutes: 150,
			overageRealMinutes: 0,
			pricing: { rateLabel: 'Development', rateEur: 65, multiplierPct: 100, modeLabel: 'Standard' }
		};
		const html = buildHourCreditEmailBody({ ...base, event });

		expect(html).not.toContain('taxate');
		expect(html).not.toContain('€/h');
		expect(html).toContain('2 h 30 min');
		expect(html).toContain('Development');
	});

	test('rotunjit fără depășire: 20 min lucrate → pas 30 min facturate, „taxate 30 min", fără €/h', () => {
		const event: HourCreditEvent = {
			kind: 'consumed',
			taskId: 't3',
			taskTitle: 'Corecție text',
			realMinutes: 20,
			consumedMinutes: 30,
			overageRealMinutes: 0,
			pricing: { rateLabel: 'Development', rateEur: 65, multiplierPct: 100, modeLabel: 'Standard' }
		};
		const html = buildHourCreditEmailBody({ ...base, event });

		expect(html).toContain('taxate 30 min');
		expect(html).not.toContain('€/h');
	});
});
