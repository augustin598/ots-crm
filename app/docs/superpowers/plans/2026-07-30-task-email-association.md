# Task ↔ Email (Gmail) Association Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Asociază emailuri din inboxul Gmail al tenantului cu un task (și implicit cu clientul task-ului), cu acces pe 3 niveluri: owner/admin = tot (căutare Gmail, asociere, corp, atașamente); staff = doar metadatele salvate; client portal = doar subiect + dată (pur informativ).

**Architecture:** Tabel nou `task_email` (many-to-many task→emailuri, stochează metadatele la momentul asocierii ca să nu apelăm Gmail la fiecare render). Remote functions noi în `task-emails.remote.ts` — orice funcție care atinge Gmail live cere rol owner/admin (`event.locals.tenantUser.role`); `getTaskEmails` servește și portalul cu shape redus și scoping forțat pe `locals.client.id`. UI: secțiune nouă sub titlu în `task-detail-body.svelte` (admin app) + pill informativ în `client-task-pills.svelte` (portal). Atașamentele se descarcă printr-un endpoint `[tenant]/api/task-emails/...` (tenant-scoped, owner/admin).

**Tech Stack:** SvelteKit 5 remote functions (query/command + valibot), Drizzle ORM + libSQL (Turso), Gmail API prin `$lib/server/gmail/client` (`searchEmails`/`getEmail`/`getAttachment` — deja folosite de supplier-invoices), bun:test cu mock.module.

**Model de acces (decis cu userul):**
| Actor | Acces |
|---|---|
| owner/admin (tenant ots) | căutare Gmail, asociere/dezasociere, corp complet, atașamente |
| staff (manager/member/viewer) | card metadate: subiect, expeditor, dată, snippet — zero Gmail live |
| client portal | subiect + dată, doar pe task-urile clientului lui; fără snippet/from/corp/atașamente |

---

## File Structure

