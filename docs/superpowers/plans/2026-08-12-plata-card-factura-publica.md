# Plată cu cardul pe pagina publică de factură — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clientul care primește linkul public al unei facturi (`/invoice/{slug}/{token}`) poate plăti cu cardul direct în pagină, fără login.

**Architecture:** Un remote public autorizat prin tokenul din URL creează un Stripe PaymentIntent cu `metadata.crmPurpose='invoice_payment'`; webhook-ul existent (`handleStripeInvoicePayment`) marchează factura plătită. Adăugăm un guard de sumă în webhook, un task zilnic de reconciliere pentru webhook-uri pierdute și butonul corespunzător în emailuri.

**Tech Stack:** SvelteKit 5 (remote functions, runes), Drizzle + libSQL, Stripe (PaymentIntents + PaymentElement), Redis (rate limit), Bun test.

**Spec:** `docs/superpowers/specs/2026-08-12-plata-card-factura-publica-design.md`

---

## File Structure

| Fișier | Responsabilitate |
|---|---|
| `src/lib/server/stripe/invoice-payable.ts` **(nou)** | Reguli pure de eligibilitate: statusuri plătibile, prag minim Stripe pe monedă. Fără I/O, ca pagina și remote-ul să nu poată diverge. |
| `src/lib/server/stripe/__tests__/invoice-payable.test.ts` **(nou)** | Teste pentru regulile de mai sus. |
| `src/lib/server/stripe/invoice-payment.ts` (modificat) | Guard de sumă + alertă de dublă încasare în handler-ul de webhook existent. |
| `src/lib/server/stripe/__tests__/invoice-payment.test.ts` (modificat) | Teste pentru guard-urile noi. |
| `src/lib/remotes/public-invoice.remote.ts` **(nou)** | Remote public: validează tokenul, aplică rate limit, creează/refolosește PaymentIntent. |
| `src/lib/remotes/__tests__/public-invoice.remote.test.ts` **(nou)** | Teste pentru guard-urile remote-ului. |
| `src/routes/invoice/[tenant]/[token]/+page.server.ts` (modificat) | Expune `canPayByCard` către pagină. |
| `src/routes/invoice/[tenant]/[token]/+page.svelte` (modificat) | Cardul „Plată cu cardul” cu PaymentElement. |
| `src/lib/server/email.ts` (modificat) | Buton „Plătește cu cardul” în emailul de factură și în reminder. |
| `src/lib/server/scheduler/tasks/stripe-invoice-reconcile.ts` **(nou)** | Task zilnic: PaymentIntent `succeeded` pe factură neplătită → marchează plătită. |
| `src/lib/server/scheduler/tasks/__tests__/stripe-invoice-reconcile.test.ts` **(nou)** | Teste pentru task. |
| `src/lib/server/scheduler/index.ts` (modificat) | Înregistrarea taskului. |

---

## Task 1: Reguli de eligibilitate pentru plata cu cardul

**Files:**
- Create: `app/src/lib/server/stripe/invoice-payable.ts`
- Test: `app/src/lib/server/stripe/__tests__/invoice-payable.test.ts`

- [ ] **Step 1: Write the failing test**

`app/src/lib/server/stripe/__tests__/invoice-payable.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import {
	checkCardPaymentEligibility,
	isPayableInvoiceStatus,
	minCardAmountCents
} from '../invoice-payable';

describe('minCardAmountCents', () => {
	test('RON are pragul Stripe de 2 lei', () => {
		expect(minCardAmountCents('RON')).toBe(200);
	});

	test('EUR și USD au pragul de 0,50', () => {
		expect(minCardAmountCents('EUR')).toBe(50);
		expect(minCardAmountCents('USD')).toBe(50);
	});

	test('moneda necunoscută sau lipsă cade pe pragul conservator', () => {
		expect(minCardAmountCents('GBP')).toBe(200);
		expect(minCardAmountCents(null)).toBe(200);
	});

	test('moneda e case-insensitive', () => {
		expect(minCardAmountCents('eur')).toBe(50);
	});
});

describe('isPayableInvoiceStatus', () => {
	test('draft, sent și overdue sunt plătibile', () => {
		expect(isPayableInvoiceStatus('draft')).toBe(true);
		expect(isPayableInvoiceStatus('sent')).toBe(true);
		expect(isPayableInvoiceStatus('overdue')).toBe(true);
	});

	test('paid, cancelled, partially_paid și refunded NU sunt plătibile cu cardul', () => {
		expect(isPayableInvoiceStatus('paid')).toBe(false);
		expect(isPayableInvoiceStatus('cancelled')).toBe(false);
		expect(isPayableInvoiceStatus('partially_paid')).toBe(false);
		expect(isPayableInvoiceStatus('refunded')).toBe(false);
		expect(isPayableInvoiceStatus(null)).toBe(false);
	});
});

describe('checkCardPaymentEligibility', () => {
	test('factură trimisă, peste prag → eligibilă', () => {
		expect(
			checkCardPaymentEligibility({ status: 'sent', totalAmount: 90629, currency: 'RON' })
		).toEqual({ eligible: true });
	});

	test('factură deja plătită → already_paid (nu e o eroare)', () => {
		expect(
			checkCardPaymentEligibility({ status: 'paid', totalAmount: 90629, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'already_paid' });
	});

	test('factură anulată → respinsă pe status', () => {
		expect(
			checkCardPaymentEligibility({ status: 'cancelled', totalAmount: 90629, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'status' });
	});

	test('factură parțial plătită → respinsă pe status (rămâne pe transfer bancar)', () => {
		expect(
			checkCardPaymentEligibility({ status: 'partially_paid', totalAmount: 5000, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'status' });
	});

	test('sub pragul Stripe → respinsă pe sumă', () => {
		expect(
			checkCardPaymentEligibility({ status: 'sent', totalAmount: 150, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'amount' });
	});

	test('sumă zero sau lipsă → respinsă pe sumă', () => {
		expect(
			checkCardPaymentEligibility({ status: 'sent', totalAmount: 0, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'amount' });
		expect(
			checkCardPaymentEligibility({ status: 'sent', totalAmount: null, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'amount' });
	});

	test('1,00 EUR trece pragul EUR deși e sub pragul RON', () => {
		expect(
			checkCardPaymentEligibility({ status: 'sent', totalAmount: 100, currency: 'EUR' })
		).toEqual({ eligible: true });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && bun test src/lib/server/stripe/__tests__/invoice-payable.test.ts`
Expected: FAIL — `Cannot find module '../invoice-payable'`

- [ ] **Step 3: Write minimal implementation**

`app/src/lib/server/stripe/invoice-payable.ts`:

```ts
/**
 * Reguli pure pentru „poate fi plătită factura asta cu cardul?".
 *
 * Trăiesc separat de remote și de pagină pentru că AMBELE trebuie să dea același
 * răspuns: pagina decide dacă afișează cardul de plată, remote-ul decide dacă
 * acceptă plata. Divergența dintre ele ar însemna un buton care duce la eroare.
 *
 * Fără I/O — configurarea Stripe pe tenant se verifică separat, la apelant.
 */

/** Statusuri de factură pentru care acceptăm plata cu cardul. */
export const PAYABLE_INVOICE_STATUSES = ['draft', 'sent', 'overdue'] as const;

/**
 * Suma minimă acceptată de Stripe, în subunități (bani/cenți). Sub prag, API-ul
 * întoarce `amount_too_small` cu un mesaj criptic pentru client.
 * Sursa: https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts
 */
const MIN_CARD_AMOUNT_BY_CURRENCY: Record<string, number> = {
	RON: 200, // 2,00 RON
	EUR: 50, // 0,50 EUR
	USD: 50 // 0,50 USD
};

/** Prag conservator pentru monede necunoscute — mai bine refuzăm decât să eșuăm la Stripe. */
const MIN_CARD_AMOUNT_FALLBACK = 200;

export function minCardAmountCents(currency: string | null | undefined): number {
	if (!currency) return MIN_CARD_AMOUNT_FALLBACK;
	return MIN_CARD_AMOUNT_BY_CURRENCY[currency.toUpperCase()] ?? MIN_CARD_AMOUNT_FALLBACK;
}

export function isPayableInvoiceStatus(status: string | null | undefined): boolean {
	if (!status) return false;
	return (PAYABLE_INVOICE_STATUSES as readonly string[]).includes(status);
}

export type CardPaymentEligibility =
	| { eligible: true }
	| { eligible: false; reason: 'already_paid' | 'status' | 'amount' };

/**
 * `already_paid` e separat de `status` pentru că nu e o eroare: UI-ul arată
 * „factura e deja achitată", nu „nu poți plăti".
 */
export function checkCardPaymentEligibility(invoice: {
	status: string | null | undefined;
	totalAmount: number | null | undefined;
	currency: string | null | undefined;
}): CardPaymentEligibility {
	if (invoice.status === 'paid') return { eligible: false, reason: 'already_paid' };
	if (!isPayableInvoiceStatus(invoice.status)) return { eligible: false, reason: 'status' };

	const total = invoice.totalAmount ?? 0;
	if (total <= 0 || total < minCardAmountCents(invoice.currency)) {
		return { eligible: false, reason: 'amount' };
	}

	return { eligible: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && bun test src/lib/server/stripe/__tests__/invoice-payable.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/stripe/invoice-payable.ts app/src/lib/server/stripe/__tests__/invoice-payable.test.ts
git commit -m "feat(stripe): reguli de eligibilitate pentru plata facturii cu cardul"
```

---

## Task 2: Guard de sumă + alertă de dublă încasare în webhook

**Files:**
- Modify: `app/src/lib/server/stripe/invoice-payment.ts`
- Test: `app/src/lib/server/stripe/__tests__/invoice-payment.test.ts` (există — extindem)

**De ce:** `handleStripeInvoicePayment` primește deja `paidAmountCents` dar nu-l compară cu nimic. Dacă staff-ul editează factura cât timp clientul are formularul de plată deschis, marcăm plătită o sumă care nu corespunde. Iar dacă doi oameni plătesc aceeași factură, a doua plată dispare tăcut pe ramura idempotentă.

- [ ] **Step 1: Write the failing tests**

În `app/src/lib/server/stripe/__tests__/invoice-payment.test.ts`, adaugă `totalAmount` în rândurile existente și apoi testele noi.

Modifică primul test (`marks a sent invoice paid...`) — primul `pushSelect` devine:

```ts
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'sent',
				invoiceNumber: '8',
				totalAmount: 90629,
				hostingAccountId: 'acc-1',
				stripePaymentIntentId: null,
				externalTransactionId: null
			}
		]);
```

Modifică al doilea test (`is idempotent...`) — rândul devine:

```ts
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'paid',
				invoiceNumber: '8',
				totalAmount: 90629,
				hostingAccountId: 'acc-1',
				stripePaymentIntentId: 'pi_123'
			}
		]);
```

Adaugă la finalul blocului `describe('handleStripeInvoicePayment', ...)`:

```ts
	test('suma încasată diferă de totalul facturii → NU marchează plătită, loghează critic', async () => {
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'sent',
				invoiceNumber: '8',
				totalAmount: 90629,
				hostingAccountId: 'acc-1',
				stripePaymentIntentId: 'pi_123',
				externalTransactionId: null
			}
		]);

		await handleStripeInvoicePayment({
			tenantId: 't1',
			invoiceId: 'inv-1',
			paymentIntentId: 'pi_123',
			paidAmountCents: 50000, // factura a fost editată între timp
			eventLabel: 'payment_intent.succeeded'
		});

		expect(updateCalls).toBe(0);
		expect(emitted).toHaveLength(0);
		expect(errorLogs.some((m) => m.includes('sumă'))).toBe(true);
	});

	test('sumă necunoscută (null) nu blochează marcarea plătită', async () => {
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'sent',
				invoiceNumber: '8',
				totalAmount: 90629,
				hostingAccountId: 'acc-1',
				stripePaymentIntentId: null,
				externalTransactionId: null
			}
		]);
		pushSelect([
			{ id: 'inv-1', tenantId: 't1', status: 'paid', invoiceNumber: '8', totalAmount: 90629 }
		]);

		await handleStripeInvoicePayment({
			tenantId: 't1',
			invoiceId: 'inv-1',
			paymentIntentId: 'pi_123',
			paidAmountCents: null,
			eventLabel: 'checkout.session.completed'
		});

		expect(updateCalls).toBe(1);
	});

	test('factură deja plătită cu ALT PaymentIntent → alertă de dublă încasare', async () => {
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'paid',
				invoiceNumber: '8',
				totalAmount: 90629,
				hostingAccountId: 'acc-1',
				stripePaymentIntentId: 'pi_PRIMUL'
			}
		]);

		await handleStripeInvoicePayment({
			tenantId: 't1',
			invoiceId: 'inv-1',
			paymentIntentId: 'pi_AL_DOILEA',
			paidAmountCents: 90629,
			eventLabel: 'payment_intent.succeeded'
		});

		expect(updateCalls).toBe(0);
		expect(emitted).toHaveLength(0);
		expect(errorLogs.some((m) => m.includes('dublă încasare'))).toBe(true);
	});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd app && bun test src/lib/server/stripe/__tests__/invoice-payment.test.ts`
Expected: 3 dintre teste FAIL (guard-urile nu există încă), restul PASS

- [ ] **Step 3: Implement the guards**

În `app/src/lib/server/stripe/invoice-payment.ts`, înlocuiește blocul idempotent existent (`if (existing.status === 'paid') { ... }`) cu:

```ts
	// Idempotent: a webhook redelivery (or the Checkout + PaymentIntent double-fire
	// for one hosted session) must not re-emit the paid hooks (which advance the
	// due date). Second delivery = no-op.
	if (existing.status === 'paid') {
		// ...dar dacă banii au venit prin ALT PaymentIntent decât cel înregistrat,
		// nu e o redelivery: sunt două plăți reale pe aceeași factură (doi oameni cu
		// același link, în paralel). Nu putem restitui automat — alertăm staff-ul.
		if (
			paymentIntentId &&
			existing.stripePaymentIntentId &&
			existing.stripePaymentIntentId !== paymentIntentId
		) {
			logError(
				'directadmin',
				`${eventLabel}: posibilă dublă încasare pe factura ${existing.invoiceNumber} — necesită refund manual`,
				{
					tenantId,
					metadata: {
						invoiceId,
						recordedPaymentIntentId: existing.stripePaymentIntentId,
						incomingPaymentIntentId: paymentIntentId,
						paidAmountCents
					}
				}
			);
			return;
		}

		logInfo('directadmin', `${eventLabel}: invoice ${existing.invoiceNumber} deja 'paid' — skip idempotent`, {
			tenantId,
			metadata: { invoiceId, paymentIntentId }
		});
		return;
	}

	// Suma încasată trebuie să fie exact totalul facturii. Diverg doar dacă factura
	// a fost editată după crearea PaymentIntent-ului. Marcarea „plătită" pe o sumă
	// greșită ar strica reconcilierea contabilă, deci lăsăm factura neplătită și
	// alertăm — banii sunt deja la Stripe, staff-ul decide (refund sau ajustare).
	if (
		paidAmountCents != null &&
		existing.totalAmount != null &&
		paidAmountCents !== existing.totalAmount
	) {
		logError(
			'directadmin',
			`${eventLabel}: sumă încasată ≠ totalul facturii ${existing.invoiceNumber} — nu marcăm plătită`,
			{
				tenantId,
				metadata: {
					invoiceId,
					paymentIntentId,
					paidAmountCents,
					invoiceTotalCents: existing.totalAmount
				}
			}
		);
		return;
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && bun test src/lib/server/stripe/__tests__/invoice-payment.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/stripe/invoice-payment.ts app/src/lib/server/stripe/__tests__/invoice-payment.test.ts
git commit -m "fix(stripe): guard de sumă + alertă de dublă încasare la plata unei facturi emise"
```

---

## Task 3: Remote public de plată

**Files:**
- Create: `app/src/lib/remotes/public-invoice.remote.ts`
- Test: `app/src/lib/remotes/__tests__/public-invoice.remote.test.ts`

- [ ] **Step 1: Write the failing test**

`app/src/lib/remotes/__tests__/public-invoice.remote.test.ts`:

```ts
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));

// ─── Request context ──────────────────────────────────────────────────────────
mock.module('$app/server', () => ({
	query: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	command: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	getRequestEvent: () => ({
		getClientAddress: () => '10.0.0.1',
		request: { headers: new Headers() }
	})
}));

// ─── DB (doar UPDATE-ul de stripePaymentIntentId trece pe aici) ────────────────
let updateCalls = 0;
function makeUpdateChain(): any {
	const chain: any = {};
	chain.set = () => chain;
	chain.where = () => {
		updateCalls++;
		return Promise.resolve([]);
	};
	return chain;
}
mock.module('$lib/server/db', () => ({ db: { update: () => makeUpdateChain() } }));
await import('$lib/server/db/schema');

// ─── Logger ───────────────────────────────────────────────────────────────────
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({
		message: e instanceof Error ? e.message : String(e),
		stack: ''
	})
}));

// ─── Rate limit ───────────────────────────────────────────────────────────────
let rateLimitAllowed = true;
const rateLimitKinds: string[] = [];
mock.module('$lib/server/redis', () => ({
	rateLimit: async ({ kind }: { kind: string }) => {
		rateLimitKinds.push(kind);
		return { allowed: rateLimitAllowed, count: 1, limit: 10 };
	}
}));

// ─── Token ────────────────────────────────────────────────────────────────────
let tokenResult: any = null;
mock.module('$lib/server/invoice-token', () => ({
	validateInvoiceViewToken: async () => tokenResult
}));

// ─── Stripe ───────────────────────────────────────────────────────────────────
let stripeConfigured = true;
let createdIntents: any[] = [];
let retrievedIntent: any = null;
mock.module('$lib/server/plugins/stripe/factory', () => ({
	isStripeConfiguredForTenant: async () => stripeConfigured,
	getPublishableKeyForTenant: async () => 'pk_test_123',
	getStripeForTenant: async () => ({
		paymentIntents: {
			create: async (params: any) => {
				createdIntents.push(params);
				return { id: 'pi_new', client_secret: 'cs_new', ...params };
			},
			retrieve: async () => {
				if (!retrievedIntent) throw new Error('No such payment_intent');
				return retrievedIntent;
			}
		}
	})
}));

let customerCalls = 0;
mock.module('$lib/server/stripe/customer', () => ({
	getOrCreateStripeCustomer: async () => {
		customerCalls++;
		return 'cus_123';
	}
}));

const { createPublicInvoicePaymentIntent } = await import('../public-invoice.remote');

function validToken(overrides: Record<string, unknown> = {}) {
	return {
		tenant: { id: 't1', slug: 'ots' },
		invoice: {
			id: 'inv-1',
			tenantId: 't1',
			invoiceNumber: '8',
			invoiceSeries: 'OTSH',
			status: 'sent',
			totalAmount: 90629,
			currency: 'RON',
			stripePaymentIntentId: null,
			...overrides
		},
		lineItems: [],
		client: { id: 'c1', tenantId: 't1', name: 'MADDIE', email: 'client@example.com' },
		invoiceSettings: null
	};
}

const INPUT = { tenantSlug: 'ots', token: 'tok_123' };

beforeEach(() => {
	updateCalls = 0;
	rateLimitAllowed = true;
	rateLimitKinds.length = 0;
	tokenResult = validToken();
	stripeConfigured = true;
	createdIntents = [];
	retrievedIntent = null;
	customerCalls = 0;
});

describe('createPublicInvoicePaymentIntent — autorizare', () => {
	test('token invalid → refuz, fără apel la Stripe', async () => {
		tokenResult = null;
		await expect(createPublicInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('token expirat → refuz, fără apel la Stripe', async () => {
		tokenResult = { expired: true };
		await expect(createPublicInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('aplică rate limit pe IP ȘI pe factură', async () => {
		await createPublicInvoicePaymentIntent(INPUT);
		expect(rateLimitKinds).toContain('invoice-pay-ip');
		expect(rateLimitKinds).toContain('invoice-pay-inv');
	});

	test('rate limit depășit → refuz înainte de validarea tokenului', async () => {
		rateLimitAllowed = false;
		await expect(createPublicInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});
});

describe('createPublicInvoicePaymentIntent — eligibilitate', () => {
	test('factură deja plătită → alreadyPaid, fără apel la Stripe', async () => {
		tokenResult = validToken({ status: 'paid' });
		const res = await createPublicInvoicePaymentIntent(INPUT);
		expect(res).toEqual({ alreadyPaid: true });
		expect(createdIntents).toHaveLength(0);
	});

	test('factură anulată → refuz', async () => {
		tokenResult = validToken({ status: 'cancelled' });
		await expect(createPublicInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('sumă sub pragul Stripe → refuz', async () => {
		tokenResult = validToken({ totalAmount: 150 });
		await expect(createPublicInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('Stripe neconfigurat pe tenant → refuz', async () => {
		stripeConfigured = false;
		await expect(createPublicInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});
});

describe('createPublicInvoicePaymentIntent — PaymentIntent', () => {
	test('suma și moneda vin din factură, nu din request', async () => {
		const res = await createPublicInvoicePaymentIntent(INPUT);
		expect(createdIntents[0].amount).toBe(90629);
		expect(createdIntents[0].currency).toBe('ron');
		expect(res).toMatchObject({ alreadyPaid: false, total: 90629, currency: 'RON' });
	});

	test('metadata conține contractul așteptat de webhook', async () => {
		await createPublicInvoicePaymentIntent(INPUT);
		expect(createdIntents[0].metadata).toEqual({
			crmPurpose: 'invoice_payment',
			crmTenantId: 't1',
			crmInvoiceId: 'inv-1'
		});
	});

	test('salvează PaymentIntent-ul pe factură', async () => {
		await createPublicInvoicePaymentIntent(INPUT);
		expect(updateCalls).toBe(1);
	});

	test('client fără email → PaymentIntent fără customer', async () => {
		const t = validToken();
		t.client.email = null as unknown as string;
		tokenResult = t;
		await createPublicInvoicePaymentIntent(INPUT);
		expect(customerCalls).toBe(0);
		expect(createdIntents[0].customer).toBeUndefined();
	});

	test('refolosește un PaymentIntent deschis cu aceeași sumă și monedă', async () => {
		tokenResult = validToken({ stripePaymentIntentId: 'pi_open' });
		retrievedIntent = {
			id: 'pi_open',
			status: 'requires_payment_method',
			amount: 90629,
			currency: 'ron',
			client_secret: 'cs_open'
		};

		const res = await createPublicInvoicePaymentIntent(INPUT);
		expect(createdIntents).toHaveLength(0);
		expect(res).toMatchObject({ clientSecret: 'cs_open' });
		expect(updateCalls).toBe(0);
	});

	test('NU refolosește un PaymentIntent cu altă sumă (factura a fost editată)', async () => {
		tokenResult = validToken({ stripePaymentIntentId: 'pi_old' });
		retrievedIntent = {
			id: 'pi_old',
			status: 'requires_payment_method',
			amount: 50000,
			currency: 'ron',
			client_secret: 'cs_old'
		};

		const res = await createPublicInvoicePaymentIntent(INPUT);
		expect(createdIntents).toHaveLength(1);
		expect(createdIntents[0].amount).toBe(90629);
		expect(res).toMatchObject({ clientSecret: 'cs_new' });
	});

	test('NU refolosește un PaymentIntent deja reușit', async () => {
		tokenResult = validToken({ stripePaymentIntentId: 'pi_done' });
		retrievedIntent = {
			id: 'pi_done',
			status: 'succeeded',
			amount: 90629,
			currency: 'ron',
			client_secret: 'cs_done'
		};

		await createPublicInvoicePaymentIntent(INPUT);
		expect(createdIntents).toHaveLength(1);
	});

	test('PaymentIntent dispărut din Stripe → creează unul nou', async () => {
		tokenResult = validToken({ stripePaymentIntentId: 'pi_gone' });
		retrievedIntent = null; // retrieve aruncă
		await createPublicInvoicePaymentIntent(INPUT);
		expect(createdIntents).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && bun test src/lib/remotes/__tests__/public-invoice.remote.test.ts`
