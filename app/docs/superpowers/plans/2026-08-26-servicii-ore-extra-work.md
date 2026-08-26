# /servicii — Tarife orare cu cumpărare ore (Stripe) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pe pagina publică `/servicii`, tab-ul „Tarife orare" (deja adăugat în bara de filtre) permite cumpărarea efectivă de ore de extra work (Development 65 €/h, Design UI/UX 70 €/h, Project Management 55 €/h, DevOps/API 80 €/h): vizitatorul alege specializarea și numărul de ore (1–100), plătește cu cardul (Stripe PaymentElement embedded), iar post-plată rulează pipeline-ul complet ca la hosting — client creat/legat în CRM, factură fiscală Keez emisă automat, magic link portal, email de confirmare, notificare admini. Comenzile de ore apar în admin la `[tenant]/services`, tab nou.

**Architecture:** Logica pură de preț (net = ore × tarif, validare limite) stă în `$lib/logic/hours-pricing.ts` (client-safe, fără import de catalog). Command-ul public `createHoursOrder` trăiește într-un remote NOU `$lib/remotes/public-hours.remote.ts` (nu în `public-services.remote.ts` — testele acelui fișier ar trebui altfel să mock-uiască tot stack-ul Stripe); garda comună (poartă + rate-limit, aceeași găleată `public-services-request`) se extrage în `$lib/server/public-services-guard.ts` și e refolosită de ambele remote-uri. Webhook-ul `payment_intent.succeeded` capătă branch nou pe `metadata.crmPurpose='hours_purchase'` → `$lib/server/stripe/hours-purchase.ts` (marchează comanda plătită + emitere Keez prin emitter nou + magic link + emailuri, fiecare pas idempotent). Tabel nou `service_hours_order` cu snapshot de tarif/ore/TVA.

**Tech Stack:** SvelteKit 5 (runes), Bun, TypeScript, Drizzle + Turso (libSQL), valibot, Stripe (`@stripe/stripe-js` embedded PaymentElement), Keez auto-push, `bun run test`.

**Context deja făcut pe branch (`feat/servicii-ore-extra-work`):** tab-ul „Tarife orare" în `ServicesCatalog.svelte` cu cardurile statice `sv-rate` — acest plan îl transformă în tab cu cumpărare.

**Reguli de proiect care se aplică:**
- Branch: `feat/servicii-ore-extra-work` (NU main). Teste: `bun run test <filtru>` din `app/`, NICIODATĂ `bun test`.
- Migrații: UN statement per fișier, FĂRĂ `IF NOT EXISTS`, intrare în `drizzle/meta/_journal.json`; grep numele înainte (dublete); aplică migrația pe Turso ÎNAINTE de a adăuga tabelul în `schema.ts` (DB dev = DB prod; `db.select()` pe coloane inexistente = crash).
- Fișierele client din `src/routes/servicii/**` NU importă valori din `$lib/constants/ots-catalog` (doar `import type`) — testul `no-price-leak.test.ts` pică altfel. Tarifele vin prin `load` → props.
- `metadata.crmPurpose` NOU (`hours_purchase`) — NU refolosi handler-ul de order hosting (dublează provisioning) și NU `invoice_payment` (acela doar marchează facturi existente).
- Stripe webhook verify e deja `constructEventAsync` — nu atinge ruta webhook decât pentru dispatch.
- Sume în CENȚI peste tot (`invoice.amount`, `invoice_line_item.rate` ×100, `taxRate` în bps ex. 2100).
- Comentarii în cod: română, explică „de ce".
- Emailuri: refolosim template-urile existente (invoice-paid, magic link, admin payment) — nu se creează template nou, deci nu e nevoie de script demo nou.

---

## File structure

| Fișier | Responsabilitate |
|---|---|
| `app/drizzle/0492_service_hours_order.sql` (create) | CREATE TABLE `service_hours_order` |
| `app/drizzle/0493_service_hours_order_tenant_status_idx.sql` (create) | index (tenant_id, status) |
| `app/drizzle/0494_service_hours_order_pi_idx.sql` (create) | index stripe_payment_intent_id |
| `app/drizzle/meta/_journal.json` (modify) | intrările 492–494 |
| `app/src/lib/server/db/schema.ts` (modify, după `servicePackageRequest`) | tabelul + tipurile |
| `app/src/lib/constants/ots-catalog.ts` (modify, `HOURLY_RATES`) | câmp `slug` per tarif + `getHourlyRate()` |
| `app/src/lib/logic/hours-pricing.ts` (create) | pur: limite ore, net în cenți, validare |
| `app/src/lib/logic/__tests__/hours-pricing.test.ts` (create) | |
| `app/src/lib/server/public-services-guard.ts` (create) | garda poartă+rate-limit extrasă din public-services.remote |
| `app/src/lib/remotes/public-services.remote.ts` (modify) | folosește garda extrasă (șterge copia locală) |
| `app/src/lib/remotes/public-hours.remote.ts` (create) | `createHoursOrder` (client find-or-create + PI Stripe) |
| `app/src/lib/remotes/__tests__/public-hours.remote.test.ts` (create) | |
| `app/src/lib/server/stripe/post-payment/emit-keez-hours-invoice.ts` (create) | factură CRM+Keez pentru ore (idempotent pe PI) |
| `app/src/lib/server/stripe/hours-purchase.ts` (create) | handler succeeded/failed pentru `crmPurpose='hours_purchase'` |
| `app/src/lib/server/stripe/__tests__/hours-purchase.test.ts` (create) | |
| `app/src/lib/server/stripe/webhook-handlers.ts` (modify) | branch `hours_purchase` în PI succeeded/failed |
| `app/src/routes/servicii/catalog.server.ts` (modify) | `buildPublicCatalog` async + `vatPercent` în catalog |
| `app/src/routes/servicii/+page.server.ts` + `configurator/+page.server.ts` (modify) | `await buildPublicCatalog(...)` |
| `app/src/routes/servicii/types.ts` (modify) | `hourlyRates` cu `slug`, `vatPercent` |
| `app/src/routes/servicii/ServicesCatalog.svelte` (modify) | tab Tarife: stepper ore + total + „Cumpără orele" + montare modal |
| `app/src/routes/servicii/HoursCheckoutModal.svelte` (create) | modal 3 pași: date facturare → plată Stripe → succes |
| `app/src/lib/remotes/packages.remote.ts` (modify) | `getHoursOrders` (staff) |
| `app/src/routes/[tenant]/services/HoursOrdersPanel.svelte` (create) | listă comenzi ore în admin |
| `app/src/routes/[tenant]/services/+page.svelte` (modify) | tab nou „Ore extra work" |
| `app/docs/stripe-module.md` (modify) | secțiune scurtă „Cumpărare ore /servicii" |

---

### Task 1: Migrații — tabelul `service_hours_order`

**Files:**
- Create: `app/drizzle/0492_service_hours_order.sql`
- Create: `app/drizzle/0493_service_hours_order_tenant_status_idx.sql`
- Create: `app/drizzle/0494_service_hours_order_pi_idx.sql`
- Modify: `app/drizzle/meta/_journal.json` (după intrarea 491)
- Modify (DOAR după aplicare): `app/src/lib/server/db/schema.ts` (după `servicePackageRequest`, ~linia 2358)

- [ ] **Step 1: Grep anti-dublete**

Run: `grep -rl "service_hours_order" app/drizzle/ | cat`
Expected: niciun rezultat (tabel nou).

- [ ] **Step 2: Creează fișierele SQL (un statement per fișier, fără IF NOT EXISTS)**

`app/drizzle/0492_service_hours_order.sql`:
```sql
CREATE TABLE `service_hours_order` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text,
	`rate_slug` text NOT NULL,
	`rate_label` text NOT NULL,
	`rate_eur` integer NOT NULL,
	`hours` integer NOT NULL,
	`net_cents` integer NOT NULL,
	`vat_cents` integer NOT NULL,
	`gross_cents` integer NOT NULL,
	`vat_percent` integer NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`billing_type` text DEFAULT 'company' NOT NULL,
	`contact_name` text NOT NULL,
	`contact_email` text NOT NULL,
	`contact_phone` text,
	`company_name` text,
	`cui` text,
	`note` text,
	`status` text DEFAULT 'pending_payment' NOT NULL,
	`stripe_payment_intent_id` text,
	`invoice_id` text,
	`ip_address` text,
	`user_agent` text,
	`paid_at` timestamp,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action
);
```

> Stilul `timestamp DEFAULT current_timestamp` e cel al ultimelor CREATE TABLE-uri din repo (0473, 0476, 0485) — verificat.

