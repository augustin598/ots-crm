export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

export const TIERS: Tier[] = ['bronze', 'silver', 'gold', 'platinum'];

export const TIER_LABELS: Record<Tier, string> = {
	bronze: 'Bronze',
	silver: 'Silver',
	gold: 'Gold',
	platinum: 'Platinum'
};

export type FeatureValue = boolean | number | string;

export interface Feature {
	id: string;
	label: string;
	values: Record<Tier, FeatureValue>;
}

export interface Category {
	slug: string;
	name: string;
	tagline: string;
	icon: string;
	prices: Record<Tier, number | null>;
	setupFees?: Partial<Record<Tier, number>>;
	setupDescription?: string;
	priceNote?: string;
	features: Feature[];
	notes?: string[];
}

export const SETUP_DEFAULT_DESCRIPTION =
	'Taxă plătită o singură dată (one-time), pentru implementarea tehnică inițială. Nu se repetă lunar — doar la start.';

export const CRM_FEATURES: Feature[] = [
	{
		id: 'dashboard-realtime',
		label: 'Dashboard real-time',
		values: { bronze: true, silver: true, gold: true, platinum: true }
	},
	{
		id: 'history-30',
		label: 'Istoric 30 zile',
		values: { bronze: true, silver: true, gold: true, platinum: true }
	},
	{
		id: 'history-full',
		label: 'Istoric complet contract',
		values: { bronze: false, silver: true, gold: true, platinum: true }
	},
	{
		id: 'export-reports',
		label: 'Export PDF / Excel la cerere',
		values: { bronze: true, silver: true, gold: true, platinum: true }
	},
	{
		id: 'custom-kpi',
		label: 'Rapoarte personalizate (KPI custom)',
		values: { bronze: false, silver: false, gold: true, platinum: true }
	},
	{
		id: 'alerts',
		label: 'Alerte email + push în CRM (anomalii, buget epuizat)',
		values: { bronze: false, silver: false, gold: true, platinum: true }
	},
	{
		id: 'team-users',
		label: 'Useri echipă client',
		values: { bronze: 1, silver: 2, gold: 5, platinum: 'Nelimitat' }
	},
	{
		id: 'custom-integrations',
		label: 'Integrări custom (CRM intern, Slack, WhatsApp)',
		values: { bronze: false, silver: false, gold: false, platinum: true }
	},
	{
		id: 'bi-api',
		label: 'API pentru BI extern (Looker, Power BI)',
		values: { bronze: false, silver: false, gold: false, platinum: true }
	}
];

