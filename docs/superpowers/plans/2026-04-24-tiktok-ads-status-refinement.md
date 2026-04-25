# TikTok Ads Payment Status — Secondary Status Refinement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elimină false-positive `risk_review` pe conturi TikTok unde contul e `STATUS_ENABLE` dar reclame individuale sunt respinse (ad-level policy), și îmbogățește snapshot-ul cu câmpuri TikTok secundare (`display_status`, `sub_status`, `reject_reason`) pentru diagnostic.

**Architecture:** (1) verificăm live prin debug endpoint ce returnează TikTok pentru contul Heylux; (2) extragem o funcție pură `isCampaignDelivering(secondaryStatus)` care tratează `CAMPAIGN_STATUS_PARTIAL_AUDIT_DENY` ca "still delivering"; (3) extindem `fetchAdvertiserStatuses` cu câmpurile secundare TikTok și le persistăm în `paymentStatusRaw` (JSON, coloană existentă — fără migrație); (4) afișăm câmpurile noi în dashboard-ul admin; (5) actualizăm docs.

**Tech Stack:** SvelteKit 5, Bun, TypeScript, Drizzle ORM (Turso), `bun:test`, Svelte MCP autofixer.

---

## File Structure

**New files:**
- `app/src/routes/[tenant]/api/_debug-verify-tiktok/[advertiserId]/+server.ts` — debug endpoint, șters la final
- `app/src/lib/server/tiktok-ads/campaign-health.ts` — pure classifier `isCampaignDelivering` + wrapper (extras din `client.ts`)
- `app/src/lib/server/tiktok-ads/campaign-health.test.ts` — `bun:test` pentru classifier

**Modified files:**
- `app/src/lib/server/tiktok-ads/client.ts` — `fetchAdvertiserStatuses` + `fetchAdvertiserCampaignHealth` folosesc noul classifier, returnează fields noi
- `app/src/lib/server/tiktok-ads/status.ts` — propagă câmpurile secundare în `PaymentStatusSnapshot`
- `app/src/lib/server/ads/payment-status-types.ts` — extinde `PaymentStatusSnapshot` cu `tiktokSecondary` (opțional)
- `app/src/lib/server/ads/payment-alerts.ts` — include câmpurile noi în JSON-ul `paymentStatusRaw`
- `app/src/lib/remotes/ads-status.remote.ts` — expune `rawSubStatus`, `rawRejectReason`, `rawDisplayStatus` în row DTO
- `app/src/routes/[tenant]/admin/ads-payment-status/+page.svelte` — afișează câmpurile extra în coloana "Cod raw"
- `app/docs/ads-status-mappings.md` — update tabel TikTok + istoric incident

---

## Task 0: Gather Evidence — Debug Endpoint

**Files:**
- Create: `app/src/routes/[tenant]/api/_debug-verify-tiktok/[advertiserId]/+server.ts`

Scop: confirmă ipoteza (primary = `STATUS_ENABLE`, toate campaniile au `secondary_status = CAMPAIGN_STATUS_PARTIAL_AUDIT_DENY`) înainte de orice fix. Fail-fast dacă ipoteza e greșită.

- [ ] **Step 1: Create debug endpoint**

```ts
// app/src/routes/[tenant]/api/_debug-verify-tiktok/[advertiserId]/+server.ts
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getAuthenticatedToken } from '$lib/server/tiktok-ads/auth';
import type { RequestHandler } from './$types';

const TIKTOK_API_URL = 'https://business-api.tiktok.com/open_api/v1.3';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user?.isAdmin) error(403, 'admin only');
	const advertiserId = params.advertiserId!;
	const tenant = locals.tenant;
	if (!tenant) error(404, 'tenant');

	const account = await db.query.tiktokAdsAccount.findFirst({
		where: and(
			eq(table.tiktokAdsAccount.tenantId, tenant.id),
			eq(table.tiktokAdsAccount.tiktokAdvertiserId, advertiserId),
		),
	});
	if (!account) error(404, 'advertiser not found for tenant');

	const auth = await getAuthenticatedToken(account.integrationId);
	if (!auth) error(500, 'no token');

	const infoRes = await fetch(
		`${TIKTOK_API_URL}/advertiser/info/?advertiser_ids=${encodeURIComponent(JSON.stringify([advertiserId]))}`,
		{ headers: { 'Access-Token': auth.accessToken } },
	);
	const info = await infoRes.json();

	const campRes = await fetch(
		`${TIKTOK_API_URL}/campaign/get/?advertiser_id=${advertiserId}&page_size=1000&fields=${encodeURIComponent(JSON.stringify(['campaign_id', 'campaign_name', 'operation_status', 'secondary_status']))}`,
		{ headers: { 'Access-Token': auth.accessToken } },
	);
	const campaigns = await campRes.json();

	return json({
		storedPaymentStatus: account.paymentStatus,
		storedPaymentStatusRaw: account.paymentStatusRaw,
		advertiserInfo: info.data?.list?.[0] ?? info,
		campaigns: campaigns.data?.list ?? campaigns,
	});
};
```

