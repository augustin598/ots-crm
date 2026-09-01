// Tipurile datelor hub-ului SEO & GEO & AEO — contract între +page.server.ts și view.
// Doar tipuri pure (fără importuri de server), ca view-ul client să le poată folosi.
import type { SeoRecommendation } from '$lib/content/seo-recommendations';

export interface SeoHubWebsite {
	id: string;
	name: string | null;
	url: string;
	domain: string;
	clientId: string | null;
	clientName: string | null;
	wpConnected: boolean;
	hasProfile: boolean;
	publishMode: string | null;
	cadencePerWeek: number | null;
	articles: {
		total: number;
		ready: number;
		scheduled: number;
		published: number;
		failed: number;
		source: number;
		analyzed: number;
	};
	scores: { seo: number | null; aeo: number | null; geo: number | null; overall: number | null };
	links: { total: number; published: number };
	pagespeed: {
		mobile: number | null;
		delta: number | null;
		cwv: boolean | null;
		measuredAt: string | null;
	};
	/** medie SEO per săptămână (ultimele 6 săptămâni ISO), null = fără articole analizate atunci. */
	spark: (number | null)[];
	needsAttention: boolean;
}

export interface SeoHubData {
	websites: SeoHubWebsite[];
	weekly: {
		weeks: { id: string; label: string }[];
		seo: (number | null)[];
		aeo: (number | null)[];
		geo: (number | null)[];
	};
	recommendations: SeoRecommendation[];
	linkTotals: {
		total: number;
		pending: number;
		submitted: number;
		published: number;
		rejected: number;
		costCents: number;
	};
	clients: { id: string; name: string }[];
	lastScans: {
		siteId: string;
		domain: string;
		measuredAt: string;
		mobile: number | null;
		delta: number | null;
		cwv: boolean | null;
	}[];
	discovery: { sourceDomain: string; finishedAt: string | null; untracked: number } | null;
	generatedAt: string;
}
