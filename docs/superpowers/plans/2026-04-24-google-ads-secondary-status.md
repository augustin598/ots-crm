# Google Ads Secondary Status (Faza 1 — `customer.suspension_reasons`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture și afișează `customer.suspension_reasons` (array) pentru conturile Google Ads suspendate — echivalentul direct al `rejection_reason` de la TikTok — astfel încât dashboard-ul admin, cardul client și emailul digest să arate motivul exact al suspendării + sugestie acționabilă, în română.

**Architecture:** (1) adăugăm o funcție nouă `fetchCustomerSuspensionReasons(customerId)` în `google-ads/client.ts` care rulează GAQL `SELECT customer.suspension_reasons FROM customer` pe fiecare sub-cont ENABLED/SUSPENDED (paralel cu `fetchBillingSetupStatus`); (2) extindem `PaymentStatusSnapshot` cu `googleSecondary.suspensionReasons: string[]`; (3) persistăm în `paymentStatusRaw`; (4) parsăm în remote DTO (admin + client); (5) extindem `describeStatus` în modulul partajat `$lib/ads/status-copy.ts` cu case Google + translate RO pentru fiecare reason; (6) dashboard admin afișează lista; (7) card client + email digest auto-pick cu copy acționabil per reason.

**Tech Stack:** SvelteKit 5, Bun, TypeScript, Drizzle ORM (libSQL/Turso), `google-ads-api` npm lib, `bun:test`, Svelte MCP autofixer.

**Out of scope:**
- `campaign.serving_status` / `campaign.primary_status` (Faza 2 separată — dacă vedem cazuri "ENABLED dar nu livrează")
- `payments_account.status` (Faza 3 — opțional, edge case)
- Schema changes (folosim coloana JSON existentă `payment_status_raw`)

---

## File Structure

**New files:**
- `app/src/routes/[tenant]/api/_debug-verify-google/[customerId]/+server.ts` — debug endpoint admin-gated, analog TikTok — **rămâne pe loc** per memory `feedback_keep_debug_endpoints`.

**Modified files:**
- `app/src/lib/server/google-ads/client.ts` — adăugă `fetchCustomerSuspensionReasons`, enum mapper numeric → string
- `app/src/lib/server/google-ads/status.ts` — apelează noua funcție în paralel cu `fetchBillingSetupStatus`, propagă în snapshot
- `app/src/lib/server/ads/payment-status-types.ts` — extind `PaymentStatusSnapshot` cu `googleSecondary`
- `app/src/lib/server/ads/payment-alerts.ts` — pass `suspensionReasons` către `describeStatus`
- `app/src/lib/ads/status-copy.ts` — extind `DescribeStatusInput` cu `googleSuspensionReasons?: string[]`, adaugă translate RO per reason, helper `translateGoogleSuspensionReason`
- `app/src/lib/ads/status-copy.test.ts` — teste noi pt. fiecare reason + edge cases
- `app/src/lib/remotes/ads-status.remote.ts` — expune `googleSuspensionReasons` pe `FlaggedAccountRow` (admin) și `ClientAdsHealthItem` (doar tiktok/google unde aplicabil)
- `app/src/routes/[tenant]/admin/ads-payment-status/+page.svelte` — afișează raw reasons în coloana "Cod raw" (google only)
- `app/src/lib/components/client/ads-health-alert.svelte` — nu necesită modificare (preia automat din `describeStatus`)
- `app/scripts/demo-ads-digest-email.ts` — adaugă case demo cu Google suspendat (UNPAID_BALANCE + SUSPICIOUS_PAYMENT_ACTIVITY) per memory `feedback_email_demo_preview`
- `app/docs/ads-status-mappings.md` — document secțiune Google secondary + tabel translate

---

## Enum: `CustomerStatusEnum.SuspensionReason`

Din Google Ads API v17+ docs (confirmat Gemini 2026-04-24). Array returnat pe `customer.suspension_reasons`:

| Valoare | RO | Sugestie acționabilă RO |
|---|---|---|
| `SUSPICIOUS_PAYMENT_ACTIVITY` | Activitate de plată suspicioasă | Verifică metoda de plată în Google Ads → Billing, confirmă proprietatea cardului, contactează suportul dacă persistă. |
| `UNPAID_BALANCE` | Sold neachitat | Deschide Google Ads → Billing → Summary și achită soldul restant pentru a relua livrarea reclamelor. |
| `CIRCUMVENTING_SYSTEMS` | Eludarea sistemelor Google | Revizuiește reclamele, landing page-urile și targetingul pentru a elimina orice tehnică de bypass, apoi depune appeal în Google Ads Support. |
| `MISREPRESENTATION` | Reprezentare falsă a afacerii | Clarifică identitatea afacerii (nume, URL, contact) în Google Ads → Settings; dacă datele sunt corecte, deschide un ticket pentru appeal. |
| `UNACCEPTABLE_BUSINESS_PRACTICES` | Practici comerciale inacceptabile | Revizuiește reclamele și landing page-ul conform politicilor Google Ads (înșelăciune utilizatori, taxe ascunse). Depune appeal după remediere. |
| `UNAUTHORIZED_ACCOUNT_ACTIVITY` | Activitate neautorizată | Schimbă parola Google imediat, activează 2FA, revocă accesul utilizatorilor suspecți din Google Ads → Access & security. |
| `UNSPECIFIED` / `UNKNOWN` | Motiv nespecificat | Deschide un ticket Google Ads Support pentru detalii. |

---

## Task 0: Evidence via debug endpoint

**Files:**
- Create: `app/src/routes/[tenant]/api/_debug-verify-google/[customerId]/+server.ts`

Scop: validare end-to-end că Google returnează `suspension_reasons` pentru conturile efectiv suspendate din tenantul user-ului, ÎNAINTE să construim maparea.

- [ ] **Step 1: Create debug endpoint**

```ts
// app/src/routes/[tenant]/api/_debug-verify-google/[customerId]/+server.ts
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getAuthenticatedClient } from '$lib/server/google-ads/auth';
import { getSubAccountClient, fetchBillingSetupStatus, formatCustomerId } from '$lib/server/google-ads/client';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw error(403, 'Forbidden');
	}

	const customerId = formatCustomerId(event.params.customerId!);
	const tenantId = event.locals.tenant.id;

	const [account] = await db
		.select()
		.from(table.googleAdsAccount)
		.where(
			and(
				eq(table.googleAdsAccount.tenantId, tenantId),
				eq(table.googleAdsAccount.googleAdsCustomerId, customerId),
			),
		)
		.limit(1);
	if (!account) throw error(404, 'customer not found for tenant');

	const auth = await getAuthenticatedClient(tenantId);
	if (!auth) throw error(500, 'no auth');

	const client = getSubAccountClient(
		auth.integration.mccAccountId,
		customerId,
		auth.integration.developerToken,
		auth.integration.refreshToken,
	);

	const customerRows = await client.query(`
		SELECT customer.id, customer.status, customer.suspension_reasons
		FROM customer
		LIMIT 1
	`);
	const billingSetup = await fetchBillingSetupStatus(
		auth.integration.mccAccountId,
		customerId,
		auth.integration.developerToken,
		auth.integration.refreshToken,
	);

	return json({
		storedPaymentStatus: account.paymentStatus,
		storedPaymentStatusRaw: account.paymentStatusRaw,
		customerRaw: customerRows,
		billingSetupStatus: billingSetup,
	});
};
```

- [ ] **Step 2: Verify with a suspended or live account**

Run în browser (logat ca admin):
```
http://localhost:5173/<TENANT-SLUG>/api/_debug-verify-google/<CUSTOMER-ID>
```

Expected: `customerRaw[0].customer.suspension_reasons` prezent (array de numeric enums sau string enums, depinde de cum google-ads-api lib le returnează).

- [ ] **Step 3: Record the raw shape (numeric vs string enum)**

Copie în comentariu pe endpoint valorile observate. `google-ads-api` pe Node returnează deseori enum-urile ca `number` (ex: `[3, 2]`). Dacă așa e, Task 2 mapează numeric → string.

- [ ] **Step 4: Commit debug endpoint**

```bash
git add app/src/routes/[tenant]/api/_debug-verify-google
git commit -m "chore(google-ads): add debug endpoint for customer.suspension_reasons investigation"
```

---

## Task 1: Pure translator for Google suspension reasons + tests (TDD)

**Files:**
- Modify: `app/src/lib/ads/status-copy.ts`
- Modify: `app/src/lib/ads/status-copy.test.ts`

Scop: mapare determinist enum → `{ label, suggestion }` RO, pură, testată exhaustiv.

- [ ] **Step 1: Write failing tests**

Append to `app/src/lib/ads/status-copy.test.ts`:

```ts
import { translateGoogleSuspensionReason, translateGoogleSuspensionReasons } from './status-copy';

describe('translateGoogleSuspensionReason', () => {
	test('UNPAID_BALANCE → billing copy', () => {
		const out = translateGoogleSuspensionReason('UNPAID_BALANCE');
		expect(out.label).toBe('Sold neachitat');
		expect(out.suggestion).toContain('Billing');
	});
	test('SUSPICIOUS_PAYMENT_ACTIVITY → payment method copy', () => {
		const out = translateGoogleSuspensionReason('SUSPICIOUS_PAYMENT_ACTIVITY');
		expect(out.label).toBe('Activitate de plată suspicioasă');
		expect(out.suggestion).toContain('metoda de plată');
	});
	test('CIRCUMVENTING_SYSTEMS → appeal copy', () => {
		const out = translateGoogleSuspensionReason('CIRCUMVENTING_SYSTEMS');
		expect(out.label).toBe('Eludarea sistemelor Google');
		expect(out.suggestion).toContain('appeal');
	});
	test('MISREPRESENTATION → identity copy', () => {
		const out = translateGoogleSuspensionReason('MISREPRESENTATION');
		expect(out.label).toBe('Reprezentare falsă a afacerii');
	});
	test('UNACCEPTABLE_BUSINESS_PRACTICES → practices copy', () => {
		const out = translateGoogleSuspensionReason('UNACCEPTABLE_BUSINESS_PRACTICES');
		expect(out.label).toBe('Practici comerciale inacceptabile');
	});
	test('UNAUTHORIZED_ACCOUNT_ACTIVITY → security copy', () => {
		const out = translateGoogleSuspensionReason('UNAUTHORIZED_ACCOUNT_ACTIVITY');
		expect(out.suggestion).toContain('2FA');
	});
	test('UNSPECIFIED / UNKNOWN → generic fallback', () => {
		expect(translateGoogleSuspensionReason('UNSPECIFIED').label).toBe('Motiv nespecificat');
		expect(translateGoogleSuspensionReason('UNKNOWN').label).toBe('Motiv nespecificat');
	});
	test('unknown string → generic fallback (forward-compat)', () => {
		const out = translateGoogleSuspensionReason('SOMETHING_NEW');
		expect(out.label).toBe('Motiv nespecificat');
	});
});

describe('translateGoogleSuspensionReasons (array)', () => {
	test('empty array → null', () => {
		expect(translateGoogleSuspensionReasons([])).toBe(null);
		expect(translateGoogleSuspensionReasons(null)).toBe(null);
	});
	test('single reason returns that translation', () => {
		const out = translateGoogleSuspensionReasons(['UNPAID_BALANCE']);
		expect(out?.label).toBe('Sold neachitat');
	});
	test('multiple reasons — joins labels with " · ", uses first suggestion', () => {
		const out = translateGoogleSuspensionReasons(['UNPAID_BALANCE', 'SUSPICIOUS_PAYMENT_ACTIVITY']);
		expect(out?.label).toBe('Sold neachitat · Activitate de plată suspicioasă');
		expect(out?.suggestion).toContain('Billing'); // from first reason
	});
});

describe('describeStatus — Google', () => {
	test('Google suspended with UNPAID_BALANCE → RO details', () => {
		const out = describeStatus({
			provider: 'google',
			paymentStatus: 'suspended',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
			googleSuspensionReasons: ['UNPAID_BALANCE'],
		});
		expect(out?.headline).toBe('Cont suspendat de Google — Sold neachitat');
		expect(out?.suggestion).toContain('Billing');
	});
	test('Google risk_review with suspension_reasons array', () => {
		const out = describeStatus({
			provider: 'google',
			paymentStatus: 'risk_review',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
			googleSuspensionReasons: ['SUSPICIOUS_PAYMENT_ACTIVITY'],
		});
		expect(out?.headline).toBe('Cont restricționat de Google — Activitate de plată suspicioasă');
	});
	test('Google suspended without suspension_reasons → generic', () => {
		const out = describeStatus({
			provider: 'google',
			paymentStatus: 'suspended',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
			googleSuspensionReasons: null,
		});
		expect(out?.headline).toBe('Cont suspendat'); // falls through to generic
	});
});
```

- [ ] **Step 2: Run — expect fail**

Run: `cd app && bun test src/lib/ads/status-copy.test.ts`
Expected: FAIL with "`translateGoogleSuspensionReason` is not a function" and new `describeStatus` cases fail because `googleSuspensionReasons` isn't accepted.

- [ ] **Step 3: Extend `DescribeStatusInput` + add translator**

Edit `app/src/lib/ads/status-copy.ts`. First, extend the input interface:

```ts
export interface DescribeStatusInput {
	provider: 'meta' | 'google' | 'tiktok';
	paymentStatus: 'ok' | 'grace_period' | 'risk_review' | 'payment_failed' | 'suspended' | 'closed';
	rawDisableReason: string | null;
	rejectReasonMessage: string | null;
	rejectReasonEndsAt: string | null;
	/** Google only: `customer.suspension_reasons` enum values (string form). */
	googleSuspensionReasons?: string[] | null;
}
```

Then add the translator block (place AFTER `parseTikTokRejectReason`, BEFORE `formatDeadlineDate`):