- [ ] **Step 2: Run against the reported account**

Run (înlocuiește `<tenant-slug>` cu slug-ul tenantului OTS și asigură-te că ești logat ca admin în browser, apoi copiază cookie-ul):

```bash
curl -s -H "Cookie: <session-cookie>" \
  "http://localhost:5173/<tenant-slug>/api/_debug-verify-tiktok/7625561661356949512" \
  | bun x prettier --parser json
```

Expected: vezi `advertiserInfo.status`, `advertiserInfo.sub_status`, `advertiserInfo.display_status`, `advertiserInfo.reject_reason`, plus lista campaniilor cu `operation_status` și `secondary_status`.

- [ ] **Step 3: Document findings inline în plan**

Adaugă la finalul task-ului o secțiune `<!-- EVIDENCE -->` cu output-ul (statusul primar + distribuția `secondary_status` peste campanii + valoarea oricărui câmp sub/display/reject). Dacă ipoteza NU se confirmă (primary nu e `STATUS_ENABLE`), oprește planul și re-brainstorm.

- [ ] **Step 4: Commit evidence-only**

```bash
git add app/src/routes/[tenant]/api/_debug-verify-tiktok docs/superpowers/plans/2026-04-24-tiktok-ads-status-refinement.md
git commit -m "chore(tiktok): add debug endpoint for advertiser status investigation"
```

---

## Task 1: Pure `isCampaignDelivering` Classifier + Tests (TDD)

**Files:**
- Create: `app/src/lib/server/tiktok-ads/campaign-health.ts`
- Create: `app/src/lib/server/tiktok-ads/campaign-health.test.ts`

Scop: funcție pură, testabilă, care răspunde la "campania asta livrează reclame?" indiferent ce cod exotic returnează TikTok.

- [ ] **Step 1: Write failing tests**

