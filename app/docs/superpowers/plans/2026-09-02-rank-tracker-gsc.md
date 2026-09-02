# Integrare Google Search Console în Rank Tracker — Plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aducem în Rank Tracker datele reale din Google Search Console (clicuri, afișări, CTR, poziție medie) pentru fiecare cuvânt cheie urmărit, și le folosim ca sursă de adevăr care semnalează când poziția scrapată nu e de încredere.

**Architecture:** Integrare OAuth per tenant (oglindă după `google_ads_integration`, tokeni criptați), un job zilnic care trage `searchanalytics.query` pe proprietatea GSC a fiecărui proiect și scrie o linie per (cuvânt, dispozitiv, zi GSC), plus un read model care pune datele lângă pozițiile scrapate. **Nu contopim niciodată cele două poziții** — măsoară lucruri diferite; le ținem în coloane separate și calculăm doar un semnal de divergență.

**Tech Stack:** SvelteKit 5 (runes), Bun, TypeScript, Drizzle ORM + libSQL (Turso), BullMQ, `googleapis` 171.4.0 (deja instalat, expune `google.searchconsole('v1')` — nicio dependență nouă).

---

## Context pentru cineva care intră acum

### De ce facem asta

Pe 2 sep. 2026, proiectul heylux.ro din Rank Tracker arăta „30+" la toate cele 26 de cuvinte cheie, ceea ce citea ca o prăbușire de poziții. În realitate **toate cele 4 rulări fuseseră blocate de Google** (3 blocate, 1 cu „0 rezultate organice — selector posibil rupt"), deci nu exista nicio măsurătoare. În același timp, snapshotul reușit al altui proiect (luckystudio.ro) arăta `heylux.ro` pe **poziția 8** la „videochat iasi".

Cu GSC integrat, cazul ăsta devine imposibil de confundat: dacă noi raportăm „negăsit" iar Google raportează afișări, știm că problema e la noi, nu la client.

Beneficii, în ordinea valorii:

1. **Sursă care nu poate fi blocată** — API oficial, gratuit, fără proxy.
2. **Umple coloanele goale** — „volum —" și „dificultate —" sunt goale fiindcă dev token-ul Google Ads întoarce volume goale (vezi nota din `src/lib/server/rank-tracker/volume.ts:4`). GSC dă afișări și clicuri reale.
3. **CTR real** în loc de tabelul fix din `ctrForPosition`.

### Ce NU rezolvă GSC (și de ce păstrăm scraping-ul)

- **Nu arată niciun competitor.** Tot panoul „Competitori pe acest cuvânt" (sugarstudio, bestjobs, 2lips…) e invizibil în GSC.
- **Poziția medie GSC e mediată** peste dispozitive, locații și pagini. Nu e comparabilă cu „poziția 8, desktop, România".
- **Datele au întârziere** (~2 zile pentru date finale; `dataState: 'all'` aduce și date proaspete, parțiale).

### Frecarea reală nu e codul, ci accesul

Fiecare client trebuie să acorde acces la proprietatea lui din Search Console, iar proprietatea trebuie să fie verificată. **Atenție la capcana de la Google Calendar** (vezi `project_google_meet_calendar_api_2026_08_20`): OAuth „connected" NU dovedește că API-ul e activat în Google Cloud. De aceea Task 13 e obligatoriu, nu opțional.

### Reguli de casă care se aplică la fiecare task

- **Teste: `bun run test`, NICIODATĂ `bun test`.** `mock.module()` scrie într-un registru global; fără proces per fișier apar ~238 de eșecuri fantomă. Filtrare: `bun run test gsc`.
- **Migrări:** un singur statement SQL per fișier, **fără `IF NOT EXISTS`**, `_journal.json` actualizat manual. `drizzle-kit generate` e stricat pe repo-ul ăsta (coliziune de snapshot) — scrie fișierele de mână.
- **Coloană în `schema.ts` DOAR după ce migrarea a fost aplicată** — altfel orice `select()` care ia toate coloanele crapă în producție.
- **Orice remote function cere `requireStaff(event)` + scoping pe `tenantId` din sesiune.**
- **Toți tokenii OAuth se criptează** cu `encryptVerified`/`decrypt` din `$lib/server/plugins/smartbill/crypto`.
- **Orice fetch extern are timeout.**
- `svelte-check` are nevoie de heap mare: `NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning`.
- După editarea oricărei componente `.svelte`, rulează autofixer-ul din Svelte MCP.
- **Fără auto-polling în UI** (fără `setInterval`); buton de refresh manual.

### Decizii deja luate (nu le redeschide fără motiv)

| Decizie | Motiv |
|---|---|
| Poziția GSC și cea scrapată stau în coloane separate | Măsoară lucruri diferite; media lor n-ar fi adevărată pentru niciuna |
| Cheia zilei GSC se stochează ca `gsc_date`, nu `day_key` | GSC lucrează în ora Pacificului, `rank_snapshot.day_key` e Europe/Bucharest. Numele diferit previne comparații greșite |
| Fereastra se retrage 7 zile la fiecare rulare, cu upsert | Datele proaspete sunt parțiale și se rescriu de Google zile la rând |
| `TABLET` din GSC se ignoră | Nu urmărim tablete nicăieri în modul |
| Proprietatea GSC se ține pe proiect, nu pe tenant | Un tenant are proiecte pentru clienți diferiți, fiecare cu proprietatea lui |

### Ce NU intră în acest plan (faze ulterioare)

- **Faza 2 — descoperire:** interogările pe care clientul le are în GSC dar nu sunt urmărite ca `rank_keyword`. Aici GSC e imbatabil, dar e o funcționalitate separată, cu UI propriu.
- **Faza 3 — CTR real în formula de vizibilitate:** înlocuirea tabelului `ctrForPosition` cu CTR-ul măsurat. Se face abia după ce avem câteva săptămâni de date.

---

## Structura fișierelor

**Create:**

| Fișier | Responsabilitate |
|---|---|
| `src/lib/logic/gsc.ts` | Logică pură: fereastra de zile, parsarea rândurilor GSC, regula de divergență. Zero rețea/DB |
| `src/lib/logic/__tests__/gsc.test.ts` | Testele logicii pure |
| `src/lib/server/gsc/auth.ts` | OAuth: URL, callback, client autentificat cu refresh |
| `src/lib/server/gsc/client.ts` | Apelurile Search Console API (`searchanalytics.query`, `sites.list`) |
| `src/lib/server/gsc/__tests__/client.test.ts` | Testele clientului, cu API injectat |
| `src/routes/api/gsc/auth/+server.ts` | Start OAuth (redirect spre Google) |
| `src/routes/api/gsc/callback/+server.ts` | Callback OAuth |
| `src/lib/server/scheduler/tasks/gsc-daily-pull.ts` | Jobul zilnic de tragere |
| `src/lib/server/scheduler/tasks/__tests__/gsc-daily-pull.test.ts` | Testele jobului, cu deps injectate |
| `src/lib/remotes/gsc.remote.ts` | Stare integrare, listare proprietăți, salvare proprietate, tragere manuală |
| `src/lib/remotes/__tests__/gsc.remote.test.ts` | Teste de scoping și validare |
| `src/routes/[tenant]/api/_debug-gsc-health/+server.ts` | Sondă operațională (dovedește că API-ul e activat) |
| `drizzle/0525_gsc_integration.sql` … `0529_*.sql` | Migrările |

**Modify:**

| Fișier | Ce se schimbă |
|---|---|
| `src/lib/server/db/schema.ts` | `gscIntegration`, `rankGscDaily`, coloana `gscProperty` pe `rankProject` |
| `src/lib/logic/rank-tracker.ts` | Exportă `normalizeKeyword` (azi e duplicat privat în remote) |
| `src/lib/remotes/rank-tracker.remote.ts` | Folosește `normalizeKeyword` din logic |
| `src/lib/server/rank-tracker/projects-data.ts` | Câmpul `gsc` pe `RankKeywordDetail` |
| `src/lib/server/scheduler/index.ts` | Înregistrarea jobului `gsc_daily_pull` |
| `src/lib/components/rank-tracker/RankProjectView.svelte` | Coloane GSC + badge de divergență |
| `src/lib/components/rank-tracker/KeywordDrawer.svelte` | Blocul GSC în drawer |
| `src/lib/components/rank-tracker/rank-tracker.css` | Stilul badge-ului |

---

## Task 1: Migrarea și schema pentru `gsc_integration`

**Files:**
- Create: `app/drizzle/0525_gsc_integration.sql`
- Create: `app/drizzle/0526_gsc_integration_tenant_uidx.sql`
- Modify: `app/drizzle/meta/_journal.json`
- Modify: `app/src/lib/server/db/schema.ts`

- [ ] **Step 1: Verifică numărul următor de migrare**

```bash
cd app && ls drizzle/*.sql | tail -3 && tail -8 drizzle/meta/_journal.json
```

Ultima migrare la scrierea planului era `0524_serp_integration_tenant_uidx`. Dacă între timp au apărut altele, folosește numerele următoare și ajustează referințele din plan.

- [ ] **Step 2: Verifică prin grep că numele nu există deja**

```bash
cd app && grep -rn "gsc_integration" drizzle/ src/lib/server/db/schema.ts | head
```

Trebuie să nu întoarcă nimic. (Regula casei: fără `IF NOT EXISTS`, deci un nume duplicat ar pica migrarea.)

- [ ] **Step 3: Scrie migrarea tabelului**

`app/drizzle/0525_gsc_integration.sql` — un singur statement:

