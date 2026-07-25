# Interviuri ↔ Client Association Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interviurile pot fi asociate cu un client (mecanismul `clientId` FK, ca la `seoLink`), pagina Interviuri apare ca tab în pagina clientului (`/ots/clients/[clientId]/interviuri`), iar interviurile existente pot fi asociate în masă cu un client (Lucky Group) direct din `/ots/interviuri`.

**Architecture:** Coloană nouă `interview.client_id` (nullable, FK → `client.id`), filtrare server-side în `getInterviews`, comandă de asociere în masă `assignInterviewsClient`. UI-ul interviuri se mută din ruta `[tenant]/interviuri/` în componente partajate `$lib/components/interviuri/` (precedentul modulului Content — componente comune + rute-wrapper subțiri). Tab nou în `clients/[clientId]/+layout.svelte`.

**Tech Stack:** SvelteKit 5 (runes), remote functions (query/command + valibot), Drizzle ORM pe Turso/libSQL (migrări hand-authored, un statement per fișier), bun:test.

**Reguli din memorie aplicate:**
- `feedback_schema_select_all_hazard`: migrarea se aplică pe Turso ÎNAINTE de a adăuga coloana în `schema.ts`.
- `feedback_turso_single_statement`: un singur statement SQL per fișier de migrare.
- Modulul Interviuri are migrări hand-authored (0407–0412); `db:gen` le drop-ează → hand-author + `db:migrate`.
- `feedback_migration_flow`: după `db:migrate`, verifică pe remote cu `PRAGMA table_info`.
- Multi-tenant: orice `clientId` primit de la UI se validează că aparține tenantului (`client.tenantId = tenant.id`) — altfel cross-tenant write (clasa F8).
- Dev DB = Turso PROD (1 tenant `ots`) — migrarea e aditivă/nullable, sigură.

---

## File Structure

**Create:**
- `app/drizzle/0436_interview_client_id.sql` — ALTER TABLE ADD client_id
- `app/drizzle/0437_interview_client_idx.sql` — CREATE INDEX
- `app/src/lib/remotes/__tests__/interviuri-client-assoc.test.ts` — teste remote (TDD)
- `app/src/lib/components/interviuri/interviews-view.svelte` — view-ul complet (fost `+page.svelte`), props `{ clientId?, homeHref, embedded? }`
- `app/src/lib/components/interviuri/AssignClientModal.svelte` — dialog asociere în masă
- `app/src/routes/[tenant]/clients/[clientId]/interviuri/+page.svelte` — wrapper tab client

**Move (git mv, din `app/src/routes/[tenant]/interviuri/` în `app/src/lib/components/interviuri/`):**
- `lib.ts`, `interviuri.css`, `ChannelChip.svelte`, `ChannelIcon.svelte`, `StatusPill.svelte`, `AttributionPanel.svelte`, `TrendPanel.svelte`, `InterviewModal.svelte`, `ComparisonModal.svelte`

**Modify:**
- `app/drizzle/meta/_journal.json` — 2 intrări noi (idx 436, 437)
- `app/src/lib/server/db/schema.ts` — `interview.clientId` + index (DOAR după aplicarea migrării)
- `app/src/lib/remotes/interviuri.remote.ts` — clientId în schema/create/update, filtrare în getInterviews, comandă assignInterviewsClient, join client
- `app/src/lib/components/interviuri/lib.ts` — `clientId`/`clientName` în `RawInterview`
- `app/src/lib/components/interviuri/InterviewModal.svelte` — select Client
- `app/src/routes/[tenant]/interviuri/+page.svelte` — devine wrapper subțire
- `app/src/routes/[tenant]/clients/[clientId]/+layout.svelte` — tab „Interviuri", `grid-cols-8`

---

### Task 1: Test remote (failing) — validare client-în-tenant + assignInterviewsClient

**Files:**
- Test: `app/src/lib/remotes/__tests__/interviuri-client-assoc.test.ts`

- [ ] **Step 1.1: Scrie testul** (pattern `content-client-access.test.ts`: mock `$app/server`, fake db chain, eager-load schema reală):

