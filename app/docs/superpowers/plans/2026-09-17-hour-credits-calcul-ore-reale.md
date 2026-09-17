# Bugete ore — calcul pe ore reale: plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toate cifrele din Bugete ore devin exacte și reproductibile din ledger: o singură rotunjire în sus pe timpul lucrat, sume de depășire calculate din minute, corecții append-only pentru rândurile vechi, fără echivalențe în euro, plus note informative în portalul clientului.

**Architecture:** Regulile pure stau în `src/lib/logic/hour-credits.ts` (testate fără DB). Scrierile trec prin `src/lib/server/hour-credits.ts` (`applyLedgerEntry`) și `src/lib/server/task-credit.ts` (decontare/reopen). Un kind nou de ledger, `correction`, legat de rândul corectat prin `source_type='ledger'`, e citit de reopen, de stornarea facturilor anulate și de FIFO-ul de expirare.

**Tech Stack:** SvelteKit 5 (remote functions), Bun, TypeScript, Drizzle ORM, libSQL/Turso.

**Spec:** `docs/superpowers/specs/2026-09-17-hour-credits-calcul-ore-reale-design.md`

**Reguli de proiect (obligatorii):**
- Toate comenzile se rulează din `/Users/augustin598/Projects/CRM/app`.
- Teste: `bun run test <filtru>`, NICIODATĂ `bun test`.
- Git: `git add` doar cu fișierele explicite ale taskului. NICIODATĂ `git add -A` (worktree partajat).
- Commit-urile se termină cu `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Baza din dev ESTE baza de producție. Orice scriere de date (Task 5) și migrarea (Task 4) ating producția.
- Migrări: un singur statement per fișier, fără `IF NOT EXISTS`; `grep` numele indexului înainte; după `db:migrate` verifici indexul pe remote. `drizzle-kit generate` e stricat — fișierul SQL și intrarea din `_journal.json` se scriu de mână.
- Coloane noi în `schema.ts` doar după migrare aplicată (aici nu adăugăm coloane, doar un index).
- După fiecare componentă `.svelte` modificată: `mcp__svelte__svelte-autofixer` (async: true, versiunea 5).
- După editarea oricărui `src/hooks/*.ts` restartezi vite (nu e cazul aici).

---

## Harta fișierelor

| Fișier | Rol în plan |
|---|---|
| `src/lib/logic/hour-credits.ts` | `ceilToStep`, `splitTaskSettlement` nou, `eurCentsToReferenceMinutes` floor, kind `correction`, `consumptionWorkedLabel` fără €/h, `overageLineAmountCents` |
| `src/lib/logic/hour-credit-expiry.ts` | FIFO tratează `correction` |
| `src/lib/server/task-credit.ts` | decontare, linie de depășire, reopen |
| `src/lib/server/hour-credit-vat.ts` (NOU) | `resolveHourOrderVat`, mutat din `hour-credit-orders.ts` |
| `src/lib/server/hour-credits.ts` | creditare factură (floor + notă), stornare cu corecții |
| `src/routes/[tenant]/api/_debug-hour-credit-correct/+server.ts` (NOU) | scrie rânduri `correction` |
| `drizzle/0563_client_hour_ledger_correction_uidx.sql` (NOU) | index unic pentru corecții |
| `src/lib/remotes/hour-credits.remote.ts` | `settleDoneTaskNow` cu ore, fără `reference` în KPI |
| `src/lib/remotes/tasks.remote.ts` | estimări rotunjite în sus |
| `src/lib/remotes/portal-hour-credits.remote.ts` + `PortalHourCreditView.svelte` | note informative |
| UI admin: `HourCreditsOverview.svelte`, `HcClientRow.svelte`, `ClientHourCreditView.svelte`, `HcIssuesPanel.svelte`, `hour-credits-format.ts` | scoaterea sumelor în euro, input de ore la „De rezolvat" |
| `src/lib/server/hour-credit-email-body.ts`, `hour-credit-notifications.ts`, `scripts/demo-*-email.ts` | fără €/h pe consum |

---

### Task 0: Commit la lucrul deja făcut pe lista de clienți

Lista din Bugete ore (clienți activi după facturi recente, comutator pe rând, segment „Activi / Toți clienții") e implementată și verificată, dar necomisă.

- [ ] **Step 1: Verifică starea**

Run: `git status --short`
Expected: exact aceste 6 fișiere modificate: `HcClientRow.svelte`, `HcDashboardWidget.svelte`, `hour-credits.css`, `hour-credits.remote.ts`, `server/hour-credits.ts`, `HourCreditsOverview.svelte`. Dacă apar altele, NU le adăuga.

- [ ] **Step 2: Rulează testele**

Run: `bun run test hour-credit`
Expected: `0 fail`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/hour-credits/HcClientRow.svelte src/lib/components/hour-credits/HcDashboardWidget.svelte src/lib/components/hour-credits/hour-credits.css src/lib/remotes/hour-credits.remote.ts src/lib/server/hour-credits.ts "src/routes/[tenant]/hour-credits/HourCreditsOverview.svelte"
git commit -m "feat(hour-credits): clientii facturati recent apar in Bugete ore, cu bifa de alimentare pe rand

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: Regulile pure

**Files:**
- Modify: `src/lib/logic/hour-credits.ts`
- Test: `src/lib/logic/__tests__/hour-credits.test.ts`

- [ ] **Step 1: Scrie testele care pică**

În `hour-credits.test.ts`, adaugă la import `ceilToStep`, `overageLineAmountCents`, `LEDGER_KIND_LABELS`. Înlocuiește TOT blocul `describe('splitTaskSettlement', ...)` cu:

```ts
describe('ceilToStep', () => {
	test('rotunjește în sus la pas; multiplii rămân', () => {
		expect(ceilToStep(0, 15)).toBe(0);
		expect(ceilToStep(1, 15)).toBe(15);
		expect(ceilToStep(15, 15)).toBe(15);
		expect(ceilToStep(142, 15)).toBe(150);
		expect(ceilToStep(142, 10)).toBe(150);
		expect(ceilToStep(7, 10)).toBe(10);
	});
	test('pas invalid → minut întreg', () => {
		expect(ceilToStep(37, 0)).toBe(37);
	});
});

describe('splitTaskSettlement', () => {
	// O singură rotunjire, pe timpul lucrat. din_credit + depășire == facturabil.
	const cases: Array<[number, number, number, number, number, number]> = [
		// sold, actual, pas → facturabil, din credit, depășire
		[600, 150, 15, 150, 150, 0],
		[100, 142, 15, 150, 100, 50],
		[0, 7, 15, 15, 0, 15],
		[-20, 60, 15, 60, 0, 60],
		[10, 20, 15, 30, 10, 20]
	];
	for (const [balance, actual, step, billed, consumed, overage] of cases) {
		test(`sold ${balance}, lucrat ${actual}, pas ${step}`, () => {
			const r = splitTaskSettlement({
				realMinutes: actual,
				balanceMinutes: balance,
				stepMinutes: step
			});
			expect(r).toEqual({
				billedMinutes: billed,
				consumedMinutes: consumed,
				overageRealMinutes: overage
			});
			expect(r.consumedMinutes + r.overageRealMinutes).toBe(r.billedMinutes);
		});
	}
});

describe('overageLineAmountCents', () => {
	test('suma se calculează din minute, nu din ore rotunjite', () => {
		expect(overageLineAmountCents(10, 65)).toBe(1083); // nu 1105
		expect(overageLineAmountCents(15, 65)).toBe(1625);
		expect(overageLineAmountCents(60, 98)).toBe(9800);
	});
});

describe('kind-ul correction', () => {
	test('are etichetă', () => {
		expect(LEDGER_KIND_LABELS.correction).toBe('Corecție');
	});
});
```

În `describe('eurCentsToReferenceMinutes'...)` (sau testul existent care o folosește, ~liniile 46-58) înlocuiește așteptările cu:

```ts
test('floor la minut: creditul nu depășește banii plătiți', () => {
	expect(eurCentsToReferenceMinutes(113065, 55)).toBe(1233); // 20 h 33 min
	expect(eurCentsToReferenceMinutes(5500, 55)).toBe(60);
	expect(eurCentsToReferenceMinutes(91, 55)).toBe(0); // sub un minut
	expect((1233 * 55 * 100) / 60).toBeLessThanOrEqual(113065);
});
```

În testul `consumptionWorkedLabel` existent, schimbă așteptările la forma fără preț: `'Development'` pentru standard și `'Development, Urgență'` pentru multiplicator > 100.

- [ ] **Step 2: Rulează, confirmă că pică**

Run: `bun run test logic/__tests__/hour-credits`
Expected: FAIL (`ceilToStep is not a function` etc.).

- [ ] **Step 3: Implementează în `src/lib/logic/hour-credits.ts`**

Adaugă `| 'correction'` în `LedgerKind` și `correction: 'Corecție'` în `LEDGER_KIND_LABELS`.

Sub `roundToStep`:

```ts
/** Singura rotunjire a timpului LUCRAT: în sus, la pas. Pas invalid = minut întreg. */
export function ceilToStep(minutes: number, stepMinutes: number): number {
	if (!Number.isFinite(minutes) || minutes <= 0) return 0;
	const step = Number.isInteger(stepMinutes) && stepMinutes > 0 ? stepMinutes : 1;
	return Math.ceil(minutes / step) * step;
}
```

Înlocuiește `eurCentsToReferenceMinutes` cu:

```ts
/**
 * Cenți EUR → minute la tariful de referință, ÎN JOS la minut: creditul nu poate
 * depăși banii plătiți. Pasul e regula timpului lucrat, nu a banilor.
 */
