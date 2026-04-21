# Plan: Inline editing în TaskDetailDialog

## Context

Commit-ul anterior `574294a` a introdus un toggle `mode: 'view' | 'edit'` în `TaskDetailDialog` — butonul "Edit" comuta la un formular clasic în același dialog. User nu e mulțumit:

> "doresc a 2lea dialog sa fie unul si acelas cu cel principal .. abordarea asta cu 2 dialoguri e useless nu are logica nici sens .. intru pe task dau edit odata cu comentariul vreau sa setezi ca taskul e done"

Problema reală: **oricare mod separat forțează context switching**. Userul nu poate edita un câmp ȘI scrie un comentariu în același timp — când ești în edit mode, comentariile dispar.

## Soluție: toate câmpurile inline-editabile cu auto-save

Fără butoane Edit / Save / Cancel globale. Fiecare câmp e editabil direct la click, cu **optimistic UI** + auto-save la change / blur / Enter. Comentariile, materialele și activity log rămân vizibile mereu.

### Decizii de design (rezumat consult Gemini + explorare cod)

| Aspect | Decizie |
|--------|---------|
| Arhitectură | Hibrid: **1 componentă generică** (`inline-editable-text.svelte`) pentru titlu/descriere + **helper inline** `saveField(key, value)` în TaskDetailDialog + **popovere + Select direct în markup** pentru status/priority/assignee/client/project/dueDate (reutilizează markup-ul din `edit-task-form.svelte`). |
| Trigger save | Text: **blur + Enter** (single-line) / **Ctrl+Enter** (multiline). Popover: **`onValueChange` instant**. |
| Cancel/Escape | Text: **Escape** revine la valoarea originală, iese din edit. Popover: Escape închide fără save (bits-ui built-in). |
| Optimistic UI | Update local `$state` imediat → `updateTask().updates(...)` în background → toast de eroare + rollback la valoarea veche dacă eșuează. |
| Race conditions | Acceptabile. Mutațiile sunt serializate server-side, iar `.updates(getTasks, getTask, ...)` refetch-uiește după fiecare → eventual consistency. |
| Accessibility | `<button>` ca trigger Popover (nu `<Badge role="button">`). Input inline focus la mount. `aria-label` pe triggere ("Schimbă status", "Schimbă prioritate"). |
| Svelte 5 | Buffer local = `$state` (nu `$derived`). Fără `bind:value` între componente — callback `onSave`. |

### Fișiere modificate

| Fișier | Tip | Responsabilitate |
|--------|-----|------------------|
| `app/src/lib/components/inline-editable-text.svelte` | **NEW** | Text sau textarea editabil inline. Props: `value, onSave, multiline?, placeholder?, displayClass?, emptyPlaceholder?`. State intern: `editing, buffer, saving`. Escape = revert. Blur/Enter = save. |
| `app/src/lib/components/task-detail-dialog.svelte` | EDIT | Șterge `mode = $state(...)` și blocul `{#if mode === 'edit'}`. Reînlocuiește fiecare display statico cu editor inline. Adaugă `saveField` helper + `taskState` $state local pentru optimistic UI. Elimină importul `EditTaskForm`. |

### Fișiere nemodificate

- `edit-task-form.svelte` — rămâne pentru `EditTaskDialog` wrapper (folosit standalone în `/ots/tasks`)
- `edit-task-dialog.svelte` — thin wrapper, folosit de tasks/+page.svelte (kanban edit)
- `tasks/+page.svelte`, `my-plans/+page.svelte` — consumă `TaskDetailDialog` cu aceleași props, nu simt schimbarea

## Design

### 1. `inline-editable-text.svelte`