`app/drizzle/0493_service_hours_order_tenant_status_idx.sql`:
```sql
CREATE INDEX `service_hours_order_tenant_status_idx` ON `service_hours_order` (`tenant_id`,`status`);
```

`app/drizzle/0494_service_hours_order_pi_idx.sql`:
```sql
CREATE INDEX `service_hours_order_pi_idx` ON `service_hours_order` (`stripe_payment_intent_id`);
```

- [ ] **Step 3: Journal**

În `app/drizzle/meta/_journal.json`, după intrarea `0491_whatsapp_session_heartbeat_owner`, adaugă (păstrează `when` crescător — folosește timestampuri consecutive, ex. +1):
```json
{ "idx": 492, "version": "6", "when": <max_when+1>, "tag": "0492_service_hours_order", "breakpoints": true },
{ "idx": 493, "version": "6", "when": <max_when+2>, "tag": "0493_service_hours_order_tenant_status_idx", "breakpoints": true },
{ "idx": 494, "version": "6", "when": <max_when+3>, "tag": "0494_service_hours_order_pi_idx", "breakpoints": true }
```

ÎNAINTE de aplicare, verifică pe remote că nu sunt migrări sărite: `max(created_at)` din `__drizzle_migrations` trebuie să corespundă cu 0491 (vezi memoria „Jurnal drizzle when sub remote").

- [ ] **Step 4: Aplică migrația pe Turso**

Run (din `app/`): `bun run db:migrate`
Expected: 3 migrații aplicate, fără erori.
Verifică pe remote: `SELECT name FROM sqlite_master WHERE name LIKE 'service_hours%';` → tabelul + 2 indexuri.

- [ ] **Step 5: Adaugă tabelul în `schema.ts` (DUPĂ aplicare)**

În `app/src/lib/server/db/schema.ts`, imediat după blocul `servicePackageRequest` (~linia 2358):
```ts
// Comandă de ore de extra work cumpărate cu cardul de pe pagina publică /servicii.
// Snapshot complet de preț (tarif, ore, TVA) — tarifele din catalog se pot schimba,
// comanda trebuie să arate ce a plătit clientul. `status`:
// 'pending_payment' → creat, PaymentIntent emis, plata neconfirmată încă
// 'paid'            → webhook payment_intent.succeeded confirmat; invoice_id populat
// 'failed'          → payment_intent.payment_failed
export const serviceHoursOrder = sqliteTable('service_hours_order', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id').references(() => client.id),
	rateSlug: text('rate_slug').notNull(),
	rateLabel: text('rate_label').notNull(),
	rateEur: integer('rate_eur').notNull(),
	hours: integer('hours').notNull(),
	netCents: integer('net_cents').notNull(),
	vatCents: integer('vat_cents').notNull(),
	grossCents: integer('gross_cents').notNull(),
	vatPercent: integer('vat_percent').notNull(),
	currency: text('currency').notNull().default('EUR'),
	billingType: text('billing_type').notNull().default('company'), // 'company' | 'person'
	contactName: text('contact_name').notNull(),
	contactEmail: text('contact_email').notNull(),
	contactPhone: text('contact_phone'),
	companyName: text('company_name'),
	cui: text('cui'),
	note: text('note'),
	status: text('status').notNull().default('pending_payment'),
	stripePaymentIntentId: text('stripe_payment_intent_id'),
	invoiceId: text('invoice_id').references(() => invoice.id),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`)
});
```
și la secțiunea de tipuri (lângă `ServicePackageRequest`, ~linia 4505):
```ts
export type ServiceHoursOrder = typeof serviceHoursOrder.$inferSelect;
export type NewServiceHoursOrder = typeof serviceHoursOrder.$inferInsert;
```

- [ ] **Step 6: Commit**
```bash
git add app/drizzle/0492* app/drizzle/0493* app/drizzle/0494* app/drizzle/meta/_journal.json app/src/lib/server/db/schema.ts
git commit -m "feat(servicii): tabel service_hours_order pentru cumpărarea orelor de extra work"
```

---

### Task 2: Constante — slug pe `HOURLY_RATES` + `vatPercent` în catalogul public

**Files:**
- Modify: `app/src/lib/constants/ots-catalog.ts` (`HOURLY_RATES`, ~linia 658)
- Modify: `app/src/routes/servicii/types.ts`
- Modify: `app/src/routes/servicii/catalog.server.ts`
- Modify: `app/src/routes/servicii/+page.server.ts`, `app/src/routes/servicii/configurator/+page.server.ts`

- [ ] **Step 1: Slug stabil per specializare**

În `ots-catalog.ts`, înlocuiește definiția `HOURLY_RATES` (păstrează comentariul istoric de deasupra):
```ts
export type HourlyRateSlug = 'development' | 'design-ui-ux' | 'project-management' | 'devops-api';

export interface HourlyRate {
	/** Identificator stabil — ajunge în DB și în metadata Stripe; nu-l redenumi. */
	slug: HourlyRateSlug;
	label: string;
	/** EUR întregi pe oră, fără TVA. */
	rate: number;
}

export const HOURLY_RATES: HourlyRate[] = [
	{ slug: 'development', label: 'Development', rate: 65 },
	{ slug: 'design-ui-ux', label: 'Design UI/UX', rate: 70 },
	{ slug: 'project-management', label: 'Project Management', rate: 55 },
	{ slug: 'devops-api', label: 'DevOps / API', rate: 80 }
];

export function getHourlyRate(slug: string): HourlyRate | undefined {
	return HOURLY_RATES.find((r) => r.slug === slug);
}
```
`PackageComparisonView.svelte` iterează `rate.label`/`rate.rate` — compatibil, nu-l atinge.

- [ ] **Step 2: Catalogul public capătă `vatPercent`**

`app/src/routes/servicii/types.ts` — schimbă tipul:
```ts
	hourlyRates: { slug: string; label: string; rate: number }[];
	/** Cota TVA a tenantului (%, întreg) — pentru totalul afișat la cumpărarea orelor. */
	vatPercent: number;
```

`app/src/routes/servicii/catalog.server.ts` — `buildPublicCatalog` devine async și primește tenantId:
```ts
import { resolveVatPercent } from '$lib/server/vat/rate';

export async function buildPublicCatalog(tenantId: string): Promise<PublicCatalog> {
	const [settings] = await db
		.select({ defaultTaxRate: table.invoiceSettings.defaultTaxRate })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);
	return {
		// ...câmpurile existente neschimbate...
		vatPercent: resolveVatPercent(settings?.defaultTaxRate)
	};
}
```
Actualizează cei doi apelanți (`+page.server.ts` din `servicii/` și `servicii/configurator/`) la `await buildPublicCatalog(tenantId)` — tenantId există deja în ambele (e folosit la `loadPublicCompany`).

- [ ] **Step 3: Verifică testul anti-scurgere de prețuri**

Run: `bun run test no-price-leak servicii`
Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add app/src/lib/constants/ots-catalog.ts app/src/routes/servicii/types.ts app/src/routes/servicii/catalog.server.ts app/src/routes/servicii/+page.server.ts app/src/routes/servicii/configurator/+page.server.ts
git commit -m "feat(servicii): slug pe tarifele orare + cota TVA în catalogul public"
```

---

### Task 3: Logica pură de preț ore — TDD

**Files:**
- Create: `app/src/lib/logic/hours-pricing.ts`
- Create: `app/src/lib/logic/__tests__/hours-pricing.test.ts`

- [ ] **Step 1: Testul (întâi)**

`app/src/lib/logic/__tests__/hours-pricing.test.ts`:
```ts
import { describe, test, expect } from 'bun:test';
import { HOURS_MIN, HOURS_MAX, isValidHours, hoursNetCents } from '../hours-pricing';

describe('isValidHours', () => {
	test('acceptă limitele și întregii din interval', () => {
		expect(isValidHours(HOURS_MIN)).toBe(true);
		expect(isValidHours(50)).toBe(true);
		expect(isValidHours(HOURS_MAX)).toBe(true);
	});
	test('respinge 0, negative, peste max, fracții și non-numere', () => {
		expect(isValidHours(0)).toBe(false);
		expect(isValidHours(-3)).toBe(false);
		expect(isValidHours(HOURS_MAX + 1)).toBe(false);
		expect(isValidHours(2.5)).toBe(false);
		expect(isValidHours(NaN)).toBe(false);
	});
});

describe('hoursNetCents', () => {
	test('net = ore × tarif × 100 (EUR → cenți)', () => {
		expect(hoursNetCents(65, 1)).toBe(6500);
		expect(hoursNetCents(65, 10)).toBe(65000);
		expect(hoursNetCents(80, 7)).toBe(56000);
	});
	test('aruncă pe ore invalide sau tarif nepozitiv', () => {
		expect(() => hoursNetCents(65, 0)).toThrow();
		expect(() => hoursNetCents(0, 5)).toThrow();
		expect(() => hoursNetCents(65, 2.5)).toThrow();
	});
});
```

