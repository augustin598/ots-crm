// Selecția providerului SERP per tenant: 'scraper' (implicit, cost zero),
// 'dataforseo' (plătit, credențiale criptate) sau 'auto' (scraper + failover la
// DataForSEO când rata de eșec depășește pragul sau Google blochează). Decriptarea
// urmează pattern-ul din plugins/claude: 1 retry pe DecryptionError cu re-citire.
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { rankSettings, serpIntegration } from '$lib/server/db/schema';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { logWarning } from '$lib/server/logger';
import { createScraperProvider, type ScraperDeps } from './serp-scraper';
import { createDataforseoProvider } from './dataforseo';
import { SerpProviderError, type SerpProvider } from './types';

export type ProviderMode = 'scraper' | 'dataforseo' | 'auto';

/** Prag de failover în modul 'auto': peste 20% eșecuri (cu minim de verificări). */
const FAILOVER_RATIO = 0.2;
const FAILOVER_MIN_CHECKS = 10;

/** Adevărat când rata de eșec a unei rulări cere trecerea pe providerul de rezervă. */
export function shouldFailover(run: { keywordsChecked: number; failed: number }): boolean {
	if (run.keywordsChecked < FAILOVER_MIN_CHECKS) return false;
	return run.failed / run.keywordsChecked > FAILOVER_RATIO;
}

interface IntegrationRow {
	loginEncrypted: string;
	passwordEncrypted: string;
	isActive: boolean;
}

export interface ResolveDeps {
	loadMode?: (tenantId: string) => Promise<ProviderMode>;
	loadIntegration?: (tenantId: string) => Promise<IntegrationRow | null>;
	decryptFn?: (tenantId: string, ciphertext: string) => string;
	scraperDeps?: ScraperDeps;
	fetchImpl?: typeof fetch;
}

export interface ResolvedProviders {
	mode: ProviderMode;
	/** Providerul principal folosit la începutul rulării. */
	primary: SerpProvider;
	/** Providerul de rezervă pentru failover (doar în modul 'auto' cu integrare activă). */
	fallback: SerpProvider | null;
}

async function defaultLoadMode(tenantId: string): Promise<ProviderMode> {
	const [row] = await db
		.select({ providerMode: rankSettings.providerMode })
		.from(rankSettings)
		.where(eq(rankSettings.tenantId, tenantId))
		.limit(1);
	return (row?.providerMode as ProviderMode) ?? 'scraper';
}

async function defaultLoadIntegration(tenantId: string): Promise<IntegrationRow | null> {
	const [row] = await db
		.select({
			loginEncrypted: serpIntegration.loginEncrypted,
			passwordEncrypted: serpIntegration.passwordEncrypted,
			isActive: serpIntegration.isActive
		})
		.from(serpIntegration)
		.where(eq(serpIntegration.tenantId, tenantId))
		.limit(1);
	return row ?? null;
}

/** Decriptează login+parola cu 1 retry pe DecryptionError (re-citire proaspătă). */
async function decryptCreds(
	tenantId: string,
	row: IntegrationRow,
	deps: Required<Pick<ResolveDeps, 'loadIntegration' | 'decryptFn'>>
): Promise<{ login: string; password: string } | null> {
	try {
		return {
			login: deps.decryptFn(tenantId, row.loginEncrypted),
			password: deps.decryptFn(tenantId, row.passwordEncrypted)
		};
	} catch (e) {
		if (!(e instanceof DecryptionError)) throw e;
		logWarning('plugin', 'SERP creds decrypt failed — retry cu citire proaspătă (Turso transient)', {
			tenantId
		});
		const fresh = await deps.loadIntegration(tenantId);
		if (!fresh || !fresh.isActive) return null;
		return {
			login: deps.decryptFn(tenantId, fresh.loginEncrypted),
			password: deps.decryptFn(tenantId, fresh.passwordEncrypted)
		};
	}
}

async function buildDataforseo(
	tenantId: string,
	deps: Required<Pick<ResolveDeps, 'loadIntegration' | 'decryptFn'>> & { fetchImpl?: typeof fetch }
): Promise<SerpProvider | null> {
	const row = await deps.loadIntegration(tenantId);
	if (!row || !row.isActive) return null;
	const creds = await decryptCreds(tenantId, row, deps);
	if (!creds) return null;
	return createDataforseoProvider(creds, { fetch: deps.fetchImpl });
}

/** Rezolvă providerii pentru un tenant conform `rank_settings.provider_mode`. */
export async function resolveSerpProvider(
	tenantId: string,
	deps: ResolveDeps = {}
): Promise<ResolvedProviders> {
	const loadMode = deps.loadMode ?? defaultLoadMode;
	const loadIntegration = deps.loadIntegration ?? defaultLoadIntegration;
	const decryptFn = deps.decryptFn ?? decrypt;
	const dfsDeps = { loadIntegration, decryptFn, fetchImpl: deps.fetchImpl };

	const mode = await loadMode(tenantId);
	const scraper = createScraperProvider(deps.scraperDeps);

	if (mode === 'scraper') {
		return { mode, primary: scraper, fallback: null };
	}

	if (mode === 'dataforseo') {
		const dfs = await buildDataforseo(tenantId, dfsDeps);
		if (!dfs) {
			throw new SerpProviderError(
				'modul DataForSEO selectat, dar nu există o integrare activă',
				'config',
				false
			);
		}
		return { mode, primary: dfs, fallback: null };
	}

	// mode === 'auto': scraper principal, DataForSEO ca rezervă dacă e configurat.
	const dfs = await buildDataforseo(tenantId, dfsDeps);
	return { mode, primary: scraper, fallback: dfs };
}
