import { describe, test, expect } from 'bun:test';
import { renderInvoiceCtaBlock } from '../invoice-cta';

const URL = 'https://clients.onetopsolution.ro/invoice/ots/tok123';
const THEME = '#3b82f6';

describe('renderInvoiceCtaBlock', () => {
	test('fără plată cu cardul: un singur buton, spre pagina facturii', () => {
		const html = renderInvoiceCtaBlock(URL, THEME, false);
		expect(html).toContain('Vezi factura online');
		expect(html).toContain(`href="${URL}"`);
		expect(html).not.toContain('Plătește cu cardul');
		expect(html).not.toContain('?pay=1');
	});

	test('cu plată cu cardul: buton primar spre ?pay=1 + link secundar spre factură', () => {
		const html = renderInvoiceCtaBlock(URL, THEME, true);
		expect(html).toContain('Plătește cu cardul');
		expect(html).toContain(`href="${URL}?pay=1"`);
		expect(html).toContain('Vezi factura online');
		expect(html).toContain(`href="${URL}"`);
	});

	test('butonul primar poartă culoarea temei tenantului', () => {
		expect(renderInvoiceCtaBlock(URL, '#ff0000', true)).toContain('background-color: #ff0000');
		expect(renderInvoiceCtaBlock(URL, '#ff0000', false)).toContain('background-color: #ff0000');
	});

	test('`?pay=1` apare o singură dată — linkul secundar rămâne curat', () => {
		const html = renderInvoiceCtaBlock(URL, THEME, true);
		expect(html.match(/\?pay=1/g)).toHaveLength(1);
	});

	test('CTA-ul e aliniat la stânga, nu centrat, în ambele variante', () => {
		const withCard = renderInvoiceCtaBlock(URL, THEME, true);
		const withoutCard = renderInvoiceCtaBlock(URL, THEME, false);
		expect(withCard).not.toContain('text-align: center');
		expect(withoutCard).not.toContain('text-align: center');
		// butonul + linkul secundar
		expect(withCard.match(/text-align: left/g)).toHaveLength(2);
		expect(withoutCard.match(/text-align: left/g)).toHaveLength(1);
	});
});