```ts
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));

// CRITICAL: eager-load schema reală ÎNAINTE de orice mock (mock.module leak
// între fișiere în bun — vezi comentariul din hosting-inquiries-delete-safety).
await import('$lib/server/db/schema');

let currentEvent: any = null;
mock.module('$app/server', () => ({
	query: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	command: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	getRequestEvent: () => currentEvent
}));

mock.module('$lib/server/get-actor', () => ({
	requireStaff: async () => ({ type: 'staff', user: { id: 'u1' } })
}));

// ─── Fake DB ───
const selectQueue: Array<unknown[]> = [];
const insertedValues: unknown[] = [];
const updateCalls: Array<{ set: unknown }> = [];

function makeChain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, {
		from: () => makeChain(rows),
		innerJoin: () => makeChain(rows),
		leftJoin: () => makeChain(rows),
		where: () => makeChain(rows),
		orderBy: () => makeChain(rows),
		limit: () => makeChain(rows),
		offset: () => makeChain(rows),
		returning: () => makeChain(rows)
	});
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeChain(selectQueue.shift() ?? []),
		insert: () => ({ values: (v: unknown) => { insertedValues.push(v); return Promise.resolve(); } }),
		update: () => ({
			set: (patch: unknown) => {
				const call = { set: patch };
				updateCalls.push(call);
				return { where: () => Object.assign(Promise.resolve([]), { returning: () => Promise.resolve([{ id: 'i1' }, { id: 'i2' }]) }) };
			}
		}),
		delete: () => ({ where: () => Promise.resolve() })
	}
}));

const { createInterview, assignInterviewsClient } = await import('../interviuri.remote');

const CHANNELS = [{ id: 'ch1', tenantId: 't1', name: 'TikTok', color: '#000', icon: 'x', isSystem: true, sortOrder: 1 }];

beforeEach(() => {
	selectQueue.length = 0;
	insertedValues.length = 0;
	updateCalls.length = 0;
	currentEvent = { locals: { user: { id: 'u1' }, tenant: { id: 't1' } } };
});

describe('createInterview cu clientId', () => {
	test('clientId inexistent în tenant → aruncă eroare, nu inserează', async () => {
		selectQueue.push([]); // lookup client în tenant → gol
		await expect(
			createInterview({ nume: 'Test', dataInterviu: '2026-07-01', clientId: 'evil-client' } as any)
		).rejects.toThrow(/client/i);
		expect(insertedValues.length).toBe(0);
	});

	test('clientId valid în tenant → inserează cu clientId', async () => {
		selectQueue.push([{ id: 'lucky1' }]); // lookup client OK
		selectQueue.push([{ id: 'ch1' }]); // ensureChannelsSeeded: există canale
		selectQueue.push(CHANNELS); // channelsForTenant
		await createInterview({ nume: 'Test', dataInterviu: '2026-07-01', clientId: 'lucky1', channelId: 'ch1' } as any);
		expect(insertedValues.length).toBe(1);
		expect((insertedValues[0] as any).clientId).toBe('lucky1');
	});

	test('fără clientId → inserează cu clientId null', async () => {
		selectQueue.push([{ id: 'ch1' }]); // ensureChannelsSeeded
		selectQueue.push(CHANNELS); // channelsForTenant
		await createInterview({ nume: 'Test', dataInterviu: '2026-07-01', channelId: 'ch1' } as any);
		expect((insertedValues[0] as any).clientId).toBeNull();
	});
});

describe('assignInterviewsClient', () => {
	test('clientId inexistent în tenant → aruncă, nu face update', async () => {
		selectQueue.push([]); // lookup client → gol
		await expect(assignInterviewsClient({ clientId: 'evil', onlyUnassigned: true })).rejects.toThrow(/client/i);
		expect(updateCalls.length).toBe(0);
	});

	test('clientId valid → update cu clientId și întoarce count', async () => {
		selectQueue.push([{ id: 'lucky1' }]); // lookup client OK
		const res = await assignInterviewsClient({ clientId: 'lucky1', onlyUnassigned: true });
		expect(updateCalls.length).toBe(1);
		expect((updateCalls[0].set as any).clientId).toBe('lucky1');
		expect(res.count).toBe(2);
	});
});
```