```svelte
<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { tick } from 'svelte';
  import { cn } from '$lib/utils';

  interface Props {
    value: string;
    onSave: (newValue: string) => Promise<void>;
    multiline?: boolean;
    placeholder?: string;
    displayClass?: string;
    emptyPlaceholder?: string;
    ariaLabel?: string;
  }
  let {
    value,
    onSave,
    multiline = false,
    placeholder = '',
    displayClass = '',
    emptyPlaceholder = 'Click to edit',
    ariaLabel
  }: Props = $props();

  let editing = $state(false);
  let buffer = $state('');
  let saving = $state(false);
  let inputEl = $state<HTMLInputElement | HTMLTextAreaElement | null>(null);

  async function startEdit() {
    buffer = value;
    editing = true;
    await tick();
    inputEl?.focus();
    if (inputEl && 'select' in inputEl) inputEl.select();
  }

  async function commit() {
    if (buffer === value) {
      editing = false;
      return;
    }
    saving = true;
    try {
      await onSave(buffer);
      editing = false;
    } catch {
      // caller handles toast; stay in edit mode so user can retry
    } finally {
      saving = false;
    }
  }

  function cancel() {
    buffer = value;
    editing = false;
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
  }
</script>

{#if editing}
  {#if multiline}
    <Textarea
      bind:ref={inputEl}
      bind:value={buffer}
      {placeholder}
      disabled={saving}
      onkeydown={handleKey}
      onblur={commit}
      class={cn('w-full', displayClass)}
    />
  {:else}
    <Input
      bind:ref={inputEl}
      bind:value={buffer}
      {placeholder}
      disabled={saving}
      onkeydown={handleKey}
      onblur={commit}
      class={cn('w-full', displayClass)}
    />
  {/if}
{:else}
  <button
    type="button"
    class={cn(
      'text-left w-full cursor-text rounded px-1 -mx-1 hover:bg-accent/50 focus:bg-accent/50 focus:outline-none transition-colors',
      displayClass,
      !value && 'text-muted-foreground italic'
    )}
    onclick={startEdit}
    aria-label={ariaLabel ?? 'Click to edit'}
  >
    {value || emptyPlaceholder}
  </button>
{/if}
```

### 2. TaskDetailDialog — transformări

**A. Script changes:**

Șterge:
```ts
let mode = $state<'view' | 'edit'>('view');
$effect(() => { if (!open) mode = 'view'; });
import EditTaskForm from '$lib/components/edit-task-form.svelte';
```