export function eurCentsToReferenceMinutes(netEurCents: number, referenceRateEur: number): number {
	if (!Number.isInteger(netEurCents) || netEurCents < 0) {
		throw new Error(`Sumă EUR invalidă: ${netEurCents}`);
	}
	if (!Number.isInteger(referenceRateEur) || referenceRateEur <= 0) {
		throw new Error(`Tarif de referință invalid: ${referenceRateEur}`);
	}
	return Math.floor((netEurCents * 60) / (referenceRateEur * 100));
}
```

Înlocuiește `TaskSettlementSplit` + `splitTaskSettlement` cu:

```ts
export interface TaskSettlementSplit {
	/** Timpul lucrat, rotunjit în sus la pas — singura rotunjire. */
	billedMinutes: number;
	/** Minute scăzute din credit (≤ sold, ≥ 0). */
	consumedMinutes: number;
	/** Restul exact, facturat ca depășire. */
	overageRealMinutes: number;
}

/** consumed + overage == billed, mereu. */
export function splitTaskSettlement(params: {
	realMinutes: number;
	balanceMinutes: number;
	stepMinutes: number;
}): TaskSettlementSplit {
	if (!Number.isInteger(params.realMinutes) || params.realMinutes < 0) {
		throw new Error(`Minute reale invalide: ${params.realMinutes}`);
	}
	const billedMinutes = ceilToStep(params.realMinutes, params.stepMinutes);
	const consumedMinutes = Math.min(billedMinutes, Math.max(0, params.balanceMinutes));
	return { billedMinutes, consumedMinutes, overageRealMinutes: billedMinutes - consumedMinutes };
}

/** Suma liniei de depășire, direct din minute (tarif efectiv în EUR întregi). */
export function overageLineAmountCents(minutes: number, unitRateEur: number): number {
	return Math.round((minutes * unitRateEur * 100) / 60);
}
```

Înlocuiește corpul lui `consumptionWorkedLabel` (parametrii rămân, ca apelanții să compileze):

```ts
	const mode = params.multiplierPct > 100 ? `, ${params.modeLabel}` : '';
	return `${params.rateLabel}${mode}`;
```

Actualizează comentariul JSDoc al funcției: „fără tarif: prețul apare doar la depășire". Șterge importul `effectiveRateEur` dacă rămâne nefolosit.

- [ ] **Step 4: Repară apelanții lui `eurCentsToReferenceMinutes`**

Run: `grep -rn "eurCentsToReferenceMinutes" src`
Scoate al treilea argument (`stepMinutes`) la fiecare apel.

- [ ] **Step 5: Rulează testele pure**

Run: `bun run test logic/__tests__/hour-credits`
Expected: PASS. (Testele de integrare pot pica până la Task 2 și 6 — e așteptat.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/logic/hour-credits.ts src/lib/logic/__tests__/hour-credits.test.ts
git commit -m "feat(hour-credits): reguli pure — o singura rotunjire in sus, floor la abonament, kind correction

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
(Adaugă la `git add` și fișierele atinse la Step 4.)

---

### Task 2: Decontarea la Done

**Files:**
- Modify: `src/lib/server/task-credit.ts` (`settleTaskCredit`, liniile ~86-330)
- Modify: `src/lib/remotes/hour-credits.remote.ts` (`settleDoneTaskNow`)
- Modify: `src/lib/components/hour-credits/HcIssuesPanel.svelte`
- Test: `src/lib/server/__tests__/hour-credits-integration.test.ts`

- [ ] **Step 1: Teste care pică**

În fișierul de integrare, `insertTask` primește implicit `actualMinutes: 180` (lângă `estimatedMinutes: 180`), ca testele existente să rămână despre ore efective. Adaugă în `describe('consumul task-urilor', ...)`:

```ts
test('Done fără ore efective nu consumă estimarea și rămâne în „De rezolvat"', async () => {
	await applyLedgerEntry({ tenantId: TENANT, clientId: CLIENT, deltaMinutes: 600, kind: 'manual', sourceType: 'manual', sourceId: 'seed-d8' });
	await insertTask('t-d8', { status: 'done', actualMinutes: null });
	const r = await settleTaskCredit({ tenantId: TENANT, taskId: 't-d8', userId: USER });
	expect(r).toEqual({ status: 'skipped', reason: 'fără ore efective' });
	expect(await balance()).toBe(600);
	expect((await listUnsettledDoneTasks(TENANT)).map((t) => t.taskId)).toContain('t-d8');
});

