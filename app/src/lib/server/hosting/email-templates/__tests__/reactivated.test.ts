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

const { render } = await import('../reactivated');

describe('reactivated template', () => {
	const fixture = {
		tenantId: 'tenant_test',
		domain: 'example.ro',
		clientName: 'Ion Popescu',
		invoiceNumber: 'INV-2026-0123',
		amountPaid: 9950, // in cents → 99.50
		currency: 'RON' as const,
		daPanelUrl: 'https://srv1.example.com:2222'
	};

	test('subject contains check-mark emoji and escaped domain', async () => {
		const { subject } = await render({ ...fixture, domain: '<x>.evil' });
		// Emoji rune `\u{2705}` (✅)
		expect(subject).toContain('\u{2705}');
		expect(subject).not.toContain('<x>.evil');
		expect(subject).toContain('&lt;x&gt;.evil');
	});

	test('html contains invoice number, formatted amount with currency, daPanelUrl, and DA-panel CTA', async () => {
		const { html } = await render(fixture);
		expect(html).toContain('INV-2026-0123');
		expect(html).toContain('99.50');
		expect(html).toContain('RON');
		expect(html).toContain('https://srv1.example.com:2222');
		// CTA label
		expect(html).toContain('Deschide panoul DA');
		// Brand theme color (not a hard-coded color like the red in suspended)
		expect(html).toContain('#0ea5e9');
	});

	test('html escapes HTML special chars in clientName and domain', async () => {
		const { html } = await render({
			...fixture,
			clientName: 'A&B <script>alert(1)</script>',
			domain: '<script>.evil'
		});
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).not.toContain('<script>.evil');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('A&amp;B');
	});
});
