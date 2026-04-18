# TikTok Ads Daily-Reconnect & "Eroare la încărcarea datelor" Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elimină reconectarea zilnică forțată la TikTok Ads și fă pagina de rapoarte să afișeze date corecte sau erori utile — nu mesajul generic "Eroare la încărcarea datelor".

**Architecture:** Problema e un lanț de bug-uri compuse. (1) `exchangeCodeForTokens` mapează câmpuri OAuth care **NU există** în răspunsul TikTok Business API (`access_token_expires_in` vs real `access_token_expire_time`), deci salvăm mereu `tokenExpiresAt = now + 24h` indiferent de durata reală (TikTok dă de obicei tokens de 1 an). (2) După ~23h `getAuthenticatedToken` declanșează un refresh care poate fi trimis pe endpoint greșit, sau cu refresh_token gol (pentru că inițial nu l-am parsat). (3) După 5 eșecuri consecutive (≈30h), scheduler-ul setează `isActive=false`. (4) Când user-ul se reconectează dimineața, vechile `tiktok_ads_account` rămân pointate către integrarea moartă, iar dropdown-ul din `/reports/tiktok-ads` le afișează, producând erori de auth ascunse de un UI care face `instanceof Error` pe un `HttpError`. Planul atacă fiecare verigă: instrumentează întâi, apoi repară expirarea, apoi dedup + afișare UI, apoi criptare + hardening.

**Tech Stack:** SvelteKit 5 (remote functions + `$effect`), Bun, TypeScript, Drizzle ORM, libSQL (Turso), Redis, AES-256-GCM (`$lib/server/crypto`), TikTok Business Marketing API v1.3.

---

## Pre-flight

**Worktree:** lucrul se face în worktree-ul curent `jovial-chaplygin-82c152`. Fiecare fază se termină cu commit dedicat; PR-ul final agregă tot. Nu modifica `.env` — variabilele `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_REDIRECT_URI` există deja în runtime.

**Skills obligatorii:**
- `superpowers:systematic-debugging` — pentru Faza 0 (colectare dovezi înainte de fix)
- `svelte:svelte-file-editor` + `svelte:svelte-core-bestpractices` — pentru orice editare `.svelte` (Faza 3)
- `api-integrations` — ghidează cache keys, circuit breaker, decrypt retry
- `database-migrations` — pentru migrațiile din Faza 5 și 6 (un singur `ALTER TABLE` per fișier; update `_journal.json`)

**Fișiere afectate (overview):**
- Modify: `app/src/lib/server/tiktok-ads/auth.ts` — field mapping, refresh endpoint, encryption, dual-read
- Modify: `app/src/lib/server/tiktok-ads/sync.ts` — aliniere cu token decriptat
- Modify: `app/src/lib/remotes/tiktok-reports.remote.ts` — dedup, cache key cu integrationId, error mapping unitar
- Modify: `app/src/lib/remotes/tiktok-ads.remote.ts` — expune `lastRefreshError`, `consecutiveRefreshFailures`
- Modify: `app/src/routes/[tenant]/reports/tiktok-ads/+page.svelte` — fix error display
- Modify: `app/src/routes/client/[tenant]/(app)/reports/tiktok-ads/+page.svelte` — fix error display
- Modify: `app/src/routes/[tenant]/reports/google-ads/+page.svelte` — același bug de afișare (fix defensiv)
- Modify: `app/src/routes/[tenant]/settings/tiktok-ads/+page.svelte` — arată `lastRefreshError` + buton "Șterge integrări orfane"
- Create: `app/src/lib/server/db/migrations/0XXX_tiktok_encrypt_tokens.sql`
- Create: `app/src/lib/server/db/migrations/0XXX_tiktok_spending_cascade.sql`
- Create: `app/scripts/verify-tiktok-tokens.ts` — script de diagnostic + self-test

---

## Faza 0 — Diagnostic instrumentation (NO fix încă)

Înainte de orice schimbare funcțională, capturăm dovada în DB prin `debugLog`. Fără faza asta rezolvăm simptomul fals.

### Task 0.1: Loghează răspunsul RAW de la TikTok `/oauth2/access_token/`

**Files:**
- Modify: `app/src/lib/server/tiktok-ads/auth.ts:59-88` (funcția `exchangeCodeForTokens`)
- Modify: `app/src/lib/server/tiktok-ads/auth.ts:95-150` (funcția `refreshAccessToken`)

- [ ] **Step 1: Adaugă logare după `res.json()` în `exchangeCodeForTokens`**

Modifică `app/src/lib/server/tiktok-ads/auth.ts` în blocul `exchangeCodeForTokens`. După linia `const json = await res.json();` (linia 75), inserează:

```ts
	const json = await res.json();
	const data = json.data;

	// Faza 0: capture RAW keys without leaking token values
	logInfo('tiktok-ads', 'OAuth exchange RAW response shape', {
		metadata: {
			httpStatus: res.status,
			topLevelKeys: Object.keys(json),
			dataKeys: data ? Object.keys(data) : [],
			hasAccessToken: Boolean(data?.access_token),
			hasRefreshToken: Boolean(data?.refresh_token),
			accessTokenExpireTime: data?.access_token_expire_time ?? null,
			accessTokenExpiresIn: data?.access_token_expires_in ?? null,
			refreshTokenExpireTime: data?.refresh_token_expire_time ?? null,
			refreshTokenExpiresIn: data?.refresh_token_expires_in ?? null,
			errorCode: json.code,
			errorMessage: json.message
		}
	});

	if (json.code !== 0 || !data?.access_token) {
```

- [ ] **Step 2: Aceeași logare în `refreshAccessToken`**

În același fișier, în bucla de retry la `refreshAccessToken`, după `const json = await res.json();` (linia 118), inserează:

```ts
			const json = await res.json();
			const data = json.data;

			logInfo('tiktok-ads', 'OAuth refresh RAW response shape', {
				metadata: {
					attempt,
					httpStatus: res.status,
					endpointUsed: `${TIKTOK_API_URL}/oauth2/access_token/`,
					topLevelKeys: Object.keys(json),
					dataKeys: data ? Object.keys(data) : [],
					hasNewRefreshToken: Boolean(data?.refresh_token),
					accessTokenExpireTime: data?.access_token_expire_time ?? null,
					accessTokenExpiresIn: data?.access_token_expires_in ?? null,
					refreshTokenExpireTime: data?.refresh_token_expire_time ?? null,
					refreshTokenExpiresIn: data?.refresh_token_expires_in ?? null,
					errorCode: json.code,
					errorMessage: json.message
				}
			});

			if (json.code !== 0 || !data?.access_token) {
```

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/tiktok-ads/auth.ts
git commit -m "chore(tiktok-ads): log raw oauth response shape for diagnostics"
```

### Task 0.2: Script de diagnostic rapid

**Files:**
- Create: `app/scripts/verify-tiktok-tokens.ts`

- [ ] **Step 1: Creează script-ul**

```ts
// app/scripts/verify-tiktok-tokens.ts
// Usage: cd app && bun scripts/verify-tiktok-tokens.ts <tenant-slug-or-id>
import { db } from '../src/lib/server/db';
import * as table from '../src/lib/server/db/schema';
import { eq, or } from 'drizzle-orm';