test('timpul lucrat se rotunjește o singură dată: 142 min cu sold 100 → 100 din credit, 50 depășire', async () => {
	await applyLedgerEntry({ tenantId: TENANT, clientId: CLIENT, deltaMinutes: 100, kind: 'manual', sourceType: 'manual', sourceId: 'seed-round' });
	await insertTask('t-round', { actualMinutes: 142 });
	const r = await settleTaskCredit({ tenantId: TENANT, taskId: 't-round', userId: USER });
	expect(r.status).toBe('settled');
	if (r.status !== 'settled') return;
	expect(r.consumedMinutes).toBe(100);
	expect(r.overageRealMinutes).toBe(50);
	expect(await balance()).toBe(0);
});

test('credit suficient: 142 min lucrate scad 150 din credit', async () => {
	await applyLedgerEntry({ tenantId: TENANT, clientId: CLIENT, deltaMinutes: 600, kind: 'manual', sourceType: 'manual', sourceId: 'seed-round2' });
	await insertTask('t-round2', { actualMinutes: 142 });
	await settleTaskCredit({ tenantId: TENANT, taskId: 't-round2', userId: USER });
	expect(await balance()).toBe(450);
});
```

Dacă fișierul resetează baza între teste altfel decât presupun aceste fixture-uri (uită-te la `beforeEach` existent), adaptează seed-ul la convenția lui, nu invers.

- [ ] **Step 2: Rulează, confirmă că pică**

Run: `bun run test hour-credits-integration --verbose`
Expected: FAIL pe cele 3 teste noi.

- [ ] **Step 3: Implementează în `settleTaskCredit`**

Înlocuiește linia `const actual = params.actualMinutes ?? task.actualMinutes ?? task.estimatedMinutes ?? 0;` și garda de sub ea cu:

```ts
	// Doar ore EFECTIVE. Fără ele taskul rămâne nedecontat și apare în „De rezolvat":
	// estimarea e o rezervare, nu timp lucrat.
	const actual = params.actualMinutes ?? task.actualMinutes ?? 0;
	if (!Number.isInteger(actual) || actual <= 0) {
		return { status: 'skipped', reason: 'fără ore efective' };
	}
```

După `const ctx = ...` și verificarea de eroare, adaugă:

```ts
	// Singura rotunjire: timpul lucrat, în sus, la pas. consumed + overage == billed.
	const billed = ceilToStep(actual, ctx.stepMinutes);
```

În tranzacție: în UPDATE-ul „Încercarea 1" înlocuiește ambele apariții `${actual}` cu `${billed}` și `consumed = actual;` cu `consumed = billed;`. `actualMinutes: actual` din claim rămâne (stocăm timpul brut). `realMinutes: actual` pe rândul de consum rămâne.

Bucla „Încercarea 2" devine (declară `let sawCredit = false;` înaintea ei):

```ts
						for (let attempt = 0; attempt < 3 && consumed === 0; attempt++) {
							// ...select balance ca acum...
							const available = Math.max(0, row?.balance ?? 0);
							if (available === 0) {
								sawCredit = false;
								break;
							}
							sawCredit = true;
							// ...update condiționat ca acum...
							if (partial.rowsAffected === 1) consumed = available;
						}
						// Credit existent pe care nu l-am putut revendica: NU îl transformăm în
						// depășire. Anulăm tot; taskul rămâne nedecontat și se poate relua.
						if (consumed === 0 && sawCredit) {
							throw new Error('soldul s-a schimbat de 3 ori în timpul decontării');
						}
```

Eroarea e prinsă de `catch`-ul existent (care face deja `logError` și întoarce `failed`).

Cele două blocuri `splitTaskSettlement({ realMinutes: actual, balanceMinutes: consumed, ... })` (în tranzacție și după ea) se înlocuiesc cu aritmetică directă:

```ts
					const overageInTx = billed - consumed;
					if (overageInTx > 0) {
						// ...insert overage_invoiced ca acum, cu realMinutes: overageInTx și nota
						// `${task.title} — ${overageInTx} min peste credit`
					}
