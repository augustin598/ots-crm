import { describe, test, expect } from 'bun:test';
import { renderInvoicePaidEmailHtml } from '../invoice-paid';

describe('renderInvoicePaidEmailHtml', () => {
	const baseInput = {
		tenantName: 'OTS',
		themeColor: '#0ea5e9',
		headerLogoHtml: '',
		clientName: 'Ion Popescu',
		invoiceNumber: 'INV-2026-0042',
		totalAmount: 49900,
		currency: 'RON',
		paidDate: new Date('2026-05-24T00:00:00Z'),
		issueDate: new Date('2026-05-15T00:00:00Z'),
		invoiceUrl: 'https://clients.onetopsolution.ro/invoice/ots/preview-token'
	};

	test('subject contains invoice number and Romanian wording', () => {
		const { subject } = renderInvoicePaidEmailHtml(baseInput);
		expect(subject).toBe('Plata primita: Factura INV-2026-0042');
	});

	test('html contains all rendered fields and CTA', () => {
		const { html } = renderInvoicePaidEmailHtml(baseInput);
		expect(html).toContain('INV-2026-0042');
		expect(html).toContain('499.00 RON');
		expect(html).toContain('Ion Popescu');
		expect(html).toContain('Plată primită');
		expect(html).toContain('Vezi factura');
		expect(html).toContain(baseInput.invoiceUrl);
		expect(html).toContain('#0ea5e9'); // theme color in CTA
		expect(html).toContain('Vă mulțumim pentru plată');
	});

	test('plain text contains all rendered fields and url', () => {
		const { text } = renderInvoicePaidEmailHtml(baseInput);
		expect(text).toContain('Plata primita');
		expect(text).toContain('INV-2026-0042');
		expect(text).toContain('499.00 RON');
		expect(text).toContain('Ion Popescu');
		expect(text).toContain(baseInput.invoiceUrl);
		expect(text).toContain('Va multumim pentru plata');
	});

	test('escapes HTML special chars in client name', () => {
		const { html } = renderInvoicePaidEmailHtml({
			...baseInput,
			clientName: 'A&B <script>alert(1)</script>'
		});
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('A&amp;B');
	});

	test('escapes invoice number inside body details (subject/title kept raw to match prior behavior)', () => {
		const { html, subject } = renderInvoicePaidEmailHtml({
			...baseInput,
			invoiceNumber: 'INV<x>'
		});
		// Body details are escaped — protects the recipient-rendered area
		expect(html).toContain('<strong>INV&lt;x&gt;</strong>');
		// Subject is intentionally NOT escaped (preserves pre-refactor behavior)
		expect(subject).toBe('Plata primita: Factura INV<x>');
	});

	test('falls back to "Client" when clientName is empty', () => {
		const { html, text } = renderInvoicePaidEmailHtml({
			...baseInput,
			clientName: ''
		});
		expect(html).toContain('Client');
		expect(text).toContain('Stimate/Stimata Client');
	});

	test('renders N/A when totalAmount is null', () => {
		const { html, text } = renderInvoicePaidEmailHtml({
			...baseInput,
			totalAmount: null
		});
		expect(html).toContain('N/A');
		expect(text).toContain('N/A');
	});

	test('renders N/A when totalAmount is undefined', () => {
		const { html } = renderInvoicePaidEmailHtml({
			...baseInput,
			totalAmount: undefined
		});
		expect(html).toContain('N/A');
	});

	test('omits paidDate row when paidDate is null', () => {
		const { html } = renderInvoicePaidEmailHtml({
			...baseInput,
			paidDate: null
		});
		expect(html).not.toContain('Data plății');
	});

	test('omits issueDate row when issueDate is null', () => {
		const { html } = renderInvoicePaidEmailHtml({
			...baseInput,
			issueDate: null
		});
		expect(html).not.toContain('Data emitere');
	});

	test('includes paidDate formatted as dd.MM.yyyy when set', () => {
		const { html } = renderInvoicePaidEmailHtml({
			...baseInput,
			paidDate: new Date('2026-05-24T00:00:00Z')
		});
		expect(html).toContain('Data plății');
		expect(html).toMatch(/2[345]\.05\.2026/); // tolerate TZ
	});

	test('embeds headerLogoHtml verbatim in shell', () => {
		const logoHtml = '<img src="cid:companylogo" alt="" />';
		const { html } = renderInvoicePaidEmailHtml({
			...baseInput,
			headerLogoHtml: logoHtml
		});
		expect(html).toContain(logoHtml);
	});

	test('uses themeColor in title color', () => {
		const { html } = renderInvoicePaidEmailHtml({
			...baseInput,
			themeColor: '#ff00aa'
		});
		expect(html).toContain('#ff00aa');
	});

	test('does not render Plătit row if both dates are null', () => {
		const { html } = renderInvoicePaidEmailHtml({
			...baseInput,
			paidDate: null,
			issueDate: null
		});
		expect(html).not.toContain('Data plății');
		expect(html).not.toContain('Data emitere');
		// Still has the summary
		expect(html).toContain('INV-2026-0042');
	});
});