```sql
CREATE TABLE `gsc_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`email` text NOT NULL,
	`access_token_encrypted` text NOT NULL,
	`refresh_token_encrypted` text NOT NULL,
	`token_expires_at` text NOT NULL,
	`is_active` integer NOT NULL DEFAULT 1,
	`last_sync_at` text,
	`last_error` text,
	`created_at` text NOT NULL DEFAULT current_timestamp,
	`updated_at` text NOT NULL DEFAULT current_timestamp
);
```

- [ ] **Step 4: Scrie migrarea indexului**

`app/drizzle/0526_gsc_integration_tenant_uidx.sql`:

```sql
CREATE UNIQUE INDEX `gsc_integration_tenant_uidx` ON `gsc_integration` (`tenant_id`);
```

- [ ] **Step 5: Adaugă cele două intrări în `_journal.json`**

În `app/drizzle/meta/_journal.json`, la finalul array-ului `entries`, imediat după intrarea cu `"idx": 524`:

```json
    {
      "idx": 525,
      "version": "6",
      "when": 1788400000000000,
      "tag": "0525_gsc_integration",
      "breakpoints": true
    },
    {
      "idx": 526,
      "version": "6",
      "when": 1788400000000001,
      "tag": "0526_gsc_integration_tenant_uidx",
      "breakpoints": true
    }
```

`when` are 16 cifre (microsecunde) în fișierul ăsta. Folosește `Date.now() * 1000` pentru prima și `+1` pentru a doua, ca ordinea să fie strictă.

- [ ] **Step 6: Aplică migrările**

```bash
cd app && bun run db:migrate
```

- [ ] **Step 7: Verifică pe remote că tabelul chiar există**

Migrarea poate raporta succes fără să fi rulat (vezi `reference_drizzle_journal_when_sub_remote`). Verifică efectiv:

```bash
cd app && bun run db:studio
```

sau interoghează direct `PRAGMA table_info(gsc_integration);`. Expected: 11 coloane. **Nu trece mai departe până nu vezi tabelul pe remote.**

- [ ] **Step 8: Abia acum adaugă tabelul în `schema.ts`**

În `app/src/lib/server/db/schema.ts`, lângă celelalte tabele de integrare (după `googleAdsIntegration`, în jurul liniei 2675):

```ts
/**
 * Integrare Google Search Console per tenant. Oglindă după `googleAdsIntegration`,
 * cu o diferență: aici tokenii sunt DOAR criptați (fără coloane în clar), fiindcă
 * tabelul e nou și nu avem date vechi de migrat.
 */
export const gscIntegration = sqliteTable('gsc_integration', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	email: text('email').notNull(),
	accessTokenEncrypted: text('access_token_encrypted').notNull(),
	refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
	tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
	isActive: boolean('is_active').notNull().default(true),
	lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
	lastError: text('last_error'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`)
});
```

- [ ] **Step 9: Verifică tipurile**

```bash
cd app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning
```

Expected: `0 errors and 0 warnings`.

- [ ] **Step 10: Commit**

```bash
cd app && git add drizzle/0525_gsc_integration.sql drizzle/0526_gsc_integration_tenant_uidx.sql drizzle/meta/_journal.json src/lib/server/db/schema.ts
git commit -m "feat(gsc): tabelul de integrare Search Console per tenant"
```

---

## Task 2: Migrarea și schema pentru proprietatea GSC pe proiect

**Files:**
- Create: `app/drizzle/0527_rank_project_gsc_property.sql`
- Modify: `app/drizzle/meta/_journal.json`
- Modify: `app/src/lib/server/db/schema.ts` (tabelul `rankProject`, în jurul liniei 6559)

- [ ] **Step 1: Scrie migrarea**

`app/drizzle/0527_rank_project_gsc_property.sql`:

```sql
ALTER TABLE `rank_project` ADD `gsc_property` text;
```

- [ ] **Step 2: Adaugă intrarea în `_journal.json`**

```json
    {
      "idx": 527,
      "version": "6",
      "when": 1788400000000002,
      "tag": "0527_rank_project_gsc_property",
      "breakpoints": true
    }
```

- [ ] **Step 3: Aplică și verifică pe remote**

```bash
cd app && bun run db:migrate
```

Verifică `PRAGMA table_info(rank_project);` — trebuie să apară `gsc_property`.

- [ ] **Step 4: Adaugă coloana în `schema.ts`**

În definiția `rankProject`, imediat după `competitors`:

```ts
		/**
		 * Proprietatea din Search Console, în formatul cerut de API:
		 * „sc-domain:heylux.ro" (domain property) sau „https://www.heylux.ro/" (URL prefix).
		 * null = proiectul nu e legat încă de GSC.
		 */
		gscProperty: text('gsc_property'),
```

- [ ] **Step 5: Verifică tipurile**

```bash
cd app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning
```

Expected: `0 errors and 0 warnings`.

- [ ] **Step 6: Commit**

```bash
cd app && git add drizzle/0527_rank_project_gsc_property.sql drizzle/meta/_journal.json src/lib/server/db/schema.ts
git commit -m "feat(gsc): proprietatea Search Console pe proiectul de rank"
```

---

## Task 3: Migrarea și schema pentru `rank_gsc_daily`

**Files:**
- Create: `app/drizzle/0528_rank_gsc_daily.sql`
- Create: `app/drizzle/0529_rank_gsc_daily_uidx.sql`
- Modify: `app/drizzle/meta/_journal.json`
- Modify: `app/src/lib/server/db/schema.ts`

- [ ] **Step 1: Scrie migrarea tabelului**

`app/drizzle/0528_rank_gsc_daily.sql`:

```sql
CREATE TABLE `rank_gsc_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword_id` text NOT NULL REFERENCES `rank_keyword`(`id`) ON DELETE CASCADE,
	`gsc_date` text NOT NULL,
	`device` text NOT NULL,
	`clicks` integer NOT NULL DEFAULT 0,
	`impressions` integer NOT NULL DEFAULT 0,
	`ctr` real,
	`position` real,
	`created_at` text NOT NULL DEFAULT current_timestamp,
	`updated_at` text NOT NULL DEFAULT current_timestamp
);
```

- [ ] **Step 2: Scrie migrarea indexului unic**

`app/drizzle/0529_rank_gsc_daily_uidx.sql`:

```sql
CREATE UNIQUE INDEX `rank_gsc_daily_kw_device_date_uidx` ON `rank_gsc_daily` (`keyword_id`, `device`, `gsc_date`);
```

- [ ] **Step 3: Adaugă intrările în `_journal.json`** (idx 528 și 529, același tipar ca la Task 1)

- [ ] **Step 4: Aplică și verifică pe remote**

```bash
cd app && bun run db:migrate
```

- [ ] **Step 5: Adaugă tabelul în `schema.ts`**, imediat după `rankSnapshot`:

```ts
/**
 * Datele zilnice din Google Search Console, per cuvânt urmărit.
 *
 * `gsc_date` NU e `rank_snapshot.day_key`: GSC lucrează în ora Pacificului, noi în
 * Europe/Bucharest. Numele diferit e intenționat, ca nimeni să nu facă un JOIN pe
 * egalitate între ele crezând că e aceeași zi.
 */
export const rankGscDaily = sqliteTable(
	'rank_gsc_daily',
	{
		id: text('id').primaryKey(),
		keywordId: text('keyword_id')
			.notNull()
			.references(() => rankKeyword.id, { onDelete: 'cascade' }),
		/** Ziua raportată de GSC, „YYYY-MM-DD" (ora Pacificului). */
		gscDate: text('gsc_date').notNull(),
		device: text('device', { enum: ['desktop', 'mobile'] }).notNull(),
		clicks: integer('clicks').notNull().default(0),
		impressions: integer('impressions').notNull().default(0),
		/** CTR 0–100 cu o zecimală (GSC întoarce 0–1). */
		ctr: real('ctr'),
		/** Poziția medie GSC, cu o zecimală. Mediată peste locații și pagini. */
		position: real('position'),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`)
	},
	(t) => ({
		kwDeviceDateUnique: uniqueIndex('rank_gsc_daily_kw_device_date_uidx').on(
			t.keywordId,
			t.device,
			t.gscDate
		)
	})
);
```

- [ ] **Step 6: Verifică tipurile și commit**

```bash
cd app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning
git add drizzle/0528_rank_gsc_daily.sql drizzle/0529_rank_gsc_daily_uidx.sql drizzle/meta/_journal.json src/lib/server/db/schema.ts
git commit -m "feat(gsc): tabelul de metrici zilnice per cuvânt cheie"
```

---

## Task 4: Logica pură (`$lib/logic/gsc.ts`)

Modul fără rețea și fără DB, testabil direct. Aici stă regula care ar fi prins cazul heylux.

**Files:**
- Create: `app/src/lib/logic/gsc.ts`
- Create: `app/src/lib/logic/__tests__/gsc.test.ts`
- Modify: `app/src/lib/logic/rank-tracker.ts` (exportă `normalizeKeyword`)
- Modify: `app/src/lib/remotes/rank-tracker.remote.ts` (folosește exportul)

- [ ] **Step 1: Scrie testele care pică**

`app/src/lib/logic/__tests__/gsc.test.ts`:

```ts
// Teste pentru logica pură GSC: fereastra de tragere, parsarea rândurilor
// searchanalytics și semnalul de divergență față de poziția scrapată. ZERO mockuri.
import { describe, test, expect } from 'bun:test';
import { gscPullWindow, parseGscRows, gscTrust } from '../gsc';