```

și după tranzacție: `const overageReal = billed - consumed;`. Șterge importul `splitTaskSettlement` din `task-credit.ts` dacă rămâne nefolosit; adaugă `ceilToStep` la import.

- [ ] **Step 4: `settleDoneTaskNow` primește ore**

În `hour-credits.remote.ts`:

```ts
export const settleDoneTaskNow = command(
	v.object({
		taskId: taskIdSchema,
		/** Obligatoriu când taskul n-are ore efective salvate. */
		actualMinutes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(999 * 60)))
	}),
	async ({ taskId, actualMinutes }) => {
		const { tenantId, userId } = await requireOwnerOrAdmin();
		const [task] = await db
			.select({ status: table.task.status })
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
			.limit(1);
		if (!task) throw error(404, 'Taskul nu există.');
		if (task.status !== 'done') throw error(400, 'Doar taskurile Done se decontează de aici.');
		const result = await settleTaskCredit({ tenantId, taskId, userId, actualMinutes });
		if (result.status !== 'settled') throw error(400, `Nu s-a decontat: ${result.reason}.`);
		return result;
	}
);
```

- [ ] **Step 5: `HcIssuesPanel.svelte` — input de ore**

În `<script>` adaugă `let hoursByTask = $state<Record<string, number>>({});`. În secțiunea „Taskuri Done nedecontate": textul devine „Taskuri finalizate fără decontare: fie n-au ore efective, fie decontarea n-a rulat. Nu rezervă și n-au consumat din credit." Celula de ore și butonul devin:

```svelte
<td class="hc-num">
	{#if t.actualMinutes}
		{fmtMinutes(t.actualMinutes)}
	{:else if canEdit}
		<input
			class="hc-input"
			style="width:84px;text-align:right"
			type="number"
			min="0.25"
			step="0.25"
			placeholder="ore"
			aria-label="Ore efective pentru {t.taskTitle}"
			bind:value={hoursByTask[t.taskId]}
		/>
	{:else}
		—
	{/if}
</td>
```

```svelte
<button
	type="button"
	class="hc-btn hc-btn-light"
	disabled={busyId === t.taskId || (!t.actualMinutes && !(hoursByTask[t.taskId] > 0))}
	onclick={() =>
		run(
			t.taskId,
			() =>
				settleDoneTaskNow({
					taskId: t.taskId,
					actualMinutes: t.actualMinutes
						? undefined
						: Math.round(Number(hoursByTask[t.taskId]) * 60)
				}).updates(getHourCreditsPage()),
			'Nu am putut deconta taskul.'
		)}
>
	{busyId === t.taskId ? '…' : 'Decontează'}
</button>
```

Rulează autofixer-ul Svelte pe `HcIssuesPanel.svelte`.

- [ ] **Step 6: Repară testele existente afectate**

Run: `bun run test hour-credits-integration --verbose`
Regula pentru fiecare test picat: consumul = `ceilToStep(actualMinutes, 15)`; depășirea = facturabil − consum; reopen păstrează `actualMinutes` (vine în Task 4 — până atunci testul de reopen poate aștepta `null`). Testul „credit insuficient" (~linia 368): recalculează cu formula, nu cu vechea rotunjire a restului. Testul „taskurile Done cu ore, rămase nedecontate" rămâne valabil.
Expected final: `0 fail` în acest fișier, cu excepția testului de 20 h 30 min (Task 6).

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/task-credit.ts src/lib/remotes/hour-credits.remote.ts src/lib/components/hour-credits/HcIssuesPanel.svelte src/lib/server/__tests__/hour-credits-integration.test.ts
git commit -m "fix(hour-credits): decontarea foloseste doar ore efective, rotunjite o singura data; CAS esuat nu mai devine depasire

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Linia de depășire — sumă din minute, TVA corect

**Files:**
- Create: `src/lib/server/hour-credit-vat.ts`
- Modify: `src/lib/server/hour-credit-orders.ts` (mută `resolveHourOrderVat`)
- Modify: `src/lib/server/task-credit.ts` (`addOverageLine`, `findOrCreateOverageDraft`, `regenerateOverageDraft`)
- Test: `src/lib/server/__tests__/hour-credits-integration.test.ts`

- [ ] **Step 1: Test care pică**

```ts
test('linia de depășire: suma vine din minute (10 min × 65 € = 10,83 €, nu 11,05 €)', async () => {
	// pas 10 ca să existe o depășire de 10 min
	await testDb.insert(table.hourCreditSettings).values({ tenantId: TENANT, stepMinutes: 10 }).onConflictDoUpdate({ target: table.hourCreditSettings.tenantId, set: { stepMinutes: 10 } });
	await insertTask('t-amt', { actualMinutes: 10 });
	const r = await settleTaskCredit({ tenantId: TENANT, taskId: 't-amt', userId: USER });
	if (r.status !== 'settled' || !r.overageInvoiceId) throw new Error('fără draft');
	const [line] = await testDb.select().from(table.invoiceLineItem).where(eq(table.invoiceLineItem.taskId, 't-amt'));
	expect(line.amount).toBe(1083);
	expect(line.rate).toBe(6500);
});
```

Verifică numele real al tabelului/coloanelor de setări în `schema.ts` (`grep -n "hour_credit_settings" src/lib/server/db/schema.ts`) și invalidează cache-ul catalogului dacă `getHourlyCatalog` cache-uiește (uită-te cum fac testele de expirare existente, ~linia 793). La finalul testului readu pasul la 15.

- [ ] **Step 2: Rulează, confirmă că pică** — `bun run test hour-credits-integration --verbose` → `1105` în loc de `1083`.

- [ ] **Step 3: Mută `resolveHourOrderVat`**

Creează `src/lib/server/hour-credit-vat.ts` cu funcția mutată cuvânt cu cuvânt din `hour-credit-orders.ts:100-134` (cu importurile ei: `db`, `table`, `and`, `eq`, `resolveVatPercent`, `classifyClientVat`, `getZeroVatLegalNote` — copiază liniile de import exacte din `hour-credit-orders.ts`), exportată. În `hour-credit-orders.ts` șterge definiția și adaugă `import { resolveHourOrderVat } from '$lib/server/hour-credit-vat';`.

- [ ] **Step 4: `addOverageLine`**

Înlocuiește citirea `invoiceSettings` + `vatBps` cu:

```ts
	const { vatPercent, zeroVatNote } = await resolveHourOrderVat(tenantId, clientId);
	const vatBps = vatPercentToBps(vatPercent);
```

și calculul sumei cu:

```ts
	const unitRateEur = effectiveRateEur(ctx.rate.rateEur, ctx.mode.multiplierPct);
	// Suma vine din MINUTE; orele cu 2 zecimale sunt doar afișare (Keez recalculează
	// din ele — la pas 15 coincid exact).
	const hours = Math.round((params.overageRealMinutes / 60) * 100) / 100;
	const lineAmount = overageLineAmountCents(params.overageRealMinutes, unitRateEur);
```

`note` devine `` `${params.overageRealMinutes} min × ${unitRateEur} €/h · task ${task.id}` ``. Trimite `zeroVatNote` la `findOrCreateOverageDraft` (parametru nou `zeroVatNote: string | null`) și adaugă-l la finalul textului din `notes`: `` `${...textul existent...}${zeroVatNote ? ` ${zeroVatNote}` : ''}` `` — markerul `hour-overage:YYYY-MM` rămâne PRIMUL în `notes`. Aplică aceeași formulă de sumă în `regenerateOverageDraft` dacă își calculează singură linia (`grep -n "hours \* \|lineAmount" src/lib/server/task-credit.ts`). Importă `overageLineAmountCents`; șterge importurile rămase nefolosite (`resolveVatPercent`).

- [ ] **Step 5: Teste** — `bun run test hour-credit` → PASS pe testul nou; repară așteptările de sumă din testele vechi doar dacă foloseau minute ne-multiplu de 15.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/hour-credit-vat.ts src/lib/server/hour-credit-orders.ts src/lib/server/task-credit.ts src/lib/server/__tests__/hour-credits-integration.test.ts
git commit -m "fix(hour-credits): suma depasirii calculata din minute; TVA 0% la intracom/export pe draftul de depasire

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Kind-ul `correction` — index, expirare, reopen, stornare, endpoint

**Files:**
- Create: `drizzle/0563_client_hour_ledger_correction_uidx.sql`
- Modify: `drizzle/meta/_journal.json`, `src/lib/server/db/schema.ts` (definiția indexului, lângă `client_hour_ledger_expire_uidx`)
- Modify: `src/lib/logic/hour-credit-expiry.ts`, `src/lib/server/task-credit.ts` (`reverseTaskCredit`), `src/lib/server/hour-credits.ts` (`reverseCancelledInvoiceCredit`)
- Create: `src/routes/[tenant]/api/_debug-hour-credit-correct/+server.ts`
- Test: `src/lib/logic/hour-credit-expiry.test.ts`, `src/lib/server/__tests__/hour-credits-integration.test.ts`

- [ ] **Step 1: Migrarea**

Run: `grep -rn "correction_uidx" drizzle src` → Expected: nimic.
`drizzle/0563_client_hour_ledger_correction_uidx.sql` (un singur statement):

```sql
CREATE UNIQUE INDEX `client_hour_ledger_correction_uidx` ON `client_hour_ledger` (`tenant_id`,`source_id`) WHERE `kind` = 'correction';
```

În `_journal.json` adaugă intrarea `idx: 563`, `tag: "0563_client_hour_ledger_correction_uidx"`, `version: "6"`, `breakpoints: true`, cu `when` STRICT mai mare decât al intrării 562 (`1788786476913025` → folosește `1788786476913026`). Înainte de `db:migrate`, verifică pe remote `select max(created_at) from __drizzle_migrations` — `when` trebuie să fie peste acea valoare, altfel migrarea e sărită.
În `schema.ts` adaugă indexul lângă cel de `expire`, în aceeași formă (`uniqueIndex(...).on(t.tenantId, t.sourceId).where(sql\`kind = 'correction'\`)`).

- [ ] **Step 2: Teste care pică**

În `hour-credit-expiry.test.ts`:

```ts
test('correction nu e lot: minusul scade lotul corectat, plusul scade consumul', () => {
	const d = (s: string) => new Date(s);
	const rows = [
		{ id: 'b1', createdAt: d('2026-09-12T10:00:00Z'), deltaMinutes: 321, expiresAt: d('2027-09-12T00:00:00Z'), kind: 'manual', sourceId: 'b1' },
		{ id: 'c1', createdAt: d('2026-09-12T11:00:00Z'), deltaMinutes: -178, expiresAt: null, kind: 'task_consumption', sourceId: 't1' },
		{ id: 'k1', createdAt: d('2026-09-17T10:00:00Z'), deltaMinutes: -141, expiresAt: null, kind: 'correction', sourceId: 'b1' },
		{ id: 'k2', createdAt: d('2026-09-17T10:00:01Z'), deltaMinutes: 28, expiresAt: null, kind: 'correction', sourceId: 'c1' }
	];
	const left = remainingBatches(rows);
	expect(left.map((b) => [b.id, b.remainingMinutes])).toEqual([['b1', 30]]);
});
```

În integrare:

```ts
test('reopen restituie consumul net de corecții', async () => {
	await applyLedgerEntry({ tenantId: TENANT, clientId: CLIENT, deltaMinutes: 600, kind: 'manual', sourceType: 'manual', sourceId: 'seed-corr' });
	await insertTask('t-corr', { actualMinutes: 150 });
	await settleTaskCredit({ tenantId: TENANT, taskId: 't-corr', userId: USER });
	const [cons] = await testDb.select().from(table.clientHourLedger).where(and(eq(table.clientHourLedger.sourceId, 't-corr'), eq(table.clientHourLedger.kind, 'task_consumption')));
	await applyLedgerEntry({ tenantId: TENANT, clientId: CLIENT, deltaMinutes: 28, kind: 'correction', sourceType: 'ledger', sourceId: cons.id, note: 'test' });
	expect(await balance()).toBe(478);
	await testDb.update(table.task).set({ status: 'in-progress' }).where(eq(table.task.id, 't-corr'));
	const r = await reverseTaskCredit({ tenantId: TENANT, taskId: 't-corr', userId: USER });
	expect(r?.reversedMinutes).toBe(122);
	expect(await balance()).toBe(600);
	const [t] = await testDb.select().from(table.task).where(eq(table.task.id, 't-corr'));
	expect(t.actualMinutes).toBe(150); // se păstrează la reopen
});

test('a doua corecție pe același rând e no-op', async () => {
	const a = await applyLedgerEntry({ tenantId: TENANT, clientId: CLIENT, deltaMinutes: -5, kind: 'correction', sourceType: 'ledger', sourceId: 'row-x', note: 'unu' });
	const b = await applyLedgerEntry({ tenantId: TENANT, clientId: CLIENT, deltaMinutes: -5, kind: 'correction', sourceType: 'ledger', sourceId: 'row-x', note: 'doi' });
	expect(a.applied).toBe(true);
	expect(b.applied).toBe(false);
});
```

- [ ] **Step 3: Rulează, confirmă că pică** — `bun run test hour-credit --verbose`.

- [ ] **Step 4: `remainingBatches` în `hour-credit-expiry.ts`**

`batchRows` exclude corecțiile: `rows.filter((r) => r.deltaMinutes > 0 && r.kind !== 'task_reversal' && r.kind !== 'correction')`. În bucla `for (const r of rows)`, imediat după ramura `task_reversal`:

```ts
		if (r.kind === 'correction') {
			// Plus = consum restituit; minus = lotul corectat (`sourceId` = id-ul lui) se micșorează.
			if (r.deltaMinutes > 0) {
				toSpend -= r.deltaMinutes;
			} else {
				const target = r.sourceId ? byId.get(r.sourceId) : undefined;
				const taken = target ? Math.min(target.remainingMinutes, -r.deltaMinutes) : 0;
				if (target) target.remainingMinutes -= taken;
				toSpend += -r.deltaMinutes - taken;
			}
			continue;
		}
```

- [ ] **Step 5: `reverseTaskCredit`**

Din `.set({...})` al claim-ului șterge `actualMinutes: null,`. Selectul de consum ia și `id`; după el:

```ts
					let corrections = 0;
					if (consumption) {
						const rows = await tx
							.select({ deltaMinutes: table.clientHourLedger.deltaMinutes })
							.from(table.clientHourLedger)
							.where(
								and(
									eq(table.clientHourLedger.tenantId, tenantId),
									eq(table.clientHourLedger.kind, 'correction'),
									eq(table.clientHourLedger.sourceType, 'ledger'),
									eq(table.clientHourLedger.sourceId, consumption.id)
								)
							);
						corrections = rows.reduce((s, r) => s + r.deltaMinutes, 0);
					}
					reversed = consumption ? -(consumption.deltaMinutes + corrections) : 0;
```

Actualizează JSDoc-ul funcției: „golește câmpurile" → „păstrează orele efective".

- [ ] **Step 6: `reverseCancelledInvoiceCredit`**

După ce `credit` e găsit, însumează corecțiile cu `sourceId = credit.id` (același query ca mai sus, pe `db`) în `corrections`, apoi `const toReverse = credit.deltaMinutes + corrections;` și folosește `-toReverse` la `deltaMinutes`, `toReverse` în log și în `minutes` întors.

- [ ] **Step 7: Endpoint-ul**

`src/routes/[tenant]/api/_debug-hour-credit-correct/+server.ts` (garda e ca în `_debug-hour-credit-settle`, dar DOAR owner — corecțiile mută bani):

```ts
/**
 * Corecție append-only pe un rând de ledger (spec 2026-09-17 §3-4). Owner-only.
 * POST { ledgerId, deltaMinutes, note }. Idempotent: un singur rând `correction`
 * per rând corectat (index unic) — a doua chemare întoarce applied:false.
 */
import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { applyLedgerEntry } from '$lib/server/hour-credits';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	if (event.locals.tenantUser?.role !== 'owner') throw error(403, 'Forbidden: doar owner-ul');
	const tenantId = event.locals.tenant.id;
	const body = (await event.request.json()) as {
		ledgerId?: string;
		deltaMinutes?: number;
		note?: string;
	};
	if (!body.ledgerId || !Number.isInteger(body.deltaMinutes) || body.deltaMinutes === 0) {
		throw error(400, 'ledgerId și deltaMinutes (întreg, nenul) sunt obligatorii');
	}
	if (!body.note || body.note.trim().length < 5) throw error(400, 'nota e obligatorie');
	const [row] = await db
		.select({ id: table.clientHourLedger.id, clientId: table.clientHourLedger.clientId, kind: table.clientHourLedger.kind })
		.from(table.clientHourLedger)
		.where(and(eq(table.clientHourLedger.id, body.ledgerId), eq(table.clientHourLedger.tenantId, tenantId)))
		.limit(1);
	if (!row) throw error(404, 'rândul de ledger nu există');
	if (row.kind === 'correction') throw error(400, 'o corecție nu se corectează');
	const result = await applyLedgerEntry({
		tenantId,
		clientId: row.clientId,
		deltaMinutes: body.deltaMinutes!,
		kind: 'correction',
		sourceType: 'ledger',
		sourceId: row.id,
		note: body.note.trim(),
		createdByUserId: event.locals.user.id
	});
	return json({ applied: result.applied, ledgerId: row.id, deltaMinutes: body.deltaMinutes });
};
```

Dacă `applyLedgerEntry` e apelat cu `deltaMinutes` negativ mai mare decât soldul, soldul devine negativ — acceptat (spec §6).

- [ ] **Step 8: UI — corecția în ledgerul din fișa clientului**

În `ClientHourCreditView.svelte`, `sourceHref` rămâne neschimbat (`ledger` → `null`). Eticheta vine automat din `LEDGER_KIND_LABELS`. Verifică doar că `toneOf` colorează după semn (deja o face).

- [ ] **Step 9: Aplică migrarea și rulează testele**

Run: `bun run db:migrate`, apoi verifică pe remote: `select name from sqlite_master where name='client_hour_ledger_correction_uidx'` → 1 rând.
Run: `bun run test hour-credit` → `0 fail` (mai puțin testul de 20 h 30, Task 6).

- [ ] **Step 10: Commit**

```bash
git add drizzle/0563_client_hour_ledger_correction_uidx.sql drizzle/meta/_journal.json src/lib/server/db/schema.ts src/lib/logic/hour-credit-expiry.ts src/lib/logic/hour-credit-expiry.test.ts src/lib/server/task-credit.ts src/lib/server/hour-credits.ts "src/routes/[tenant]/api/_debug-hour-credit-correct/+server.ts" src/lib/server/__tests__/hour-credits-integration.test.ts
git commit -m "feat(hour-credits): kind correction — corectii append-only legate de randul corectat (migrare 0563)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Corecția datelor ONE TOP SOLUTION — CERE „go" DE LA USER

Scrie în baza de producție. NU rula fără confirmarea explicită a userului în sesiunea de execuție.

- [ ] **Step 1: Verifică starea înainte** (read-only): soldul clientului `fd4il5ms2wcdhk3weghrbbpd` = 143, rândurile `hjnry3q2mxib44q2fqu7mp7a` (+321) și `pzcolfcjwmvbsejwf5wdk55j` (−178) există.

- [ ] **Step 2: Două POST-uri** pe `http://localhost:5173/ots/api/_debug-hour-credit-correct`, autentificat ca owner:

```json
{ "ledgerId": "hjnry3q2mxib44q2fqu7mp7a", "deltaMinutes": -141, "note": "Corecție model ponderat: 3 h cumpărate = 180 min (era 321)" }
{ "ledgerId": "pzcolfcjwmvbsejwf5wdk55j", "deltaMinutes": 28, "note": "Corecție model ponderat: 150 min lucrate = 150 min (era 178)" }
```

Expected: `applied: true` la ambele.

- [ ] **Step 3: Verifică** — sold 30, `cache == Σ ledger`; al doilea POST identic întoarce `applied: false`. Fișa clientului arată Sold 30 min, Rezervat 2 h, Disponibil −1 h 30 min.

---

### Task 6: Creditarea facturii de abonament — floor + notă de conversie

**Files:** `src/lib/server/hour-credits.ts` (`creditPaidInvoice` ~liniile 243-262), testul de integrare ~linia 191.

- [ ] **Step 1: Test** — testul „5.608 RON la cursul 4,96…" devine „→ 20 h 33 min": așteaptă `{ status: 'credited', minutes: 1233 }`, iar nota rândului să conțină `'1.130,65 € la 55 €/h'`. Testul de stornare de mai jos: `1230` → `1233`.

- [ ] **Step 2: Rulează, pică** — `bun run test hour-credits-integration`.

- [ ] **Step 3: Implementează**

```ts
	const minutes = eurCentsToReferenceMinutes(netEurCents, reference.rateEur);
	if (minutes <= 0) return { status: 'skipped', reason: 'sumă sub un minut de credit' };
	const eurLabel = (netEurCents / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
```

și `note` devine:

```ts
		note: `Factura ${invoice.invoiceNumber ?? invoiceId} — ${eurLabel} € la ${reference.rateEur} €/h${params.trigger === 'manual' ? ' (creditată manual)' : ''}`,
```

Dacă `toLocaleString('ro-RO')` nu dă `1.130,65` sub Bun (ICU), formatează manual cu un helper local de 3 linii și folosește-l și în test.

- [ ] **Step 4: Teste** — `bun run test hour-credit` → `0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/hour-credits.ts src/lib/server/__tests__/hour-credits-integration.test.ts
git commit -m "fix(hour-credits): abonamentul se converteste in jos la minut, cu conversia scrisa in nota

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Estimări rotunjite în sus + pas de 10 min

**Files:** `src/lib/remotes/tasks.remote.ts` (create ~1167, update ~1552), `src/lib/components/tasks/task-hour-credit-fields.svelte` (~62-66), `src/lib/logic/hourly-catalog.ts:102`, `src/lib/remotes/hourly-rates.remote.ts` (~241), pagina `src/routes/[tenant]/settings/hourly-rates/` (selectorul de pas).

- [ ] **Step 1:** `STEP_MINUTES_OPTIONS = [10, 15, 30, 60] as const;`. `grep -rn "STEP_MINUTES_OPTIONS\|picklist(\[15" src` și aliniază validarea din `hourly-rates.remote.ts`. Adaugă în testul catalogului existent (`grep -rln "STEP_MINUTES_OPTIONS" src`) că `10` e acceptat.

- [ ] **Step 2:** În pagina de Settings, sub selectorul de pas, când valoarea e 10:

```svelte
{#if Number(stepMinutes) === 10}
	<p class="hc-muted">
		La pas de 10 min, facturile de depășire pot diferi cu câțiva cenți în Keez (cantitatea se
		trimite cu 2 zecimale). Pasul de 15 min e exact.
	</p>
{/if}
```

(folosește numele real al variabilei de stare din pagină).

- [ ] **Step 3:** În `tasks.remote.ts`, helper lângă celelalte helper-e locale:

```ts
/** Estimările se țin în multipli de pas, rotunjite în sus (spec 2026-09-17 §2.4). */
async function normalizeEstimate(tenantId: string, minutes: number | null | undefined) {
	if (!minutes || minutes <= 0) return minutes ?? null;
	const { rules } = await getHourlyCatalog(tenantId);
	return ceilToStep(minutes, rules.stepMinutes);
}
```

Aplică-l pe `estimatedMinutes` la create și la update (acolo unde valoarea vine din input, înainte de `.values`/`.set`). Importă `getHourlyCatalog` și `ceilToStep`.

- [ ] **Step 4:** În `task-hour-credit-fields.svelte`, `snapToStep` folosește `ceilToStep` în loc de `roundToStep`.  Rulează autofixer-ul.

- [ ] **Step 5:** `bun run test tasks.remote hourly` → PASS. Commit:

```bash
git add src/lib/remotes/tasks.remote.ts src/lib/components/tasks/task-hour-credit-fields.svelte src/lib/logic/hourly-catalog.ts src/lib/remotes/hourly-rates.remote.ts "src/routes/[tenant]/settings/hourly-rates"
git commit -m "feat(hour-credits): estimari rotunjite in sus la pas; pas de 10 min in Settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
(adaugă testul de catalog atins; pentru directorul de settings listează fișierele concrete modificate).

---

### Task 8: UI admin — fără euro „la referință", previzualizare cu disponibil

**Files:** `HourCreditsOverview.svelte`, `HcClientRow.svelte`, `ClientHourCreditView.svelte`, `hour-credits-format.ts` + `hour-credits-format.test.ts`, `task-hour-credit-card.svelte`, `src/routes/[tenant]/tasks/[taskId]/edit/+page.svelte`, `HcOrderDrawer.svelte`.

- [ ] **Step 1: `HourCreditsOverview.svelte`** — în `hc-ref` rămâne doar pragul:

```svelte
<div class="hc-ref">
	Prag credit scăzut <b>{fmtMinutes(data.lowCreditThresholdMinutes)}</b> · se schimbă din
	<a href="/{tenantSlug}/settings/hourly-rates">Settings → Tarife orare</a>
</div>
```

În KPI-ul „Credit în circulație" șterge blocul `{#if data.reference} · ≈ … {/if}`. Șterge propul `referenceLabel` de la `<HcClientRow>` și `creditToEur` din import.

- [ ] **Step 2: `HcClientRow.svelte`** — șterge propul `referenceLabel` (declarație + tip) și meta devine `{row.cui ?? 'fără CUI'}`.

- [ ] **Step 3: `ClientHourCreditView.svelte`** — șterge `<span>referință …</span>` (~linia 130) și blocul `≈ {creditToEur(...)} la tariful de referință` (~154-158). Textul cardului „Alimentare din facturi" devine:

```svelte
Facturile plătite (fără hosting, ads, depășiri și comenzi de ore) se transformă în ore la
tariful de referință{view.reference ? ` (${view.reference.label}, ${view.reference.rateEur} €/h)` : ''},
la cursul BNR din ziua plății. Orele cumpărate intră 1 la 1.
```

Previzualizarea ajustării:

```svelte
<div class="hc-preview">
	Sold după ajustare: <b>{fmtMinutes(view.balanceMinutes + adjustMinutes)}</b> · disponibil:
	<b>{fmtMinutes(view.balanceMinutes + adjustMinutes - view.reservedMinutes)}</b>
</div>
```

Sub textarea de motiv: `<p class="hc-muted">Minimum 5 caractere.</p>`.

- [ ] **Step 4:** Șterge `creditToEur` din `hour-credits-format.ts` și `describe('creditToEur'…)` din test. `grep -rn "creditToEur" src` → nimic.

- [ ] **Step 5:** `task-hour-credit-card.svelte` (~96-99) și `tasks/[taskId]/edit/+page.svelte` (~298-299): textul cu „(sau estimarea)" devine „Scăderea se face la finalizare, pe orele efective. Fără ore efective, taskul rămâne nedecontat până le completezi." `HcOrderDrawer.svelte` (~30, ~145): scoate mențiunile „la tariful de referință" pentru orele cumpărate (acum sunt ore reale).

- [ ] **Step 6:** `remotes/hour-credits.remote.ts` — `getHourCreditsPage` nu mai întoarce `reference` (șterge și calculul); actualizează comentariul din capul fișierului („minute reale"). `grep -rn "data.reference" src` → nimic. `getClientHourCreditView` păstrează `reference` (cardul de alimentare).

- [ ] **Step 7:** Autofixer pe fiecare `.svelte` atins; `NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error` → `0 errors`; `bun run test hour-credit` → PASS.

- [ ] **Step 8: Commit** cu fișierele de mai sus, mesaj `fix(hour-credits): fara echivalente in euro la referinta; previzualizarea ajustarii arata si disponibilul`.

---

### Task 9: Portalul clientului — note informative

**Files:** `src/lib/remotes/portal-hour-credits.remote.ts`, `src/routes/client/[tenant]/(app)/hour-credits/PortalHourCreditView.svelte`, `hour-credits.css`.

- [ ] **Step 1: Remote** — verifică în `getClientHourCredit` numele câmpului de bifă (`optedIn`) și în `HourCreditRules` câmpurile de expirare (`creditExpiryDays` + flag-ul de activare; `grep -n "creditExpiry\|expiryEnabled" src/lib/logic/hourly-catalog.ts`). Răspunsul devine:

```ts
	return {
		balanceMinutes: view.balanceMinutes,
		reservedMinutes: reserved.get(client.id) ?? 0,
		lowCreditThresholdMinutes: catalog.rules.lowCreditThresholdMinutes,
		stepMinutes: catalog.rules.stepMinutes,
		/** 0 = orele nu expiră. */
		expiryDays: catalog.rules.creditExpiryDays > 0 ? catalog.rules.creditExpiryDays : 0,
		/** Tariful conversiei apare DOAR clienților cu alimentare din facturi. */
		subscriptionRateEur: view.optedIn && reference ? reference.rateEur : null,
		entries: /* ca acum */
	};
```

Șterge câmpul `reference`. Dacă expirarea are și un flag separat de activare, `expiryDays` e 0 când flag-ul e oprit.

- [ ] **Step 2: Componenta** — în `<script>`:

```ts
	import { ceilToStep } from '$lib/logic/hour-credits';
	// Aceeași regulă ca în admin: alerta e pe DISPONIBIL, nu pe sold.
	const low = $derived(available < view.lowCreditThresholdMinutes);
```

(înlocuiește `low`-ul vechi). Șterge blocul `{#if view.reference} … proporțional mai mult … {/if}`. Între widget și „Istoric":

```svelte
<details class="hc-widget hc-how" open={view.entries.length === 0}>
	<summary>Cum funcționează creditul de ore</summary>
	<dl>
		<dt>Ce este</dt>
		<dd>
			Timpul pe care l-ai plătit în avans. 1 oră de credit = 1 oră lucrată, indiferent de tipul
			lucrării.
		</dd>
		<dt>Cum se alimentează</dt>
		<dd>
			Din orele cumpărate: 1 oră cumpărată = 1 oră de credit.
			{#if view.subscriptionRateEur}
				În plus, facturile de abonament plătite se transformă în ore: suma netă, la
				{view.subscriptionRateEur} €/h.
			{/if}
		</dd>
		<dt>Cum se consumă</dt>
		<dd>
			La finalizarea unui task scădem timpul lucrat, rotunjit în sus la {view.stepMinutes} minute.
			Exemplu: 20 min lucrate = {fmtMinutes(ceilToStep(20, view.stepMinutes))}.
		</dd>
		<dt>Ce înseamnă „rezervat"</dt>
		<dd>
			Taskurile deschise blochează estimarea lor din sold. Disponibil = sold − rezervat. Nimic nu se
			scade până la finalizare.
		</dd>
		<dt>Dacă se termină creditul</dt>
		<dd>
			Timpul lucrat peste credit se facturează separat, la tariful lucrării, pe factura lunară de
			depășire.
		</dd>
		{#if view.expiryDays > 0}
			<dt>Expirare</dt>
			<dd>
				Orele neconsumate expiră după {view.expiryDays} zile de la alimentare. Consumăm întâi orele
				cele mai vechi.
			</dd>
		{/if}
		<dt>Credit scăzut</dt>
		<dd>Te anunțăm când disponibilul scade sub {fmtMinutes(view.lowCreditThresholdMinutes)}.</dd>
	</dl>
</details>
```

În istoric, sub „X lucrate":

```svelte
{#if e.realMinutes && e.kind === 'task_consumption' && Math.abs(e.deltaMinutes) > e.realMinutes}
	<div class="hc-muted hc-led-sub">rotunjit la {view.stepMinutes} min</div>
{/if}
```

- [ ] **Step 3: CSS** în `hour-credits.css` (plain CSS: tema întunecată se scrie `.dark .x`, nu `:global(.dark)`; folosește doar tokenii `--hc-*`/`--cl-*` existenți, definiți pe rădăcina portalului):

```css
.hc-how {
	margin-bottom: 14px;
}
.hc-how summary {
	cursor: pointer;
	font-weight: 700;
	font-size: 14px;
	color: var(--cl-text);
}
.hc-how dl {
	margin: 12px 0 0;
	display: grid;
	gap: 4px;
}
.hc-how dt {
	font-size: 12.5px;
	font-weight: 700;
	color: var(--cl-text);
	margin-top: 8px;
}
.hc-how dd {
	margin: 0;
	font-size: 13px;
	line-height: 1.55;
	color: var(--cl-text-3);
}
```

- [ ] **Step 4:** Autofixer + `svelte-check`; verifică vizual în portal (`/client/ots/hour-credits`) pe temă deschisă și închisă, la 400 px lățime.

- [ ] **Step 5: Commit** — `feat(portal): note informative despre creditul de ore; alerta pe disponibil`.

---

### Task 10: Emailuri și WhatsApp

**Files:** `src/lib/server/hour-credit-email-body.ts`, `src/lib/server/hour-credit-notifications.ts`, demo-ul de email (`ls scripts | grep -i "demo.*hour\|demo.*credit"`), testele lor (`grep -rln "consumptionWorkedLabel\|hour-credit-email-body" src`).

- [ ] **Step 1:** Eticheta orelor lucrate nu mai are preț (făcut în Task 1). În `hour-credit-email-body.ts`, rândul „Ore lucrate" arată și rotunjirea când diferă, iar depășirea arată tariful:

```ts
		const billed = event.consumedMinutes + event.overageRealMinutes;
		const rounded = billed !== event.realMinutes ? ` (taxate ${formatMinutes(billed)})` : '';
		const overageRate = event.pricing
			? ` la ${effectiveRateEur(event.pricing.rateEur, event.pricing.multiplierPct)} €/h`
			: '';
		const overage =
			event.overageRealMinutes > 0
				? `<div style="margin-top: 8px; color: #b45309;">${formatMinutes(event.overageRealMinutes)} depășesc creditul și se facturează separat${overageRate}.</div>`
				: '';
```

și `<strong>${formatMinutes(event.realMinutes)}${rounded}${workedLabel ? ` ${escapeHtml(workedLabel)}` : ''}</strong>`. Importă `effectiveRateEur` din `$lib/logic/hours-pricing`.

- [ ] **Step 2:** Aplică aceeași formulare în mesajul WhatsApp din `hour-credit-notifications.ts` (caută ramura `consumed`).

- [ ] **Step 3:** Actualizează demo-ul de email și testele de conținut; rulează demo-ul și deschide HTML-ul rezultat (regula proiectului: preview la orice schimbare de template). ATENȚIE: dev trimite emailuri REALE — demo-ul doar generează fișier, nu trimite.

- [ ] **Step 4:** `bun run test hour-credit` → PASS. Commit — `fix(hour-credits): notificarile arata timpul taxat si tariful doar la depasire`.

---

### Task 11: Documentație, invarianți, verificare finală

- [ ] **Step 1:** `docs/bugete-ore.md` — rescrie secțiunile despre ponderare (~18-25, ~66-67) după spec; adaugă `correction`, regula de rotunjire unică, floor-ul la abonament, D8. Curăță comentariile moștenite: `src/lib/server/hour-credits.ts` (~817-822), `_debug-hour-credit-settle/+server.ts:14`, `db/schema.ts` (~193, ~2554-2557) — doar text, fără schimbări de schemă.

- [ ] **Step 2:** Verifică acoperirea invarianților din spec §7 (1-16): pentru fiecare, arată testul care îl acoperă; adaugă-le pe cele lipsă. Invariantul 1 există deja („soldul din cache e mereu suma ledger-ului") — extinde-l să ruleze și după o corecție + reopen.

- [ ] **Step 3:** Verificare completă:

```bash
bun run test
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error
bun run build
```

Expected: `0 fail`, `0 errors`, build reușit (build-ul prinde ce dev nu vede: lightningcss, garda rolldown pe `.remote.ts`).

- [ ] **Step 4:** Verificare în browser (testermcp, `localhost:5173`, tenant `ots`): fișa ONE TOP SOLUTION arată 30 min / rezervat 2 h / disponibil −1 h 30 min, fără sume în euro; Bugete ore fără „≈ €"; „De rezolvat" cere ore pentru un task Done fără ore; portalul arată cardul informativ.

- [ ] **Step 5:** Commit docs; actualizează memoria `project_hour_credits_f1_hourly_rates_2026_09_11.md` (model pe ore reale, kind `correction`, migrare 0563, D8). NU deploy — întreabă userul production/staging și așteaptă „go".

---

## De verificat în timpul execuției (din spec §9)

- Draftul de depășire e în EUR, factura de ore în RON. Planul schimbă doar suma și TVA-ul; moneda rămâne cum e până confirmă userul ce acceptă Keez.
- Task 5 și migrarea din Task 4 ating producția (aceeași bază).