- [ ] **Step 2: Rulează, verifică FAIL**

Run: `bun run test hours-pricing`
Expected: FAIL (modulul nu există).

- [ ] **Step 3: Implementarea**

`app/src/lib/logic/hours-pricing.ts`:
```ts
/**
 * Prețul orelor de extra work de pe /servicii — modul PUR, client-safe.
 *
 * Fără import din `ots-catalog` (tarifele ajung în browser doar prin `load`,
 * după parolă); limitele stau AICI ca server-ul (`createHoursOrder`) și
 * modalul public să valideze identic, fără drift.
 */

export const HOURS_MIN = 1;
export const HOURS_MAX = 100;

export function isValidHours(hours: number): boolean {
	return Number.isInteger(hours) && hours >= HOURS_MIN && hours <= HOURS_MAX;
}

/** Net în cenți EUR: ore × tarif(EUR întregi) × 100. Aruncă pe input invalid. */
export function hoursNetCents(rateEur: number, hours: number): number {
	if (!isValidHours(hours)) throw new Error(`Număr de ore invalid: ${hours}`);
	if (!Number.isInteger(rateEur) || rateEur <= 0) throw new Error(`Tarif invalid: ${rateEur}`);
	return rateEur * hours * 100;
}
```

- [ ] **Step 4: Verifică PASS + commit**

Run: `bun run test hours-pricing` → PASS.
```bash
git add app/src/lib/logic/hours-pricing.ts app/src/lib/logic/__tests__/hours-pricing.test.ts
git commit -m "feat(servicii): logică pură pentru prețul orelor de extra work"
```

---

### Task 4: Garda publică extrasă în modul server partajat

**Files:**
- Create: `app/src/lib/server/public-services-guard.ts`
- Modify: `app/src/lib/remotes/public-services.remote.ts` (șterge `guardPublicSubmission` local + `SUBMIT_LIMIT`, importă versiunea partajată)

- [ ] **Step 1: Modulul nou**

`app/src/lib/server/public-services-guard.ts`:
```ts
/**
 * Garda formularelor publice de pe /servicii: poarta cu parolă + rate-limit
 * per IP. TOATE command-urile publice ale paginii (cerere ofertă, cumpărare
 * ore) împart aceeași găleată `public-services-request` — altfel un vizitator
 * și-ar dubla limita alternând formularele.
 *
 * Extrasă din `public-services.remote.ts` ca s-o poată folosi și
 * `public-hours.remote.ts` fără ca testele unuia să tragă dependențele
 * celuilalt.
 */
import { error, type RequestEvent } from '@sveltejs/kit';
import {
	PUBLIC_SERVICES_PAGE_KEY,
	requireUnlockedPublicPage
} from '$lib/server/public-page-access';
import { rateLimit } from '$lib/server/redis';
import { logWarning } from '$lib/server/logger';

const SUBMIT_LIMIT = { limit: 8, windowSec: 60 * 60 };

export async function guardPublicServicesSubmission(
	event: RequestEvent
): Promise<{ tenantId: string; ip: string }> {
	const gate = await requireUnlockedPublicPage(event, PUBLIC_SERVICES_PAGE_KEY);
	if (!gate) {
		throw error(403, 'Sesiunea a expirat. Reîncarcă pagina și introdu parola din nou.');
	}

	const ip =
		event.getClientAddress?.() ??
		event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		'unknown';

	const rl = await rateLimit({
		kind: 'public-services-request',
		ip,
		limit: SUBMIT_LIMIT.limit,
		windowSec: SUBMIT_LIMIT.windowSec
	});
	if (!rl.allowed) {
		logWarning('packages', 'cerere publică /servicii rate-limited', {
			tenantId: gate.tenantId,
			metadata: { ip, count: rl.count }
		});
		throw error(429, 'Prea multe cereri trimise. Te rugăm să încerci din nou peste o oră.');
	}

	return { tenantId: gate.tenantId, ip };
}
```

- [ ] **Step 2: Refactor `public-services.remote.ts`**

Șterge funcția locală `guardPublicSubmission` + constanta `SUBMIT_LIMIT` + importurile devenite nefolosite (`requireUnlockedPublicPage`, `PUBLIC_SERVICES_PAGE_KEY`, `rateLimit`, `logWarning`, `RequestEvent` — verifică fiecare înainte de ștergere) și înlocuiește apelurile:
```ts
import { guardPublicServicesSubmission } from '$lib/server/public-services-guard';
// în ambele command-uri:
const { tenantId } = await guardPublicServicesSubmission(event);
```

- [ ] **Step 3: Testele existente + noul mock**

Testele din `public-services.remote.test.ts` mock-uiesc `$lib/server/public-page-access` și `$lib/server/redis` — modulele pe care garda le folosește în continuare, deci ar trebui să treacă nemodificate. Rulează:

Run: `bun run test public-services`
Expected: PASS (toate cazurile existente).

- [ ] **Step 4: Commit**
```bash
git add app/src/lib/server/public-services-guard.ts app/src/lib/remotes/public-services.remote.ts
git commit -m "refactor(servicii): garda formularelor publice extrasă în modul partajat"
```

---

### Task 5: `createHoursOrder` — remote public nou, TDD

**Files:**
- Create: `app/src/lib/remotes/public-hours.remote.ts`
- Create: `app/src/lib/remotes/__tests__/public-hours.remote.test.ts`

- [ ] **Step 1: Testul (întâi)** — mock-uri pe modelul `public-services.remote.test.ts`, plus Stripe:

`app/src/lib/remotes/__tests__/public-hours.remote.test.ts`:
```ts
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));

mock.module('$app/server', () => ({
	query: (s: any, f?: Function) => f ?? s,
	command: (s: any, f?: Function) => f ?? s,
	getRequestEvent: () => ({
		getClientAddress: () => '10.0.0.7',
		request: { headers: new Headers() }
	})
}));

// ─── Garda partajată ─────────────────────────────────────────────────────────
let guardResult: { tenantId: string; ip: string } | null = { tenantId: 't1', ip: '10.0.0.7' };
mock.module('$lib/server/public-services-guard', () => ({
	guardPublicServicesSubmission: async () => {
		if (!guardResult) throw new Error('403');
		return guardResult;
	}
}));

// ─── DB minimal: select (client + settings) / insert / update ────────────────
let existingClients: any[] = [];
let insertedRows: Array<{ table: string; row: any }> = [];
let updatedRows: any[] = [];
let settingsRow: { defaultTaxRate: number } | null = { defaultTaxRate: 21 };
mock.module('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: (tbl: any) => ({
				where: () => ({
					limit: async () => {
						// distincția pe tabel: invoice_settings vs client
						if (tbl === require('$lib/server/db/schema').invoiceSettings)
							return settingsRow ? [settingsRow] : [];
						return existingClients.slice(0, 1);
					}
				})
			})
		}),
		insert: (tbl: any) => ({
			values: (row: any) => {
				insertedRows.push({ table: tbl?._?.name ?? 'unknown', row });
				return { returning: async () => [row] };
			}
		}),
		update: () => ({
			set: (row: any) => ({ where: async () => updatedRows.push(row) })
		})
	}
}));
await import('$lib/server/db/schema');

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({
		message: e instanceof Error ? e.message : String(e),
		stack: ''
	})
}));

mock.module('$lib/server/plugins/keez/db-retry', () => ({
	withTursoBusyRetry: (fn: Function) => fn()
}));

// ─── Stripe ──────────────────────────────────────────────────────────────────
const createdIntents: any[] = [];
let stripeConfigured = true;
mock.module('$lib/server/plugins/stripe/factory', () => ({
	isStripeConfiguredForTenant: async () => stripeConfigured,
	isStripeDevTestMode: () => true, // sare peste crearea Customer (ca pe localhost)
	getPublishableKeyForTenant: async () => 'pk_test_x',
	getStripeForTenant: async () => ({
		paymentIntents: {
			create: async (args: any) => {
				createdIntents.push(args);
				return { id: 'pi_test_1', client_secret: 'pi_test_1_secret' };
			}
		}
	})
}));
mock.module('$lib/server/stripe/customer', () => ({
	getOrCreateStripeCustomer: async () => 'cus_test_1'
}));
mock.module('$lib/server/cui-validator', () => ({
	validateCuiOrReason: (cui: string) => (cui && /^\d{2,10}$/.test(cui) ? null : 'CUI invalid'),
	normalizeCui: (cui: string) => cui.replace(/\D/g, '')
}));

const { createHoursOrder } = await import('../public-hours.remote');

const INPUT = {
	rateSlug: 'development',
	hours: 10,
	billingType: 'company' as const,
	contactName: 'Ion Popescu',
	contactEmail: 'Ion@Example.com',
	contactPhone: '0722 123 456',
	companyName: 'Example SRL',
	cui: '12345678',
	vatPayer: true,
	note: ''
};

beforeEach(() => {
	guardResult = { tenantId: 't1', ip: '10.0.0.7' };
	existingClients = [];
	insertedRows = [];
	updatedRows = [];
	createdIntents.length = 0;
	stripeConfigured = true;
	settingsRow = { defaultTaxRate: 21 };
});

describe('createHoursOrder', () => {
	test('happy path: comanda salvată cu snapshot corect + PI pe brut', async () => {
		const res = await createHoursOrder(INPUT);
		expect(res.clientSecret).toBe('pi_test_1_secret');
		const order = insertedRows.find((r) => r.row.rateSlug === 'development')!.row;
		expect(order.netCents).toBe(65000); // 10h × 65€
		expect(order.vatCents).toBe(13650); // 21%
		expect(order.grossCents).toBe(78650);
		expect(order.status).toBe('pending_payment');
		expect(order.contactEmail).toBe('ion@example.com');
		const client = insertedRows.find((r) => r.row.legalType)!.row;
		expect(client.vatNumber).toBe('RO12345678');
		const pi = createdIntents[0];
		expect(pi.amount).toBe(78650);
		expect(pi.currency).toBe('eur');
		expect(pi.metadata.crmPurpose).toBe('hours_purchase');
		expect(pi.metadata.crmHoursOrderId).toBe(order.id);
	});

	test('slug necunoscut → 400', async () => {
		await expect(createHoursOrder({ ...INPUT, rateSlug: 'marketing' })).rejects.toThrow();
	});

	test('ore în afara limitelor → respins de schema', async () => {
		await expect(createHoursOrder({ ...INPUT, hours: 0 })).rejects.toThrow();
		await expect(createHoursOrder({ ...INPUT, hours: 101 })).rejects.toThrow();
	});

	test('firmă fără CUI valid → 400', async () => {
		await expect(createHoursOrder({ ...INPUT, cui: 'abc' })).rejects.toThrow();
	});

	test('PF fără nume complet → 400', async () => {
		await expect(
			createHoursOrder({ ...INPUT, billingType: 'person', contactName: 'X', cui: undefined, companyName: undefined })
		).rejects.toThrow();
	});

	test('client existent (CUI) → comanda se leagă de el, fără insert de client nou', async () => {
		existingClients = [{ id: 'client-9', tenantId: 't1', email: 'x@y.z', name: 'Example SRL' }];
		await createHoursOrder(INPUT);
		expect(insertedRows.some((r) => r.row.legalType)).toBe(false); // niciun client inserat
		const order = insertedRows.find((r) => r.row.rateSlug)!.row;
		expect(order.clientId).toBe('client-9');
	});

	test('Stripe neconfigurat → 503', async () => {
		stripeConfigured = false;
		await expect(createHoursOrder(INPUT)).rejects.toThrow();
	});
});
```
> Mock-ul de `db.select` distinge tabelul prin referință; dacă `require` în mock dă bătăi de cap în Bun, simplifică: ordinea apelurilor e determinstă (settings se citește o dată, clientul o dată) — folosește un contor. Adaptezi la implementare, ideea rămâne: settings → 21%, client lookup → `existingClients`.

- [ ] **Step 2: Rulează, verifică FAIL**

Run: `bun run test public-hours`
Expected: FAIL (modulul nu există).

- [ ] **Step 3: Implementarea**

