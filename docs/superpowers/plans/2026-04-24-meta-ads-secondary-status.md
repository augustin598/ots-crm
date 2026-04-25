# Meta Ads Secondary Status (RO copy pentru `disable_reason`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adaugă traduceri RO + sugestii acționabile pentru `disable_reason` și pentru câteva `account_status` valori notabile pe Meta Ads, astfel încât cardul client, dashboard admin și emailul digest să arate context bogat per cont (analog cu TikTok și Google Faza 1) — fără modificări la pipeline-ul de fetch sau persistență.

**Architecture:** Cea mai mică Faza din serie — Meta deja capturează `account_status` (numeric) și `disable_reason` (numeric), le persistă în `paymentStatusRaw` (`code` + `disableReason`), le expune în DTO-uri (`rawStatusCode` + `rawDisableReason`). Tot ce mai trebuie e (1) translatori puri RO pentru cele 11 `disable_reason` valori și 4 `account_status` valori cu copy specific, (2) o ramură Meta în `describeStatus` din `$lib/ads/status-copy.ts`, (3) demo + docs. Zero modificări de pipeline.

**Tech Stack:** TypeScript, `bun:test`, Svelte 5 (touchpoint zero — componenta deja consumă `describeStatus`).

**Out of scope:**
- Capturare câmpuri suplimentare Meta (e.g. `funding_source_details`, `business.verification_status`) — Faza ulterioară dacă apare nevoie
- Modificări de pipeline / DB / persistență
- Modificări la card Svelte sau email template (deja merg din `describeStatus`)

---

## File Structure

**Modified:**
- `app/src/lib/ads/status-copy.ts` — adaug `translateMetaDisableReason(code: string)` + `translateMetaAccountStatus(code: string)` + ramură Meta în `describeStatus`
- `app/src/lib/ads/status-copy.test.ts` — teste pentru toate cele 11 `disable_reason` + 4 `account_status` cu copy + edge cases
- `app/scripts/demo-ads-digest-email.ts` — adaug 2-3 carduri demo Meta cu `disable_reason` distinctiv (e.g. `ADS_INTEGRITY_POLICY` + `RISK_PAYMENT` + `IN_GRACE_PERIOD`)
- `app/docs/ads-status-mappings.md` — secțiune nouă "Meta `disable_reason` RO + sugestii"

**Nu modificăm:**
- `meta-ads/status.ts`, `meta-ads/client.ts` — Meta deja returnează ce ne trebuie
- `payment-alerts.ts` — `rawDisableReason` deja trece prin `describeStatus`
- `ads-status.remote.ts` — `rawStatusCode` + `rawDisableReason` deja expuse pe DTO-uri
- `ads-health-alert.svelte` — auto-pickup din `describeStatus`
- `email.ts` — auto-pickup din `details` field în AdDigestItem

---

## Enum reference: Meta `disable_reason` (numeric → RO)

Verificat în [`status-mappers.ts:48-44`](../src/lib/server/ads/status-mappers.ts) și [`docs/ads-status-mappings.md`](../docs/ads-status-mappings.md). API-ul Meta returnează numeric, noi îl stocăm ca atare în JSON și-l primim ca `string` (e.g. "1") prin DTO.