const arg = process.argv[2];
if (!arg) {
	console.error('Usage: bun scripts/verify-tiktok-tokens.ts <tenant-slug-or-id>');
	process.exit(1);
}

const [tenant] = await db
	.select()
	.from(table.tenant)
	.where(or(eq(table.tenant.id, arg), eq(table.tenant.slug, arg)))
	.limit(1);
if (!tenant) {
	console.error('Tenant not found:', arg);
	process.exit(1);
}

const integrations = await db
	.select()
	.from(table.tiktokAdsIntegration)
	.where(eq(table.tiktokAdsIntegration.tenantId, tenant.id));

console.log(`Tenant: ${tenant.name} (${tenant.slug})`);
console.log(`TikTok integrations: ${integrations.length}\n`);

for (const int of integrations) {
	const now = Date.now();
	const accessLeftH = int.tokenExpiresAt ? Math.round((int.tokenExpiresAt.getTime() - now) / 3_600_000) : null;
	const refreshLeftD = int.refreshTokenExpiresAt ? Math.round((int.refreshTokenExpiresAt.getTime() - now) / 86_400_000) : null;
	console.log(`— Integration ${int.id}`);
	console.log(`    orgId=${int.orgId || '(empty)'}  active=${int.isActive}  syncEnabled=${int.syncEnabled}`);
	console.log(`    access_token: ${int.accessToken ? 'present' : 'EMPTY'}  expiresAt=${int.tokenExpiresAt?.toISOString() ?? 'null'}  (≈${accessLeftH}h left)`);
	console.log(`    refresh_token: ${int.refreshToken ? 'present' : 'EMPTY'}  expiresAt=${int.refreshTokenExpiresAt?.toISOString() ?? 'null'}  (≈${refreshLeftD}d left)`);
	console.log(`    lastRefreshAttemptAt=${int.lastRefreshAttemptAt?.toISOString() ?? 'null'}  consecFailures=${int.consecutiveRefreshFailures}`);
	console.log(`    lastRefreshError=${int.lastRefreshError ?? 'null'}`);

	const accounts = await db
		.select()
		.from(table.tiktokAdsAccount)
		.where(eq(table.tiktokAdsAccount.integrationId, int.id));
	console.log(`    accounts: ${accounts.length} (${accounts.filter(a => a.isActive).length} active, ${accounts.filter(a => a.clientId).length} mapped)`);
	for (const a of accounts) {
		console.log(`      • ${a.tiktokAdvertiserId}  "${a.accountName}"  active=${a.isActive}  clientId=${a.clientId ?? 'null'}`);
	}
	console.log('');
}
process.exit(0);
```

- [ ] **Step 2: Rulează local pentru tenant-ul cu probleme**

Run: `cd app && bun scripts/verify-tiktok-tokens.ts one-top-solution`

Așteptat: listare cu una sau mai multe integrări. Dovada bug-ului:
- `access_token: present  expiresAt=... (≈<24h left)` — dacă expiră constant sub 24h, mapping-ul e rupt
- `refresh_token: EMPTY` sau `consecFailures>=1` confirmă că refresh-ul nu stochează/nu refolosește corect token-ul
- Mai multe integrări cu același `orgId` și `active=true/false` amestecate → confirmă Bug #1 (dedup lipsă)

- [ ] **Step 3: Commit**

```bash
git add app/scripts/verify-tiktok-tokens.ts
git commit -m "chore(tiktok-ads): add token state diagnostic script"
```

### Task 0.3: Deploy Faza 0, așteaptă 6h, colectează log-urile

- [ ] **Step 1: Deploy în staging/prod (unde se vede bug-ul)**

Push-ul + deploy-ul urmează workflow-ul standard al proiectului. După deploy:

- [ ] **Step 2: Așteaptă ≥6h (un ciclu token-refresh-daily)**

- [ ] **Step 3: Rulează interogarea de audit**

În Turso SQL console sau via `drizzle-kit studio`:

```sql
SELECT ts, level, message, metadata
FROM debug_log
WHERE scope = 'tiktok-ads'
  AND (message LIKE '%OAuth exchange%' OR message LIKE '%OAuth refresh%')
ORDER BY ts DESC
LIMIT 50;
```

Notează:
- Există `access_token_expire_time` în `dataKeys`? (dacă da, Bug #1 confirmat)
- `refresh_token` vine pe răspuns? (dacă nu, refresh-ul e imposibil)
- Pe refresh: `endpointUsed` + `errorCode`/`errorMessage`

**Decision gate:** Cu log-urile în mână, confirmă ipotezele sau ajustează Faza 1 înainte de implementare. Nu trece mai departe fără dovezi.

---

## Faza 1 — Fix mapping expirare (root cause reconectare zilnică)

### Task 1.1: Parsează corect `access_token_expire_time` și `refresh_token_expire_time`

**Files:**
- Modify: `app/src/lib/server/tiktok-ads/auth.ts:59-150`

- [ ] **Step 1: Refactor `exchangeCodeForTokens` la shape-ul real TikTok**

Înlocuiește blocul `return {...}` din `exchangeCodeForTokens` cu:

```ts
	if (json.code !== 0 || !data?.access_token) {
		throw new Error(`TikTok token exchange failed: ${json.message || 'Unknown error'}`);
	}

	// TikTok returns UNIX timestamps in seconds, NOT expires_in durations.
	// Fallback to generous defaults only if both shapes are missing.
	const nowSec = Math.floor(Date.now() / 1000);
	const accessExpireSec: number =
		typeof data.access_token_expire_time === 'number' ? data.access_token_expire_time :
		typeof data.access_token_expires_in === 'number' ? nowSec + data.access_token_expires_in :
		nowSec + 365 * 24 * 3600; // TikTok default app lifetime is 1 year
	const refreshExpireSec: number =
		typeof data.refresh_token_expire_time === 'number' ? data.refresh_token_expire_time :
		typeof data.refresh_token_expires_in === 'number' ? nowSec + data.refresh_token_expires_in :
		nowSec + 365 * 24 * 3600;

	return {
		accessToken: data.access_token as string,
		refreshToken: (data.refresh_token as string | undefined) || '',
		accessTokenExpiresAtMs: accessExpireSec * 1000,
		refreshTokenExpiresAtMs: refreshExpireSec * 1000
	};