`app/src/lib/remotes/public-hours.remote.ts`:
```ts
/**
 * Cumpărarea orelor de extra work de pe pagina publică `/servicii` (tab
 * „Tarife orare"). Fluxul oglindește comanda de hosting (`submitHostingOrder`),
 * dar plătește un număr de ore dintr-o specializare, nu un produs:
 *
 *  - aceeași gardă ca celelalte formulare /servicii (poartă + rate-limit comun);
 *  - clientul se creează/leagă cu aceeași politică anti-enumeration ca la
 *    hosting (CUI la firme, email la PF; UNIQUE race recovery);
 *  - suma = ore × tarif din CATALOG (nu din payload) + TVA tenant → PaymentIntent
 *    EUR cu `metadata.crmPurpose='hours_purchase'` — contractul cu webhook-ul
 *    care emite factura Keez și trimite emailurile DOAR pentru acest flux.
 */
import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { and, eq, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { getHourlyRate } from '$lib/constants/ots-catalog';
import { HOURS_MIN, HOURS_MAX, hoursNetCents } from '$lib/logic/hours-pricing';
import { computeVatBreakdown } from '$lib/utils/vat';
import { resolveVatPercent } from '$lib/server/vat/rate';
import { guardPublicServicesSubmission } from '$lib/server/public-services-guard';
import { normalizeCui, validateCuiOrReason } from '$lib/server/cui-validator';
import {
	getPublishableKeyForTenant,
	getStripeForTenant,
	isStripeConfiguredForTenant,
	isStripeDevTestMode
} from '$lib/server/plugins/stripe/factory';
import { getOrCreateStripeCustomer } from '$lib/server/stripe/customer';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { logError, logInfo, serializeError } from '$lib/server/logger';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

const hoursOrderSchema = v.object({
	rateSlug: v.pipe(v.string(), v.minLength(1), v.maxLength(40)),
	hours: v.pipe(v.number(), v.integer(), v.minValue(HOURS_MIN), v.maxValue(HOURS_MAX)),
	billingType: v.optional(v.picklist(['company', 'person']), 'company'),
	contactName: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(120)),
	contactEmail: v.pipe(v.string(), v.trim(), v.maxLength(255), v.regex(EMAIL_REGEX)),
	contactPhone: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40))),
	companyName: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(160))),
	cui: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(12))),
	/** Din ANAF (autocomplete în modal); decide `RO`-prefixul pe vatNumber, ca la hosting. */
	vatPayer: v.optional(v.boolean(), false),
	note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000)))
});

export const createHoursOrder = command(hoursOrderSchema, async (data) => {
	const event = getRequestEvent();
	const { tenantId, ip } = await guardPublicServicesSubmission(event);
	const userAgent = event?.request?.headers.get('user-agent') ?? null;

	if (!(await isStripeConfiguredForTenant(tenantId))) {
		throw error(503, 'Plățile online nu sunt disponibile momentan. Scrie-ne și rezolvăm direct.');
	}

	// Tariful vine din catalog, NU din payload — clientul nu-și alege prețul.
	const rate = getHourlyRate(data.rateSlug);
	if (!rate) throw error(400, 'Specializarea selectată nu există.');

	const normalizedEmail = data.contactEmail.toLowerCase();
	const billingType = data.billingType ?? 'company';

	// TVA-ul tenantului — aceeași sursă ca emailul + factura Keez (audit C1:
	// Stripe încasează BRUT, exact totalul afișat și facturat).
	const [settings] = await db
		.select({ defaultTaxRate: table.invoiceSettings.defaultTaxRate })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);
	const vatPercent = resolveVatPercent(settings?.defaultTaxRate);
	const netCents = hoursNetCents(rate.rate, data.hours);
	const { vatCents, grossCents } = computeVatBreakdown(netCents, vatPercent);

	// ── Client: find-or-create, anti-enumeration (ca la hosting) ─────────────
	let clientRow: typeof table.client.$inferSelect | null = null;
	let cleanCui: string | null = null;

	if (billingType === 'company') {
		const reason = validateCuiOrReason(data.cui ?? '');
		if (reason) throw error(400, reason);
		cleanCui = normalizeCui(data.cui!);
		if (!data.companyName?.trim())
			throw error(400, 'Denumirea firmei este obligatorie pentru facturare pe firmă.');

		const [existing] = await db
			.select()
			.from(table.client)
			.where(
				and(
					eq(table.client.tenantId, tenantId),
					or(
						eq(table.client.cui, cleanCui),
						eq(table.client.vatNumber, `RO${cleanCui}`),
						eq(table.client.vatNumber, cleanCui)
					)
				)
			)
			.limit(1);
		if (existing) clientRow = existing;
	} else {
		// PF: identitatea e emailul. Nume + prenume vin într-un singur câmp
		// contactName — cerem minim două cuvinte.
		if (data.contactName.trim().split(/\s+/).length < 2)
			throw error(400, 'Te rugăm să completezi numele și prenumele.');
		const [existing] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.tenantId, tenantId), eq(table.client.email, normalizedEmail)))
			.limit(1);
		if (existing) clientRow = existing;
	}

	if (!clientRow) {
		const newClientId = generateId();
		const values = {
			id: newClientId,
			tenantId,
			name: billingType === 'company' ? data.companyName!.trim() : data.contactName.trim(),
			businessName: billingType === 'company' ? data.companyName!.trim() : null,
			email: normalizedEmail,
			phone: data.contactPhone || null,
			status: 'prospect' as const,
			cui: cleanCui,
			vatNumber: cleanCui ? (data.vatPayer ? `RO${cleanCui}` : cleanCui) : null,
			country: 'RO',
			legalType: billingType === 'company' ? 'srl' : 'pf',
			signupSource: 'public-form',
			onboardingStatus: 'pending_email'
		};
		try {
			const inserted = await withTursoBusyRetry(
				() => db.insert(table.client).values(values).returning(),
				{ tenantId, label: 'public-hours/insertClient' }
			);
			clientRow = inserted[0];
		} catch (err) {
			const { message } = serializeError(err);
			if (message.toLowerCase().includes('unique')) {
				// Race pe (tenant,email) sau (tenant,cui): re-căutăm pe ambele chei
				// și ne atașăm — răspuns identic cu clientul nou (anti-enumeration).
				const [race] = await db
					.select()
					.from(table.client)
					.where(
						and(
							eq(table.client.tenantId, tenantId),
							cleanCui
								? or(
										eq(table.client.cui, cleanCui),
										eq(table.client.vatNumber, `RO${cleanCui}`),
										eq(table.client.vatNumber, cleanCui),
										eq(table.client.email, normalizedEmail)
									)
								: eq(table.client.email, normalizedEmail)
						)
					)
					.limit(1);
				if (!race) throw err;
				clientRow = race;
			} else {
				throw err;
			}
		}
	}

	// ── Comanda de ore (pending_payment) ─────────────────────────────────────
	const orderId = generateId();
	try {
		await withTursoBusyRetry(
			() =>
				db.insert(table.serviceHoursOrder).values({
					id: orderId,
					tenantId,
					clientId: clientRow!.id,
					rateSlug: rate.slug,
					rateLabel: rate.label,
					rateEur: rate.rate,
					hours: data.hours,
					netCents,
					vatCents,
					grossCents,
					vatPercent,
					currency: 'EUR',
					billingType,
					contactName: data.contactName.trim(),
					contactEmail: normalizedEmail,
					contactPhone: data.contactPhone || null,
					companyName: billingType === 'company' ? data.companyName!.trim() : null,
					cui: cleanCui,
					note: data.note || null,
					status: 'pending_payment',
					ipAddress: ip,
					userAgent
				}),
			{ tenantId, label: 'public-hours/insertOrder' }
		);
	} catch (err) {
		const { message, stack } = serializeError(err);
		logError('packages', `comandă ore: INSERT eșuat — ${message}`, {
			tenantId,
			stackTrace: stack,
			metadata: { rateSlug: rate.slug, hours: data.hours }
		});
		throw error(500, 'Nu am putut înregistra comanda. Te rugăm să încerci din nou.');
	}

	// ── Stripe PaymentIntent pe BRUT ─────────────────────────────────────────
	try {
		const stripe = await getStripeForTenant(tenantId);
		const publishableKey = await getPublishableKeyForTenant(tenantId);
		if (!publishableKey) throw new Error('Publishable key Stripe lipsă.');

		// Dev-test: fără Customer (client.stripe_customer_id e din contul LIVE;
		// un Customer de test i-ar suprascrie cache-ul în DB-ul partajat cu prod).
		let customerId: string | undefined;
		if (!isStripeDevTestMode()) {
			try {
				customerId = await getOrCreateStripeCustomer({
					id: clientRow.id,
					tenantId: clientRow.tenantId,
					name: clientRow.name,
					businessName: clientRow.businessName,
					email: clientRow.email,
					phone: clientRow.phone,
					vatNumber: clientRow.vatNumber,
					address: clientRow.address,
					city: clientRow.city,
					county: clientRow.county,
					postalCode: clientRow.postalCode,
					country: clientRow.country,
					stripeCustomerId: clientRow.stripeCustomerId
				});
			} catch (err) {
				logError('packages', `comandă ore: Stripe Customer eșuat (continuăm fără) — ${serializeError(err).message}`, {
					tenantId,
					metadata: { orderId }
				});
			}
		}

		const intent = await stripe.paymentIntents.create({
			amount: grossCents,
			currency: 'eur',
			...(customerId ? { customer: customerId } : {}),
			automatic_payment_methods: { enabled: true },
			metadata: {
				crmPurpose: 'hours_purchase',
				crmTenantId: tenantId,
				crmClientId: clientRow.id,
				crmHoursOrderId: orderId,
				crmNetCents: String(netCents),
				crmVatCents: String(vatCents),
				crmVatPercent: String(vatPercent)
			},
			description: `Extra work — ${rate.label} × ${data.hours} h`
		});
		if (!intent.client_secret) throw new Error('Stripe nu a returnat clientSecret.');

		await withTursoBusyRetry(
			() =>
				db
					.update(table.serviceHoursOrder)
					.set({ stripePaymentIntentId: intent.id, updatedAt: new Date() })
					.where(
						and(eq(table.serviceHoursOrder.id, orderId), eq(table.serviceHoursOrder.tenantId, tenantId))
					),
			{ tenantId, label: 'public-hours/updateOrderPI' }
		);

		logInfo('packages', 'comandă ore: PaymentIntent creat', {
			tenantId,
			metadata: { orderId, rateSlug: rate.slug, hours: data.hours, grossCents, paymentIntentId: intent.id }
		});

		return {
			success: true as const,
			orderId,
			clientSecret: intent.client_secret,
			publishableKey,
			breakdown: { netCents, vatCents, grossCents, vatPercent }
		};
	} catch (err) {
		const { message } = serializeError(err);
		logError('packages', `comandă ore: Stripe eșuat — ${message}`, {
			tenantId,
			metadata: { orderId }
		});
		throw error(502, 'Plata nu poate fi inițializată acum. Te rugăm să încerci peste câteva minute.');
	}
});
```

- [ ] **Step 4: Rulează testele → PASS**

Run: `bun run test public-hours`
Expected: PASS toate cazurile. Ajustează mock-urile db dacă ordinea select-urilor diferă.

- [ ] **Step 5: Commit**
```bash
git add app/src/lib/remotes/public-hours.remote.ts app/src/lib/remotes/__tests__/public-hours.remote.test.ts
git commit -m "feat(servicii): command public createHoursOrder cu PaymentIntent Stripe"
```

---

### Task 6: Webhook — `hours_purchase` succeeded/failed + emitter Keez

**Files:**
- Create: `app/src/lib/server/stripe/post-payment/emit-keez-hours-invoice.ts`
- Create: `app/src/lib/server/stripe/hours-purchase.ts`
- Create: `app/src/lib/server/stripe/__tests__/hours-purchase.test.ts`
- Modify: `app/src/lib/server/stripe/webhook-handlers.ts` (`handlePaymentIntentSucceeded` ~L573, `handlePaymentIntentFailed` ~L700)

- [ ] **Step 1: Emitter-ul Keez pentru ore**

`emit-keez-hours-invoice.ts` — clonă adaptată după `emit-keez-invoice.ts` (citește-l întâi integral), cu diferențele:
- primește `{ tenantId, clientId, orderId, stripePaymentIntentId }`; citește `serviceHoursOrder` în loc de `hostingProduct`;
- idempotență identică: dacă există deja `invoice` cu acest `stripePaymentIntentId` → return cu invoiceId existent;
- serie: `getNextInvoiceNumberFromPlugin(tenantId)` FĂRĂ `{ isHosting: true }` (seria default OTS, nu OTSH);
- bani: `amount = order.netCents`, `taxRate = vatPercentToBps(order.vatPercent)`, `taxAmount = order.vatCents`, `totalAmount = order.grossCents`, `currency = 'EUR'`, `invoiceCurrency = 'EUR'`, `status='paid'`, `paidDate=now`, `paymentMethod='card'`, `stripePaymentIntentId`;
- linia: `description = \`Extra work — ${order.rateLabel}\`` (nume generic, stabil → articol Keez refolosibil), `note = \`${order.hours} h × ${order.rateEur} € · Stripe: ${stripePaymentIntentId}\``, `quantity = order.hours`, `rate = order.rateEur * 100`, `amount = order.netCents`, `unitOfMeasure = 'Oră'`;
- cache articol Keez: înainte de insert, caută cel mai recent `invoice_line_item` cu aceeași `description` și `keezItemExternalId` non-null (format 32 hex) și pre-populează — echivalentul cache-ului de pe `hostingProduct`, fără coloană nouă:
```ts
const [cached] = await db
	.select({ keezItemExternalId: table.invoiceLineItem.keezItemExternalId })
	.from(table.invoiceLineItem)
	.innerJoin(table.invoice, eq(table.invoiceLineItem.invoiceId, table.invoice.id))
	.where(
		and(
			eq(table.invoice.tenantId, tenantId),
			eq(table.invoiceLineItem.description, lineDescription),
			isNotNull(table.invoiceLineItem.keezItemExternalId)
		)
	)
	.orderBy(desc(table.invoice.issueDate))
	.limit(1);
```
- la final `pushInvoiceToKeez(tenantId, invoiceId)` cu aceleași semantici (eșecul NU anulează factura CRM; staff retrimite din UI); actualizează `serviceHoursOrder.invoiceId`;
- fără logică de billing period / domeniu / OP-bank (comanda de ore e mereu card, one-time).

