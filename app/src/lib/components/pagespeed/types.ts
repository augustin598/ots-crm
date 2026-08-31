// Tipuri UI pentru modulul PageSpeed — oglindesc formele întoarse de
// $lib/remotes/pagespeed.remote.ts (sursa de adevăr rămâne remote-ul).
import type { PsiStrategy } from '$lib/logic/pagespeed';

export interface PsiPage {
	url: string;
	label: string;
}

export interface PsiMeasurement {
	id: string;
	siteId: string;
	strategy: PsiStrategy;
	measuredAt: Date | string;
	weekKey: string;
	status: 'ok' | 'failed';
	errorMessage: string | null;
	performance: number | null;
	accessibility: number | null;
	bestPractices: number | null;
	seo: number | null;
	lcpMs: number | null;
	cls: number | null;
	tbtMs: number | null;
	fcpMs: number | null;
	speedIndexMs: number | null;
	inpMs: number | null;
	ttfbMs: number | null;
	totalBytes: number | null;
	requestCount: number | null;
	fieldLcpMs: number | null;
	fieldInpMs: number | null;
	fieldCls: number | null;
	fieldSampleCount: number | null;
	opportunities: { id: string; title: string; savingsMs: number }[] | null;
}

export interface PsiStrategyData {
	last: PsiMeasurement | null;
	prev: PsiMeasurement | null;
	delta: number | null;
	spark: number[];
}

export interface PsiSiteRow {
	id: string;
	clientId: string | null;
	clientName: string | null;
	domain: string;
	name: string;
	cms: string;
	pages: PsiPage[];
	strategies: PsiStrategy[];
	alertThreshold: number;
	active: boolean;
	pausedAt: Date | string | null;
	createdAt: Date | string;
	data: { mobile: PsiStrategyData; desktop: PsiStrategyData };
	cwv: boolean | null;
}

export interface PsiSettings {
	dayOfWeek: number;
	hour: string;
	strategies: PsiStrategy[];
	recipients: string[];
	alertThreshold: number;
	onlyOnDrop: boolean;
	includeOpportunities: boolean;
	attachPdf: boolean;
	sendToClient: boolean;
	isEnabled: boolean;
	saved?: boolean;
}

export interface PsiSitePayload {
	id?: string;
	name: string;
	clientId: string | null;
	cms: string;
	alertThreshold: number;
	active: boolean;
	strategies: PsiStrategy[];
	pages: PsiPage[];
}

export const PSI_CMS_OPTIONS = [
	'WordPress',
	'WooCommerce',
	'PrestaShop',
	'Next.js',
	'Shopify',
	'Magento',
	'HTML static',
	'Altul'
];