export const CATEGORIES: Category[] = [
	{
		slug: 'google-ads',
		name: 'Google Ads',
		tagline: 'Promovare plătită Google',
		icon: 'google',
		prices: { bronze: 500, silver: 700, gold: 900, platinum: 1200 },
		setupFees: { bronze: 500, silver: 500, gold: 500, platinum: 500 },
		setupDescription:
			'Implementare one-time Google Ads: configurare GTM și GA4, Enhanced Conversions, Consent Mode v2 (GDPR), acțiuni conversie, extensii (apel, sitelinks, preț), strategii licitare, structurare campanii (Brand, Search, Performance Max), remarketing, headline-uri A/B. Durata: 10-14 zile. Se plătește o singură dată, la start (one-time, nu se repetă lunar).',
		priceNote: 'Management lunar, EUR fără TVA. Bugetul media se plătește separat direct către platformă.',
		features: [
			{ id: 'gads-1', label: 'Setare obiective și strategie', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gads-2', label: 'Setare conversii (GTM, GA4, Google Ads)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gads-3', label: 'Creare campanii', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gads-4', label: 'Monitorizare și optimizare', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gads-5', label: 'Analiză website și pagini promovate', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gads-6', label: 'Suport clienți', values: { bronze: 'E-mail', silver: 'E-mail', gold: 'E-mail și telefon', platinum: 'E-mail și telefon' } },
			{ id: 'gads-7', label: 'Raportare lunară în CRM', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gads-8', label: 'Raportare săptămânală în CRM', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'gads-9', label: 'Rapoarte personalizate', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'gads-10', label: 'Consultanță pe rapoarte', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'gads-11', label: 'Creație bannere publicitare', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'gads-12', label: 'Consultanță strategie Online Marketing', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'gads-13', label: 'Suport Google Merchant Center', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'gads-14', label: 'Audiențe custom (număr)', values: { bronze: 2, silver: 4, gold: 6, platinum: 10 } },
			{ id: 'gads-15', label: 'Campanii Search, Display, Local, Remarketing', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gads-16', label: 'Campanii Performance Max', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'gads-17', label: 'Campanii YouTube și Discovery', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'gads-18', label: 'Categorii produse sau servicii promovate', values: { bronze: 3, silver: 5, gold: 8, platinum: '15+' } },
			{ id: 'gads-19', label: 'Meeting săptămânal Google Meet', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'gads-20', label: 'Google Lead (formular transmis pe email)', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'gads-21', label: 'Enhanced Conversions (server-side)', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'gads-22', label: 'Consent Mode v2 (GDPR compliance)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gads-23', label: 'Call tracking (apeluri, WhatsApp, Messenger)', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'gads-24', label: 'Offline conversions import', values: { bronze: false, silver: false, gold: false, platinum: true } },
			{ id: 'gads-25', label: 'Integrare CRM pentru lead scoring', values: { bronze: false, silver: false, gold: false, platinum: true } }
		]
	},
	{
		slug: 'meta-ads',
		name: 'Facebook / Meta Ads',
		tagline: 'Promovare Facebook, Instagram, Messenger, Marketplace',
		icon: 'meta',
		prices: { bronze: 400, silver: 550, gold: 800, platinum: 1200 },
		setupFees: { bronze: 350, silver: 350, gold: 350, platinum: 350 },
		setupDescription:
			'Implementare one-time Meta Ads: Business Manager, Meta Pixel, Events Manager, Conversions API (CAPI) server-side, testare evenimente, catalog produse (DPA), configurare audiențe și lookalike. Se plătește o singură dată, la start (one-time, nu se repetă lunar).',
		priceNote: 'Management lunar, EUR fără TVA. Materialele creative avansate (filmări, sesiuni foto, motion graphics) se facturează separat pe brief.',
		features: [
			{ id: 'meta-1', label: 'Setare obiective și strategie', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'meta-2', label: 'Strategie personalizată (obiective)', values: { bronze: 2, silver: 3, gold: 5, platinum: '6+' } },
			{ id: 'meta-3', label: 'Afișare pe Facebook, Instagram, Messenger, Marketplace', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'meta-4', label: 'Monitorizare și optimizare', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'meta-5', label: 'Elemente de creație (număr/lună)', values: { bronze: 6, silver: 9, gold: 15, platinum: 21 } },
			{ id: 'meta-6', label: 'Audiențe custom (număr)', values: { bronze: 2, silver: 4, gold: 6, platinum: '8+' } },
			{ id: 'meta-7', label: 'Lookalike audiences advanced', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'meta-8', label: 'Creare text pentru anunțuri', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'meta-9', label: 'Integrare Meta Pixel și event-uri', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'meta-10', label: 'Conversions API (CAPI server-side)', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'meta-11', label: 'Catalog produse dinamic (DPA)', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'meta-12', label: 'Advantage+ Shopping Campaigns', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'meta-13', label: 'Reels Ads și Stories Ads', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'meta-14', label: 'Raportare lunară în CRM', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'meta-15', label: 'Raportare săptămânală în CRM', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'meta-16', label: 'Testare A/B', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'meta-17', label: 'Suport clienți', values: { bronze: 'E-mail', silver: 'E-mail', gold: 'E-mail și telefon', platinum: 'E-mail și telefon' } },
			{ id: 'meta-18', label: 'Consultanță strategie Online Marketing', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'meta-19', label: 'Meeting săptămânal Google Meet', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'meta-20', label: 'Facebook Lead (formular pe email)', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'meta-21', label: 'Integrare WhatsApp Business', values: { bronze: false, silver: false, gold: true, platinum: true } }
		]
	},
	{
		slug: 'tiktok-ads',
		name: 'TikTok Ads',
		tagline: 'Promovare TikTok și site-uri partenere',
		icon: 'tiktok',
		prices: { bronze: 400, silver: 550, gold: 800, platinum: 1200 },
		setupFees: { bronze: 400, silver: 400, gold: 400, platinum: 400 },
		setupDescription:
			'Implementare one-time TikTok Ads: TikTok Ads Manager, TikTok Pixel și Events API, catalog produse, audiențe custom, configurare Spark Ads și creator partnerships (dacă e cazul). Se plătește o singură dată, la start (one-time, nu se repetă lunar).',
		priceNote: 'Management lunar, EUR fără TVA. Producția creativă video short-form se discută separat dacă clientul nu furnizează materiale.',
		features: [
			{ id: 'tt-1', label: 'Setare obiective și strategie', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'tt-2', label: 'Strategie personalizată (obiective)', values: { bronze: 2, silver: 3, gold: 5, platinum: '6+' } },
			{ id: 'tt-3', label: 'Afișare pe TikTok și site-uri partenere', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'tt-4', label: 'Monitorizare și optimizare', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'tt-5', label: 'Elemente de creație (număr/lună)', values: { bronze: 6, silver: 9, gold: 15, platinum: 21 } },
			{ id: 'tt-6', label: 'Audiențe custom (număr)', values: { bronze: 2, silver: 4, gold: 6, platinum: '8+' } },
			{ id: 'tt-7', label: 'Creare text pentru anunțuri', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'tt-8', label: 'Integrare TikTok Pixel și Events API', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'tt-9', label: 'Suport creare Catalog de Produse', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'tt-10', label: 'Spark Ads (boost conținut organic)', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'tt-11', label: 'Creator partnerships (setup și orientare)', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'tt-12', label: 'Raportare lunară în CRM', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'tt-13', label: 'Raportare săptămânală în CRM', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'tt-14', label: 'Testare A/B pe format creativ', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'tt-15', label: 'Suport clienți', values: { bronze: 'E-mail', silver: 'E-mail', gold: 'E-mail și telefon', platinum: 'E-mail și telefon' } },
			{ id: 'tt-16', label: 'Consultanță strategie Online Marketing', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'tt-17', label: 'Meeting săptămânal Google Meet', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'tt-18', label: 'TikTok Lead (formular pe email)', values: { bronze: false, silver: true, gold: true, platinum: true } }
		]
	},
	{
		slug: 'seo',
		name: 'SEO',
		tagline: 'Optimizare motoare de căutare',
		icon: 'search',
		prices: { bronze: 500, silver: 700, gold: 950, platinum: 1400 },
		setupFees: { bronze: 500, silver: 500, gold: 500, platinum: 500 },
		setupDescription:
			'Audit SEO inițial complet: analiză tehnică website, audit on-page, keyword research competitiv, analiză backlink-uri și SERP, plan de acțiune pe 3-6 luni, implementare Search Console și GA4. GRATUIT la contractare minimă 6 luni.',
		priceNote: 'Abonament lunar, EUR fără TVA. Audit inițial inclus dacă contract 6+ luni. Rezultate vizibile în 3-6 luni pentru cuvinte medii, 6-12 luni pentru competitive.',
		features: [
			{ id: 'seo-1', label: 'Analiză structură website și URL-uri', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'seo-2', label: 'Cuvinte cheie optimizate (număr maxim)', values: { bronze: 5, silver: 8, gold: 12, platinum: 20 } },
			{ id: 'seo-3', label: 'Analiză DA (Domain Ranking) și SERP', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'seo-4', label: 'Analiză backlink-uri, linkbuilding, linkearning', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'seo-5', label: 'Raportare săptămânală poziții în CRM', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'seo-6', label: 'Cuvinte cheie raportate lunar', values: { bronze: 5, silver: 8, gold: 12, platinum: 20 } },
			{ id: 'seo-7', label: 'Implementare Google Search Console', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'seo-8', label: 'Google Business Profile (setup și optimizare)', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'seo-9', label: 'Cuvinte cheie long-tail', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'seo-10', label: 'Optimizare texte pe topic și extensii', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'seo-11', label: 'Optimizare imagini și linkuri', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'seo-12', label: 'Creare și configurare fișier .htaccess', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'seo-13', label: 'Analiză competiție și oportunități SEO', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'seo-14', label: 'Conținut optimizat (articole blog/pagini)', values: { bronze: 'Nu', silver: '2/lună', gold: '4/lună', platinum: '8/lună' } },
			{ id: 'seo-15', label: 'Rapoarte GA și Search Console (număr)', values: { bronze: 2, silver: 3, gold: 6, platinum: 10 } },
			{ id: 'seo-16', label: 'Schema markup (JSON-LD)', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'seo-17', label: 'Analiză și eliminare linkuri spam', values: { bronze: 10, silver: 50, gold: 100, platinum: '300+' } },
			{ id: 'seo-18', label: 'Core Web Vitals monitoring și optimizare', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'seo-19', label: 'Optimizare PageSpeed 80+', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'seo-20', label: 'Strategie backlink-uri din advertoriale', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'seo-21', label: 'E-E-A-T signals (autor, bio, trust)', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'seo-22', label: 'AI Overviews și SGE optimization', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'seo-23', label: 'Local SEO multi-listing (3+ orașe)', values: { bronze: false, silver: false, gold: false, platinum: true } },
			{ id: 'seo-24', label: 'Mentenanță website (ore/lună)', values: { bronze: 0, silver: 1, gold: 2, platinum: 3 } }
		]
	},
	{
		slug: 'wordpress-maintenance',
		name: 'Mentenanță WordPress',
		tagline: 'Administrare site WordPress',
		icon: 'wrench',
		prices: { bronze: 100, silver: 150, gold: 200, platinum: 280 },
		priceNote: 'Abonament lunar, EUR fără TVA. Fără taxă de setup. Ore custom neconsumate nu se reportează.',
		features: [
			{ id: 'wp-1', label: 'Monitorizare uptime și performanță', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'wp-2', label: 'Actualizare teme și pluginuri (Standard)', values: { bronze: 'Lunar', silver: 'La 2 săptămâni', gold: 'Săptămânal', platinum: 'Săptămânal' } },
			{ id: 'wp-3', label: 'Backup-uri automate', values: { bronze: 'Lunar', silver: 'La 2 săptămâni', gold: 'Săptămânal', platinum: 'Zilnic' } },
			{ id: 'wp-4', label: 'Scanare și eliminare malware', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'wp-5', label: 'Optimizare baze de date', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'wp-6', label: 'Asistență tehnică', values: { bronze: 'E-mail', silver: 'E-mail', gold: 'E-mail și telefon', platinum: 'E-mail și telefon' } },
			{ id: 'wp-7', label: 'Configurare securitate avansată', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'wp-8', label: 'Suport prioritar', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'wp-9', label: 'Personalizare funcționalități', values: { bronze: false, silver: false, gold: false, platinum: true } },
			{ id: 'wp-10', label: 'Copii de rezervă manuale la cerere', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'wp-11', label: 'Audit periodic al securității', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'wp-12', label: 'Integrare și configurare noi pluginuri', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'wp-13', label: 'Suport rezolvare erori critice', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'wp-14', label: 'Configurare și optimizare CDN (Cloudflare)', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'wp-15', label: 'Raport săptămânal în CRM', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'wp-16', label: 'Raport lunar în CRM', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'wp-17', label: 'Implementări custom (ore/lună)', values: { bronze: 0, silver: 1, gold: 2, platinum: 3 } },
			{ id: 'wp-18', label: 'Reînnoire nume domeniu (ex. .ro)', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'wp-19', label: 'Actualizare module și teme Pro/Premium', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'wp-20', label: 'Notificare expirare domeniu', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'wp-21', label: 'Configurare, instalare și monitorizare SSL', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'wp-22', label: 'GDPR compliance check și consent banner', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'wp-23', label: 'WAF / Firewall avansat', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'wp-24', label: 'Staging environment pentru testare', values: { bronze: false, silver: false, gold: false, platinum: true } },
			{ id: 'wp-25', label: 'Git versioning pentru cod custom', values: { bronze: false, silver: false, gold: false, platinum: true } }
		]
	},
	{
		slug: 'cro',
		name: 'CRO și Landing Page Optimization',
		tagline: 'Optimizare rate conversie și landing pages',
		icon: 'trending-up',
		prices: { bronze: 400, silver: 600, gold: 900, platinum: 1500 },
		setupFees: { bronze: 250, silver: 250, gold: 250, platinum: 250 },
		setupDescription:
			'UX audit inițial (30 zile) + configurare tool A/B testing (Hotjar / Microsoft Clarity pentru heatmaps și session recordings, VWO sau Optimizely pentru teste). Include setup prima variantă de test și baseline metrics.',
		priceNote: 'Abonament lunar, EUR fără TVA. Cost tools externe (Hotjar Pro, VWO, Optimizely) nu este inclus; Gold și Platinum pot folosi tool-urile OTS cu licență inclusă.',
		features: [
			{ id: 'cro-1', label: 'UX audit inițial (primele 30 zile)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'cro-2', label: 'Heatmaps și session recordings (Hotjar/Clarity)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'cro-3', label: 'A/B tests active simultan', values: { bronze: 1, silver: 2, gold: 4, platinum: '6+' } },
			{ id: 'cro-4', label: 'Funnel analysis complet', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'cro-5', label: 'Recomandări UX lunare (raport scris)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'cro-6', label: 'Setup tool A/B testing (VWO/Optimizely/custom)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'cro-7', label: 'Creare variante design pentru teste', values: { bronze: '2/lună', silver: '4/lună', gold: '8/lună', platinum: '12/lună' } },
			{ id: 'cro-8', label: 'Raportare rezultate în CRM', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'cro-9', label: 'Landing page nou (creare + launch)', values: { bronze: 'Nu', silver: '1/trimestru', gold: '1/lună', platinum: '2/lună' } },
			{ id: 'cro-10', label: 'Redesign pagini existente', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'cro-11', label: 'Microcopy optimization', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'cro-12', label: 'Form optimization', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'cro-13', label: 'Mobile CRO dedicat', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'cro-14', label: 'Personalizare dinamică conținut', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'cro-15', label: 'Integrare cu campanii Ads (coordinated launches)', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'cro-16', label: 'Predictive analytics pentru conversii', values: { bronze: false, silver: false, gold: false, platinum: true } },
			{ id: 'cro-17', label: 'Consultanță săptămânală', values: { bronze: false, silver: false, gold: true, platinum: true } }
		]
	},
	{
		slug: 'email-marketing',
		name: 'Email Marketing',
		tagline: 'Setup + management campanii email',
		icon: 'mail',
		prices: { bronze: 250, silver: 400, gold: 650, platinum: 1000 },
		setupFees: { bronze: 250, silver: 350, gold: 500, platinum: 800 },
		setupDescription:
			'Configurare platformă (Brevo / Mailchimp / Klaviyo / ActiveCampaign / Omnisend): cont, autentificare DNS (SPF, DKIM, DMARC) pentru deliverability, design primele template-uri responsive, segmentare listă, setup automation flows de bază (welcome, abandoned cart).',
		priceNote: 'Setup one-time + abonament lunar, EUR fără TVA. Platforme: Brevo, Mailchimp, Klaviyo, ActiveCampaign, Omnisend. Costul platformei nu este inclus.',
		features: [
			{ id: 'em-1', label: 'Setup platformă (cont, DNS, SPF, DKIM, DMARC)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'em-2', label: 'Design template responsive', values: { bronze: 1, silver: 2, gold: 4, platinum: 6 } },
			{ id: 'em-3', label: 'Newsletter trimis lunar', values: { bronze: 2, silver: 4, gold: 8, platinum: 12 } },
			{ id: 'em-4', label: 'Segmentare listă (număr segmente)', values: { bronze: 2, silver: 4, gold: 8, platinum: 'Nelimitat' } },
			{ id: 'em-5', label: 'A/B testing subject line și conținut', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'em-6', label: 'Automation flow welcome series', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'em-7', label: 'Automation flow abandoned cart (e-commerce)', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'em-8', label: 'Automation flow post-purchase', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'em-9', label: 'Automation flow re-engagement', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'em-10', label: 'Automation flow birthday / anniversary', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'em-11', label: 'Personalizare dinamică conținut', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'em-12', label: 'Copywriting dedicat pentru campanii', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'em-13', label: 'List building și lead magnets', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'em-14', label: 'Deliverability monitoring și optimizare', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'em-15', label: 'Raportare în CRM (open, click, conversie)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'em-16', label: 'Integrare cu website și CRM client', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'em-17', label: 'Integrare cu Meta Ads (Custom Audiences)', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'em-18', label: 'SMS marketing integration', values: { bronze: false, silver: false, gold: false, platinum: true } },
			{ id: 'em-19', label: 'Push notifications web și mobile', values: { bronze: false, silver: false, gold: false, platinum: true } }
		]
	},
	{
		slug: 'marketing-automation',
		name: 'Marketing Automation',
		tagline: 'Lead nurturing și automatizări cross-platform',
		icon: 'zap',
		prices: { bronze: 400, silver: 700, gold: 1100, platinum: 1800 },
		setupFees: { bronze: 500, silver: 800, gold: 1200, platinum: 2000 },
		setupDescription:
			'Audit proces vânzare și nurturing, integrare CRM (HubSpot / Pipedrive etc.), setup lead scoring model, primele flow-uri de nurturing, integrări API/Zapier, configurare chatbot (Silver+) și WhatsApp Business API (Gold+). Scope crește cu pachetul.',
		priceNote: 'Setup one-time + abonament lunar, EUR fără TVA. Costul platformelor externe (HubSpot, WhatsApp Business API, Twilio SMS) nu este inclus.',
		features: [
			{ id: 'ma-1', label: 'Audit proces vânzare și nurturing', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'ma-2', label: 'Integrare CRM (HubSpot, Pipedrive, etc.)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'ma-3', label: 'Lead scoring model setup', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'ma-4', label: 'Lead nurturing flows (număr)', values: { bronze: 2, silver: 4, gold: 8, platinum: '12+' } },
			{ id: 'ma-5', label: 'WhatsApp Business API setup', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'ma-6', label: 'Chatbot website (setup și training)', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'ma-7', label: 'Chatbot Messenger și Instagram', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'ma-8', label: 'SMS marketing integration', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'ma-9', label: 'Workflow orchestration cross-platform', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'ma-10', label: 'Sales funnel automation', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'ma-11', label: 'Attribution reporting multi-touch', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'ma-12', label: 'A/B testing pe flows', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'ma-13', label: 'Integrare Google Ads și Meta (Conversions API)', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'ma-14', label: 'Predictive lead scoring (AI-driven)', values: { bronze: false, silver: false, gold: false, platinum: true } },
			{ id: 'ma-15', label: 'Custom integrations via API/Zapier', values: { bronze: 1, silver: 3, gold: 6, platinum: 'Nelimitat' } },
			{ id: 'ma-16', label: 'Raportare în CRM OTS (live)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'ma-17', label: 'Meeting strategic lunar', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'ma-18', label: 'Consultanță dedicată (ore/lună)', values: { bronze: 0, silver: 2, gold: 5, platinum: 10 } }
		]
	},
	{
		slug: 'google-ads-setup',
		name: 'Google Ads Setup',
		tagline: 'Implementare tehnică one-time (GTM, GA4, conversii, Consent Mode)',
		icon: 'settings',
		prices: { bronze: null, silver: null, gold: null, platinum: null },
		setupFees: { bronze: 500 },
		priceNote: 'Tarif unic 500 € + TVA. Se facturează separat de abonamentul lunar Google Ads. Include configurare GTM, GA4, Enhanced Conversions, Consent Mode v2, structurare campanii, extensii, remarketing.',
		features: [
			{ id: 'gs-1', label: 'Configurare Google Tag Manager (event-uri: apel, formular, WhatsApp, Messenger)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gs-2', label: 'Configurare Google Analytics 4 (conectare GTM, măsurare avansată, import conversii)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gs-3', label: 'Enhanced Conversions + Search Console', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gs-4', label: 'Strategii de licitare, excluderi, program afișare', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gs-5', label: 'Structurare campanii (Brand, Search, Performance Max)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gs-6', label: 'Grupuri de anunțuri, headline-uri A/B, liste negative, remarketing', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gs-7', label: 'Google Consent Mode v2 prin GTM (GDPR compliant)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'gs-8', label: 'Durata implementare GTM + GA4', values: { bronze: '5-7 zile', silver: '5-7 zile', gold: '5-7 zile', platinum: '5-7 zile' } },
			{ id: 'gs-9', label: 'Durata creare campanii', values: { bronze: '5-7 zile', silver: '5-7 zile', gold: '5-7 zile', platinum: '5-7 zile' } },
			{ id: 'gs-10', label: 'Monitorizare post-lansare', values: { bronze: '30 zile', silver: '30 zile', gold: '30 zile', platinum: '30 zile' } }
		]
	}
];

export function getCategory(slug: string): Category | undefined {
	return CATEGORIES.find((c) => c.slug === slug);
}

export function formatFeatureValue(value: FeatureValue): string {
	if (value === true) return 'DA';
	if (value === false) return 'NU';
	if (typeof value === 'number') return String(value);
	return value;
}

export function isBooleanFeature(value: FeatureValue): value is boolean {
	return typeof value === 'boolean';
}

// Metallic-inspired palette with deliberate contrast between tiers:
// bronze = copper/orange, silver = cool zinc, gold = warm yellow, platinum = violet (premium).
// ---- Multi-service discount bundles --------------------------------------
// Discount applies on the combined monthly management fee (not on media budgets
// or external platform costs). Setup fees paid in full, once.

export type UseCase =
	| 'branding'
	| 'ecommerce'
	| 'lead-gen'
	| 'local'
	| 'retention'
	| 'full-stack';

export interface UseCaseInfo {
	id: UseCase;
	label: string;
	description: string;
	icon: string;
	accent: string; // tailwind accent class for icon bg
}

const NEUTRAL_ACCENT = 'bg-muted text-foreground';

export const USE_CASES: UseCaseInfo[] = [
	{
		id: 'branding',
		label: 'Branding & Awareness',
		description: 'Lansări, notorietate, produse noi, audiență rece.',
		icon: 'sparkles',
		accent: NEUTRAL_ACCENT
	},
	{
		id: 'ecommerce',
		label: 'E-commerce',
		description: 'Magazine online, fashion, DTC, marketplace.',
		icon: 'shopping-cart',
		accent: NEUTRAL_ACCENT
	},
	{
		id: 'lead-gen',
		label: 'Lead Generation (B2B & servicii)',
		description: 'SaaS, agenții, consultanță, profesii liberale.',
		icon: 'target',
		accent: NEUTRAL_ACCENT
	},
	{
		id: 'local',
		label: 'Business Local',
		description: 'Restaurante, clinici, saloane, servicii în oraș.',
		icon: 'map-pin',
		accent: NEUTRAL_ACCENT
	},
	{
		id: 'retention',
		label: 'Retenție & Lifecycle',
		description: 'Reactivare clienți existenți, recurență, LTV.',
		icon: 'refresh-cw',
		accent: NEUTRAL_ACCENT
	},
	{
		id: 'full-stack',
		label: 'Full Stack & Enterprise',
		description: 'Strategie completă, scale, multi-canal închis.',
		icon: 'layers',
		accent: NEUTRAL_ACCENT
	}
];

export interface Bundle {
	id: string;
	name: string;
	tagline: string;
	useCase: UseCase;
	services: string[]; // category slugs
	discountPct: number;
	badge?: 'popular' | 'best-value' | 'new';
	rationale: string;
}

export const BUNDLE_TIERS_RULE = [
	{ minServices: 2, discountPct: 10, label: '2 servicii → 10% reducere' },
	{ minServices: 3, discountPct: 15, label: '3 servicii → 15% reducere' },
	{ minServices: 4, discountPct: 20, label: '4+ servicii → 20% reducere' }
];

export const BUNDLES: Bundle[] = [
	// -------- Branding & Awareness --------
	{
		id: 'brand-launch',
		name: 'Brand Launch',
		tagline: 'Google + Facebook Ads',
		useCase: 'branding',
		services: ['google-ads', 'meta-ads'],
		discountPct: 12,
		badge: 'popular',
		rationale:
			'Combo clasic pentru lansări de brand: Google prinde intenția, Meta construiește recognition vizual. Două canale care se potențează reciproc.'
	},
	{
		id: 'social-spark',
		name: 'Social Spark',
		tagline: 'Facebook + TikTok Ads',
		useCase: 'branding',
		services: ['meta-ads', 'tiktok-ads'],
		discountPct: 12,
		rationale:
			'Audiențe tinere, brand storytelling prin video. Creative-ul se refolosește între platforme, producția scalează eficient.'
	},
	{
		id: 'awareness-plus',
		name: 'Awareness Plus',
		tagline: 'Facebook + TikTok + SEO',
		useCase: 'branding',
		services: ['meta-ads', 'tiktok-ads', 'seo'],
		discountPct: 16,
		rationale:
			'Mix între discovery plătit (social video) și descoperire organică (search). Recomandat când lansezi un brand nou și vrei să-l vadă lumea din mai multe direcții.'
	},

	// -------- E-commerce --------
	{
		id: 'ecom-starter',
		name: 'E-com Starter',
		tagline: 'Google + Facebook Ads',
		useCase: 'ecommerce',
		services: ['google-ads', 'meta-ads'],
		discountPct: 15,
		rationale:
			'Ideal pentru magazine la început: Shopping Ads pe Google + DPA (Advantage+) pe Meta. Catalog produse conectat, remarketing cross-platform.'
	},
	{
		id: 'ecom-full',
		name: 'E-com Full Funnel',
		tagline: 'Google + Facebook + TikTok',
		useCase: 'ecommerce',
		services: ['google-ads', 'meta-ads', 'tiktok-ads'],
		discountPct: 18,
		badge: 'best-value',
		rationale:
			'Acoperire completă pe trafic plătit pentru e-com: search (Google), social (Meta), short-video viral (TikTok). Raportare consolidată pe ROAS și AOV.'
	},
	{
		id: 'ecom-scale',
		name: 'E-com Scale',
		tagline: 'Facebook + SEO + Email Marketing',
		useCase: 'ecommerce',
		services: ['meta-ads', 'seo', 'email-marketing'],
		discountPct: 17,
		badge: 'popular',
		rationale:
			'Strategia clasică pentru magazine în creștere: achiziție (Meta), trafic organic (SEO), retenție și abandoned cart (Email). Cele trei pârghii care scalează venitul lunar.'
	},
	{
		id: 'ecom-conversion',
		name: 'E-com Conversion Pro',
		tagline: 'Google + CRO + Email',
		useCase: 'ecommerce',
		services: ['google-ads', 'cro', 'email-marketing'],
		discountPct: 17,
		rationale:
			'Pentru magazine cu trafic bun dar conversie slabă: Google aduce trafic targetat, CRO optimizează funnel-ul, Email recuperează vizitatorii necumpărați.'
	},

	// -------- Lead Generation (B2B & servicii) --------
	{
		id: 'b2b-starter',
		name: 'B2B Starter',
		tagline: 'Google Ads + SEO',
		useCase: 'lead-gen',
		services: ['google-ads', 'seo'],
		discountPct: 15,
		rationale:
			'Mixul scurt + lung termen pentru servicii B2B: Google Ads aduce lead-uri acum pe cuvinte tranzacționale, SEO construiește autoritate pe long-tail.'
	},
	{
		id: 'b2b-pro',
		name: 'B2B Pro',
		tagline: 'Google + CRO + Email',
		useCase: 'lead-gen',
		services: ['google-ads', 'cro', 'email-marketing'],
		discountPct: 17,
		badge: 'popular',
		rationale:
			'Funnel complet de lead gen: Google aduce tráfic calificat, CRO optimizează formularele și landing-urile, Email nurturează lead-urile până devin clienți.'
	},
	{
		id: 'b2b-automation',
		name: 'B2B Automation',
		tagline: 'Google + Email + Marketing Automation',
		useCase: 'lead-gen',
		services: ['google-ads', 'email-marketing', 'marketing-automation'],
		discountPct: 18,
		rationale:
			'Pentru vânzări cu ciclu lung: lead scoring automat, nurturing cu conținut, integrare CRM, notificare sales la MQL. Tech stack B2B modern.'
	},
	{
		id: 'b2b-full',
		name: 'B2B Full Funnel',
		tagline: 'Google + SEO + CRO + Automation',
		useCase: 'lead-gen',
		services: ['google-ads', 'seo', 'cro', 'marketing-automation'],
		discountPct: 20,
		rationale:
			'Stack complet pentru SaaS și servicii premium: achiziție dublă (paid + organic), CRO pe pricing/demo pages, automation pentru lifecycle post-trial.'
	},

	// -------- Business Local --------
	{
		id: 'local-presence',
		name: 'Local Presence',
		tagline: 'Google Ads + SEO',
		useCase: 'local',
		services: ['google-ads', 'seo'],
		discountPct: 15,
		rationale:
			'Pentru clinici, saloane, restaurante: Google Local Ads aduce clienți din zonă, SEO optimizează Google Business Profile + local listings. Apeli direct din search.'
	},
	{
		id: 'local-social',
		name: 'Local + Social',
		tagline: 'Google + Facebook + SEO',
		useCase: 'local',
		services: ['google-ads', 'meta-ads', 'seo'],
		discountPct: 17,
		badge: 'popular',
		rationale:
			'Reach complet pe comunitatea locală: search (Google), feed social (Meta) și Google Business Profile optimizat. Acoperire de la întrebare → rezervare.'
	},
	{
		id: 'local-site',
		name: 'Local Site Care',
		tagline: 'SEO + Mentenanță WordPress',
		useCase: 'local',
		services: ['seo', 'wordpress-maintenance'],
		discountPct: 12,
		rationale:
			'Site-ul funcționează 100% (uptime, SSL, backups, update-uri plugins) și crește în Google în același timp. Zero bătăi de cap, afacerea ta apare prima local.'
	},

	// -------- Retenție & Lifecycle --------
	{
		id: 'retention-email',
		name: 'Lifecycle Essentials',
		tagline: 'Email Marketing + Marketing Automation',
		useCase: 'retention',
		services: ['email-marketing', 'marketing-automation'],
		discountPct: 12,
		rationale:
			'Transformi baza de clienți existentă în recurență: welcome series, abandoned cart, re-engagement, post-purchase, birthday flows. LTV crește fără buget media nou.'
	},
	{
		id: 'retention-plus',
		name: 'Retention + Conversion',
		tagline: 'CRO + Email + Automation',
		useCase: 'retention',
		services: ['cro', 'email-marketing', 'marketing-automation'],
		discountPct: 17,
		rationale:
			'Pentru business-uri cu trafic stabil: optimizezi conversia (CRO), păstrezi clienții prin email personalizat și automatizezi follow-up-ul. Fără să crești bugetul de achiziție.'
	},

	// -------- Full Stack & Enterprise --------
	{
		id: 'full-paid-organic',
		name: 'Full Paid + Organic',
		tagline: 'Google + Meta + TikTok + SEO',
		useCase: 'full-stack',
		services: ['google-ads', 'meta-ads', 'tiktok-ads', 'seo'],
		discountPct: 20,
		badge: 'best-value',
		rationale:
			'Acoperire completă pe achiziție: 3 canale plătite + organic. Pentru brand-uri care vor prezență dominantă și raportare consolidată pe toate sursele de trafic.'
	},
	{
		id: 'full-stack',
		name: 'Full Stack',
		tagline: 'Google + Meta + SEO + CRO',
		useCase: 'full-stack',
		services: ['google-ads', 'meta-ads', 'seo', 'cro'],
		discountPct: 20,
		rationale:
			'Funnel închis: trafic plătit (Google + Meta), trafic organic (SEO), optimizare conversie (CRO). Echipa OTS coordonează toate canalele într-o strategie unitară.'
	},
	{
		id: 'enterprise',
		name: 'Enterprise',
		tagline: 'Ads + SEO + CRO + Email + Automation',
		useCase: 'full-stack',
		services: ['google-ads', 'meta-ads', 'seo', 'cro', 'email-marketing', 'marketing-automation'],
		discountPct: 22,
		badge: 'new',
		rationale:
			'Stack complet pentru scale: achiziție multi-canal, organic, CRO, lifecycle email și automation cross-platform. Meeting strategic lunar + rapoarte custom incluse.'
	}
];

export const TIER_COLORS: Record<
	Tier,
	{
		bg: string;
		metallic: string;
		text: string;
		border: string;
		ring: string;
		dot: string;
	}
> = {
	bronze: {
		bg: 'bg-orange-50 dark:bg-orange-950/30',
		metallic:
			'bg-gradient-to-br from-amber-100 via-orange-200 to-amber-300 dark:from-orange-950/80 dark:via-orange-900/50 dark:to-amber-900/70',
		text: 'text-orange-900 dark:text-orange-200',
		border: 'border-orange-400/70 dark:border-orange-700',
		ring: 'ring-orange-500',
		dot: 'bg-orange-600'
	},
	silver: {
		bg: 'bg-zinc-100 dark:bg-zinc-800/60',
		metallic:
			'bg-gradient-to-br from-zinc-100 via-white to-zinc-300 dark:from-zinc-700/70 dark:via-zinc-800/40 dark:to-zinc-600/60',
		text: 'text-zinc-800 dark:text-zinc-100',
		border: 'border-zinc-400 dark:border-zinc-600',
		ring: 'ring-zinc-400',
		dot: 'bg-zinc-500'
	},
	gold: {
		bg: 'bg-yellow-100 dark:bg-yellow-950/30',
		metallic:
			'bg-gradient-to-br from-yellow-200 via-amber-100 to-yellow-400 dark:from-yellow-900/70 dark:via-amber-800/40 dark:to-yellow-700/70',
		text: 'text-yellow-900 dark:text-yellow-100',
		border: 'border-yellow-500 dark:border-yellow-600',
		ring: 'ring-yellow-500',
		dot: 'bg-yellow-600'
	},
	platinum: {
		bg: 'bg-violet-50 dark:bg-violet-950/30',
		metallic:
			'bg-gradient-to-br from-violet-100 via-slate-100 to-violet-300 dark:from-violet-900/70 dark:via-slate-800/40 dark:to-violet-700/70',
		text: 'text-violet-900 dark:text-violet-100',
		border: 'border-violet-400 dark:border-violet-700',
		ring: 'ring-violet-500',
		dot: 'bg-violet-600'
	}
};
