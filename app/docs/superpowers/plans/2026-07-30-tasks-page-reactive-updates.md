# Tasks Page Reactive Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orice mutație pe /ots/tasks (creare, editare, drag status, delete, duplicate, bulk) actualizează instant lista + statisticile, fără refresh manual.

**Architecture:** Cauza: componentele care mută reconstruiesc `getTasks(...)` din filtrele partajate, dar instanța AFIȘATĂ de pagină are argumente în plus (`include: {subtasks, tags, assignees}` + `excludeCompleted` condițional) → `.updates()` reîmprospătează intrări de cache pe care nu le afișează nimeni. Fix: pagina publică printr-un context un getter care întoarce **exact instanțele ei live** (`tasksQuery`, `statsTasksQuery`); toate mutațiile fac `.updates(...liveQueries())` în loc să ghicească argumentele. Componentele păstrează fallback pe comportamentul actual când contextul lipsește (paginile my-plans / projects / portal rămân neschimbate funcțional).

**Tech Stack:** SvelteKit 2.47 remote functions (`.updates()` face refresh single-flight DOAR pe instanța cu argumente identice; `requested()` server-side nu există până în 2.58 — de aceea soluția e client-side), Svelte 5 context + `$derived`.

**Bug secundar cunoscut (nu-l atingem, doar îl ocolim):** `setContext(TASK_FILTERS_CONTEXT_KEY, filterParams)` capturează valoarea inițială a `$derived`-ului (vezi `svelte-ignore state_referenced_locally` în pagină) — consumatorii pot vedea filtre STALE. Getter-ul de instanțe live ocolește complet problema: funcția e stabilă, instanțele se citesc la momentul apelului.

---

## File Structure

- Create: `src/lib/components/task-live-queries-context.ts` — cheia de context + set/get, un singur rol
- Modify: `src/routes/[tenant]/tasks/+page.svelte` — publică getter-ul; înlocuiește `getStatsRefreshQueries()`; repară `handleDeleteTask`
- Modify: `src/lib/components/create-task-dialog.svelte` — `.updates()` pe instanțele live (fallback: vechiul comportament)
- Modify: `src/lib/components/edit-task-form.svelte` — idem
- Modify: `src/lib/components/task-detail/task-detail-body.svelte` — idem (4 handler-e, printr-un helper local)
- Modify: `src/lib/components/task-kanban-board.svelte` — `buildPositionUpdates()` pe instanțele live

**Testare:** logica e wiring de instanțe prin context Svelte + runtime-ul remote functions — nu se poate exercita onest în bun:test; verificarea reală e scenariul complet în browser cu testermcp (Task 7). Nu se scriu teste unit de formă.

---

### Task 1: Modulul de context

**Files:**
- Create: `src/lib/components/task-live-queries-context.ts`

- [ ] **Step 1: Scrie modulul:**

```ts
import { getContext, setContext } from 'svelte';

export const TASK_LIVE_QUERIES_KEY = Symbol('task-live-queries');

/**
 * Getter pentru instanțele de query AFIȘATE de pagina de tasks (lista +
 * statisticile). Mutațiile fac `.updates(...getter())` pe ele, în loc să
 * reconstruiască argumentele `getTasks(...)` — reconstrucția a produs bugul
 * „task nou nu apare fără refresh”: instanța afișată are `include: {...}` +
 * `excludeCompleted` condițional, iar orice nepotrivire de argumente
 * înseamnă alt cache entry, deci refresh pe o listă pe care n-o vede nimeni.
 *
 * E funcție (nu array) ca să citească instanțele $derived la momentul
 * apelului — contextul de filtre partajat capturează valori stale.
 */
export type TaskLiveQueries = () => any[];

export function setTaskLiveQueries(getter: TaskLiveQueries) {
	setContext(TASK_LIVE_QUERIES_KEY, getter);
}

/** Undefined pe paginile care nu publică getter-ul — consumatorii au fallback. */
export function getTaskLiveQueries(): TaskLiveQueries | undefined {
	return getContext<TaskLiveQueries>(TASK_LIVE_QUERIES_KEY);
}
```

- [ ] **Step 2: Commit** — `git add src/lib/components/task-live-queries-context.ts && git commit -m "feat(tasks): context pentru instanțele live de query ale paginii de tasks"`

---

### Task 2: Pagina /ots/tasks publică instanțele + își repară propriile mutații

**Files:**
- Modify: `src/routes/[tenant]/tasks/+page.svelte`

- [ ] **Step 1: Import + publicare context** — lângă `setContext(TASK_FILTERS_CONTEXT_KEY, filterParams)` (linia ~98):

```ts
import { setTaskLiveQueries } from '$lib/components/task-live-queries-context';
```