Expected: FAIL — `Cannot find module '../public-invoice.remote'`

- [ ] **Step 3: Write the implementation**

`app/src/lib/remotes/public-invoice.remote.ts`:

```ts
import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import type Stripe from 'stripe';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { validateInvoiceViewToken } from '$lib/server/invoice-token';
import { checkCardPaymentEligibility } from '$lib/server/stripe/invoice-payable';
import {
	isStripeConfiguredForTenant,
	getStripeForTenant,
	getPublishableKeyForTenant
} from '$lib/server/plugins/stripe/factory';
import { getOrCreateStripeCustomer } from '$lib/server/stripe/customer';
import { rateLimit } from '$lib/server/redis';
import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';

/**
 * Plata cu cardul pe pagina PUBLICĂ de factură (`/invoice/{slug}/{token}`).
 *
 * Model de securitate: tokenul din URL e singura autorizare — exact ca la
 * vizualizarea facturii și la PDF. Nu există sesiune sau cookie. Oricine are
 * linkul poate plăti; acceptat conștient, pentru că suma vine mereu din DB,
 * tokenul e 32 de octeți aleatori, iar frauda de card e acoperită de Stripe/3DS.
 *
 * Factura și factura fiscală Keez EXISTĂ deja, deci webhook-ul care primește
 * `metadata.crmPurpose='invoice_payment'` doar marchează factura plătită — fără
 * provisioning DirectAdmin, fără reemitere Keez (ambele ar dubla facturarea).
 * Vezi `src/lib/server/stripe/invoice-payment.ts`.
 */

/** Câte PaymentIntents poate cere un IP într-o oră. */
const PAY_ATTEMPTS_PER_IP_HOUR = 10;
/**
 * Limită per FACTURĂ, indiferent de IP — altfel un atacator distribuit pe multe
 * IP-uri ar putea genera PaymentIntents la nesfârșit pentru aceeași factură.
 */
const PAY_ATTEMPTS_PER_INVOICE_HOUR = 30;
const WINDOW_SEC = 3600;

/**
 * Stări în care un PaymentIntent mai poate fi confirmat. Refolosirea lui e
 * intenționată: două taburi deschise primesc ACELAȘI PaymentIntent, iar Stripe
 * confirmă un PaymentIntent o singură dată → nu se poate încasa de două ori.
 */
const REUSABLE_PI_STATUSES = new Set([
	'requires_payment_method',
	'requires_confirmation',
	'requires_action'
]);

const PayIntentInput = v.object({
	tenantSlug: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	token: v.pipe(v.string(), v.minLength(1), v.maxLength(256))
});

export const createPublicInvoicePaymentIntent = command(
	PayIntentInput,
	async ({ tenantSlug, token }) => {
		const event = getRequestEvent();
		const ip =
			event?.getClientAddress?.() ??
			event?.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
			'unknown';

		const ipRl = await rateLimit({
			kind: 'invoice-pay-ip',
			ip,
			limit: PAY_ATTEMPTS_PER_IP_HOUR,
			windowSec: WINDOW_SEC
		});
		if (!ipRl.allowed) {
			throw error(429, 'Prea multe încercări de plată. Te rugăm să reîncerci peste o oră.');
		}

		const result = await validateInvoiceViewToken(tenantSlug, token);
		// Mesaj identic pentru „inexistent" și „expirat" — nu confirmăm existența
		// unui token unui atacator care ghicește.
		if (!result || 'expired' in result) {
			throw error(400, 'Link invalid sau expirat.');
		}

		const { tenant, invoice, client, invoiceSettings } = result;

		const invoiceRl = await rateLimit({
			kind: 'invoice-pay-inv',
			ip: invoice.id,
			limit: PAY_ATTEMPTS_PER_INVOICE_HOUR,
			windowSec: WINDOW_SEC
		});
		if (!invoiceRl.allowed) {
			throw error(429, 'Prea multe încercări de plată pentru această factură. Reîncearcă mai târziu.');
		}

		const eligibility = checkCardPaymentEligibility(invoice);
		if (!eligibility.eligible) {
			if (eligibility.reason === 'already_paid') return { alreadyPaid: true as const };
			throw error(
				400,
				eligibility.reason === 'amount'
					? 'Suma facturii este prea mică pentru plata cu cardul. Te rugăm să folosești transferul bancar.'
					: 'Această factură nu poate fi plătită cu cardul.'
			);
		}

		if (!(await isStripeConfiguredForTenant(tenant.id))) {
			throw error(503, 'Plata cu cardul nu este disponibilă momentan.');
		}

		const totalCents = invoice.totalAmount as number;
		const currency = invoice.currency ?? 'RON';
		const invoiceLabel = formatInvoiceNumberDisplay(invoice, invoiceSettings);

		try {
			const stripe = await getStripeForTenant(tenant.id);
			const publishableKey = await getPublishableKeyForTenant(tenant.id);
			if (!publishableKey) throw new Error('Configurare Stripe incompletă (lipsește publishable key).');

			let intent: Stripe.PaymentIntent | null = null;

			if (invoice.stripePaymentIntentId) {
				try {
					const existing = await stripe.paymentIntents.retrieve(invoice.stripePaymentIntentId);
					if (
						REUSABLE_PI_STATUSES.has(existing.status) &&
						existing.amount === totalCents &&
						existing.currency === currency.toLowerCase() &&
						existing.client_secret
					) {
						intent = existing;
					}
				} catch (err) {
					// PaymentIntent șters, cheie Stripe rotită, etc. — creăm unul nou.
					logWarning('invoice-view', `PaymentIntent ${invoice.stripePaymentIntentId} nerecuperabil, creăm altul`, {
						tenantId: tenant.id,
						metadata: { invoiceId: invoice.id, error: serializeError(err).message }
					});
				}
			}

			if (!intent) {
				// `getOrCreateStripeCustomer` aruncă dacă lipsește emailul — plata nu
				// depinde de existența unui Customer, deci continuăm fără el.
				let customerId: string | undefined;
				if (client?.email) {
					try {
						customerId = await getOrCreateStripeCustomer(client);
					} catch (err) {
						logWarning('invoice-view', `Nu am putut crea Stripe Customer: ${serializeError(err).message}`, {
							tenantId: tenant.id,
							metadata: { invoiceId: invoice.id, clientId: client.id }
						});
					}
				}

				// `totalAmount` e deja brut (net + TVA), iar factura fiscală există deja
				// → încasăm exact totalul, fără tax rate atașat.
				intent = await stripe.paymentIntents.create({
					amount: totalCents,
					currency: currency.toLowerCase(),
					...(customerId ? { customer: customerId } : {}),
					automatic_payment_methods: { enabled: true },
					metadata: {
						crmPurpose: 'invoice_payment',
						crmTenantId: tenant.id,
						crmInvoiceId: invoice.id
					},
					description: `Factura ${invoiceLabel}`
				});

				await db
					.update(table.invoice)
					.set({ stripePaymentIntentId: intent.id, updatedAt: new Date() })
					.where(and(eq(table.invoice.id, invoice.id), eq(table.invoice.tenantId, tenant.id)));
			}

			if (!intent.client_secret) throw new Error('Stripe nu a returnat clientSecret.');

			logInfo('invoice-view', `PaymentIntent public pentru factura ${invoiceLabel}`, {
				tenantId: tenant.id,
				metadata: { invoiceId: invoice.id, paymentIntentId: intent.id, ip }
			});

			return {
				alreadyPaid: false as const,
				clientSecret: intent.client_secret,
				publishableKey,
				total: totalCents,
				currency,
				invoiceLabel
			};
		} catch (err) {
			const { message } = serializeError(err);
			logError('invoice-view', `PaymentIntent public eșuat pentru factura ${invoice.id}: ${message}`, {
				tenantId: tenant.id,
				metadata: { invoiceId: invoice.id, ip }
			});
			throw error(500, 'Nu am putut iniția plata. Te rugăm să încerci din nou.');
		}
	}
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && bun test src/lib/remotes/__tests__/public-invoice.remote.test.ts`
Expected: PASS — 15 tests

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/remotes/public-invoice.remote.ts app/src/lib/remotes/__tests__/public-invoice.remote.test.ts
git commit -m "feat(invoice): remote public pentru plata unei facturi cu cardul"
```

---

## Task 4: Pagina publică expune `canPayByCard`

**Files:**
- Modify: `app/src/routes/invoice/[tenant]/[token]/+page.server.ts`

- [ ] **Step 1: Add the flag to the load payload**

În `+page.server.ts`, adaugă importurile:

```ts
import { checkCardPaymentEligibility } from '$lib/server/stripe/invoice-payable';
import { isStripeConfiguredForTenant } from '$lib/server/plugins/stripe/factory';
```

După `const displayInvoiceNumber = ...`, adaugă:

```ts
	// Butonul de plată apare doar dacă factura e eligibilă ȘI tenantul are Stripe
	// activ. Aceleași reguli le aplică și remote-ul, ca butonul să nu ducă la eroare.
	const eligibility = checkCardPaymentEligibility(invoice);
	const canPayByCard =
		eligibility.eligible && (await isStripeConfiguredForTenant(tenant.id).catch(() => false));
