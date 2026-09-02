// Contractul de tipuri pentru providerii SERP ai modulului Rank Tracker.
// Aceste nume sunt consumate de Task 4/6 (providerii scraper/DataForSEO) și de
// runner — nu le redenumi fără să actualizezi și acele task-uri.

/** O interogare SERP normalizată, independentă de provider. */
export interface SerpQuery {
	keyword: string;
	device: 'desktop' | 'mobile';
	/** Domeniul Google țintă, ex. „google.ro". */
	googleDomain: string;
	/** Limba interfeței (hl), ex. „ro". */
	hl: string;
	/** Țara (gl), ex. „ro". */
	gl: string;
	/** Locația de geolocalizare, ex. „Bucharest,Romania" (poate fi gol). */
	location: string;
	/** Câte rezultate să se ceară (num). */
	depth: number;
}

/** Un rezultat organic dintr-un SERP. */
export interface SerpOrganicResult {
	/** Poziția 1-based printre rezultatele ORGANICE (fără reclame). */
	position: number;
	/** URL absolut, cu redirecturile /url?q= dezvelite. */
	url: string;
	/** Hostul rezultatului (fără „www."). */
	domain: string;
	title: string;
	snippet: string;
}

/** Rezultatul complet al parsării unui SERP. */
export interface SerpResult {
	organic: SerpOrganicResult[];
	/** Submulțime din 'ai'|'snippet'|'local'|'paa'|'images'|'video'|'shopping'|'ads'. */
	features: string[];
	/**
	 * Starea blocului AI Overview:
	 * - 'absent'  → nu există bloc AIO
	 * - 'present' → există bloc AIO, dar niciuna dintre sursele lui nu e domeniul țintă
	 * - 'cited'   → o sursă din blocul AIO trimite spre domeniul țintă
	 */
	aiOverview: 'absent' | 'present' | 'cited';
	raw?: { blocked?: boolean };
}

export type SerpErrorKind = 'blocked' | 'timeout' | 'network' | 'parse' | 'config';

export class SerpProviderError extends Error {
	constructor(
		message: string,
		public kind: SerpErrorKind,
		public retryable: boolean
	) {
		super(message);
		this.name = 'SerpProviderError';
	}
}

export interface SerpProvider {
	name: 'scraper' | 'dataforseo';
	fetchSerp(q: SerpQuery, targetDomain: string): Promise<SerpResult>;
	/** Eliberează resursele (ex. browserul partajat al scraperului) la finalul rulării. */
	close?(): Promise<void>;
}
