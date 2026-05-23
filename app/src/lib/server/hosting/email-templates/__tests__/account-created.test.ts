import { describe, test, expect, mock } from 'bun:test';

// Mock SvelteKit virtual modules + DB (template imports renderHostingShell → fetchTenantBrand → db)
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} as any }));
mock.module('$lib/server/db/schema', () => ({}));
mock.module('$lib/server/email', () => ({
	renderBrandedEmail: ({ title, bodyHtml, previewTitle }: { title: string; bodyHtml: string; previewTitle?: string }) =>
		`<html><head><title>${previewTitle ?? title}</title></head><body>${bodyHtml}</body></html>`,
	fetchTenantBrand: async () => ({
		tenantName: 'OTS', themeColor: '#0ea5e9', logoAttachment: null, headerLogoHtml: '',
	}),
	renderCtaButton: (href: string, label: string, _themeColor: string) =>
		`<a href="${href}">${label}</a>`,
}));

const { render } = await import('../account-created');

describe('account-created template', () => {
	const fixture = {
		tenantId: 'tenant_test',
		domain: 'example.ro',
		daUsername: 'exampleus',
		daPassword: 'Demo!Pass123',
		daServerHost: 'srv1.onetopsolution.ro',
		serverIp: '185.247.117.10',
		clientName: 'Ion Popescu',
	};

	test('subject contains domain', async () => {
		const { subject } = await render(fixture);
		expect(subject).toContain('example.ro');
	});

	test('html contains plaintext password and Change Password CTA', async () => {
		const { html } = await render(fixture);
		expect(html).toContain('Demo!Pass123');
		expect(html).toContain('Schimbă parola');
		expect(html).toContain('CMD_PASSWD');
	});

	test('html contains DA panel URL with :2222 port', async () => {
		const { html } = await render(fixture);
		expect(html).toContain('https://srv1.onetopsolution.ro:2222');
	});

	test('html addresses customer by name', async () => {
		const { html } = await render(fixture);
		expect(html).toContain('Ion Popescu');
	});

	test('escapes HTML in user-provided fields', async () => {
		const { html } = await render({ ...fixture, domain: '<script>alert(1)</script>.ro', clientName: 'A&B' });
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('A&amp;B');
	});

	test('previewTitle escapes domain (XSS via <title> tag)', async () => {
		const { html } = await render({ ...fixture, domain: '</title><script>alert(1)</script>.ro' });
		// Extract the <title>...</title> block and verify it has no raw <script>
		const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
		expect(titleMatch).not.toBeNull();
		const titleContent = titleMatch![1];
		expect(titleContent).not.toContain('<script>');
		expect(titleContent).not.toContain('</title>');
		// Confirm the dangerous chars got escaped instead
		expect(titleContent).toContain('&lt;script&gt;');
	});
});