```

Și în obiectul returnat, la același nivel cu `invoice`, `lineItems`, `tenant`, `client`:

```ts
		canPayByCard,
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd app && NODE_OPTIONS="--max-old-space-size=8192" npx svelte-check --threshold warning 2>&1 | tail -5`
Expected: fără erori noi față de baseline (16 err / 56 warn)

- [ ] **Step 3: Commit**

```bash
git add app/src/routes/invoice/\[tenant\]/\[token\]/+page.server.ts
git commit -m "feat(invoice): pagina publică expune canPayByCard"
```

---

## Task 5: Cardul de plată în pagina publică

**Files:**
- Modify: `app/src/routes/invoice/[tenant]/[token]/+page.svelte`

**Stări definite înainte de markup:** `summary` (buton), `loadingIntent` (buton disabled + text), `card` (PaymentElement), `confirming` (buton disabled), `paid` (mesaj de succes), `alreadyPaid` (mesaj neutru), `error` (bandă roșie deasupra butonului, cu retry). Cardul e `print:hidden` — nu apare la tipărire.

- [ ] **Step 1: Add imports and state**

În blocul `<script lang="ts">`, după importurile existente:

```ts
	import { createPublicInvoicePaymentIntent } from '$lib/remotes/public-invoice.remote';
	import { loadStripe, type Stripe as StripeJS, type StripeElements as StripeElementsT } from '@stripe/stripe-js';
	import { StripeElements } from '$lib/components/Stripe';
	import { PaymentElement } from '$lib/components/Stripe/PaymentElement';
