# My Plans — UX redesign spec

**Date:** 2026-04-21
**Owner:** office@onetopsolution.ro
**File în scope:** [`app/src/routes/[tenant]/my-plans/+page.svelte`](../../../app/src/routes/[tenant]/my-plans/+page.svelte)

## Problemă

Pagina `/ots/my-plans` afișează un calendar lunar cu task-urile userului curent, dar pill-urile sunt colorate **exclusiv după priority**. Utilizatorul nu distinge vizual:

- task-urile **overdue** (dueDate trecută, neîncheiate)
- task-urile **done / cancelled** (amestecate vizual cu cele active)
- task-urile **in-progress vs todo**
- totalul pe stări (cât e overdue azi, cât e în lucru)
- nu poate filtra (status, priority, client, doar-overdue)
- nu există legendă — culorile nu se explică singure

Design-ul curent e descris pe linia 366 din `+page.svelte`: un singur `<div>` colorat prin `getPriorityColor()`.

## Obiective

1. În **<5s** utilizatorul poate să răspundă: *cât am overdue? cât e în lucru? ce e făcut?*
2. Statusul devine semnalul principal vizual; prioritatea rămâne un semnal secundar, vizibil dar mai discret
3. Overdue e imposibil de ratat
4. Filtrele sunt share-abile prin URL (se păstrează la reload și pot fi trimise unui coleg)
5. Nu regresăm: drag&drop, context menu, click-to-open dialog, create task rămân funcționale

## Out of scope

- Mobile redesign (pagina e desktop-first, rămâne așa)
- Vedere săptămânală / zilnică (numai lunară)
- Drag-to-resize taskuri
- Recurring tasks
- Reorder manual în celulă
- Filtrare server-side (dataset-ul e deja pe 3 luni, filtrare client-side e suficientă)

## Design

### A. Anatomie pill task

```
┌─────────────────────────────────────┐
│▌ [✓] Campanie Tiktok          │
└─────────────────────────────────────┘
 ↑   ↑                ↑
 │   icon status (de la lucide-svelte)
 border-l-4 = priority
```

Componentă nouă: `app/src/lib/components/my-plans/task-pill.svelte` care primește `{ task, isOverdue }` și render-ează:

- **Fundal + text** după grupă de status:
  - `todo` / `pending-approval` → `bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300`
  - `in-progress` / `review` → `bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300`
  - `done` → `bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300` + `line-through opacity-60`
  - `cancelled` → `bg-zinc-100 text-zinc-500 dark:bg-zinc-900/30 dark:text-zinc-400` + `line-through opacity-40 italic`
- **Border stânga** după priority: `border-l-4` cu `border-red-500` (urgent), `border-orange-500` (high), `border-blue-500` (medium), `border-emerald-500` (low), `border-gray-300` (null)
- **Iconiță status** (14×14, la stânga titlului, după bandă):
  - `todo` → `Circle` (conturat)
  - `pending-approval` → `CircleDashed`
  - `in-progress` → `CircleDot`
  - `review` → `Eye`
  - `done` → `CheckCircle2`
  - `cancelled` → `XCircle`
- **Overdue** (când `task.dueDate < today` și status nu e `done`/`cancelled`):
  - `ring-1 ring-red-500 ring-offset-1`
  - mic dot roșu (`w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse`) în colțul dreapta-sus al pill-ului
- Păstrăm `draggable`, `onclick`, `onkeydown` existente

Logica pentru `isOverdue` trăiește într-un helper pur `isTaskOverdue(task, today)` în același fișier (export named) pentru a fi testabil.

### B. Header — filtre + counter

Deasupra calendarului (între titlu și "New Task"), un toolbar nou:

```
┌────────────────────────────────────────────────────────────────────────┐
│ [Status ▾] [Priority ▾] [Client ▾] [☐ Doar overdue] [Azi]             │
│                                                                        │
│                     3 overdue · 7 today · 12 in progress               │
└────────────────────────────────────────────────────────────────────────┘
```

Componentă nouă: `app/src/lib/components/my-plans/plans-toolbar.svelte`.

**Filtrele** (toate citite din/scrise în URL prin `page.url.searchParams` + `goto(url, { replaceState: true, keepFocus: true, noScroll: true })`):

| Param | Tip | Valori |
|-------|-----|--------|
| `status` | CSV | `todo,in-progress,review,done,cancelled,pending-approval` |
| `priority` | CSV | `urgent,high,medium,low` |
| `client` | UUID | id-ul clientului |
| `overdue` | `1` | flag binar |

- Multi-select folosind `Popover` + `Checkbox` din shadcn; label: "Status (2)" când sunt selectate 2 valori
- Buton "Azi" → resetează `calendarValue` și `selectedDate` la `today(getLocalTimeZone())`
- Contorul **live** din dreapta: badge-uri clickabile (`Badge variant="outline"` cu `cursor-pointer hover:bg-accent`)
  - click pe "3 overdue" → setează `?overdue=1`
  - click pe "7 today" → setează `selectedDate = today` și deschide `isDayDialogOpen`
  - click pe "12 in progress" → setează `?status=in-progress`

### C. Celula de zi

Modificări în `+page.svelte`:

- **Weekend**: `bg-muted/20` (sâmbătă / duminică), aplicat prin `const isWeekend = date.toDate(getLocalTimeZone()).getDay() % 6 === 0`
- **Numărul zilei** capătă un dot roșu mic lângă el dacă ziua conține ≥1 overdue:
  ```svelte
  {#if overdueCountForDay > 0}
    <span class="ml-1 inline-block w-1.5 h-1.5 bg-red-500 rounded-full" aria-label="{overdueCountForDay} overdue"></span>
  {/if}
  ```
- **Filtering**: task-urile care nu match filtrul primesc `opacity-25 pointer-events-none`
  - excepție: când singurul filtru activ e `overdue=1`, ascundem complet non-overdue
- **"Today" tag**: pentru ziua de azi, un mic text `TODAY` (10px, font-semibold, uppercase, tracking-wider) sub numărul zilei

### D. Legendă

Sub Card-ul calendarului, un rând colaps-abil:

```
[▾ Legendă]    ● Todo  ● In progress  ● Done  ● Cancelled   │   ▌ Urgent  ▌ High  ▌ Medium  ▌ Low   │   ◯ Overdue
```

- Default: deschisă la primul load
- Stare `isLegendOpen` în `localStorage['my-plans-legend-open']`
- Componentă `app/src/lib/components/my-plans/plans-legend.svelte`

## Data flow

```
                    URL params (status, priority, client, overdue)
                              │
                              ▼
                    parseFilters(url) ──► filters: $derived
                              │
                              ▼
         tasksQuery ──► tasks: Task[] ──► filteredTasks: $derived ──► tasksByDate: Map<string, Task[]>
                                                │
                              ┌─────────────────┼─────────────────┐
                              ▼                 ▼                 ▼
                        overdueCount       todayCount        inProgressCount
                              │                 │                 │
                              └─────────► header counter ◄────────┘
```

- `filteredTasks` aplică filtrul status/priority/client/overdue
- `tasksByDate` se calculează din TOATE task-urile (nu din cele filtrate); decizia de a dim-ui vs ascunde se ia în celulă
- Counter-ele se calculează pe `tasks` original (nu filtrate), ca filtrele să nu ascundă realitatea — excepție overdue counter care urmărește toate task-urile indiferent de filtre active

## Componente

| Fișier | Rol |
|--------|-----|
| `app/src/lib/components/my-plans/task-pill.svelte` **(nou)** | Render pill cu status color + priority border + overdue ring |
| `app/src/lib/components/my-plans/plans-toolbar.svelte` **(nou)** | Filtre URL + counter badges |
| `app/src/lib/components/my-plans/plans-legend.svelte` **(nou)** | Legendă colaps-abilă |
| `app/src/lib/components/my-plans/filters.ts` **(nou)** | `parseFilters(url)`, `applyFilters(tasks, filters)`, `isTaskOverdue(task, today)`, `getStatusGroup(status)` |
| `app/src/routes/[tenant]/my-plans/+page.svelte` **(edit)** | Înlocuiește pill inline cu `<TaskPill>`, adaugă `<PlansToolbar>` și `<PlansLegend>`, integrează filtre |

## Error handling & edge cases

- **Filtru invalid în URL** (ex: `?priority=xyz`): validator valibot dropează valoarea necunoscută, păstrează doar valide
- **Fără task-uri după filtrare**: celulele rămân goale (ca acum), nu afișăm empty state per celulă
- **Clienți fără task-uri**: dropdown-ul "Client" listează doar clienți care au task-uri în range-ul curent (evităm listă de 500 clienți)
- **Timezone**: `isTaskOverdue` folosește `today(getLocalTimeZone())` pentru comparație, nu `new Date()` — ca să evităm off-by-one la miezul nopții
- **localStorage legendă**: citită `onMount` doar, fallback la `true` dacă parse eșuează

## Testing

**Unitare** (`filters.test.ts`):

- `isTaskOverdue`: done/cancelled nu sunt niciodată overdue; dueDate null nu e overdue; dueDate de azi nu e overdue; dueDate de ieri e overdue
- `parseFilters`: URL cu toate param-urile; URL gol; valori invalide ignorate; CSV parsing corect
- `applyFilters`: combinații AND între filtre; overdue=1 combinat cu status; client filter respectă null clientId
- `getStatusGroup`: fiecare status mapat corect la grupă

**Component** (`task-pill.test.ts`):

- Rendering: titlu, iconiță corectă per status, culori background, border-l color
- Overdue: ring + dot vizibile când `isOverdue=true`
- Done: line-through + opacity

**E2E / manual**: filtrele persistă la reload; share URL → același view; click pe counter badge aplică filtru; drag&drop continuă să funcționeze.

## Accesibilitate

- Iconițele de status au `aria-label` cu numele status-ului
- Contrast AA pentru toate combinațiile status-culoare (verificat pe `slate-800` pe `slate-100`, etc.)
- Overdue ring e vizibil; adăugăm `aria-label="Overdue: {taskTitle}"`
- Filter popovers au `role="dialog"` și focus trap
- Dot-ul roșu de pe numărul zilei are `aria-label="{n} taskuri overdue"`

## Svelte MCP

După fiecare componentă nouă, rulăm `svelte-autofixer` conform memory note `feedback_svelte_mcp_check.md`.

## Rollout

Single PR, un singur deploy. Nu e nevoie de feature flag — doar UX, nu afectează data model, nu afectează server.
