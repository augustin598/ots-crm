import { describe, test, expect, mock } from 'bun:test';

// Mock SvelteKit virtual modules + DB (template imports renderHostingShellWithBrand →
// fetchTenantBrand → db). Identical bootstrap to hosting/email-templates tests so
// the file can run in directory-aggregation mode without picking up production
// $env values.
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

const { render } = await import('../admin-payment-received');

describe('admin-payment-received template', () => {
	const fixture = {
		tenantId: 'tenant_test',
		tenantSlug: 'ots',
		clientName: 'Acme SRL',
		amount: 12345, // 123.45 in major units
		currency: 'RON' as const,
		invoiceNumber: 'OTS-2026-0042',
		productDescriptions: ['Hosting Pro 1 an', 'SSL gratuit'],
		crmInvoiceUrl: 'https://clients.onetopsolution.ro/ots/invoices/inv-42',
		stepStatuses: {
			magic_link: 'success' as const,
			keez_invoice: 'success' as const,
			da_provision: 'failed' as const
		}
	};

	test('subject contains formatted amount and tenant slug (escaped)', async () => {
		const { subject } = await render({
			...fixture,
			tenantSlug: '<x>.evil',
			amount: 9950 // 99.50
		});
		expect(subject).toContain('💰');
		expect(subject).toContain('99.50');
		expect(subject).toContain('RON');
		expect(subject).not.toContain('<x>.evil');
		expect(subject).toContain('&lt;x&gt;.evil');
	});

	test('html lists post-payment step statuses with color coding', async () => {
		const { html } = await render(fixture);
		// step names rendered
		expect(html).toContain('magic_link');
		expect(html).toContain('keez_invoice');
		expect(html).toContain('da_provision');
		// status texts rendered
		expect(html).toContain('success');
		expect(html).toContain('failed');
		// color coding present
		expect(html).toContain('#10b981'); // green for success
		expect(html).toContain('#dc2626'); // red for failed
	});

	test('html escapes XSS in clientName, productDescriptions, and step names', async () => {
		const { html } = await render({
			...fixture,
			clientName: 'A&B <script>alert(1)</script>',
			productDescriptions: ['<img src=x onerror=alert(2)>', 'Normal product'],
			stepStatuses: {
				'<script>x</script>': 'success' as const,
				da_provision: 'failed' as const
			}
		});
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).not.toContain('<img src=x onerror=alert(2)>');
		expect(html).not.toContain('<script>x</script>');
		expect(html).toContain('A&amp;B');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
		expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
	});

	test('html shows step name + status text legibly with all 4 statuses color-coded', async () => {
		const { html } = await render({
			...fixture,
			stepStatuses: {
				magic_link: 'success' as const,
				keez_invoice: 'failed' as const,
				da_provision: 'skipped' as const,
				renewal_reminder: 'pending' as const
			}
		});
		// Each status text appears
		expect(html).toContain('success');
		expect(html).toContain('failed');
		expect(html).toContain('skipped');
		expect(html).toContain('pending');
		// Each color hex appears
		expect(html).toContain('#10b981'); // success → green
		expect(html).toContain('#dc2626'); // failed → red
		expect(html).toContain('#666'); // skipped → gray
		expect(html).toContain('#f59e0b'); // pending → orange
		// Step name + status both present in HTML (legibility)
		expect(html).toContain('magic_link');
		expect(html).toContain('renewal_reminder');
	});
});
