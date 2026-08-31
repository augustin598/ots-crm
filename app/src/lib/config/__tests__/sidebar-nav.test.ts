import { describe, it, expect } from 'bun:test';
import {
	SIDEBAR_NAV,
	buildBreadcrumbs,
	isGroupActive,
	isItemActive
} from '../sidebar-nav';

const PREFIX = '/ots';
const marketing = SIDEBAR_NAV.find((g) => g.id === 'marketing-ads')!;
const seoItem = marketing.items.find((i) => i.id === 'seo')!;

describe('grupul SEO & GEO & AEO în sidebar', () => {
	it('itemul seo există cu cele trei subiteme (rutele existente, regrupate)', () => {
		expect(seoItem.label).toBe('SEO & GEO & AEO');
		expect(seoItem.href).toBe('/seo');
		expect(seoItem.children?.map((c) => c.href)).toEqual([
			'/seo-links',
			'/seo-links/pagespeed',
			'/content'
		]);
	});

	it('itemele vechi seo-links și content nu mai există la nivelul întâi', () => {
		expect(marketing.items.find((i) => i.id === 'seo-links')).toBeUndefined();
		expect(marketing.items.find((i) => i.id === 'content')).toBeUndefined();
	});

	it('itemul seo (și grupul) e activ pe oricare din cele patru rute', () => {
		for (const path of ['/ots/seo', '/ots/seo-links', '/ots/seo-links/pagespeed', '/ots/content', '/ots/content/abc123']) {
			expect(isItemActive(seoItem, path, PREFIX)).toBe(true);
			expect(isGroupActive(marketing, path, PREFIX)).toBe(true);
		}
	});
});

describe('breadcrumbs pentru rutele SEO', () => {
	const crumbs = (path: string) => buildBreadcrumbs(path, PREFIX, SIDEBAR_NAV).map((c) => c.label);

	it('/seo → Marketing & Ads / SEO & GEO & AEO', () => {
		expect(crumbs('/ots/seo')).toEqual(['Marketing & Ads', 'SEO & GEO & AEO']);
	});

	it('/seo-links → Marketing & Ads / SEO & GEO & AEO / Linkuri SEO', () => {
		expect(crumbs('/ots/seo-links')).toEqual(['Marketing & Ads', 'SEO & GEO & AEO', 'Linkuri SEO']);
	});

	it('/seo-links/pagespeed → Marketing & Ads / SEO & GEO & AEO / PageSpeed Insights', () => {
		expect(crumbs('/ots/seo-links/pagespeed')).toEqual([
			'Marketing & Ads',
			'SEO & GEO & AEO',
			'PageSpeed Insights'
		]);
	});

	it('/content → Marketing & Ads / SEO & GEO & AEO / Content', () => {
		expect(crumbs('/ots/content')).toEqual(['Marketing & Ads', 'SEO & GEO & AEO', 'Content']);
	});

	it('rutele fără groupCrumb rămân neatinse (fără eticheta grupului)', () => {
		expect(crumbs('/ots/clients')).toEqual(['Clients']);
		expect(crumbs('/ots/invoices/google-ads')).toEqual(['Invoices', 'Google Ads']);
	});
});
