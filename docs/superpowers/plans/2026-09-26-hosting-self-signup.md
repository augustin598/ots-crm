# Cont nou de hosting (self-signup) + portal „doar hosting" — plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un vizitator al paginii publice /pachete-hosting (persoană fizică sau juridică, client nou sau nu) își face singur cont — cu email (magic link) sau cu Google — și primește în portal doar secțiunile de hosting: Dashboard, Hosting (Conturile mele, Pachete), Facturi, Setări. Datele de facturare (PF/PJ, CUI, adresă) se completează la prima comandă, ca la Hostico.

**Architecture:** Contul = rând `client` creat la signup (`signup_source='hosting-signup'`, `portal_scope='hosting'`) + `user`/`client_user` create de fluxul existent de login (magic link sau Google) prin `findOrCreateClientSession`. Scope-ul „hosting" e o coloană nouă pe `client`, aplicată într-un singur loc — `getRequestAccessFlags` din `portal-access.ts` — de unde o moștenesc layout-urile, meniul și toate endpoint-urile portalului. Google OAuth primește în `state` un `mode` (`login`|`signup`) și un `returnTo` validat, ca la „no-match" să creeze contul în loc să ceară CUI. Checkout-ul recunoaște clientul logat și îi completează datele de facturare pe rândul existent în loc să creeze un duplicat.

**Tech Stack:** SvelteKit 5 (runes, remote functions `query`/`command` cu valibot), Bun, Drizzle/libSQL (Turso), stilurile `co-*` ale checkout-ului (`hosting-checkout-modal.svelte`), `bun run test`.

Decizii luate cu userul (2026-09-26): autentificare **fără parolă** (magic link + Google); formular de signup **minimal** (nume, email, telefon opțional, termeni).

---

## Fișiere

