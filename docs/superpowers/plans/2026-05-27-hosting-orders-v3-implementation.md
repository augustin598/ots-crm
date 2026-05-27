# Hosting Orders v3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
>
> **Hard rule for every .svelte file touched:** before commit, run `mcp__plugin_svelte_svelte__svelte-autofixer` AND `bun run dev` + HTTP 200 smoke test on the affected route. No exceptions.

**Goal:** Bring `/[tenant]/hosting/inquiries` into pixel-parity with the canonical design at `/tmp/design-target/create-campaign-ads/project/Hosting Orders.html` (Anthropic-hosted archive). Replace `--hod-*` v1 tokens with shared `hst-*`. Add 4 schema columns, manual order modal, confirm-payment panel, decline-code translation, pagination, date filter popover.

**Architecture:** Single-page rewrite (`+page.svelte`) using `hst-*` design tokens that mirror `/hosting/products` and `/hosting/servers`. Three webhook handlers gain card_last4 + error fields. New `createManualHostingOrder` admin command. Shared `insertHostingOrder` helper used by public submit + admin manual.

**Spec:** [`docs/superpowers/specs/2026-05-27-hosting-orders-v3-design-match.md`](../specs/2026-05-27-hosting-orders-v3-design-match.md)

**Design reference:** `/tmp/design-target/create-campaign-ads/project/Hosting Orders.html` (1140 lines, also `hosting-data.jsx` for the order shape).

---

## File Structure

**Created:**
- `app/drizzle/0386_hosting_product_color.sql`
- `app/drizzle/0387_hosting_inquiry_card_last4.sql`
- `app/drizzle/0388_hosting_inquiry_payment_error_code.sql`
- `app/drizzle/0389_hosting_inquiry_payment_error_message.sql`
- `app/src/lib/server/stripe/decline-codes.ts`
- `app/src/lib/server/stripe/__tests__/decline-codes.test.ts`
- `app/src/lib/server/hosting/insert-order.ts`
- `app/scripts/backfill-product-colors-and-card-last4.ts`

**Modified:**
- `app/src/lib/server/db/schema.ts`
- `app/drizzle/meta/_journal.json`
- `app/src/lib/server/stripe/webhook-handlers.ts`
- `app/src/lib/remotes/hosting-inquiries.remote.ts`
- `app/src/lib/remotes/public-hosting.remote.ts`
- `app/src/routes/[tenant]/hosting/inquiries/+page.svelte` (full rewrite)

---

### Task 1: Schema — add `hosting_product.color` + 3 `hosting_inquiry` columns

**Files:**
- Modify: `app/src/lib/server/db/schema.ts`

- [ ] **Step 1: Add `color` field to `hostingProduct`**

In the existing `hostingProduct` sqliteTable block, add (near `currency`):
```ts
		color: text('color').notNull().default('#1877F2'),
```

- [ ] **Step 2: Add 3 fields to `hostingInquiry`**

In the existing `hostingInquiry` block, after the existing `paymentReference` column, add:
```ts
		cardLast4: text('card_last4'),
		paymentErrorCode: text('payment_error_code'),
		paymentErrorMessage: text('payment_error_message'),
```

- [ ] **Step 3: Commit**
```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/server/db/schema.ts
git commit -m "feat(hosting-orders): schema for color + card_last4 + payment error"
```

---

### Task 2: 4 migrations (one ALTER per file)

- [ ] **0386 — hosting_product.color**
File: `app/drizzle/0386_hosting_product_color.sql`
```sql
ALTER TABLE hosting_product ADD COLUMN color TEXT NOT NULL DEFAULT '#1877F2';
```

- [ ] **0387 — card_last4**
File: `app/drizzle/0387_hosting_inquiry_card_last4.sql`
```sql
ALTER TABLE hosting_inquiry ADD COLUMN card_last4 TEXT;
```

- [ ] **0388 — payment_error_code**
File: `app/drizzle/0388_hosting_inquiry_payment_error_code.sql`
```sql
ALTER TABLE hosting_inquiry ADD COLUMN payment_error_code TEXT;
```

