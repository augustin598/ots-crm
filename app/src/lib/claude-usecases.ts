/**
 * Catalog de use-case-uri pentru rutarea Claude (ce cheie + ce model per utilizare).
 * Partajat client + server — NU importa nimic din $lib/server aici (ca la claude-models.ts).
 *
 * `keyType` e re-declarat local ('api'|'oat') ca modulul să rămână client-safe; ține-l
 * în sync cu ClaudeKeyType din $lib/server/plugins/claude/key-utils.ts (ambele 'api'|'oat').
 * Consumatorii AI (rescriere content, analiză/monitorizare Ads etc.) NU există încă —
 * acesta e stratul de config + normalizare, gata de consumat de resolver-ul server-side
 * getClaudeClientFor. YAGNI: nu adăuga câmpuri până nu apare un consumator real.
 */
import type { ClaudeModelId } from './claude-models';

export type ClaudeRouteKeyType = 'api' | 'oat';

export interface ClaudeUseCase {
	/** id stabil, folosit ca și cheie în harta de rute stocată în DB (jsonb). */
	id: string;
	/** etichetă RO afișată în UI-ul de rutare. */
	label: string;
	/** scurtă descriere a utilizării (unde/ce). */
	hint: string;
	/** cheia implicită când tenantul nu a personalizat ruta. */
	defaultKeyType: ClaudeRouteKeyType;
	/** modelul implicit — validat la compilare că e un model cunoscut. */
	defaultModel: ClaudeModelId;
}

/**
 * Catalogul inițial (extensibil — adaugă rânduri fără migrare; harta de rute e
 * normalizată la citire, deci id-uri noi capătă default automat, iar cele scoase
 * sunt ignorate). Ordinea = ordinea de afișare. Toate default pe Abonament (oat);
 * comuți pe API din switch, per rând.
 */
export const CLAUDE_USE_CASES = [
	{
		id: 'copywriting',
		label: 'Copywriting / conținut',
		hint: 'Rescriere advertoriale Heylux, texte marketing, descrieri',
		defaultKeyType: 'oat',
		defaultModel: 'claude-sonnet-5'
	},
	{
		id: 'ads-analysis',
		label: 'Analiză campanii Ads',
		hint: 'Interpretare performanță Meta/Google/TikTok, anomalii, wasted spend',
		defaultKeyType: 'oat',
		defaultModel: 'claude-opus-4-8'
	},
	{
		id: 'ads-monitoring',
		label: 'Monitorizare Ads / alerte',
		hint: 'Explicații pe semnale (no-delivery, buget, status cont)',
		defaultKeyType: 'oat',
		defaultModel: 'claude-fable-5'
	},
	{
		id: 'ads-recommendations',
		label: 'Recomandări optimizare',
		hint: 'Sugestii buget / targetare / creative pe campanii',
		defaultKeyType: 'oat',
		defaultModel: 'claude-opus-4-8'
	},
	{
		id: 'client-reports',
		label: 'Rapoarte clienți',
		hint: 'Narațiuni & rezumate pe rapoartele de campanie',
		defaultKeyType: 'oat',
		defaultModel: 'claude-sonnet-5'
	},
	{
		id: 'email-drafting',
		label: 'Email & răspunsuri',
		hint: 'Drafturi emailuri clienți, follow-up leads',
		defaultKeyType: 'oat',
		defaultModel: 'claude-haiku-4-5-20251001'
	},
	{
		id: 'lead-classification',
		label: 'Clasificare leads / interviuri',
		hint: 'Sursă→canal, calificare candidați',
		defaultKeyType: 'oat',
		defaultModel: 'claude-haiku-4-5-20251001'
	},
	{
		id: 'general',
		label: 'Uz general (fallback)',
		hint: 'Orice utilizare AI neconfigurată explicit',
		defaultKeyType: 'oat',
		defaultModel: 'claude-sonnet-5'
	}
] as const satisfies readonly ClaudeUseCase[];

export type ClaudeUseCaseId = (typeof CLAUDE_USE_CASES)[number]['id'];

export const CLAUDE_USE_CASE_IDS: ClaudeUseCaseId[] = CLAUDE_USE_CASES.map((u) => u.id);
export const GENERAL_USE_CASE_ID: ClaudeUseCaseId = 'general';

const USE_CASE_BY_ID = new Map<string, ClaudeUseCase>(CLAUDE_USE_CASES.map((u) => [u.id, u]));

export function isKnownUseCase(id: string): id is ClaudeUseCaseId {
	return USE_CASE_BY_ID.has(id);
}
export function getUseCase(id: string): ClaudeUseCase | null {
	return USE_CASE_BY_ID.get(id) ?? null;
}

export interface ClaudeRoute {
	keyType: ClaudeRouteKeyType;
	model: string;
}
/** Persistat în coloana jsonb `routes`; doar override-uri față de default. */
export type ClaudeRoutes = Partial<Record<ClaudeUseCaseId, ClaudeRoute>>;

/** Ruta default (din catalog) pentru un use-case. */
export function defaultRoute(id: ClaudeUseCaseId): ClaudeRoute {
	const uc = USE_CASE_BY_ID.get(id) ?? USE_CASE_BY_ID.get(GENERAL_USE_CASE_ID)!;
	return { keyType: uc.defaultKeyType, model: uc.defaultModel };
}

function isRouteKeyType(v: unknown): v is ClaudeRouteKeyType {
	return v === 'api' || v === 'oat';
}

/**
 * Normalizează blob-ul `routes` (jsonb, deja JSON.parse-uit) într-o hartă validată.
 * Ignoră chei necunoscute / forme invalide → config forward-compatible când crește catalogul.
 */
export function parseStoredRoutes(raw: unknown): ClaudeRoutes {
	if (!raw || typeof raw !== 'object') return {};
	const out: ClaudeRoutes = {};
	for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
		if (!isKnownUseCase(id)) continue;
		if (!val || typeof val !== 'object') continue;
		const { keyType, model } = val as { keyType?: unknown; model?: unknown };
		if (!isRouteKeyType(keyType)) continue;
		const uc = USE_CASE_BY_ID.get(id)!;
		out[id] = { keyType, model: typeof model === 'string' && model ? model : uc.defaultModel };
	}
	return out;
}

/**
 * Suprapune override-urile stocate peste default-urile din catalog → hartă COMPLETĂ
 * (toate use-case-urile), pentru UI-ul de rutare.
 */
export function resolveRoutes(
	stored: ClaudeRoutes | null | undefined
): Record<ClaudeUseCaseId, ClaudeRoute> {
	const merged = parseStoredRoutes(stored);
	const out = {} as Record<ClaudeUseCaseId, ClaudeRoute>;
	for (const uc of CLAUDE_USE_CASES) {
		out[uc.id] = merged[uc.id] ?? defaultRoute(uc.id);
	}
	return out;
}

/**
 * Rezolvă ruta efectivă pentru un use-case (folosit de resolver-ul server):
 * ruta stocată a use-case-ului → ruta stocată 'general' → default din catalog.
 */
export function resolveUseCaseRoute(
	id: ClaudeUseCaseId,
	stored: ClaudeRoutes | null | undefined
): ClaudeRoute {
	const routes = parseStoredRoutes(stored);
	return routes[id] ?? routes[GENERAL_USE_CASE_ID] ?? defaultRoute(id);
}