describe('gscPullWindow — retragem 7 zile la fiecare rulare', () => {
	test('fereastra se termină azi și acoperă 7 zile', () => {
		const w = gscPullWindow(new Date('2026-09-02T10:00:00Z'));
		expect(w.endDate).toBe('2026-09-02');
		expect(w.startDate).toBe('2026-08-27');
	});

	test('numărul de zile e configurabil', () => {
		const w = gscPullWindow(new Date('2026-09-02T10:00:00Z'), 3);
		expect(w).toEqual({ startDate: '2026-08-31', endDate: '2026-09-02' });
	});

	test('traversează granița de lună', () => {
		expect(gscPullWindow(new Date('2026-03-02T00:00:00Z'), 4).startDate).toBe('2026-02-27');
	});
});

describe('parseGscRows — dimensiunile sunt [query, device, date]', () => {
	const row = (keys: string[], over: Record<string, number> = {}) => ({
		keys,
		clicks: 5,
		impressions: 100,
		ctr: 0.05,
		position: 7.4,
		...over
	});

	test('mapează un rând complet, cu CTR convertit în procente', () => {
		expect(parseGscRows([row(['videochat iasi', 'DESKTOP', '2026-09-01'])])).toEqual([
			{
				keyword: 'videochat iasi',
				device: 'desktop',
				date: '2026-09-01',
				clicks: 5,
				impressions: 100,
				ctr: 5,
				position: 7.4
			}
		]);
	});

	test('normalizează interogarea (spații multiple, majuscule)', () => {
		const [r] = parseGscRows([row(['  Studio   Videochat ', 'MOBILE', '2026-09-01'])]);
		expect(r.keyword).toBe('studio videochat');
		expect(r.device).toBe('mobile');
	});

	test('TABLET se ignoră — nu urmărim tablete nicăieri în modul', () => {
		expect(parseGscRows([row(['x', 'TABLET', '2026-09-01'])])).toEqual([]);
	});

	test('rânduri fără interogare, fără dată validă sau fără keys → ignorate', () => {
		expect(
			parseGscRows([
				row(['', 'DESKTOP', '2026-09-01']),
				row(['x', 'DESKTOP', 'ieri']),
				{ clicks: 1, impressions: 2, ctr: 0.5, position: 1 }
			])
		).toEqual([]);
	});

	test('intrare non-array → listă goală, fără excepție', () => {
		expect(parseGscRows(undefined)).toEqual([]);
		expect(parseGscRows(null)).toEqual([]);
	});

	test('valorile lipsă devin 0, nu undefined', () => {
		const [r] = parseGscRows([{ keys: ['a', 'DESKTOP', '2026-09-01'] }]);
		expect(r).toEqual({
			keyword: 'a',
			device: 'desktop',
			date: '2026-09-01',
			clicks: 0,
			impressions: 0,
			ctr: 0,
			position: 0
		});
	});
});

describe('gscTrust — semnalul care ar fi prins cazul heylux', () => {
	test('noi n-am găsit nimic, dar Google raportează afișări → scrape-missing', () => {
		expect(gscTrust(null, 8.2, 340)).toBe('scrape-missing');
	});

	test('noi n-am găsit nimic și nici Google nu are afișări → ok', () => {
		expect(gscTrust(null, null, 0)).toBe('ok');
	});

	test('pozițiile sunt apropiate → ok', () => {
		expect(gscTrust(7, 8.2, 340)).toBe('ok');
		expect(gscTrust(7, 16.9, 340)).toBe('ok');
	});

	test('diferență de cel puțin 10 poziții → divergent', () => {
		expect(gscTrust(3, 13, 340)).toBe('divergent');
		expect(gscTrust(40, 5.5, 340)).toBe('divergent');
	});

	test('fără date GSC (0 afișări) nu declarăm niciodată divergență', () => {
		expect(gscTrust(3, 90, 0)).toBe('ok');
		expect(gscTrust(3, null, 120)).toBe('ok');
	});
});
```

- [ ] **Step 2: Rulează testele ca să confirmi că pică**

```bash
cd app && bun run test logic/__tests__/gsc
```

Expected: FAIL cu `Cannot find module '../gsc'`.

- [ ] **Step 3: Scrie modulul**

`app/src/lib/logic/gsc.ts`:

```ts
// Logica pură pentru Google Search Console: fereastra de zile trasă la fiecare
// rulare, conversia rândurilor `searchanalytics.query` în forma noastră și semnalul
// de încredere în poziția scrapată. Modul PUR (fără rețea, fără DB) — folosit identic
// de jobul de tragere și de read model.
import { normalizeKeyword } from './rank-tracker';

/** Dispozitivele pe care le urmărim. GSC mai întoarce și „TABLET", pe care îl ignorăm. */
export type GscDevice = 'desktop' | 'mobile';

/** Un rând brut din `searchanalytics.query`, cu dimensiunile [query, device, date]. */
export interface GscRow {
	keys?: string[] | null;
	clicks?: number | null;
	impressions?: number | null;
	ctr?: number | null;
	position?: number | null;
}

export interface GscDailyRecord {
	keyword: string;
	device: GscDevice;
	/** Ziua raportată de GSC, „YYYY-MM-DD" (ora Pacificului). */
	date: string;
	clicks: number;
	impressions: number;
	/** 0–100 cu o zecimală. */
	ctr: number;
	/** Poziția medie, o zecimală. */
	position: number;
}

/** Câte zile retragem la fiecare rulare. */
export const GSC_WINDOW_DAYS = 7;
/** De la ce diferență între poziția scrapată și cea din GSC ridicăm semnalul. */
export const GSC_DIVERGENCE_THRESHOLD = 10;

function isoDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/**
 * Fereastra trasă la fiecare rulare. Retragem mai multe zile pentru că datele
 * proaspete (`dataState: 'all'`) sunt PARȚIALE și Google le rescrie zile la rând;
 * scrierea e upsert, deci fiecare rulare le corectează pe cele anterioare.
 */
export function gscPullWindow(
	today: Date,
	days: number = GSC_WINDOW_DAYS
): { startDate: string; endDate: string } {
	const start = new Date(today.getTime() - (days - 1) * 86400000);
	return { startDate: isoDate(start), endDate: isoDate(today) };
}

function toDevice(raw: unknown): GscDevice | null {
	if (typeof raw !== 'string') return null;
	const v = raw.toLowerCase();
	return v === 'desktop' || v === 'mobile' ? v : null;
}

/** Rândurile GSC → forma noastră. Ce nu se potrivește se aruncă, fără excepție. */
export function parseGscRows(rows: GscRow[] | null | undefined): GscDailyRecord[] {
	if (!Array.isArray(rows)) return [];
	const out: GscDailyRecord[] = [];
	for (const row of rows) {
		const [rawQuery, rawDevice, rawDate] = row?.keys ?? [];
		const keyword = typeof rawQuery === 'string' ? normalizeKeyword(rawQuery) : '';
		const device = toDevice(rawDevice);
		if (!keyword || !device) continue;
		if (typeof rawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) continue;
		out.push({
			keyword,
			device,
			date: rawDate,
			clicks: Math.round(row.clicks ?? 0),
			impressions: Math.round(row.impressions ?? 0),
			// GSC dă CTR în 0–1; îl ținem în procente, ca restul modulului
			ctr: Math.round((row.ctr ?? 0) * 1000) / 10,
			position: Math.round((row.position ?? 0) * 10) / 10
		});
	}
	return out;
}

/** Cât de mult ne putem baza pe poziția scrapată, dat fiind ce spune Google. */
export type GscTrust = 'ok' | 'divergent' | 'scrape-missing';

/**
 * MĂSURAT 2 sep. 2026: heylux.ro apărea „negăsit în primele 30" la toate cuvintele,
 * fiindcă toate rulările fuseseră blocate de Google — dar site-ul era pe poziția 8.
 * `scrape-missing` există exact pentru cazul ăsta: noi n-am găsit nimic, Google
 * raportează afișări, deci datele NOASTRE sunt greșite, nu pozițiile clientului.
 */
export function gscTrust(
	scraped: number | null,
	gscPosition: number | null,
	impressions: number
): GscTrust {
	if (impressions <= 0) return 'ok'; // fără date GSC nu avem cu ce compara
	if (scraped == null) return 'scrape-missing';
	if (gscPosition == null) return 'ok';
	return Math.abs(scraped - gscPosition) >= GSC_DIVERGENCE_THRESHOLD ? 'divergent' : 'ok';
}
```

- [ ] **Step 4: Exportă `normalizeKeyword` din `$lib/logic/rank-tracker.ts`**

Funcția există azi ca funcție privată în `src/lib/remotes/rank-tracker.remote.ts:36`. Mut-o în modulul pur ca să nu avem două implementări care pot diverge. Adaugă în `app/src/lib/logic/rank-tracker.ts`:

```ts
/**
 * Forma canonică a unui cuvânt cheie pentru comparații: fără spații în plus, litere
 * mici. Google nu face diferență între „Studio Videochat" și „studio  videochat".
 * Folosită și la potrivirea interogărilor din GSC cu cuvintele urmărite.
 */