- [ ] **0389 — payment_error_message**
File: `app/drizzle/0389_hosting_inquiry_payment_error_message.sql`
```sql
ALTER TABLE hosting_inquiry ADD COLUMN payment_error_message TEXT;
```

- [ ] **Commit each individually** (4 commits — one per migration file)

---

### Task 3: Journal append

**File:** `app/drizzle/meta/_journal.json`

- [ ] **Step 1: Read the last entry's `when` epoch**
```bash
cd /Users/augustin598/Projects/CRM/app && tail -10 drizzle/meta/_journal.json
```
Get the `when` of entry 385. New entries get sequential `when` values starting from `<when_of_385> + 1000`.

- [ ] **Step 2: Append entries idx 386–389** with sequential `when` epochs (each ≥ previous + 1).

- [ ] **Step 3: Verify JSON parses**
```bash
cd /Users/augustin598/Projects/CRM/app && python3 -c "import json; json.load(open('drizzle/meta/_journal.json'))" && echo OK
```

- [ ] **Step 4: Apply migrations**
```bash
cd /Users/augustin598/Projects/CRM/app && bun run db:migrate
```
Expected: 4 migrations applied.

- [ ] **Step 5: Commit the journal**

---

### Task 4: Stripe decline-code translation utility + tests

**Files:**
- Create: `app/src/lib/server/stripe/decline-codes.ts`
- Create: `app/src/lib/server/stripe/__tests__/decline-codes.test.ts`

- [ ] **Step 1: Write tests first**

```ts
// app/src/lib/server/stripe/__tests__/decline-codes.test.ts
import { describe, test, expect } from 'bun:test';
import { translateDeclineCode } from '../decline-codes';

describe('translateDeclineCode', () => {
	test('translates insufficient_funds', () => {
		expect(translateDeclineCode('insufficient_funds', 'Your card was declined.')).toBe(
			'Card refuzat de bancă · cod 51 (fonduri insuficiente)'
		);
	});

	test('translates expired_card', () => {
		expect(translateDeclineCode('expired_card', 'fallback')).toBe('Card expirat');
	});

	test('translates card_declined as generic decline', () => {
		expect(translateDeclineCode('card_declined', 'fallback')).toBe(
			'Card refuzat de bancă'
		);
	});

	test('translates incorrect_cvc', () => {
		expect(translateDeclineCode('incorrect_cvc', 'fallback')).toBe('CVC incorect');
	});

	test('translates processing_error', () => {
		expect(translateDeclineCode('processing_error', 'fallback')).toBe(
			'Eroare de procesare la bancă · încercați din nou'
		);
	});

	test('translates authentication_required', () => {
		expect(translateDeclineCode('authentication_required', 'fallback')).toBe(
			'Autentificare 3D Secure eșuată'
		);
	});

	test('falls back to Stripe message for unknown code', () => {
		expect(translateDeclineCode('something_weird', 'Card was refused by issuer.')).toBe(
			'Card was refused by issuer.'
		);
	});

	test('falls back to generic message when no fallback provided', () => {
		expect(translateDeclineCode('weird_code', null)).toBe(
			'Plata a fost respinsă · contactați banca emitentă'
		);
	});

	test('null code returns generic decline', () => {
		expect(translateDeclineCode(null, null)).toBe(
			'Plata a fost respinsă · contactați banca emitentă'
		);
	});
});
```

- [ ] **Step 2: Implement the utility**