- [ ] **Step 1.2: Rulează testul — trebuie să pice** (assignInterviewsClient nu există; createInterview nu validează clientId):

Run: `cd app && bun test src/lib/remotes/__tests__/interviuri-client-assoc.test.ts`
Expected: FAIL (`assignInterviewsClient` is not exported / clientId assertions fail)

### Task 2: Migrări DB (ÎNAINTE de schema.ts!)

**Files:**
- Create: `app/drizzle/0436_interview_client_id.sql`
- Create: `app/drizzle/0437_interview_client_idx.sql`
- Modify: `app/drizzle/meta/_journal.json`

- [ ] **Step 2.1:** `0436_interview_client_id.sql`:

```sql
ALTER TABLE `interview` ADD `client_id` text REFERENCES client(`id`);
```

- [ ] **Step 2.2:** `0437_interview_client_idx.sql`:

```sql
CREATE INDEX `interview_client_idx` ON `interview` (`client_id`);
```

- [ ] **Step 2.3:** Journal — adaugă după intrarea 0435 (when = monoton crescător, +1000 față de precedentul):

```json
{ "idx": 436, "version": "6", "when": 1784908176178853, "tag": "0436_interview_client_id", "breakpoints": true },
{ "idx": 437, "version": "6", "when": 1784908176179853, "tag": "0437_interview_client_idx", "breakpoints": true }
```

- [ ] **Step 2.4:** Aplică: `cd app && bun run db:migrate`
Expected: ambele migrări aplicate fără eroare.

- [ ] **Step 2.5:** Verifică pe remote (feedback_migration_flow): rulează scriptul de verificare PRAGMA folosit în proiect sau un one-off `bun --bun` cu clientul libSQL: `PRAGMA table_info(interview)` conține `client_id`, `PRAGMA index_list(interview)` conține `interview_client_idx`.

- [ ] **Step 2.6:** Commit: `git add app/drizzle && git commit -m "feat(interviuri): coloană client_id + index (migrări 0436-0437)"`

### Task 3: schema.ts + remote (green)

**Files:**
- Modify: `app/src/lib/server/db/schema.ts` (tabelul `interview`)
- Modify: `app/src/lib/remotes/interviuri.remote.ts`

- [ ] **Step 3.1:** În `interview` (după `tenantId`):

```ts
		clientId: text('client_id').references(() => client.id),
```

și în blocul de indexuri:

```ts
		clientIdx: index('interview_client_idx').on(t.clientId),
```

- [ ] **Step 3.2:** Remote — modificări:

1. Import `isNull` din drizzle-orm.
2. Helper validare client în tenant:

```ts
/** Validează că clientul aparține tenantului. Întoarce null pentru '' / undefined. */
async function resolveClientId(tenantId: string, clientId: string | undefined): Promise<string | null> {
	if (!clientId) return null;
	const found = await db
		.select({ id: table.client.id })
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	if (found.length === 0) throw new Error('Clientul selectat nu există');
	return clientId;
}
```

3. `getInterviews` primește argument opțional și întoarce clientId/clientName:

```ts
export const getInterviews = query(
	v.optional(v.object({ clientId: v.optional(v.pipe(v.string(), v.minLength(1))) })),
	async (filters) => {
		const event = requireCtx();
		await requireStaff(event);
		const tenantId = event.locals.tenant!.id;
		await ensureChannelsSeeded(tenantId);

		let conditions = eq(table.interview.tenantId, tenantId);
		if (filters?.clientId) {
			conditions = and(conditions, eq(table.interview.clientId, filters.clientId)) as typeof conditions;
		}

		const rows = await db
			.select({
				id: table.interview.id,
				nume: table.interview.nume,
				dataInterviu: table.interview.dataInterviu,
				dataInceput: table.interview.dataInceput,
				dataSfarsit: table.interview.dataSfarsit,
				studio: table.interview.studio,
				sursa: table.interview.sursa,
				status: table.interview.status,
				observatii: table.interview.observatii,
				channelId: table.interview.channelId,
				channelName: table.interviewChannel.name,
				channelColor: table.interviewChannel.color,
				channelIcon: table.interviewChannel.icon,
				clientId: table.interview.clientId,
				clientName: table.client.name
			})
			.from(table.interview)
			.leftJoin(table.interviewChannel, eq(table.interview.channelId, table.interviewChannel.id))
			.leftJoin(table.client, eq(table.interview.clientId, table.client.id))
			.where(conditions);

		return rows;
	}
);
```