- Create `app/drizzle/0568_client_portal_scope.sql` + intrare în `app/drizzle/meta/_journal.json`.
- Modify `app/src/lib/server/db/schema.ts` — `client.portalScope`.
- Modify `app/src/lib/server/portal-access.ts` — `PortalScope`, `applyPortalScope`, `routeBlockedByPortalScope`, `getRequestAccessFlags` aplică scope-ul.
- Create `app/src/lib/server/hosting/public-tenant.ts` — `PUBLIC_TENANT_SLUG`, `resolvePublicTenantId` (mutate din remote).
- Create `app/src/lib/server/portal-signup.ts` — `findClientIdsForEmail`, `findOrCreateHostingSignupClient`, `resolvePortalClientForUser`, `issueMagicLink`.
- Create `app/src/lib/server/hosting/billing-from-order.ts` — `buildBillingUpdateFromOrder`.
- Modify `app/src/lib/server/google-client-auth.ts` — `encodeState`/`decodeState`, `mode`, `returnTo`, `safePortalReturnTo`.
- Modify `app/src/routes/api/client-auth/google/+server.ts`, `.../callback/+server.ts`.
- Modify `app/src/lib/remotes/client-auth.remote.ts` — `hostingSignup`.
- Modify `app/src/lib/remotes/client-restrictions.remote.ts` — `portalScope` în listă + `setClientPortalScope`.
- Modify `app/src/lib/remotes/public-hosting.remote.ts` — `tenantSlug` în `getPublicHostingPackages`; `submitHostingOrder` atașează comanda clientului logat.
- Modify `app/src/routes/client/[tenant]/+layout.server.ts`, `.../(app)/+layout.server.ts`, `.../(app)/+layout.svelte` — scope în date, gardă pe rute, meniu redus.
- Modify `app/src/routes/client/[tenant]/signup/+page.svelte` — formular cont nou (+ varianta „am deja CUI").
- Create `app/src/routes/pachete-hosting/+page.server.ts` — clientul logat.
- Modify `app/src/routes/pachete-hosting/+page.svelte` — modal „Cont nou", linkuri de login, nav „Contul meu".
- Modify `app/src/lib/components/hosting-checkout-modal.svelte` — `initialEmail`/`lockEmail`/`portalTenantSlug`.
- Modify `app/src/routes/[tenant]/settings/+page.svelte` — select „Portal".
- Tests: `app/src/lib/server/__tests__/portal-access-scope.test.ts`, `google-client-auth-state.test.ts`, `hosting-billing-from-order.test.ts`, `portal-signup.test.ts`; `app/src/lib/remotes/__tests__/client-auth-hosting-signup.remote.test.ts`.

---

### Task 1: Migrare + schema `client.portal_scope`

**Reguli:** un statement pe fișier, fără `IF NOT EXISTS`, `when` > max(created_at) de pe remote (= `1788786476917026`, verificat 2026-09-26 cu `scripts/_check-migration-state.ts`). Coloana intră în `schema.ts` DOAR după ce migrarea e aplicată și verificată cu PRAGMA (select-all pe `client` ar pica altfel).

- [ ] Creează `app/drizzle/0568_client_portal_scope.sql`:

```sql
ALTER TABLE `client` ADD `portal_scope` text DEFAULT 'full' NOT NULL;
```

- [ ] Adaugă în `app/drizzle/meta/_journal.json`, după intrarea 567:

```json
    {
      "idx": 568,
      "version": "6",
      "when": 1788786476918026,
      "tag": "0568_client_portal_scope",
      "breakpoints": true
    }
```

- [ ] Verifică: `ls app/drizzle/*.sql | wc -l` == numărul de intrări din jurnal; `grep -c portal_scope app/drizzle/*.sql` → doar fișierul nou.
- [ ] Cere „go" de la user (baza e cea de producție), apoi `cd app && bun run db:migrate`.
- [ ] Verifică: `bun -e` cu `@libsql/client`: `PRAGMA table_info('client')` conține `portal_scope`; `SELECT max(created_at) FROM __drizzle_migrations` = `1788786476918026`.
- [ ] Abia acum, în `schema.ts` (tabelul `client`, după `stripeCustomerId`):

```ts
	/** Ce vede în portal: 'full' (tot ce permit flag-urile) | 'hosting' (doar Hosting + Facturi + Setări). Conturile create singure de pe /pachete-hosting pornesc pe 'hosting'; adminul poate trece pe 'full'. */
	portalScope: text('portal_scope').notNull().default('full'),
```

  și la `signupSource` completează comentariul cu `| 'hosting-signup'`.

- [ ] Commit: `git add app/drizzle/0568_client_portal_scope.sql app/drizzle/meta/_journal.json app/src/lib/server/db/schema.ts` → `feat(portal): coloană client.portal_scope (full | hosting)`.

---

### Task 2: `portal-access.ts` — scope „hosting"

- [ ] Scrie `app/src/lib/server/__tests__/portal-access-scope.test.ts`:

```ts
import { describe, test, expect, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/db/schema', () => ({}));

const { applyPortalScope, routeBlockedByPortalScope, ALL_ACCESS_TRUE, NO_ACCESS } = await import(
	'../portal-access'
);

describe('applyPortalScope', () => {
	test("'full' lasă flag-urile neatinse", () => {
		expect(applyPortalScope(ALL_ACCESS_TRUE, 'full')).toEqual(ALL_ACCESS_TRUE);
	});
	test('null/undefined = full', () => {
		expect(applyPortalScope(ALL_ACCESS_TRUE, null)).toEqual(ALL_ACCESS_TRUE);
		expect(applyPortalScope(ALL_ACCESS_TRUE, undefined)).toEqual(ALL_ACCESS_TRUE);
	});
	test("'hosting' păstrează doar hosting + invoices", () => {
		expect(applyPortalScope(ALL_ACCESS_TRUE, 'hosting')).toEqual({
			...NO_ACCESS,
			hosting: true,
			invoices: true
		});
	});
	test("'hosting' nu acordă ce contactul nu avea deja", () => {
		expect(applyPortalScope({ ...NO_ACCESS, hosting: true }, 'hosting')).toEqual({
			...NO_ACCESS,
			hosting: true
		});
	});
});

describe('routeBlockedByPortalScope', () => {
	test('sub hosting, /services și /team sunt închise', () => {
		expect(routeBlockedByPortalScope('/client/ots/services', 'ots', 'hosting')).toBe(true);
		expect(routeBlockedByPortalScope('/client/ots/team/x', 'ots', 'hosting')).toBe(true);
	});
	test('sub hosting, dashboard/hosting/invoices/settings rămân deschise', () => {
		for (const p of ['/client/ots/dashboard', '/client/ots/hosting/packages', '/client/ots/invoices', '/client/ots/settings']) {
			expect(routeBlockedByPortalScope(p, 'ots', 'hosting')).toBe(false);
		}
	});
	test('sub full nimic nu e închis', () => {
		expect(routeBlockedByPortalScope('/client/ots/services', 'ots', 'full')).toBe(false);
	});
	test('alt tenant în cale → nu e treaba noastră', () => {
		expect(routeBlockedByPortalScope('/client/alt/services', 'ots', 'hosting')).toBe(false);
	});
});
```

- [ ] `cd app && bun run test portal-access-scope` → FAIL (funcții inexistente).
- [ ] În `portal-access.ts` adaugă după `NO_ACCESS`:

```ts
/** Cât din portal vede clientul. 'hosting' = cont creat singur de pe /pachete-hosting. */
export type PortalScope = 'full' | 'hosting';
export const PORTAL_SCOPES: readonly PortalScope[] = ['full', 'hosting'] as const;

/** Categoriile pe care le păstrează scope-ul 'hosting' (restul cad pe false). */
const HOSTING_SCOPE_CATEGORIES: readonly AccessCategory[] = ['hosting', 'invoices'];

export function applyPortalScope(flags: AccessFlags, scope: string | null | undefined): AccessFlags {
	if (scope !== 'hosting') return flags;
	const out: AccessFlags = { ...NO_ACCESS };
	for (const c of HOSTING_SCOPE_CATEGORIES) out[c] = flags[c];
	return out;
}

/**
 * Rutele fără categorie (Servicii & Oferte, Echipa mea) pe care scope-ul 'hosting'
 * le închide. Dashboard și Setări rămân deschise pentru oricine.
 */
export function routeBlockedByPortalScope(
	pathname: string,
	tenantSlug: string,
	scope: string | null | undefined
): boolean {
	if (scope !== 'hosting') return false;
	const prefix = `/client/${tenantSlug}`;
	if (!pathname.startsWith(prefix)) return false;
	const rest = pathname.slice(prefix.length);
	return rest.startsWith('/services') || rest.startsWith('/team');
}
```

  și modifică `getRequestAccessFlags` să primească `portalScope?: string | null` și să-l aplice (dacă lipsește, îl citește din `client`):

```ts
export async function getRequestAccessFlags(opts: {
	tenantId: string;
	clientId: string;
	userEmail: string | null | undefined;
	isPrimary: boolean;
	/** `client.portalScope` dacă apelantul îl are deja (layout-ul); altfel îl citim noi. */
	portalScope?: string | null;
}): Promise<AccessFlags> {
	let scope = opts.portalScope;
	if (scope === undefined) {
		const [row] = await db
			.select({ portalScope: table.client.portalScope })
			.from(table.client)
			.where(and(eq(table.client.id, opts.clientId), eq(table.client.tenantId, opts.tenantId)))
			.limit(1);
		scope = row?.portalScope ?? 'full';
	}
	if (opts.isPrimary) return applyPortalScope({ ...ALL_ACCESS_TRUE }, scope);
	const email = opts.userEmail?.toLowerCase() ?? '';
	if (!email) return { ...NO_ACCESS };
	const [secondary] = await db
		.select({ /* neschimbat */ })
		...
	return applyPortalScope(resolveAccessFlags({ isPrimary: false, secondaryEmail: secondary ?? null }), scope);
}
```

- [ ] `bun run test portal-access-scope` → PASS.
- [ ] Commit: `feat(portal): scope 'hosting' pe flag-urile de acces`.

---

### Task 3: Layout-urile portalului respectă scope-ul

- [ ] `app/src/routes/client/[tenant]/+layout.server.ts`: în apelul `getRequestAccessFlags` adaugă `portalScope: event.locals.client.portalScope`; în obiectul returnat adaugă `portalScope: (event.locals.client?.portalScope ?? 'full') as 'full' | 'hosting'`.
- [ ] `app/src/routes/client/[tenant]/(app)/+layout.server.ts`:

```ts
import { routeRequiresAccess, routeBlockedByPortalScope } from '$lib/server/portal-access';
...
	if (required && !parent.accessFlags[required]) {
		throw error(403, 'Nu ai acces la această secțiune.');
	}
	if (routeBlockedByPortalScope(event.url.pathname, tenantSlug, parent.portalScope)) {
		throw error(403, 'Contul tău de hosting nu include această secțiune.');
	}
```

- [ ] `app/src/routes/client/[tenant]/(app)/+layout.svelte`: `const hostingOnly = $derived(data.portalScope === 'hosting');` și în `clientGroups`:
  - `services` intră doar `...(hostingOnly ? [] : [{ id: 'services', ... }])`;
  - `invoices`: `children: hostingOnly ? undefined : [ ...cele 4 ]` (facturile de ads nu au sens pe un cont de hosting);
  - `team`: condiția devine `data.isClientUserPrimary && !hostingOnly`.
- [ ] `bun run test` (tot) → verde; svelte-autofixer pe layout.
- [ ] Commit: `feat(portal): meniu și rute reduse pentru scope-ul hosting`.

---

### Task 4: `public-tenant.ts` + `portal-signup.ts` (server)

- [ ] Creează `app/src/lib/server/hosting/public-tenant.ts` mutând din `public-hosting.remote.ts` constanta `PUBLIC_TENANT_SLUG` și funcția `resolvePublicTenantId` (cu cache-ul ei de 5 min, cod identic); în remote înlocuiește definițiile cu `import { PUBLIC_TENANT_SLUG, resolvePublicTenantId } from '$lib/server/hosting/public-tenant';`.
- [ ] Scrie `app/src/lib/server/__tests__/portal-signup.test.ts`:

```ts
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));

// DB fals: `selectResults` e coada de rezultate pentru select-urile în ordine; insert-urile se capturează.
let selectResults: any[][] = [];
let inserted: any[] = [];
let insertThrows: Error | null = null;
const chain = (rows: any[]) => {
	const c: any = {
		from: () => c, where: () => c, limit: () => c, innerJoin: () => c, orderBy: () => c,
		then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej)
	};
	return c;
};
mock.module('$lib/server/db', () => ({
	db: {
		select: () => chain(selectResults.shift() ?? []),
		insert: () => ({
			values: (row: any) => {
				if (insertThrows) throw insertThrows;
				inserted.push(row);
				return { returning: async () => [row] };
			}
		}),
		update: () => ({ set: () => ({ where: async () => ({}) }) })
	}
}));
await import('$lib/server/db/schema');

const sent: any[] = [];
mock.module('$lib/server/email', () => ({
	sendMagicLinkEmail: async (...args: any[]) => { sent.push(args); }
}));

const { findClientIdsForEmail, findOrCreateHostingSignupClient, issueMagicLink } = await import(
	'../portal-signup'
);

beforeEach(() => { selectResults = []; inserted = []; insertThrows = null; sent.length = 0; });

describe('findClientIdsForEmail', () => {
	test('unește potrivirile primare și secundare, fără dubluri', async () => {
		selectResults = [[{ id: 'c1', name: 'A' }], [{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }]];
		const r = await findClientIdsForEmail('t1', 'X@Y.ro');
		expect(r.map((c) => c.id)).toEqual(['c1', 'c2']);
	});
});

describe('findOrCreateHostingSignupClient', () => {
	test('client nou: prospect, hosting-signup, portal_scope=hosting, email normalizat', async () => {
		selectResults = [[], []];
		const r = await findOrCreateHostingSignupClient({ tenantId: 't1', name: '  Ion Popescu ', email: 'Ion@Firma.RO', phone: '0722' });
		expect(r.created).toBe(true);
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toMatchObject({
			tenantId: 't1', name: 'Ion Popescu', email: 'ion@firma.ro', phone: '0722',
			status: 'prospect', signupSource: 'hosting-signup', onboardingStatus: 'pending_email',
			portalScope: 'hosting', legalType: null, cui: null
		});
	});
	test('email deja client → nu inserează, întoarce clientul existent', async () => {
		selectResults = [[{ id: 'c9', name: 'Vechi', email: 'ion@firma.ro' }], []];
		const r = await findOrCreateHostingSignupClient({ tenantId: 't1', name: 'Ion', email: 'ion@firma.ro', phone: null });
		expect(r.created).toBe(false);
		expect(r.clients.map((c) => c.id)).toEqual(['c9']);
		expect(inserted).toHaveLength(0);
	});
	test('cursă pe UNIQUE(email) → re-citește și întoarce rândul câștigător', async () => {
		selectResults = [[], [], [{ id: 'c7', name: 'Ion', email: 'ion@firma.ro' }]];
		insertThrows = new Error('UNIQUE constraint failed: client.email');
		const r = await findOrCreateHostingSignupClient({ tenantId: 't1', name: 'Ion', email: 'ion@firma.ro', phone: null });
		expect(r.created).toBe(false);
		expect(r.clients[0].id).toBe('c7');
	});
});

describe('issueMagicLink', () => {
	test('inserează token cu toate id-urile și trimite emailul', async () => {
		await issueMagicLink({ id: 't1', slug: 'ots' }, 'ion@firma.ro', [{ id: 'c1', name: 'Ion' }, { id: 'c2', name: 'B' }]);
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toMatchObject({ email: 'ion@firma.ro', clientId: 'c1', tenantId: 't1', used: false });
		expect(JSON.parse(inserted[0].matchedClientIds)).toEqual(['c1', 'c2']);
		expect(sent[0][0]).toBe('ion@firma.ro');
		expect(sent[0][2]).toBe('ots');
		expect(sent[0][3]).toBe('Ion');
	});
});
```

- [ ] `bun run test portal-signup` → FAIL.
- [ ] Creează `app/src/lib/server/portal-signup.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { sendMagicLinkEmail } from '$lib/server/email';
import { generateMagicLinkToken, hashToken } from '$lib/server/client-auth';

/** Cont de portal creat singur de pe /pachete-hosting (fără CUI; datele de facturare vin la prima comandă). */

const MAGIC_LINK_EXPIRY_HOURS = 24;

export type MatchedClient = { id: string; name: string };

function newId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/** Toți clienții tenantului la care emailul e primar sau secundar, fără dubluri. */
export async function findClientIdsForEmail(tenantId: string, email: string): Promise<MatchedClient[]> {
	const normalized = email.trim().toLowerCase();
	const primary = await db
		.select({ id: table.client.id, name: table.client.name })
		.from(table.client)
		.where(and(eq(table.client.tenantId, tenantId), eq(sql`lower(${table.client.email})`, normalized)));
	const secondary = await db
		.select({ id: table.client.id, name: table.client.name })
		.from(table.clientSecondaryEmail)
		.innerJoin(table.client, eq(table.clientSecondaryEmail.clientId, table.client.id))
		.where(
			and(
				eq(table.clientSecondaryEmail.tenantId, tenantId),
				eq(sql`lower(${table.clientSecondaryEmail.email})`, normalized)
			)
		);
	const seen = new Set<string>();
	const out: MatchedClient[] = [];
	for (const c of [...primary, ...secondary]) {
		if (seen.has(c.id)) continue;
		seen.add(c.id);
		out.push(c);
	}
	return out;
}

export async function findOrCreateHostingSignupClient(input: {
	tenantId: string;
	name: string;
	email: string;
	phone: string | null;
}): Promise<{ clients: MatchedClient[]; created: boolean }> {
	const email = input.email.trim().toLowerCase();
	const name = input.name.trim();
	const existing = await findClientIdsForEmail(input.tenantId, email);
	if (existing.length > 0) return { clients: existing, created: false };

	try {
		const [row] = await db
			.insert(table.client)
			.values({
				id: newId(),
				tenantId: input.tenantId,
				name,
				businessName: null,
				email,
				phone: input.phone || null,
				status: 'prospect',
				cui: null,
				vatNumber: null,
				legalType: null,
				country: 'RO',
				signupSource: 'hosting-signup',
				onboardingStatus: 'pending_email',
				portalScope: 'hosting'
			})
			.returning();
		return { clients: [{ id: row.id, name: row.name }], created: true };
	} catch (err) {
		// Două signup-uri simultane cu același email: UNIQUE(tenant, email) a câștigat celălalt → îl folosim.
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.toLowerCase().includes('unique')) throw err;
		const winner = await findClientIdsForEmail(input.tenantId, email);
		if (winner.length === 0) throw err;
		return { clients: winner, created: false };
	}
}

/** Clientul activ al unui user logat, pentru rutele publice unde hooks nu populează `locals.client`. */
export async function resolvePortalClientForUser(tenantId: string, userId: string) {
	const [row] = await db
		.select({
			id: table.client.id,
			name: table.client.name,
			email: table.client.email,
			portalScope: table.client.portalScope
		})
		.from(table.clientUser)
		.innerJoin(table.client, eq(table.clientUser.clientId, table.client.id))
		.where(and(eq(table.clientUser.userId, userId), eq(table.clientUser.tenantId, tenantId)))
		.orderBy(sql`${table.clientUser.lastSelectedAt} DESC NULLS LAST`)
		.limit(1);
	return row ?? null;
}

/** Invalidează token-urile vechi, emite unul nou pentru clienții dați și trimite emailul. */
export async function issueMagicLink(
	tenant: { id: string; slug: string },
	email: string,
	clients: MatchedClient[]
): Promise<void> {
	const normalized = email.trim().toLowerCase();
	await db
		.update(table.magicLinkToken)
		.set({ used: true, usedAt: new Date() })
		.where(
			and(
				eq(table.magicLinkToken.email, normalized),
				eq(table.magicLinkToken.tenantId, tenant.id),
				eq(table.magicLinkToken.used, false)
			)
		);
	const plainToken = generateMagicLinkToken();
	await db.insert(table.magicLinkToken).values({
		id: newId(),
		token: hashToken(plainToken),
		email: normalized,
		clientId: clients[0].id,
		matchedClientIds: JSON.stringify(clients.map((c) => c.id)),
		tenantId: tenant.id,
		expiresAt: new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000),
		used: false
	});
	await sendMagicLinkEmail(normalized, plainToken, tenant.slug, clients[0].name);
}
```

  Dacă `client-auth.ts` trage la import `@node-rs/argon2`/lucia și testul pică pe asta, mock-uiește în test `$lib/server/client-auth` cu `{ generateMagicLinkToken: () => 'tok', hashToken: (t: string) => 'h:' + t }`.

- [ ] `bun run test portal-signup` → PASS.
- [ ] Commit: `feat(portal): helper-e de signup (client nou fără CUI + magic link)`.

---

### Task 5: Remote `hostingSignup` (public)

- [ ] Scrie `app/src/lib/remotes/__tests__/client-auth-hosting-signup.remote.test.ts` (mock-uri ca în `public-services.remote.test.ts`; în plus mock pe `$lib/server/portal-signup`, `$lib/server/rate-limiter`, `$lib/server/email`, `$lib/server/client-auth`, `$lib/server/get-actor`, `$lib/server/app-url`):

```ts
let rateLimited = false;
mock.module('$lib/server/rate-limiter', () => ({ checkAuthRateLimit: () => (rateLimited ? 'limited' : null) }));
const calls: { create: any[]; link: any[] } = { create: [], link: [] };
mock.module('$lib/server/portal-signup', () => ({
	findOrCreateHostingSignupClient: async (i: any) => { calls.create.push(i); return { clients: [{ id: 'c1', name: i.name }], created: true }; },
	issueMagicLink: async (...a: any[]) => { calls.link.push(a); }
}));
let tenantRows: any[] = [{ id: 't1', slug: 'ots' }];
mock.module('$lib/server/db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => tenantRows }) }) }) } }));
```

  Teste: (1) input valid → `create` apelat cu `{tenantId:'t1', name, email, phone}` și `link` cu `[{id:'t1',slug:'ots'}, email, clients]`, răspuns `{ success: true }`; (2) `rateLimited=true` → niciun apel, același răspuns generic; (3) `tenantRows=[]` → niciun apel, răspuns generic; (4) `issueMagicLink` aruncă → răspuns generic, fără excepție; (5) `consentTerms: false` → command-ul (valibot) respinge — testează schema exportată `HostingSignupSchema` cu `v.safeParse`.

- [ ] `bun run test client-auth-hosting-signup` → FAIL.
- [ ] În `client-auth.remote.ts` adaugă:

```ts
import { findOrCreateHostingSignupClient, issueMagicLink } from '$lib/server/portal-signup';

export const HostingSignupSchema = v.object({
	tenantSlug: v.pipe(v.string(), v.minLength(1)),
	name: v.pipe(v.string(), v.trim(), v.minLength(3, 'Scrie numele complet.'), v.maxLength(120)),
	email: v.pipe(v.string(), v.trim(), v.email('Adresa de email nu e validă.')),
	phone: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40))),
	consentTerms: v.literal(true, 'Bifează termenii și condițiile.')
});

/**
 * Cont nou de hosting de pe /pachete-hosting sau /client/[tenant]/signup. Public.
 * Răspunsul e mereu același (anti-enumerare): dacă emailul e deja client, primește
 * doar linkul de login; dacă nu, creăm clientul (scope hosting) și trimitem linkul.
 */
export const hostingSignup = command(HostingSignupSchema, async (data) => {
	const GENERIC = { success: true as const, message: 'Ți-am trimis pe email linkul de activare.' };
	try {
		const event = getRequestEvent();
		const clientIp = event ? event.getClientAddress() : null;
		if (checkAuthRateLimit(data.email, clientIp)) return GENERIC;
		const [tenant] = await db
			.select({ id: table.tenant.id, slug: table.tenant.slug })
			.from(table.tenant)
			.where(eq(table.tenant.slug, data.tenantSlug))
			.limit(1);
		if (!tenant) return GENERIC;
		const { clients } = await findOrCreateHostingSignupClient({
			tenantId: tenant.id,
			name: data.name,
			email: data.email,
			phone: data.phone ?? null
		});
		await issueMagicLink(tenant, data.email, clients);
		return GENERIC;
	} catch (err) {
		console.error('hostingSignup error:', err);
		return GENERIC;
	}
});
```

- [ ] `bun run test client-auth-hosting-signup` → PASS.
- [ ] Commit: `feat(portal): remote hostingSignup`.

---

### Task 6: Google OAuth cu `mode=signup` și `returnTo`

- [ ] Scrie `app/src/lib/server/__tests__/google-client-auth-state.test.ts` (mock `googleapis` → `{ google: { auth: { OAuth2: class {} }, oauth2: () => ({}) } }`, mock env):
  - `decodeState(encodeState({tenantSlug:'ots', nonce:'n', mode:'signup', returnTo:'/client/ots/hosting/packages'}))` → același obiect;
  - state vechi fără `mode` (`btoa(JSON.stringify({tenantSlug,nonce}))` url-safe) → `mode:'login'`, `returnTo:null`;
  - `safePortalReturnTo('ots', ...)`: acceptă `/client/ots/hosting/packages`, `/client/ots/dashboard`; respinge `https://evil.ro`, `//evil.ro`, `/client/alt/dashboard`, `/pachete-hosting`, `null`, `''`.
- [ ] `bun run test google-client-auth-state` → FAIL.
- [ ] În `google-client-auth.ts`:

```ts
export type GoogleLoginMode = 'login' | 'signup';
export type GoogleState = { tenantSlug: string; nonce: string; mode: GoogleLoginMode; returnTo: string | null };

const toUrlSafe = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrlSafe = (s: string) => { const b = s.replace(/-/g, '+').replace(/_/g, '/'); return b + '=='.slice(0, (4 - (b.length % 4)) % 4); };

export function encodeState(state: GoogleState): string {
	return toUrlSafe(btoa(JSON.stringify(state)));
}
export function decodeState(raw: string): GoogleState {
	const parsed = JSON.parse(atob(fromUrlSafe(raw)));
	if (typeof parsed.tenantSlug !== 'string' || typeof parsed.nonce !== 'string') {
		throw new Error('Invalid state: missing tenantSlug or nonce');
	}
	return {
		tenantSlug: parsed.tenantSlug,
		nonce: parsed.nonce,
		mode: parsed.mode === 'signup' ? 'signup' : 'login',
		returnTo: typeof parsed.returnTo === 'string' ? parsed.returnTo : null
	};
}
/** Doar căi din portalul tenantului curent — fără scheme, fără `//`, fără alt tenant. */
export function safePortalReturnTo(tenantSlug: string, raw: string | null | undefined): string | null {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
	return raw.startsWith(`/client/${tenantSlug}/`) ? raw : null;
}

export function generateGoogleLoginUrl(
	tenantSlug: string,
	opts: { mode?: GoogleLoginMode; returnTo?: string | null } = {}
): { url: string; nonce: string } {
	const nonce = toUrlSafe(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));
	const state = encodeState({
		tenantSlug,
		nonce,
		mode: opts.mode ?? 'login',
		returnTo: safePortalReturnTo(tenantSlug, opts.returnTo)
	});
	...generateAuthUrl({ ..., state, prompt: 'select_account' })
}
export const parseState = decodeState; // compat cu callback-ul existent
```

- [ ] `app/src/routes/api/client-auth/google/+server.ts`: citește `mode` (`'signup'` doar dacă exact așa) și `returnTo` din query, pasează-le la `generateGoogleLoginUrl(tenantSlug, { mode, returnTo })`.
- [ ] `.../callback/+server.ts`: după parse, păstrează `mode` și `returnTo`; după `exchangeCodeForEmail` → `{ email, name }`:

```ts
		let result = await findOrCreateClientSession(tenantSlug, email, event);
		if (!result.success && result.reason === 'no-match' && mode === 'signup') {
			const [tenant] = await db.select({ id: table.tenant.id }).from(table.tenant).where(eq(table.tenant.slug, tenantSlug)).limit(1);
			if (tenant) {
				await findOrCreateHostingSignupClient({ tenantId: tenant.id, name: name?.trim() || email.split('@')[0], email, phone: null });
				result = await findOrCreateClientSession(tenantSlug, email, event);
			}
		}
		if (result.success) {
			const fallback = result.clientCount > 1 ? `/client/${tenantSlug}/select-company` : `/client/${tenantSlug}/dashboard`;
			throw redirect(302, result.clientCount > 1 ? fallback : (returnTo ?? fallback));
		}