| Cod | Symbol | RO Label | RO Suggestion |
|---|---|---|---|
| 1 | `ADS_INTEGRITY_POLICY` | Încălcare politici reclame | Verifică Meta Business Suite → Account Quality, revizuiește reclamele respinse și depune appeal pentru fiecare. |
| 2 | `ADS_IP_REVIEW` | Verificare proprietate intelectuală | Meta verifică drepturi IP pe creative. Pregătește dovezi (facturi, contracte, licențe) pentru orice marcă, imagine sau material folosit în reclame, în caz de appeal. |
| 3 | `RISK_PAYMENT` | Risc de plată detectat | Verifică metoda de plată în Meta → Billing. Confirmă proprietatea cardului și actualizează dacă e expirat. |
| 4 | `GRAY_ACCOUNT_SHUT_DOWN` | Cont oprit (suspect duplicate/abuz) | Cont oprit — probabil duplicate sau abuz detectat de Meta. Contactează Meta Business Support pentru detalii și appeal. |
| 5 | `AD_ACCOUNT_DISABLED` | Cont reclame dezactivat | Meta a dezactivat contul de reclame. Deschide ticket prin Meta Business Suite → Help & Support pentru appeal. |
| 6 | `BUSINESS_DISABLED` | Business Manager dezactivat | Întregul Business Manager e dezactivat. Verifică emailurile de la Meta și depune appeal cât mai repede prin Help Center. |
| 7 | `MPG_AFFILIATE_DISABLED` | Cont afiliat dezactivat | Contul afiliat al organizației a fost dezactivat. Contactează Meta Partner Support pentru detalii. |
| 8 | `PRE_PAYMENT_ADS_DISABLED` | Sold restant neachitat | Reclamele sunt blocate până achiti soldul restant. Deschide Meta → Billing → Payment Settings și plătește pentru a relua livrarea. |
| 9 | `PERMISSION_REVOKED` | Permisiuni revocate | Permisiunile pe contul de reclame au fost revocate. Verifică în Business Manager cine mai are acces și restabilește. |
| 11 | `COMPROMISED_ACCOUNT` | Cont compromis | Meta a detectat compromitere. Schimbă parola, activează 2FA, revocă acces utilizatorilor suspecți, contactează Meta Security. |
| 12 | `BUSINESS_INTEGRITY_RS` | Încălcare integritate business (risk/restriction) | Suspendare gravă pentru încălcarea politicilor business integrity. Deschide appeal oficial prin Meta Help Center → Account Quality → Business Integrity, și include CUI/J firmă, screenshot-uri și documente care atestă legitimitatea afacerii. |
| 0 / lipsă | NONE | (skip — cade la account_status) | (cade la account_status) |
| altele | (necunoscut) | Motiv nespecificat | Deschide ticket Meta Business Suite → Help & Support pentru detalii. |

## Enum reference: Meta `account_status` (numeric → RO)

Toate valorile non-active care merită un mesaj specific. Codul `1` (ACTIVE) returnează null (cade la generic flow ne-Meta).

| Cod | Symbol | RO Label | RO Suggestion |
|---|---|---|---|
| 2 | `DISABLED` | Cont dezactivat | Meta a dezactivat contul fără un motiv specific raportat. Verifică Meta Business Suite → Account Quality pentru detalii sau deschide ticket Help & Support. |
| 3 | `UNSETTLED` | Plată în curs de procesare | Meta procesează ultima plată. Reclamele se vor relua automat în 1-2 ore. Dacă persistă peste 24h, verifică metoda de plată în Billing. |
| 7 | `PENDING_RISK_REVIEW` | Verificare cont în curs | Meta verifică contul pentru risc. Așteaptă 24-48h, fără acțiune necesară. Reclamele pot rula limitat în acest timp. |
| 8 | `PENDING_SETTLEMENT` | Plată în așteptare | O plată e în așteptare la Meta. De obicei se rezolvă singur în câteva ore. Verifică Meta → Billing dacă persistă. |
| 9 | `IN_GRACE_PERIOD` | Perioadă de grație — factură neachitată | Plata a eșuat — perioadă de grație activă (de obicei 7 zile). Achită soldul în Meta → Billing → Payment Settings pentru a evita oprirea automată. |
| 100 | `PENDING_CLOSURE` | Cont programat pentru închidere | Cont marcat pentru închidere de Meta. Dacă e o eroare, contactează Meta Business Support imediat. |
| 101 | `CLOSED` | Cont închis definitiv | Cont închis. Contactează Meta dacă închiderea e o eroare; altfel e terminal. |

---

## Task 1: Pure Meta translators + tests (TDD)

**Files:**
- Modify: `app/src/lib/ads/status-copy.ts`
- Modify: `app/src/lib/ads/status-copy.test.ts`

- [ ] **Step 1: Append failing tests**

Append exactly this la finalul fișierului `app/src/lib/ads/status-copy.test.ts`:

```ts
import { translateMetaDisableReason, translateMetaAccountStatus } from './status-copy';

describe('translateMetaDisableReason', () => {
	test('1 ADS_INTEGRITY_POLICY → policy copy', () => {
		const out = translateMetaDisableReason('1');
		expect(out.label).toBe('Încălcare politici reclame');
		expect(out.suggestion).toContain('Account Quality');
	});
	test('2 ADS_IP_REVIEW → IP review copy', () => {
		const out = translateMetaDisableReason('2');
		expect(out.label).toBe('Verificare proprietate intelectuală');
	});
	test('3 RISK_PAYMENT → payment risk copy', () => {
		const out = translateMetaDisableReason('3');
		expect(out.label).toBe('Risc de plată detectat');
		expect(out.suggestion).toContain('metoda de plată');
	});
	test('4 GRAY_ACCOUNT_SHUT_DOWN → gray copy', () => {
		const out = translateMetaDisableReason('4');
		expect(out.label).toBe('Cont oprit (suspect duplicate/abuz)');
	});
	test('5 AD_ACCOUNT_DISABLED → ad account disabled copy', () => {
		const out = translateMetaDisableReason('5');
		expect(out.label).toBe('Cont reclame dezactivat');
	});
	test('6 BUSINESS_DISABLED → business manager copy', () => {
		const out = translateMetaDisableReason('6');
		expect(out.label).toBe('Business Manager dezactivat');
	});
	test('7 MPG_AFFILIATE_DISABLED → affiliate copy', () => {
		const out = translateMetaDisableReason('7');
		expect(out.label).toBe('Cont afiliat dezactivat');
	});
	test('8 PRE_PAYMENT_ADS_DISABLED → unpaid copy', () => {
		const out = translateMetaDisableReason('8');
		expect(out.label).toBe('Sold restant neachitat');
		expect(out.suggestion).toContain('Billing');
	});
	test('9 PERMISSION_REVOKED → permission copy', () => {
		const out = translateMetaDisableReason('9');
		expect(out.label).toBe('Permisiuni revocate');
	});
	test('11 COMPROMISED_ACCOUNT → security copy', () => {
		const out = translateMetaDisableReason('11');
		expect(out.label).toBe('Cont compromis');
		expect(out.suggestion).toContain('2FA');
	});
	test('12 BUSINESS_INTEGRITY_RS → integrity copy', () => {
		const out = translateMetaDisableReason('12');
		expect(out.label).toBe('Încălcare integritate business (risk/restriction)');
	});
	test('0 NONE / null → null (no override)', () => {
		expect(translateMetaDisableReason('0')).toBe(null);
		expect(translateMetaDisableReason(null)).toBe(null);
	});
	test('unknown numeric code → generic fallback', () => {
		const out = translateMetaDisableReason('99');
		expect(out?.label).toBe('Motiv nespecificat');
	});
});

describe('translateMetaAccountStatus', () => {
	test('2 DISABLED → disabled copy', () => {
		const out = translateMetaAccountStatus('2');
		expect(out?.label).toBe('Cont dezactivat');
	});
	test('3 UNSETTLED → processing copy', () => {
		const out = translateMetaAccountStatus('3');
		expect(out?.label).toBe('Plată în curs de procesare');
		expect(out?.suggestion).toContain('1-2 ore');
	});
	test('7 PENDING_RISK_REVIEW → review copy', () => {
		const out = translateMetaAccountStatus('7');
		expect(out?.label).toBe('Verificare cont în curs');
	});
	test('8 PENDING_SETTLEMENT → pending payment copy', () => {
		const out = translateMetaAccountStatus('8');
		expect(out?.label).toBe('Plată în așteptare');
	});
	test('9 IN_GRACE_PERIOD → grace copy', () => {
		const out = translateMetaAccountStatus('9');
		expect(out?.label).toBe('Perioadă de grație — factură neachitată');
		expect(out?.suggestion).toContain('Billing');
	});
	test('100 PENDING_CLOSURE → closure copy', () => {
		const out = translateMetaAccountStatus('100');
		expect(out?.label).toBe('Cont programat pentru închidere');
	});
	test('101 CLOSED → terminal copy', () => {
		const out = translateMetaAccountStatus('101');
		expect(out?.label).toBe('Cont închis definitiv');
	});
	test('1 ACTIVE / others → null (use generic)', () => {
		expect(translateMetaAccountStatus('1')).toBe(null);
		expect(translateMetaAccountStatus('99')).toBe(null);
		expect(translateMetaAccountStatus(null)).toBe(null);
	});
});

describe('describeStatus — Meta', () => {
	test('Meta suspended with disable_reason=1 (ADS_INTEGRITY_POLICY)', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'suspended',
			rawDisableReason: '1',
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
		});
		expect(out?.headline).toBe('Cont suspendat de Meta — Încălcare politici reclame');
		expect(out?.suggestion).toContain('Account Quality');
	});

	test('Meta payment_failed with disable_reason=8 (PRE_PAYMENT_ADS_DISABLED)', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'payment_failed',
			rawDisableReason: '8',
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
		});
		expect(out?.headline).toBe('Plata a eșuat pe Meta — Reclame oprite înainte de plată');
	});

	test('Meta grace_period with account_status=9 (IN_GRACE_PERIOD)', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'grace_period',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
			rawStatusCode: '9',
		});
		expect(out?.headline).toBe('Cont Meta — Perioadă de grație — factură neachitată');
	});

	test('Meta risk_review with account_status=7 (PENDING_RISK_REVIEW)', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'risk_review',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
			rawStatusCode: '7',
		});
		expect(out?.headline).toBe('Cont Meta — Verificare cont în curs');
	});

	test('Meta closed → terminal CLOSED message', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'closed',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
			rawStatusCode: '101',
		});
		expect(out?.headline).toBe('Cont închis definitiv');
	});

	test('Meta suspended without disable_reason → falls through to generic', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'suspended',
			rawDisableReason: null,
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
		});
		expect(out?.headline).toBe('Cont suspendat'); // generic
	});

	test('Meta with unknown disable_reason=99 → headline includes "Motiv nespecificat"', () => {
		const out = describeStatus({
			provider: 'meta',
			paymentStatus: 'suspended',
			rawDisableReason: '99',
			rejectReasonMessage: null,
			rejectReasonEndsAt: null,
		});
		expect(out?.headline).toBe('Cont suspendat de Meta — Motiv nespecificat');
	});
});
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `cd app && bun test src/lib/ads/status-copy.test.ts`
Expected: FAIL — `translateMetaDisableReason` not exported, `describeStatus` doesn't accept `rawStatusCode`, Meta cases produce wrong headlines.

- [ ] **Step 3: Edit `status-copy.ts`** — three changes

**A) Add `rawStatusCode` to `DescribeStatusInput`** (currently missing — needed for Meta account_status branch). After `googleSuspensionReasons`:

```ts
/** Provider-native primary status code (Meta numeric account_status as string, etc.). Used by Meta branch. */
rawStatusCode?: string | null;
```

**B) Add the two translators** — place AFTER `translateGoogleSuspensionReasons` and BEFORE `formatDeadlineDate`:

```ts
/**
 * RO translation + actionable suggestion for a single Meta `disable_reason`
 * numeric code (string form, e.g. "1"). Returns null for "0"/null (no override —
 * caller falls back to translateMetaAccountStatus or generic copy). Unknown
 * non-zero codes return a generic "Motiv nespecificat" fallback.
 */
