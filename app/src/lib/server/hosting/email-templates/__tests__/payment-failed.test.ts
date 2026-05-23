import { describe, test, expect, mock } from 'bun:test';

// Mock SvelteKit virtual modules + DB (template imports renderHostingShell → fetchTenantBrand → db)
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} as any }));
mock.module('$lib/server/db/schema', () => ({}));
mock.module('$lib/server/email', () => ({
	renderBrandedEmail: ({
		title,
		bodyHtml,
		previewTitle
	}: {
		title: string;
		bodyHtml: string;
		previewTitle?: string;
	}) => `<html><head><title>${previewTitle ?? title}</title></head><body>${bodyHtml}</body></html>`,
	fetchTenantBrand: async () => ({
		tenantName: 'OTS',
		themeColor: '#0ea5e9',
		logoAttachment: null,
		headerLogoHtml: ''
	}),
	renderCtaButton: (href: string, label: string, themeColor: string) =>
		`<a href="${href}" data-color="${themeColor}">${label}</a>`
}));

const { render } = await import('../payment-failed');

describe('payment-failed template', () => {
	const fixture = {
		tenantId: 'tenant_test',
		domain: 'example.ro',
		clientName: 'Ion Popescu',
		invoiceNumber: 'INV-2026-0123',
		amountDue: 9950, // in cents → 99.50
		currency: 'RON' as const,
		failureReason: 'Card expired',
		updateMethodUrl: 'https://invoice.stripe.com/i/foo',
		manualPayUrl: 'https://clients.onetopsolution.ro/ots/invoices/inv-1/pay',
		daysUntilSuspend: 10
	};

	test('subject contains escaped domain', async () => {
		const { subject } = await render({ ...fixture, domain: '<x>.evil' });
		expect(subject).not.toContain('<x>.evil');
		expect(subject).toContain('&lt;x&gt;.evil');
		// Romanian wording sanity check
		expect(subject).toContain('eșuat');
	});

	test('html contains failure reason, updateMethodUrl, manualPayUrl, daysUntilSuspend, and dual CTAs', async () => {
		const { html } = await render(fixture);
		expect(html).toContain('Card expired');
		expect(html).toContain('https://invoice.stripe.com/i/foo');
		expect(html).toContain('https://clients.onetopsolution.ro/ots/invoices/inv-1/pay');
		// Day count surfaced for the suspension warning
		expect(html).toContain('10');
		// Both CTA labels present (dual CTA)
		expect(html).toContain('Actualizează metoda de plată');
		expect(html).toContain('Plătește manual');
		// Brand theme color used for the primary CTA
		expect(html).toContain('#0ea5e9');
		// Invoice number + formatted amount + currency
		expect(html).toContain('INV-2026-0123');
		expect(html).toContain('99.50');
		expect(html).toContain('RON');
	});

	test('html escapes HTML special chars in failureReason and clientName', async () => {
		const { html } = await render({
			...fixture,
			clientName: 'A&B <script>alert(1)</script>',
			failureReason: '<img src=x onerror=alert(1)>'
		});
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).not.toContain('<img src=x onerror=alert(1)>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('A&amp;B');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
	});
});