export function normalizeKeyword(input: string): string {
	return input.trim().replace(/\s+/g, ' ').toLowerCase();
}
```

- [ ] **Step 5: Fă remote-ul să folosească exportul**

În `app/src/lib/remotes/rank-tracker.remote.ts`, șterge funcția locală `normalizeKeyword` (liniile ~36-38) și adaug-o în importul existent:

```ts
import { RANK_HOURS, normalizeKeyword } from '$lib/logic/rank-tracker';
```

- [ ] **Step 6: Rulează testele**

```bash
cd app && bun run test gsc && bun run test rank-tracker
```

Expected: toate trec (logica GSC + cele existente de rank, nealterate).

- [ ] **Step 7: Commit**

```bash
cd app && git add src/lib/logic/gsc.ts src/lib/logic/__tests__/gsc.test.ts src/lib/logic/rank-tracker.ts src/lib/remotes/rank-tracker.remote.ts
git commit -m "feat(gsc): logica pură — fereastră, parsare rânduri, semnal de divergență"
```

---

## Task 5: OAuth (`$lib/server/gsc/auth.ts`)

Oglindă după `src/lib/server/google-ads/auth.ts`, cu tokenii **doar criptați**.

**Files:**
- Create: `app/src/lib/server/gsc/auth.ts`

- [ ] **Step 1: Scrie modulul**

```ts
// OAuth Google Search Console per tenant. Tiparul e cel din `google-ads/auth.ts`,
// cu o singură diferență: tokenii se scriu DOAR criptați (tabel nou, fără istoric
// în clar de migrat). Scope-ul e readonly — nu scriem nimic în contul clientului.
import { google } from 'googleapis';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { encryptVerified, decrypt } from '$lib/server/plugins/smartbill/crypto';

const CALLBACK_PATH = '/api/gsc/callback';

/** Doar citire: nu adăugăm și nu ștergem nimic din Search Console-ul clientului. */
const SCOPES = [
	'https://www.googleapis.com/auth/webmasters.readonly',
	'https://www.googleapis.com/auth/userinfo.email'
];

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function getAppOrigin(requestOrigin: string): string {
	return env.PUBLIC_APP_URL || requestOrigin;
}

function getOAuth2Client(redirectUri: string) {
	return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
}

/** `state` = „tenantId:tenantSlug", ca la Google Ads. */
export function getOAuthUrl(state: string, origin: string): string {
	const redirectUri = `${getAppOrigin(origin)}${CALLBACK_PATH}`;
	const url = getOAuth2Client(redirectUri).generateAuthUrl({
		access_type: 'offline',
		scope: SCOPES,
		prompt: 'consent',
		state
	});
	logInfo('gsc', 'OAuth: URL generat', { metadata: { redirectUri } });
	return url;
}

/** Schimbă codul pe tokeni și salvează integrarea (upsert pe tenant). */
export async function handleCallback(
	code: string,
	tenantId: string,
	origin: string
): Promise<{ email: string }> {
	const redirectUri = `${getAppOrigin(origin)}${CALLBACK_PATH}`;
	const client = getOAuth2Client(redirectUri);
	const { tokens } = await client.getToken(code);

	if (!tokens.access_token || !tokens.refresh_token) {
		// Fără refresh_token nu putem trage zilnic. Se întâmplă când userul a mai dat
		// consimțământ o dată; `prompt: 'consent'` de mai sus îl forțează să reapară.
		throw new Error('Google nu a întors refresh_token — reîncearcă autorizarea');
	}

	client.setCredentials(tokens);
	const { data } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
	const email = data.email ?? '';
	const now = new Date();
	const expiresAt = new Date(tokens.expiry_date ?? now.getTime() + 3600_000);

	const values = {
		email,
		accessTokenEncrypted: encryptVerified(tenantId, tokens.access_token),
		refreshTokenEncrypted: encryptVerified(tenantId, tokens.refresh_token),
		tokenExpiresAt: expiresAt,
		isActive: true,
		lastError: null,
		updatedAt: now
	};

	const [existing] = await db
		.select({ id: table.gscIntegration.id })
		.from(table.gscIntegration)
		.where(eq(table.gscIntegration.tenantId, tenantId))
		.limit(1);

	if (existing) {
		await db
			.update(table.gscIntegration)
			.set(values)
			.where(eq(table.gscIntegration.id, existing.id));
	} else {
		await db
			.insert(table.gscIntegration)
			.values({ id: generateId(), tenantId, ...values, createdAt: now });
	}

	logInfo('gsc', 'OAuth: integrare salvată', { tenantId, metadata: { email } });
	return { email };
}

/**
 * Client OAuth gata de folosit, cu tokenii tenantului. `googleapis` reîmprospătează
 * singur access_token-ul din refresh_token; ascultăm evenimentul ca să persistăm
 * tokenul nou, altfel l-am reface la fiecare apel.
 */
export async function getAuthenticatedClient(tenantId: string) {
	const [integration] = await db
		.select()
		.from(table.gscIntegration)
		.where(eq(table.gscIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration || !integration.isActive) {
		throw new Error('Search Console nu este conectat pentru acest cont');
	}

	const client = getOAuth2Client(`${getAppOrigin('')}${CALLBACK_PATH}`);
	client.setCredentials({
		access_token: decrypt(tenantId, integration.accessTokenEncrypted),
		refresh_token: decrypt(tenantId, integration.refreshTokenEncrypted),
		expiry_date: integration.tokenExpiresAt.getTime()
	});

	client.on('tokens', (fresh) => {
		if (!fresh.access_token) return;
		db.update(table.gscIntegration)
			.set({
				accessTokenEncrypted: encryptVerified(tenantId, fresh.access_token),
				tokenExpiresAt: new Date(fresh.expiry_date ?? Date.now() + 3600_000),
				updatedAt: new Date()
			})
			.where(eq(table.gscIntegration.id, integration.id))
			.catch((err) => {
				logWarning('gsc', 'Nu am putut salva access_token-ul reîmprospătat', {
					tenantId,
					metadata: serializeError(err)
				});
			});
	});

	return client;
}
```

- [ ] **Step 2: Verifică tipurile**

```bash
cd app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning
```

Expected: `0 errors and 0 warnings`.

- [ ] **Step 3: Commit**

```bash
cd app && git add src/lib/server/gsc/auth.ts
git commit -m "feat(gsc): OAuth per tenant cu tokeni criptați"
```

---

## Task 6: Rutele de autorizare

**Files:**
- Create: `app/src/routes/api/gsc/auth/+server.ts`
- Create: `app/src/routes/api/gsc/callback/+server.ts`

- [ ] **Step 1: Ruta de start**

`app/src/routes/api/gsc/auth/+server.ts` (copie fidelă a tiparului din `api/google-ads/auth/+server.ts`):

```ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOAuthUrl } from '$lib/server/gsc/auth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	const tenantSlug = url.searchParams.get('tenant');
	if (!tenantSlug) throw redirect(303, '/');

	const [tenant] = await db
		.select({ id: table.tenant.id })
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug))
		.limit(1);
	if (!tenant) throw redirect(303, '/');

	throw redirect(303, getOAuthUrl(`${tenant.id}:${tenantSlug}`, url.origin));
};
```

- [ ] **Step 2: Ruta de callback**

`app/src/routes/api/gsc/callback/+server.ts`:

```ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleCallback } from '$lib/server/gsc/auth';
import { logError, serializeError } from '$lib/server/logger';

const DEST = 'seo-links/rank-tracker';

export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state'); // „tenantId:tenantSlug"
	const oauthError = url.searchParams.get('error');
	const [tenantId, tenantSlug] = (state || '').split(':');

	if (oauthError) {
		throw redirect(303, `/${tenantSlug || ''}/${DEST}?gsc_error=${encodeURIComponent(oauthError)}`);
	}
	if (!code || !tenantId || !tenantSlug) throw redirect(303, '/');

	try {
		await handleCallback(code, tenantId, url.origin);
	} catch (err) {
		const { message } = serializeError(err);
		logError('gsc', `OAuth callback eșuat: ${message}`, { tenantId });
		throw redirect(303, `/${tenantSlug}/${DEST}?gsc_error=${encodeURIComponent(message)}`);
	}
	throw redirect(303, `/${tenantSlug}/${DEST}?gsc=connected`);
};
```

- [ ] **Step 3: Verifică tipurile și fă commit**

```bash
cd app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning
git add src/routes/api/gsc/
git commit -m "feat(gsc): rutele de autorizare OAuth"
```

**Notă pentru configurare (nu e cod):** în Google Cloud Console trebuie adăugat `https://<domeniu>/api/gsc/callback` la „Authorized redirect URIs" ale aceluiași OAuth client folosit de Gmail/Google Ads, iar **Search Console API trebuie activat** pentru proiect.

---

## Task 7: Clientul Search Console

**Files:**
- Create: `app/src/lib/server/gsc/client.ts`
- Create: `app/src/lib/server/gsc/__tests__/client.test.ts`

- [ ] **Step 1: Scrie testele care pică**

`app/src/lib/server/gsc/__tests__/client.test.ts`:

```ts
// Teste pentru clientul Search Console: forma cererii trimise la API și tratarea
// răspunsurilor. API-ul e injectat, deci nu atingem rețeaua.
import { describe, test, expect, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e) })
}));
mock.module('$lib/server/gsc/auth', () => ({ getAuthenticatedClient: async () => ({}) }));

const { querySearchAnalytics, listProperties } = await import('../client');

describe('querySearchAnalytics', () => {
	test('cere dimensiunile [query, device, date] pe fereastra dată', async () => {
		let sent: Record<string, unknown> | null = null;
		const rows = await querySearchAnalytics(
			't1',
			'sc-domain:heylux.ro',
			{ startDate: '2026-08-27', endDate: '2026-09-02' },
			{
				api: {
					searchanalytics: {
						query: async (params: Record<string, unknown>) => {
							sent = params;
							return { data: { rows: [{ keys: ['a', 'DESKTOP', '2026-09-01'] }] } };
						}
					}
				} as never
			}
		);
		expect(sent!.siteUrl).toBe('sc-domain:heylux.ro');
		const body = (sent as { requestBody: Record<string, unknown> }).requestBody;
		expect(body.dimensions).toEqual(['query', 'device', 'date']);
		expect(body.startDate).toBe('2026-08-27');
		expect(body.endDate).toBe('2026-09-02');
		expect(body.dataState).toBe('all');
		expect(body.rowLimit).toBe(25000);
		expect(rows.length).toBe(1);
	});

	test('răspuns fără rânduri → listă goală, nu undefined', async () => {
		const rows = await querySearchAnalytics(
			't1',
			'sc-domain:x.ro',
			{ startDate: '2026-08-27', endDate: '2026-09-02' },
			{ api: { searchanalytics: { query: async () => ({ data: {} }) } } as never }
		);
		expect(rows).toEqual([]);
	});
});

describe('listProperties', () => {
	test('întoarce doar proprietățile cu permisiune de citire', async () => {
		const props = await listProperties('t1', {
			api: {
				sites: {
					list: async () => ({
						data: {
							siteEntry: [
								{ siteUrl: 'sc-domain:a.ro', permissionLevel: 'siteOwner' },
								{ siteUrl: 'https://b.ro/', permissionLevel: 'siteUnverifiedUser' },
								{ siteUrl: 'sc-domain:c.ro', permissionLevel: 'siteFullUser' }
							]
						}
					})
				}
			} as never
		});
		expect(props).toEqual(['sc-domain:a.ro', 'sc-domain:c.ro']);
	});
});
```

- [ ] **Step 2: Rulează testele ca să confirmi că pică**

```bash
cd app && bun run test gsc/__tests__/client
```

Expected: FAIL cu `Cannot find module '../client'`.

**Dacă pică altfel** — cu o eroare venită din `auth.ts` la încărcarea modulului (crypto sau env care citesc ceva la import) — adaugă mockul lipsă la începutul fișierului de test, lângă celelalte. `getAuthenticatedClient` NU e apelat în teste (injectăm `api`), deci mockul trebuie doar să facă importul să treacă. Exemplu, dacă crypto e vinovatul:

```ts
mock.module('$lib/server/plugins/smartbill/crypto', () => ({
	encryptVerified: (_t: string, v: string) => v,
	decrypt: (_t: string, v: string) => v
}));
```

- [ ] **Step 3: Scrie clientul**

`app/src/lib/server/gsc/client.ts`:

```ts
// Apelurile Google Search Console API v5 (`searchanalytics.query`, `sites.list`).
// `api` e injectabil, ca testele să nu atingă rețeaua. Orice apel are timeout —
// regula casei pentru fetch extern.
import { google } from 'googleapis';
import { getAuthenticatedClient } from './auth';
import type { GscRow } from '$lib/logic/gsc';

const TIMEOUT_MS = 60_000;
/** Maximul acceptat de API (docs: valid range 1–25.000). */
const ROW_LIMIT = 25000;

type SearchConsoleApi = ReturnType<typeof google.searchconsole>;
type Deps = { api?: SearchConsoleApi };

async function getApi(tenantId: string, deps: Deps): Promise<SearchConsoleApi> {
	if (deps.api) return deps.api;
	const auth = await getAuthenticatedClient(tenantId);
	return google.searchconsole({ version: 'v1', auth });
}

/**
 * Rândurile de performanță pentru o proprietate, pe fereastra dată.
 * `dataState: 'all'` include și zilele proaspete (parțiale) — de aceea jobul retrage
 * fereastra la fiecare rulare și face upsert.
 */
export async function querySearchAnalytics(
	tenantId: string,
	property: string,
	window: { startDate: string; endDate: string },
	deps: Deps = {}
): Promise<GscRow[]> {
	const api = await getApi(tenantId, deps);
	const res = await api.searchanalytics.query(
		{
			siteUrl: property,
			requestBody: {
				startDate: window.startDate,
				endDate: window.endDate,
				dimensions: ['query', 'device', 'date'],
				type: 'web',
				dataState: 'all',
				rowLimit: ROW_LIMIT
			}
		},
		{ timeout: TIMEOUT_MS }
	);
	return (res.data.rows ?? []) as GscRow[];
}

/** Proprietățile la care contul conectat are drept de citire. */
export async function listProperties(tenantId: string, deps: Deps = {}): Promise<string[]> {
	const api = await getApi(tenantId, deps);
	const res = await api.sites.list({}, { timeout: TIMEOUT_MS });
	return (res.data.siteEntry ?? [])
		.filter((s) => s.siteUrl && s.permissionLevel && s.permissionLevel !== 'siteUnverifiedUser')
		.map((s) => s.siteUrl as string);
}
```

- [ ] **Step 4: Rulează testele**

```bash
cd app && bun run test gsc
```

Expected: toate trec.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/server/gsc/client.ts src/lib/server/gsc/__tests__/client.test.ts
git commit -m "feat(gsc): clientul Search Console API"
```

---

## Task 8: Jobul zilnic de tragere

**Files:**
- Create: `app/src/lib/server/scheduler/tasks/gsc-daily-pull.ts`
- Create: `app/src/lib/server/scheduler/tasks/__tests__/gsc-daily-pull.test.ts`

- [ ] **Step 1: Scrie testele care pică**

`app/src/lib/server/scheduler/tasks/__tests__/gsc-daily-pull.test.ts`:

```ts
// Teste pentru jobul de tragere GSC. Toate dependențele sunt injectate (tiparul
// `RankDailyDeps` din rank-daily-check) — fără DB, fără rețea.
import { describe, test, expect, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e) })
}));

const { processGscDailyPull } = await import('../gsc-daily-pull');

const baseDeps = () => ({
	now: () => new Date('2026-09-02T08:00:00Z'),
	loadIntegrations: async () => [{ tenantId: 't1' }],
	loadProjects: async () => [{ id: 'p1', gscProperty: 'sc-domain:heylux.ro' }],
	loadKeywords: async () => [
		{ id: 'k1', keyword: 'videochat iasi' },
		{ id: 'k2', keyword: 'studio videochat' }
	],
	queryGsc: async () => [
		{ keys: ['videochat iasi', 'DESKTOP', '2026-09-01'], clicks: 3, impressions: 120, ctr: 0.025, position: 8.2 },
		{ keys: ['cuvant neurmarit', 'DESKTOP', '2026-09-01'], clicks: 1, impressions: 5, ctr: 0.2, position: 3 }
	],
	saveRows: async () => {},
	markSynced: async () => {}
});

describe('processGscDailyPull', () => {
	test('scrie doar rândurile care se potrivesc cu cuvintele urmărite', async () => {
		const saved: Record<string, unknown>[] = [];
		const result = await processGscDailyPull({
			...baseDeps(),
			saveRows: async (rows) => {
				saved.push(...rows);
			}
		});
		expect(saved.length).toBe(1);
		expect(saved[0]).toMatchObject({
			keywordId: 'k1',
			device: 'desktop',
			gscDate: '2026-09-01',
			clicks: 3,
			impressions: 120,
			position: 8.2
		});
		expect(result).toMatchObject({ tenants: 1, properties: 1, rowsSaved: 1 });
	});

	test('potrivirea ignoră majusculele și spațiile duble', async () => {
		const saved: Record<string, unknown>[] = [];
		await processGscDailyPull({
			...baseDeps(),
			loadKeywords: async () => [{ id: 'k9', keyword: 'Studio   Videochat' }],
			queryGsc: async () => [
				{ keys: ['studio videochat', 'MOBILE', '2026-09-01'], clicks: 0, impressions: 9, ctr: 0, position: 22 }
			],
			saveRows: async (rows) => {
				saved.push(...rows);
			}
		});
		expect(saved.length).toBe(1);
		expect(saved[0]).toMatchObject({ keywordId: 'k9', device: 'mobile' });
	});

	test('proiect fără proprietate configurată → sărit, fără apel la API', async () => {
		let called = 0;
		const result = await processGscDailyPull({
			...baseDeps(),
			loadProjects: async () => [{ id: 'p1', gscProperty: null }],
			queryGsc: async () => {
				called++;
				return [];
			}
		});
		expect(called).toBe(0);
		expect(result).toMatchObject({ properties: 0, rowsSaved: 0 });
	});

	test('o proprietate care crapă NU oprește restul cozii', async () => {
		const saved: Record<string, unknown>[] = [];
		const result = await processGscDailyPull({
			...baseDeps(),
			loadProjects: async () => [
				{ id: 'p1', gscProperty: 'sc-domain:rupt.ro' },
				{ id: 'p2', gscProperty: 'sc-domain:heylux.ro' }
			],
			queryGsc: async (_t, property) => {
				if (property.includes('rupt')) throw new Error('403 insufficient permissions');
				return [
					{ keys: ['videochat iasi', 'DESKTOP', '2026-09-01'], clicks: 1, impressions: 10, ctr: 0.1, position: 5 }
				];
			},
			saveRows: async (rows) => {
				saved.push(...rows);
			}
		});
		expect(saved.length).toBe(1);
		expect(result.failed).toBe(1);
	});

	test('fără integrări active → iese curat', async () => {
		const result = await processGscDailyPull({
			...baseDeps(),
			loadIntegrations: async () => []
		});
		expect(result).toMatchObject({ tenants: 0, properties: 0, rowsSaved: 0, failed: 0 });
	});
});
```

- [ ] **Step 2: Rulează ca să confirmi că pică**

```bash
cd app && bun run test gsc-daily-pull
```

Expected: FAIL cu `Cannot find module '../gsc-daily-pull'`.

- [ ] **Step 3: Scrie jobul**

`app/src/lib/server/scheduler/tasks/gsc-daily-pull.ts`:

```ts
// Job zilnic: pentru fiecare tenant cu integrare GSC activă, trage performanța
// ultimelor `GSC_WINDOW_DAYS` zile pentru fiecare proiect care are proprietate
// configurată și scrie o linie per (cuvânt urmărit, dispozitiv, zi GSC).
// O proprietate care crapă (403, proprietate ștearsă) NU oprește restul cozii.
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { gscPullWindow, parseGscRows, type GscRow } from '$lib/logic/gsc';
import { normalizeKeyword } from '$lib/logic/rank-tracker';
import { querySearchAnalytics } from '$lib/server/gsc/client';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export interface GscDailyRow {
	keywordId: string;
	device: 'desktop' | 'mobile';
	gscDate: string;
	clicks: number;
	impressions: number;
	ctr: number;
	position: number;
}