```

- [ ] **Step 2: Actualizează signatura de retur**

Schimbă declarația funcției de la:
```ts
async function exchangeCodeForTokens(authCode: string): Promise<{
	accessToken: string;
	refreshToken: string;
	accessTokenExpiresIn: number;
	refreshTokenExpiresIn: number;
}>
```
la:
```ts
async function exchangeCodeForTokens(authCode: string): Promise<{
	accessToken: string;
	refreshToken: string;
	accessTokenExpiresAtMs: number;
	refreshTokenExpiresAtMs: number;
}>
```

- [ ] **Step 3: Aplică același refactor pe `refreshAccessToken`**

Înlocuiește blocul de return din `refreshAccessToken` (după validarea `json.code !== 0`):

```ts
				const nowSec = Math.floor(Date.now() / 1000);
				const accessExpireSec: number =
					typeof data.access_token_expire_time === 'number' ? data.access_token_expire_time :
					typeof data.access_token_expires_in === 'number' ? nowSec + data.access_token_expires_in :
					nowSec + 365 * 24 * 3600;
				const refreshExpireSec: number =
					typeof data.refresh_token_expire_time === 'number' ? data.refresh_token_expire_time :
					typeof data.refresh_token_expires_in === 'number' ? nowSec + data.refresh_token_expires_in :
					nowSec + 365 * 24 * 3600;

				return {
					accessToken: data.access_token as string,
					refreshToken: (data.refresh_token as string | undefined) || refreshToken,
					accessTokenExpiresAtMs: accessExpireSec * 1000,
					refreshTokenExpiresAtMs: refreshExpireSec * 1000
				};
```

Și signatura:
```ts
async function refreshAccessToken(refreshToken: string): Promise<{
	accessToken: string;
	refreshToken: string;
	accessTokenExpiresAtMs: number;
	refreshTokenExpiresAtMs: number;
}>
```

- [ ] **Step 4: Propaga schimbarea în `handleCallback` și în refresh-success din `getAuthenticatedToken`**

În `handleCallback` înlocuiește:
```ts
	const tokenExpiresAt = new Date(Date.now() + tokens.accessTokenExpiresIn * 1000);
	const refreshTokenExpiresAt = new Date(Date.now() + tokens.refreshTokenExpiresIn * 1000);
```
cu:
```ts
	const tokenExpiresAt = new Date(tokens.accessTokenExpiresAtMs);
	const refreshTokenExpiresAt = new Date(tokens.refreshTokenExpiresAtMs);
```

La fel în `getAuthenticatedToken`, înlocuiește:
```ts
			const tokenExpiresAt = new Date(Date.now() + tokens.accessTokenExpiresIn * 1000);
			const refreshTokenExpiresAt = new Date(Date.now() + tokens.refreshTokenExpiresIn * 1000);
```
cu:
```ts
			const tokenExpiresAt = new Date(tokens.accessTokenExpiresAtMs);
			const refreshTokenExpiresAt = new Date(tokens.refreshTokenExpiresAtMs);
```

- [ ] **Step 5: Smoke test manual**

Deconectează **manual** integrarea TikTok în staging, reconectează prin UI (OAuth callback). Apoi:

Run: `cd app && bun scripts/verify-tiktok-tokens.ts <tenant-slug>`

Așteptat: `access_token expiresAt` la ≈365 zile (sau durata reală din log-ul de Faza 0), nu 24h. Dacă arată tot 24h, recitește log-ul `OAuth exchange RAW response shape` — e posibil ca app-ul tău TikTok să fie configurat cu lifetime scurt; ajustează setarea în TikTok Business Developer portal.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/server/tiktok-ads/auth.ts
git commit -m "fix(tiktok-ads): parse expire_time timestamps instead of expires_in durations"
```

### Task 1.2: Verifică endpoint-ul de refresh

Conform TikTok docs v1.3 endpoint-ul `/oauth2/access_token/` **acceptă** `grant_type=refresh_token`. Dacă log-ul din Faza 0 arată `errorMessage` gen "Invalid grant_type" sau "Not supported", comută pe endpoint-ul dedicat.

- [ ] **Step 1: Dacă log-ul confirmă refresh-ul funcționează, SKIP acest task**

- [ ] **Step 2: Dacă log-ul arată eroare de endpoint, schimbă URL-ul în `refreshAccessToken`**

```ts
				const res = await fetch(`${TIKTOK_API_URL}/oauth2/refresh_token/`, {
					// ... rest unchanged
				});
```

- [ ] **Step 3: Commit (condițional)**

```bash
git add app/src/lib/server/tiktok-ads/auth.ts
git commit -m "fix(tiktok-ads): use dedicated refresh_token endpoint"
```

### Task 1.3: Nu mai declanșa refresh când nu avem refresh_token valid

Dacă TikTok nu returnează refresh_token (app config), orice încercare de refresh e sortită eșecului și scheduler-ul dezactivează integrarea. Fix-ul: dacă `refreshToken === ''`, folosește access_token-ul existent până la `tokenExpiresAt` real și nu incrementa failure counter-ul.

**Files:**
- Modify: `app/src/lib/server/tiktok-ads/auth.ts:200-207`

- [ ] **Step 1: Înlocuiește blocul care returnează `null` când lipsește refresh token**

Caută:
```ts
		if (!integration.refreshToken) {
			logWarning('tiktok-ads', 'Token expired and no refresh token available', { metadata: { integrationId } });
			return null;
		}
```

Înlocuiește cu:
```ts
		if (!integration.refreshToken) {
			// No refresh token issued by TikTok (app config limitation).
			// If access token is still valid, keep using it — don't trigger refresh loop.
			const accessStillValid = integration.tokenExpiresAt && integration.tokenExpiresAt.getTime() > Date.now();
			if (accessStillValid) {
				logInfo('tiktok-ads', 'No refresh token configured — using existing access token until expiry', {
					metadata: { integrationId, expiresAt: integration.tokenExpiresAt?.toISOString() }
				});
				return { accessToken: integration.accessToken, integration };
			}
			logWarning('tiktok-ads', 'Token expired and no refresh token available — manual re-auth required', { metadata: { integrationId } });
			return null;
		}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/server/tiktok-ads/auth.ts
git commit -m "fix(tiktok-ads): don't fail auth when refresh_token is absent but access_token is still valid"
```

---

## Faza 2 — Dedup + filtrare integrări active în dropdown (fix vizibil în 30s)

Asta e fix-ul care rezolvă imediat simptomul "Eroare la încărcarea datelor" chiar dacă refresh-ul mai are tremor.

### Task 2.1: Dedup în `getTiktokReportAdAccounts`

**Files:**
- Modify: `app/src/lib/remotes/tiktok-reports.remote.ts:37-89`

- [ ] **Step 1: Adaugă `integrationActive` în SELECT și dedup după `tiktokAdvertiserId`**

Înlocuiește corpul query-ului cu:

```ts
	const accounts = await db
		.select({
			id: table.tiktokAdsAccount.id,
			tiktokAdvertiserId: table.tiktokAdsAccount.tiktokAdvertiserId,
			accountName: table.tiktokAdsAccount.accountName,
			integrationId: table.tiktokAdsAccount.integrationId,
			clientId: table.tiktokAdsAccount.clientId,
			clientName: table.client.name,
			isActive: table.tiktokAdsAccount.isActive,
			refreshTokenExpiresAt: table.tiktokAdsIntegration.refreshTokenExpiresAt,
			integrationActive: table.tiktokAdsIntegration.isActive
		})
		.from(table.tiktokAdsAccount)
		.leftJoin(table.client, eq(table.tiktokAdsAccount.clientId, table.client.id))
		.leftJoin(table.tiktokAdsIntegration, eq(table.tiktokAdsAccount.integrationId, table.tiktokAdsIntegration.id))
		.where(
			and(
				eq(table.tiktokAdsAccount.tenantId, event.locals.tenant.id),
				isNotNull(table.tiktokAdsAccount.clientId)
			)
		)
		.orderBy(table.tiktokAdsAccount.accountName);

	// Dedup same advertiserId across multiple integrations (after reconnect/orgId change),
	// preferring the one whose parent integration is still active.
	const deduped = new Map<string, typeof accounts[0]>();
	for (const acc of accounts) {
		const existing = deduped.get(acc.tiktokAdvertiserId);
		if (!existing) {
			deduped.set(acc.tiktokAdvertiserId, acc);
			continue;
		}
		const existingActive = existing.integrationActive === true;
		const candidateActive = acc.integrationActive === true;
		if (!existingActive && candidateActive) {
			deduped.set(acc.tiktokAdvertiserId, acc);
		}
	}
	const uniqueAccounts = Array.from(deduped.values());

	// Batch lookup currency per ad account from spending data
	const accountIds = uniqueAccounts.map(a => a.tiktokAdvertiserId);
	const currencyMap = new Map<string, string>();

	if (accountIds.length > 0) {
		const spendings = await db
			.select({ tiktokAdvertiserId: table.tiktokAdsSpending.tiktokAdvertiserId, currencyCode: table.tiktokAdsSpending.currencyCode })
			.from(table.tiktokAdsSpending)
			.where(inArray(table.tiktokAdsSpending.tiktokAdvertiserId, accountIds))
			.orderBy(desc(table.tiktokAdsSpending.periodStart));

		for (const s of spendings) {
			if (!currencyMap.has(s.tiktokAdvertiserId)) {
				currencyMap.set(s.tiktokAdvertiserId, s.currencyCode);
			}
		}
	}

	return uniqueAccounts.map(acc => ({
		...acc,
		currency: currencyMap.get(acc.tiktokAdvertiserId) || 'RON',
		refreshTokenExpiresAt: acc.refreshTokenExpiresAt,
		integrationActive: acc.integrationActive ?? true
	}));
});
```

- [ ] **Step 2: Aplică aceeași logică în `getMyTiktokAdAccounts` (portal client)**

În același fișier (`tiktok-reports.remote.ts`), găsește `getMyTiktokAdAccounts` (linia ~128), adaugă `integrationActive` în SELECT (prin leftJoin pe `tiktokAdsIntegration`) și dedup identic înainte de return.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/remotes/tiktok-reports.remote.ts
git commit -m "fix(tiktok-ads): dedup report accounts preferring active integration (mirrors meta-ads fix)"
```

### Task 2.2: Refuză query-urile către integrări inactive în remote functions

**Files:**
- Modify: `app/src/lib/remotes/tiktok-reports.remote.ts` — toate 4 query functions (`getTiktokCampaignInsights`, `getTiktokActiveCampaigns`, `getTiktokDemographicInsights`, `getTiktokAdGroupInsights`)

- [ ] **Step 1: Creează helper `assertActiveIntegration` la începutul fișierului, sub imports**

```ts
async function assertActiveIntegration(integrationId: string, tenantId: string) {
	const [int] = await db
		.select({ id: table.tiktokAdsIntegration.id, isActive: table.tiktokAdsIntegration.isActive })
		.from(table.tiktokAdsIntegration)
		.where(
			and(
				eq(table.tiktokAdsIntegration.id, integrationId),
				eq(table.tiktokAdsIntegration.tenantId, tenantId)
			)
		)
		.limit(1);
	if (!int) throw error(404, 'Integrare TikTok Ads negăsită');
	if (!int.isActive) {
		throw error(409, 'Integrarea TikTok Ads este dezactivată. Reconectează din Settings → TikTok Ads.');
	}
}
```

- [ ] **Step 2: Apelează helperul înainte de fiecare `getAuthenticatedToken(...)`**

În `getTiktokCampaignInsights`, imediat după verificarea de tenant, înainte de `const authResult = await getAuthenticatedToken(...)`:

```ts
		await assertActiveIntegration(params.integrationId, tenantId);

		const authResult = await getAuthenticatedToken(params.integrationId);
```

Repetă același pattern în celelalte 3 queries (`getTiktokActiveCampaigns`, `getTiktokDemographicInsights`, `getTiktokAdGroupInsights`).

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/remotes/tiktok-reports.remote.ts
git commit -m "fix(tiktok-ads): return 409 with actionable message when integration is inactive"
```

---

## Faza 3 — UI: afișează eroarea reală (remediu vizibil pentru clienți)

### Task 3.1: Fix display în pagina owner TikTok

**Files:**
- Modify: `app/src/routes/[tenant]/reports/tiktok-ads/+page.svelte:499-508`

- [ ] **Step 1: Folosește tool-urile Svelte MCP înainte de editare**

Invocă `mcp__svelte__list-sections` → `mcp__svelte__get-documentation` pentru secțiunea `$derived` + `error-handling` ca să verifici patternul.

- [ ] **Step 2: Înlocuiește blocul de eroare**

Caută:
```svelte
		{:else if insightsError}
			<Card class="p-8">
				<div class="rounded-md bg-red-50 p-4 space-y-2">
					<p class="text-sm font-medium text-red-800">{insightsError instanceof Error ? insightsError.message : 'Eroare la încărcarea datelor'}</p>
					<p class="text-sm text-red-700">
						Dacă tokenul a expirat, reconectează din
						<a href="/{tenantSlug}/settings/tiktok-ads" class="underline font-medium">Settings → TikTok Ads</a>.
					</p>
				</div>
			</Card>
```

Înlocuiește cu:
```svelte
		{:else if insightsError}
			{@const errMsg = (insightsError as any)?.body?.message
				|| (insightsError instanceof Error ? insightsError.message : null)
				|| (insightsError as any)?.message
				|| 'Eroare la încărcarea datelor'}
			{@const errStatus = (insightsError as any)?.status ?? 0}
			<Card class="p-8">
				<div class="rounded-md bg-red-50 p-4 space-y-2">
					<p class="text-sm font-medium text-red-800">{errMsg}</p>
					{#if errStatus === 401 || errStatus === 409}
						<p class="text-sm text-red-700">
							Reconectează din
							<a href="/{tenantSlug}/settings/tiktok-ads" class="underline font-medium">Settings → TikTok Ads</a>.
						</p>
					{:else}
						<p class="text-sm text-red-700">Dacă problema persistă, verifică <a href="/{tenantSlug}/logs" class="underline">logurile</a> sau contactează suportul.</p>
					{/if}
				</div>
			</Card>
```

- [ ] **Step 3: Rulează svelte-autofixer**

Invocă `mcp__svelte__svelte-autofixer` pe fișier. Aplică toate sugestiile, re-rulează până e clean.

- [ ] **Step 4: Commit**

```bash
git add app/src/routes/[tenant]/reports/tiktok-ads/+page.svelte
git commit -m "fix(tiktok-reports): surface real HttpError message instead of generic fallback"
```