- Create: `drizzle/0440_task_email.sql`, `drizzle/0441_task_email_task_idx.sql`, `drizzle/0442_task_email_unique_idx.sql` (un statement per fișier — regulă Turso)
- Modify: `drizzle/meta/_journal.json` (3 entries noi)
- Modify: `src/lib/server/db/schema.ts` (tabel `taskEmail` + relations + tipuri)
- Create: `src/lib/remotes/task-emails.remote.ts` (toate remote-urile noi)
- Create: `src/lib/remotes/__tests__/task-emails.remote.test.ts`
- Create: `src/routes/[tenant]/api/task-emails/[taskEmailId]/attachments/[attachmentId]/+server.ts`
- Create: `src/lib/components/task-detail/task-email-section.svelte` (card + dialog asociere + dialog corp)
- Modify: `src/lib/components/task-detail/task-detail-body.svelte` (montează secțiunea sub header, în MAIN COLUMN)
- Modify: `src/lib/components/task-detail/index.ts` (export)
- Modify: `src/lib/components/client-task/client-task-pills.svelte` (pill „Din email")
- Modify: `src/lib/components/client-task/client-task-detail-body.svelte` (fetch emails → pills)

---

### Task 1: Migrări + schema Drizzle

**Files:**
- Create: `drizzle/0440_task_email.sql`
- Create: `drizzle/0441_task_email_task_idx.sql`
- Create: `drizzle/0442_task_email_unique_idx.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/lib/server/db/schema.ts`

- [ ] **Step 1: Scrie migrarea CREATE TABLE** — `drizzle/0440_task_email.sql`:

```sql
CREATE TABLE IF NOT EXISTS `task_email` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`task_id` text NOT NULL,
	`gmail_message_id` text NOT NULL,
	`gmail_thread_id` text,
	`subject` text,
	`from_email` text,
	`snippet` text,
	`email_date` timestamp,
	`linked_by_user_id` text,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
```

- [ ] **Step 2: Indexuri (fișiere separate — un statement per fișier)**

`drizzle/0441_task_email_task_idx.sql`:
```sql
CREATE INDEX IF NOT EXISTS `task_email_tenant_task_idx` ON `task_email` (`tenant_id`,`task_id`);
```

`drizzle/0442_task_email_unique_idx.sql`:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS `task_email_task_message_uq` ON `task_email` (`task_id`,`gmail_message_id`);
```

- [ ] **Step 3: Journal** — adaugă 3 entries în `drizzle/meta/_journal.json` după idx 439 (păstrează `version: '6'`, `breakpoints: true`, `when` = timestamp curent ms, crescător):

```json
{ "idx": 440, "version": "6", "when": <now>, "tag": "0440_task_email", "breakpoints": true },
{ "idx": 441, "version": "6", "when": <now+1>, "tag": "0441_task_email_task_idx", "breakpoints": true },
{ "idx": 442, "version": "6", "when": <now+2>, "tag": "0442_task_email_unique_idx", "breakpoints": true }
```

- [ ] **Step 4: Schema Drizzle** — în `src/lib/server/db/schema.ts`, imediat după blocul `task` (după linia cu `index('task_client_idx')...]);`):

```ts
export const taskEmail = sqliteTable('task_email', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	taskId: text('task_id')
		.notNull()
		.references(() => task.id),
	gmailMessageId: text('gmail_message_id').notNull(),
	gmailThreadId: text('gmail_thread_id'),
	subject: text('subject'),
	fromEmail: text('from_email'),
	snippet: text('snippet'),
	emailDate: timestamp('email_date', { withTimezone: true, mode: 'date' }),
	linkedByUserId: text('linked_by_user_id').references(() => user.id),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`)
}, (t) => [
	index('task_email_tenant_task_idx').on(t.tenantId, t.taskId),
	uniqueIndex('task_email_task_message_uq').on(t.taskId, t.gmailMessageId)
]);
```

Plus tipuri lângă celelalte (`export type TaskEmail = typeof taskEmail.$inferSelect;` + `NewTaskEmail`).

- [ ] **Step 5: Rulează migrarea și verifică pe Turso**

Run: `bun run db:migrate`
Apoi verifică remote: `PRAGMA table_info(task_email)` (memoria feedback_migration_flow — verifică pe Turso, nu doar local).

- [ ] **Step 6: Commit** — `feat(tasks): tabel task_email pentru asocierea emailurilor Gmail`

---

### Task 2: Teste TDD pentru remote-uri

**Files:**
- Create: `src/lib/remotes/__tests__/task-emails.remote.test.ts`

Urmează pattern-ul din `content-client-access.test.ts`: mock `$app/server` (query/command → funcția brută, `getRequestEvent` → `currentEvent`), fake DB chain, eager-load schema reală înainte de mock (comentariul CRITICAL din tasks.remote.test.ts), mock `$lib/server/gmail/client` și `$lib/server/get-actor`.

- [ ] **Step 1: Scrie testele (vor pica — remote-ul nu există):**

```ts
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));

let currentEvent: any = null;
mock.module('$app/server', () => ({
	query: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	command: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	getRequestEvent: () => currentEvent
}));

const queryQueue: Array<unknown[]> = [];
const insertedValues: unknown[] = [];
const deletedWheres: unknown[] = [];
function makeChain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, {
		from: () => makeChain(rows),
		where: () => makeChain(rows),
		orderBy: () => makeChain(rows),
		limit: () => makeChain(rows),
		values: (v: unknown) => { insertedValues.push(v); return makeChain(rows); },
		returning: () => makeChain(rows)
	});
}
mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeChain(queryQueue.shift() ?? []),
		insert: () => makeChain([]),
		delete: () => ({ where: (w: unknown) => { deletedWheres.push(w); return Promise.resolve(); } })
	}
}));

await import('$lib/server/db/schema');
// mock minimal schema cu coloanele folosite (task, taskEmail, client)

const gmailCalls: Record<string, unknown[]> = { search: [], get: [] };
mock.module('$lib/server/gmail/client', () => ({
	searchEmails: async (...a: unknown[]) => { gmailCalls.search.push(a); return [{ id: 'm1', threadId: 't1' }]; },
	getEmail: async (_t: string, id: string) => ({
		id, threadId: 't1', from: 'Client X <client@x.ro>', subject: 'Cerere modificări site',
		date: new Date('2026-07-29T10:00:00Z'), body: 'Bună ziua, vă rog...', attachments: []
	}),
	getAttachment: async () => Buffer.from('x')
}));
mock.module('$lib/server/get-actor', () => ({
	requireStaff: async (ev: any) => {
		if (ev?.locals?.isClientUser || !ev?.locals?.user) throw new Error('Forbidden');
		return { kind: 'staff' };
	}
}));

const staffEvent = (role: string) => ({
	locals: {
		user: { id: 'u1' }, tenant: { id: 'T1' },
		tenantUser: { role }, isClientUser: false
	}
});
const clientEvent = (clientId: string) => ({
	locals: {
		user: { id: 'cu1' }, tenant: { id: 'T1' },
		isClientUser: true, client: { id: clientId }
	}
});
```

Cazuri (fiecare `test(...)`):
1. `searchTaskEmails` — rol `member` → throw (mesaj conține „administratorii”); rol `admin` → întoarce rezultate mapate cu subject/from/date/snippet și a apelat `searchEmails` cu tenantId `T1`.
2. `linkTaskEmail` — `member` → throw și `insertedValues` rămâne gol; `admin` cu task valid în tenant → insert cu `tenantId: 'T1'`, `taskId`, `gmailMessageId: 'm1'`, `subject` din getEmail, `linkedByUserId: 'u1'`.
3. `getTaskEmails` staff (`member`) → shape complet (are `snippet` și `fromEmail`).
4. `getTaskEmails` client user, task cu `clientId` = clientul lui → doar `{id, subject, emailDate}` (fără `snippet`/`fromEmail` în obiect); task al altui client → throw 'Task not found'.
5. `getTaskEmailBody` — `member` → throw; `admin` → întoarce body din getEmail.
6. `unlinkTaskEmail` — `member` → throw; `admin` → delete apelat.

- [ ] **Step 2: Rulează** — `bun test src/lib/remotes/__tests__/task-emails.remote.test.ts` → Expected: FAIL (modulul nu există).

---

### Task 3: `task-emails.remote.ts`

**Files:**
- Create: `src/lib/remotes/task-emails.remote.ts`

- [ ] **Step 1: Implementare completă:**

```ts
import { query, command, getRequestEvent } from '$app/server';
import { requireStaff } from '$lib/server/get-actor';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { searchEmails, getEmail } from '$lib/server/gmail/client';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Gate strict pentru orice funcție care atinge Gmail LIVE (căutare, corp,
 * asociere). Emailul e inboxul personal al adminului — doar owner/admin.
 * (decizie user 2026-07-30; staff vede doar metadatele deja salvate în DB)
 */
async function requireOwnerAdmin(event: NonNullable<ReturnType<typeof getRequestEvent>>) {
	await requireStaff(event);
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw new Error('Doar administratorii pot accesa emailurile.');
	}
}

const SNIPPET_LEN = 200;
function toSnippet(body: string): string {
	return body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN);
}

// ---- Queries ----

/**
 * Emailurile asociate unui task.
 *  - staff: metadate complete (subiect, expeditor, dată, snippet)
 *  - client portal: DOAR {id, subject, emailDate}, exclusiv pe task-urile
 *    clientului lui (scoping forțat pe locals.client.id — F8)
 */
export const getTaskEmails = query(v.pipe(v.string(), v.minLength(1)), async (taskId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

	const [task] = await db
		.select({ id: table.task.id, clientId: table.task.clientId })
		.from(table.task)
		.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
		.limit(1);
	if (!task) throw new Error('Task not found');

	if (event.locals.isClientUser) {
		if (!event.locals.client?.id || task.clientId !== event.locals.client.id) {
			throw new Error('Task not found');
		}
	} else {
		await requireStaff(event);
	}

	const rows = await db
		.select()
		.from(table.taskEmail)
		.where(and(eq(table.taskEmail.tenantId, event.locals.tenant.id), eq(table.taskEmail.taskId, taskId)))
		.orderBy(desc(table.taskEmail.emailDate));

	if (event.locals.isClientUser) {
		// Pur informativ în portal: fără snippet/expeditor/ID-uri Gmail.
		return rows.map((r) => ({ id: r.id, subject: r.subject, emailDate: r.emailDate }));
	}
	return rows;
});

// ---- Commands (Gmail live → owner/admin) ----

/** Căutare în inbox pentru dialogul de asociere. command, nu query — fără cache per-arg. */
export const searchTaskEmails = command(
	v.object({ search: v.pipe(v.string(), v.minLength(2)) }),
	async ({ search }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		await requireOwnerAdmin(event);

		const refs = await searchEmails(event.locals.tenant.id, search, 10);
		const results = await Promise.all(
			refs.map(async (ref) => {
				try {
					const email = await getEmail(event.locals.tenant!.id, ref.id);
					return {
						gmailMessageId: email.id,
						gmailThreadId: email.threadId,
						subject: email.subject,
						from: email.from,
						date: email.date,
						snippet: toSnippet(email.body)
					};
				} catch {
					return null;
				}
			})
		);
		return results.filter((r): r is NonNullable<typeof r> => r !== null);
	}
);

export const linkTaskEmail = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		gmailMessageId: v.pipe(v.string(), v.minLength(1))
	}),
	async ({ taskId, gmailMessageId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		await requireOwnerAdmin(event);

		const [task] = await db
			.select({ id: table.task.id })
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);
		if (!task) throw new Error('Task not found');

		const email = await getEmail(event.locals.tenant.id, gmailMessageId);
		await db.insert(table.taskEmail).values({
			id: generateId(),
			tenantId: event.locals.tenant.id,
			taskId,
			gmailMessageId: email.id,
			gmailThreadId: email.threadId,
			subject: email.subject,
			fromEmail: email.from,
			snippet: toSnippet(email.body),
			emailDate: email.date,
			linkedByUserId: event.locals.user.id,
			createdAt: new Date()
		});
		await getTaskEmails(taskId).refresh();
	}
);

export const unlinkTaskEmail = command(
	v.object({ taskEmailId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ taskEmailId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		await requireOwnerAdmin(event);
		await db
			.delete(table.taskEmail)
			.where(and(eq(table.taskEmail.id, taskEmailId), eq(table.taskEmail.tenantId, event.locals.tenant.id)));
	}
);

/** Corpul complet + atașamente — Gmail live, owner/admin. */
export const getTaskEmailBody = command(
	v.object({ taskEmailId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ taskEmailId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		await requireOwnerAdmin(event);

		const [row] = await db
			.select()
			.from(table.taskEmail)
			.where(and(eq(table.taskEmail.id, taskEmailId), eq(table.taskEmail.tenantId, event.locals.tenant.id)))
			.limit(1);
		if (!row) throw new Error('Email negăsit');

		const email = await getEmail(event.locals.tenant.id, row.gmailMessageId);
		return {
			subject: email.subject,
			from: email.from,
			date: email.date,
			body: email.body,
			gmailMessageId: row.gmailMessageId,
			attachments: email.attachments
		};
	}
);
```

Notă: dacă `unlinkTaskEmail`/`linkTaskEmail` au nevoie de refresh pe query — folosește `.updates(getTaskEmails(taskId))` la apel din UI (pattern standard), nu refresh în command; scoate `await getTaskEmails(taskId).refresh()` dacă tipurile nu-l acceptă în context server.

- [ ] **Step 2: Rulează testele** — `bun test src/lib/remotes/__tests__/task-emails.remote.test.ts` → Expected: PASS.

- [ ] **Step 3: Commit** — `feat(tasks): remote-uri task-emails cu gate owner/admin pe Gmail live`

---

### Task 4: Endpoint descărcare atașamente

**Files:**
- Create: `src/routes/[tenant]/api/task-emails/[taskEmailId]/attachments/[attachmentId]/+server.ts`

(Skills încărcate înainte de fișier nou +server.ts: ots-crm-dev, multi-tenant, error-handling — memoria feedback_skills_before_new_files.)

- [ ] **Step 1: Implementare:**

```ts
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireStaff } from '$lib/server/get-actor';
import { getAttachment, getEmail } from '$lib/server/gmail/client';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Doar administratorii pot descărca atașamente din email.');
	}

	const [row] = await db
		.select()
		.from(table.taskEmail)
		.where(
			and(
				eq(table.taskEmail.id, event.params.taskEmailId),
				eq(table.taskEmail.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);
	if (!row) throw error(404, 'Email negăsit');

	// Numele/mime-ul vin din mesajul Gmail (nu din query params — nu avem încredere în client)
	const email = await getEmail(event.locals.tenant.id, row.gmailMessageId);
	const meta = email.attachments.find((a) => a.id === event.params.attachmentId);
	if (!meta) throw error(404, 'Atașament negăsit');

	const buf = await getAttachment(event.locals.tenant.id, row.gmailMessageId, event.params.attachmentId);
	return new Response(new Uint8Array(buf), {
		headers: {
			'Content-Type': meta.mimeType,
			'Content-Disposition': `attachment; filename="${meta.filename.replace(/"/g, '')}"`,
			'Cache-Control': 'private, no-store'
		}
	});
};
```

- [ ] **Step 2: Commit** — `feat(tasks): endpoint descărcare atașamente email task (owner/admin)`

---

### Task 5: UI admin — secțiunea „Emailuri asociate” sub titlu

**Files:**
- Create: `src/lib/components/task-detail/task-email-section.svelte`
- Modify: `src/lib/components/task-detail/task-detail-body.svelte` (primul element din `<div class="space-y-6">` din MAIN COLUMN, ~linia 637)
- Modify: `src/lib/components/task-detail/index.ts`

Reguli: svelte-core-bestpractices încărcat; `$derived(await query)` prin `<svelte:boundary>` sau `.current`; rolul vine din `page.data.tenantUser?.role` (există în `[tenant]/+layout.server.ts` → `tenantUser`); în portal `page.data.tenantUser` e undefined → butoanele nu apar oricum, dar secțiunea se montează NUMAI în `task-detail-body` (admin app), nu în componentele `client-task/*`.

- [ ] **Step 1: Componenta `task-email-section.svelte`** — structură (schelet complet):

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import {
		getTaskEmails, searchTaskEmails, linkTaskEmail, unlinkTaskEmail, getTaskEmailBody
	} from '$lib/remotes/task-emails.remote';
	import { getClient } from '$lib/remotes/clients.remote';

	let { taskId, clientId = null }: { taskId: string; clientId?: string | null } = $props();

	const isAdmin = $derived(
		page.data.tenantUser?.role === 'owner' || page.data.tenantUser?.role === 'admin'
	);

	const emailsQuery = $derived(getTaskEmails(taskId));
	const emails = $derived(emailsQuery.current ?? []);

	const clientQuery = $derived(clientId ? getClient(clientId) : null);
	const clientEmail = $derived(clientQuery?.current?.email ?? null);

	let associateOpen = $state(false);
	let searchText = $state('');
	let searching = $state(false);
	let results = $state<Awaited<ReturnType<typeof searchTaskEmails>>>([]);
	let searchError = $state<string | null>(null);

	let bodyOpen = $state(false);
	let bodyLoading = $state(false);
	let bodyData = $state<Awaited<ReturnType<typeof getTaskEmailBody>> | null>(null);

	function openAssociate() {
		searchText = clientEmail ? `from:${clientEmail} OR to:${clientEmail}` : '';
		results = [];
		searchError = null;
		associateOpen = true;
	}
	async function runSearch() { /* searching=true; try results = await searchTaskEmails({search: searchText}) catch → searchError */ }
	async function link(messageId: string) { await linkTaskEmail({ taskId, gmailMessageId: messageId }).updates(getTaskEmails(taskId)); associateOpen = false; }
	async function unlink(id: string) { await unlinkTaskEmail({ taskEmailId: id }).updates(getTaskEmails(taskId)); }
	async function openBody(id: string) { bodyOpen = true; bodyLoading = true; try { bodyData = await getTaskEmailBody({ taskEmailId: id }); } finally { bodyLoading = false; } }