export interface GscPullDeps {
	now?: () => Date;
	loadIntegrations?: () => Promise<{ tenantId: string }[]>;
	loadProjects?: (tenantId: string) => Promise<{ id: string; gscProperty: string | null }[]>;
	loadKeywords?: (projectId: string) => Promise<{ id: string; keyword: string }[]>;
	queryGsc?: (
		tenantId: string,
		property: string,
		window: { startDate: string; endDate: string }
	) => Promise<GscRow[]>;
	saveRows?: (rows: GscDailyRow[]) => Promise<void>;
	markSynced?: (tenantId: string, error: string | null) => Promise<void>;
}

export interface GscPullSummary {
	tenants: number;
	properties: number;
	rowsSaved: number;
	failed: number;
}

async function defaultLoadIntegrations() {
	return db
		.select({ tenantId: table.gscIntegration.tenantId })
		.from(table.gscIntegration)
		.where(eq(table.gscIntegration.isActive, true));
}

async function defaultLoadProjects(tenantId: string) {
	return db
		.select({ id: table.rankProject.id, gscProperty: table.rankProject.gscProperty })
		.from(table.rankProject)
		.where(and(eq(table.rankProject.tenantId, tenantId), eq(table.rankProject.active, true)));
}

async function defaultLoadKeywords(projectId: string) {
	return db
		.select({ id: table.rankKeyword.id, keyword: table.rankKeyword.keyword })
		.from(table.rankKeyword)
		.where(eq(table.rankKeyword.projectId, projectId));
}

/** Upsert pe (keyword, device, gscDate) — fereastra se retrage, deci rescriem. */
async function defaultSaveRows(rows: GscDailyRow[]) {
	const now = new Date();
	for (const row of rows) {
		await db
			.insert(table.rankGscDaily)
			.values({ id: generateId(), ...row, createdAt: now, updatedAt: now })
			.onConflictDoUpdate({
				target: [
					table.rankGscDaily.keywordId,
					table.rankGscDaily.device,
					table.rankGscDaily.gscDate
				],
				set: {
					clicks: row.clicks,
					impressions: row.impressions,
					ctr: row.ctr,
					position: row.position,
					updatedAt: now
				}
			});
	}
}

async function defaultMarkSynced(tenantId: string, error: string | null) {
	await db
		.update(table.gscIntegration)
		.set({ lastSyncAt: new Date(), lastError: error, updatedAt: new Date() })
		.where(eq(table.gscIntegration.tenantId, tenantId));
}

export async function processGscDailyPull(deps: GscPullDeps = {}): Promise<GscPullSummary> {
	const now = deps.now ?? (() => new Date());
	const loadIntegrations = deps.loadIntegrations ?? defaultLoadIntegrations;
	const loadProjects = deps.loadProjects ?? defaultLoadProjects;
	const loadKeywords = deps.loadKeywords ?? defaultLoadKeywords;
	const queryGsc = deps.queryGsc ?? querySearchAnalytics;
	const saveRows = deps.saveRows ?? defaultSaveRows;
	const markSynced = deps.markSynced ?? defaultMarkSynced;

	const window = gscPullWindow(now());
	const summary: GscPullSummary = { tenants: 0, properties: 0, rowsSaved: 0, failed: 0 };

	for (const { tenantId } of await loadIntegrations()) {
		summary.tenants++;
		let tenantError: string | null = null;

		for (const project of await loadProjects(tenantId)) {
			if (!project.gscProperty) continue; // proiect nelegat de GSC
			summary.properties++;
			try {
				const keywords = await loadKeywords(project.id);
				// potrivim pe forma canonică: GSC întoarce interogarea așa cum a scris-o userul
				const byKeyword = new Map(keywords.map((k) => [normalizeKeyword(k.keyword), k.id]));

				const rows: GscDailyRow[] = [];
				for (const rec of parseGscRows(await queryGsc(tenantId, project.gscProperty, window))) {
					const keywordId = byKeyword.get(rec.keyword);
					if (!keywordId) continue; // interogare pe care nu o urmărim (vezi Faza 2)
					rows.push({
						keywordId,
						device: rec.device,
						gscDate: rec.date,
						clicks: rec.clicks,
						impressions: rec.impressions,
						ctr: rec.ctr,
						position: rec.position
					});
				}
				if (rows.length) await saveRows(rows);
				summary.rowsSaved += rows.length;
			} catch (err) {
				summary.failed++;
				const { message } = serializeError(err);
				tenantError = message.slice(0, 500);
				logError('scheduler', `[gsc] ${project.gscProperty}: ${message}`, { tenantId });
			}
		}

		await markSynced(tenantId, tenantError);
	}

	logInfo(
		'scheduler',
		`[gsc] ${summary.tenants} tenanți, ${summary.properties} proprietăți, ${summary.rowsSaved} rânduri, ${summary.failed} eșecuri`
	);
	return summary;
}
```

- [ ] **Step 4: Rulează testele**

```bash
cd app && bun run test gsc-daily-pull
```

Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/server/scheduler/tasks/gsc-daily-pull.ts src/lib/server/scheduler/tasks/__tests__/gsc-daily-pull.test.ts
git commit -m "feat(gsc): jobul zilnic de tragere a datelor Search Console"
```

---

## Task 9: Înregistrarea jobului în scheduler

**Files:**
- Modify: `app/src/lib/server/scheduler/index.ts`

- [ ] **Step 1: Citește tiparul existent**

```bash
cd app && grep -n "rank_daily_check\|'rank-daily-check'" src/lib/server/scheduler/index.ts
```

Sunt 4 locuri de atins (handler, listă de nume, programare repetabilă, etichetă). Le replici pentru `gsc_daily_pull`.

- [ ] **Step 2: Importă și înregistrează handlerul**

Lângă importurile celorlalte task-uri:

```ts
import { processGscDailyPull } from './tasks/gsc-daily-pull';
```

În maparea de handlere (lângă `rank_daily_check: () => processRankDailyCheck(),`, linia ~217):

```ts
	gsc_daily_pull: () => processGscDailyPull(),
```

- [ ] **Step 3: Adaugă numele jobului în lista de la linia ~394**

În array-ul care conține `'rank-daily-check', 'rank-weekly-report', 'rank-volume-refresh'`, adaugă `'gsc-daily-pull'`.

- [ ] **Step 4: Programează jobul repetabil**

Imediat după blocul `rank-daily-check` (linia ~1179-1188), cu exact aceeași formă de opțiuni ca el (`schedulerQueue`, `repeat.pattern`, `tz`, `jobId`, `attempts: 1`, plus `logInfo` după). Rulează zilnic la 05:00, **înainte** de verificarea de poziții (06:00 implicit), ca datele GSC să fie deja acolo:

```ts
	// Search Console — tragere zilnică la 05:00, înaintea verificării de poziții,
	// ca semnalul de divergență să aibă cu ce compara snapshotul din aceeași zi.
	await schedulerQueue.add(
		'gsc-daily-pull',
		{ type: 'gsc_daily_pull', params: {} },
		{
			repeat: { pattern: '0 5 * * *', tz: 'Europe/Bucharest' },
			jobId: 'gsc-daily-pull',
			attempts: 1
		}
	);
	logInfo('scheduler', '[scheduler] gsc-daily-pull registered (0 5 * * * Europe/Bucharest)');
```

- [ ] **Step 5: Adaugă eticheta (linia ~1275)**

```ts
	gsc_daily_pull: 'Tragere zilnică date Google Search Console (Rank Tracker)',
```

- [ ] **Step 6: Verifică tipurile și rulează toate testele**

```bash
cd app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning && bun run test
```

Expected: `0 errors and 0 warnings`, toate testele trec.

- [ ] **Step 7: Commit**

```bash
cd app && git add src/lib/server/scheduler/index.ts
git commit -m "feat(gsc): înregistrează jobul zilnic în scheduler"
```

---

## Task 10: Read model — datele GSC lângă poziții

**Files:**
- Modify: `app/src/lib/server/rank-tracker/projects-data.ts`

- [ ] **Step 1: Adaugă tipul pe `RankKeywordDetail`**

În interfața `RankKeywordDetail`, după `topResults`:

```ts
	/**
	 * Ultima zi cu date din Search Console pentru acest cuvânt+dispozitiv, plus
	 * verdictul de încredere în poziția scrapată. `null` = fie nu e conectat GSC,
	 * fie proprietatea nu raportează nimic pentru cuvântul ăsta.
	 */
	gsc: RankGscSummary | null;
```