```

După `let downloading = $state(false);`:

```ts
	const canPayByCard = $derived(data.canPayByCard === true);

	type PayStage = 'summary' | 'loadingIntent' | 'card' | 'confirming' | 'paid' | 'alreadyPaid';
	// `?paid=1` = întoarcere din redirectul 3DS; `?pay=1` = venit din buton de email.
	let payStage = $state<PayStage>(page.url.searchParams.get('paid') === '1' ? 'paid' : 'summary');
	let payError = $state<string | null>(null);
	let stripeJs = $state<StripeJS | null>(null);
	let stripeElements = $state<StripeElementsT | null>(null);
	let clientSecret = $state<string | null>(null);

	async function startPayment() {
		payError = null;
		payStage = 'loadingIntent';
		try {
			const res = await createPublicInvoicePaymentIntent({ tenantSlug, token });
			if (res.alreadyPaid) {
				payStage = 'alreadyPaid';
				return;
			}
			clientSecret = res.clientSecret;
			const stripe = await loadStripe(res.publishableKey);
			if (!stripe) throw new Error('Nu s-a putut incarca formularul de plata.');
			stripeJs = stripe;
			payStage = 'card';
		} catch (e) {
			payError = e instanceof Error ? e.message : 'A aparut o eroare. Incercati din nou.';
			payStage = 'summary';
		}
	}

	async function confirmPayment() {
		if (!stripeJs || !stripeElements || !clientSecret) {
			payError = 'Formularul de plata nu este pregatit. Reincarcati pagina.';
			return;
		}
		payError = null;
		payStage = 'confirming';
		try {
			const returnUrl = `${window.location.origin}/invoice/${tenantSlug}/${token}?paid=1`;
			const { error: confirmErr, paymentIntent } = await stripeJs.confirmPayment({
				elements: stripeElements,
				confirmParams: { return_url: returnUrl },
				redirect: 'if_required'
			});
			if (confirmErr) {
				// Al doilea tab care încearcă același PaymentIntent primește o eroare de
				// stare — pentru client asta înseamnă „s-a plătit deja", nu o defecțiune.
				payError =
					confirmErr.code === 'payment_intent_unexpected_state'
						? 'Aceasta factura pare sa fi fost deja platita.'
						: confirmErr.message ||
							'Plata nu a putut fi confirmata. Verificati datele cardului si incercati din nou.';
				payStage = 'card';
				return;
			}
			if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') {
				payStage = 'paid';
				return;
			}
			// requires_action → Stripe redirectează browserul prin return_url.
		} catch (e) {
			payError = e instanceof Error ? e.message : 'A aparut o eroare la confirmarea platii.';
			payStage = 'card';
		}
	}

	$effect(() => {
		// Butonul din email duce direct în formular.
		if (canPayByCard && payStage === 'summary' && page.url.searchParams.get('pay') === '1') {
			startPayment();
		}
	});