</script>
```

Markup: secțiune vizibilă doar dacă `emails.length > 0 || isAdmin` (staff fără emailuri nu vede nimic); card per email (subiect bold, from + dată muted, snippet 2 linii `line-clamp-2`); pe hover, pentru admin: buton deschide (openBody), link „Deschide în Gmail” (`https://mail.google.com/mail/u/0/#all/{gmailMessageId}`, `target="_blank" rel="noopener noreferrer"`), buton ✕ (unlink, cu `confirm()`). Dialog asociere: Input + Enter/buton Caută → listă rezultate clicabile. Dialog corp: subject/from/date + `<pre class="whitespace-pre-wrap ...">{bodyData.body}</pre>` + listă atașamente ca `<a href="/{page.params.tenant}/api/task-emails/{emailId}/attachments/{att.id}">`. Stil aliniat cu „Metadata row” existent (`rounded-xl border border-[#e5e9f0] bg-white ... dark:border-zinc-700 dark:bg-zinc-900`).

- [ ] **Step 2: Montare în `task-detail-body.svelte`** — import + ca prim element în `<div class="space-y-6">` (înainte de „Metadata row”), doar în ramura non-client:

```svelte
{#if !isClient}
	<TaskEmailSection taskId={currentTask.id} clientId={currentTask.clientId} />
{/if}
```