4. `interviewSchema` + câmp: `clientId: v.optional(v.pipe(v.string(), v.maxLength(64)))`.
5. `createInterview`: `const clientId = await resolveClientId(tenantId, data.clientId);` înainte de canal; `clientId` în `values`.
6. `updateInterview`: idem în `set`.
7. Comandă nouă:

```ts
export const assignInterviewsClient = command(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1, 'Clientul este obligatoriu')),
		onlyUnassigned: v.boolean()
	}),
	async ({ clientId, onlyUnassigned }) => {
		const event = requireCtx();
		await requireStaff(event);
		const tenantId = event.locals.tenant!.id;
		await resolveClientId(tenantId, clientId);

		let conditions = eq(table.interview.tenantId, tenantId);
		if (onlyUnassigned) {
			conditions = and(conditions, isNull(table.interview.clientId)) as typeof conditions;
		}
		const updated = await db
			.update(table.interview)
			.set({ clientId, updatedAt: new Date() })
			.where(conditions)
			.returning({ id: table.interview.id });
		return { success: true, count: updated.length };
	}
);
```

- [ ] **Step 3.3:** Run: `cd app && bun test src/lib/remotes/__tests__/interviuri-client-assoc.test.ts`
Expected: PASS (toate testele verzi)

- [ ] **Step 3.4:** Commit: `git commit -m "feat(interviuri): asociere client în remote (validare tenant + bulk assign)"`

### Task 4: Mutare componente în $lib/components/interviuri + view partajat

**Files:** git mv (vezi File Structure) + Create `interviews-view.svelte` + wrappers.

- [ ] **Step 4.1:** `git mv` toate cele 9 fișiere din rută în `app/src/lib/components/interviuri/`. `+page.svelte` NU se mută (rămâne wrapper).
- [ ] **Step 4.2:** `interviews-view.svelte` = conținutul actual din `+page.svelte` cu:
  - props: `let { clientId = undefined, homeHref, embedded = false }: { clientId?: string; homeHref: string; embedded?: boolean } = $props();`
  - `getInterviews(clientId ? { clientId } : undefined)` (query-ul devine `$derived` pe clientId)
  - `import { getClients } from '$lib/remotes/clients.remote'` → `clients` (doar staff; view-ul e folosit doar în staff)
  - breadcrumbs: ascunse când `embedded`
  - filtru „Client:" în filterbar (doar când `!clientId`), aplicat în `scoped`, cu init din `?clientId=` (pattern seo-links, `$effect` + `page.url.searchParams`)
  - coloană „Client" în tabel (doar când `!clientId`), afișează `clientName` sau „—"
  - buton „Asociază cu client" în hero-actions (doar `!clientId`) → `AssignClientModal`
  - `InterviewModal` primește `clients` și `defaultClientId={clientId}`
  - export CSV: coloană `Client` adăugată
- [ ] **Step 4.3:** `InterviewModal.svelte`: prop nou `clients: { id: string; name: string }[]` + `defaultClientId?: string`; câmp formular:

```svelte
<div class="cl-field">
	<label for="iv-client">Client <span class="iv-opt">(opțional)</span></label>
	<select id="iv-client" class="cl-select" style="width:100%" bind:value={f.clientId}>
		<option value="">— Fără client —</option>
		{#each clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
	</select>
</div>
```

în `f`: `clientId: record?.clientId ?? defaultClientId ?? ''`; în `SavePayload`: `clientId?: string`; la save: `clientId: f.clientId || undefined`.