și imediat DUPĂ definirea `tasksQuery`/`statsTasksQuery` (linia ~115):

```ts
// Instanțele live pe care orice mutație (dialog, kanban, panel) trebuie să le
// reîmprospăteze. Getter — citește $derived-urile la momentul apelului.
const liveTaskQueries = () => [tasksQuery, statsTasksQuery];
setTaskLiveQueries(liveTaskQueries);
```

Notă: `setTaskLiveQueries` trebuie apelat în init (top-level `<script>`), nu într-un handler — regulă `setContext`. Iar `tasksQuery`/`statsTasksQuery` sunt referite într-o closure, nu la init → nu declanșează `state_referenced_locally`.

- [ ] **Step 2: Înlocuiește `getStatsRefreshQueries()`** (linia ~293) — ștergi funcția:

```ts
// ȘTERGE:
function getStatsRefreshQueries() {
	return [
		getTasks({
			...filterParams,
			excludeCompleted:
				view.current === 'kanban' && !filterParams.status ? true : undefined,
			include: { subtasks: true, tags: true, assignees: true }
		}),
		getTasks({ ...filterParams })
	];
}
```

și în cele 3 apeluri (`handleBulkPause`, `handleBulkDuplicate`, `handleBulkDelete`) înlocuiești `...getStatsRefreshQueries()` cu `...liveTaskQueries()`.

- [ ] **Step 3: Repară `handleDeleteTask`** (linia ~394) — vechiul cod ratează `include`:

```ts
// ÎNAINTE:
await deleteTask(taskId).updates(
	getTasks({ ...filterParams, excludeCompleted: view.current === 'kanban' && !filterParams.status ? true : undefined }),
	getCompletedTasks({ ...(filterParams as any), page: 1, pageSize: 20 })
);
// DUPĂ:
await deleteTask(taskId).updates(
	...liveTaskQueries(),
	getCompletedTasks({ ...(filterParams as any), page: 1, pageSize: 20 })
);
```

- [ ] **Step 4: svelte-autofixer pe fișier, apoi commit** — `fix(tasks): mutațiile paginii reîmprospătează instanțele live, nu reconstrucții de argumente`

---

### Task 3: create-task-dialog

**Files:**
- Modify: `src/lib/components/create-task-dialog.svelte`

- [ ] **Step 1: Import + init** — lângă `const filterParams = getTaskFilters();` (linia ~62):

```ts
import { getTaskLiveQueries } from '$lib/components/task-live-queries-context';
// Instanțele live ale paginii gazdă (undefined pe paginile care nu le publică).
const liveTaskQueries = getTaskLiveQueries();
```

- [ ] **Step 2: `.updates()` în `handleCreate`** (linia ~456):

```ts
// ÎNAINTE:
}).updates(
	getTasks({ ...((filterParams as any) || {}), excludeCompleted: true }),
	getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
	...additionalQueriesToUpdate
);
// DUPĂ:
}).updates(
	...(liveTaskQueries?.() ?? [getTasks({ ...((filterParams as any) || {}), excludeCompleted: true })]),
	getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
	...additionalQueriesToUpdate
);
```

- [ ] **Step 3: svelte-autofixer + commit** — `fix(tasks): task creat apare instant — dialogul reîmprospătează instanțele live`

---

### Task 4: edit-task-form

**Files:**
- Modify: `src/lib/components/edit-task-form.svelte`

- [ ] **Step 1: Import + init** — lângă `const filterParams = getTaskFilters();` (linia ~34):

```ts
import { getTaskLiveQueries } from '$lib/components/task-live-queries-context';
const liveTaskQueries = getTaskLiveQueries();
```

- [ ] **Step 2: `.updates()`** (linia ~205) — același înainte/după ca la Task 3 Step 2 (păstrează neschimbate celelalte intrări din listă: `getTask(...)` dacă există, `getCompletedTasks(...)`, `...additionalQueriesToUpdate`; se înlocuiește DOAR intrarea `getTasks({ ...filterParams, excludeCompleted: true })` cu spread-ul `...(liveTaskQueries?.() ?? [getTasks({ ...((filterParams as any) || {}), excludeCompleted: true })])`).

- [ ] **Step 3: svelte-autofixer + commit** — `fix(tasks): editarea reîmprospătează instanțele live`

---

### Task 5: task-detail-body (saveField, approve, reject, reopen)

**Files:**
- Modify: `src/lib/components/task-detail/task-detail-body.svelte`

- [ ] **Step 1: Import + helper local** — lângă `const filterParams = getTaskFilters();` (linia ~105):

