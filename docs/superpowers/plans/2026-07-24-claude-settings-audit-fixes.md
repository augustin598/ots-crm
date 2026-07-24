# Audit & Fix /ots/settings/claude — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repară cele 5 defecte reale găsite de audit pe pagina de configurare Claude (toate în UI) și publică raportul de audit.

**Architecture:** Toate fix-urile sunt în `app/src/routes/[tenant]/settings/claude/+page.svelte` — server-side-ul (remote + resolver + crypto) a trecut auditul fără defecte care necesită schimbări. Raportul de audit merge în repo root (pattern-ul proiectului).

**Tech Stack:** Svelte 5 (runes), SvelteKit remote functions (query/command + `.updates()`), svelte-sonner.

---

## Constatări audit (spec)

Verificat: autorizare (assertCan pe 5/5 remote-uri, capabilities `admin.claude.view/manage` în catalog pentru owner+admin), criptare (AES-256-GCM per-tenant, `encryptVerified` round-trip), migrări 0404–0406 + 0413–0416 aplicate pe Turso (PRAGMA confirmat live), plugin + tenant_plugin active, rând live sănătos (2 sloturi, rută override, lastError null), 26 teste unit verzi.

**Defecte de reparat (toate UI):**
- **F1** Query-ul `getClaudeIntegration` eșuat (403 pentru rol fără capability, eroare rețea) → `current` rămâne `null` → pagina afișează „Se încarcă…" pentru totdeauna, plus sloturile apar fals „neconectat". Lipsește orice stare de eroare (`integrationQuery.error` nefolosit).
- **F2** `<select value={route.model}>` — dacă `setClaudeRoute` eșuează, DOM-ul păstrează valoarea aleasă de user, dar starea reală (derived) e neschimbată → UI desincronizat silențios.
- **F3** Rutele care țintesc un slot fără cheie (ex: override pe `api`, apoi cheia API e ștearsă; sau default `oat` fără token OAuth) sunt afișate ca active pe acel slot (segment „on" + disabled), deși serverul (`selectLenient`) folosește în realitate cealaltă cheie. UI-ul comunică fals ruta efectivă.
- **F4** `lastTestedAt`/`lastError` sunt returnate de query dar niciodată afișate — informație de debug moartă.
- **F5** Select-ul de model nu are `aria-label` (a11y; segmented group-ul are).

**Constatate dar NEreparate (documentate în raport, risc acceptat):**
- TOCTOU race pe `saveClaudeKey`/`deleteClaudeKey` (read-then-write fără tranzacție) — realist un singur admin; tranzacțiile pe Turso au istoricul lor de write-lock-uri.
- Fără rate-limit pe `testClaudeConnection` — gated pe `admin.claude.manage`, risc mic.
- `throw new Error('Unauthorized')` în `scope()` → 500 nu 401 — convenție de codebase (428 apariții), nu o schimbăm izolat.
- `confirm()` nativ la ștergere — pattern folosit în toate paginile settings.
- Flash scurt „neconectat" în timpul primului load — cosmetic.
- Model scos din catalog → opțiune fantomă în select — forward-compat edge, YAGNI.

---

### Task 1: F1 — stare de eroare pentru query (banner + retry)

**Files:**
- Modify: `app/src/routes/[tenant]/settings/claude/+page.svelte`

- [ ] **Step 1: Adaugă helper-ul de mesaj de eroare și derived-ul în `<script>`** (după linia `const loading = $derived(...)`):

```ts
	const queryError = $derived(integrationQuery.error ?? null);

	function errMsg(e: unknown): string {
		if (!e) return 'Eroare necunoscută';
		const body = (e as { body?: { message?: string } }).body;
		if (body?.message) return body.message;
		return e instanceof Error ? e.message : String(e);
	}
```

- [ ] **Step 2: Împachetează conținutul paginii într-un branch de eroare.** Imediat după `</header>` (linia `</header>` din `.claude-cfg`), deschide branch-ul:

```svelte
	{#if queryError}
		<div class="cc-query-error" role="alert">
			<AlertCircleIcon class="h-4 w-4" />
			<div>
				<strong>Nu s-a putut încărca configurarea Claude.</strong>
				<span>{errMsg(queryError)}</span>
			</div>
			<button class="cc-btn ghost sm" onclick={() => integrationQuery.refresh()}>
				<RefreshIcon class="h-3.5 w-3.5" /> Reîncearcă
			</button>
		</div>
	{:else}
		<!-- …tot conținutul existent: .cc-slots, .cc-form, .cc-route… -->
	{/if}
```

și închide `{/if}` înainte de `</div>`-ul final al `.claude-cfg`.

- [ ] **Step 3: Adaugă stilul** în `<style>` lângă `.cc-route-note`:

```css
	.cc-query-error {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12.5px;
		color: var(--cl-danger);
		background: var(--cl-danger-50);
		border: 1px solid color-mix(in srgb, var(--cl-danger) 25%, transparent);
		border-radius: 10px;
		padding: 12px 14px;
	}
	.cc-query-error div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}
	.cc-query-error span {
		color: var(--cl-text-2);
		font-size: 11.5px;
		overflow-wrap: anywhere;
	}
```

### Task 2: F2 — resincronizare select model la eșec `setRoute`

**Files:**
- Modify: `app/src/routes/[tenant]/settings/claude/+page.svelte`

- [ ] **Step 1: Adaugă nonce-ul** lângă celelalte `$state`:

```ts
	let routeResetNonce = $state(0); // incrementat la eșec setRoute → re-randează select-urile (revert vizual)
```

- [ ] **Step 2: Incrementează-l în `catch`-ul din `setRoute`:**

```ts
		} catch (e) {
			routeResetNonce++;
			toast.error(e instanceof Error ? e.message : 'Eroare la rutare');
		} finally {
```

- [ ] **Step 3: Împachetează select-ul de model în `{#key}`:**

```svelte
						{#key routeResetNonce}
							<select
								class="cc-select cc-route-model"
								value={route.model}
								...
							</select>
						{/key}
```

### Task 3: F3 — indicator de fallback pe rutele spre slot gol

**Files:**
- Modify: `app/src/routes/[tenant]/settings/claude/+page.svelte`

- [ ] **Step 1: În `{#each CLAUDE_USE_CASES}`, după `{@const route = ...}` adaugă:**

```svelte
					{@const targetConnected =
						route.keyType === 'api' ? current.api.connected : current.oat.connected}
					{@const fallbackLabel =
						route.keyType === 'api'
							? current.oat.connected
								? 'Abonamentul'
								: null
							: current.api.connected
								? 'cheia API'
								: null}
```

- [ ] **Step 2: Afișează indicatorul în `.cc-route-name`, sub hint:**

```svelte
						{#if !targetConnected && fallbackLabel}
							<span class="cc-route-fallback">
								<AlertCircleIcon class="h-3 w-3" /> slotul rutat e gol — folosește {fallbackLabel} (fallback)
							</span>
						{/if}
```

- [ ] **Step 3: Stil:**

```css
	.cc-route-fallback {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 10.5px;
		font-weight: 600;
		color: var(--cl-warn);
	}
```

### Task 4: F4 + F5 — ultimul test afișat + aria-label pe select

**Files:**
- Modify: `app/src/routes/[tenant]/settings/claude/+page.svelte`

- [ ] **Step 1: Helper de formatare dată (ro-RO) în `<script>`:**

```ts
	const dateFmt = new Intl.DateTimeFormat('ro-RO', { dateStyle: 'medium', timeStyle: 'short' });
	function fmtDate(v: Date | string | null): string {
		if (!v) return '';
		const d = v instanceof Date ? v : new Date(v);
		return Number.isNaN(d.getTime()) ? '' : dateFmt.format(d);
	}
```

- [ ] **Step 2: Afișează sub `.cc-slots` (înainte de `.cc-form`), doar când există:**

```svelte
		{#if current?.lastTestedAt}
			<p class="cc-lasttest" class:err={!!current.lastError}>
				{#if current.lastError}
					<AlertCircleIcon class="h-3.5 w-3.5" /> Ultimul test ({fmtDate(current.lastTestedAt)}): {current.lastError}
				{:else}
					<CheckCircleIcon class="h-3.5 w-3.5" /> Ultimul test reușit: {fmtDate(current.lastTestedAt)}
				{/if}
			</p>
		{/if}
```

- [ ] **Step 3: Stil:**

```css
	.cc-lasttest {
		margin: -6px 0 0;
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11.5px;
		color: var(--cl-text-3);
	}
	.cc-lasttest.err {
		color: var(--cl-warn);
		overflow-wrap: anywhere;
	}
```

- [ ] **Step 4: `aria-label` pe select-ul de model:**

```svelte
							<select
								class="cc-select cc-route-model"
								aria-label="Model pentru {uc.label}"
								...
```

### Task 5: Verificare

- [ ] **Step 1:** `cd app && bun test src/lib/server/plugins/claude/ src/lib/claude-usecases.test.ts` → 26 pass.
- [ ] **Step 2:** Rulează `svelte-autofixer` (MCP svelte) pe `+page.svelte` până nu mai raportează probleme.
- [ ] **Step 3:** `NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning` scoped output — fără erori NOI față de baseline (16 err/56 warn pre-existente).

### Task 6: Raport audit + commit

- [ ] **Step 1:** Scrie `AUDIT-CLAUDE-SETTINGS-2026-07-24.md` în repo root cu toate constatările (inclusiv cele nereparate cu justificare).
- [ ] **Step 2:** Commit:

```bash
git add "app/src/routes/[tenant]/settings/claude/+page.svelte" AUDIT-CLAUDE-SETTINGS-2026-07-24.md docs/superpowers/plans/2026-07-24-claude-settings-audit-fixes.md
git commit -m "fix(claude): audit pagina settings — error state pe query, resync select la eșec, indicator fallback rutare, ultimul test vizibil, a11y"
```

## Self-Review

- Spec coverage: F1→Task 1, F2→Task 2, F3→Task 3, F4/F5→Task 4, raport→Task 6. ✓
- Placeholders: comentariul `<!-- …tot conținutul existent… -->` din Task 1 e o instrucțiune de împachetare (conținutul există deja în fișier), nu un placeholder de cod nou. ✓
- Type consistency: `routeResetNonce`, `queryError`, `fmtDate` folosite consecvent. ✓
- TDD: fix-urile sunt exclusiv template/CSS Svelte; proiectul nu are infrastructură de component-testing (bun test = .ts only), deci verificarea = teste existente verzi + svelte-autofixer + svelte-check. Nicio logică .ts nouă de testat.