- [ ] **Step 2: Handler-ul de webhook**

`app/src/lib/server/stripe/hours-purchase.ts`:
```ts
/**
 * Post-plată pentru cumpărarea orelor de extra work (/servicii, tab Tarife
 * orare). Branch-ul `metadata.crmPurpose='hours_purchase'` din
 * payment_intent.succeeded/failed — IZOLAT de pipeline-ul de hosting (fără DA
 * provisioning) și de `invoice_payment` (acolo factura există deja).
 *
 * Idempotență în straturi: `processed_stripe_event` oprește redelivery-ul
 * aceluiași event; guard-ul pe `status==='paid'` oprește dublarea pe replay
 * manual; emitterul Keez e idempotent pe stripePaymentIntentId.
 */
import type Stripe from 'stripe';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logError, logInfo, logWarning, serializeError } from '$lib/server/logger';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { emitKeezHoursInvoice } from './post-payment/emit-keez-hours-invoice';
import { sendOnboardingMagicLink } from './post-payment/send-magic-link';
import { notifyPaymentSucceeded, notifyAdminPaymentReceived } from './notifications';

export async function handleHoursPurchaseSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
	const md = intent.metadata ?? {};
	const tenantId = md.crmTenantId;
	const clientId = md.crmClientId;
	const orderId = md.crmHoursOrderId;
	if (!tenantId || !clientId || !orderId) {
		logError('packages', 'hours_purchase succeeded fără metadata CRM', {
			metadata: { intentId: intent.id }
		});
		return;
	}

	const [order] = await db
		.select()
		.from(table.serviceHoursOrder)
		.where(
			and(eq(table.serviceHoursOrder.id, orderId), eq(table.serviceHoursOrder.tenantId, tenantId))
		)
		.limit(1);
	if (!order) {
		logError('packages', `hours_purchase: comanda ${orderId} nu există`, {
			tenantId,
			metadata: { intentId: intent.id }
		});
		return;
	}
	if (order.status === 'paid') {
		logInfo('packages', `hours_purchase: comanda ${orderId} deja plătită — skip`, { tenantId });
		return;
	}
	// Suma încasată trebuie să fie exact brutul comenzii — PI-ul e creat de noi,
	// deci un mismatch înseamnă manipulare sau bug; nu marcăm plătit automat.
	if (intent.amount !== order.grossCents) {
		logError('packages', `hours_purchase: sumă încasată ${intent.amount} ≠ gross ${order.grossCents} — NEmarcat plătit, verificare manuală`, {
			tenantId,
			metadata: { orderId, intentId: intent.id }
		});
		return;
	}

	await withTursoBusyRetry(
		() =>
			db.transaction(async (tx) => {
				await tx
					.update(table.client)
					.set({ status: 'active', updatedAt: new Date() })
					.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)));
				await tx
					.update(table.serviceHoursOrder)
					.set({
						status: 'paid',
						paidAt: new Date(),
						stripePaymentIntentId: intent.id,
						updatedAt: new Date()
					})
					.where(
						and(
							eq(table.serviceHoursOrder.id, orderId),
							eq(table.serviceHoursOrder.tenantId, tenantId)
						)
					);
			}),
		{ tenantId, label: 'hours-purchase/markPaid' }
	);

	// Pașii următori sunt best-effort, fiecare cu propriul catch — factura
	// nereușită NU blochează emailurile și invers; admin poate re-rula manual.
	let invoiceId: string | null = null;
	try {
		const res = await emitKeezHoursInvoice({
			tenantId,
			clientId,
			orderId,
			stripePaymentIntentId: intent.id
		});
		if ('invoiceId' in res) invoiceId = res.invoiceId;
	} catch (err) {
		logError('packages', `hours_purchase: emitere factură eșuată — ${serializeError(err).message}`, {
			tenantId,
			metadata: { orderId }
		});
	}

	try {
		await sendOnboardingMagicLink({ tenantId, clientId });
	} catch (err) {
		logWarning('packages', `hours_purchase: magic link eșuat — ${serializeError(err).message}`, {
			tenantId,
			metadata: { orderId, clientId }
		});
	}

	if (invoiceId) {
		try {
			await notifyPaymentSucceeded(tenantId, invoiceId);
		} catch (err) {
			logWarning('packages', `hours_purchase: email confirmare eșuat — ${serializeError(err).message}`, {
				tenantId,
				metadata: { orderId, invoiceId }
			});
		}
		try {
			await notifyAdminPaymentReceived(tenantId, invoiceId, { hours_order: 'success' });
		} catch (err) {
			logWarning('packages', `hours_purchase: notificare admin eșuată — ${serializeError(err).message}`, {
				tenantId,
				metadata: { orderId, invoiceId }
			});
		}
	}

	logInfo('packages', `hours_purchase: comanda ${orderId} finalizată`, {
		tenantId,
		metadata: { orderId, invoiceId, intentId: intent.id }
	});
}

export async function handleHoursPurchaseFailed(intent: Stripe.PaymentIntent): Promise<void> {
	const md = intent.metadata ?? {};
	const tenantId = md.crmTenantId;
	const orderId = md.crmHoursOrderId;
	if (!tenantId || !orderId) return;
	// Doar din pending_payment — un failed întârziat după succeeded nu are voie
	// să „desplătească" comanda.
	await db
		.update(table.serviceHoursOrder)
		.set({ status: 'failed', updatedAt: new Date() })
		.where(
			and(
				eq(table.serviceHoursOrder.id, orderId),
				eq(table.serviceHoursOrder.tenantId, tenantId),
				eq(table.serviceHoursOrder.status, 'pending_payment')
			)
		);
	logInfo('packages', `hours_purchase: plata eșuată pentru comanda ${orderId}`, { tenantId });
}
```

- [ ] **Step 3: Wiring în `webhook-handlers.ts`**

În `handlePaymentIntentSucceeded`, imediat DUPĂ branch-ul `invoice_payment` (~L595):
```ts
	// Cumpărare ore extra work de pe /servicii — pipeline propriu (factură Keez
	// + emailuri), FĂRĂ provisioning DA.
	if (md.crmPurpose === 'hours_purchase') {
		await handleHoursPurchaseSucceeded(intent);
		return;
	}
```
În `handlePaymentIntentFailed`, la început, același branch → `handleHoursPurchaseFailed(intent); return;`.
Import: `import { handleHoursPurchaseSucceeded, handleHoursPurchaseFailed } from './hours-purchase';`

- [ ] **Step 4: Teste webhook (TDD pe handler)**

`app/src/lib/server/stripe/__tests__/hours-purchase.test.ts` — mock `$lib/server/db` (select/update/transaction), emitterul, magic link și notificările; cazuri:
```ts
// 1. happy path: order pending + amount corect → client active, order paid,
//    emitter chemat, magic link + ambele notificări chemate
// 2. order deja 'paid' → nimic nu se apelează (idempotent)
// 3. amount mismatch → order rămâne pending, emitter NEchemat, logError
// 4. metadata incompletă → return fără crash
// 5. emitter aruncă → order rămâne paid, magic link tot se trimite
// 6. failed: doar din pending_payment (order paid nu e atins)
```
Scrie-le cu aceleași convenții de mock ca în Task 5 (mock.module pe module întregi, contoare pe apeluri).

- [ ] **Step 5: Rulează → PASS + commit**

Run: `bun run test hours-purchase`
```bash
git add app/src/lib/server/stripe/post-payment/emit-keez-hours-invoice.ts app/src/lib/server/stripe/hours-purchase.ts app/src/lib/server/stripe/__tests__/hours-purchase.test.ts app/src/lib/server/stripe/webhook-handlers.ts
git commit -m "feat(servicii): pipeline post-plată pentru cumpărarea orelor (Keez + emailuri)"
```