export function translateMetaDisableReason(code: string | null): {
	label: string;
	suggestion: string;
} | null {
	if (code == null || code === '0' || code === '') return null;
	switch (code) {
		case '1':
			return {
				label: 'Încălcare politici reclame',
				suggestion:
					'Verifică Meta Business Suite → Account Quality, revizuiește reclamele respinse și depune appeal pentru fiecare.',
			};
		case '2':
			return {
				label: 'Verificare proprietate intelectuală',
				suggestion:
					'Meta verifică drepturi IP pe creative. Pregătește dovezi (facturi, contracte, licențe) pentru orice marcă, imagine sau material folosit în reclame, în caz de appeal.',
			};
		case '3':
			return {
				label: 'Risc de plată detectat',
				suggestion:
					'Verifică metoda de plată în Meta → Billing. Confirmă proprietatea cardului și actualizează dacă e expirat.',
			};
		case '4':
			return {
				label: 'Cont oprit (suspect duplicate/abuz)',
				suggestion:
					'Cont oprit — probabil duplicate sau abuz detectat de Meta. Contactează Meta Business Support pentru detalii și appeal.',
			};
		case '5':
			return {
				label: 'Cont reclame dezactivat',
				suggestion:
					'Meta a dezactivat contul de reclame. Deschide ticket prin Meta Business Suite → Help & Support pentru appeal.',
			};
		case '6':
			return {
				label: 'Business Manager dezactivat',
				suggestion:
					'Întregul Business Manager e dezactivat. Verifică emailurile de la Meta și depune appeal cât mai repede prin Help Center.',
			};
		case '7':
			return {
				label: 'Cont afiliat dezactivat',
				suggestion:
					'Contul afiliat al organizației a fost dezactivat. Contactează Meta Partner Support pentru detalii.',
			};
		case '8':
			return {
				label: 'Sold restant neachitat',
				suggestion:
					'Reclamele sunt blocate până achiti soldul restant. Deschide Meta → Billing → Payment Settings și plătește pentru a relua livrarea.',
			};
		case '9':
			return {
				label: 'Permisiuni revocate',
				suggestion:
					'Permisiunile pe contul de reclame au fost revocate. Verifică în Business Manager cine mai are acces și restabilește.',
			};
		case '11':
			return {
				label: 'Cont compromis',
				suggestion:
					'Meta a detectat compromitere. Schimbă parola, activează 2FA, revocă acces utilizatorilor suspecți, contactează Meta Security.',
			};
		case '12':
			return {
				label: 'Încălcare integritate business (risk/restriction)',
				suggestion:
					'Suspendare gravă pentru încălcarea politicilor business integrity. Deschide appeal oficial prin Meta Help Center → Account Quality → Business Integrity, și include CUI/J firmă, screenshot-uri și documente care atestă legitimitatea afacerii.',
			};
		default:
			// Forward-compat: surface unknown disable_reason values in logs so we
			// update the translator before clients hit the generic fallback.
			// Fire-and-forget — translator is pure, can't await; we use console.warn
			// (picked up by stdout logging, identical to other pure-module warnings).
			console.warn(`[ads-status] Unknown Meta disable_reason: ${code}`);
			return {
				label: 'Motiv nespecificat',
				suggestion: 'Deschide ticket Meta Business Suite → Help & Support pentru detalii.',
			};
	}
}