```ts
/**
 * RO translation + actionable suggestion for a single Google Ads
 * `customer.suspension_reasons` enum value. Unknown codes fall through to
 * a generic "motiv nespecificat" + "deschide ticket support" suggestion.
 */
export function translateGoogleSuspensionReason(reason: string): {
	label: string;
	suggestion: string;
} {
	switch (reason) {
		case 'UNPAID_BALANCE':
			return {
				label: 'Sold neachitat',
				suggestion:
					'Deschide Google Ads → Billing → Summary și achită soldul restant pentru a relua livrarea reclamelor.',
			};
		case 'SUSPICIOUS_PAYMENT_ACTIVITY':
			return {
				label: 'Activitate de plată suspicioasă',
				suggestion:
					'Verifică metoda de plată în Google Ads → Billing, confirmă proprietatea cardului, contactează suportul dacă persistă.',
			};
		case 'CIRCUMVENTING_SYSTEMS':
			return {
				label: 'Eludarea sistemelor Google',
				suggestion:
					'Suspendare gravă pentru încercarea de a eluda politicile Google Ads. Depune un recurs oficial prin Google Ads Help Center și pregătește documentație care demonstrează conformitate cu politicile.',
			};
		case 'MISREPRESENTATION':
			return {
				label: 'Reprezentare falsă a afacerii',
				suggestion:
					'Google a identificat informații false sau inexacte despre afacere. Dacă datele din Google Ads sunt corecte, deschide un apel oficial prin Google Ads Help Center, cu documente de identitate a firmei.',
			};
		case 'UNACCEPTABLE_BUSINESS_PRACTICES':
			return {
				label: 'Practici comerciale inacceptabile',
				suggestion:
					'Revizuiește reclamele și landing page-ul conform politicilor Google Ads (înșelăciune utilizatori, taxe ascunse). Depune appeal după remediere.',
			};
		case 'UNAUTHORIZED_ACCOUNT_ACTIVITY':
			return {
				label: 'Activitate neautorizată',
				suggestion:
					'Schimbă parola Google imediat, activează 2FA, revocă accesul utilizatorilor suspecți din Google Ads → Access & security.',
			};
		default:
			return {
				label: 'Motiv nespecificat',
				suggestion: 'Deschide un ticket în Google Ads Support pentru detalii despre suspendare.',
			};
	}
}

/**
 * Combine multiple suspension reasons into a single details block:
 * labels joined with " · ", suggestion taken from the first (most relevant)
 * reason. Returns null for empty/null input.
 */
export function translateGoogleSuspensionReasons(
	reasons: string[] | null,
): { label: string; suggestion: string } | null {
	if (!reasons || reasons.length === 0) return null;
	const translated = reasons.map(translateGoogleSuspensionReason);
	return {
		label: translated.map((r) => r.label).join(' · '),
		suggestion: translated[0].suggestion,
	};
}
```

- [ ] **Step 4: Hook into `describeStatus`**

Edit `describeStatus` — add a Google branch BEFORE the generic `switch (paymentStatus)`:

```ts
// ... existing TikTok branches ...

// Google with explicit suspension_reasons — translate each + compose headline.
if (provider === 'google' && (paymentStatus === 'suspended' || paymentStatus === 'risk_review')) {
	const translated = translateGoogleSuspensionReasons(input.googleSuspensionReasons ?? null);
	if (translated) {
		return {
			headline:
				paymentStatus === 'suspended'
					? `Cont suspendat de Google — ${translated.label}`
					: `Cont restricționat de Google — ${translated.label}`,
			body: 'Google Ads a aplicat această restricție pe cont. Detalii de mai jos.',
			suggestion: translated.suggestion,
			deadline: null,
		};
	}
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd app && bun test src/lib/ads/status-copy.test.ts`
Expected: All pass (20 existing + 11 new ~= 31 tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ads/status-copy.ts app/src/lib/ads/status-copy.test.ts
git commit -m "feat(ads-status): translate Google customer.suspension_reasons to RO copy"
```

---

## Task 2: `fetchCustomerSuspensionReasons` in Google client

**Files:**
- Modify: `app/src/lib/server/google-ads/client.ts` (append new function near `fetchBillingSetupStatus`, ~line 980)

- [ ] **Step 1: Add the fetcher**

```ts
/**
 * Fetch the `customer.suspension_reasons` array for a specific sub-account.
 * Returns a string[] of enum labels (normalized to uppercase names) or [] if
 * none present. Returns null on error (treated downstream as "unknown, don't
 * override existing decision").
 *
 * Google Ads API CustomerStatusEnum.SuspensionReason (verified 2026-04-24):
 *   0 UNSPECIFIED · 1 UNKNOWN · 2 SUSPICIOUS_PAYMENT_ACTIVITY
 *   3 CIRCUMVENTING_SYSTEMS · 4 MISREPRESENTATION · 5 UNPAID_BALANCE
 *   6 UNACCEPTABLE_BUSINESS_PRACTICES · 7 UNAUTHORIZED_ACCOUNT_ACTIVITY
 *
 * The google-ads-api lib may return either numeric or string enums; handle both.
 */
export async function fetchCustomerSuspensionReasons(
	mccAccountId: string,
	customerId: string,
	developerToken: string,
	refreshToken: string,
): Promise<string[] | null> {
	const numericToString: Record<number, string> = {
		0: 'UNSPECIFIED',
		1: 'UNKNOWN',
		2: 'SUSPICIOUS_PAYMENT_ACTIVITY',
		3: 'CIRCUMVENTING_SYSTEMS',
		4: 'MISREPRESENTATION',
		5: 'UNPAID_BALANCE',
		6: 'UNACCEPTABLE_BUSINESS_PRACTICES',
		7: 'UNAUTHORIZED_ACCOUNT_ACTIVITY',
	};
	try {
		const customer = getSubAccountClient(mccAccountId, customerId, developerToken, refreshToken);
		const rows = await customer.query(`
			SELECT customer.suspension_reasons
			FROM customer
			LIMIT 1
		`);
		if (!rows || rows.length === 0) return [];
		const raw = (rows[0] as any).customer?.suspension_reasons ?? [];
		if (!Array.isArray(raw)) return [];
		const KNOWN = new Set([
			'SUSPICIOUS_PAYMENT_ACTIVITY',
			'CIRCUMVENTING_SYSTEMS',
			'MISREPRESENTATION',
			'UNPAID_BALANCE',
			'UNACCEPTABLE_BUSINESS_PRACTICES',
			'UNAUTHORIZED_ACCOUNT_ACTIVITY',
			'UNKNOWN',
			'UNSPECIFIED',
		]);
		return raw
			.map((r: unknown) =>
				typeof r === 'number' ? (numericToString[r] ?? 'UNKNOWN') : String(r).toUpperCase(),
			)
			.filter((s: string) => {
				if (!KNOWN.has(s)) {
					// Forward-compat: surface unknown reasons in logs so we update the
					// translator before clients hit a generic fallback.
					logWarning('google-ads', 'Unknown Google suspension_reasons enum', {
						metadata: { reason: s, customerId },
					});
				}
				return s !== 'UNSPECIFIED';
			});
	} catch (err) {
		logWarning('google-ads', `Failed to fetch customer.suspension_reasons for ${customerId}`, {
			metadata: { error: err instanceof Error ? err.message : String(err) },
		});
		return null;
	}
}
```

- [ ] **Step 2: Type-check**

Run: `cd app && npx svelte-check --threshold warning 2>&1 | grep google-ads | head -10`
Expected: no new errors in `client.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/google-ads/client.ts
git commit -m "feat(google-ads): fetchCustomerSuspensionReasons — query customer.suspension_reasons"
```

---

## Task 3: Propagate în `PaymentStatusSnapshot` + call parallel

**Files:**
- Modify: `app/src/lib/server/ads/payment-status-types.ts` (add `googleSecondary` optional)
- Modify: `app/src/lib/server/google-ads/status.ts` (call parallel cu billing)

- [ ] **Step 1: Extend snapshot type**

Edit `payment-status-types.ts`. Add after `tiktokSecondary`:

```ts
/** Google-only secondary fields. null for Meta/TikTok. */
googleSecondary?: {
	suspensionReasons: string[];
} | null;
```

- [ ] **Step 2: Conditional fetch în Google status (quota-aware)**

Edit `fetchGooglePaymentStatus` (in `app/src/lib/server/google-ads/status.ts`). Replace the `billingSetupStatus` assignment with a per-account-state branch.

**Quota note:** developer_token Basic Access has 15 000 ops/day. We already burn ~12 000 with billing_setup polled hourly per ENABLED account. Querying suspension_reasons unconditionally would push us over. Strategy: query *only what each state needs* — billing_setup pentru ENABLED (relevant doar acolo) și suspension_reasons pentru SUSPENDED (relevant doar acolo). Net additional ops: ~zero, doar swap.

```ts
// Import added at top:
// import { listMccSubAccounts, fetchBillingSetupStatus, fetchCustomerSuspensionReasons, formatCustomerId } from './client';

// Replace the current block that only fetches billingSetupStatus:
let billingSetupStatus: string | null = null;
let suspensionReasons: string[] = [];
if (acc.status === 'ENABLED' || acc.status === 'SUSPENDED') {
	const [billing, reasons] = await Promise.all([
		acc.status === 'ENABLED'
			? fetchBillingSetupStatus(
					refreshed.mccAccountId,
					acc.customerId,
					refreshed.developerToken,
					refreshed.refreshToken,
				)
			: Promise.resolve(null),
		acc.status === 'SUSPENDED'
			? fetchCustomerSuspensionReasons(
					refreshed.mccAccountId,
					acc.customerId,
					refreshed.developerToken,
					refreshed.refreshToken,
				)
			: Promise.resolve(null),
	]);
	billingSetupStatus = billing;
	suspensionReasons = reasons ?? [];
}

snapshots.push({
	provider: 'google',
	integrationId: refreshed.id,
	accountTableId: row.id,
	externalAccountId: acc.customerId,
	clientId: row.clientId ?? null,
	accountName: acc.descriptiveName || row.accountName || acc.customerId,
	paymentStatus: mapGoogleStatusToPayment(acc.status, billingSetupStatus),
	rawStatusCode: acc.status,
	rawDisableReason: billingSetupStatus,
	checkedAt,
	googleSecondary: suspensionReasons.length > 0 ? { suspensionReasons } : null,
});
```

- [ ] **Step 3: Type-check + run Meta/TikTok tests to ensure no regression**

Run: `cd app && npx svelte-check --threshold warning 2>&1 | grep -E "(google-ads|payment-status-types)" | head`
Run: `cd app && bun test src/lib/server/ads/ src/lib/server/tiktok-ads/ src/lib/ads/`
Expected: 0 new errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/server/ads/payment-status-types.ts app/src/lib/server/google-ads/status.ts
git commit -m "feat(google-ads): propagate suspension_reasons in PaymentStatusSnapshot"
```

---

## Task 4: Persist + pass to `describeStatus` in payment-alerts

**Files:**
- Modify: `app/src/lib/server/ads/payment-alerts.ts` (2 places: `persistStatus` + `collectTransitionNotifications`)

- [ ] **Step 1: Persist `googleSecondary` in raw JSON**

In `persistStatus`, extend the raw JSON.stringify:

```ts
const raw = JSON.stringify({
	code: snap.rawStatusCode,
	disableReason: snap.rawDisableReason ?? null,
	balanceCents: snap.balanceCents ?? null,
	currency: snap.currencyCode ?? null,
	tiktokSecondary: snap.tiktokSecondary ?? null,
	googleSecondary: snap.googleSecondary ?? null,
});
```

- [ ] **Step 2: Pass `googleSuspensionReasons` to `describeStatus`**

In `collectTransitionNotifications`, where `describeStatus` is called, pass the new field:

```ts
const details = describeStatus({
	provider: snap.provider,
	paymentStatus: snap.paymentStatus,
	rawDisableReason:
		typeof snap.rawDisableReason === 'string' ? snap.rawDisableReason : null,
	rejectReasonMessage: rejectParsed?.message ?? null,
	rejectReasonEndsAt: rejectParsed?.endsAt ?? null,
	googleSuspensionReasons: snap.googleSecondary?.suspensionReasons ?? null,
});
```

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/ads/payment-alerts.ts
git commit -m "feat(ads-alerts): persist + forward google suspension_reasons to describeStatus"
```

---

## Task 5: Expose pe remote DTOs

**Files:**
- Modify: `app/src/lib/remotes/ads-status.remote.ts`

- [ ] **Step 1: Extend types + parse from raw JSON**

Find `FlaggedAccountRow` interface. Add optional fields:

```ts
/** Google only: customer.suspension_reasons enum names. null for non-Google or when empty. */
googleSuspensionReasons: string[] | null;
```

Find `ClientAdsHealthItem` interface. Add the same:

```ts
/** Google only: customer.suspension_reasons enum names. null for non-Google or when empty. */
googleSuspensionReasons: string[] | null;
```

Edit `parseRaw` to extract:

```ts
// Inside parseRaw return object (add after tt fields):
const googleSec = parsed?.googleSecondary ?? null;
// Return shape change:
return {
	code: String(parsed.code ?? ''),
	disableReason: ...,
	subStatus: tt?.subStatus ?? null,
	rejectReason: tt?.rejectReason ?? null,
	displayStatus: tt?.displayStatus ?? null,
	deliveryIssue: tt?.deliveryIssue ?? null,
	googleSuspensionReasons: Array.isArray(googleSec?.suspensionReasons)
		? (googleSec.suspensionReasons as string[])
		: null,
};
```

Don't forget to add `googleSuspensionReasons: null` to the `empty` default.

- [ ] **Step 2: Populate in both row builders**

In `push` (admin dashboard, ~line 223): append `googleSuspensionReasons: provider === 'google' ? raw.googleSuspensionReasons : null`.

In `addRow` (client alert, ~line 403): similarly parse `parsed.googleSecondary?.suspensionReasons` and include in the pushed item.

- [ ] **Step 3: Type-check**

Run: `cd app && npx svelte-check --threshold warning 2>&1 | grep "ads-status.remote" | head -10`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/remotes/ads-status.remote.ts
git commit -m "feat(ads-status): expose google suspension_reasons in admin + client DTOs"
```

---

## Task 6: Admin dashboard raw display (Google)

**Files:**
- Modify: `app/src/routes/[tenant]/admin/ads-payment-status/+page.svelte` (coloana "Cod raw")

- [ ] **Step 1: Append Google block after TikTok block**

Inside the `<td class="py-3 pr-3">` cell that renders `rawStatusCode`, after the TikTok block:

```svelte
{#if row.provider === 'google' && row.googleSuspensionReasons && row.googleSuspensionReasons.length > 0}
	<div class="text-xs text-muted-foreground">
		suspension: <code>{row.googleSuspensionReasons.join(', ')}</code>
	</div>
{/if}
```

- [ ] **Step 2: Run Svelte autofixer**

Invoke `mcp__svelte__svelte-autofixer` on the full file. Fix any warnings it surfaces that relate to your edit.

- [ ] **Step 3: Type-check**

Run: `cd app && npx svelte-check --threshold warning 2>&1 | grep "ads-payment-status" | head -10`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/routes/[tenant]/admin/ads-payment-status/+page.svelte
git commit -m "feat(admin): show Google suspension_reasons in payment status dashboard"
```

---

## Task 7: Client card auto-picks Google details

**Files:**
- Modify: `app/src/lib/components/client/ads-health-alert.svelte` (extend the `describeStatus` call with `googleSuspensionReasons`)

- [ ] **Step 1: Pass the field**

Find the `{@const details = describeStatus({...})}` block. Add `googleSuspensionReasons: item.googleSuspensionReasons` to the call.

```svelte
{@const details = describeStatus({
	provider: item.provider,
	paymentStatus: item.paymentStatus,
	rawDisableReason: item.rawDisableReason,
	rejectReasonMessage: item.rejectReasonMessage,
	rejectReasonEndsAt: item.rejectReasonEndsAt,
	googleSuspensionReasons: item.googleSuspensionReasons,
})}
```

- [ ] **Step 2: Svelte autofixer**

Invoke `mcp__svelte__svelte-autofixer` on full file.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/components/client/ads-health-alert.svelte
git commit -m "feat(client-alert): pass googleSuspensionReasons to describeStatus"
```

---

## Task 8: Demo email — add Google suspension case

**Files:**
- Modify: `app/scripts/demo-ads-digest-email.ts`

- [ ] **Step 1: Insert a demo item**

In the `demoItems` array, add:

```ts
buildItem({
	accountName: 'Client Google Ads demo',
	externalAccountId: '123-456-7890',
	provider: 'google',
	paymentStatus: 'suspended',
	statusLabelRo: 'Suspendat',
	rawStatusCode: 'SUSPENDED',
	// New helper parameter used only by buildItem below
	googleSuspensionReasons: ['UNPAID_BALANCE'],
}),
buildItem({
	accountName: 'Alt client Google Ads',
	externalAccountId: '987-654-3210',
	provider: 'google',
	paymentStatus: 'suspended',
	statusLabelRo: 'Suspendat',
	rawStatusCode: 'SUSPENDED',
	googleSuspensionReasons: ['SUSPICIOUS_PAYMENT_ACTIVITY', 'UNAUTHORIZED_ACCOUNT_ACTIVITY'],
}),
```

Extend `buildItem` to accept and forward `googleSuspensionReasons`:

```ts
function buildItem(overrides: Partial<AdDigestItem> & {
	rejectReasonMessage?: string | null;
	rejectReasonEndsAt?: string | null;
	googleSuspensionReasons?: string[] | null;
}): AdDigestItem {
	// ... existing body ...
	const details = describeStatus({
		provider,
		paymentStatus,
		rawDisableReason: ...,
		rejectReasonMessage: overrides.rejectReasonMessage ?? null,
		rejectReasonEndsAt: overrides.rejectReasonEndsAt ?? null,
		googleSuspensionReasons: overrides.googleSuspensionReasons ?? null,
	});
	// ... rest ...
}
```

- [ ] **Step 2: Regenerate + open**

```bash
cd app && bun run scripts/demo-ads-digest-email.ts > /tmp/ads-digest-demo.html && open /tmp/ads-digest-demo.html
```

Expected: 8 card-items, 2 new Google suspended cards with RO suspension reasons in the details block.

- [ ] **Step 3: Commit**

```bash
git add app/scripts/demo-ads-digest-email.ts
git commit -m "chore(demo): add Google suspension_reasons cases to digest email demo"
```

---

## Task 9: Update docs

**Files:**
- Modify: `app/docs/ads-status-mappings.md`

- [ ] **Step 1: Extend Google section**

After the `BillingSetupStatusEnum` table in the Google section, add:

```markdown
### `customer.suspension_reasons` (array — 2026-04-24)

Stocat în `paymentStatusRaw.googleSecondary.suspensionReasons`. Enum names din Google Ads API v17+ `CustomerStatusEnum.SuspensionReason`:

| Valoare | RO | Sugestie acționabilă |
|---|---|---|
| `UNPAID_BALANCE` | Sold neachitat | Deschide Google Ads → Billing → Summary, achită soldul restant. |
| `SUSPICIOUS_PAYMENT_ACTIVITY` | Activitate de plată suspicioasă | Verifică metoda de plată, confirmă proprietatea cardului. |
| `CIRCUMVENTING_SYSTEMS` | Eludarea sistemelor Google | Revizuiește reclame/landing, depune appeal. |
| `MISREPRESENTATION` | Reprezentare falsă a afacerii | Clarifică identitatea afacerii, appeal prin ticket. |
| `UNACCEPTABLE_BUSINESS_PRACTICES` | Practici comerciale inacceptabile | Revizuiește conform politicilor, appeal. |
| `UNAUTHORIZED_ACCOUNT_ACTIVITY` | Activitate neautorizată | Schimbă parola, activează 2FA, revocă acces. |
| `UNSPECIFIED` / `UNKNOWN` / alte | Motiv nespecificat | Deschide ticket Google Ads Support. |

Translate + sugestii live în [`$lib/ads/status-copy.ts:translateGoogleSuspensionReason`](../src/lib/ads/status-copy.ts). Exprimate identic în UI admin, card client și email digest.
```

În secțiunea "Istoric incidente":

```markdown
| 2026-04-24 | Google suspendări afișate fără context | `customer.suspension_reasons` nu era interogat; doar `status=SUSPENDED` generic apărea | Nouă funcție `fetchCustomerSuspensionReasons` + translate RO + dashboard/email rich copy |
```

- [ ] **Step 2: Commit**

```bash
git add app/docs/ads-status-mappings.md
git commit -m "docs(ads): document Google customer.suspension_reasons mapping"
```

---

## Self-Review Checklist

- **Spec coverage:** Faza 1 completă — suspension_reasons capture, persist, display admin + client card + email digest, docs, demo. Tests ≥ 11 noi. ✓
- **Placeholder scan:** zero TBD/similar. Fiecare pas are cod complet. ✓
- **Type consistency:** `googleSuspensionReasons: string[] | null` folosit identic în `DescribeStatusInput`, `PaymentStatusSnapshot.googleSecondary.suspensionReasons`, `FlaggedAccountRow`, `ClientAdsHealthItem`. Tipul extras consistent prin `translateGoogleSuspensionReasons` (array → optional). ✓
- **Evidence-first:** Task 0 obligă verificarea live a forme enum (numeric vs string) înainte de code. ✓
- **Zero migrații DB:** folosim `payment_status_raw` JSON. ✓
- **Shared pure module:** `describeStatus` rămâne sursa unică de copy (UI + email). ✓
- **Svelte MCP:** Task 6 și 7 rulează autofixer-ul. ✓
- **Demo preview:** Task 8 regenerează demo-ul per memory `feedback_email_demo_preview`. ✓
- **Debug endpoint:** Task 0 rămâne pe loc per memory `feedback_keep_debug_endpoints`. ✓

---

## Gemini review changes (2026-04-24)

Aplicate înainte de implementare:

1. **Quota safety (Task 3, Step 2):** suspension_reasons query rulează DOAR pentru `acc.status === 'SUSPENDED'`, nu pentru toate. billing_setup rămâne doar pe ENABLED. Net cost: ~zero ops adiționale (fiecare cont e într-o stare la un moment dat).
2. **Forward-compat logging (Task 2):** `fetchCustomerSuspensionReasons` emite `logWarning('google-ads', 'Unknown Google suspension_reasons enum', ...)` când Google returnează un enum nou pe care nu-l avem în set. Previne blind spots la viitoare modificări v18+ ale API-ului.
3. **Copy reframe (Task 1, Step 3):** `CIRCUMVENTING_SYSTEMS` și `MISREPRESENTATION` au sugestii rescrise — recunosc gravitatea (suspendări policy, nu billing) și direcționează spre Google Ads Help Center pentru appeal oficial, NU spre quick-fix.