---

### Task 7: UI — tab-ul Tarife orare devine cumpărabil

**Files:**
- Modify: `app/src/routes/servicii/ServicesCatalog.svelte` (blocul `{#if showRates}` + stiluri `sv-rate*`)

- [ ] **Step 1: Stare + markup**

În `<script>`: stare pentru modal + ore per specializare (fără import de valori din catalog — `catalog.hourlyRates` vine din props):
```ts
	import HoursCheckoutModal from './HoursCheckoutModal.svelte';
	import { HOURS_MIN, HOURS_MAX } from '$lib/logic/hours-pricing'; // pur, fără prețuri

	let hoursBySlug = $state<Record<string, number>>({});
	let hoursCheckout = $state<{ slug: string; label: string; rate: number; hours: number } | null>(null);

	function hoursFor(slug: string): number {
		return hoursBySlug[slug] ?? 10; // 10h — pachetul tipic de pornire
	}
	function stepHours(slug: string, delta: number) {
		hoursBySlug[slug] = Math.min(HOURS_MAX, Math.max(HOURS_MIN, hoursFor(slug) + delta));
	}
```
În blocul `{#if showRates}`, cardul `sv-rate` capătă stepper + total net + CTA (TVA-ul se detaliază în modal):
```svelte
	{#each catalog.hourlyRates as rate (rate.slug)}
		{@const h = hoursFor(rate.slug)}
		<div class="sv-rate">
			<span class="sv-rate-val">{rate.rate} €<i>/h</i></span>
			<span class="sv-rate-label">{rate.label}</span>
			<div class="sv-rate-stepper" role="group" aria-label={`Ore ${rate.label}`}>
				<button type="button" onclick={() => stepHours(rate.slug, -1)} disabled={h <= HOURS_MIN} aria-label="Scade o oră">−</button>
				<span class="sv-rate-hours">{h} h</span>
				<button type="button" onclick={() => stepHours(rate.slug, 1)} disabled={h >= HOURS_MAX} aria-label="Adaugă o oră">+</button>
			</div>
			<span class="sv-rate-total">{formatEur(rate.rate * h)} <i>fără TVA</i></span>
			<button
				type="button"
				class="sv-btn sv-btn-primary ots-gloss sv-rate-buy"
				onclick={() => (hoursCheckout = { slug: rate.slug, label: rate.label, rate: rate.rate, hours: h })}
			>
				Cumpără orele <ArrowRightIcon class="h-4 w-4" />
			</button>
		</div>
	{/each}
```
La finalul markup-ului (lângă `ServicesQuoteModal`, ÎN interiorul `.sv-page` — tokenii `--accent` există doar acolo):
```svelte
	{#if hoursCheckout}
		<HoursCheckoutModal
			rate={hoursCheckout}
			vatPercent={catalog.vatPercent}
			onClose={() => (hoursCheckout = null)}
		/>
	{/if}
```

- [ ] **Step 2: Stiluri** — completează blocul `sv-rate*` existent:
```css
	.sv-rate-stepper {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		margin-top: 6px;
	}
	.sv-rate-stepper button {
		width: 32px;
		height: 32px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--bg-soft);
		font-size: 18px;
		font-weight: 700;
		color: var(--ink);
		cursor: pointer;
		transition: all 0.15s;
	}
	.sv-rate-stepper button:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}
	.sv-rate-stepper button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.sv-rate-hours {
		min-width: 46px;
		font-size: 15px;
		font-weight: 700;
		color: var(--ink);
	}
	.sv-rate-total {
		font-size: 13px;
		font-weight: 600;
		color: var(--ink2);
	}
	.sv-rate-total i {
		font-style: normal;
		font-size: 11px;
		color: var(--muted);
	}
	.sv-rate-buy {
		margin-top: 4px;
		width: 100%;
		justify-content: center;
	}
```
`formatEur` e deja importat în componentă (`ots-catalog-format` e client-safe, fără prețuri).

- [ ] **Step 3: Commit** (modalul vine în Task 8 — pune un stub temporar dacă vrei build verde, sau fă Task 7+8 într-un singur commit; recomandat: un commit comun după Task 8).

---

### Task 8: `HoursCheckoutModal.svelte` — 3 pași cu Stripe embedded

**Files:**
- Create: `app/src/routes/servicii/HoursCheckoutModal.svelte`

Modalul folosește `checkout-modal-shell.svelte` și clase proprii `hc-*` (modeled pe `sq-*` din `ServicesQuoteModal.svelte` — citește-l întâi pentru stiluri de formular). Structura completă:

- [ ] **Step 1: Script**
```svelte
<script lang="ts">
	/**
	 * Cumpărarea orelor de extra work: date facturare → plată Stripe → succes.
	 * NU importă valori din ots-catalog (testul no-price-leak): tariful vine
	 * prin prop, limitele din modulul pur hours-pricing.
	 */
	import { loadStripe, type Stripe as StripeJS, type StripeElements } from '@stripe/stripe-js';
	import CheckoutModalShell from '$lib/components/checkout-modal-shell.svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { createHoursOrder } from '$lib/remotes/public-hours.remote';
	import { validateCuiAndFetch } from '$lib/remotes/public-hosting.remote';
	import { computeVatBreakdown } from '$lib/utils/vat';
	import { formatEur } from '$lib/constants/ots-catalog-format';

	let {
		rate,
		vatPercent,
		onClose
	}: {
		rate: { slug: string; label: string; rate: number; hours: number };
		vatPercent: number;
		onClose: () => void;
	} = $props();

	let step = $state<'details' | 'payment' | 'success'>('details');
	let submitting = $state(false);
	let payProcessing = $state(false);
	let errorMsg = $state<string | null>(null);

	// Date facturare
	let billingType = $state<'company' | 'person'>('company');
	let contactName = $state('');
	let contactEmail = $state('');
	let contactPhone = $state('');
	let companyName = $state('');
	let cui = $state('');
	let vatPayer = $state(false);
	let note = $state('');
	let cuiChecking = $state(false);
	let cuiHint = $state<string | null>(null);

	const money = $derived(computeVatBreakdown(rate.rate * rate.hours * 100, vatPercent));

	// Stripe
	let stripeJs = $state<StripeJS | null>(null);
	let elements = $state<StripeElements | null>(null);
	let paymentMountEl = $state<HTMLDivElement | null>(null);

	async function onCuiBlur() {
		if (billingType !== 'company' || !cui.trim()) return;
		cuiChecking = true;
		cuiHint = null;
		try {
			// Auto-completează denumirea + statutul de plătitor de TVA din ANAF
			// (query public existent, cu rate-limit propriu). Răspuns:
			// { valid: true, data: { denumire, vatNumber, platitorTva, ... } } | { valid: false, error }.
			const res = await validateCuiAndFetch(cui.trim());
			if (res.valid) {
				if (!companyName.trim()) companyName = res.data.denumire;
				vatPayer = res.data.platitorTva;
			} else {
				cuiHint = res.error;
			}
		} catch {
			// Informativ — validarea reală e pe server la submit.
		} finally {
			cuiChecking = false;
		}
	}

	const detailsValid = $derived(
		contactName.trim().length >= 2 &&
			/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim()) &&
			(billingType === 'person' || (companyName.trim().length > 0 && cui.trim().length > 1))
	);

	async function submitDetails() {
		if (!detailsValid || submitting) return;
		submitting = true;
		errorMsg = null;
		try {
			const res = await createHoursOrder({
				rateSlug: rate.slug,
				hours: rate.hours,
				billingType,
				contactName: contactName.trim(),
				contactEmail: contactEmail.trim(),
				contactPhone: contactPhone.trim() || undefined,
				companyName: billingType === 'company' ? companyName.trim() : undefined,
				cui: billingType === 'company' ? cui.trim() : undefined,
				vatPayer: billingType === 'company' ? vatPayer : undefined,
				note: note.trim() || undefined
			});
			const stripe = await loadStripe(res.publishableKey);
			if (!stripe) throw new Error('Stripe.js nu s-a încărcat.');
			stripeJs = stripe;
			elements = stripe.elements({ clientSecret: res.clientSecret, locale: 'ro' });
			step = 'payment';
			// PaymentElement se montează după ce markup-ul pasului 2 există în DOM.
			queueMicrotask(() => {
				if (elements && paymentMountEl) elements.create('payment').mount(paymentMountEl);
			});
		} catch (err) {
			errorMsg =
				(err as { body?: { message?: string } })?.body?.message ??
				'Nu am putut porni plata. Te rugăm să încerci din nou.';
		} finally {
			submitting = false;
		}
	}

	async function confirmPayment() {
		if (!stripeJs || !elements || payProcessing) return;
		payProcessing = true;
		errorMsg = null;
		try {
			const { error } = await stripeJs.confirmPayment({
				elements,
				confirmParams: { return_url: window.location.href },
				redirect: 'if_required'
			});
			if (error) {
				errorMsg = error.message ?? 'Plata a fost refuzată. Verifică datele cardului.';
			} else {
				step = 'success';
			}
		} finally {
			payProcessing = false;
		}
	}
</script>
```