```ts
// app/src/lib/server/tiktok-ads/campaign-health.test.ts
import { describe, expect, test } from 'bun:test';
import { isCampaignDelivering, classifySecondaryStatus } from './campaign-health';

describe('isCampaignDelivering', () => {
	test('DELIVERY_OK → true', () => {
		expect(isCampaignDelivering('CAMPAIGN_STATUS_DELIVERY_OK')).toBe(true);
		expect(isCampaignDelivering('STATUS_DELIVERY_OK')).toBe(true);
	});

	test('PARTIAL_AUDIT_DENY → true (campaign still serves approved ads)', () => {
		expect(isCampaignDelivering('CAMPAIGN_STATUS_PARTIAL_AUDIT_DENY')).toBe(true);
	});

	test('BUDGET_EXCEED → false', () => {
		expect(isCampaignDelivering('CAMPAIGN_STATUS_BUDGET_EXCEED')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_BUDGET_EXCEED')).toBe(false);
	});

	test('full audit deny / punish / not delivery → false', () => {
		expect(isCampaignDelivering('CAMPAIGN_STATUS_ADVERTISER_AUDIT_DENY')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_STATUS_ADVERTISER_ACCOUNT_PUNISH')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_STATUS_NOT_DELIVERY')).toBe(false);
	});

	test('lifecycle non-delivering → false', () => {
		expect(isCampaignDelivering('CAMPAIGN_STATUS_NOT_START')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_STATUS_TIME_DONE')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_STATUS_DONE')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_STATUS_NO_SCHEDULE')).toBe(false);
	});

	test('disabled / deleted → false', () => {
		expect(isCampaignDelivering('CAMPAIGN_STATUS_DISABLE')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_STATUS_DELETE')).toBe(false);
	});

	test('case-insensitive (uppercase-normalized)', () => {
		expect(isCampaignDelivering('campaign_status_delivery_ok')).toBe(true);
		expect(isCampaignDelivering('campaign_status_partial_audit_deny')).toBe(true);
	});

	test('empty / unknown → false (conservative)', () => {
		expect(isCampaignDelivering('')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_STATUS_SOMETHING_NEW')).toBe(false);
	});
});

describe('classifySecondaryStatus', () => {
	test('delivering + partial_audit_deny → delivering', () => {
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_DELIVERY_OK')).toBe('delivering');
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_PARTIAL_AUDIT_DENY')).toBe('delivering');
	});

	test('budget exceed → budget_exceeded', () => {
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_BUDGET_EXCEED')).toBe('budget_exceeded');
		expect(classifySecondaryStatus('CAMPAIGN_BUDGET_EXCEED')).toBe('budget_exceeded');
	});

	test('audit deny / punish → blocked', () => {
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_ADVERTISER_AUDIT_DENY')).toBe('blocked');
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_ADVERTISER_ACCOUNT_PUNISH')).toBe('blocked');
	});

	test('lifecycle / disabled → inactive', () => {
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_NOT_START')).toBe('inactive');
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_DONE')).toBe('inactive');
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_DISABLE')).toBe('inactive');
	});

	test('unknown → inactive (fail-closed)', () => {
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_WEIRD')).toBe('inactive');
	});
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd app && bun test src/lib/server/tiktok-ads/campaign-health.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement classifier**

```ts
// app/src/lib/server/tiktok-ads/campaign-health.ts
/**
 * Pure helpers for TikTok campaign-level secondary_status values.
 *
 * TikTok Business API /campaign/get/ returns a secondary_status field
 * distinct from operation_status. operation_status = user intent
 * (ENABLE/DISABLE/DELETE), secondary_status = current platform state.
 *
 * Docs: business-api.tiktok.com/portal/docs → Campaign Operation Status
 *       business-api.tiktok.com/portal/docs → Secondary Status enum
 *
 * Critical: PARTIAL_AUDIT_DENY means SOME ads were denied, but the
 * campaign is still serving the approved ads. Treating this as
 * "not delivering" causes false-positive risk_review on accounts
 * where only ad-level policy rejections happened.
 */

export type SecondaryClass = 'delivering' | 'budget_exceeded' | 'blocked' | 'inactive';

const DELIVERING = new Set([
	'CAMPAIGN_STATUS_DELIVERY_OK',
	'STATUS_DELIVERY_OK',
	'CAMPAIGN_STATUS_PARTIAL_AUDIT_DENY', // partial — approved ads still serve
]);

const BUDGET_EXCEEDED = new Set([
	'CAMPAIGN_STATUS_BUDGET_EXCEED',
	'CAMPAIGN_BUDGET_EXCEED',
	'CAMPAIGN_STATUS_BALANCE_EXCEED',
]);

const BLOCKED = new Set([
	'CAMPAIGN_STATUS_ADVERTISER_AUDIT_DENY',
	'CAMPAIGN_STATUS_ADVERTISER_ACCOUNT_PUNISH',
	'CAMPAIGN_STATUS_ADVERTISER_AUDIT',
	'CAMPAIGN_STATUS_ADVERTISER_CONTRACT_PENDING',
	'CAMPAIGN_STATUS_NOT_DELIVERY',
]);

export function isCampaignDelivering(secondaryStatus: string): boolean {
	return DELIVERING.has(secondaryStatus.toUpperCase());
}

