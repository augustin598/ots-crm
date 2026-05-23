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
	renderCtaButton: (href: string, label: string, _themeColor: string) =>
		`<a href="${href}">${label}</a>`
}));

const { render } = await import('../provisioning-failed');

describe('provisioning-failed template', () => {
	const fixture = {
		tenantId: 'tenant_test',
		tenantSlug: 'ots',
		accountId: 'acc_xyz123',
		domain: 'example.ro',
		reason: 'da_username_exists',
		attemptNumber: 2,
		adminCrmUrl: 'https://clients.onetopsolution.ro/ots/hosting/accounts/acc_xyz123'
	};

	test('subject contains reason, tenant slug, and domain', async () => {
		const { subject } = await render(fixture);
		expect(subject).toContain('example.ro');
		expect(subject).toContain('ots');
		expect(subject).toContain('da_username_exists');
	});

	test('html contains attempt number ("Încercarea 2") and CRM deep link href', async () => {
		const { html } = await render(fixture);
		expect(html).toContain('Încercarea 2');
		expect(html).toContain('https://clients.onetopsolution.ro/ots/hosting/accounts/acc_xyz123');
	});

	test('html escapes domain that contains HTML special chars', async () => {
		const { html } = await render({ ...fixture, domain: '<script>.evil' });
		expect(html).not.toContain('<script>.evil');
		expect(html).toContain('&lt;script&gt;.evil');
	});

	test('subject prefix is the alarm emoji', async () => {
		const { subject } = await render(fixture);
		// Emoji rune `\u{1F6A8}` (🚨)
		expect(subject.startsWith('\u{1F6A8}')).toBe(true);
	});

	test('subject escapes HTML special chars in interpolated fields', async () => {
		const { subject } = await render({ ...fixture, domain: '<x>.evil' });
		expect(subject).not.toContain('<x>.evil');
		expect(subject).toContain('&lt;x&gt;.evil');
	});
});