- [ ] **Step 4.4:** `AssignClientModal.svelte` (stil iv-modal): select client + text „Va asocia **{unassignedCount}** interviuri fără client cu clientul selectat." + buton confirm → `onAssign(clientId)`; părintele apelează `assignInterviewsClient({ clientId, onlyUnassigned: true }).updates(interviewsQuery)`.
- [ ] **Step 4.5:** `lib.ts`: `RawInterview` + `clientId: string | null; clientName: string | null`.
- [ ] **Step 4.6:** Wrapper `app/src/routes/[tenant]/interviuri/+page.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import InterviewsView from '$lib/components/interviuri/interviews-view.svelte';

	const tenant = $derived(page.params.tenant as string);
</script>

<InterviewsView homeHref={`/${tenant}`} />
```

- [ ] **Step 4.7:** Commit: `git commit -m "refactor(interviuri): view partajat în \$lib/components (precedent content) + asociere client în UI"`

### Task 5: Tab Interviuri în pagina clientului

**Files:**
- Create: `app/src/routes/[tenant]/clients/[clientId]/interviuri/+page.svelte`
- Modify: `app/src/routes/[tenant]/clients/[clientId]/+layout.svelte`

- [ ] **Step 5.1:** Pagina tab:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import InterviewsView from '$lib/components/interviuri/interviews-view.svelte';

	const tenant = $derived(page.params.tenant as string);
	const clientId = $derived(page.params.clientId as string);
</script>

<InterviewsView {clientId} homeHref={`/${tenant}`} embedded />
```

- [ ] **Step 5.2:** Layout: în `tabs` (după `budget`):

```ts
		{ id: 'interviuri', label: 'Interviuri', href: `/${tenantSlug}/clients/${clientId}/interviuri` },
```

în `activeTab` (înainte de access-data):

```ts
		if (currentPath.startsWith(`/${tenantSlug}/clients/${clientId}/interviuri`)) return 'interviuri';
```

și `grid-cols-7` → `grid-cols-8`.

- [ ] **Step 5.3:** Commit: `git commit -m "feat(clients): tab Interviuri în pagina clientului"`

### Task 6: Verificare

- [ ] **Step 6.1:** `svelte-autofixer` (MCP svelte) pe fiecare componentă modificată/creată: interviews-view, InterviewModal, AssignClientModal, cele 2 wrappere, layout-ul client.
- [ ] **Step 6.2:** `/build-check` (svelte-check heap 8GB) — baseline 16 err/56 warn, fără erori NOI.
- [ ] **Step 6.3:** Test browser cu testermcp (dev server din main — ATENȚIE memory `feedback_local_preview_needs_main`: dacă serverul rulează din main, schimbările de pe branch nu se văd; rulează serverul pe branch sau notează limitarea):
  - `/ots/interviuri`: filtru Client, modal cu select Client, buton „Asociază cu client" → asociere bulk cu Lucky Group; verifică count.
  - `/ots/clients/lu44x3vi4e5yom6jb2bq6mbi/interviuri`: tabul apare, view-ul filtrat pe Lucky Group, „Interviu nou" preselectează clientul.
  - Golden path + edge: client fără interviuri (empty state), interviu fără client (—).
- [ ] **Step 6.4:** `bun test src/lib/remotes/__tests__/` complet (fără regresii în suita remotes).

### Task 7: Asocierea efectivă cu Lucky Group (datele existente)

- [ ] **Step 7.1:** Din UI (`/ots/interviuri` → „Asociază cu client" → Lucky Group) — pasul e operațiune de date, se face din browser în timpul verificării 6.3, NU migrare cu ID hardcodat (feedback_no_hardcode).

---

## Self-Review (rulat)

1. **Spec coverage:** asociere = Task 2+3 (mecanism identic seoLink: FK clientId + filtrare); „apare în pagina clientului" = Task 4+5; „asociem aceste interviuri cu Lucky Group" = Task 3 (bulk command) + 4.4 (UI) + 7 (operațiunea). ✓
2. **Placeholder scan:** fără TBD; codul complet e în steps. ✓
3. **Type consistency:** `clientId?: string` în SavePayload/InterviewModal/interviewSchema; `RawInterview.clientId/clientName` null-abile aliniate cu leftJoin. `assignInterviewsClient` — același nume în test, remote și UI. ✓