### Task 3.2: Același fix în pagina client portal

**Files:**
- Modify: `app/src/routes/client/[tenant]/(app)/reports/tiktok-ads/+page.svelte:409-418`

- [ ] **Step 1: Repetă modificarea identic**

Același bloc `{@const errMsg = ...}` + `{#if errStatus === 401 || errStatus === 409}` adaptat la contextul client (fără link spre Settings — clienții nu au acces; pune link spre support).

Înlocuiește blocul original cu:
```svelte
		{#if insightsError}
			{@const errMsg = (insightsError as any)?.body?.message
				|| (insightsError instanceof Error ? insightsError.message : null)
				|| (insightsError as any)?.message
				|| 'Eroare la încărcarea datelor'}
			<Card class="p-8">
				<div class="rounded-md bg-red-50 p-4 space-y-2">
					<p class="text-sm font-medium text-red-800">{errMsg}</p>
					<p class="text-sm text-red-700">Contactează echipa dacă problema persistă.</p>
				</div>
			</Card>
		{/if}
```

- [ ] **Step 2: svelte-autofixer**

- [ ] **Step 3: Commit**

```bash
git add app/src/routes/client/[tenant]/(app)/reports/tiktok-ads/+page.svelte
git commit -m "fix(client-tiktok-reports): surface real error message"
```

### Task 3.3: Fix defensiv în Google Ads (același bug de display)

**Files:**
- Modify: `app/src/routes/[tenant]/reports/google-ads/+page.svelte:344-352`

- [ ] **Step 1: Aplică același pattern `body?.message || instanceof Error || message`**

```svelte
		{:else if insightsError}
			{@const errMsg = (insightsError as any)?.body?.message
				|| (insightsError instanceof Error ? insightsError.message : null)
				|| (insightsError as any)?.message
				|| 'Eroare la încărcarea datelor'}
			<Card class="p-8">
				<div class="rounded-md bg-red-50 p-4">
					<p class="text-sm font-medium text-red-800 dark:text-red-300">{errMsg}</p>
				</div>
			</Card>
```

- [ ] **Step 2: svelte-autofixer + commit**

```bash
git add app/src/routes/[tenant]/reports/google-ads/+page.svelte
git commit -m "fix(google-reports): align error display with facebook-ads pattern"
```

---

## Faza 4 — Vizibilitate pentru admin în Settings

Când token-ul e pe cale să expire sau refresh-ul eșuează, admin-ul trebuie să vadă motivul exact, nu să descopere din plângerile clienților.

### Task 4.1: Expune `lastRefreshError` și `consecutiveRefreshFailures` în remote

**Files:**
- Modify: `app/src/lib/server/tiktok-ads/auth.ts:275-300` (funcția `getTiktokAdsConnections`)

- [ ] **Step 1: Adaugă câmpuri în return-ul `getTiktokAdsConnections`**

Înlocuiește return-ul cu:

```ts
	return integrations.map((int) => ({
		id: int.id,
		orgId: int.orgId,
		email: int.email,
		connected: int.isActive,
		tokenExpiresAt: int.tokenExpiresAt,
		refreshTokenExpiresAt: int.refreshTokenExpiresAt,
		lastSyncAt: int.lastSyncAt,
		syncEnabled: int.syncEnabled,
		lastSyncResults: int.lastSyncResults ? JSON.parse(int.lastSyncResults) : null,
		tokenExpiringSoon: int.refreshTokenExpiresAt ? int.refreshTokenExpiresAt.getTime() < Date.now() + 7 * 24 * 60 * 60 * 1000 : false,
		tokenExpired: int.refreshTokenExpiresAt ? int.refreshTokenExpiresAt.getTime() < Date.now() : false,
		refreshTokenExpired: int.refreshTokenExpiresAt ? int.refreshTokenExpiresAt.getTime() < Date.now() : false,
		ttSessionStatus: int.ttSessionStatus,
		paymentAccountId: int.paymentAccountId,
		lastRefreshError: int.lastRefreshError,
		consecutiveRefreshFailures: int.consecutiveRefreshFailures ?? 0,
		lastRefreshAttemptAt: int.lastRefreshAttemptAt
	}));
```

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/server/tiktok-ads/auth.ts
git commit -m "feat(tiktok-ads): expose refresh error + consecutive failures to admin UI"
```

### Task 4.2: Banner în Settings când există eroare de refresh

**Files:**
- Modify: `app/src/routes/[tenant]/settings/tiktok-ads/+page.svelte` (card-ul fiecărei conexiuni)

- [ ] **Step 1: Adaugă banner vizual**

Găsește blocul care afișează `Ultimul sync: ...` per conexiune și adaugă IMMEDIATE SUB el:

```svelte
{#if connection.lastRefreshError}
	<div class="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
		<div class="font-medium text-amber-900">
			Refresh token a eșuat {connection.consecutiveRefreshFailures}x consecutiv
			{#if connection.lastRefreshAttemptAt}
				(ultima încercare: {new Date(connection.lastRefreshAttemptAt).toLocaleString('ro-RO')})
			{/if}
		</div>
		<div class="mt-1 text-amber-800">{connection.lastRefreshError}</div>
		{#if connection.consecutiveRefreshFailures >= 3}
			<div class="mt-2 text-amber-900 font-medium">Reconectează pentru a evita dezactivarea automată (la 5 eșecuri).</div>
		{/if}
	</div>
{/if}
```

- [ ] **Step 2: svelte-autofixer**

- [ ] **Step 3: Commit**

```bash
git add app/src/routes/[tenant]/settings/tiktok-ads/+page.svelte
git commit -m "feat(tiktok-settings): show refresh errors with severity escalation"
```

### Task 4.3: Buton "Șterge integrări orfane" (pentru tenant-ul utilizatorului)

Unii tenants au deja istoric de integrări moarte — aceștia au nevoie de cleanup one-shot.

**Files:**
- Modify: `app/src/lib/remotes/tiktok-ads.remote.ts` (adaugă command)
- Modify: `app/src/routes/[tenant]/settings/tiktok-ads/+page.svelte`

- [ ] **Step 1: Adaugă command în remote**

În `tiktok-ads.remote.ts`, după `removeTiktokAdsConnection`:

```ts
export const cleanupOrphanTiktokIntegrations = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw error(401, 'Unauthorized');
	if (event.locals.isClientUser) throw error(401, 'Unauthorized');

	const tenantId = event.locals.tenant.id;

	// Find inactive integrations whose accounts duplicate active ones by advertiserId
	const allIntegrations = await db
		.select({ id: table.tiktokAdsIntegration.id, isActive: table.tiktokAdsIntegration.isActive })
		.from(table.tiktokAdsIntegration)
		.where(eq(table.tiktokAdsIntegration.tenantId, tenantId));

	const activeIds = new Set(allIntegrations.filter(i => i.isActive).map(i => i.id));
	const inactiveIds = allIntegrations.filter(i => !i.isActive).map(i => i.id);
	if (inactiveIds.length === 0) return { deleted: 0 };

	// Only delete inactive integrations whose advertiser accounts already exist under an active one
	let deleted = 0;
	for (const inactiveId of inactiveIds) {
		const accs = await db
			.select({ advertiserId: table.tiktokAdsAccount.tiktokAdvertiserId })
			.from(table.tiktokAdsAccount)
			.where(eq(table.tiktokAdsAccount.integrationId, inactiveId));
		const advertiserIds = accs.map(a => a.advertiserId);
		if (advertiserIds.length === 0) {
			await db.delete(table.tiktokAdsIntegration).where(eq(table.tiktokAdsIntegration.id, inactiveId));
			deleted++;
			continue;
		}
		// Check every advertiserId has a counterpart under an active integration
		const activeAccs = await db
			.select({ advertiserId: table.tiktokAdsAccount.tiktokAdvertiserId, integrationId: table.tiktokAdsAccount.integrationId })
			.from(table.tiktokAdsAccount)
			.where(
				and(
					eq(table.tiktokAdsAccount.tenantId, tenantId),
					inArray(table.tiktokAdsAccount.tiktokAdvertiserId, advertiserIds)
				)
			);
		const coveredActive = new Set(
			activeAccs.filter(a => activeIds.has(a.integrationId)).map(a => a.advertiserId)
		);
		const allCovered = advertiserIds.every(id => coveredActive.has(id));
		if (allCovered) {
			await db.delete(table.tiktokAdsIntegration).where(eq(table.tiktokAdsIntegration.id, inactiveId));
			deleted++;
		}
	}
	return { deleted };
});
```

- [ ] **Step 2: Adaugă butonul în UI**

În `settings/tiktok-ads/+page.svelte`, în secțiunea generală (deasupra listei de conexiuni), adaugă:

```svelte
<Button variant="outline" size="sm" onclick={async () => {
	const result = await cleanupOrphanTiktokIntegrations().updates(connectionsQuery);
	toast.success(`Șters ${result.deleted} integrări orfane`);
}}>
	Curăță integrări orfane
</Button>
```

Și import-ul `cleanupOrphanTiktokIntegrations` la începutul fișierului.

- [ ] **Step 3: svelte-autofixer + commit**

```bash
git add app/src/lib/remotes/tiktok-ads.remote.ts app/src/routes/[tenant]/settings/tiktok-ads/+page.svelte
git commit -m "feat(tiktok-settings): one-click cleanup for orphan inactive integrations"
```

---

## Faza 5 — Criptează token-urile TikTok (respectă regula `encrypt-all-tokens`)

Risc: migrația trebuie să fie non-destructivă (dual-read tranzitoriu). Un singur `ALTER TABLE` per fișier de migrație (skill `database-migrations`).

### Task 5.1: Migrație — adaugă coloane criptate noi

**Files:**
- Create: `app/src/lib/server/db/migrations/0XXX_tiktok_encrypt_tokens.sql`

- [ ] **Step 1: Generează numărul migrației**

Run: `cd app && ls src/lib/server/db/migrations/ | sort | tail -3`

Folosește numărul următor (ex. `0123_tiktok_encrypt_tokens.sql`).

- [ ] **Step 2: Scrie SQL-ul (o singură instrucțiune — split în fișiere separate dacă e nevoie)**

Creează fișierul cu exact:
```sql
ALTER TABLE tiktok_ads_integration ADD COLUMN access_token_encrypted TEXT NOT NULL DEFAULT '';
```

Creează un al doilea fișier `0XXX+1_tiktok_encrypt_tokens_part2.sql`:
```sql
ALTER TABLE tiktok_ads_integration ADD COLUMN refresh_token_encrypted TEXT NOT NULL DEFAULT '';
```

- [ ] **Step 3: Update `_journal.json` manual**

Deschide `app/src/lib/server/db/migrations/meta/_journal.json`, adaugă două entries noi pentru cele două migrații (respectă formatul existent).

- [ ] **Step 4: Rulează migrația pe local, verifică pe Turso**

Run: `cd app && bun drizzle-kit migrate`

Verifică pe Turso:
```sql
PRAGMA table_info(tiktok_ads_integration);
```
Așteptat: coloanele `access_token_encrypted` și `refresh_token_encrypted` sunt prezente.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/db/migrations/
git commit -m "db(tiktok-ads): add encrypted token columns (shadow)"
```

### Task 5.2: Dual-write la toate scrierile de token

**Files:**
- Modify: `app/src/lib/server/tiktok-ads/auth.ts` (toate `db.update` care setează `accessToken`/`refreshToken`)

- [ ] **Step 1: Import crypto**

În header-ul `auth.ts`:
```ts
import { encrypt, decrypt } from '$lib/server/crypto';
```

(Verifică calea exactă — caută `export function encrypt` în `$lib/server/`; dacă e în alt fișier, ajustează importul. Plugin-ul SmartBill are deja `crypto.ts` la `src/lib/server/plugins/smartbill/crypto.ts`.)

- [ ] **Step 2: În `handleCallback`, scrie ambele coloane**

Înlocuiește blocul de update:
```ts
	await db
		.update(table.tiktokAdsIntegration)
		.set({
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			accessTokenEncrypted: encrypt(tenantId, tokens.accessToken),
			refreshTokenEncrypted: tokens.refreshToken ? encrypt(tenantId, tokens.refreshToken) : '',
			tokenExpiresAt,
			refreshTokenExpiresAt,
			isActive: true,
			updatedAt: new Date()
		})
		.where(eq(table.tiktokAdsIntegration.id, integrationId));
```

- [ ] **Step 3: La fel în `getAuthenticatedToken` (blocul de success al refresh-ului)**

```ts
			await db
				.update(table.tiktokAdsIntegration)
				.set({
					accessToken: tokens.accessToken,
					refreshToken: tokens.refreshToken,
					accessTokenEncrypted: encrypt(integration.tenantId, tokens.accessToken),
					refreshTokenEncrypted: tokens.refreshToken ? encrypt(integration.tenantId, tokens.refreshToken) : '',
					tokenExpiresAt,
					refreshTokenExpiresAt,
					updatedAt: new Date()
				})
				.where(eq(table.tiktokAdsIntegration.id, integrationId));
```

- [ ] **Step 4: Adaugă coloanele în schema Drizzle**

În `app/src/lib/server/db/schema.ts`, în definiția `tiktokAdsIntegration` (linia 1704):

```ts
	accessToken: text('access_token').notNull().default(''),
	accessTokenEncrypted: text('access_token_encrypted').notNull().default(''),
	refreshToken: text('refresh_token').notNull().default(''),
	refreshTokenEncrypted: text('refresh_token_encrypted').notNull().default(''),
```

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/tiktok-ads/ app/src/lib/server/db/schema.ts
git commit -m "feat(tiktok-ads): dual-write encrypted tokens alongside plaintext"
```

### Task 5.3: Dual-read cu fallback la plaintext

**Files:**
- Modify: `app/src/lib/server/tiktok-ads/auth.ts` (funcția `getAuthenticatedToken` și toate locurile unde se citesc token-urile)

- [ ] **Step 1: Creează helper `readTokens`**

În `auth.ts`, sub imports, adaugă:

```ts
import { DecryptionError } from '$lib/server/crypto'; // ajustează dacă se numește altfel

function readTokens(integration: table.TiktokAdsIntegration): { accessToken: string; refreshToken: string } {
	const tenantId = integration.tenantId;
	let accessToken = integration.accessToken;
	let refreshToken = integration.refreshToken;

	if (integration.accessTokenEncrypted) {
		try {
			accessToken = decrypt(tenantId, integration.accessTokenEncrypted);
		} catch (e) {
			if (e instanceof DecryptionError) {
				logWarning('tiktok-ads', 'Decrypt access token failed — falling back to plaintext', { metadata: { integrationId: integration.id } });
			} else throw e;
		}
	}
	if (integration.refreshTokenEncrypted) {
		try {
			refreshToken = decrypt(tenantId, integration.refreshTokenEncrypted);
		} catch (e) {
			if (e instanceof DecryptionError) {
				logWarning('tiktok-ads', 'Decrypt refresh token failed — falling back to plaintext', { metadata: { integrationId: integration.id } });
			} else throw e;
		}
	}
	return { accessToken, refreshToken };
}
```

- [ ] **Step 2: Folosește helper-ul în `getAuthenticatedToken`**

Înlocuiește toate aparițiile de `integration.accessToken` / `integration.refreshToken` din `getAuthenticatedToken` cu rezultatul lui `readTokens(integration)`.

- [ ] **Step 3: Retry decrypt (conform skill-ul decrypt-retry-pattern)**

Wrap `readTokens` într-o funcție care reîncearcă 2x cu fresh DB read:

```ts
async function readTokensWithRetry(integrationId: string): Promise<{ accessToken: string; refreshToken: string; integration: table.TiktokAdsIntegration } | null> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const [integration] = await db
			.select()
			.from(table.tiktokAdsIntegration)
			.where(and(eq(table.tiktokAdsIntegration.id, integrationId), eq(table.tiktokAdsIntegration.isActive, true)))
			.limit(1);
		if (!integration) return null;
		try {
			const { accessToken, refreshToken } = readTokens(integration);
			return { accessToken, refreshToken, integration };
		} catch (e) {
			if (e instanceof DecryptionError && attempt < 2) {
				await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
				continue;
			}
			throw e;
		}
	}
	return null;
}
```

Înlocuiește blocul inițial din `getAuthenticatedToken` (linia 189-197) cu:
```ts
	const pair = await readTokensWithRetry(integrationId);
	if (!pair) return null;
	const { accessToken, refreshToken, integration } = pair;
	if (!accessToken) return null;