/**
 * RO translation + suggestion pentru valori `account_status` Meta cu copy
 * specific (cele care merită un mesaj distinct de cel generic). Returnează
 * null pentru status-uri unde generic copy e adecvat (1 ACTIVE, 2 DISABLED
 * fără disable_reason, 3, 8, etc.) — caller-ul cade pe ramura generică.
 */
export function translateMetaAccountStatus(code: string | null): {
	label: string;
	suggestion: string;
} | null {
	if (code == null) return null;
	switch (code) {
		case '2':
			return {
				label: 'Cont dezactivat',
				suggestion:
					'Meta a dezactivat contul fără un motiv specific raportat. Verifică Meta Business Suite → Account Quality pentru detalii sau deschide ticket Help & Support.',
			};
		case '3':
			return {
				label: 'Plată în curs de procesare',
				suggestion:
					'Meta procesează ultima plată. Reclamele se vor relua automat în 1-2 ore. Dacă persistă peste 24h, verifică metoda de plată în Billing.',
			};
		case '7':
			return {
				label: 'Verificare cont în curs',
				suggestion:
					'Meta verifică contul pentru risc. Așteaptă 24-48h, fără acțiune necesară. Reclamele pot rula limitat în acest timp.',
			};
		case '8':
			return {
				label: 'Plată în așteptare',
				suggestion:
					'O plată e în așteptare la Meta. De obicei se rezolvă singur în câteva ore. Verifică Meta → Billing dacă persistă.',
			};
		case '9':
			return {
				label: 'Perioadă de grație — factură neachitată',
				suggestion:
					'Plata a eșuat — perioadă de grație activă (de obicei 7 zile). Achită soldul în Meta → Billing → Payment Settings pentru a evita oprirea automată.',
			};
		case '100':
			return {
				label: 'Cont programat pentru închidere',
				suggestion:
					'Cont marcat pentru închidere de Meta. Dacă e o eroare, contactează Meta Business Support imediat.',
			};
		case '101':
			return {
				label: 'Cont închis definitiv',
				suggestion:
					'Cont închis. Contactează Meta dacă închiderea e o eroare; altfel e terminal.',
			};
		default:
			return null;
	}
}
```

**C) Add Meta branch în `describeStatus`** — place AFTER toate ramurile TikTok și ramura Google, BEFORE generic `switch (paymentStatus)`:

```ts
// Meta with explicit disable_reason — translate + compose headline keyed off
// payment status. If disable_reason is missing or 0, fall through to
// account_status translation (e.g. PENDING_RISK_REVIEW, IN_GRACE_PERIOD).
if (provider === 'meta' && (
	paymentStatus === 'suspended' ||
	paymentStatus === 'risk_review' ||
	paymentStatus === 'payment_failed' ||
	paymentStatus === 'grace_period' ||
	paymentStatus === 'closed'
)) {
	const reasonTranslated = translateMetaDisableReason(rawDisableReason);
	if (reasonTranslated) {
		const prefix =
			paymentStatus === 'payment_failed'
				? 'Plata a eșuat pe Meta'
				: paymentStatus === 'grace_period'
					? 'Cont Meta'
					: paymentStatus === 'suspended'
						? 'Cont suspendat de Meta'
						: paymentStatus === 'risk_review'
							? 'Cont Meta'
							: 'Cont închis pe Meta';
		return {
			headline: `${prefix} — ${reasonTranslated.label}`,
			body: 'Meta a aplicat această restricție pe cont. Detalii și pași de remediere mai jos.',
			suggestion: reasonTranslated.suggestion,
			deadline: null,
		};
	}
	const statusTranslated = translateMetaAccountStatus(input.rawStatusCode ?? null);
	if (statusTranslated) {
		return {
			headline:
				paymentStatus === 'closed'
					? statusTranslated.label
					: `Cont Meta — ${statusTranslated.label}`,
			body: 'Meta a aplicat această stare pe cont. Detalii și pași de remediere mai jos.',
			suggestion: statusTranslated.suggestion,
			deadline: null,
		};
	}
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd app && bun test src/lib/ads/status-copy.test.ts`
Expected: ALL pass — 34 existing + ~22 new = ~56 tests în acest fișier.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ads/status-copy.ts app/src/lib/ads/status-copy.test.ts
git commit -m "feat(ads-status): translate Meta disable_reason + account_status to RO copy"
```

---

## Task 2: Pass `rawStatusCode` through `describeStatus` calls

**Files:**
- Modify: `app/src/lib/server/ads/payment-alerts.ts`
- Modify: `app/src/lib/components/client/ads-health-alert.svelte`
- Modify: `app/scripts/demo-ads-digest-email.ts`

`describeStatus` deja primește `rawDisableReason`. Acum primește și `rawStatusCode` (opțional, pentru Meta branch). Trebuie să fie pasat din toate call site-urile.

- [ ] **Step 1: Email digest server (payment-alerts.ts)**

În `collectTransitionNotifications`, găsește call-ul `describeStatus({...})`. Adaugă:

```ts
rawStatusCode: snap.rawStatusCode != null ? String(snap.rawStatusCode) : null,
```

(Existing call already passes `provider`, `paymentStatus`, `rawDisableReason`, `rejectReasonMessage`, `rejectReasonEndsAt`, `googleSuspensionReasons` — adaugă `rawStatusCode` la final.)

- [ ] **Step 2: Client Svelte card (ads-health-alert.svelte)**

În `{@const details = describeStatus({...})}` block, adaugă:

```svelte
rawStatusCode: item.rawStatusCode,
```

(`item.rawStatusCode` deja există în DTO-ul `ClientAdsHealthItem`.)

- [ ] **Step 3: Demo email script (demo-ads-digest-email.ts)**

În `buildItem`, găsește call-ul `describeStatus({...})`. Adaugă:

```ts
rawStatusCode: typeof overrides.rawStatusCode === 'string' ? overrides.rawStatusCode : null,
```

- [ ] **Step 4: Type check + run tests**

```bash
cd app && npx svelte-check --threshold warning 2>&1 | grep -E "(payment-alerts|ads-health-alert|demo-ads-digest)" | head -10
cd app && bun test src/lib/ads/ src/lib/server/ads/ src/lib/server/tiktok-ads/
```

Expected: zero new errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/ads/payment-alerts.ts app/src/lib/components/client/ads-health-alert.svelte app/scripts/demo-ads-digest-email.ts
git commit -m "feat(ads-status): forward rawStatusCode to describeStatus (Meta account_status branch)"
```

---

## Task 3: Demo email — Meta cards

**Files:**
- Modify: `app/scripts/demo-ads-digest-email.ts`

- [ ] **Step 1: Add 3 demo Meta items**

În array-ul `demoItems`, append:

```ts
buildItem({
	accountName: 'Client Meta — Heylux',
	externalAccountId: 'act_1234567890',
	provider: 'meta',
	paymentStatus: 'suspended',
	statusLabelRo: 'Suspendat',
	rawStatusCode: '2', // DISABLED
	rawDisableReason: '1', // ADS_INTEGRITY_POLICY
}),
buildItem({
	accountName: 'Client Meta — DS Tech',
	externalAccountId: 'act_9876543210',
	provider: 'meta',
	paymentStatus: 'payment_failed',
	statusLabelRo: 'Plată eșuată',
	rawStatusCode: '3', // UNSETTLED
	rawDisableReason: '8', // PRE_PAYMENT_ADS_DISABLED
	balanceFormatted: '342,18 RON',
}),
buildItem({
	accountName: 'Client Meta — Beonemedical',
	externalAccountId: 'act_5555555555',
	provider: 'meta',
	paymentStatus: 'grace_period',
	statusLabelRo: 'Perioadă de grație',
	rawStatusCode: '9', // IN_GRACE_PERIOD
	rawDisableReason: null,
	balanceFormatted: '218,40 RON',
}),
```

- [ ] **Step 2: Extend `buildItem` overrides type**

Currently accepts `rejectReasonMessage`, `rejectReasonEndsAt`, `googleSuspensionReasons`. Add `rawStatusCode`:

```ts
function buildItem(overrides: Partial<AdDigestItem> & {
	rejectReasonMessage?: string | null;
	rejectReasonEndsAt?: string | null;
	googleSuspensionReasons?: string[] | null;
	rawStatusCode?: string | null;
}): AdDigestItem {
```

(Note: `AdDigestItem.rawStatusCode` is `string | number` — when overridden via this helper we accept `string | null` for ergonomics.)

În return, ensure `rawStatusCode` se propagă în output-ul `AdDigestItem`:

```ts
rawStatusCode: overrides.rawStatusCode ?? 'STATUS_ENABLE',
```

(Acest deja există în `buildItem` — verifică doar că nu e suprascris).

- [ ] **Step 3: Regenerate + open**

```bash
cd app && bun run scripts/demo-ads-digest-email.ts > /tmp/ads-digest-demo.html && open /tmp/ads-digest-demo.html
```

Expected: 3 carduri Meta noi cu RO labels în details block:
- "Cont suspendat de Meta — Încălcare politici reclame" (red, severity: critical)
- "Plata a eșuat pe Meta — Reclame oprite înainte de plată" (red, sold restant 342,18 RON)
- "Cont Meta — Perioadă de grație — factură neachitată" (amber, sold 218,40 RON)

- [ ] **Step 4: Commit**

```bash
git add app/scripts/demo-ads-digest-email.ts
git commit -m "chore(demo): add Meta demo cards (ADS_INTEGRITY_POLICY, PRE_PAYMENT, IN_GRACE_PERIOD)"
```

---

## Task 4: Update docs

**Files:**
- Modify: `app/docs/ads-status-mappings.md`

- [ ] **Step 1: Add subsection în Meta section**

Find Meta section (starts with `## Meta (Facebook) Marketing API v25.0`). After the existing `disable_reason` table și înainte de `---` separator, add:

```markdown

### `disable_reason` + `account_status` RO copy (2026-04-24)

Capturate la nivel primar (numeric) în `paymentStatusRaw` (`code` + `disableReason`); afișate ca RO label + sugestie acționabilă în [`$lib/ads/status-copy.ts:translateMetaDisableReason`](../src/lib/ads/status-copy.ts) și `translateMetaAccountStatus`.

Logica `describeStatus` pentru Meta:
1. Dacă `disable_reason` ≠ 0 → headline + body + sugestie din `translateMetaDisableReason`
2. Dacă lipsește (status-uri ca `PENDING_RISK_REVIEW`/`IN_GRACE_PERIOD`/`PENDING_CLOSURE`/`CLOSED`) → cade pe `translateMetaAccountStatus`
3. Dacă nici una nu produce o traducere → cade la generic copy din ramura finală a `describeStatus`

**Exemple live:**

| account_status | disable_reason | UI label |
|---|---|---|
| 2 (DISABLED) | 1 (ADS_INTEGRITY_POLICY) | "Cont suspendat de Meta — Încălcare politici reclame" |
| 3 (UNSETTLED) | 8 (PRE_PAYMENT_ADS_DISABLED) | "Plata a eșuat pe Meta — Reclame oprite înainte de plată" |
| 9 (IN_GRACE_PERIOD) | 0 (NONE) | "Cont Meta — Perioadă de grație — factură neachitată" |
| 7 (PENDING_RISK_REVIEW) | 0 (NONE) | "Cont Meta — Verificare cont în curs" |
| 101 (CLOSED) | 0 (NONE) | "Cont închis definitiv" |

```

- [ ] **Step 2: Add row la "Istoric incidente"**

Append:

```
| 2026-04-24 | Meta suspendări afișate fără context | `disable_reason` numeric era stocat dar nu tradus; clientul vedea doar "Cont suspendat" generic indiferent de motiv | Translatori RO `translateMetaDisableReason` (11 valori) + `translateMetaAccountStatus` (4 valori cu copy specific) integrați în `describeStatus`; partajat cu admin dashboard, card client și email digest |
```

- [ ] **Step 3: Commit**

```bash
git add app/docs/ads-status-mappings.md
git commit -m "docs(ads): document Meta disable_reason + account_status RO mapping"
```

---

## Self-Review Checklist

- **Spec coverage:** 11 `disable_reason` valori traduse + 4 `account_status` valori distincte + ramură Meta în `describeStatus` + tests + demo + docs. ✓
- **Placeholder scan:** zero TBD/similar. Fiecare pas are cod complet. ✓
- **Type consistency:** `rawStatusCode?: string | null` adăugat consistent în `DescribeStatusInput`. Pasat din 3 call sites (server, client, demo). ✓
- **Zero pipeline changes:** Meta API, `meta-ads/status.ts`, persistență, DTO-uri — toate neatinse. Doar copy + describeStatus branch. ✓
- **Numeric → string coercion:** `rawDisableReason` și `rawStatusCode` ajung la `describeStatus` ca `string | null` (DTO-urile deja le coerce). Translators așteaptă string. ✓
- **Generic fallback:** valori necunoscute (e.g. cod nou Meta) cad la "Motiv nespecificat" cu sugestie de a deschide ticket Meta Support. Forward-compat. ✓
- **Demo preview:** Task 3 regenerează demo per memory `feedback_email_demo_preview`. ✓
- **No DB migration:** existing JSON column. ✓

---

## Gemini review changes (2026-04-24)

Aplicate înainte de implementare:

1. **Account_status coverage gap (2, 3, 8) (Task 1, Step 3B):** `translateMetaAccountStatus` acoperă acum 7 valori în loc de 4. `2` (DISABLED fără disable_reason) primește copy specific; `3` (UNSETTLED) și `8` (PENDING_SETTLEMENT) au mesaje liniștitoare ("plată în curs, 1-2 ore") care reduc tichetele de support în fereastra de procesare.
2. **Romanian copy refinement (Task 1, Step 3B):**
   - `8 PRE_PAYMENT_ADS_DISABLED` label `"Reclame oprite înainte de plată"` → `"Sold restant neachitat"` (mai idiomatic în context contabil RO)
   - `2 ADS_IP_REVIEW` sugestie extinsă cu mențiunea documentelor (facturi, contracte, licențe) pentru appeal
   - `12 BUSINESS_INTEGRITY_RS` label clarificat cu "(risk/restriction)", sugestie extinsă cu CUI/J firmă + screenshot-uri
3. **Forward-compat logging (Task 1, Step 3B):** `translateMetaDisableReason` emite `console.warn('[ads-status] Unknown Meta disable_reason: ${code}')` la default case — translator-ul e pur, nu poate folosi logger-ul async din `$lib/server/logger`, dar console.warn ajunge în stdout-ul aplicației prin convenția existentă pentru module pure.
4. **Discriminated union refactor (NU aplicat):** Gemini a recomandat refactor `DescribeStatusInput` la discriminated union pe provider pentru type safety. Decizie: deferat la o Faza ulterioară — `rawStatusCode?: string | null` opțional e safe astăzi (TikTok/Google îl ignoră), refactor-ul ar atinge ramurile recent shipped și introduce risc disproporționat față de beneficiul (compile-time guard pe ceva ce funcțional merge corect).