```

  Contul creat cu Google nu are `onboardingStatus='pending_email'` — emailul e deja verificat de Google → pasează `onboardingStatus: 'active'`? Nu: `findOrCreateHostingSignupClient` setează 'pending_email'; adaugă parametru opțional `emailVerified?: boolean` care pune 'active' când e true (Google) — și test pentru asta în Task 4 (`emailVerified: true` → `onboardingStatus: 'active'`).

- [ ] `bun run test google-client-auth-state` → PASS; `bun run test` tot verde.
- [ ] Commit: `feat(portal): Google sign-in cu mode=signup și returnTo validat`.

---

### Task 7: Pagina publică — modal „Cont nou", login-uri corecte, nav pentru cel logat

- [ ] `getPublicHostingPackages` întoarce și `tenantSlug: PUBLIC_TENANT_SLUG`.
- [ ] Creează `app/src/routes/pachete-hosting/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { PUBLIC_TENANT_SLUG, resolvePublicTenantId } from '$lib/server/hosting/public-tenant';
import { resolvePortalClientForUser } from '$lib/server/portal-signup';

/** Cine e logat (dacă e): pe rutele publice hooks nu populează `locals.client`. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { tenantSlug: PUBLIC_TENANT_SLUG, portalClient: null };
	const tenantId = await resolvePublicTenantId();
	const c = await resolvePortalClientForUser(tenantId, locals.user.id);
	return {
		tenantSlug: PUBLIC_TENANT_SLUG,
		portalClient: c ? { id: c.id, name: c.name, email: c.email } : null
	};
};
```

- [ ] `+page.svelte`: `let { data } = $props();` `const tenantSlug = $derived(data.tenantSlug); const portalClient = $derived(data.portalClient);`
  - Nav: `{#if portalClient}<a class="ph-nav-cta" href="/client/{tenantSlug}/dashboard">Contul meu ↗</a>{:else}<a class="ph-nav-secondary" href="/client/{tenantSlug}/login">Autentificare</a><button class="ph-nav-cta" onclick={openSignup}>Cont nou ↗</button>{/if}`; footer „Cont client" → `/client/{tenantSlug}/login`.
  - Stare nouă: `signupOpen`, `signup = $state({ name:'', email:'', phone:'', consent:false })`, `signupSubmitting`, `signupSentTo: string | null`. `openSignup()` resetează; `closeSignup()` blocat cât timp trimite.
  - `handleSignup(e)`: `e.preventDefault()`; validări client (nume ≥3, email, consent) cu `toast.error`; `await hostingSignup({ tenantSlug, name, email, phone: phone || undefined, consentTerms: true })` → `signupSentTo = email`.
  - Modalul „Cont nou" — același schelet `co-overlay > co-sheet > co-topbar / co-body / co-foot` ca modalul de ofertă făcut azi (refolosește `ph-iq-sheet`/`ph-iq-body`/`ph-iq-steps`):
    - topbar: logo + badge `co-secure` „Fără parolă · link pe email" + Închide;
    - stânga: `h2 co-h2` „Creează-ți contul", `p co-sub` „Îți trimitem pe email un link de activare — fără parolă de ținut minte. Datele de facturare le completezi la prima comandă."; buton `<a class="co-btn-ghost ph-google-btn" href="/api/client-auth/google?tenant={tenantSlug}&mode=signup&returnTo={encodeURIComponent(`/client/${tenantSlug}/hosting/packages`)}">` cu SVG-ul Google din `client/[tenant]/signup/+page.svelte` + „Continuă cu Google"; separator „sau cu email"; `<form id="signup-form">` cu secțiunea `co-form-section` „Datele tale": Nume complet* (`#su-name`, autocomplete name), Email* (`#su-email`), Telefon (`#su-phone`, tel) + rând `<label class="ph-consent"><input type="checkbox" bind:checked={signup.consent}> Sunt de acord cu <a href="/termeni" target="_blank" rel="noopener">termenii și condițiile</a>.</label>`;
    - când `signupSentTo`: în loc de formular, `div.co-success` cu `co-success-icon` (MailIcon), `h2 co-h2` „Verifică emailul", text „Ți-am trimis un link de activare la **{signupSentTo}**. Linkul e valabil 24h. Dacă ai deja cont, același link te loghează."; footer doar cu „Închide";
    - dreapta (`co-summary`): „Ce urmează" cu 3 pași (1 Activezi contul din email / 2 Alegi pachetul și plătești cu cardul / 3 Contul de hosting se creează automat) + `co-trust` (aceleași 3 rânduri) + „Ai deja cont?" → link `/client/{tenantSlug}/login`;
    - foot: `Anulează` (ghost) · „Fără parolă · fără obligații" · `Creează contul` (primary, `form="signup-form"`, disabled cât trimite).
  - Modalul „Cere o ofertă" rămâne pentru linkurile „Cere o ofertă personalizată" / „Contactează-ne" / „Vorbește cu un consultant" (e cerere de ofertă, nu cont).
  - CSS nou minim: `.ph-google-btn { width:100%; justify-content:center; gap:10px; padding:12px 16px; }`, `.ph-or { display:flex; align-items:center; gap:12px; margin:16px 0; font-size:12px; color:#94a3b8; } .ph-or::before, .ph-or::after { content:''; flex:1; height:1px; background:#e5e9f0; }`, `.ph-consent { display:flex; gap:10px; align-items:flex-start; font-size:13px; color:#475569; margin-top:14px; }`.
- [ ] `hosting-checkout-modal.svelte`: props noi `initialEmail?: string | null`, `lockEmail?: boolean`, `portalTenantSlug?: string` (default `'ots'`); `let email = $state(initialEmail ?? '')`; câmpul de email primește `readonly={lockEmail}` + hint „Comanda se leagă de contul tău ({email})"; cele 3 linkuri `/login…` → `/client/{portalTenantSlug}/login…`. Pagina pasează `initialEmail={portalClient?.email} lockEmail={!!portalClient} portalTenantSlug={tenantSlug}`.
- [ ] svelte-autofixer pe cele două componente; testermcp: modalul se deschide din „Cont nou", trimite (mock: verifici în DB că a apărut clientul de test și că `signupSentTo` se afișează), linkul Google are `mode=signup`, cu sesiune de client nav-ul arată „Contul meu".
- [ ] Commit: `feat(pachete-hosting): modal Cont nou (magic link + Google), linkuri către portalul de client`.

---

### Task 8: Checkout-ul completează datele de facturare pe clientul logat

- [ ] Scrie `app/src/lib/server/__tests__/hosting-billing-from-order.test.ts`: `buildBillingUpdateFromOrder({ billingType:'company', cui:'12345678', vatPayer:true, companyName:'Firma SRL', registrationNumber:'J33/1/2020', phone:'07', address:'Str', city:'Suceava', county:'Suceava', postalCode:'720' })` → `{ name:'Firma SRL', businessName:'Firma SRL', cui:'12345678', vatNumber:'RO12345678', registrationNumber:'J33/1/2020', legalType:'srl', phone:'07', address:'Str', city:'Suceava', county:'Suceava', postalCode:'720', country:'RO' }`; `vatPayer:false` → `vatNumber:'12345678'`; `billingType:'person', firstName:'Ion', lastName:'Pop'` → `{ name:'Ion Pop', businessName:null, cui:null, vatNumber:null, registrationNumber:null, legalType:'pf', ...adresă }`; câmpurile lipsă rămân `undefined` (nu suprascriu cu null ce clientul avea).
- [ ] `bun run test hosting-billing-from-order` → FAIL.
- [ ] Creează `app/src/lib/server/hosting/billing-from-order.ts` (funcție pură, tipurile de input minimale: `billingType`, `cui?`, `vatPayer?`, `companyName?`, `registrationNumber?`, `firstName?`, `lastName?`, `phone?`, `address?`, `city?`, `county?`, `postalCode?`), folosind `normalizeCui` din `$lib/server/cui-validator`.
- [ ] `bun run test hosting-billing-from-order` → PASS.
- [ ] În `submitHostingOrder`, după `normalizedEmail`:

```ts
	// Client logat în portal care comandă cu emailul lui: comanda merge pe contul lui și
	// îi completăm datele de facturare (contul de self-signup n-are CUI/adresă).
	const portalClient = event?.locals.user
		? await resolvePortalClientForUser(tenantId, event.locals.user.id)
		: null;
	const ordersOnOwnAccount = !!portalClient && portalClient.email?.toLowerCase() === normalizedEmail;
```

  În ramura company, în locul insert-ului (când `!existingClient` **și** `ordersOnOwnAccount`) și în ramura person (când `existingByEmail` **și** `ordersOnOwnAccount`): `await db.update(table.client).set({ ...buildBillingUpdateFromOrder(data), updatedAt: now }).where(and(eq(table.client.id, portalClient.id), eq(table.client.tenantId, tenantId)))` apoi re-select rândul în `clientRow`. Când e company și există alt client cu acel CUI → comportamentul de azi (se atașează la acela) + `logInfo` „logged-in client ordered with a CUI owned by another client".
- [ ] `bun run test` verde. Commit: `feat(hosting): comanda din portal completează datele de facturare pe clientul logat`.

---

### Task 9: `/client/[tenant]/signup` — formular cont nou

- [ ] Rescrie `app/src/routes/client/[tenant]/signup/+page.svelte` în română: titlu „Creează-ți contul", subtitlu „Primești pe email un link de activare — fără parolă.", buton Google (`mode=signup&returnTo=/client/{slug}/hosting/packages`), separator, formular (nume, email prefilled din `?email=`, telefon, consimțământ) → `hostingSignup`; stare de succes ca azi (card verde „Verifică emailul"). Sub formular: `<button type="button" class="…link">Sunt deja client OTS — vreau acces cu CUI</button>` care comută pe vechiul formular (`clientSignup`) neschimbat. Footer: „Ai deja cont? Intră cu linkul de login".
- [ ] svelte-autofixer + testermcp pe `/client/ots/signup`.
- [ ] Commit: `feat(portal): pagina de signup creează cont de hosting`.

---

### Task 10: Admin — comută scope-ul din Setări

- [ ] `client-restrictions.remote.ts`: în `getClientsRestrictionStatus` selectează și `portalScope: table.client.portalScope` și întoarce-l; adaugă:

```ts
export const setClientPortalScope = command(
	v.object({ clientId: v.pipe(v.string(), v.minLength(1)), portalScope: v.picklist(['full', 'hosting']) }),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		await requireStaff(event);
		await db.update(table.client)
			.set({ portalScope: data.portalScope, updatedAt: new Date() })
			.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, event.locals.tenant.id)));
		return { success: true };
	}
);
```

- [ ] `[tenant]/settings/+page.svelte`: lângă `Select`-ul de restricție, un al doilea `Select` (`w-[150px]`) cu valorile `full` → „Portal complet", `hosting` → „Doar hosting", `onValueChange={(val) => handleSetScope(client.id, val)}` care apelează `setClientPortalScope(...).updates(clientRestrictionsQuery)`; badge `<Badge variant="secondary">Doar hosting</Badge>` când `client.portalScope === 'hosting'`. Descrierea cardului primește „…și cât din portal vede fiecare client (complet / doar hosting)".
- [ ] svelte-autofixer; commit: `feat(settings): admin comută portalul clientului între complet și doar hosting`.

---

### Task 11: Verificare, audit, review

- [ ] `cd app && bun run test` → 0 fail; `/build-check` → fără erori noi peste baseline.
- [ ] testermcp, golden path pe dev-ul din worktree (port 5174): (a) /pachete-hosting → Cont nou → trimite cu un email de test → ecranul „Verifică emailul"; în DB: `select name,email,status,signup_source,portal_scope,onboarding_status from client where email=?`; (b) ia token-ul din `magic_link_token`... nu se poate (hash) → folosește `scripts/_gen-test-magic-link.ts` pentru a genera un link pentru clientul de test și deschide `/client/ots/verify?token=` → dashboard; meniul are DOAR Dashboard, Invoices, Hosting, Setări; `/client/ots/services` → 403; `/client/ots/tasks` → 403; (c) din Setări (admin) comută pe „Portal complet" → meniul complet reapare; (d) șterge clientul de test.
- [ ] design-auditor + web-design-guidelines pe modalul nou și pagina de signup; repară Critical/High.
- [ ] superpowers:requesting-code-review; fix; `bun run test` din nou.
- [ ] superpowers:finishing-a-development-branch: push `feat/hosting-self-signup`, PR către main; propune deploy și așteaptă „go" (migrarea e deja aplicată din Task 1 — spune explicit asta în PR).
- [ ] `graphify . --update` din rădăcina repo-ului.