```

- [ ] **Step 2: Add the markup**

Între închiderea `</div>` a „Invoice Card" și blocul `<!-- Payment Info -->`, inserează:

```svelte
		<!-- Card payment -->
		{#if canPayByCard || payStage === 'paid' || payStage === 'alreadyPaid'}
			<div class="mt-6 rounded-lg border bg-white p-6 shadow-sm print:hidden">
				{#if payStage === 'paid'}
					<div class="flex items-start gap-3">
						<svg class="mt-0.5 h-6 w-6 shrink-0 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
							<path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path>
							<path d="M22 4L12 14.01l-3-3"></path>
						</svg>
						<div>
							<h3 class="text-base font-semibold text-gray-900">Plata a fost inregistrata</h3>
							<p class="mt-1 text-sm text-gray-600">
								Va multumim! Factura va aparea ca achitata in scurt timp.
							</p>
						</div>
					</div>
				{:else if payStage === 'alreadyPaid'}
					<div>
						<h3 class="text-base font-semibold text-gray-900">Factura este deja achitata</h3>
						<p class="mt-1 text-sm text-gray-600">Nu mai este nimic de plata pentru aceasta factura.</p>
					</div>
				{:else}
					<h3 class="mb-1 text-base font-semibold text-gray-900">Plata cu cardul</h3>
					<p class="mb-4 text-sm text-gray-500">
						Plata securizata prin Stripe. Datele cardului nu ajung pe serverele noastre.
					</p>

					{#if payError}
						<div class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
							{payError}
						</div>
					{/if}

					{#if payStage === 'summary' || payStage === 'loadingIntent'}
						<button
							onclick={startPayment}
							disabled={payStage === 'loadingIntent'}
							class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50 sm:w-auto"
						>
							{#if payStage === 'loadingIntent'}
								<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
									<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25"></circle>
									<path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75"></path>
								</svg>
								Se pregateste plata...
							{:else}
								<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
									<rect x="2" y="5" width="20" height="14" rx="2"></rect>
									<path d="M2 10h20"></path>
								</svg>
								Plateste cu cardul {formatAmount(invoice.totalAmount, invoice.currency as Currency)}
							{/if}
						</button>
					{:else if payStage === 'card' || payStage === 'confirming'}
						<StripeElements bind:elements={stripeElements} stripe={stripeJs} {clientSecret}>
							<PaymentElement />
						</StripeElements>
						<button
							onclick={confirmPayment}
							disabled={payStage === 'confirming'}
							class="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
						>
							{payStage === 'confirming'
								? 'Se proceseaza...'
								: `Confirma plata ${formatAmount(invoice.totalAmount, invoice.currency as Currency)}`}
						</button>
					{/if}
				{/if}
			</div>
		{/if}
```

Și schimbă titlul secțiunii IBAN din `Date plata` în `Sau plata prin transfer bancar` doar când `canPayByCard` e adevărat:

```svelte
				<h3 class="mb-3 text-sm font-medium uppercase text-gray-500">
					{canPayByCard ? 'Sau plata prin transfer bancar' : 'Date plata'}
				</h3>
```

- [ ] **Step 3: Run the autofixer**

Rulează `mcp__svelte__svelte-autofixer` pe conținutul fișierului `+page.svelte` și aplică fixurile raportate. Repetă până iese curat.

- [ ] **Step 4: Verify in the browser**

```bash
cd app && bun run dev
```
Cu **testermcp**: navighează la un link public de factură neplătită, verifică golden path (buton → PaymentElement → card test `4242 4242 4242 4242`), apoi `?pay=1` (deschidere directă) și `?paid=1` (mesaj de succes). Screenshot pentru fiecare stare.

- [ ] **Step 5: Commit**

```bash
git add app/src/routes/invoice/\[tenant\]/\[token\]/+page.svelte
git commit -m "feat(invoice): card de plata cu cardul pe pagina publica de factura"
```

---

## Task 6: Butonul „Plătește cu cardul” în emailuri

**Files:**
- Modify: `app/src/lib/server/email.ts` (`sendInvoiceEmail` ~L1367, reminder restanță ~L2436)

- [ ] **Step 1: Add the helper**

Lângă `renderCtaButton` (L369), adaugă:

```ts
/**
 * Butonul secundar „Vezi factura online" + butonul primar de plată cu cardul.
 * `payUrl` primește `?pay=1`, care deschide direct formularul de card pe pagina
 * publică. Dacă Stripe nu e activ pe tenant, rămâne doar CTA-ul clasic.
 */
export function renderInvoiceCtaBlock(
	invoiceUrl: string,
	themeColor: string,
	canPayByCard: boolean
): string {
	if (!canPayByCard) return renderCtaButton(invoiceUrl, 'Vezi factura online', themeColor);
	return `${renderCtaButton(`${invoiceUrl}?pay=1`, 'Plătește cu cardul', themeColor)}
	<p style="text-align: center; margin: -12px 0 24px 0;">
		<a href="${invoiceUrl}" style="color: #6b7280; font-size: 13px; text-decoration: underline;">Vezi factura online</a>
	</p>`;
}
```

- [ ] **Step 2: Wire it into `sendInvoiceEmail`**

Importă sus în fișier:

```ts
import { isStripeConfiguredForTenant } from '$lib/server/plugins/stripe/factory';
import { checkCardPaymentEligibility } from '$lib/server/stripe/invoice-payable';
```

După `const invoiceUrl = ...` (L1279), adaugă:

```ts
			// Degradare grațioasă: dacă verificarea Stripe aruncă, trimitem emailul
			// fără butonul de card — un email fără buton bate un email netrimis.
			const canPayByCard =
				checkCardPaymentEligibility(invoice).eligible &&
				(await isStripeConfiguredForTenant(invoice.tenantId).catch(() => false));
```

Înlocuiește linia `${renderCtaButton(invoiceUrl, 'Vezi factura online', themeColor)}` (L1367) cu:

```ts
				${renderInvoiceCtaBlock(invoiceUrl, themeColor, canPayByCard)}
```

În versiunea `text:` a aceluiași email, adaugă înainte de linia cu link-ul:

```
			${canPayByCard ? `Plateste cu cardul: ${invoiceUrl}?pay=1\n` : ''}
```

- [ ] **Step 3: Wire it into the overdue reminder**

După `const invoiceUrl = ...` (L2355), adaugă același bloc `canPayByCard`, apoi înlocuiește linia `${renderCtaButton(invoiceUrl, 'Vezi factura online', themeColor)}` (L2436) cu:

```ts
				${renderInvoiceCtaBlock(invoiceUrl, themeColor, canPayByCard)}
```

Și în versiunea text, înainte de link:

```
			${canPayByCard ? `Plateste cu cardul: ${invoiceUrl}?pay=1\n` : ''}
```

- [ ] **Step 4: Preview the emails in a browser**

Regula proiectului: orice schimbare de template cere preview HTML.

```bash
cd app && bun scripts/demo-invoice-email.ts
```

Dacă scriptul nu există, creează-l după modelul celorlalte `scripts/demo-*-email.ts` — trebuie să scrie HTML-ul ambelor emailuri (factură + reminder), în ambele variante (`canPayByCard` true/false), într-un fișier deschis în browser.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/email.ts app/scripts/demo-invoice-email.ts
git commit -m "feat(email): buton „Plateste cu cardul\" in emailurile de factura si reminder"
```

---

## Task 7: Task de reconciliere pentru webhook-uri pierdute

**Files:**
- Create: `app/src/lib/server/scheduler/tasks/stripe-invoice-reconcile.ts`
- Test: `app/src/lib/server/scheduler/tasks/__tests__/stripe-invoice-reconcile.test.ts`
- Modify: `app/src/lib/server/scheduler/index.ts`

**De ce:** Stripe renunță la redelivery după ~72h. Fără reconciliere, o factură plătită real rămâne restantă pentru totdeauna, iar clientul primește remindere pentru bani deja încasați.

- [ ] **Step 1: Write the failing test**

`app/src/lib/server/scheduler/tasks/__tests__/stripe-invoice-reconcile.test.ts`:

```ts
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));

let candidateRows: unknown[] = [];
function makeChain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, {
		from: () => makeChain(rows),
		where: () => makeChain(rows),
		orderBy: () => makeChain(rows),
		limit: () => makeChain(rows)
	});
}
mock.module('$lib/server/db', () => ({ db: { select: () => makeChain(candidateRows) } }));
await import('$lib/server/db/schema');

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e), stack: '' })
}));

let intentsById: Record<string, { id: string; status: string; amount: number }> = {};
mock.module('$lib/server/plugins/stripe/factory', () => ({
	isStripeConfiguredForTenant: async () => true,
	getStripeForTenant: async () => ({
		paymentIntents: {
			retrieve: async (id: string) => {
				const found = intentsById[id];
				if (!found) throw new Error('No such payment_intent');
				return found;
			}
		}
	})
}));

const handledPayments: Array<{ invoiceId: string; paymentIntentId: string | null }> = [];
mock.module('$lib/server/stripe/invoice-payment', () => ({
	handleStripeInvoicePayment: async (p: { invoiceId: string; paymentIntentId: string | null }) => {
		handledPayments.push(p);
	}
}));

const { processStripeInvoiceReconcile } = await import('../stripe-invoice-reconcile');

beforeEach(() => {
	candidateRows = [];
	intentsById = {};
	handledPayments.length = 0;
});

describe('processStripeInvoiceReconcile', () => {
	test('PaymentIntent succeeded pe factură neplătită → o marchează plătită', async () => {
		candidateRows = [
			{ id: 'inv-1', tenantId: 't1', stripePaymentIntentId: 'pi_1', totalAmount: 90629 }
		];
		intentsById = { pi_1: { id: 'pi_1', status: 'succeeded', amount: 90629 } };

		const res = await processStripeInvoiceReconcile();

		expect(handledPayments).toHaveLength(1);
		expect(handledPayments[0]).toMatchObject({ invoiceId: 'inv-1', paymentIntentId: 'pi_1' });
		expect(res.reconciled).toBe(1);
	});

	test('PaymentIntent neplătit → nu atinge factura', async () => {
		candidateRows = [
			{ id: 'inv-1', tenantId: 't1', stripePaymentIntentId: 'pi_1', totalAmount: 90629 }
		];
		intentsById = { pi_1: { id: 'pi_1', status: 'requires_payment_method', amount: 90629 } };

		const res = await processStripeInvoiceReconcile();

		expect(handledPayments).toHaveLength(0);
		expect(res.reconciled).toBe(0);
	});

	test('PaymentIntent dispărut → contorizat ca eroare, nu aruncă', async () => {
		candidateRows = [
			{ id: 'inv-1', tenantId: 't1', stripePaymentIntentId: 'pi_gone', totalAmount: 90629 }
		];

		const res = await processStripeInvoiceReconcile();

		expect(handledPayments).toHaveLength(0);
		expect(res.errors).toBe(1);
		expect(res.success).toBe(true);
	});

	test('o factură eșuată nu oprește restul', async () => {
		candidateRows = [
			{ id: 'inv-1', tenantId: 't1', stripePaymentIntentId: 'pi_gone', totalAmount: 100 },
			{ id: 'inv-2', tenantId: 't1', stripePaymentIntentId: 'pi_2', totalAmount: 90629 }
		];
		intentsById = { pi_2: { id: 'pi_2', status: 'succeeded', amount: 90629 } };

		const res = await processStripeInvoiceReconcile();

		expect(res.reconciled).toBe(1);
		expect(res.errors).toBe(1);
	});

	test('fără candidați → rulare fără apeluri Stripe', async () => {
		const res = await processStripeInvoiceReconcile();
		expect(res).toMatchObject({ success: true, checked: 0, reconciled: 0, errors: 0 });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && bun test src/lib/server/scheduler/tasks/__tests__/stripe-invoice-reconcile.test.ts`
Expected: FAIL — `Cannot find module '../stripe-invoice-reconcile'`

- [ ] **Step 3: Write the implementation**

`app/src/lib/server/scheduler/tasks/stripe-invoice-reconcile.ts`:

```ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, isNotNull, lt, ne } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { getStripeForTenant, isStripeConfiguredForTenant } from '$lib/server/plugins/stripe/factory';
import { handleStripeInvoicePayment } from '$lib/server/stripe/invoice-payment';

/**
 * Plasă de siguranță pentru webhook-uri pierdute definitiv.
 *
 * Stripe renunță la redelivery după ~72h. Dacă evenimentul
 * `payment_intent.succeeded` se pierde, clientul a plătit dar factura rămâne
 * restantă — și primește remindere pentru bani deja încasați.
 *
 * Rulăm zilnic peste facturile care AU un PaymentIntent atașat, nu sunt plătite
 * și n-au mai fost atinse de 24h (fereastră în care webhook-ul normal ar fi
 * trebuit să ajungă), și întrebăm Stripe care e adevărul.
 *
 * Reconcilierea trece prin ACELAȘI `handleStripeInvoicePayment` ca webhook-ul,
 * deci moștenește guard-ul de sumă, idempotența și hook-urile.
 */

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 100;

export async function processStripeInvoiceReconcile(): Promise<{
	success: boolean;
	checked: number;
	reconciled: number;
	errors: number;
}> {
	const cutoff = new Date(Date.now() - STALE_AFTER_MS);

	const candidates = await db
		.select({
			id: table.invoice.id,
			tenantId: table.invoice.tenantId,
			stripePaymentIntentId: table.invoice.stripePaymentIntentId,
			totalAmount: table.invoice.totalAmount
		})
		.from(table.invoice)
		.where(
			and(
				isNotNull(table.invoice.stripePaymentIntentId),
				ne(table.invoice.status, 'paid'),
				lt(table.invoice.updatedAt, cutoff)
			)
		)
		.limit(MAX_PER_RUN);

	let reconciled = 0;
	let errors = 0;

	for (const inv of candidates) {
		try {
			if (!(await isStripeConfiguredForTenant(inv.tenantId))) continue;
			const stripe = await getStripeForTenant(inv.tenantId);
			const intent = await stripe.paymentIntents.retrieve(inv.stripePaymentIntentId!);

			if (intent.status !== 'succeeded') continue;

			await handleStripeInvoicePayment({
				tenantId: inv.tenantId,
				invoiceId: inv.id,
				paymentIntentId: intent.id,
				paidAmountCents: intent.amount ?? null,
				eventLabel: 'reconcile.stripe-invoice'
			});
			reconciled++;

			logInfo('scheduler', `Reconciliere: factura ${inv.id} marcată plătită din Stripe`, {
				tenantId: inv.tenantId,
				metadata: { invoiceId: inv.id, paymentIntentId: intent.id }
			});
		} catch (err) {
			errors++;
			logError('scheduler', `Reconciliere eșuată pentru factura ${inv.id}: ${serializeError(err).message}`, {
				tenantId: inv.tenantId,
				metadata: { invoiceId: inv.id, paymentIntentId: inv.stripePaymentIntentId }
			});
		}
	}

	logInfo('scheduler', 'Stripe invoice reconcile finished', {
		metadata: { checked: candidates.length, reconciled, errors }
	});

	return { success: true, checked: candidates.length, reconciled, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && bun test src/lib/server/scheduler/tasks/__tests__/stripe-invoice-reconcile.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Register the task**

În `app/src/lib/server/scheduler/index.ts`:

1. Lângă import-ul de la L27:
```ts
import { processStripeInvoiceReconcile } from './tasks/stripe-invoice-reconcile';
```

2. În harta de handlere, sub `stripe_event_cleanup: processStripeEventCleanup,` (L188):
```ts
	stripe_invoice_reconcile: processStripeInvoiceReconcile,
```

3. În lista de nume de joburi de la L344, adaugă `'stripe-invoice-reconcile'` lângă `'stripe-event-cleanup'`.

4. După blocul de înregistrare `stripe-event-cleanup` (L762-775):
```ts
	// Stripe invoice reconcile — daily at 3:30 AM
	// Plasă de siguranță pentru webhook-uri pierdute definitiv (Stripe renunță
	// la redelivery după ~72h): factură cu PaymentIntent succeeded dar neplătită.
	await schedulerQueue.add(
		'stripe-invoice-reconcile',
		{
			type: 'stripe_invoice_reconcile',
			params: {}
		},
		{
			repeat: {
				pattern: '30 3 * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'stripe-invoice-reconcile'
		}
	);
```

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/server/scheduler/tasks/stripe-invoice-reconcile.ts app/src/lib/server/scheduler/tasks/__tests__/stripe-invoice-reconcile.test.ts app/src/lib/server/scheduler/index.ts
git commit -m "feat(scheduler): reconciliere zilnica PaymentIntent -> factura platita"
```

---

## Task 8: Verificare finală

- [ ] **Step 1: Full test suite**

Run: `cd app && bun test 2>&1 | tail -20`
Expected: toate testele trec; niciun test existent stricat

- [ ] **Step 2: svelte-check**

Run: `cd app && NODE_OPTIONS="--max-old-space-size=8192" npx svelte-check --threshold warning 2>&1 | tail -10`
Expected: fără regresie față de baseline (16 err / 56 warn)

- [ ] **Step 3: Design audit**

`design-auditor` pe `+page.svelte` (contrast, aria, focus, states, spacing, tokens, responsive) + `web-design-guidelines`. Simulează print în DevTools: cardul de plată trebuie să dispară, factura să rămână lizibilă. Testează overflow cu date lungi (nume de client lung, descriere de linie lungă).

- [ ] **Step 4: Manual end-to-end with Stripe CLI**

```bash
# Terminal 1
cd app && bun run dev
# Terminal 2
stripe listen --forward-to localhost:5173/api/stripe/webhook
```
Plătește o factură de test cu `4242 4242 4242 4242` și verifică: PaymentIntent creat cu metadata corectă → webhook `payment_intent.succeeded` → factura devine `paid` în CRM. Repetă cu `4000 0025 0000 3155` (3DS) pentru fluxul cu redirect.

- [ ] **Step 5: Code review**

superpowers:requesting-code-review pe tot branch-ul. Zona e financiară — cere și un second opinion pe security.

- [ ] **Step 6: Update the graph**

```bash
graphify . --update
```

---

## Self-Review

**Acoperire spec → task:**

| Cerință din spec | Task |
|---|---|
| Helper de eligibilitate partajat | Task 1 |
| Prag minim Stripe pe monedă | Task 1 |
| `partially_paid` exclus | Task 1 (test explicit) |
| Guard de sumă în webhook | Task 2 |
| Alertă de dublă încasare | Task 2 |
| Remote public + validare token | Task 3 |
| Rate limit IP + factură | Task 3 |
| Reuse PaymentIntent | Task 3 |
| Customer opțional fără email | Task 3 |
| Metadata `crmPurpose` | Task 3 |
| `canPayByCard` în load | Task 4 |
| Card UI + stări + `?pay=1` / `?paid=1` | Task 5 |
| `print:hidden` | Task 5 |
| Buton în emailuri + preview | Task 6 |
| Task de reconciliere | Task 7 |
| Teste + build-check + audit | Task 8 |

**Consistență de tipuri:** `checkCardPaymentEligibility` întoarce `{eligible, reason?}` și e consumat identic în Task 3 (remote), Task 4 (load) și Task 6 (email). `handleStripeInvoicePayment` păstrează semnătura existentă — Task 7 o apelează cu aceleași câmpuri ca webhook-ul.

**Fără placeholdere:** fiecare pas conține codul real.