```

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/server/tiktok-ads/auth.ts
git commit -m "feat(tiktok-ads): decrypt-with-retry dual-read pattern"
```

### Task 5.4: Backfill + verificare, apoi drop plaintext (separat, DUPĂ producție stabilă)

**⚠️ NU executa această fază până nu rulează dual-read stabil cel puțin 7 zile în prod.**

**Files:**
- Create: `app/scripts/backfill-tiktok-encrypted-tokens.ts`
- Create (LATER): `app/src/lib/server/db/migrations/0XXX_tiktok_drop_plaintext.sql`

- [ ] **Step 1: Script de backfill**

```ts
// app/scripts/backfill-tiktok-encrypted-tokens.ts
import { db } from '../src/lib/server/db';
import * as table from '../src/lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encrypt } from '../src/lib/server/crypto';

const integrations = await db.select().from(table.tiktokAdsIntegration);
let done = 0;
for (const int of integrations) {
	if (int.accessTokenEncrypted && int.refreshTokenEncrypted) continue;
	await db.update(table.tiktokAdsIntegration).set({
		accessTokenEncrypted: int.accessToken ? encrypt(int.tenantId, int.accessToken) : '',
		refreshTokenEncrypted: int.refreshToken ? encrypt(int.tenantId, int.refreshToken) : ''
	}).where(eq(table.tiktokAdsIntegration.id, int.id));
	done++;
}
console.log(`Backfilled ${done}/${integrations.length} integrations`);
process.exit(0);
```

- [ ] **Step 2: Rulează local + prod după deploy-ul Task 5.2+5.3**

Run: `cd app && bun scripts/backfill-tiktok-encrypted-tokens.ts`

- [ ] **Step 3 (DUPĂ 7 zile stabil): Migrație drop plaintext**

Creează `0XXX_tiktok_drop_plaintext_access.sql`:
```sql
ALTER TABLE tiktok_ads_integration DROP COLUMN access_token;
```
Și un al doilea fișier pentru refresh_token.

- [ ] **Step 4: Update schema Drizzle — scoate câmpurile plaintext**

- [ ] **Step 5: Update codul `readTokens` să NU mai facă fallback**

- [ ] **Step 6: Commit (separat, după verificare prod)**

---

## Faza 6 — Hardening de final

### Task 6.1: Adaugă `integrationId` în cache keys

**Files:**
- Modify: `app/src/lib/remotes/tiktok-reports.remote.ts:210, 312, 370, 429`

- [ ] **Step 1: Înlocuiește fiecare cache key**

| Location | Înainte | După |
|---|---|---|
| L210 | `tt-insights:${tenantId}:${params.advertiserId}:...` | `tt-insights:${tenantId}:${params.integrationId}:${params.advertiserId}:${params.since}:${params.until}` |
| L312 | `tt-campaigns:${tenantId}:${params.advertiserId}` | `tt-campaigns:${tenantId}:${params.integrationId}:${params.advertiserId}` |
| L370 | `tt-demographics:...` | Adaugă `${params.integrationId}:` după `${tenantId}:` |
| L429 | `tt-adgroups:...` | Adaugă `${params.integrationId}:` după `${tenantId}:` |

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/remotes/tiktok-reports.remote.ts
git commit -m "fix(tiktok-reports): include integrationId in cache keys per api-integrations skill"
```

### Task 6.2: Cascade delete pe `tiktok_ads_spending`

**Files:**
- Create: `app/src/lib/server/db/migrations/0XXX_tiktok_spending_cascade.sql`
- Modify: `app/src/lib/server/db/schema.ts:1762-1764`

- [ ] **Step 1: Update schema Drizzle**

```ts
	integrationId: text('integration_id')
		.notNull()
		.references(() => tiktokAdsIntegration.id, { onDelete: 'cascade' }),
```

- [ ] **Step 2: Generează + commit migrația**

Run: `cd app && bun drizzle-kit generate`

Verifică fișierul generat conține un singur ALTER TABLE (sau recrearea tabelei pentru SQLite — asta e normal în Drizzle SQLite). Update `_journal.json` dacă generate-ul nu o face automat.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/db/migrations/ app/src/lib/server/db/schema.ts
git commit -m "db(tiktok-ads): cascade delete spending rows when integration deleted"
```

### Task 6.3: Eroare unitară pentru "token-related" în toate 4 queries

**Files:**
- Modify: `app/src/lib/remotes/tiktok-reports.remote.ts`

- [ ] **Step 1: Creează helper `throwTiktokApiError`**

La începutul fișierului, sub `assertActiveIntegration`:

```ts
function throwTiktokApiError(err: unknown): never {
	const msg = err instanceof Error ? err.message : String(err);
	const lowered = msg.toLowerCase();
	const isAuth = /access[\s_-]?token|authoriz|401|40105|expired|revok/.test(lowered);
	if (isAuth) {
		throw error(401, 'Token-ul TikTok Ads a expirat sau a fost revocat. Reconectează din Settings → TikTok Ads.');
	}
	throw error(500, msg);
}
```

- [ ] **Step 2: Folosește în toate 4 `catch` blocks**

În fiecare din `getTiktokCampaignInsights`, `getTiktokActiveCampaigns`, `getTiktokDemographicInsights`, `getTiktokAdGroupInsights`, înlocuiește blocul catch cu:

```ts
		} catch (err) {
			throwTiktokApiError(err);
		}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/remotes/tiktok-reports.remote.ts
git commit -m "refactor(tiktok-reports): unify auth-error mapping across all report queries"
```

---

## Faza 7 — Verificare finală end-to-end

### Task 7.1: Rulează diagnostic script pe toate tenants

- [ ] **Step 1: În staging**

Run: `cd app && bun scripts/verify-tiktok-tokens.ts <tenant1>` — repetă pentru fiecare tenant cu TikTok configurat.

Așteptat (per tenant):
- Cel mult 1 integrare `active=true` per orgId
- `access_token expiresAt ≈ 1 an` (sau durata reală configurată la TikTok)
- `consecFailures = 0`
- Fiecare `advertiserId` apare o singură dată în dropdown (dedup)

### Task 7.2: Smoke test UI complet

- [ ] **Step 1: Settings → TikTok Ads**

- Verifică: nu există banner de eroare refresh.
- Verifică: buton "Curăță integrări orfane" funcționează (returnează `{deleted: N}`).

- [ ] **Step 2: Reports → TikTok Ads (pentru tenant-ul care a avut bug)**

- Selectează fiecare client TikTok din dropdown.
- Verifică: KPI-urile se încarcă în < 5s.
- Dacă o integrare chiar e dezactivată, UI-ul arată mesajul "Integrarea TikTok Ads este dezactivată...", NU "Eroare la încărcarea datelor".

- [ ] **Step 3: Client portal (login ca user de client)**

- Accesează `/client/<tenant>/(app)/reports/tiktok-ads` pentru un client mapat.
- Verifică: datele se încarcă, nu există dropdown de accounts orfane.

### Task 7.3: Așteaptă 48h, re-verifică

- [ ] **Step 1: După 48h de la deploy**

Run: `cd app && bun scripts/verify-tiktok-tokens.ts <tenant>`

Așteptat: `consecFailures` rămâne `0` sau scade la `0` după success; `access_token expiresAt` e în viitor fără să se fi reconnectat manual.

Dacă `consecFailures` crește: log-urile `OAuth refresh RAW response shape` din Faza 0 ar trebui să arate exact de ce — re-evaluează Faza 1 Task 1.2 (endpoint) și Faza 1 Task 1.3 (app fără refresh_token).

### Task 7.4: Update documentația

**Files:**
- Create: `docs/tiktok-ads-auth.md`

- [ ] **Step 1: Documentează arhitectura rezultată**

```markdown
# TikTok Ads Auth & Refresh

## Token lifecycle
- Initial exchange (/oauth2/access_token/ cu auth_code) returnează `access_token_expire_time` și `refresh_token_expire_time` ca UNIX timestamps (secunde).
- Access token: durata reală se ia din răspunsul API, nu un default hardcodat.
- Scheduler `token-refresh-daily` rulează la 6h. Refresh se face doar dacă token-ul expiră în < 1h.
- Dacă TikTok nu returnează refresh_token (app config), access_token-ul rămâne valid până la expirare reală, fără să iasă retry loop.

## Failure thresholds
- `consecutiveRefreshFailures >= 3` → notificare admin
- `>= 5` → integrare dezactivată automat

## Encryption
- Toate token-urile stocate cu AES-256-GCM (`$lib/server/crypto`), per tenant.
- `readTokensWithRetry` reîncearcă 2x pe `DecryptionError` (truncated Turso reads).

## Dedup
- `getTiktokReportAdAccounts` deduplică după `tiktokAdvertiserId` preferând integrarea activă — evită confuzia după reconectări cu orgId diferit.
```

- [ ] **Step 2: Update MEMORY.md (fișierul auto-memorie)**

În `/Users/augustin598/.claude/projects/-Users-augustin598-Projects-CRM/memory/MEMORY.md`, adaugă:
```md
- [TikTok Ads daily-reconnect fix](project_tiktok_auth_fix_2026_04.md) — Fixed field mapping (access_token_expire_time), dedup after reconnect, error display, encryption
```

- [ ] **Step 3: Commit final**

```bash
git add docs/tiktok-ads-auth.md
git commit -m "docs(tiktok-ads): document auth lifecycle after 2026-04 fix"
```

### Task 7.5: Curăță diagnostic logging din Faza 0 (opțional, după 30 zile)

**⚠️ LASĂ log-urile RAW pornite cel puțin 30 zile — dovezi pentru eventuale regresii.**

După 30 zile fără incidente:

- [ ] **Step 1: Înlocuiește log-ul verbose cu unul concis**

Schimbă `metadata: { topLevelKeys: ..., dataKeys: ..., ... }` cu `metadata: { httpStatus: res.status, errorCode: json.code }`.

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/server/tiktok-ads/auth.ts
git commit -m "chore(tiktok-ads): reduce oauth response logging to status + error code"
```

---

## Summary & PR checklist

**PR final trebuie să conțină:**
- [ ] Faze 0-6 toate commit-uite în ordine
- [ ] `docs/superpowers/plans/2026-04-18-tiktok-ads-daily-reconnect-fix.md` în commit-ul inițial (acest fișier)
- [ ] Teste manuale rulate (Task 7.1-7.2)
- [ ] `cd app && bunx svelte-check --threshold warning` — 0 erori
- [ ] Migration journal updated
- [ ] Log-urile Faza 0 confirmă presupunerile (linkuri către debug_log IDs în descrierea PR)

**Rollback plan:**
- Faza 5 (encryption) e dual-write; rollback = revert commit + restart, plaintext rămâne valid.
- Faza 6.2 (cascade) afectează datele; rollback = `ALTER TABLE drop foreign key` manual pe Turso.
- Toate celelalte faze sunt additive/defensive — revert curat.

**Impact utilizator la fiecare milestone:**
- După Faza 2 deploy (≈30 min): Dropdown-ul nu mai arată accounts moarte; user nu mai apasă pe ele.
- După Faza 3 deploy (≈1h): User vede mesajul real de eroare, nu "Eroare la încărcarea datelor".
- După Faza 1 + 24h: Token-ul expiră la durata reală, nu după 24h. Reconectarea zilnică se oprește.
- După Faza 4: Admin vede proactiv în Settings când refresh-ul e pe cale să eșueze.
- După Faza 5 + 7 zile stabil: Token-urile sunt criptate la rest.