```ts
// app/src/lib/server/stripe/decline-codes.ts
/**
 * Translate Stripe decline / error codes into Romanian-language messages
 * suitable for the admin Comenzi hosting UI and Keez invoice notes.
 *
 * Falls back to:
 *   1. Stripe's English `error.message` if provided,
 *   2. a generic Romanian fallback otherwise.
 *
 * Codes from https://docs.stripe.com/declines/codes and
 * https://docs.stripe.com/error-codes.
 */

const TRANSLATIONS: Record<string, string> = {
	insufficient_funds: 'Card refuzat de bancă · cod 51 (fonduri insuficiente)',
	card_declined: 'Card refuzat de bancă',
	expired_card: 'Card expirat',
	incorrect_cvc: 'CVC incorect',
	incorrect_number: 'Număr card incorect',
	invalid_number: 'Număr card invalid',
	invalid_cvc: 'CVC invalid',
	invalid_expiry_month: 'Lună de expirare invalidă',
	invalid_expiry_year: 'An de expirare invalid',
	processing_error: 'Eroare de procesare la bancă · încercați din nou',
	authentication_required: 'Autentificare 3D Secure eșuată',
	card_velocity_exceeded: 'Limită de încercări depășită · reîncercați mai târziu',
	do_not_honor: 'Banca a respins plata · contactați emitentul',
	pickup_card: 'Card respins · contactați banca emitentă',
	lost_card: 'Card raportat pierdut',
	stolen_card: 'Card raportat furat',
	generic_decline: 'Card refuzat de bancă',
	fraudulent: 'Tranzacție respinsă pentru risc de fraudă',
	withdrawal_count_limit_exceeded: 'Limită de tranzacții depășită'
};

export function translateDeclineCode(
	code: string | null | undefined,
	fallbackMessage: string | null | undefined
): string {
	if (code && TRANSLATIONS[code]) return TRANSLATIONS[code];
	if (fallbackMessage && fallbackMessage.trim()) return fallbackMessage;
	return 'Plata a fost respinsă · contactați banca emitentă';
}
```

- [ ] **Step 3: Run tests, verify pass**
```bash
cd /Users/augustin598/Projects/CRM/app && bun test src/lib/server/stripe/__tests__/decline-codes.test.ts
```
Expected: 9/9 pass.

- [ ] **Step 4: Commit**

---

### Task 5: Webhook handlers — populate card_last4 + payment_error_*

**File:** `app/src/lib/server/stripe/webhook-handlers.ts`

- [ ] **Step 1: Read existing handlers**
Locate `handlePaymentIntentSucceeded`, `handlePaymentIntentFailed`, `handlePaymentFailed`. Note the existing UPDATE on `hosting_inquiry` in each.

- [ ] **Step 2: In `handlePaymentIntentSucceeded`** — when card payment, extract last4:

Add (before the existing inquiry UPDATE call):
```ts
const cardLast4 =
	intent.latest_charge && typeof intent.latest_charge === 'object'
		? (intent.latest_charge as Stripe.Charge).payment_method_details?.card?.last4 ?? null
		: null;
```
And include `cardLast4` in the `.set({...})` block of the existing UPDATE.

Note: if `latest_charge` is a string ID (not expanded), call `stripe.charges.retrieve(intent.latest_charge)` to expand. For most flows in this repo we already expand `latest_charge` — check the existing code before adding the retrieve.

- [ ] **Step 3: In `handlePaymentIntentFailed` and `handlePaymentFailed`** — populate error code + message:

```ts
import { translateDeclineCode } from '$lib/server/stripe/decline-codes';

const err = intent.last_payment_error;
const code = err?.decline_code ?? err?.code ?? null;
const message = translateDeclineCode(code, err?.message ?? null);
```
Set `paymentErrorCode: code, paymentErrorMessage: message` in the existing UPDATE.

- [ ] **Step 4: svelte-check** the file is type-clean
```bash
cd /Users/augustin598/Projects/CRM/app && bunx svelte-check --threshold warning src/lib/server/stripe/webhook-handlers.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

---

### Task 6: Extract shared insert helper

**Files:**
- Create: `app/src/lib/server/hosting/insert-order.ts`
- Modify: `app/src/lib/remotes/public-hosting.remote.ts`

- [ ] **Step 1: Write the new module**

```ts
// app/src/lib/server/hosting/insert-order.ts
/**
 * Shared insert path for hosting inquiries — used by both:
 *   - public submit (`/pachete-hosting` → submitHostingOrder)
 *   - admin manual creation (`+ Comandă manuală` → createManualHostingOrder)
 *
 * Identical row shape across both paths: same `order_number` subquery
 * (libSQL single-writer + UNIQUE index guard) and the same items insert.
 */
