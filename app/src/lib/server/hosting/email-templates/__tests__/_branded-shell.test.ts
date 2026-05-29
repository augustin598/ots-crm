import { describe, test, expect, mock } from 'bun:test';

// Header logo HTML the brand bundle produces when a tenant logo exists.
// The shell must forward this into renderBrandedEmail so the logo renders
// inline (via cid:companylogo) instead of dangling as a file attachment —
// the regression this suite guards against.
const HEADER_LOGO = '<img src="cid:companylogo" alt="" />';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} as any }));
mock.module('$lib/server/db/schema', () => ({}));
mock.module('$lib/server/email', () => ({
	// Echo headerLogoHtml into the output so we can assert the shell forwarded it.
	renderBrandedEmail: ({
		headerLogoHtml,
		title,
		bodyHtml
	}: {
		headerLogoHtml: string;
		title: string;
		bodyHtml: string;
	}) => `<html><body>${headerLogoHtml}<h1>${title}</h1>${bodyHtml}</body></html>`,
	fetchTenantBrand: async () => ({
		tenantName: 'One Top Solution',
		themeColor: '#0ea5e9',
		logoAttachment: {
			filename: 'logo.png',
			content: Buffer.from('x'),
			cid: 'companylogo',
			contentType: 'image/png'
		},
		headerLogoHtml: HEADER_LOGO
	})
}));

const { renderHostingShell, renderHostingShellWithBrand } = await import('../_branded-shell');

describe('hosting branded shell — tenant logo', () => {
	test('renderHostingShell forwards the tenant logo into the email body', async () => {
		const html = await renderHostingShell({
			tenantId: 'tenant_ots',
			title: 'Cont activ',
			bodyHtml: '<p>Salut</p>'
		});
		expect(html).toContain('cid:companylogo');
	});

	test('renderHostingShellWithBrand forwards the tenant logo into the email body', () => {
		const brand = {
			tenantName: 'One Top Solution',
			themeColor: '#0ea5e9',
			logoAttachment: {
				filename: 'logo.png',
				content: Buffer.from('x'),
				cid: 'companylogo',
				contentType: 'image/png'
			},
			headerLogoHtml: HEADER_LOGO
		};
		const html = renderHostingShellWithBrand({ brand, title: 'Cont activ', bodyHtml: '<p>Salut</p>' });
		expect(html).toContain('cid:companylogo');
	});

	test('tenant without a logo produces no dangling cid reference in the body', () => {
		const brand = {
			tenantName: 'One Top Solution',
			themeColor: '#0ea5e9',
			logoAttachment: null,
			headerLogoHtml: ''
		};
		const html = renderHostingShellWithBrand({ brand, title: 'Cont activ', bodyHtml: '<p>Salut</p>' });
		expect(html).not.toContain('cid:companylogo');
	});
});
