# Tasks Page Reactivity Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orice modificare făcută în panoul de detaliu al unui task (subtaskuri, asignați, taguri, meet) se reflectă instant pe boardul /ots/tasks — fără refresh manual; filtrele active se propagă reactiv și la coloana Done.

**Architecture:** Wave 1 (plan 2026-07-30) a introdus contextul `task-live-queries` (getter cu instanțele live `tasksQuery`/`statsTasksQuery`) dar a acoperit doar 4 handler-e din task-detail-body (saveField/approve/reject/reopen). Subtask toggle/add/delete, assignee add/remove, tag add/remove și scheduleMeet fac `.updates(getTask(id))` singur → cardul de pe board (care își ia `subtaskCount`/`subtaskDoneCount`/avatare/taguri din `getTasks(include:{...})`) rămâne stale. Fix în 3 straturi: (1) contextul devine un **registru** cu `register()/collect()` ca și TaskKanbanBoard să-și poată înscrie instanțele live de `getCompletedTasks` (azi reconstruite cu argumente nepotrivite = refresh mort); (2) contextul de filtre devine **getter** (`() => TaskFilters`) în loc de snapshot-ul primului obiect `$derived` (bugul documentat cu `svelte-ignore state_referenced_locally` — azi coloana Done ignoră schimbările de filtre); (3) toate mutațiile board-vizibile din task-detail-body trec printr-un helper `detailRefreshTargets()` care include `collect()` + `getTask(id)` + `additionalQueriesToUpdate`.

**Tech Stack:** SvelteKit 2.47 remote functions (`.updates()` face refresh DOAR pe instanța cu argumente byte-identice; `requested()` server-side nu există până în 2.58), Svelte 5 context + `$derived`, bun:test pentru registru (clasă pură).