import { db } from '$lib/server/db';
import { hostingInquiry, hostingInquiryItem, hostingProduct } from '$lib/server/db/schema';
import { sql, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export interface InsertOrderParams {
	contactName: string;
	contactEmail: string;
	contactPhone?: string | null;
	companyName?: string | null;
	vatNumber?: string | null;
	message?: string | null;
	hostingProductId?: string | null;
	clientId?: string | null;
	source: string;
	ipAddress?: string | null;
	userAgent?: string | null;
	paymentMethod?: 'card' | 'op' | 'paypal' | 'revolut' | 'cash' | null;
	paymentStatus?: 'pending' | 'processing' | 'paid' | 'failed' | 'refunded';
	paidAmountCents?: number | null;
	paidAt?: Date | null;
	paymentReference?: string | null;
	cardLast4?: string | null;
	acceptedByUserId?: string | null;
	acceptedAt?: Date | null;
	requestedDomain?: string | null;
	domainName?: string | null;
	domainMode?: 'buy' | 'have' | 'transfer' | null;
	domainCostCents?: number | null;
	status?: 'new' | 'contacted' | 'converted' | 'discarded' | 'abandoned';
}

/**
 * Insert a hosting inquiry + its line items in one transaction-like flow.
 * Returns the new inquiry id.
 */
export async function insertHostingOrder(
	tenantId: string,
	params: InsertOrderParams
): Promise<{ id: string }> {
	const id = generateId();

	// Lookup product info for item label (only when product chosen).
	let product: { id: string; name: string; price: number; billingCycle: string | null } | null = null;
	if (params.hostingProductId) {
		const [row] = await db
			.select({
				id: hostingProduct.id,
				name: hostingProduct.name,
				price: hostingProduct.price,
				billingCycle: hostingProduct.billingCycle
			})
			.from(hostingProduct)
			.where(eq(hostingProduct.id, params.hostingProductId))
			.limit(1);
		if (row) product = row;
	}

	await db.insert(hostingInquiry).values({
		id,
		tenantId,
		hostingProductId: params.hostingProductId ?? null,
		contactName: params.contactName,
		contactEmail: params.contactEmail,
		contactPhone: params.contactPhone ?? null,
		companyName: params.companyName ?? null,
		vatNumber: params.vatNumber ?? null,
		message: params.message ?? null,
		clientId: params.clientId ?? null,
		source: params.source,
		ipAddress: params.ipAddress ?? null,
		userAgent: params.userAgent ?? null,
		paymentMethod: params.paymentMethod ?? null,
		paymentStatus: params.paymentStatus ?? 'pending',
		paidAmountCents: params.paidAmountCents ?? null,
		paidAt: params.paidAt ?? null,
		paymentReference: params.paymentReference ?? null,
		cardLast4: params.cardLast4 ?? null,
		acceptedByUserId: params.acceptedByUserId ?? null,
		acceptedAt: params.acceptedAt ?? null,
		requestedDomain: params.requestedDomain ?? null,
		status: params.status ?? 'new',
		orderNumber: sql`(SELECT COALESCE(MAX(order_number), 0) + 1 FROM hosting_inquiry WHERE tenant_id = ${tenantId})`
	});

	// Build items.
	const items: (typeof hostingInquiryItem.$inferInsert)[] = [];
	if (product) {
		items.push({
			id: generateId(),
			inquiryId: id,
			tenantId,
			kind: 'hosting',
			label: `${product.name} (${product.billingCycle === 'yearly' ? 'anual' : 'lunar'})`,
			hostingProductId: product.id,
			unitPriceCents: product.price,
			quantity: 1,
			vatRate: 19
		});
	}
	if (params.domainName) {
		const mode = params.domainMode ?? null;
		if (mode === 'buy' && (params.domainCostCents ?? 0) > 0) {
			items.push({
				id: generateId(),
				inquiryId: id,
				tenantId,
				kind: 'domain',
				label: `Domeniu ${params.domainName}`,
				unitPriceCents: params.domainCostCents!,
				quantity: 1,
				vatRate: 19,
				domainName: params.domainName,
				domainMode: 'buy'
			});
		} else if (mode === 'have' || mode === 'transfer') {
			const lbl = mode === 'have' ? 'existent' : 'transfer';
			items.push({
				id: generateId(),
				inquiryId: id,
				tenantId,
				kind: 'domain',
				label: `Domeniu ${params.domainName} (${lbl})`,
				unitPriceCents: 0,
				quantity: 1,
				vatRate: 19,
				domainName: params.domainName,
				domainMode: mode
			});
		}
	}
	if (items.length) await db.insert(hostingInquiryItem).values(items);

	return { id };
}
```

- [ ] **Step 2: Refactor `public-hosting.remote.ts`**

Replace the 6 inline `db.insert(table.hostingInquiry)...` + `insertInquiryItems(...)` call pairs with single calls to `await insertHostingOrder(tenantId, {...})` from the new module. Remove the local `insertInquiryItems` helper (its logic moved into `insertHostingOrder`).

At each of the 6 sites, the call becomes:
```ts
const { id } = await insertHostingOrder(tenantId, {
	contactName: data.contactName,
	contactEmail: data.contactEmail,
	// ... pass through all fields available at that call site
	source: data.source ?? 'pachete-hosting',
	hostingProductId: data.hostingProductId,
	clientId: <relevant clientId>,
	requestedDomain: data.requestedDomain,
	domainName: data.domainName,
	domainMode: data.domainMode,
	domainCostCents: data.domainCostCents,
	paymentMethod: data.paymentMethod
});
```

For race-recovery sites where a `product` wasn't fetched, the helper handles it (it does its own lookup).

- [ ] **Step 3: svelte-check** both files
```bash
cd /Users/augustin598/Projects/CRM/app && bunx svelte-check --threshold warning src/lib/server/hosting/insert-order.ts src/lib/remotes/public-hosting.remote.ts 2>&1 | tail -15
```

- [ ] **Step 4: Commit**

---

### Task 7: HostingOrderRow extension + admin manual order remote

**File:** `app/src/lib/remotes/hosting-inquiries.remote.ts`

- [ ] **Step 1: Extend `HostingOrderRow` type** — add new fields:
```ts
cardLast4: string | null;
paymentErrorCode: string | null;
paymentErrorMessage: string | null;
productColor: string | null;
productId: string | null; // already exists as hostingProductId; alias for design parity
```

- [ ] **Step 2: Update `getHostingOrders` query** to select the new fields from joined tables:
```ts
cardLast4: table.hostingInquiry.cardLast4,
paymentErrorCode: table.hostingInquiry.paymentErrorCode,
paymentErrorMessage: table.hostingInquiry.paymentErrorMessage,
productColor: table.hostingProduct.color,
```

- [ ] **Step 3: Add `createManualHostingOrder` command** at the bottom of the file:

```ts
const ManualOrderSchema = v.object({
	contactName: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
	contactEmail: v.pipe(v.string(), v.email()),
	type: v.picklist(['person', 'company']),
	companyName: v.optional(v.pipe(v.string(), v.maxLength(200))),
	vatNumber: v.optional(v.pipe(v.string(), v.maxLength(40))),
	hostingProductId: v.pipe(v.string(), v.minLength(1)),
	period: v.picklist(['monthly', 'yearly']),
	domainName: v.pipe(v.string(), v.minLength(1), v.maxLength(253)),
	domainMode: v.picklist(['buy', 'have', 'transfer']),
	paymentMethod: v.picklist(['card', 'op', 'revolut', 'paypal', 'cash']),
	initialStatus: v.picklist(['paid', 'pending', 'processing']),
	server: v.optional(v.pipe(v.string(), v.maxLength(60))) // 'auto' or DA server id
});

export const createManualHostingOrder = command(
	ManualOrderSchema,
	async (data): Promise<{ id: string; orderNumber: number | null }> => {
		const { event, tenantId } = tenantScope();
		const actor = await getActor(event);
		assertCan(actor, 'admin.hosting.manage');

		// Look up product to derive amount + currency.
		const [product] = await db
			.select({
				id: table.hostingProduct.id,
				name: table.hostingProduct.name,
				priceMonth: table.hostingProduct.price, // NOTE: existing schema stores ONE price; if you have monthly+yearly, adjust
				billingCycle: table.hostingProduct.billingCycle,
				currency: table.hostingProduct.currency
			})
			.from(table.hostingProduct)
			.where(and(eq(table.hostingProduct.id, data.hostingProductId), eq(table.hostingProduct.tenantId, tenantId)))
			.limit(1);
		if (!product) throw new Error('Pachet hosting inexistent');

		const domainCostCents = data.domainMode === 'buy' ? 4900 : 0; // 49 RON default; future: per-TLD
		const paymentStatus = data.initialStatus;
		const paid = paymentStatus === 'paid';
		const paidAmountCents = paid ? product.priceMonth + domainCostCents + Math.round((product.priceMonth + domainCostCents) * 0.19) : null;

		const { id } = await insertHostingOrder(tenantId, {
			contactName: data.contactName,
			contactEmail: data.contactEmail,
			companyName: data.type === 'company' ? (data.companyName ?? null) : null,
			vatNumber: data.type === 'company' ? (data.vatNumber ?? null) : null,
			hostingProductId: data.hostingProductId,
			source: 'manual',
			paymentMethod: data.paymentMethod,
			paymentStatus,
			paidAmountCents,
			paidAt: paid ? new Date() : null,
			acceptedByUserId: paid ? actor.user.id : null,
			acceptedAt: paid ? new Date() : null,
			requestedDomain: data.domainName,
			domainName: data.domainName,
			domainMode: data.domainMode,
			domainCostCents,
			status: paid ? 'converted' : 'new'
		});

		const [row] = await db
			.select({ orderNumber: table.hostingInquiry.orderNumber })
			.from(table.hostingInquiry)
			.where(eq(table.hostingInquiry.id, id))
			.limit(1);

		return { id, orderNumber: row?.orderNumber ?? null };
	}
);
```

- [ ] **Step 4: svelte-check + commit**

---

### Task 8: Backfill script

**File:** `app/scripts/backfill-product-colors-and-card-last4.ts`

- [ ] **Step 1: Write the script** — modeled on existing `backfill-hosting-order-numbers-and-items.ts` (use `@libsql/client` directly, not Drizzle, to avoid `$env/dynamic/private` imports). Stripe SDK directly. Walks paid inquiries with `paymentReference` (Pi id) and `card_last4 IS NULL`, retrieves `paymentIntents.retrieve(piId, {expand: ['latest_charge']})`, persists `card_last4` from `latest_charge.payment_method_details.card.last4`. Also fills `hosting_product.color` from name→hex map for any product with default color and a known name.

```ts
// app/scripts/backfill-product-colors-and-card-last4.ts
import { createClient } from '@libsql/client';
import Stripe from 'stripe';

const url = process.env.SQLITE_URI!;
const authToken = process.env.SQLITE_AUTH_TOKEN;
const stripeKey = process.env.STRIPE_SECRET_KEY!;
const db = createClient({ url, authToken });
const stripe = new Stripe(stripeKey, { apiVersion: '2025-09-30.basil' });

const PLAN_COLORS: Record<string, string> = {
	standard: '#64748b',
	pro: '#1877F2',
	premium: '#0d5cc7',
	extreme: '#7c3aed'
};

async function backfillProductColors() {
	const products = await db.execute(
		"SELECT id, name, color FROM hosting_product WHERE color = '#1877F2'"
	);
	let updated = 0;
	for (const p of products.rows) {
		const key = String(p.name ?? '').toLowerCase().trim();
		const color = PLAN_COLORS[key];
		if (!color || color === '#1877F2') continue;
		await db.execute({
			sql: 'UPDATE hosting_product SET color = ? WHERE id = ?',
			args: [color, p.id as string]
		});
		updated += 1;
	}
	console.log(`[backfill] hosting_product.color: updated ${updated} rows`);
}

async function backfillCardLast4() {
	const rows = await db.execute(
		"SELECT id, payment_reference FROM hosting_inquiry WHERE card_last4 IS NULL AND payment_status = 'paid' AND payment_reference LIKE 'pi_%'"
	);
	let updated = 0;
	let skipped = 0;
	for (const r of rows.rows) {
		const piId = r.payment_reference as string;
		try {
			const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] });
			const charge = pi.latest_charge && typeof pi.latest_charge === 'object'
				? (pi.latest_charge as Stripe.Charge)
				: null;
			const last4 = charge?.payment_method_details?.card?.last4 ?? null;
			if (!last4) { skipped += 1; continue; }
			await db.execute({
				sql: 'UPDATE hosting_inquiry SET card_last4 = ? WHERE id = ?',
				args: [last4, r.id as string]
			});
			updated += 1;
		} catch (e) {
			console.warn(`[backfill] PI ${piId} failed:`, (e as Error).message);
			skipped += 1;
		}
	}
	console.log(`[backfill] hosting_inquiry.card_last4: updated ${updated}, skipped ${skipped}`);
}