Și tipul, lângă `RankSerpResult`:

```ts
export interface RankGscSummary {
	/** Ziua GSC (ora Pacificului) din care vin cifrele. */
	date: string;
	clicks: number;
	impressions: number;
	/** 0–100. */
	ctr: number;
	/** Poziția medie GSC — mediată peste locații și pagini. */
	position: number;
	trust: GscTrust;
}
```

- [ ] **Step 2: Importă ce trebuie**

```ts
import { gscTrust, type GscTrust } from '$lib/logic/gsc';
```

- [ ] **Step 3: Încarcă datele GSC odată pentru toate cuvintele**

Lângă interogarea de snapshoturi din `buildRankProjectDetail` (după blocul care încarcă `rankSnapshot`, în jurul liniei 345), adaugă:

```ts
	// O singură interogare pentru tot proiectul, nu una per cuvânt. Luăm ultimele
	// GSC_WINDOW_DAYS zile și păstrăm în JS cea mai recentă per (cuvânt, dispozitiv).
	const gscRows = keywordIds.length
		? await db
				.select()
				.from(table.rankGscDaily)
				.where(inArray(table.rankGscDaily.keywordId, keywordIds))
				.orderBy(desc(table.rankGscDaily.gscDate))
				.limit(keywordIds.length * GSC_WINDOW_DAYS * 2)
		: [];
	const latestGsc = new Map<string, (typeof gscRows)[number]>();
	for (const row of gscRows) {
		const key = `${row.keywordId}:${row.device}`;
		if (!latestGsc.has(key)) latestGsc.set(key, row); // sortat desc → prima e cea mai nouă
	}
```

Adaugă `GSC_WINDOW_DAYS` la importul din `$lib/logic/gsc`.

- [ ] **Step 4: Pune câmpul pe fiecare cuvânt**

În obiectul împins în `detailKeywords`, după `topResults`:

```ts
				gsc: (() => {
					const row = latestGsc.get(`${kw.id}:${device}`);
					if (!row) return null;
					return {
						date: row.gscDate,
						clicks: row.clicks,
						impressions: row.impressions,
						ctr: row.ctr ?? 0,
						position: row.position ?? 0,
						trust: gscTrust(nowPos, row.position, row.impressions)
					};
				})(),
```

- [ ] **Step 5: Verifică tipurile și rulează testele**

```bash
cd app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning && bun run test rank
```

Expected: `0 errors and 0 warnings`, toate testele de rank trec.

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/server/rank-tracker/projects-data.ts
git commit -m "feat(gsc): expune datele Search Console în read model-ul de rank"
```

---

## Task 11: Remote functions

**Files:**
- Create: `app/src/lib/remotes/gsc.remote.ts`
- Create: `app/src/lib/remotes/__tests__/gsc.remote.test.ts`

- [ ] **Step 1: Scrie testele care pică**

Harnessul de mockuri se copiază **verbatim** din `app/src/lib/remotes/__tests__/rank-tracker.remote.test.ts`, liniile 1-70: eager-load pe schema reală (`await import('$lib/server/db/schema')` ÎNAINTE de orice mock — `mock.module` e global în Bun), `selectQueue`/`dbMock` cu lanțul de chain-uri, `redisMock`, `currentEvent` și mockul pentru `$app/server`. Nu-l rescrie de la zero; singura schimbare e ultima linie, care importă `../gsc.remote` în loc de `../rank-tracker.remote`.

Peste harness, adaugă exact aceste teste:

```ts
describe('getGscStatus', () => {
	test('fără sesiune → 401', async () => {
		currentEvent = null;
		await expect(remote.getGscStatus()).rejects.toThrow();
	});

	test('fără integrare → connected false', async () => {
		selectQueue.push([]);
		expect(await remote.getGscStatus()).toMatchObject({ connected: false });
	});

	test('NU întoarce niciodată tokenii', async () => {
		selectQueue.push([
			{
				email: 'x@y.ro',
				isActive: true,
				accessTokenEncrypted: 'SECRET',
				refreshTokenEncrypted: 'SECRET',
				lastSyncAt: null,
				lastError: null
			}
		]);
		const status = await remote.getGscStatus();
		expect(JSON.stringify(status)).not.toContain('SECRET');
	});
});

describe('setGscProperty', () => {
	test('proiect din alt tenant → 404', async () => {
		selectQueue.push([]); // proiectul nu se găsește sub tenantId-ul sesiunii
		await expect(
			remote.setGscProperty({ projectId: 'p-strain', property: 'sc-domain:x.ro' })
		).rejects.toThrow();
	});
});
```

- [ ] **Step 2: Rulează ca să confirmi că pică**

```bash
cd app && bun run test gsc.remote
```

Expected: FAIL — modulul nu există.

- [ ] **Step 3: Scrie remote-ul**

`app/src/lib/remotes/gsc.remote.ts`:

```ts
// Remote functions pentru integrarea Search Console. Ca peste tot în proiect:
// requireStaff + scoping pe tenantul din sesiune. Tokenii NU pleacă niciodată
// spre client — doar starea conexiunii.
import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { requireStaff } from '$lib/server/get-actor';

function requireTenantEvent() {
	const event = getRequestEvent();
	const tenant = event?.locals.tenant;
	if (!event?.locals.user || !tenant) throw error(401, 'Unauthorized');
	return { event, tenantId: tenant.id };
}

/** Starea conexiunii — fără tokeni, doar ce are nevoie UI-ul. */
export const getGscStatus = query(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	const [row] = await db
		.select()
		.from(table.gscIntegration)
		.where(eq(table.gscIntegration.tenantId, tenantId))
		.limit(1);
	if (!row) return { connected: false as const };
	return {
		connected: true as const,
		email: row.email,
		isActive: row.isActive,
		lastSyncAt: row.lastSyncAt,
		lastError: row.lastError
	};
});

/** Proprietățile la care contul conectat are acces (pentru dropdown). */
export const getGscProperties = query(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	const { listProperties } = await import('$lib/server/gsc/client');
	return listProperties(tenantId);
});

const propertySchema = v.object({
	projectId: v.pipe(v.string(), v.minLength(1)),
	/** „sc-domain:exemplu.ro" sau „https://www.exemplu.ro/"; gol = deconectare. */
	property: v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(300)))
});

export const setGscProperty = command(propertySchema, async ({ projectId, property }) => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);

	const [project] = await db
		.select({ id: table.rankProject.id })
		.from(table.rankProject)
		.where(and(eq(table.rankProject.id, projectId), eq(table.rankProject.tenantId, tenantId)))
		.limit(1);
	if (!project) throw error(404, 'Proiectul nu a fost găsit');

	await db
		.update(table.rankProject)
		.set({ gscProperty: property || null, updatedAt: new Date() })
		.where(and(eq(table.rankProject.id, projectId), eq(table.rankProject.tenantId, tenantId)));
	return { saved: true };
});

/** Tragere manuală, pentru butonul „Sincronizează acum". */
export const runGscPullNow = command(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	const { processGscDailyPull } = await import('$lib/server/scheduler/tasks/gsc-daily-pull');
	const { gscIntegration } = table;
	return processGscDailyPull({
		loadIntegrations: async () =>
			db
				.select({ tenantId: gscIntegration.tenantId })
				.from(gscIntegration)
				.where(eq(gscIntegration.tenantId, tenantId))
	});
});
```

- [ ] **Step 4: Rulează testele**

```bash
cd app && bun run test gsc
```

Expected: toate trec.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/remotes/gsc.remote.ts src/lib/remotes/__tests__/gsc.remote.test.ts
git commit -m "feat(gsc): remote functions pentru stare, proprietăți și tragere manuală"
```

---

## Task 12: UI — coloanele GSC și badge-ul de divergență

**Files:**
- Modify: `app/src/lib/components/rank-tracker/RankProjectView.svelte`
- Modify: `app/src/lib/components/rank-tracker/KeywordDrawer.svelte`
- Modify: `app/src/lib/components/rank-tracker/rank-tracker.css`

- [ ] **Step 1: Stilul badge-ului**

În `app/src/lib/components/rank-tracker/rank-tracker.css`, lângă `.rt-stack`:

```css
/* semnal că poziția scrapată nu se potrivește cu ce raportează Search Console */
.rt-trust { font-size: 10.5px; font-weight: 800; padding: 2px 6px; border-radius: 5px; white-space: nowrap; }
.rt-trust.divergent { background: rgba(245,158,11,.12); color: #b45309; }
.rt-trust.missing { background: rgba(239,68,68,.12); color: #b91c1c; }
```

- [ ] **Step 2: Coloanele în tabelul de cuvinte**

În `RankProjectView.svelte`, în `<thead>`, după coloana `POZIȚIE`:

```svelte
							<th class="num" title="Afișări în Google Search Console, ultima zi cu date">AFIȘĂRI</th>
							<th class="num" title="Poziția medie din Search Console — mediată peste locații și pagini, nu comparabilă direct cu poziția scrapată">POZ. GSC</th>
```

În `<tbody>`, după celula cu `<RtPos ... />` (linia ~670):

```svelte
							<td class="num">{r.gsc ? r.gsc.impressions : '—'}</td>
							<td class="num">
								{#if r.gsc}
									{r.gsc.position}
									{#if r.gsc.trust === 'scrape-missing'}
										<span class="rt-trust missing" title="Google raportează afișări, dar noi n-am găsit site-ul — măsurătoarea noastră e nesigură (rulare blocată?)">nemăsurat</span>
									{:else if r.gsc.trust === 'divergent'}
										<span class="rt-trust divergent" title="Poziția scrapată diferă cu peste 10 locuri față de media din Search Console">divergent</span>
									{/if}
								{:else}
									—
								{/if}
							</td>
```