- [ ] **Step 3: svelte-autofixer pe ambele fișiere** → fixează tot ce raportează, re-rulează până e curat.

- [ ] **Step 4: Commit** — `feat(tasks): secțiune emailuri asociate în task detail (admin)`

---

### Task 6: Portal client — pill informativ

**Files:**
- Modify: `src/lib/components/client-task/client-task-detail-body.svelte`
- Modify: `src/lib/components/client-task/client-task-pills.svelte`

- [ ] **Step 1: Fetch în detail-body** (lângă celelalte queries):

```ts
import { getTaskEmails } from '$lib/remotes/task-emails.remote';
const taskEmailsQuery = $derived(task?.id ? getTaskEmails(task.id) : null);
const taskEmails = $derived(taskEmailsQuery?.current ?? []);
```

și pasează `emails={taskEmails}` la `<ClientTaskPills ...>`.

- [ ] **Step 2: Pill în `client-task-pills.svelte`** — prop nou `emails?: Array<{ id: string; subject: string | null; emailDate: Date | null }>` (default `[]`), după pills-urile de status/priority:

```svelte
{#each emails as e (e.id)}
	<span
		class="ct-pill inline-flex max-w-[320px] items-center gap-1.5 rounded-full bg-[#eef2ff] px-3 py-1.5 text-[12px] font-bold text-[#4f46e5]"
		title={e.subject ?? 'Email asociat'}
	>
		<MailIcon class="h-[11px] w-[11px] shrink-0" />
		<span class="truncate">Din email: {e.subject ?? 'fără subiect'}</span>
		{#if e.emailDate}<span class="shrink-0 font-semibold opacity-70">{new Date(e.emailDate).toLocaleDateString('ro-RO')}</span>{/if}
	</span>
{/each}
```