export function classifySecondaryStatus(secondaryStatus: string): SecondaryClass {
	const s = secondaryStatus.toUpperCase();
	if (DELIVERING.has(s)) return 'delivering';
	if (BUDGET_EXCEEDED.has(s)) return 'budget_exceeded';
	if (BLOCKED.has(s)) return 'blocked';
	return 'inactive';
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd app && bun test src/lib/server/tiktok-ads/campaign-health.test.ts`
Expected: PASS, 20+ assertions.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/tiktok-ads/campaign-health.ts app/src/lib/server/tiktok-ads/campaign-health.test.ts
git commit -m "feat(tiktok): pure classifier for campaign secondary_status (PARTIAL_AUDIT_DENY still delivers)"
```

---

## Task 2: Integrate Classifier in `fetchAdvertiserCampaignHealth`

**Files:**
- Modify: `app/src/lib/server/tiktok-ads/client.ts:1147-1207`

- [ ] **Step 1: Replace hard-coded branches with classifier**

Înlocuiește bucla de clasificare a campaniilor. Noul cod:

```ts
// app/src/lib/server/tiktok-ads/client.ts (în fetchAdvertiserCampaignHealth)
import { classifySecondaryStatus } from './campaign-health';

// ... în bucla existentă, înlocuiește if/else if:
for (const c of json.data.list as any[]) {
	const op = String(c.operation_status || '').toUpperCase();
	const sec = String(c.secondary_status || '');

	if (op === 'ENABLE' || op === 'CAMPAIGN_STATUS_ENABLE') {
		enabled += 1;
		const cls = classifySecondaryStatus(sec);
		if (cls === 'delivering') delivering += 1;
		else if (cls === 'budget_exceeded') budgetExceeded += 1;
	}
}
```

Restul funcției rămâne neschimbat (issue derivation, return).

- [ ] **Step 2: Spot-check — rulează existent campaign health în test ad-hoc**

Run (în REPL sau quick script, optional):
```bash
cd app && bun test src/lib/server/tiktok-ads/
```
Expected: toate testele trec (existente + cele noi).

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/tiktok-ads/client.ts
git commit -m "fix(tiktok): treat PARTIAL_AUDIT_DENY as delivering in campaign health check"
```

---

## Task 3: Extend `fetchAdvertiserStatuses` cu câmpuri secundare

**Files:**
- Modify: `app/src/lib/server/tiktok-ads/client.ts:1079-1114`

- [ ] **Step 1: Extinde interface + fetch**

```ts
// app/src/lib/server/tiktok-ads/client.ts (înlocuiește interface + funcție)
export interface TiktokAdvertiserStatusInfo {
	advertiserId: string;
	accountName: string;
	status: string;
	/** UI-facing status — poate diferi de `status` */
	displayStatus: string | null;
	/** Motiv granular (REASON_ADVERTISER_AUDIT, REASON_ADVERTISER_PUNISH, ...) */
	subStatus: string | null;
	/** Cod/string explicativ pt. rejected accounts */
	rejectReason: string | null;
}

export async function fetchAdvertiserStatuses(
	advertiserIds: string[],
	accessToken: string
): Promise<TiktokAdvertiserStatusInfo[]> {
	if (advertiserIds.length === 0) return [];

	const params = new URLSearchParams({
		advertiser_ids: JSON.stringify(advertiserIds),
		// Nu pasăm `fields` — /advertiser/info/ returnează by default toate câmpurile;
		// dacă TikTok adaugă câmpuri noi nu trebuie să schimbăm aici.
	});

	const res = await fetch(`${TIKTOK_API_URL}/advertiser/info/?${params.toString()}`, {
		headers: { 'Access-Token': accessToken },
		signal: AbortSignal.timeout(10_000)
	});

	const json = await res.json();
	if (json.code !== 0 || !json.data?.list) {
		throw new Error(`TikTok advertiser/info error: ${json.message || 'Unknown'}`);
	}

	return (json.data.list as any[]).map((adv) => ({
		advertiserId: String(adv.advertiser_id),
		accountName: adv.advertiser_name || adv.name || `Advertiser ${adv.advertiser_id}`,
		status: adv.status || 'STATUS_ENABLE',
		displayStatus: adv.display_status ? String(adv.display_status) : null,
		subStatus: adv.sub_status ? String(adv.sub_status) : null,
		rejectReason: adv.reject_reason ? String(adv.reject_reason) : null,
	}));
}
```

- [ ] **Step 2: No test added here** — `fetchAdvertiserStatuses` atinge rețea, este acoperit indirect prin integration de la Task 4. Spot-check manual cu endpoint-ul debug din Task 0:

```bash
curl -s -H "Cookie: <session-cookie>" \
  "http://localhost:5173/<tenant-slug>/api/_debug-verify-tiktok/7625561661356949512"
```
Expected: răspunsul include `advertiserInfo.sub_status` / `display_status` / `reject_reason` (poate fi null pentru conturi healthy — asta e OK).

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/tiktok-ads/client.ts
git commit -m "feat(tiktok): capture display_status / sub_status / reject_reason from advertiser/info"
```

---

## Task 4: Extend `PaymentStatusSnapshot` + Propagate

**Files:**
- Modify: `app/src/lib/server/ads/payment-status-types.ts:11-26`
- Modify: `app/src/lib/server/tiktok-ads/status.ts:25-107`

- [ ] **Step 1: Add optional TikTok details**

```ts
// app/src/lib/server/ads/payment-status-types.ts (adaugă la PaymentStatusSnapshot)
export interface PaymentStatusSnapshot {
	provider: AdsProvider;
	integrationId: string;
	accountTableId: string;
	externalAccountId: string;
	clientId: string | null;
	accountName: string;
	paymentStatus: AdsPaymentStatus;
	rawStatusCode: string | number;
	rawDisableReason?: string | number | null;
	balanceCents?: number | null;
	currencyCode?: string | null;
	checkedAt: Date;
	/** TikTok-only secondary fields, null pentru Meta/Google */
	tiktokSecondary?: {
		displayStatus: string | null;
		subStatus: string | null;
		rejectReason: string | null;
		deliveryIssue: 'none' | 'budget_exceeded' | 'no_delivery' | 'all_paused' | null;
	} | null;
}
```

- [ ] **Step 2: Propagă în `fetchTikTokPaymentStatus`**

În `app/src/lib/server/tiktok-ads/status.ts`, în bucla care produce `snapshots`, adaugă `tiktokSecondary`:

```ts
// app/src/lib/server/tiktok-ads/status.ts (în loop, după let rawDisableReason...)
const health = healthByAdvertiser.get(row.tiktokAdvertiserId) ?? null;

// override-ul existent pt. no_delivery / budget_exceeded
if (paymentStatus === 'ok') {
	if (health && (health.issue === 'budget_exceeded' || health.issue === 'no_delivery')) {
		paymentStatus = 'risk_review';
		rawDisableReason = health.issue;
	}
}

snapshots.push({
	provider: 'tiktok',
	integrationId: integration.id,
	accountTableId: row.id,
	externalAccountId: row.tiktokAdvertiserId,
	clientId: row.clientId ?? null,
	accountName: adv.accountName || row.accountName || row.tiktokAdvertiserId,
	paymentStatus,
	rawStatusCode,
	rawDisableReason,
	balanceCents: balance?.balanceCents ?? null,
	currencyCode: balance?.currencyCode ?? null,
	checkedAt,
	tiktokSecondary: {
		displayStatus: adv.displayStatus,
		subStatus: adv.subStatus,
		rejectReason: adv.rejectReason,
		deliveryIssue: health?.issue ?? null,
	},
});
```

- [ ] **Step 3: Run TS check**

Run: `cd app && npx svelte-check --threshold warning --tsconfig tsconfig.json src/lib/server/tiktok-ads src/lib/server/ads`
Expected: 0 errors în fișierele atinse.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/server/ads/payment-status-types.ts app/src/lib/server/tiktok-ads/status.ts
git commit -m "feat(tiktok): propagate secondary fields in PaymentStatusSnapshot"
```

---

## Task 5: Persist Secondary Fields in `paymentStatusRaw` JSON

**Files:**
- Modify: `app/src/lib/server/ads/payment-alerts.ts:33-45`

- [ ] **Step 1: Include tiktokSecondary în JSON snapshot**

```ts
// app/src/lib/server/ads/payment-alerts.ts (înlocuiește funcția persistStatus începutul)
async function persistStatus(snap: PaymentStatusSnapshot, tenantId: string) {
	const raw = JSON.stringify({
		code: snap.rawStatusCode,
		disableReason: snap.rawDisableReason ?? null,
		balanceCents: snap.balanceCents ?? null,
		currency: snap.currencyCode ?? null,
		tiktokSecondary: snap.tiktokSecondary ?? null,
	});
	// ... restul funcției rămâne identic
	const payload = {
		paymentStatus: snap.paymentStatus,
		paymentStatusRaw: raw,
		paymentStatusCheckedAt: snap.checkedAt,
		updatedAt: snap.checkedAt,
	};
	// ... update statements rămân identice
}
```

**Backward compat:** câmpul e opțional, conturile Meta/Google persistă `tiktokSecondary: null`. Consumerii existenți (dashboard, email digest) parse JSON-ul ca `Record<string, unknown>` și ignoră câmpurile lipsă.

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/server/ads/payment-alerts.ts
git commit -m "feat(ads): persist tiktokSecondary in payment_status_raw JSON"
```

---

## Task 6: Expose Secondary Fields în Dashboard Remote

**Files:**
- Modify: `app/src/lib/remotes/ads-status.remote.ts` (tipurile de DTO + `statusLabel` mapping la liniile ~31, ~77, ~234, ~373)

- [ ] **Step 1: Adaugă câmpuri în DTO**

În interfața `FlaggedRow` (sau echivalent, caut-o cu `statusLabel`), adaugă:

```ts
// în interfața rândului
rawSubStatus: string | null;
rawRejectReason: string | null;
rawDisplayStatus: string | null;
rawDeliveryIssue: string | null;
```

În funcția care mapează rândul (caută `statusLabel: PAYMENT_STATUS_LABEL_RO`), parsează `paymentStatusRaw` JSON și citește `tiktokSecondary`:

```ts
// la construirea row-ului
let tt: {
	displayStatus: string | null;
	subStatus: string | null;
	rejectReason: string | null;
	deliveryIssue: string | null;
} | null = null;
try {
	const parsed = acc.paymentStatusRaw ? JSON.parse(acc.paymentStatusRaw) : null;
	if (parsed && typeof parsed === 'object' && parsed.tiktokSecondary) {
		tt = parsed.tiktokSecondary;
	}
} catch { /* corrupt JSON — ignore */ }

return {
	// ... câmpurile existente
	rawSubStatus: tt?.subStatus ?? null,
	rawRejectReason: tt?.rejectReason ?? null,
	rawDisplayStatus: tt?.displayStatus ?? null,
	rawDeliveryIssue: tt?.deliveryIssue ?? null,
};
```

Aplică același tratament în ambele locuri unde se construiește un rând (dashboard + client alert), ~liniile 234 și 373. Păstrează `rawSubStatus`/etc doar pt. provider === 'tiktok', altfel null.

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/remotes/ads-status.remote.ts
git commit -m "feat(ads-status): expose tiktok secondary fields in dashboard rows"
```

---

## Task 7: Display în Dashboard Svelte

**Files:**
- Modify: `app/src/routes/[tenant]/admin/ads-payment-status/+page.svelte:315-324`

- [ ] **Step 1: Update coloana "Cod raw"**

Înlocuiește blocul existent care afișează `rawStatusCode` și `rawDisableReason`:

```svelte
<td class="py-3 pr-3">
	<code class="rounded bg-muted px-1.5 py-0.5 text-xs">
		{row.rawStatusCode || '—'}
	</code>
	{#if row.rawDisableReason}
		<div class="text-xs text-muted-foreground">
			reason: {row.rawDisableReason}
		</div>
	{/if}
	{#if row.provider === 'tiktok'}
		{#if row.rawSubStatus}
			<div class="text-xs text-muted-foreground">
				sub: <code>{row.rawSubStatus}</code>
			</div>
		{/if}
		{#if row.rawDisplayStatus && row.rawDisplayStatus !== row.rawStatusCode}
			<div class="text-xs text-muted-foreground">
				display: <code>{row.rawDisplayStatus}</code>
			</div>
		{/if}
		{#if row.rawRejectReason}
			<div class="text-xs text-muted-foreground">
				reject: <code>{row.rawRejectReason}</code>
			</div>
		{/if}
		{#if row.rawDeliveryIssue && row.rawDeliveryIssue !== 'none'}
			<div class="text-xs text-amber-600 dark:text-amber-400">
				delivery: {row.rawDeliveryIssue}
			</div>
		{/if}
	{/if}
</td>
```

- [ ] **Step 2: Rulează svelte-autofixer (MCP Svelte server)**

Apelează `mcp__svelte__svelte-autofixer` pe fișier. Dacă raportează warnings, rezolvă-le și reaplică până e curat.

- [ ] **Step 3: Type check**

Run: `cd app && npx svelte-check --threshold warning`
Expected: 0 erori în fișierul atins.

- [ ] **Step 4: Commit**

```bash
git add app/src/routes/[tenant]/admin/ads-payment-status/+page.svelte
git commit -m "feat(admin): show tiktok sub_status / reject_reason in payment status dashboard"
```

---

## Task 8: Remove Debug Endpoint

**Files:**
- Delete: `app/src/routes/[tenant]/api/_debug-verify-tiktok/`

- [ ] **Step 1: Delete directory**

```bash
rm -rf app/src/routes/[tenant]/api/_debug-verify-tiktok
```

- [ ] **Step 2: Commit**

```bash
git add -A app/src/routes/[tenant]/api/_debug-verify-tiktok
git commit -m "chore(tiktok): remove debug endpoint after verification"
```

---

## Task 9: Update Docs

**Files:**
- Modify: `app/docs/ads-status-mappings.md`

- [ ] **Step 1: Adaugă linii în tabelul TikTok + secțiune nouă despre secondary status**

În tabelul TikTok (după `STATUS_ADVERTISER_AUTHORIZATION_PENDING`), adaugă o notă:

```markdown
### Status secundar (stocat în `paymentStatusRaw.tiktokSecondary`)

Pentru diagnostic mai fin, din `/advertiser/info/` capturăm acum și:

| Câmp | Descriere | Apariții tipice |
|---|---|---|
| `display_status` | Status UI-facing (poate diferi de `status`) | rar diferit |
| `sub_status` | Motiv granular: `REASON_ADVERTISER_AUDIT`, `REASON_ADVERTISER_PUNISH`, ... | la conturi cu probleme active |
| `reject_reason` | Cod explicativ pt. conturi respinse: `INVALID_BUSINESS_LICENSE`, ... | doar la STATUS_REJECTED |
| `deliveryIssue` | Agregat la nivel de cont din campaign health: `none \| budget_exceeded \| no_delivery \| all_paused` | override-ul nostru |

### Campaign secondary_status — `delivering` vs `blocked`

Contul e marcat `risk_review` când primary = `STATUS_ENABLE` dar `deliveringCount === 0` peste toate campaniile user-enabled. "Delivering" include:

- `CAMPAIGN_STATUS_DELIVERY_OK` — normal
- `CAMPAIGN_STATUS_PARTIAL_AUDIT_DENY` — **unele reclame respinse la nivel de ad, dar campania livrează cu cele aprobate**

Toate celelalte (BUDGET_EXCEED, NOT_DELIVERY, ADVERTISER_AUDIT_DENY, lifecycle DONE/NOT_START, DISABLE, DELETE) nu contează ca delivering.
```

În secțiunea "Istoric incidente":

```markdown
| 2026-04-24 | 1+ TikTok cont marcat `risk_review` greșit | `PARTIAL_AUDIT_DENY` era tratat ca "not delivering" deși campaniile livrau cu reclame aprobate | Introdus `isCampaignDelivering` + capturat `sub_status`/`reject_reason`/`display_status` în raw snapshot |
```

- [ ] **Step 2: Commit**

```bash
git add app/docs/ads-status-mappings.md
git commit -m "docs(ads): document tiktok secondary status + PARTIAL_AUDIT_DENY fix"
```

---

## Self-Review Checklist

- **Spec coverage:** cele 2 întrebări ale user-ului — "cum tratăm asemenea statusuri" (Task 2+4+5) și "avem statusuri secundare" (Task 3+6+7+9) — sunt acoperite. ✓
- **Placeholder scan:** zero TBD/similar. ✓
- **Type consistency:** `TiktokAdvertiserStatusInfo` extins cu 3 câmpuri (displayStatus/subStatus/rejectReason) — folosit consistent în Task 3 și Task 4. `tiktokSecondary` are aceleași 3 câmpuri + `deliveryIssue` — setat în Task 4, persistat în Task 5, citit în Task 6, afișat în Task 7. ✓
- **Verificare root cause înainte de fix:** Task 0 obligă confirmarea ipotezei; dacă evidence nu susține, oprim. ✓
- **Zero migrații DB:** folosim coloana JSON existentă `payment_status_raw`. ✓
- **Svelte MCP:** Task 7 obligă `svelte-autofixer` pe .svelte. ✓