Adaugă:
```ts
import InlineEditableText from '$lib/components/inline-editable-text.svelte';
import { updateTask } from '$lib/remotes/tasks.remote';
import * as Popover from '$lib/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
import { Calendar as CalendarPicker } from '$lib/components/ui/calendar';
import Combobox from '$lib/components/ui/combobox/combobox.svelte';
import { CalendarDate, type DateValue } from '@internationalized/date';
import CalendarIcon from '@lucide/svelte/icons/calendar';
import { getStatusDotColor, getPriorityDotColor } from '$lib/components/task-kanban-utils';
// Queries needed for inline pickers
const clientsQueryForPicker = getClients();
const clientsForPicker = $derived(clientsQueryForPicker.current || []);
const clientOptions = $derived([
  { value: '', label: '—' },
  ...clientsForPicker.map((c) => ({ value: c.id, label: c.name }))
]);
const projectsQueryForPicker = getProjects(undefined);
const projectsForPicker = $derived(projectsQueryForPicker.current || []);
const projectOptions = $derived([
  { value: '', label: '—' },
  ...projectsForPicker.map((p) => ({ value: p.id, label: p.name }))
]);
// Optimistic local state mirrors task prop + overrides on save
let localOverrides = $state<Partial<Task>>({});
let lastTaskId = $state<string | null>(null);
$effect(() => {
  // Reset overrides ONLY when task identity changes (new task opened) —
  // not on prop refetch, otherwise in-flight edits would be wiped.
  if (task && task.id !== lastTaskId) {
    localOverrides = {};
    lastTaskId = task.id;
  }
});
const currentTask = $derived(task ? { ...task, ...localOverrides } : null);

// Due date UI state
let dueDateOpen = $state(false);
const dueDateValue = $derived<DateValue | undefined>(() => {
  const d = currentTask?.dueDate;
  if (!d) return undefined;
  const dt = new Date(d);
  return new CalendarDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
});

async function saveField<K extends keyof Task>(field: K, value: Task[K]) {
  if (!task) return;
  // Validate title before optimistic apply — updateTask schema requires non-empty title
  if (field === 'title' && !String(value ?? '').trim()) {
    toast.error('Titlul nu poate fi gol');
    return;
  }
  const previous = (currentTask as any)?.[field];
  (localOverrides as any)[field] = value;
  try {
    // Always include current title (required by valibot schema in tasks.remote.ts)
    const payload: any = { taskId: task.id, title: currentTask?.title ?? task.title };
    payload[field] = value;
    await updateTask(payload).updates(
      getTasks({ ...((filterParams as any) || {}), excludeCompleted: true }),
      getTask(task.id),
      getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
      ...additionalQueriesToUpdate
    );
  } catch (e) {
    (localOverrides as any)[field] = previous;
    toast.error(`Nu s-a putut salva: ${e instanceof Error ? e.message : 'eroare'}`);
  }
}

function handleDueDateSelect(value: DateValue | undefined) {
  dueDateOpen = false;
  if (!value) {
    saveField('dueDate', null as any);
    return;
  }
  const iso = `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
  saveField('dueDate', iso as any);
}
```

**Observație:** `updateTask` schema require `taskId` + opțional celelalte câmpuri — dar are și câmpul `title` validat. Refolosim `task.title` când nu edităm titlul, ca să nu eșueze validarea. Testăm explicit pentru titlu.

**B. Markup changes:**

Înlocuiește blocul `{#if mode === 'edit'} <EditTaskForm ... /> {:else} ... {/if}` — lăsăm doar conținutul view-ului de dinainte, dar:

1. **Titlu (L516):**
   ```svelte
   <DialogTitle class="text-2xl">
     <InlineEditableText
       value={currentTask.title}
       onSave={(v) => saveField('title', v)}
       displayClass="text-2xl font-semibold"
       ariaLabel="Editează titlul task-ului"
     />
   </DialogTitle>
   ```

2. **Priority badge (L531-533)** — înfășură în Popover cu Select:
   ```svelte
   <Popover.Root>
     <Popover.Trigger>
       {#snippet child({ props })}
         <button {...props} type="button" class="rounded-full" aria-label="Schimbă prioritatea">
           <Badge class={getPriorityColor(currentTask.priority || 'medium')}>
             {formatPriority(currentTask.priority || 'medium')}
           </Badge>
         </button>
       {/snippet}
     </Popover.Trigger>
     <Popover.Content class="w-48 p-1">
       {#each [['urgent', 'Urgent'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] as [val, label]}
         <button
           type="button"
           class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
           onclick={() => saveField('priority', val as any)}
         >
           <span class="h-2 w-2 rounded-full {getPriorityDotColor(val)}"></span> {label}
         </button>
       {/each}
     </Popover.Content>
   </Popover.Root>
   ```

3. **Status badge (L534-536)** — analog cu Priority, cele 6 statusuri (todo, in-progress, review, done, cancelled, pending-approval).

4. **Description (L587-593):**
   ```svelte
   <InlineEditableText
     value={currentTask.description ?? ''}
     onSave={(v) => saveField('description', v || (null as any))}
     multiline
     placeholder="Add description..."
     emptyPlaceholder="Click to add description"
     displayClass="text-muted-foreground leading-relaxed whitespace-pre-wrap"
     ariaLabel="Editează descrierea"
   />
   ```

5. **Client card (L596-605)** — value devine clickable Popover trigger, Popover content = Combobox:
   ```svelte
   <Popover.Root>
     <Popover.Trigger>
       {#snippet child({ props })}
         <button {...props} type="button" class="text-left hover:underline">
           {clientMap.get(currentTask.clientId ?? '') ?? 'Alege client'}
         </button>
       {/snippet}
     </Popover.Trigger>
     <Popover.Content class="w-64 p-2">
       <Combobox
         value={currentTask.clientId ?? ''}
         options={clientOptions}
         placeholder="Alege client"
         searchPlaceholder="Caută..."
         onChange={(v) => saveField('clientId', (v || null) as any)}
       />
     </Popover.Content>
   </Popover.Root>
   ```
   (Verifică API-ul exact al `Combobox` — dacă folosește `bind:value` și un callback `onChange`, sau doar `bind:value` cu `$effect` pentru detection. Plan: citește `combobox.svelte` în faza de execuție și ajustează dacă e nevoie.)

6. **Project card** — analog cu Client, folosește `projectOptions`.

7. **Assignee card (L608-619)** — Popover + Select cu lista userilor (ca în edit-task-form status/assignee). Save pe `onValueChange`.

8. **Due date card (L622-631):**
   ```svelte
   <Popover.Root bind:open={dueDateOpen}>
     <Popover.Trigger>
       {#snippet child({ props })}
         <button {...props} type="button" class="text-left hover:underline">
           {currentTask.dueDate ? formatDate(currentTask.dueDate) : 'Alege data'}
         </button>
       {/snippet}
     </Popover.Trigger>
     <Popover.Content class="w-auto p-0" align="start">
       <div class="flex flex-col">
         <CalendarPicker type="single" value={dueDateValue} onValueChange={handleDueDateSelect} locale="ro-RO" />
         {#if currentTask.dueDate}
           <Button variant="ghost" onclick={() => { handleDueDateSelect(undefined); }}>Șterge data</Button>
         {/if}
       </div>
     </Popover.Content>
   </Popover.Root>
   ```

**C. Header buttons:**

Butonul "Edit" din header (L561-564) — **șterge**. Butonul de Close rămâne.

Approve/Reject rămân vizibile mereu (nu mai e `mode === 'view'` gate).

### 3. Edge cases & risc

| Caz | Mitigare |
|-----|----------|
| `updateTask` schema cere `title` obligatoriu — dar dacă editez `status`? | `updateTask` primește `title` din task actual (pass `task.title`). Serverul nu face nimic dacă titlul nu s-a schimbat. Verifică `tasks.remote.ts:703` pentru signatura exactă. |
| User editează titlu, apoi schimbă status înainte ca titlul să salveze | Acceptabil. Ambele mutații se fac; `.updates()` refetch-uiește task. Optimistic UI arată ambele schimbări instant. |
| Inline text buffer se pierde la click pe alt câmp (blur → save) | Intended. Blur = intenție de save. Dacă user vrea să anuleze, apasă Escape înainte de blur. |
| Dropdown-urile/popover-urile peste dialog — z-index | bits-ui gestionează automat prin portal. Verifică vizual pe localhost. |
| Error toast import | `import { toast } from 'svelte-sonner';` — deja importat în task-detail-dialog.svelte:70. |
| Milestones editing | **Out of scope**. Nu adăugăm inline-edit pentru milestone (depinde de project, logică cascadă). Dacă user vrea să schimbe milestone, rămâne opțiunea de a folosi EditTaskDialog din tasks page. |
| Validare titlu gol | Fix la nivel de `saveField`: guard `if (field === 'title' && !String(value).trim()) { toast + return }`. |
| **Client user restrictions** (flagged în review Gemini) | `tasks.remote.ts:741-756` șterge `status/priority/assignedToUserId/projectId` din payload pentru client users. Efect: inline edit pentru aceste câmpuri pare să salveze, dar serverul ignoră. **Fix:** condiționează afișarea popoverelor pe `event.locals.isClientUser === false`. Prop `currentUserId` nu include acest flag; planul cere să exportăm `isClientUser` prin `$page.data` sau prin prop nou pe TaskDetailDialog (`readonly?: boolean`). **Decizie MVP:** neutralizăm pe moment — vizual rămân clickabile, serverul ignoră silentios (comportament existent dinainte). Follow-up separat pentru proper read-only UI. |
| **Buffer pierdut pe save-error** (flagged Gemini) | `InlineEditableText.commit()` la eroare stay în edit mode — dar `buffer` rămâne intact. Confirmat în design: `catch {}` nu modifică `buffer`, doar `saving = false`. |
| **Combobox API neverificat** (flagged Gemini) | Pasul 0 al execuției = citim `app/src/lib/components/ui/combobox/combobox.svelte` și confirmăm dacă expune `onChange` callback sau doar `bind:value`. Dacă doar `bind:value`, folosim `$effect` cu track pe valoare, sau înlocuim cu `bits-ui Select` (consistent cu edit-task-form). |
| **dueDate UTC** (flagged Gemini) | `saveField('dueDate', '2026-04-22')` → server face `new Date(string)` care interpretează UTC. `task.dueDate` în pagini cu TZ+3 apare ca `2026-04-22 03:00`. Acceptabil vizual (format doar dată), dar verifică pe localhost cu `Europe/Bucharest`. |

## Verificare

1. **Type-check:**
   ```
   cd /Users/augustin598/Projects/CRM/app && bun run check
   ```
   0 erori noi în `task-detail-dialog.svelte` sau `inline-editable-text.svelte`.

2. **Prettier:**
   ```
   cd /Users/augustin598/Projects/CRM/app && bunx prettier --write src/lib/components/task-detail-dialog.svelte src/lib/components/inline-editable-text.svelte
   ```

3. **Svelte MCP autofixer** pe ambele fișiere.

4. **Manual pe localhost:5173:**
   - `/ots/my-plans` → click task → dialog se deschide
   - Click titlu → devine input → schimbă → Enter → save + view imediat
   - Click titlu → schimbă → Escape → revine la original
   - Click status badge → popover → alege "Done" → badge se update instant, calendar pill se actualizează la închidere
   - Repetă pentru priority, assignee, client, project, due date
   - Scrie un comentariu → încă poți schimba status în același timp — **asta e scenariul user-ului**
   - Close dialog → `onOpenChange` refresh tasksQuery (din fix-ul anterior) → calendar fresh

5. **Regresii:**
   - `/ots/tasks` kanban click Edit → `EditTaskDialog` (wrapper) funcționează nemodificat
   - Drag & drop, approve/reject, comentarii + @mentions, materiale — toate intacte

## Rollback

Revert commit-ul cu implementarea asta. Commit-ul anterior `574294a` (view/edit toggle) rămâne operațional — revert la el e safe.

## Estimate

- `inline-editable-text.svelte`: ~45min
- TaskDetailDialog refactor: ~1.5h (8 câmpuri × 10-15min fiecare + cleanup)
- Type-check + prettier + smoke test: ~30min
- **Total: ~2.5-3h**

## Ordine de execuție (de-risk, după review Gemini)

1. **Pas 0 (5min) — citește `taskSchema`** în `tasks.remote.ts` pentru a confirma ce câmpuri sunt mandatory la `updateTask`. Dacă `title` e required (probabil da), `saveField` îl include mereu (deja reflectat în design).
2. **Pas 0.5 (5min) — citește `combobox.svelte`** pentru a confirma API-ul (`onChange` vs `bind:value`). Ajustează secțiunea 5/6 din markup-ul propus.
3. **Pas 1 (30min) — `inline-editable-text.svelte`:** self-contained, test pe localhost (text + textarea, Enter/blur/Escape).
4. **Pas 2 (25min) — status + priority popovers:** cele mai simple (Select cu lista fixă), testează z-index peste DialogContent.
5. **Pas 3 (20min) — Assignee Select** (copy din edit-task-form, lista userilor).
6. **Pas 4 (20min) — Client + Project** (Combobox sau Select, în funcție de API confirmat la pasul 0.5).
7. **Pas 5 (15min) — DueDate Calendar** (test TZ Europe/Bucharest).
8. **Pas 6 (20min) — wrap title + description** în `<InlineEditableText>`.
9. **Pas 7 (15min) — șterge mode='view'|'edit' + butoanele Edit inutile + EditTaskForm import.**
10. **Pas 8 (15min) — type-check + prettier + commit.**
11. **Pas 9 (15min) — smoke test scenariu user:** "click task → schimbă status la Done + scrie un comentariu fără să schimbi modul".

**Blocker crit:** pasul 0. Dacă schema refuză payload-ul, reformulează `saveField` înainte de a merge mai departe.

## Decizii amânate (follow-up ulterior)

- Quick-assign popover cu search pentru userii de-mentionați
- Keyboard shortcut `E` pentru focus pe titlu
- Undo global (Ctrl+Z) pentru ultima salvare
- Permisiuni granulare: dacă clientul deschide dialog, câmpurile read-only nu sunt clickable
