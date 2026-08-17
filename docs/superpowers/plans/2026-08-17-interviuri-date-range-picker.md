# Interviuri — filtru „Interval" cu DateRangePicker (calendarul din Rapoarte)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filtrul „Interval:" din pagina Interviuri (admin `/ots/interviuri` + portal client, același view) folosește același calendar funcțional (Popover + presetări + RangeCalendar ro-RO, 2 luni) ca `/ots/reports/facebook-ads`, în locul celor două `<input type="date">` native care nu deschid niciun picker pentru utilizator.

**Architecture:** Refolosim `$lib/components/reports/date-range-picker.svelte` (bind `since`/`until` ↔ `from`/`to` din `interviews-view.svelte`). Starea „fără interval" (`''`/`''`) rămâne validă: picker-ul afișează „Selectează perioada"; adăugăm un buton „×" lângă picker ca intervalul să poată fi golit fără „Resetează filtrele". În picker-ul partajat: (a) când `since` și `until` devin goale, golim și `calendarValue` (altfel calendarul rămâne cu vechiul interval evidențiat); (b) flag-ul `fromPreset` — bits-ui NU emite `onValueChange` la setare externă a `value` (verificat în `node_modules/bits-ui/dist/bits/range-calendar/range-calendar.svelte.js` L175–188 + L214–218), deci flag-ul rămâne `true` după un preset și înghite prima selecție manuală următoare → se elimină (verificare în browser înainte).

**Tech Stack:** Svelte 5 (runes), bits-ui Popover/RangeCalendar, `@internationalized/date`, CSS custom `interviuri.css` (tokeni `--cl-*`).

**Teste:** Repo-ul nu are infrastructură de component-testing (doar Bun unit tests pe module TS); schimbările sunt exclusiv wiring de template + un `$effect` în componente `.svelte`, fără logică pură nouă. Verificarea se face în browser (testermcp) pe golden path + edge cases + regresie pe `/ots/reports/facebook-ads`, plus `bun run test` pentru regresii în suita existentă.

---

### Task 0: Verificare ipoteze în browser (înainte de cod)

- [x] `/ots/interviuri`: baseline capturat (Chromium headless arată iconița nativă; la user, în Chrome real, nu — oricum cerința e picker-ul din Rapoarte).
- [x] `/ots/reports/facebook-ads`: „Luna trecută" → redeschis → 3–9 iul. selectat manual → aplicat la PRIMA selecție. **Ipoteza `fromPreset` e INFIRMATĂ**: bits-ui emite `onValueChange` și la selecții parțiale (`#setStartValue`/`#setEndValue` → `#updateValue`), iar primul eveniment după un preset e mereu parțial (start fără end) → flag-ul e consumat inofensiv. `fromPreset` rămâne neatins (Task 1 Step 2 se sare).

### Task 1: Picker partajat — stare goală + eliminare `fromPreset`

**Files:**
- Modify: `app/src/lib/components/reports/date-range-picker.svelte`

- [ ] **Step 1: `$effect` golește calendarul când ambele capete sunt goale**

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

- [ ] **Step 1: import**

```ts
import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
```

- [ ] **Step 2: markup**

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

- [ ] **Step 3: CSS** — șterge `.iv-date-input` / `.iv-date-input:focus` (moarte), adaugă:

```css
.iv-daterange-clear { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: var(--cl-text-3); cursor: pointer; }
.iv-daterange-clear:hover { color: var(--cl-danger); background: var(--cl-danger-50); }
.iv-daterange-clear:focus-visible { outline: 0; box-shadow: 0 0 0 3px var(--cl-accent-50); }
```

- [ ] **Step 4:** svelte-autofixer pe `interviews-view.svelte`.

### Task 3: Verificare

- [ ] `/build-check` (svelte-check, heap 8GB) — fără erori noi față de baseline.
- [ ] Browser `/ots/interviuri`: (1) click „Interval" → se deschide popover cu presetări + 2 luni; (2) „Luna aceasta" → contorul „N din M interviuri" scade/rămâne coerent, butonul afișează eticheta; (3) interval manual (2 clickuri) → aplicat la PRIMA selecție; (4) „×" → dispare, contorul revine, butonul „Selectează perioada"; (5) „Resetează filtrele" golește intervalul; (6) schimbarea anului golește intervalul; (7) redeschis după golire → calendarul NU are interval evidențiat.
- [ ] Browser portal client `/client/ots/interviuri` (dacă există sesiune) sau cel puțin build OK.
- [ ] Regresie `/ots/reports/facebook-ads`: preset → date se încarcă; custom → aplicat la prima selecție.
- [ ] `bun run test` — 0 fail.
- [ ] design-auditor + web-design-guidelines pe zona filtrului.

### Task 4: Finalizare

- [ ] Commit pe `fix/interviuri-date-range-picker`, push, propunere deploy (aștept „go").
- [ ] `graphify . --update`.
