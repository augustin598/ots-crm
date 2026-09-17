/**
 * Textul mesajului WhatsApp de consum (Task 10, spec §5): aceeași regulă ca la
 * email — „taxate X" doar când facturabilul diferă de lucrat, tariful €/h
 * STRICT în fraza de depășire.
 *
 * Modulul importă tranzitiv db/hourly-catalog/outbox/email — mock minimal ca
 * să nu atingă baza de producție la import (vezi CLAUDE.md „dev = prod").
 */
import { describe, test, expect } from 'bun:test';
import { mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({
		message: e instanceof Error ? e.message : String(e),
		stack: ''
	})
}));
mock.module('$lib/server/hourly-catalog', () => ({ getHourlyCatalog: async () => ({ rules: {} }) }));
mock.module('$lib/server/hour-credit-reserved', () => ({
	computeReservedMinutes: async () => new Map()
}));
mock.module('$lib/server/app-url', () => ({
	getAppBaseUrl: () => 'https://clients.onetopsolution.ro'
}));
mock.module('$lib/server/whatsapp/outbox', () => ({ enqueueGroupMessage: async () => {} }));
mock.module('$lib/server/email', () => ({ sendHourCreditEmail: async () => {} }));

const { buildWhatsappBody } = await import('../hour-credit-notifications');
const portalUrl = 'https://clients.onetopsolution.ro/client/ots/hour-credits';

describe('buildWhatsappBody — consumed', () => {
	test('rotunjit cu depășire: 142 min lucrate, 100 din credit, 50 depășire → „taxate" + ora întreagă facturată, la tarif', () => {
		const body = buildWhatsappBody(
			'Lucky Group SRL',
			{
				kind: 'consumed',
				taskId: 't1',
				taskTitle: 'Landing page',
				realMinutes: 142,
				consumedMinutes: 100,
				overageRealMinutes: 50,
				invoicedMinutes: 60,
				surplusMinutes: 10,
				pricing: { rateLabel: 'Development', rateEur: 65, multiplierPct: 100, modeLabel: 'Standard' }
			},
			400,
			portalUrl
		);

		expect(body).toContain('taxate 2 h 30 min');
		expect(body).toContain('50 min peste credit → 1 h facturate la 65 €/h; 10 min rămân credit.');
		expect(body).not.toContain('se facturează separat');
		expect(body.indexOf('€/h')).toBeGreaterThan(body.indexOf('peste credit'));
	});

	test('fără depășire: facturabil == lucrat → fără „taxate" și fără niciun €/h în mesaj', () => {
		const body = buildWhatsappBody(
			'Lucky Group SRL',
			{
				kind: 'consumed',
				taskId: 't2',
				taskTitle: 'Mentenanță lunară',
				realMinutes: 150,
				consumedMinutes: 150,
				overageRealMinutes: 0,
				invoicedMinutes: 0,
				surplusMinutes: 0,
				pricing: { rateLabel: 'Development', rateEur: 65, multiplierPct: 100, modeLabel: 'Standard' }
			},
			400,
			portalUrl
		);

		expect(body).not.toContain('taxate');
		expect(body).not.toContain('€/h');
		expect(body).toContain('2 h 30 min');
		expect(body).toContain('Development');
	});

	test('depășire de 2 h 15 min → 3 h facturate, 45 min rămân credit; fără surplus, fraza se oprește la tarif', () => {
		const ev = {
			kind: 'consumed' as const,
			taskId: 't3',
			taskTitle: 'Migrare',
			realMinutes: 195,
			consumedMinutes: 60,
			overageRealMinutes: 135,
			invoicedMinutes: 180,
			surplusMinutes: 45,
			pricing: { rateLabel: 'Development', rateEur: 65, multiplierPct: 100, modeLabel: 'Standard' }
		};
		expect(buildWhatsappBody('Lucky Group SRL', ev, 45, portalUrl)).toContain(
			'⚠️ 2 h 15 min peste credit → 3 h facturate la 65 €/h; 45 min rămân credit.'
		);
		const exact = { ...ev, overageRealMinutes: 180, surplusMinutes: 0 };
		const body = buildWhatsappBody('Lucky Group SRL', exact, 0, portalUrl);
		expect(body).toContain('⚠️ 3 h peste credit → 3 h facturate la 65 €/h.');
		expect(body).not.toContain('rămân credit');
	});
});
