# Interviuri — filtru „Interval" cu DateRangePicker (calendarul din Rapoarte)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filtrul „Interval:" din pagina Interviuri (admin `/ots/interviuri` + portal client, același view) folosește același calendar funcțional (Popover + presetări + RangeCalendar ro-RO, 2 luni) ca `/ots/reports/facebook-ads`, în locul celor două `<input type="date">` native care nu deschid niciun picker pentru utilizator.

**Architecture:** Refolosim `$lib/components/reports/date-range-picker.svelte` (bind `since`/`until` ↔ `from`/`to` din `interviews-view.svelte`). Starea „fără interval" (`''`/`''`) rămâne validă: picker-ul afișează „Selectează perioada"; adăugăm un buton „×" lângă picker ca intervalul să poată fi golit fără „Resetează filtrele". În picker-ul partajat: (a) când `since` și `until` devin goale, golim și `calendarValue` (altfel calendarul rămâne cu vechiul interval evidențiat); (b) flag-ul `fromPreset` — ipoteza inițială (rămâne `true` după un preset și înghite prima selecție manuală) a fost INFIRMATĂ în Task 0: bits-ui nu emite `onValueChange` la setare externă a `value`, dar emite și la selecții parțiale, iar primul eveniment după un preset e mereu parțial → flag-ul e consumat inofensiv; rămâne neatins. (c) descoperite pe parcurs: `isCustomRange` bifa „Personalizat" în starea goală → cere `since && until`; prop opțional `triggerRef` ($bindable) pentru gestionarea focusului din părinte.

**Tech Stack:** Svelte 5 (runes), bits-ui Popover/RangeCalendar, `@internationalized/date`, CSS custom `interviuri.css` (tokeni `--cl-*`).

**Teste:** Repo-ul nu are infrastructură de component-testing (doar Bun unit tests pe module TS); schimbările sunt exclusiv wiring de template + un `$effect` în componente `.svelte`, fără logică pură nouă. Verificarea se face în browser (testermcp) pe golden path + edge cases + regresie pe `/ots/reports/facebook-ads`, plus `bun run test` pentru regresii în suita existentă.

---

### Task 0: Verificare ipoteze în browser (înainte de cod)

- [x] `/ots/interviuri`: baseline capturat (Chromium headless arată iconița nativă; la user, în Chrome real, nu — oricum cerința e picker-ul din Rapoarte).
- [x] `/ots/reports/facebook-ads`: „Luna trecută" → redeschis → 3–9 iul. selectat manual → aplicat la PRIMA selecție. **Ipoteza `fromPreset` e INFIRMATĂ**: bits-ui emite `onValueChange` și la selecții parțiale (`#setStartValue`/`#setEndValue` → `#updateValue`), iar primul eveniment după un preset e mereu parțial (start fără end) → flag-ul e consumat inofensiv. `fromPreset` rămâne neatins (Task 1 Step 2 se sare).

### Task 1: Picker partajat — stare goală + eliminare `fromPreset`

**Files:**
- Modify: `app/src/lib/components/reports/date-range-picker.svelte`

- [x] **Step 1: `$effect` golește calendarul când ambele capete sunt goale**

```ts
$effect(() => {
	const start = parseDateStr(since);
	const end = parseDateStr(until);
	if (start && end) {
		calendarValue = { start, end };
	} else if (!since && !until) {
		// „Selectează perioada" — fără interval evidențiat în calendar
		calendarValue = undefined;
	}
});
```

- [x] **Step 2 — SĂRIT** (Task 0 a infirmat ipoteza; `fromPreset` rămâne).

- [x] **Step 2b (descoperit la verificare):** în starea goală „Personalizat" apărea bifat, pentru că `isCustomRange = !presets.some(...)` e `true` și când `since`/`until` sunt goale →

```ts
const isCustomRange = $derived(
	!!since && !!until && !presets.some((p) => p.since === since && p.until === until)
);
```