```ts
import { getTaskLiveQueries } from '$lib/components/task-live-queries-context';
const liveTaskQueries = getTaskLiveQueries();

// Țintele de refresh pentru lista/statisticile paginii gazdă. Fallback pe
// vechea reconstrucție de argumente când pagina nu publică instanțele live.
function listRefreshTargets(): any[] {
	return liveTaskQueries?.() ?? [getTasks({ ...((filterParams as any) || {}), excludeCompleted: true })];
}
```

- [ ] **Step 2: Cele 4 handler-e** — în `saveField` (linia ~382), `handleApprove` (~405), `handleReject` (~424), `handleReopen` (~443), înlocuiește PRIMA intrare din `.updates(...)`:

```ts
// ÎNAINTE (identic în toate 4):
.updates(
	getTasks({ ...((filterParams as any) || {}), excludeCompleted: true }),
	getTask(task.id),
	getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
	...additionalQueriesToUpdate
);
// DUPĂ (identic în toate 4):
.updates(
	...listRefreshTargets(),
	getTask(task.id),
	getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
	...additionalQueriesToUpdate
);
```

(Handler-ele de subtask/assignee/materiale rămân pe `getTask(task.id)` — corect, ele nu schimbă lista.)

- [ ] **Step 3: svelte-autofixer + commit** — `fix(tasks): panelul de detaliu reîmprospătează instanțele live`

---

### Task 6: task-kanban-board (drag & drop status/poziție)

**Files:**
- Modify: `src/lib/components/task-kanban-board.svelte`

- [ ] **Step 1: Import + init** — lângă `const filterParams = getTaskFilters();` (linia ~57):

```ts
import { getTaskLiveQueries } from '$lib/components/task-live-queries-context';
const liveTaskQueries = getTaskLiveQueries();
```

- [ ] **Step 2: `buildPositionUpdates`** (linia ~281):

```ts
// ÎNAINTE:
function buildPositionUpdates(involvesDone: boolean) {
	const updates: any[] = [
		getTasks({ ...(filterParams as any || {}), excludeCompleted: true })
	];
	if (involvesDone) {
		for (let p = 1; p <= doneLoadedPages; p++) {
			updates.push(getCompletedTasks(buildCompletedQueryArgs(p)));
		}
	}
	return updates;
}
// DUPĂ:
function buildPositionUpdates(involvesDone: boolean) {
	const updates: any[] = [
		...(liveTaskQueries?.() ?? [getTasks({ ...(filterParams as any || {}), excludeCompleted: true })])
	];
	if (involvesDone) {
		for (let p = 1; p <= doneLoadedPages; p++) {
			updates.push(getCompletedTasks(buildCompletedQueryArgs(p)));
		}
	}
	return updates;
}
```

- [ ] **Step 3: svelte-autofixer + commit** — `fix(tasks): drag-ul din kanban reîmprospătează instanțele live`

---

### Task 7: Verificare

- [ ] `NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning` → 0 erori în fișierele atinse (erorile din `new_design/` sunt ale altei sesiuni — ignoră DOAR pe acelea)
- [ ] `bun test` → fără regresii noi față de baseline
- [ ] **testermcp** (dev server din main cu branch-ul merged sau direct pe branch): login `office@onetopsolution.ro`/`sghp910o` → `/ots/tasks`:
  1. View **Tabel** → „Task nou" → creezi un task de test → **apare instant în listă + Total active crește**, fără reload
  2. View **Kanban** → task-ul e în coloana lui → **drag** în altă coloană → rămâne acolo, fără reload
  3. Deschizi task-ul în panel → schimbi statusul din header → coloana/lista se actualizează instant
  4. Selectezi task-ul de test → **bulk delete** → dispare instant + stats scad
  5. La final: task-ul de test e ȘTERS (nu lăsa gunoaie pe PROD — DB-ul dev = Turso PROD)
- [ ] Verifică că `/client/[tenant]/tasks` (portal) încă funcționează la creare (fallback-ul fără context) — smoke vizual

### Task 8: Finalizare

- [ ] Merge branch → main, push; propune deploy și AȘTEAPTĂ „go"
- [ ] `graphify . --update`

---

## Self-Review (rulat)

- Spec coverage: toate mutațiile paginii ✓ (create Task 3, edit Task 4, panel status/approve/reject/reopen Task 5, drag Task 6, delete/bulk Task 2); statisticile ✓ (statsTasksQuery e în getter); alte pagini nefracturate ✓ (fallback identic cu comportamentul actual).
- Placeholders: niciun TBD; fiecare modificare are cod înainte/după.
- Type consistency: `liveTaskQueries` e `TaskLiveQueries | undefined` peste tot; `listRefreshTargets()` doar în task-detail-body; getter-ul paginii întoarce `[tasksQuery, statsTasksQuery]` — instanțe valide pentru `.updates()`.
