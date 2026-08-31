/**
 * Recomandările „deschise" din hub-ul SEO & GEO & AEO — generate determinist din
 * agregatele modulelor (Content, Linkuri SEO, PageSpeed), nu introduse manual.
 * Funcție pură: aceleași reguli alimentează și tab-ul „Necesită atenție" și KPI-ul
 * de recomandări, ca cifrele să corespundă întotdeauna (criteriu de acceptare).
 *
 * Notă „responsabil": clientul nu are un câmp de owner în schemă — UI-ul afișează
 * numele clientului drept responsabil.
 */

export type SeoRecPriority = 'mare' | 'medie' | 'mică';
export type SeoRecType = 'Content' | 'Tehnic' | 'Linkuri' | 'PageSpeed' | 'AEO';

export interface SeoRecommendation {
	id: string;
	websiteId: string | null;
	websiteLabel: string;
	clientName: string | null;
	title: string;
	type: SeoRecType;
	priority: SeoRecPriority;
	impact: string;
	/** ISO — serializabil prin load-ul serverului. */
	due: string;
}

export interface SeoRecWebsiteInput {
	id: string;
	domain: string;
	clientName: string | null;
	hasProfile: boolean;
	hasWordpress: boolean;
	failedPublishes: number;
	/** articole rămase pe sursă (rewrite_status = 'none'). */
	sourceArticles: number;
	/** articole cu scoruri persistate (seo_score IS NOT NULL). */
	analyzedArticles: number;
	/** articole analizate cu aeo_score ≤ 83 → cel puțin un check AEO (FAQ/liste/răspuns) picat. */
	faqSuspect: number;
	pagespeedMobile: number | null;
	cwvPass: boolean | null;
}

export interface SeoRecLinksInput {
	clientId: string;
	clientName: string;
	/** seo_link în pending/submitted mai vechi de 14 zile. */
	staleCount: number;
}

export interface SeoRecInput {
	websites: SeoRecWebsiteInput[];
	links: SeoRecLinksInput[];
	/** rezultate netrackate din ultimul discovery job terminat. */
	discoveryUntracked: number;
	discoveryDomain: string | null;
}

const PRIORITY_ORDER: Record<SeoRecPriority, number> = { mare: 0, medie: 1, mică: 2 };
const DUE_DAYS: Record<SeoRecPriority, number> = { mare: 7, medie: 14, mică: 30 };

export function buildSeoRecommendations(input: SeoRecInput, now: Date): SeoRecommendation[] {
	const out: SeoRecommendation[] = [];
	const due = (priority: SeoRecPriority) =>
		new Date(now.getTime() + DUE_DAYS[priority] * 86400000).toISOString();
	const add = (
		id: string,
		priority: SeoRecPriority,
		type: SeoRecType,
		title: string,
		impact: string,
		website?: SeoRecWebsiteInput,
		clientName?: string | null
	) => {
		out.push({
			id,
			websiteId: website?.id ?? null,
			websiteLabel: website?.domain ?? clientName ?? 'Toate website-urile',
			clientName: website?.clientName ?? clientName ?? null,
			title,
			type,
			priority,
			impact,
			due: due(priority)
		});
	};

	for (const w of input.websites) {
		if (!w.hasProfile) {
			add(
				`profile:${w.id}`,
				'mare',
				'Content',
				'Creează profilul de brand',
				'Fără profil, generarea AI folosește context generic — ton și mesaje nealiniate.',
				w
			);
		}
		if (!w.hasWordpress) {
			add(
				`wordpress:${w.id}`,
				'mare',
				'Tehnic',
				'Conectează site-ul WordPress',
				'Articolele gata nu pot fi publicate automat fără conexiunea WordPress.',
				w
			);
		}
		if (w.failedPublishes > 0) {
			add(
				`publish-failed:${w.id}`,
				'mare',
				'Tehnic',
				'Repară publicările eșuate',
				`${w.failedPublishes} ${w.failedPublishes === 1 ? 'articol a eșuat' : 'articole au eșuat'} la publicare — conținutul nu ajunge live.`,
				w
			);
		}
		if (w.sourceArticles > 50) {
			add(
				`source-backlog:${w.id}`,
				'medie',
				'Content',
				'Redactează articolele-sursă restante',
				`${w.sourceArticles} articole sursă neredactate — potențial de conținut nefolosit.`,
				w
			);
		}
		if (w.pagespeedMobile != null && (w.pagespeedMobile < 50 || w.cwvPass === false)) {
			add(
				`pagespeed:${w.id}`,
				'medie',
				'PageSpeed',
				w.pagespeedMobile < 50
					? 'Îmbunătățește scorul PageSpeed mobil'
					: 'Repară Core Web Vitals',
				w.pagespeedMobile < 50
					? `Scor mobil ${w.pagespeedMobile} — sub pragul roșu de 50; afectează pozițiile organice.`
					: 'Core Web Vitals picate pe date reale CrUX — semnal negativ de ranking.',
				w
			);
		}
		if (w.analyzedArticles > 0 && w.faqSuspect > 0) {
			add(
				`aeo-faq:${w.id}`,
				'mică',
				'AEO',
				'Adaugă secțiuni FAQ în articole',
				`${w.faqSuspect} articole cu check AEO picat (FAQ/liste/răspuns direct) — extractibilitate redusă în motoarele AI.`,
				w
			);
		}
	}

	for (const l of input.links) {
		if (l.staleCount > 0) {
			add(
				`links-stale:${l.clientId}`,
				'medie',
				'Linkuri',
				'Urmărește linkurile stagnante',
				`${l.staleCount} ${l.staleCount === 1 ? 'link e' : 'linkuri sunt'} în așteptare/trimis de peste 14 zile.`,
				undefined,
				l.clientName
			);
		}
	}

	if (input.discoveryUntracked > 0) {
		add(
			'discovery-untracked',
			'medie',
			'Linkuri',
			`Înregistrează linkurile descoperite pe ${input.discoveryDomain ?? 'ultimul domeniu scanat'}`,
			`${input.discoveryUntracked} linkuri găsite de discovery în articole publicate nu sunt încă în evidență.`
		);
	}

	return out.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}