- [x] **Step 3:** svelte-autofixer pe fișier (0 issues; `{#each presets}` primește cheie `(preset.label)`).

### Task 2: Interviuri — înlocuire inputuri native cu DateRangePicker + „×"

**Files:**
- Modify: `app/src/lib/components/interviuri/interviews-view.svelte:448-453` (markup) + import
- Modify: `app/src/lib/components/interviuri/interviuri.css:223-226`

- [x] **Step 1: import**

```ts
import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
```

- [x] **Step 2: markup** (final: wrapper `role="group" aria-labelledby="{uid}-interval-lbl"` cu `const uid = $props.id()`, `bind:triggerRef={dateRangeTrigger}` și `dateRangeTrigger?.focus()` înainte de golire — butonul dispare, focusul nu cade pe `<body>`; `<XIcon size={12} aria-hidden="true" />`)

```svelte
<div class="iv-daterange">
	<span class="cl-select-lbl">Interval:</span>
	<DateRangePicker bind:since={from} bind:until={to} />
	{#if from || to}
		<button
			type="button"
			class="iv-daterange-clear"
			aria-label="Șterge intervalul"
			title="Șterge intervalul"
			onclick={() => { from = ''; to = ''; }}
		>
			<XIcon size={12} />
		</button>
	{/if}
</div>
```

- [x] **Step 3: CSS** — șterge `.iv-date-input` / `.iv-date-input:focus` (moarte), adaugă (versiunea finală, după audit: `color: var(--cl-text-2)` pentru contrast ≥3:1 în idle, `outline: 2px solid var(--cl-accent); outline-offset: 2px` la focus în loc de halo `--cl-accent-50` (1.15:1), plus override scopat pe trigger `.iv-daterange [data-slot="popover-trigger"]` — font 12.5px, radius 7px, tokeni surface/border/text + hover — FĂRĂ `box-shadow`, ca inelul de focus Tailwind să rămână):

```css
.iv-daterange-clear { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: var(--cl-text-3); cursor: pointer; }
.iv-daterange-clear:hover { color: var(--cl-danger); background: var(--cl-danger-50); }
.iv-daterange-clear:focus-visible { outline: 0; box-shadow: 0 0 0 3px var(--cl-accent-50); }
```

- [x] **Step 4:** svelte-autofixer pe `interviews-view.svelte` (0 issues).

### Task 3: Verificare

- [x] `/build-check` (svelte-check, heap 8GB) — 0 erori / 0 avertismente.
- [x] Browser `/ots/interviuri` (testermcp, toate cele 7 puncte OK): (1) click „Interval" → se deschide popover cu presetări + 2 luni; (2) „Luna aceasta" → contorul „N din M interviuri" scade/rămâne coerent, butonul afișează eticheta; (3) interval manual (2 clickuri) → aplicat la PRIMA selecție; (4) „×" → dispare, contorul revine, butonul „Selectează perioada"; (5) „Resetează filtrele" golește intervalul; (6) schimbarea anului golește intervalul; (7) redeschis după golire → calendarul NU are interval evidențiat.
- [x] Portal client `/client/ots/interviuri` — fără sesiune de client; același component, build OK.
- [x] Regresie `/ots/reports/facebook-ads`: preset OK; custom aplicat la prima selecție. Leads `/ots/leads/facebook-ads` pornește și el cu interval gol → verificat separat.
- [x] `bun run test` — 1505 pass / 0 fail.
- [x] design-auditor + web-design-guidelines: 1 High (focus ring 1.15:1) + 2 Medium („×" idle 2.56:1; pierdere focus la unmount) + 3 Low (group label, aria-hidden, consistență trigger) — toate reparate și reverificate în browser.

### Task 4: Finalizare

- [x] Commit pe `fix/interviuri-date-range-picker`, push, propunere deploy (aștept „go").
- [x] `graphify . --update`.