**Invariante:**
- Paginile care NU publică registrul (portal client, /tasks/[taskId] fullpage, projects) păstrează fallback-ul actual (reconstrucție `getTasks({...filters, excludeCompleted:true})`) — comportament neschimbat.
- Reconstrucțiile `getCompletedTasks({...filterParams, page:1, pageSize:20})` din detail-body/edit-form/create-dialog/page se ȘTERG: nu s-au potrivit niciodată cu instanțele afișate (boardul construiește args cu subset explicit + `DONE_PAGE_SIZE`; devalue serializează și cheile `undefined`, deci spread-ul de filtre produce alt cache key). Registrul le înlocuiește corect.
- Fără polling/SSE (politica proiectului „no auto-polling"); „timp real" = single-flight `.updates()` pe instanțele live, în același client.

---

## File Structure

- Modify: `src/lib/components/task-live-queries-context.ts` — clasa `TaskLiveQueryRegistry` (register/collect) + `provideTaskLiveQueries()`; `getTaskLiveQueries()` întoarce registrul
- Create: `src/lib/components/__tests__/task-live-queries-registry.test.ts` — bun:test pe clasa pură
- Modify: `src/lib/components/task-filters-context.ts` — contextul stochează `() => TaskFilters`; `setTaskFilters()` nou
- Modify: `src/routes/[tenant]/tasks/+page.svelte` — publică registrul + filtrele ca getter; bulk/delete pe `collect()`
- Modify: `src/routes/[tenant]/my-plans/+page.svelte` — publică registrul + filtrele ca getter; deleteTask pe `collect()`
- Modify: `src/lib/components/task-detail/task-detail-body.svelte` — `detailRefreshTargets()` pe toate cele 12 mutații board-vizibile
- Modify: `src/lib/components/task-kanban-board.svelte` — își înregistrează `completedQueries` în registru; filtre prin getter (repară reset-ul paginării + reactivitatea coloanei Done la filtre)
- Modify: `src/lib/components/edit-task-form.svelte` — `collect()` + getter filtre; fără getCompletedTasks reconstruit
- Modify: `src/lib/components/create-task-dialog.svelte` — idem
- Modify: `src/lib/components/task-table-view.svelte` — filtre prin getter (are deja fallback-uri getTasks proprii)

**Testare:** registrul = clasă pură → bun:test (TDD). Restul e wiring context Svelte + runtime remote functions — nu se poate exercita onest în bun:test (precedent: planul wave 1); verificarea reală = scenariu complet în browser cu testermcp (Task 8) + `/build-check`.

---

### Task 1: Registrul de query-uri live (TDD)

**Files:**
- Test: `src/lib/components/__tests__/task-live-queries-registry.test.ts`
- Modify: `src/lib/components/task-live-queries-context.ts`

- [ ] **Step 1: Scrie testul care pică**

```ts
import { describe, expect, test } from 'bun:test';
import { TaskLiveQueryRegistry } from '../task-live-queries-context';

describe('TaskLiveQueryRegistry', () => {
	test('collect() gol când nu e nimic înregistrat', () => {
		const r = new TaskLiveQueryRegistry();
		expect(r.collect()).toEqual([]);
	});

	test('collect() adună instanțele din toate getter-ele, în ordinea înregistrării', () => {
		const r = new TaskLiveQueryRegistry();
		const a = { id: 'tasksQuery' };
		const b = { id: 'statsQuery' };
		const c = { id: 'completedP1' };
		r.register(() => [a, b]);
		r.register(() => [c]);
		expect(r.collect()).toEqual([a, b, c]);
	});

	test('getter-ele se citesc la momentul apelului (instanțe noi după re-derive)', () => {
		const r = new TaskLiveQueryRegistry();
		let current = [{ id: 'v1' }];
		r.register(() => current);
		current = [{ id: 'v2' }];
		expect(r.collect()).toEqual([{ id: 'v2' }]);
	});

	test('unregister scoate getter-ul; getter care întoarce null/undefined e tolerat', () => {
		const r = new TaskLiveQueryRegistry();
		const un = r.register(() => [{ id: 'x' }]);
		r.register(() => null as any);
		un();
		expect(r.collect()).toEqual([]);
	});
});
```

- [ ] **Step 2: Rulează testul — trebuie să pice**

Run: `cd app && bun test src/lib/components/__tests__/task-live-queries-registry.test.ts`
Expected: FAIL — `TaskLiveQueryRegistry` nu e exportat.

- [ ] **Step 3: Implementarea în task-live-queries-context.ts** (păstrează docblock-ul existent, adaptat):

```ts
import { getContext, setContext } from 'svelte';

export const TASK_LIVE_QUERIES_KEY = Symbol('task-live-queries');

/**
 * Registru cu instanțele de query AFIȘATE pe pagina de tasks. Mutațiile fac
 * `.updates(...registry.collect())` pe ele, în loc să reconstruiască
 * argumentele `getTasks(...)` — reconstrucția a produs bugul „task nou nu
 * apare fără refresh": instanța afișată are `include: {...}` +
 * `excludeCompleted` condițional, iar orice nepotrivire de argumente
 * înseamnă alt cache entry, deci refresh pe o listă pe care n-o vede nimeni.
 *
 * E registru (nu un singur getter) ca și componentele copil care afișează
 * propriile instanțe (ex. TaskKanbanBoard cu paginile de getCompletedTasks)
 * să și le poată înscrie. Getter-ele se apelează la momentul `collect()` ca
 * să citească instanțele `$derived` curente.
 */
export type TaskLiveQueries = () => any[];

export class TaskLiveQueryRegistry {
	#getters = new Set<TaskLiveQueries>();

	register(getter: TaskLiveQueries): () => void {
		this.#getters.add(getter);
		return () => this.#getters.delete(getter);
	}

	collect(): any[] {
		const out: any[] = [];
		for (const getter of this.#getters) {
			const queries = getter();
			if (queries) out.push(...queries);
		}
		return out;
	}
}

/** Pagina creează registrul, îl publică în context și își înscrie instanțele. */
export function provideTaskLiveQueries(pageQueries: TaskLiveQueries): TaskLiveQueryRegistry {
	const registry = new TaskLiveQueryRegistry();
	registry.register(pageQueries);
	setContext(TASK_LIVE_QUERIES_KEY, registry);
	return registry;
}

/** Undefined pe paginile care nu publică registrul — consumatorii au fallback. */
export function getTaskLiveQueries(): TaskLiveQueryRegistry | undefined {
	return getContext<TaskLiveQueryRegistry>(TASK_LIVE_QUERIES_KEY);
}
```

Notă: `setTaskLiveQueries` dispare — singurul apelant era pagina de tasks (migrată în Task 4). Grep de siguranță: `grep -rn "setTaskLiveQueries" src` trebuie să rămână gol după Task 4-5.

- [ ] **Step 4: Rulează testul — trece**

Run: `cd app && bun test src/lib/components/__tests__/task-live-queries-registry.test.ts`
Expected: PASS (4 teste).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(tasks): registru de instanțe live de query (register/collect) cu teste"`

---

### Task 2: Contextul de filtre devine getter reactiv

**Files:**
- Modify: `src/lib/components/task-filters-context.ts`

- [ ] **Step 1: Schimbă contractul** (tipul `TaskFilters` rămâne neschimbat):

```ts
import { getContext, setContext } from 'svelte';

export const TASK_FILTERS_CONTEXT_KEY = Symbol('task-filters');

export type TaskFilters = {
	status?: string | string[];
	priority?: string | string[];
	assignee?: string | string[];
	project?: string | string[];
	milestone?: string | string[];
	search?: string;
	dueDate?: string;
	sortBy?: string;
	sortDir?: 'asc' | 'desc';
};

/**
 * Contextul stochează un GETTER, nu obiectul: `filterParams` e `$derived` în
 * pagină și produce un obiect NOU la fiecare recalcul — `setContext(obj)`
 * captura primul obiect pentru totdeauna (de-aia exista
 * `svelte-ignore state_referenced_locally`), deci consumatorii vedeau filtre
 * stale și coloana Done nu reacționa la schimbarea filtrelor. Apelul
 * getter-ului într-un context reactiv ($derived/$effect) urmărește
 * dependența; apelul în handler citește valoarea curentă.
 */
export type TaskFiltersGetter = () => TaskFilters;

export function setTaskFilters(getter: TaskFiltersGetter) {
	setContext(TASK_FILTERS_CONTEXT_KEY, getter);
}

export function getTaskFilters(): TaskFiltersGetter | undefined {
	return getContext<TaskFiltersGetter>(TASK_FILTERS_CONTEXT_KEY);
}
```

- [ ] **Step 2: Grep consumatori** — `grep -rn "getTaskFilters\|TASK_FILTERS_CONTEXT_KEY" src` → lista exactă (task-detail-body, task-kanban-board, task-table-view, edit-task-form, create-task-dialog, tasks/+page, my-plans/+page). Toți se migrează în Task 3-7; până atunci build-check va semnala tipurile — normal, se face totul într-un singur commit la finalul Task 7 dacă e nevoie, dar preferă commit per task cu tot lanțul compilabil: fă Task 2 împreună cu Task 3-7 în aceeași sesiune de lucru.

- [ ] **Step 3: Commit** (după ce consumatorii din Task 3-7 compilează) — vezi Task 7 Step final.

---

### Task 3: task-detail-body — toate mutațiile board-vizibile refresh listele

**Files:**
- Modify: `src/lib/components/task-detail/task-detail-body.svelte`

- [ ] **Step 1: Adaptează consumul de context** (liniile ~106-115):

```ts
const getFilters = getTaskFilters();
const liveTaskQueries = getTaskLiveQueries();

// Țintele de refresh pentru lista/statisticile paginii gazdă. Fallback pe
// vechea reconstrucție de argumente când pagina nu publică instanțele live.
function listRefreshTargets(): any[] {
	const collected = liveTaskQueries?.collect();
	if (collected?.length) return collected;
	return [getTasks({ ...(getFilters?.() ?? {}), excludeCompleted: true })];
}

// Toate mutațiile din panou care schimbă date vizibile pe board/listă trec
// pe aici: lista+statisticile gazdei, detaliul si query-urile pasate de gazdă.
function detailRefreshTargets(): any[] {
	if (!task) return [];
	return [...listRefreshTargets(), getTask(task.id), ...additionalQueriesToUpdate];
}
```

- [ ] **Step 2: Migrează cele 12 handler-e** — înlocuiește fiecare listă `.updates(...)`:

| Handler | Înainte | După |
|---|---|---|
| `saveField` (~404) | `...listRefreshTargets(), getTask, getCompletedTasks({...})` , `...additionalQueriesToUpdate` | `...detailRefreshTargets()` |
| `handleApprove` (~427) | idem | `...detailRefreshTargets()` |
| `handleReject` (~446) | idem | `...detailRefreshTargets()` |
| `handleReopen` (~465) | idem | `...detailRefreshTargets()` |
| `handleToggleSubtask` (~534) | `getTask(task.id)` | `...detailRefreshTargets()` |
| `handleAddSubtask` (~545) | `getTask(task.id)` | `...detailRefreshTargets()` |
| `handleDeleteSubtask` (~555) | `getTask(task.id)` | `...detailRefreshTargets()` |
| `handleAddAssignee` (~565) | `getTask(task.id)` | `...detailRefreshTargets()` |
| `handleRemoveAssignee` (~575) | `getTask(task.id), getTasks({...reconstruit})` | `...detailRefreshTargets()` |
| `handleAddTag` (~588) | `getTask(task.id)` | `...detailRefreshTargets()` |
| `handleRemoveTag` (~597) | `getTask(task.id)` | `...detailRefreshTargets()` |
| `handleSaveMeet` (~614) | `getTask(task.id)` | `...detailRefreshTargets()` |

Exemplu (toggle):

```ts
await toggleSubtask({ subtaskId, done }).updates(...detailRefreshTargets());
```

NU se ating: `handleLinkMaterial`/`handleUnlinkMaterial`/`handleUploadMaterial` (materialele nu apar pe board; au deja wiring corect pe query-urile lor lazy).

- [ ] **Step 3: Curăță importurile** — `getCompletedTasks` rămâne doar dacă mai e folosit (nu va mai fi) → scoate-l din import.

---

### Task 4: Pagina /ots/tasks publică registrul + filtrele getter

**Files:**
- Modify: `src/routes/[tenant]/tasks/+page.svelte`

- [ ] **Step 1: Migrează publicarea contextelor** (liniile ~96-122):

```ts
setTaskFilters(() => filterParams);
```

(înlocuiește `setContext(TASK_FILTERS_CONTEXT_KEY, filterParams)` + șterge comentariul `svelte-ignore state_referenced_locally` și importul `setContext`/`TASK_FILTERS_CONTEXT_KEY` dacă rămân nefolosite)

```ts
const liveQueryRegistry = provideTaskLiveQueries(() => [tasksQuery, statsTasksQuery]);
const liveTaskQueries = () => liveQueryRegistry.collect();
```

(înlocuiește `const liveTaskQueries = () => [tasksQuery, statsTasksQuery]; setTaskLiveQueries(liveTaskQueries);` — apelurile existente `.updates(...liveTaskQueries())` din bulk handlers rămân valide și acum includ și paginile Done înregistrate de board)

- [ ] **Step 2: `handleDeleteTask` (~389)** — scoate reconstrucția:

```ts
await deleteTask(taskId).updates(...liveTaskQueries());
```

(`getCompletedTasks({ ...filterParams, page: 1, pageSize: 20 })` dispare — registrul acoperă instanțele reale; scoate importul `getCompletedTasks` dacă rămâne nefolosit)

---

### Task 5: my-plans publică și el registrul (aceleași componente partajate)

**Files:**
- Modify: `src/routes/[tenant]/my-plans/+page.svelte`

- [ ] **Step 1:** înlocuiește `setContext(TASK_FILTERS_CONTEXT_KEY, filterParams)` (~97) cu `setTaskFilters(() => filterParams)` și adaugă după `tasksQuery` (~99-104):

```ts
const liveQueryRegistry = provideTaskLiveQueries(() => [tasksQuery]);
```

- [ ] **Step 2: `handleDeleteTask` (~225)** — `getTasks({ ...filterParams })` reconstruit NU se potrivește cu instanța afișată (are `include: {...}`) → lista rămânea stale după delete:

```ts
await deleteTask(taskId).updates(...liveQueryRegistry.collect());
```

---

### Task 6: task-kanban-board — filtre reactive + înregistrare completedQueries

**Files:**
- Modify: `src/lib/components/task-kanban-board.svelte`

- [ ] **Step 1: Context** (~57-61):

```ts
const getFilters = getTaskFilters();
const liveTaskQueries = getTaskLiveQueries();
```

- [ ] **Step 2: Toate citirile de filtre devin apeluri de getter:**
  - `$effect` reset paginare (~116-119): `getFilters?.();` în loc de `filterParams;` (apelul în $effect urmărește `$derived`-ul paginii → reset-ul chiar se declanșează acum la schimbarea filtrelor)
  - `completedQueries` `$derived.by` (~122-123): `const fp = (getFilters?.() ?? {}) as any;` (citirea în $derived urmărește filtrele → coloana Done se reconstruiește la schimbarea filtrelor — azi nu o face)
  - `buildCompletedQueryArgs` (~266-267): `const fp = (getFilters?.() ?? {}) as any;`

- [ ] **Step 3: Înregistrează instanțele Done în registru** (imediat după `completedQueries`):

```ts
// Boardul își înscrie paginile Done afișate în registrul gazdei, ca mutațiile
// din panou/dialoguri (done, approve, delete) să le poată reîmprospăta.
$effect(() => liveTaskQueries?.register(() => completedQueries));
```

(corpul nu citește stare reactivă → rulează o dată; return-ul e funcția de unregister → cleanup la destroy)

- [ ] **Step 4: `buildPositionUpdates` (~285-295)** — pe registru, cu fallback intact:

```ts
function buildPositionUpdates(involvesDone: boolean) {
	const collected = liveTaskQueries?.collect();
	// Registrul include deja paginile Done înregistrate la Step 3.
	if (collected?.length) return collected;
	const updates: any[] = [getTasks({ ...(getFilters?.() ?? {}), excludeCompleted: true })];
	if (involvesDone) {
		for (let p = 1; p <= doneLoadedPages; p++) {
			updates.push(getCompletedTasks(buildCompletedQueryArgs(p)));
		}
	}
	return updates;
}
```

---

### Task 7: edit-task-form, create-task-dialog, task-table-view

**Files:**
- Modify: `src/lib/components/edit-task-form.svelte`
- Modify: `src/lib/components/create-task-dialog.svelte`
- Modify: `src/lib/components/task-table-view.svelte`

- [ ] **Step 1: edit-task-form** (~35-38, ~209-216):

```ts
const getFilters = getTaskFilters();
const liveTaskQueries = getTaskLiveQueries();

function listRefreshTargets(): any[] {
	const collected = liveTaskQueries?.collect();
	if (collected?.length) return collected;
	return [getTasks({ ...(getFilters?.() ?? {}), excludeCompleted: true })];
}
```

și la submit:

```ts
await updateTask(payload).updates(
	...listRefreshTargets(),
	getTask(task.id),
	...additionalQueriesToUpdate
);
```

(`getCompletedTasks({...filterParams, page:1, pageSize:20})` dispare + import curățat)

- [ ] **Step 2: create-task-dialog** (~63-66, ~460-466) — identic (fără `getTask`, taskul e nou):

```ts
await createTask({ ... }).updates(...listRefreshTargets(), ...additionalQueriesToUpdate);
```

- [ ] **Step 3: task-table-view** (~81, ~102, ~127): `const getFilters = getTaskFilters();` și cele două `getTasks({ ...(filterParams as any) })` devin `getTasks({ ...(getFilters?.() ?? {}) })`. (Observație: acestea sunt fallback-uri istorice proprii — dacă componenta primește deja live queries prin context, înlocuiește cu `listRefreshTargets()` local identic cu Step 1; verifică la implementare ce mutații are fișierul.)

- [ ] **Step 4: Build întreg lanțul** — `grep -rn "setTaskLiveQueries\|TASK_FILTERS_CONTEXT_KEY" src` → doar definițiile din context files; apoi commit:

```bash
git add -A && git commit -m "fix(tasks): boardul reflectă instant modificările din panoul de detaliu

- registru live-queries (board își înscrie paginile Done)
- contextul de filtre devine getter (coloana Done reacționează la filtre)
- toate mutațiile din task-detail-body refresh lista+statisticile
- eliminate reconstrucțiile getCompletedTasks cu argumente nepotrivite"
```

---

### Task 8: Verificare

- [ ] **Step 1:** `mcp svelte-autofixer` pe fiecare .svelte modificat (task-detail-body, task-kanban-board, edit-task-form, create-task-dialog, task-table-view, tasks/+page, my-plans/+page).
- [ ] **Step 2:** `/build-check` (svelte-check heap 8GB) — baseline 16 err/56 warn, fără erori NOI.
- [ ] **Step 3:** `bun test src/lib/components/__tests__/task-live-queries-registry.test.ts` — PASS.
- [ ] **Step 4 (testermcp, golden path):** login dev (office@onetopsolution.ro), deschide `/ots/tasks?taskId=<task cu subtaskuri>`, bifează un subtask în panou → progresul de pe cardul din board se schimbă FĂRĂ reload; adaugă/șterge un subtask → contorul cardului se schimbă; adaugă un membru → avatarul apare pe card.
- [ ] **Step 5 (edge):** schimbă un filtru (ex. prioritate) cu coloana Done vizibilă → coloana Done se refiltrează; marchează un task done din panou → apare în coloana Done fără reload.

### Task 9: Finalizare

- [ ] superpowers:verification-before-completion, apoi superpowers:requesting-code-review; fixuri; commit final; propune deploy (așteaptă „go").