**Atenție:** dacă tabelul are undeva un `colspan` pentru starea goală, mărește-l cu 2.

- [ ] **Step 3: Blocul din drawer**

În `KeywordDrawer.svelte`, în interiorul `<div class="rt-stack">`, ca a treia secțiune (după competitori):

```svelte
				<div class="cl-section">
					<div class="cl-section-head">
						<h3><TrendingUpIcon size={15} /> Search Console</h3>
						<p class="cl-section-sub">date raportate de Google, nu scrapate</p>
					</div>
					{#if keyword.gsc}
						<p class="cl-hint">
							{keyword.gsc.date}: {keyword.gsc.impressions} afișări · {keyword.gsc.clicks} clicuri ·
							CTR {keyword.gsc.ctr}% · poziție medie {keyword.gsc.position}
						</p>
						{#if keyword.gsc.trust === 'scrape-missing'}
							<p class="cl-hint">
								Google raportează afișări pentru acest cuvânt, dar rularea noastră nu a găsit
								site-ul. Verifică istoricul rulărilor — probabil au fost blocate.
							</p>
						{/if}
					{:else}
						<p class="cl-hint">
							Fără date — proiectul nu are proprietate Search Console legată, sau cuvântul nu a
							avut afișări în ultimele zile.
						</p>
					{/if}
				</div>
```

- [ ] **Step 4: Rulează autofixer-ul Svelte pe ambele componente**

Obligatoriu (regula casei). Folosește tool-ul `svelte-autofixer` din Svelte MCP pentru `RankProjectView.svelte` și `KeywordDrawer.svelte`. Repară ce raportează și rulează-l din nou până iese curat.

- [ ] **Step 5: Verifică tipurile**

```bash
cd app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning
```

Expected: `0 errors and 0 warnings`.

- [ ] **Step 6: Verifică vizual**

Pornește dev server-ul, intră pe `/ots/seo-links/rank-tracker`, deschide un proiect. Fără proprietate GSC legată, coloanele trebuie să arate `—` peste tot și **nimic nu trebuie să se strice**.

- [ ] **Step 7: Commit**

```bash
cd app && git add src/lib/components/rank-tracker/
git commit -m "feat(gsc): coloane Search Console și semnal de divergență în UI"
```

---

## Task 13: Endpoint de diagnostic (OBLIGATORIU)

Fără ăsta nu ai cum să distingi „OAuth conectat" de „Search Console API activat în Google Cloud" — exact capcana în care s-a intrat la Google Calendar.

**Files:**
- Create: `app/src/routes/[tenant]/api/_debug-gsc-health/+server.ts`

- [ ] **Step 1: Scrie endpointul**

Copiază gate-ul de admin din `app/src/routes/[tenant]/api/_debug-pagespeed-health/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { serializeError } from '$lib/server/logger';
import { gscPullWindow } from '$lib/logic/gsc';
import type { RequestHandler } from './$types';

/**
 * Sondă operațională pentru integrarea Search Console (admin-only, tenant-scoped).
 *
 *   GET            — e conectat? câte proiecte au proprietate? ultima sincronizare?
 *   GET ?probe=1   — apel REAL la API: listează proprietățile și trage o zi.
 *
 * `probe=1` e singurul lucru care dovedește că API-ul e ACTIVAT în Google Cloud:
 * OAuth „connected" nu spune nimic despre asta (lecția de la Google Calendar).
 * Tokenii nu apar niciodată în răspuns.
 */
function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: Admin access required');
	return event.locals.tenant.id;
}

export const GET: RequestHandler = async (event) => {
	const tenantId = requireAdmin(event);

	const [integration] = await db
		.select()
		.from(table.gscIntegration)
		.where(eq(table.gscIntegration.tenantId, tenantId))
		.limit(1);

	const projects = await db
		.select({ id: table.rankProject.id, gscProperty: table.rankProject.gscProperty })
		.from(table.rankProject)
		.where(and(eq(table.rankProject.tenantId, tenantId), eq(table.rankProject.active, true)));

	const result: Record<string, unknown> = {
		connected: !!integration,
		isActive: integration?.isActive ?? false,
		email: integration?.email ?? null,
		lastSyncAt: integration?.lastSyncAt ?? null,
		lastError: integration?.lastError ?? null,
		activeProjects: projects.length,
		projectsWithProperty: projects.filter((p) => p.gscProperty).length
	};

	if (event.url.searchParams.get('probe') === '1') {
		if (!integration) {
			result.probe = { ok: false, error: 'Search Console nu este conectat' };
		} else {
			const startedAt = Date.now();
			try {
				const { listProperties, querySearchAnalytics } = await import('$lib/server/gsc/client');
				const properties = await listProperties(tenantId);
				const target = projects.find((p) => p.gscProperty)?.gscProperty ?? properties[0] ?? null;
				const window = gscPullWindow(new Date(), 2);
				const rows = target
					? await querySearchAnalytics(tenantId, target, window)
					: [];
				result.probe = {
					ok: true,
					durationMs: Date.now() - startedAt,
					properties,
					probedProperty: target,
					window,
					rowCount: rows.length
				};
			} catch (probeError) {
				const { message } = serializeError(probeError);
				result.probe = {
					ok: false,
					durationMs: Date.now() - startedAt,
					error: message,
					// mesajul tipic când API-ul nu e activat în Google Cloud
					hint: /has not been used|is disabled|SERVICE_DISABLED/i.test(message)
						? 'Search Console API pare DEZACTIVAT în proiectul Google Cloud — activează-l și reîncearcă'
						: undefined
				};
			}
		}
	}

	return json(result);
};
```

- [ ] **Step 2: Verifică tipurile și rulează toate testele**

```bash
cd app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning && bun run test
```

- [ ] **Step 3: Commit**

```bash
cd app && git add "src/routes/[tenant]/api/_debug-gsc-health/"
git commit -m "feat(gsc): endpoint de diagnostic pentru integrarea Search Console"
```

---

## Verificare finală, înainte de a declara gata

- [ ] `cd app && bun run test` — toate testele trec (erau 2125 înainte de acest plan)
- [ ] `cd app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning` — `0 errors and 0 warnings`
- [ ] Migrările sunt aplicate **și verificate pe remote** (`PRAGMA table_info` pentru `gsc_integration`, `rank_gsc_daily`, și coloana `gsc_property` pe `rank_project`)
- [ ] `/ots/api/_debug-gsc-health` întoarce `connected: false` curat, fără integrare
- [ ] Cu integrarea conectată, `/ots/api/_debug-gsc-health?probe=1` întoarce `ok: true` și listează proprietăți — **asta dovedește că API-ul e activat**
- [ ] Cu proprietatea legată la un proiect și jobul rulat manual (`runGscPullNow`), coloanele AFIȘĂRI și POZ. GSC se populează în tabel
- [ ] Pe proiectul heylux.ro (ale cărui rulări au fost blocate) apare badge-ul roșu **„nemăsurat"** — asta e dovada că funcționalitatea își face treaba

## Test de acceptanță al întregii funcționalități

Scenariul care a motivat planul, verificat cap-coadă:

1. Conectează Search Console pentru tenantul `ots`.
2. Leagă proprietatea `sc-domain:heylux.ro` de proiectul heylux.ro.
3. Rulează tragerea manuală.
4. Deschide proiectul heylux.ro.

**Rezultat așteptat:** cuvintele cu afișări în GSC arată afișări și poziție medie, iar cele la care noi raportăm „30+" în timp ce Google raportează afișări primesc badge-ul **„nemăsurat"**. Nimeni nu mai poate confunda o rulare blocată cu o scădere de poziții.

---

## Capcane cunoscute

| Capcană | Ce se întâmplă | Cum eviți |
|---|---|---|
| `refresh_token` lipsă la a doua autorizare | Google îl trimite o singură dată per consimțământ | `prompt: 'consent'` e deja în cod — nu-l scoate |
| Proprietate „domain" vs „URL prefix" | `sc-domain:heylux.ro` și `https://www.heylux.ro/` sunt proprietăți DIFERITE, cu date diferite | Lasă utilizatorul să aleagă din `sites.list`, nu construi string-ul din domeniu |
| Zilele nu se aliniază cu snapshoturile | GSC e pe ora Pacificului, noi pe Europe/Bucharest | Coloana se numește `gsc_date` tocmai ca să nu faci JOIN pe `day_key` |
| Datele proaspete se schimbă retroactiv | Ultimele 2-3 zile sunt parțiale | Fereastra de 7 zile + upsert rezolvă asta singură |
| `rowLimit` atins pe proprietăți mari | API-ul întoarce doar primele 25.000 de rânduri | Pentru Faza 1 nu e o problemă (filtrăm pe cuvinte urmărite), dar la Faza 2 va trebui paginare cu `startRow` |
| API dezactivat în Google Cloud | Totul pare conectat, dar orice apel dă 403 `SERVICE_DISABLED` | Sonda din Task 13, cu `hint`-ul ei |

---

## Handoff

Planul e complet și salvat. Două variante de execuție:

1. **Subagent-Driven (recomandat)** — un subagent proaspăt per task, cu review între task-uri.
2. **Inline** — execuție în sesiune, cu checkpoint-uri.

Sesiunea nouă poate porni direct de la Task 1; contextul de care are nevoie e tot în acest document.