- [ ] **Step 2: Markup** — în `CheckoutModalShell` (`canClose={!payProcessing && !submitting}`, `ariaLabel="Cumpără ore de extra work"`):
  - antet sumar mereu vizibil: `{rate.label} · {rate.hours} h × {rate.rate} €` + rând net / TVA {vatPercent}% / **total {formatEur(money.grossCents / 100)}**;
  - `details`: toggle PF/PJ (butoane radio stilizate), inputuri (nume, email, telefon; firmă: denumire + CUI cu `onblur={onCuiBlur}`, spinner pe `cuiChecking`, `cuiHint` sub câmp când ANAF respinge, checkbox „Plătitor de TVA" bind:checked={vatPayer} precompletat din ANAF), textarea notă opțională, mesaj eroare `role="alert"`, footer cu buton „Continuă spre plată" (`disabled={!detailsValid || submitting}`);
  - `payment`: `<div bind:this={paymentMountEl}></div>` + footer „Plătește {formatEur(money.grossCents / 100)}" (`disabled={payProcessing}`, text „Se procesează..." când `payProcessing`);
  - `success`: iconiță check, „Plata a fost confirmată", text: factura fiscală și linkul de acces în portal sosesc pe email în câteva minute; buton „Închide".
  - Stările Loading (submitting/payProcessing pe butoane), Empty (n/a — modalul se deschide mereu cu un tarif), Error (`errorMsg` sub formular) — definite explicit, cerință design-flow.

- [ ] **Step 3: svelte-autofixer** pe componentă + `bun run test no-price-leak` (modalul importă `validateCuiAndFetch` din public-hosting.remote — verifică că remote-ul NU trage prețuri în client; dacă testul pică, mută importul într-un modul separat sau folosește fetch pe endpoint).

- [ ] **Step 4: Commit (Task 7 + 8 împreună)**
```bash
git add app/src/routes/servicii/ServicesCatalog.svelte app/src/routes/servicii/HoursCheckoutModal.svelte
git commit -m "feat(servicii): cumpărare ore de extra work din tab-ul Tarife orare"
```

---

### Task 9: Admin — comenzile de ore în `[tenant]/services`

**Files:**
- Modify: `app/src/lib/remotes/packages.remote.ts` (query nou la final)
- Create: `app/src/routes/[tenant]/services/HoursOrdersPanel.svelte`
- Modify: `app/src/routes/[tenant]/services/+page.svelte` (~L156–180: TabsTrigger + TabsContent)

- [ ] **Step 1: Query staff**
```ts
export const getHoursOrders = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	await requireStaff(event);
	return db
		.select({
			id: table.serviceHoursOrder.id,
			clientId: table.serviceHoursOrder.clientId,
			rateLabel: table.serviceHoursOrder.rateLabel,
			rateEur: table.serviceHoursOrder.rateEur,
			hours: table.serviceHoursOrder.hours,
			grossCents: table.serviceHoursOrder.grossCents,
			currency: table.serviceHoursOrder.currency,
			status: table.serviceHoursOrder.status,
			contactName: table.serviceHoursOrder.contactName,
			contactEmail: table.serviceHoursOrder.contactEmail,
			companyName: table.serviceHoursOrder.companyName,
			invoiceId: table.serviceHoursOrder.invoiceId,
			paidAt: table.serviceHoursOrder.paidAt,
			createdAt: table.serviceHoursOrder.createdAt
		})
		.from(table.serviceHoursOrder)
		.where(eq(table.serviceHoursOrder.tenantId, event.locals.tenant.id))
		.orderBy(desc(table.serviceHoursOrder.createdAt))
		.limit(200);
});
```

- [ ] **Step 2: `HoursOrdersPanel.svelte`** — tabel shadcn pe modelul tab-ului „requests" din aceeași pagină (citește-l întâi): coloane Data, Contact (nume + email + firmă), Specializare, Ore, Total (`grossCents/100` + valuta), Status (badge: `paid` verde, `pending_payment` amber, `failed` roșu), Factură (link `/{tenant}/invoices/{invoiceId}` când există). Empty state: „Nicio comandă de ore încă." Loading prin `$derived(await query)` pattern-ul existent al paginii.

- [ ] **Step 3: Tab în pagină** — `TabsTrigger value="hours"` cu label „Ore extra work" + `TabsContent` care montează panel-ul.

- [ ] **Step 4: Commit**
```bash
git add app/src/lib/remotes/packages.remote.ts "app/src/routes/[tenant]/services/HoursOrdersPanel.svelte" "app/src/routes/[tenant]/services/+page.svelte"
git commit -m "feat(admin): comenzile de ore extra work vizibile în Servicii"
```

---

### Task 10: Verificare — build, browser, design audit

- [ ] **Step 1:** `bun run test` (tot) — 0 fail; baseline-ul preexistent rămâne.
- [ ] **Step 2:** svelte-autofixer pe TOATE componentele .svelte modificate; apoi `/build-check` (svelte-check heap 8GB) — fără erori NOI peste baseline (16 err/56 warn).
- [ ] **Step 3:** testermcp pe `http://localhost:5173/servicii` (deblochează cu cookie-ul `ots_pub_services` semnat — vezi memoria coș /servicii): tab „Tarife orare" → stepper 10→7 h → „Cumpără orele" → modal pas 1 (validări: email invalid, PJ fără CUI) → submit cu chei TEST → PaymentElement montat → card test `4242 4242 4242 4242` → pas succes. Screenshot la fiecare pas. ATENȚIE testermcp: `click` ia PRIMUL match pe text — pentru butoanele repetate (−/+ pe 4 carduri) folosește `evaluate` cu selectori DOM.
- [ ] **Step 4:** verifică în DB (dev): `service_hours_order.status='paid'`, `invoice` creată cu `stripePaymentIntentId`, iar în Admin → Servicii → tab Ore apare comanda. Emailuri: pe dev pleacă REALE — folosește un email propriu de test, nu al unui client.
- [ ] **Step 5:** design audit (`design-auditor` + `web-design-guidelines`) pe ServicesCatalog (tab-ul nou) + HoursCheckoutModal + HoursOrdersPanel: contrast, focus trap, aria pe stepper, responsive 320px (grila `sv-rategrid` 2→1 coloane dacă e înghesuită), dark mode admin panel. Repară Critical/High înainte de review.
- [ ] **Step 6:** mobil: `sv-rategrid` la 680px — verifică că butoanele stepper au țintă tactilă ≥ 40px.

---

### Task 11: Docs + review + finish

- [ ] **Step 1:** `app/docs/stripe-module.md` — secțiune nouă scurtă „Cumpărare ore extra work (/servicii)": fluxul, `crmPurpose='hours_purchase'`, tabelul, idempotența, seria de facturare default (nu OTSH).
- [ ] **Step 2:** superpowers:requesting-code-review (+ gemini pe partea de bani/webhook — security review).
- [ ] **Step 3:** fixuri din review → re-run teste + build-check.
- [ ] **Step 4:** superpowers:finishing-a-development-branch — merge în main DOAR cu acordul userului; propune deploy și AȘTEAPTĂ „go" + alegerea production/staging.
- [ ] **Step 5:** după commit pe main: `graphify . --update`.

---

## Decizii luate (și de confirmat implicit la review)

1. **Bifa „plătitor de TVA"** e precompletată din ANAF (`validateCuiAndFetch` → `platitorTva`) și trimisă ca `vatPayer` — `vatNumber` primește prefixul `RO` exact ca la hosting.
2. **TVA pentru toți** — formularul presupune client RO (country='RO' hardcodat, ca la hosting). Non-RO reverse charge NU e în scope (nota din memoria „TVA intracom").
3. **Serie facturi: default (OTS)**, nu OTSH — orele nu sunt hosting.
4. **Fără evidență de consum al orelor** (timesheet) — comanda plătită E înregistrarea; consumul se urmărește operațional, nu în acest scope.
5. **Orele NU intră în coșul de ofertă multi-serviciu** și nu primesc discountul 2+/3+ — sunt plată directă, flux separat (userul a ales „cu plată pe loc").
6. **`validateCuiAndFetch` reutilizat** din public-hosting.remote pentru autocomplete ANAF — dacă testul no-price-leak obiectează la import, fallback: fără autocomplete în v1.