async function main() {
	await backfillProductColors();
	await backfillCardLast4();
	console.log('[backfill] done');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the script**
```bash
cd /Users/augustin598/Projects/CRM/app && bun run scripts/backfill-product-colors-and-card-last4.ts
```

- [ ] **Step 3: Run a 2nd time** — confirm 0/0 (idempotent)

- [ ] **Step 4: Commit**

---

### Task 9: +page.svelte rewrite — script section

**File:** `app/src/routes/[tenant]/hosting/inquiries/+page.svelte` (~1900 lines of script + markup + style)

This task replaces the v1 `--hod-*` script with the design-aligned `hst-*` version. The script section adds: `ManualOrderModal` open state, decline-code-aware rendering, color-per-product helper, 6-card KPI calculations, processing-state handling, pagination state, date filter popover state.

- [ ] **Step 1: Replace the `<script>` section (lines 1-650 today) entirely** with the new version. The full code is too long to inline here — copy from the canonical design `Hosting Orders.html` (the `<script type="text/babel">` block at lines 325-1127) and adapt React→Svelte 5 runes. Specifically:

	- All `useState(x)` → `let x = $state(x)`
	- All `useMemo(() => fn, [deps])` → `const x = $derived(fn())`
	- `setOrders(prev => ...)` → mutate `orders` directly (it's `$state`)
	- React `onClick={fn}` → Svelte `onclick={fn}`
	- React `onChange={e => ...}` → Svelte `oninput={(e) => ...}` or `bind:value`
	- React `className` → `class`
	- Icon refs `<Icon.X w={14} h={14} />` → lucide imports `<XIcon size={14} />`
	- Toast `pushToast({kind:'success', title, body})` → `toast.success(title, { description: body })` from svelte-sonner
	- Data source: instead of `D.ORDERS` (mock), use the existing `getHostingOrders()` query promise.

- [ ] **Step 2: Add helpers** (`accountStatus` derivation from inquiry shape, `methodIcon` lookup, `payTone`, `paymentLabel`, `accountLabel`, plan-color fallback `productColorOf(o)`, `buildTimeline(o)` returning typed entries with hex dots).

- [ ] **Step 3: Add `createManualHostingOrder` import** and the modal open/close + submit handlers wiring.

- [ ] **Step 4: svelte-check + autofixer** before continuing.
```bash
cd /Users/augustin598/Projects/CRM/app && bunx svelte-check --threshold warning src/routes/[tenant]/hosting/inquiries/+page.svelte 2>&1 | tail -20
```
Then run the autofixer via MCP. Both clean before commit.

- [ ] **Step 5: Commit**

---

### Task 10: +page.svelte rewrite — markup (template)

- [ ] **Step 1: Replace the markup between `</script>` and `<style>`** with the design's structure adapted to Svelte:

  - Hero with 3 buttons (`Sync plăți` / `Export CSV` / `+ Comandă manuală` primary)
  - 6 KPI tiles (`dash-kpi` classes; delta arrows; sub line per card)
  - Tabs row (5 tabs) using `hst-tabs` + `hst-tab` + `hst-tab-count`
  - Toolbar row: search input + 4 filter chips (Pachet / Metodă / Perioadă / Data with popover)
  - Table: 8-column structure exactly as in design (lines 1021-1083)
  - Pagination footer: `Afișează N din N comenzi` + page buttons
  - Conditional drawer (`{#if openOrder}`) with header, banner (failed/pending), confirm panel, sections (Client / Detalii comandă / Plată / Istoric), footer
  - Conditional `ManualOrderModal` (`{#if showManual}`) — 720px modal

  **All `{@const}` declarations must be direct children of `{#each}` or `{#if}` blocks** (lesson learned from v2).

  Reference the exact JSX in the design archive for the structure; mechanical conversion.

- [ ] **Step 2: svelte-check + autofixer** — both clean.

- [ ] **Step 3: Commit**

---

### Task 11: +page.svelte rewrite — styles

- [ ] **Step 1: Replace the `<style>` block** with the contents from:
  - The design's `hosting-styles.css` (relevant `hst-*` rules: hero, kpis, tabs, search, filter-chip, table, table cells, drawer, drawer head/body/foot, icon buttons)
  - The design's `dashboard-styles.css` (relevant `dash-kpi*` rules)
  - The design's inline `<style>` block from `Hosting Orders.html` (the order-specific extras: `ord-pay-badge`, `ord-acc-badge`, `ord-method-tile`, `ord-source-pill`, `ord-detail-timeline`, `ord-totals`, `ord-mo-*`, `ord-confirm-*`, `ord-date-pop-*`).

  Page-scoped (Svelte auto-scopes `<style>`).

- [ ] **Step 2: svelte-check + autofixer + boot test**
```bash
cd /Users/augustin598/Projects/CRM/app && bun run dev > /tmp/dev.log 2>&1 &
sleep 18
curl -s -o /dev/null -w "HTTP=%{http_code}\n" http://localhost:5173/ots/hosting/inquiries
pkill -9 -f "vite dev"
```
Expected: `HTTP=200`.

- [ ] **Step 3: Commit**

---

### Task 12: Final smoke test

- [ ] **Step 1: Full `bunx svelte-check`** across project — no NEW errors in modified files.

- [ ] **Step 2: `bun test`** — no regressions.

- [ ] **Step 3: Manual visual check** at `http://localhost:5173/ots/hosting/inquiries`:
  - 6 KPI tiles in a row, deltas visible
  - 5 tabs with counts
  - Filter chips with X close icon when active
  - Date popover opens with presets + counts
  - Table rows show all 8 columns with correct content shape
  - Click row → 640px drawer opens with plan-colored header
  - For pending → yellow banner OR confirm panel
  - For failed → red banner + Retry
  - `+ Comandă manuală` opens 720px modal, submits, new row appears
  - Pagination shows `Afișează N din N` + buttons
  - Mobile (375px) — KPI stacks to 2-col, drawer becomes full-screen

- [ ] **Step 4: Commit any fix-ups from QA**

---

### Task 13: Push

- [ ] `cd /Users/augustin598/Projects/CRM && git log --oneline -20`
- [ ] `cd /Users/augustin598/Projects/CRM && git push origin main`

If user prefers NOT to push (auto-mode classifier may block), STOP and let the user push manually. Never use `--no-verify`.