(+ `import MailIcon from '@lucide/svelte/icons/mail';`)

- [ ] **Step 3: svelte-autofixer pe ambele.**

- [ ] **Step 4: Commit** — `feat(portal): pill informativ „Din email” pe task-urile clientului`

---

### Task 7: Verificare

- [ ] `bun test src/lib/remotes/__tests__/task-emails.remote.test.ts` → PASS
- [ ] `bun test` (suite completă) → fără regresii noi
- [ ] `/build-check` (svelte-check heap 8GB, baseline 16 err/56 warn — fără erori NOI)
- [ ] testermcp: login dev (office@onetopsolution.ro / sghp910o), `/ots/tasks` → deschide un task → secțiunea apare sub titlu → asociază un email (căutare reală Gmail dacă integrarea e conectată în dev; altfel verifică error path „Gmail not connected”) → card vizibil; portal: user client temporar (tur onboarding completat — memoria portal test) → task-ul clientului → pill „Din email” cu subiect+dată, FĂRĂ snippet/buton.
- [ ] Verificare negativă F8: apel direct `searchTaskEmails` cu rol member → 403/eroare (acoperit de teste).

### Task 8: Finalizare

- [ ] Commit final + push branch `feat/task-email-association`; NU merge în main fără OK-ul userului.
- [ ] Propune deploy DOAR după „go” explicit (memoria feedback_deploy_workflow).
- [ ] `graphify . --update`.

---

## Self-Review (rulat)

- Spec coverage: acces 3 niveluri ✓ (requireOwnerAdmin pe search/link/unlink/body/attachments; staff → rows complete din DB; client → shape redus + scoping client.id); „sub titlu” ✓ (prim element în MAIN COLUMN); asociere cu clientul ✓ (implicit prin task.clientId + pre-populare căutare cu emailul clientului); portal informativ ✓ (subiect+dată, fără Gmail live).
- Placeholders: schelele din Task 5 Step 1 au corpul funcțiilor comprimat intenționat — implementarea reală le scrie complet (marcate cu comentarii ce fac).
- Type consistency: `searchTaskEmails` întoarce `gmailMessageId` (folosit în `link()`); `getTaskEmails` client-shape `{id, subject, emailDate}` = prop-ul `emails` din pills ✓.
