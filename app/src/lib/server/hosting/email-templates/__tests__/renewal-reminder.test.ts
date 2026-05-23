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

const { render } = await import('../renewal-reminder');

describe('renewal-reminder template', () => {
	const baseFixture = {
		tenantId: 'tenant_test',
		domain: 'example.ro',
		clientName: 'Ion Popescu',
		dueDate: '01.06.2026',
		amountDue: 9950, // in cents → 99.50
		currency: 'RON' as const,
		payUrl: 'https://clients.onetopsolution.ro/ots/hosting/accounts/acc-1/renew'
	};

	test("subject shows '1 zi' (singular) for daysUntilDue=1", async () => {
		const { subject } = await render({
			...baseFixture,
			daysUntilDue: 1,
			autoRenew: true
		});
		expect(subject).toContain('1 zi');
		expect(subject).not.toContain('1 zile');
		expect(subject).toContain('example.ro');
	});

	test("subject shows 'N zile' (plural) for daysUntilDue=7 and 14", async () => {
		const r7 = await render({ ...baseFixture, daysUntilDue: 7, autoRenew: false });
		expect(r7.subject).toContain('7 zile');
		expect(r7.subject).not.toContain('7 zi ');

		const r14 = await render({ ...baseFixture, daysUntilDue: 14, autoRenew: true });
		expect(r14.subject).toContain('14 zile');
	});

	test("autoRenew=true copy mentions automatic charge ('taxat automat')", async () => {
		const { html } = await render({
			...baseFixture,
			daysUntilDue: 7,
			autoRenew: true
		});
		expect(html).toContain('taxat automat');
		// CTA for autoRenew=true uses "Vezi detalii plată"
		expect(html).toContain('Vezi detalii plată');
		// Should NOT use the manual-payment CTA
		expect(html).not.toContain('Plătește acum');
	});

	test("autoRenew=false copy warns about suspension ('suspendat')", async () => {
		const { html } = await render({
			...baseFixture,
			daysUntilDue: 1,
			autoRenew: false
		});
		expect(html).toContain('suspendat');
		// Should mention manual payment expiration
		expect(html).toContain('Plata manuală');
		// CTA for autoRenew=false uses "Plătește acum"
		expect(html).toContain('Plătește acum');
		// Should NOT use the auto-renew CTA
		expect(html).not.toContain('Vezi detalii plată');
	});
});
