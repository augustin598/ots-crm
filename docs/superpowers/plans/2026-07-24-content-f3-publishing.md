# Content F3 — Publicare WordPress + Calendar + Automatizare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI (`.svelte`) tasks MUST go through the `svelte:svelte-file-editor` agent + svelte-autofixer. Migrations follow the `database-migrations` skill (hand-authored, one statement/file, journal patch, `db:migrate`, PRAGMA verify — `db:gen` is broken on snapshot 0230).

**Goal:** Publica articolele generate pe WordPress (manual/programat/auto), cu calendar lunar pe `scheduled_at`, moduri per website din `website_content_profile.publishMode`, două task-uri scheduler, plus fix la bug-ul de coliziune `wordpress_post`.

**Architecture:** Un helper server unic `publishArticleToWordpress` reutilizează `extractAndUploadInlineImages` + `WpClient.createPost` (ținta = `content_article.target_wp_site_id` ?? `clientWebsite.wpSiteId`), persistă `wp_post_id` + `publish_status`. Programarea ține articolul în CRM (`publish_status='scheduled'`); task-ul orar `content-auto-publish` îl publică live când `scheduled_at<=now`. Modul `auto` (`content-auto-generate`) rescrie surse + programează pe sloturi de cadență, publicare condiționată de `auto_approve`. Calendarul + modurile sunt UI nou (tab-uri Calendar/Setări în pagina website-ului), pe clasele Claude Design `cl-*`.

**Tech Stack:** SvelteKit 5 (runes, remote functions), Drizzle ORM + libSQL (Turso), BullMQ scheduler, `bun test` (mock.module), WpClient (OTS connector HMAC).

**Decizii confirmate (2026-07-24):**
- Programare = **scheduler CRM publică la timp** (nu push `future` imediat). `publish_status='scheduled'` → `content-auto-publish` → `createPost(status='publish')` → `published`.
- Auto = **umple calendarul + publică după `auto_approve`**: rescrie surse nerescrise, `scheduled_at`=următor slot liber, dacă `auto_approve` → ready+publicabil, altfel rămâne `scheduled` pt review. Bounded la `cadence_per_week`/rulare.

**Convenții obligatorii:** răspuns RO; `requireStaff` + scoping tenant pe orice remote; `$derived(await query)` + `.updates()` + `<svelte:boundary>`; layout-ul pune deja `p-6` (`.cl-wrap` face breakout, nu dubla padding); NU adăuga coloană în `schema.ts` înainte de migrare (select-all hazard); `AbortSignal.timeout` pe fetch-uri externe; nu auto-terminate/nu delete distructiv.

**publish_status enum (canonic, folosit peste tot):** `'none' | 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed'`
- `none` — negenerat / fără intenție de publicare (default).
- `draft` — trimis în WP ca ciornă (nu e live).
- `scheduled` — programat în CRM (`scheduled_at` setat), încă nepublicat.
- `publishing` — **stare tranzitorie internă** (claim atomic de auto-publish; nu se afișează distinct în UI — tratat ca „în lucru").
- `published` — live pe WP (`wp_post_id` setat).
- `failed` — ultima încercare de publicare a eșuat.

**Idempotență auto-publish (confirmat 2026-07-24):** înainte de `createPost`, task-ul face un *claim atomic* per articol — `UPDATE ...SET publish_status='publishing' WHERE id=? AND publish_status='scheduled'`. Doar rândul prins (`rowsAffected===1`) se publică; o rulare suprapusă / retry BullMQ îl vede deja `'publishing'` și îl sare → **zero postări duplicate pe WP**.

**Reconciliere second-opinion (Gemini, 2026-07-24) — încorporat în plan:**
- Auto-publish respectă `defaultWpStatus` per website (join la profil în Task 7) — nu mai hardcodează `publish`.
- Gate-ul auto-publish rămâne la nivel de ARTICOL (`publish_status='scheduled'`), NU pe modul website-ului — website-urile `auto` au și ele articole de publicat (respins gate-ul pe `publishMode` sugerat).
- `content-auto-generate` respectă `auto_approve`: `true`→`scheduled` (se publică), `false`→`none` (doar pe calendar, review uman).
- `daysOfWeek`: contract clar — command ia `number[]`, DB stochează JSON, task-ul parsează (Task 6/8/9).
- `setWebsiteWpSite` validează apartenența `wpSiteId` la tenant (anti cross-tenant leak).
- `scheduleArticle` respinge reprogramarea unui articol deja `published`/`publishing` (anti-duplicat).
- publisher păstrează `targetWpSiteId` explicit; `syncPosts` fire-and-forget loghează warning la eșec.

---

## File Structure

**Create:**
- `app/drizzle/0432_content_article_publish_status.sql` — ADD COLUMN publish_status
- `app/drizzle/0433_content_article_publish_idx.sql` — index (tenant_id, website_id, publish_status)
- `app/src/lib/content/calendar.ts` — grilă lunară pură (fără DB, fără Date.now în semnătură)
- `app/src/lib/content/__tests__/calendar.test.ts`
- `app/src/lib/content/publish-schedule.ts` — calcul sloturi de cadență (pur)
- `app/src/lib/content/__tests__/publish-schedule.test.ts`
- `app/src/lib/server/content/publisher.ts` — helper publicare WP (loadSiteAndClient tenant-scoped + publishArticleToWordpress)
- `app/src/lib/server/content/__tests__/publisher.test.ts` — WpClient + db mock
- `app/src/lib/server/scheduler/tasks/content-auto-publish.ts`
- `app/src/lib/server/scheduler/tasks/__tests__/content-auto-publish.test.ts`
- `app/src/lib/server/scheduler/tasks/content-auto-generate.ts`
- `app/src/lib/server/scheduler/tasks/__tests__/content-auto-generate.test.ts`
- `app/src/lib/server/wordpress/__tests__/sync-scope.test.ts` — regresie coliziune upsert

**Modify:**
- `app/src/lib/server/db/schema.ts` — `contentArticle`: adaugă `publishStatus` + index (DUPĂ migrare)
- `app/src/lib/server/wordpress/sync.ts:262-266` — scope lookup pe siteId (fix bug) + import `and`
- `app/src/lib/remotes/content-articles.remote.ts` — extinde `getWebsiteArticles`; adaugă `getWebsiteCalendar`, `publishArticle`, `scheduleArticle`, `unscheduleArticle`, `setWebsiteWpSite`, `getTenantWordpressSites`
- `app/src/lib/remotes/website-content-profile.remote.ts` — adaugă `updateWebsitePublishPolicy`
- `app/src/routes/[tenant]/content/[websiteId]/[articleId]/+page.svelte` — acțiuni Publică/Programează
- `app/src/routes/[tenant]/content/[websiteId]/+page.svelte` — tab-uri Calendar + Setări
- `app/src/routes/[tenant]/content/content.css` — CSS calendar + segmented control
- `app/src/lib/server/scheduler/index.ts` — înregistrare `content_auto_publish` + `content_auto_generate` + JOB_LABELS

Toate comenzile rulează din `app/` (`cd /Users/augustin598/Projects/CRM/app`).

---

## Task 1: Migrare 0432 publish_status + 0433 index + schema

**Files:**
- Create: `app/drizzle/0432_content_article_publish_status.sql`
- Create: `app/drizzle/0433_content_article_publish_idx.sql`
- Modify: `app/drizzle/meta/_journal.json`
- Modify: `app/src/lib/server/db/schema.ts:2045-2096` (contentArticle)

- [ ] **Step 1: Scrie fișierul de migrare 0432 (un singur statement)**

`app/drizzle/0432_content_article_publish_status.sql`:
```sql
ALTER TABLE `content_article` ADD COLUMN `publish_status` text DEFAULT 'none' NOT NULL;
```
(SQLite acceptă NOT NULL la ADD COLUMN dacă DEFAULT e non-null; rândurile existente primesc `'none'`.)

- [ ] **Step 2: Scrie fișierul de migrare 0433 (index, un singur statement)**

`app/drizzle/0433_content_article_publish_idx.sql`:
```sql
CREATE INDEX IF NOT EXISTS `content_article_tenant_website_publish_idx` ON `content_article` (`tenant_id`, `website_id`, `publish_status`);
```

- [ ] **Step 3: Patch-uiește `_journal.json` cu 2 intrări noi**

Adaugă la finalul array-ului `entries` (după idx 431). Calculează `when` (microsecunde) o dată:
```bash
python3 -c "import time; print(int(time.time()*1_000_000))"
```
Apoi editează `app/drizzle/meta/_journal.json` adăugând (folosește valoarea de mai sus pt primul `when`, +1000 pt al doilea):
```json
{ "idx": 432, "version": "6", "when": <MICROS>, "tag": "0432_content_article_publish_status", "breakpoints": true },
{ "idx": 433, "version": "6", "when": <MICROS+1000>, "tag": "0433_content_article_publish_idx", "breakpoints": true }
```
(Nu genera snapshot-uri — repo-ul le are stale la 0233; `db:gen` e stricat, deci hand-authored.)

- [ ] **Step 4: Aplică migrările pe Turso**

Run: `bun run db:migrate`
Expected: log „applied 0432... 0433..." fără erori.

- [ ] **Step 5: Verifică pe Turso cu PRAGMA (coloana + indexul există)**

Run (query read-only cu `@libsql/client`, fără `$lib` — merge cu `bun run`):
```bash
cat > ./_tmp-verify-0432.mjs <<'EOF'
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const c = createClient({ url: env.SQLITE_URI, authToken: env.SQLITE_AUTH_TOKEN });
const cols = await c.execute("PRAGMA table_info(content_article)");
console.log('publish_status col:', cols.rows.find(r=>r.name==='publish_status'));
const idx = await c.execute("PRAGMA index_list(content_article)");
console.log('has publish idx:', idx.rows.some(r=>String(r.name).includes('publish')));
EOF
bun run ./_tmp-verify-0432.mjs; rm -f ./_tmp-verify-0432.mjs
```
Expected: `publish_status col:` obiect nenul cu `dflt_value: 'none'`; `has publish idx: true`.

- [ ] **Step 6: Adaugă coloana + indexul în `schema.ts` (DUPĂ ce migrarea e aplicată)**

În `app/src/lib/server/db/schema.ts`, în `contentArticle`, imediat după linia `scheduledAt: timestamp('scheduled_at', ...)` (2085), adaugă:
```ts
		publishStatus: text('publish_status').notNull().default('none'), // none|draft|scheduled|published|failed
```
Și în array-ul de indexuri (2092-2096), adaugă un rând:
```ts
		index('content_article_tenant_website_publish_idx').on(t.tenantId, t.websiteId, t.publishStatus)
```
(Verifică `index` e deja importat în schema.ts — este, e folosit peste tot.)

- [ ] **Step 7: svelte-check pe schema (compilează)**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error 2>&1 | tail -5`
Expected: 0 erori noi față de baseline.

- [ ] **Step 8: Commit**
```bash
git add drizzle/0432_content_article_publish_status.sql drizzle/0433_content_article_publish_idx.sql drizzle/meta/_journal.json src/lib/server/db/schema.ts
git commit -m "feat(content): migrare 0432 publish_status + index (F3)"
```

---

## Task 2: Fix bug upsert wordpress_post fără scoping siteId

**Context:** `syncPosts` caută rândul existent cu `where(eq(wpPostId, p.id))` — fără `siteId`. Cum indexul unic e `(site_id, wp_post_id)`, două site-uri pot avea același `wp_post_id`; lookup-ul nescopat poate întoarce rândul altui site și îl suprascrie (mutându-i `siteId`). Fix: scope pe `and(eq(siteId), eq(wpPostId))`.

**Files:**
- Create: `app/src/lib/server/wordpress/__tests__/sync-scope.test.ts`
- Modify: `app/src/lib/server/wordpress/sync.ts:3` (import) și `:262-266` (lookup)

- [ ] **Step 1: Scrie testul care eșuează (regresie coliziune)**

`app/src/lib/server/wordpress/__tests__/sync-scope.test.ts` — verifică că lookup-ul existent e scopat pe siteId. Folosim `mock.module` ca la task-urile scheduler: instrumentăm `eq`/`and` să întoarcă predicate inspectabile și capturăm predicatul primit de `.where()` pe SELECT-ul de căutare.
```ts
import { describe, test, expect, mock } from 'bun:test';

// Predicate inspectabile din drizzle.
mock.module('drizzle-orm', () => ({
	eq: (col: unknown, val: unknown) => ({ kind: 'eq', col, val }),
	and: (...conds: unknown[]) => ({ kind: 'and', conds })
}));

// Schema stub: coloanele referite de syncPosts (obiecte-identitate pt comparare).
const wpPostId = { name: 'wp_post_id' };
const siteId = { name: 'site_id' };
const wordpressPost = { id: { name: 'id' }, wpPostId, siteId };
mock.module('$lib/server/db/schema', () => ({ wordpressPost, wordpressSite: {}, wordpressPendingUpdate: {} }));

// db mock: capturează predicatul de la SELECT-existing; întoarce [] (forțează INSERT).
const whereCalls: unknown[] = [];
const dbMock = {
	select: () => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			where: (cond: unknown) => { whereCalls.push(cond); return chain; },
			limit: () => chain,
			then: (r: (rows: unknown[]) => unknown) => r([]) // niciun rând existent
		};
		return chain;
	},
	insert: () => ({ values: async () => undefined }),
	update: () => ({ set: () => ({ where: async () => undefined }) })
};
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({ logInfo: () => {}, logWarning: () => {}, logError: () => {}, serializeError: (e: unknown) => ({ message: String(e), stack: '' }) }));
mock.module('$lib/server/plugins/smartbill/crypto', () => ({ decrypt: () => 'secret', DecryptionError: class extends Error {} }));

// WpClient stub: loadSiteAndClient citește site-ul; forțăm listPosts să întoarcă postul 42.
mock.module('../client', () => ({
	WpClient: class { constructor(_u: string, _s: string) {} async listPosts() { return { items: [{ id: 42, title: 't', slug: 's', status: 'publish', contentHtml: '', excerpt: '', link: '' }], total: 1 }; } },
	WpUpdateItem: {}
}));
mock.module('../errors', () => ({ WpError: { isWpError: () => false } }));
mock.module('../connector-release', () => ({ compareConnectorVersions: () => 0 }));

const { syncPosts } = await import('../sync');

describe('syncPosts existing-row lookup', () => {
	test('scoped by BOTH site_id and wp_post_id (nu doar wp_post_id)', async () => {
		// Fă loadSiteAndClient să găsească site B: primul select întoarce site-ul.
		// Reconfigurăm db.select ca primul apel (site) să întoarcă un rând, apoi lookup [].
		let call = 0;
		dbMock.select = () => {
			const idx = call++;
			const chain: Record<string, unknown> = {
				from: () => chain,
				where: (cond: unknown) => { if (idx > 0) whereCalls.push(cond); return chain; },
				limit: () => chain,
				then: (r: (rows: unknown[]) => unknown) => r(idx === 0 ? [{ id: 'siteB', tenantId: 'tn', siteUrl: 'https://b.ro', secretKey: 'x' }] : [])
			};
			return chain;
		};

		await syncPosts('siteB');

		const lookup = whereCalls[0] as { kind: string; conds?: Array<{ col: unknown }> };
		expect(lookup.kind).toBe('and');
		const cols = (lookup.conds ?? []).map((c) => c.col);
		expect(cols).toContain(siteId); // ← regresia: fără fix, e doar [wpPostId]
		expect(cols).toContain(wpPostId);
	});
});
```

- [ ] **Step 2: Rulează testul — verifică că EȘUEAZĂ**

Run: `bun test src/lib/server/wordpress/__tests__/sync-scope.test.ts`
Expected: FAIL — `expect(cols).toContain(siteId)` pică (lookup-ul curent e `eq(wpPostId)`, deci `kind` nu e `'and'`).

- [ ] **Step 3: Aplică fix-ul în sync.ts**

În `app/src/lib/server/wordpress/sync.ts`, linia 3 — adaugă `and`:
```ts
import { and, eq } from 'drizzle-orm';
```
Înlocuiește lookup-ul (263-266):
```ts
			const [row] = await db
				.select({ id: table.wordpressPost.id })
				.from(table.wordpressPost)
				.where(
					and(
						eq(table.wordpressPost.siteId, siteId),
						eq(table.wordpressPost.wpPostId, p.id)
					)
				)
				.limit(1);
```

- [ ] **Step 4: Rulează testul — verifică că TRECE**

Run: `bun test src/lib/server/wordpress/__tests__/sync-scope.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/server/wordpress/sync.ts src/lib/server/wordpress/__tests__/sync-scope.test.ts
git commit -m "fix(wordpress): scope upsert wordpress_post pe siteId (coliziune multi-site) (F3)"
```

---

## Task 3: Grilă calendar lunară (pură)

**Files:**
- Create: `app/src/lib/content/calendar.ts`
- Create: `app/src/lib/content/__tests__/calendar.test.ts`

- [ ] **Step 1: Scrie testele care eșuează**

`app/src/lib/content/__tests__/calendar.test.ts`:
```ts
import { describe, test, expect } from 'bun:test';
import { buildMonthGrid } from '../calendar';

describe('buildMonthGrid', () => {
	test('iulie 2026 începe luni și acoperă 5 săptămâni pline', () => {
		const grid = buildMonthGrid(2026, 6); // month 0-based: 6 = iulie
		expect(grid.length).toBeGreaterThanOrEqual(5);
		// fiecare săptămână are 7 zile
		for (const week of grid) expect(week.length).toBe(7);
		// prima zi a grilei e luni (getDay()===1) — săptămâna începe luni
		expect(new Date(grid[0][0].iso + 'T00:00:00').getDay()).toBe(1);
	});

	test('marchează corect zilele din afara lunii', () => {
		const grid = buildMonthGrid(2026, 6);
		const flat = grid.flat();
		const inMonth = flat.filter((d) => d.inMonth);
		expect(inMonth.length).toBe(31); // iulie are 31 zile
		expect(inMonth[0].iso).toBe('2026-07-01');
		expect(inMonth[inMonth.length - 1].iso).toBe('2026-07-31');
	});

	test('iso e stabil (YYYY-MM-DD, zero-padded)', () => {
		const grid = buildMonthGrid(2026, 0); // ianuarie
		expect(grid.flat().find((d) => d.inMonth)?.iso).toBe('2026-01-01');
	});
});
```

- [ ] **Step 2: Rulează testul — verifică că EȘUEAZĂ**

Run: `bun test src/lib/content/__tests__/calendar.test.ts`
Expected: FAIL — `buildMonthGrid is not a function` / modul inexistent.

- [ ] **Step 3: Implementează calendar.ts**

`app/src/lib/content/calendar.ts`:
```ts
/** O zi din grila de calendar. `iso` = YYYY-MM-DD (cheie stabilă pt maparea articolelor). */
export interface CalendarDay {
	iso: string;
	day: number;
	inMonth: boolean;
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}
function isoOf(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Grilă lunară cu săptămâna începând LUNI. `month` e 0-based (0=ian).
 * Întoarce array de săptămâni (fiecare 7 zile), umplut cu zile din lunile
 * vecine pt aliniere. Pur — nu citește ceasul.
 */
export function buildMonthGrid(year: number, month: number): CalendarDay[][] {
	const first = new Date(year, month, 1);
	// getDay(): 0=dum..6=sâm → offset ca luni=0.
	const offset = (first.getDay() + 6) % 7;
	const start = new Date(year, month, 1 - offset);

	const weeks: CalendarDay[][] = [];
	const cursor = new Date(start);
	// Umple săptămâni întregi până depășim luna curentă (minim 5, uneori 6).
	do {
		const week: CalendarDay[] = [];
		for (let i = 0; i < 7; i++) {
			week.push({ iso: isoOf(cursor), day: cursor.getDate(), inMonth: cursor.getMonth() === month });
			cursor.setDate(cursor.getDate() + 1);
		}
		weeks.push(week);
	} while (cursor.getMonth() === month || cursor <= new Date(year, month + 1, 0));
	return weeks;
}
```

- [ ] **Step 4: Rulează testul — verifică că TRECE**

Run: `bun test src/lib/content/__tests__/calendar.test.ts`
Expected: PASS (3 teste).

- [ ] **Step 5: Commit**
```bash
git add src/lib/content/calendar.ts src/lib/content/__tests__/calendar.test.ts
git commit -m "feat(content): grilă calendar lunară pură (F3)"
```

---

## Task 4: Calcul sloturi de cadență (pur)

**Files:**
- Create: `app/src/lib/content/publish-schedule.ts`
- Create: `app/src/lib/content/__tests__/publish-schedule.test.ts`

- [ ] **Step 1: Scrie testele care eșuează**

`app/src/lib/content/__tests__/publish-schedule.test.ts`:
```ts
import { describe, test, expect } from 'bun:test';
import { nextSlots } from '../publish-schedule';

describe('nextSlots', () => {
	const from = new Date('2026-07-01T00:00:00'); // miercuri

	test('respectă daysOfWeek + publishTime, ordinea crescătoare', () => {
		const slots = nextSlots({ from, count: 3, daysOfWeek: [1, 3], publishTime: '10:00', existing: [] });
		expect(slots.length).toBe(3);
		// toate la 10:00, doar luni(1)/miercuri(3)
		for (const s of slots) {
			expect(s.getHours()).toBe(10);
			expect([1, 3]).toContain(s.getDay());
		}
		// crescător
		expect(slots[0] < slots[1] && slots[1] < slots[2]).toBe(true);
	});

	test('sare peste sloturile deja ocupate (existing)', () => {
		const taken = new Date('2026-07-01T10:00:00'); // miercuri 10:00
		const slots = nextSlots({ from, count: 2, daysOfWeek: [3], publishTime: '10:00', existing: [taken] });
		// nu reia slotul ocupat
		expect(slots.some((s) => s.getTime() === taken.getTime())).toBe(false);
		expect(slots.length).toBe(2);
	});

	test('fallback la toate zilele când daysOfWeek e gol', () => {
		const slots = nextSlots({ from, count: 1, daysOfWeek: [], publishTime: '09:30', existing: [] });
		expect(slots.length).toBe(1);
		expect(slots[0].getHours()).toBe(9);
		expect(slots[0].getMinutes()).toBe(30);
	});
});
```

- [ ] **Step 2: Rulează testul — verifică că EȘUEAZĂ**

Run: `bun test src/lib/content/__tests__/publish-schedule.test.ts`
Expected: FAIL — modul inexistent.

- [ ] **Step 3: Implementează publish-schedule.ts**

`app/src/lib/content/publish-schedule.ts`:
```ts
export interface SlotOpts {
	/** De unde pornește căutarea (exclus dacă e fix pe un slot ocupat). */
	from: Date;
	/** Câte sloturi să întoarcă. */
	count: number;
	/** Zilele săptămânii permise (0=dum..6=sâm). Gol → toate zilele. */
	daysOfWeek: number[];
	/** Ora publicării „HH:MM". */
	publishTime: string;
	/** Sloturi deja ocupate (se sar). */
	existing: Date[];
}

function parseHM(hm: string): { h: number; m: number } {
	const [h, m] = hm.split(':').map((x) => Number(x));
	return { h: Number.isFinite(h) ? h : 10, m: Number.isFinite(m) ? m : 0 };
}

/**
 * Următoarele `count` sloturi de publicare pornind de la `from`, pe zilele
 * permise, la `publishTime`, sărind peste `existing`. Pur (primește `from`,
 * nu citește ceasul). Guard: max 366 zile căutate.
 */
export function nextSlots(opts: SlotOpts): Date[] {
	const { h, m } = parseHM(opts.publishTime);
	const allowed = opts.daysOfWeek.length ? new Set(opts.daysOfWeek) : new Set([0, 1, 2, 3, 4, 5, 6]);
	const taken = new Set(opts.existing.map((d) => d.getTime()));

	const out: Date[] = [];
	const cursor = new Date(opts.from);
	cursor.setHours(h, m, 0, 0);
	// Dacă slotul de azi e deja în trecut față de `from`, treci la ziua următoare.
	if (cursor < opts.from) cursor.setDate(cursor.getDate() + 1);

	let guard = 0;
	while (out.length < opts.count && guard < 366) {
		if (allowed.has(cursor.getDay()) && !taken.has(cursor.getTime())) {
			out.push(new Date(cursor));
		}
		cursor.setDate(cursor.getDate() + 1);
		cursor.setHours(h, m, 0, 0);
		guard++;
	}
	return out;
}
```

- [ ] **Step 4: Rulează testul — verifică că TRECE**

Run: `bun test src/lib/content/__tests__/publish-schedule.test.ts`
Expected: PASS (3 teste).

- [ ] **Step 5: Commit**
```bash
git add src/lib/content/publish-schedule.ts src/lib/content/__tests__/publish-schedule.test.ts
git commit -m "feat(content): calcul sloturi de cadență pentru programare (F3)"
```

---

## Task 5: Helper server de publicare WordPress

**Context:** Un singur path de publicare, reutilizabil de remote (manual) + scheduler (auto). Rezolvă ținta WP, urcă imaginile inline, `createPost`, persistă `wp_post_id`+`publish_status`, refresh cache prin `syncPosts` (acum scopat corect după Task 2).

**Files:**
- Create: `app/src/lib/server/content/publisher.ts`
- Create: `app/src/lib/server/content/__tests__/publisher.test.ts`

- [ ] **Step 1: Scrie testele care eșuează (WpClient + db mock)**

`app/src/lib/server/content/__tests__/publisher.test.ts`:
```ts
import { describe, test, expect, mock } from 'bun:test';

// ---- capturi ----
const created: Array<Record<string, unknown>> = [];
const updates: Array<Record<string, unknown>> = [];

// db mock: articol + website (2 select-uri), apoi update-uri capturate.
function makeDb(rows: unknown[][]) {
	let i = 0;
	return {
		select: () => {
			const idx = i++;
			const chain: Record<string, unknown> = {
				from: () => chain,
				innerJoin: () => chain,
				leftJoin: () => chain,
				where: () => chain,
				limit: () => chain,
				then: (r: (v: unknown[]) => unknown) => r(rows[idx] ?? [])
			};
			return chain;
		},
		update: () => ({ set: (patch: Record<string, unknown>) => ({ where: async () => { updates.push(patch); } }) })
	};
}

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({ logInfo: () => {}, logWarning: () => {}, logError: () => {}, serializeError: (e: unknown) => ({ message: String(e), stack: '' }) }));
mock.module('$lib/server/db/schema', () => ({ contentArticle: { id: {}, tenantId: {}, websiteId: {} }, clientWebsite: { id: {}, wpSiteId: {} }, wordpressSite: { id: {} } }));
mock.module('drizzle-orm', () => ({ eq: () => ({}), and: () => ({}) }));
mock.module('$lib/server/plugins/smartbill/crypto', () => ({ decrypt: () => 'secret', DecryptionError: class extends Error {} }));
mock.module('$lib/server/wordpress/media', () => ({ extractAndUploadInlineImages: async (_c: unknown, html: string) => ({ html, attachmentIds: [], firstUrl: null }) }));
mock.module('$lib/server/wordpress/sync', () => ({ syncPosts: async () => undefined }));
mock.module('$lib/server/wordpress/client', () => ({
	WpClient: class {
		constructor(_u: string, _s: string) {}
		async createPost(payload: Record<string, unknown>) { created.push(payload); return { id: 777, link: 'https://x.ro/p', status: payload.status, title: payload.title, slug: payload.slug, contentHtml: '', excerpt: '', featuredMediaId: null, featuredMediaUrl: null, authorWpId: 1, publishedAt: null, createdAt: '', updatedAt: '' }; }
	}
}));

async function loadSUT(rows: unknown[][]) {
	mock.module('$lib/server/db', () => ({ db: makeDb(rows) }));
	const mod = await import('../publisher?' + Math.random()); // fresh (evită cache între teste)
	return mod;
}

describe('publishArticleToWordpress', () => {
	test('publică live → status publish, persistă wp_post_id + published', async () => {
		created.length = 0; updates.length = 0;
		const article = { id: 'a1', tenantId: 'tn', websiteId: 'w1', generatedHtml: '<p>x</p>', generatedTitle: 'T', generatedExcerpt: 'E', slug: 's', targetWpSiteId: null, rewriteStatus: 'ready' };
		const site = { id: 'wp1', tenantId: 'tn', siteUrl: 'https://x.ro', secretKey: 'enc' };
		const { publishArticleToWordpress } = await loadSUT([[article], [{ wpSiteId: 'wp1' }], [site]]);
		const res = await publishArticleToWordpress('tn', 'a1', { status: 'publish' });
		expect(res.wpPostId).toBe(777);
		expect(created[0].status).toBe('publish');
		const patch = updates.at(-1)!;
		expect(patch.wpPostId).toBe(777);
		expect(patch.publishStatus).toBe('published');
	});

	test('fără wpSiteId → aruncă (cere legare WP)', async () => {
		const article = { id: 'a1', tenantId: 'tn', websiteId: 'w1', generatedHtml: '<p>x</p>', targetWpSiteId: null };
		const { publishArticleToWordpress } = await loadSUT([[article], [{ wpSiteId: null }]]);
		await expect(publishArticleToWordpress('tn', 'a1', { status: 'publish' })).rejects.toThrow(/WordPress/i);
	});

	test('fără generatedHtml → aruncă (generează întâi)', async () => {
		const article = { id: 'a1', tenantId: 'tn', websiteId: 'w1', generatedHtml: null, targetWpSiteId: 'wp1' };
		const site = { id: 'wp1', tenantId: 'tn', siteUrl: 'https://x.ro', secretKey: 'enc' };
		const { publishArticleToWordpress } = await loadSUT([[article], [{ wpSiteId: 'wp1' }], [site]]);
		await expect(publishArticleToWordpress('tn', 'a1', { status: 'publish' })).rejects.toThrow(/generat/i);
	});
});
```

- [ ] **Step 2: Rulează testul — verifică că EȘUEAZĂ**

Run: `bun test src/lib/server/content/__tests__/publisher.test.ts`
Expected: FAIL — modul inexistent.

- [ ] **Step 3: Implementează publisher.ts**

`app/src/lib/server/content/publisher.ts`:
```ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient } from '$lib/server/wordpress/client';
import { extractAndUploadInlineImages } from '$lib/server/wordpress/media';
import { syncPosts } from '$lib/server/wordpress/sync';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

export type PublishWpStatus = 'draft' | 'publish' | 'future';

export interface PublishResult {
	ok: true;
	wpPostId: number;
	link: string | null;
	publishStatus: 'draft' | 'published';
}

/** Încarcă un site WP (tenant-scoped) + decriptează secretul (retry 1× pe Turso transient). */
async function loadSiteAndClient(tenantId: string, siteId: string) {
	const [site] = await db
		.select()
		.from(table.wordpressSite)
		.where(and(eq(table.wordpressSite.id, siteId), eq(table.wordpressSite.tenantId, tenantId)))
		.limit(1);
	if (!site) throw new Error(`Site WordPress negăsit: ${siteId}`);
	let secret: string;
	try {
		secret = decrypt(site.tenantId, site.secretKey);
	} catch (err) {
		if (!(err instanceof DecryptionError)) throw err;
		await new Promise((r) => setTimeout(r, 1000));
		const [fresh] = await db.select().from(table.wordpressSite).where(eq(table.wordpressSite.id, siteId)).limit(1);
		if (!fresh) throw new Error(`Site WordPress dispărut la retry decrypt: ${siteId}`);
		secret = decrypt(fresh.tenantId, fresh.secretKey);
	}
	return { site, client: new WpClient(site.siteUrl, secret) };
}

/**
 * Publică un articol de conținut pe WordPress. Ținta = article.targetWpSiteId
 * ?? clientWebsite.wpSiteId. Urcă imaginile inline, createPost, persistă
 * wp_post_id + publish_status, refresh cache (syncPosts, fire-and-forget).
 * `status`: 'draft' (ciornă) | 'publish' (live) | 'future' (necesită publishedAt).
 */
export async function publishArticleToWordpress(
	tenantId: string,
	articleId: string,
	opts: { status: PublishWpStatus; publishedAt?: Date }
): Promise<PublishResult> {
	const [article] = await db
		.select()
		.from(table.contentArticle)
		.where(and(eq(table.contentArticle.id, articleId), eq(table.contentArticle.tenantId, tenantId)))
		.limit(1);
	if (!article) throw new Error('Articol negăsit');

	const html = article.generatedHtml;
	if (!html) throw new Error('Articolul nu are conținut generat — generează întâi articolul.');

	// Rezolvă ținta WP: override per-articol, altfel wpSiteId al website-ului.
	let targetSiteId = article.targetWpSiteId ?? null;
	if (!targetSiteId && article.websiteId) {
		const [ws] = await db
			.select({ wpSiteId: table.clientWebsite.wpSiteId })
			.from(table.clientWebsite)
			.where(eq(table.clientWebsite.id, article.websiteId))
			.limit(1);
		targetSiteId = ws?.wpSiteId ?? null;
	}
	if (!targetSiteId) throw new Error('Website-ul nu e legat de un site WordPress — leagă WP în Setări întâi.');

	try {
		const { site, client } = await loadSiteAndClient(tenantId, targetSiteId);
		const { html: finalHtml, attachmentIds } = await extractAndUploadInlineImages(client, html, {
			siteId: site.id,
			filenamePrefix: 'content'
		});

		const created = await client.createPost(
			{
				title: article.generatedTitle || article.title || 'Fără titlu',
				contentHtml: finalHtml,
				excerpt: article.generatedExcerpt ?? undefined,
				slug: article.slug ?? undefined,
				status: opts.status,
				publishedAt: opts.status === 'future' ? opts.publishedAt?.toISOString() : undefined,
				featuredMediaId: attachmentIds.length > 0 ? attachmentIds[0] : undefined
			},
			{ siteId: site.id }
		);

		const publishStatus: 'draft' | 'published' = opts.status === 'draft' ? 'draft' : 'published';
		await db
			.update(table.contentArticle)
			.set({
				wpPostId: created.id,
				targetWpSiteId: article.targetWpSiteId ?? site.id, // păstrează ținta explicită dacă exista
				publishStatus,
				publishedAt: created.publishedAt ? new Date(created.publishedAt) : new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.contentArticle.id, articleId));

		syncPosts(site.id).catch((err) => {
			const { message } = serializeError(err);
			logWarning('content', `[publish] syncPosts refresh a eșuat pt ${site.id}: ${message}`, { tenantId, metadata: { siteId: site.id } });
		});

		logInfo('content', `Articol publicat pe ${site.siteUrl}: "${created.title}" (${created.status})`, {
			tenantId,
			metadata: { articleId, siteId: site.id, wpPostId: created.id, status: created.status }
		});
		return { ok: true, wpPostId: created.id, link: created.link ?? null, publishStatus };
	} catch (err) {
		const { message, stack } = serializeError(err);
		await db
			.update(table.contentArticle)
			.set({ publishStatus: 'failed', updatedAt: new Date() })
			.where(eq(table.contentArticle.id, articleId));
		logWarning('content', `Publicare eșuată pentru articol ${articleId}: ${message}`, {
			tenantId,
			metadata: { articleId },
			stackTrace: stack
		});
		throw new Error(message);
	}
}
```

- [ ] **Step 4: Rulează testul — verifică că TRECE**

Run: `bun test src/lib/server/content/__tests__/publisher.test.ts`
Expected: PASS (3 teste).

- [ ] **Step 5: Commit**
```bash
git add src/lib/server/content/publisher.ts src/lib/server/content/__tests__/publisher.test.ts
git commit -m "feat(content): helper publicare WordPress (createPost + persist publish_status) (F3)"
```

---

## Task 6: Remote functions — publicare, programare, calendar, setări

**Files:**
- Modify: `app/src/lib/remotes/content-articles.remote.ts`
- Modify: `app/src/lib/remotes/website-content-profile.remote.ts`

- [ ] **Step 1: Extinde `getWebsiteArticles` cu câmpurile de publicare**

În `content-articles.remote.ts`, în `getWebsiteArticles` (174-201), adaugă la SELECT (după `sourceUrl`):
```ts
					scheduledAt: table.contentArticle.scheduledAt,
					publishStatus: table.contentArticle.publishStatus,
					wpPostId: table.contentArticle.wpPostId
```

- [ ] **Step 2: Adaugă `getWebsiteCalendar` (articole cu scheduledAt în lună)**

La finalul secțiunii F2 din `content-articles.remote.ts`, adaugă (importurile `eq/and/desc` există deja; adaugă `gte, lte` la importul din drizzle-orm dacă lipsesc):
```ts
// ===== F3: publicare + calendar =====

/** Articolele programate/publicate ale unui website într-o lună (pt calendar). year, month 0-based. */
export const getWebsiteCalendar = query(
	v.object({ websiteId: v.string(), year: v.number(), month: v.number() }),
	async ({ websiteId, year, month }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
		await requireStaff(event);
		const start = new Date(year, month, 1);
		const end = new Date(year, month + 1, 1);
		return db
			.select({
				id: table.contentArticle.id,
				title: table.contentArticle.title,
				generatedTitle: table.contentArticle.generatedTitle,
				scheduledAt: table.contentArticle.scheduledAt,
				publishStatus: table.contentArticle.publishStatus,
				rewriteStatus: table.contentArticle.rewriteStatus
			})
			.from(table.contentArticle)
			.where(
				and(
					eq(table.contentArticle.tenantId, event.locals.tenant.id),
					eq(table.contentArticle.websiteId, websiteId),
					gte(table.contentArticle.scheduledAt, start),
					lte(table.contentArticle.scheduledAt, end)
				)
			)
			.limit(200);
	}
);
```

- [ ] **Step 3: Adaugă `publishArticle` (manual: draft sau live)**

```ts
/** Publică manual un articol pe WordPress (ciornă sau live). */
export const publishArticle = command(
	v.object({ articleId: v.string(), mode: v.picklist(['draft', 'publish']) }),
	async ({ articleId, mode }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
		await requireStaff(event);
		try {
			const res = await publishArticleToWordpress(event.locals.tenant.id, articleId, { status: mode });
			return { ok: true as const, wpPostId: res.wpPostId, link: res.link, publishStatus: res.publishStatus };
		} catch (e) {
			svelteError(500, e instanceof Error ? e.message : 'Publicare eșuată');
		}
	}
);
```
Adaugă importul sus în fișier:
```ts
import { publishArticleToWordpress } from '$lib/server/content/publisher';
```

- [ ] **Step 4: Adaugă `scheduleArticle` + `unscheduleArticle`**

```ts
/** Programează un articol (ready) la o dată — publish_status='scheduled'. */
export const scheduleArticle = command(
	v.object({ articleId: v.string(), scheduledAt: v.pipe(v.string(), v.isoTimestamp()) }),
	async ({ articleId, scheduledAt }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
		await requireStaff(event);
		const tenantId = event.locals.tenant.id;
		const rows = await db
			.select({ rewriteStatus: table.contentArticle.rewriteStatus, publishStatus: table.contentArticle.publishStatus })
			.from(table.contentArticle)
			.where(and(eq(table.contentArticle.id, articleId), eq(table.contentArticle.tenantId, tenantId)))
			.limit(1);
		if (!rows[0]) svelteError(404, 'Articol negăsit');
		if (rows[0].rewriteStatus !== 'ready')
			svelteError(400, 'Aprobă articolul (Ready) înainte de a-l programa.');
		if (rows[0].publishStatus === 'published' || rows[0].publishStatus === 'publishing')
			svelteError(400, 'Articolul e deja publicat — nu-l poți reprograma (ar crea o postare duplicată).');
		await db
			.update(table.contentArticle)
			.set({ scheduledAt: new Date(scheduledAt), publishStatus: 'scheduled', updatedAt: new Date() })
			.where(and(eq(table.contentArticle.id, articleId), eq(table.contentArticle.tenantId, tenantId)));
		return { ok: true as const };
	}
);

/** Anulează programarea — publish_status înapoi la 'none'. */
export const unscheduleArticle = command(v.string(), async (articleId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
	await requireStaff(event);
	await db
		.update(table.contentArticle)
		.set({ scheduledAt: null, publishStatus: 'none', updatedAt: new Date() })
		.where(and(eq(table.contentArticle.id, articleId), eq(table.contentArticle.tenantId, event.locals.tenant.id)));
	return { ok: true as const };
});
```

- [ ] **Step 5: Adaugă `getTenantWordpressSites` + `setWebsiteWpSite` (pt tab Setări)**

```ts
/** Site-urile WordPress ale tenantului (pt dropdown-ul de legare din Setări). */
export const getTenantWordpressSites = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
	await requireStaff(event);
	return db
		.select({ id: table.wordpressSite.id, siteUrl: table.wordpressSite.siteUrl, status: table.wordpressSite.status })
		.from(table.wordpressSite)
		.where(eq(table.wordpressSite.tenantId, event.locals.tenant.id))
		.orderBy(table.wordpressSite.siteUrl);
});

/** Leagă/dezleagă un clientWebsite de un site WordPress (validează apartenența la tenant). */
export const setWebsiteWpSite = command(
	v.object({ websiteId: v.string(), wpSiteId: v.nullable(v.string()) }),
	async ({ websiteId, wpSiteId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
		await requireStaff(event);
		const tenantId = event.locals.tenant.id;
		// Securitate: dacă se leagă un site, verifică că e al ACELUIAȘI tenant (anti cross-tenant).
		if (wpSiteId) {
			const [valid] = await db
				.select({ id: table.wordpressSite.id })
				.from(table.wordpressSite)
				.where(and(eq(table.wordpressSite.id, wpSiteId), eq(table.wordpressSite.tenantId, tenantId)))
				.limit(1);
			if (!valid) svelteError(404, 'Site WordPress negăsit pentru acest tenant.');
		}
		await db
			.update(table.clientWebsite)
			.set({ wpSiteId, updatedAt: new Date() })
			.where(and(eq(table.clientWebsite.id, websiteId), eq(table.clientWebsite.tenantId, tenantId)));
		return { ok: true as const };
	}
);
```

- [ ] **Step 6: Adaugă `updateWebsitePublishPolicy` în profile remote**

În `website-content-profile.remote.ts`, adaugă (upsert ca la `updateWebsiteContentProfile`):
```ts
/** Politica de publicare a website-ului (mod, cadență, zile, oră, status WP default, auto-approve). */
export const updateWebsitePublishPolicy = command(
	v.object({
		websiteId: v.string(),
		publishMode: v.picklist(['manual', 'scheduled', 'auto']),
		cadencePerWeek: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(21)),
		// Contract: command ia number[] (0=dum..6=sâm); serializăm JSON la DB (text). Task-ul parsează înapoi.
		daysOfWeek: v.optional(v.array(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(6)))),
		publishTime: v.optional(v.string()),
		defaultWpStatus: v.picklist(['draft', 'publish']),
		autoApprove: v.boolean()
	}),
	async (input) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
		await requireStaff(event);
		const tenantId = event.locals.tenant.id;
		const patch: Record<string, unknown> = {
			publishMode: input.publishMode,
			cadencePerWeek: input.cadencePerWeek,
			defaultWpStatus: input.defaultWpStatus,
			autoApprove: input.autoApprove,
			updatedAt: new Date()
		};
		if (input.daysOfWeek !== undefined) patch.daysOfWeek = JSON.stringify(input.daysOfWeek);
		if (input.publishTime !== undefined) patch.publishTime = input.publishTime;
		const existing = await db
			.select({ id: table.websiteContentProfile.id })
			.from(table.websiteContentProfile)
			.where(and(eq(table.websiteContentProfile.websiteId, input.websiteId), eq(table.websiteContentProfile.tenantId, tenantId)))
			.limit(1);
		if (existing.length) {
			await db
				.update(table.websiteContentProfile)
				.set(patch)
				.where(and(eq(table.websiteContentProfile.websiteId, input.websiteId), eq(table.websiteContentProfile.tenantId, tenantId)));
		} else {
			await db.insert(table.websiteContentProfile).values({
				id: encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15))),
				tenantId,
				websiteId: input.websiteId,
				...patch
			});
		}
		return { ok: true as const };
	}
);
```
(`minValue/maxValue/integer` din valibot — deja folosit `minLength` etc.; verifică importul `* as v`.)

- [ ] **Step 7: Asigură importurile drizzle (`gte`, `lte`) în content remote**

În `content-articles.remote.ts` linia 7, extinde:
```ts
import { eq, and, desc, inArray, sql, gte, lte } from 'drizzle-orm';
```

- [ ] **Step 8: svelte-check (remote-uri compilează, tipuri OK)**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error 2>&1 | tail -8`
Expected: 0 erori noi. (Notă: `publishStatus`, `scheduledAt` există pe tip DUPĂ Task 1.)

- [ ] **Step 9: Commit**
```bash
git add src/lib/remotes/content-articles.remote.ts src/lib/remotes/website-content-profile.remote.ts
git commit -m "feat(content): remote publicare/programare/calendar/setări WP (F3)"
```

---

## Task 7: Scheduler task `content-auto-publish`

**Context:** Orar. Publică articolele `publish_status='scheduled'` + `rewrite_status='ready'` + `scheduled_at<=now`. Per-articol failure e swallow-uit (nu otrăvește batch-ul). `dryRun` param pt test.

**Files:**
- Create: `app/src/lib/server/scheduler/tasks/content-auto-publish.ts`
- Create: `app/src/lib/server/scheduler/tasks/__tests__/content-auto-publish.test.ts`
- Modify: `app/src/lib/server/scheduler/index.ts`

- [ ] **Step 1: Scrie testul care eșuează**

`app/src/lib/server/scheduler/tasks/__tests__/content-auto-publish.test.ts`:
```ts
import { describe, test, expect, mock } from 'bun:test';

const published: string[] = [];
const queue: unknown[][] = [];
let claimRows = 1; // rowsAffected pe UPDATE-ul de claim (1 = prins, 0 = deja luat)

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({ logInfo: () => {}, logWarning: () => {}, logError: () => {}, serializeError: (e: unknown) => ({ message: String(e), stack: '' }) }));
mock.module('$lib/server/db/schema', () => ({ contentArticle: { id: {}, tenantId: {}, publishStatus: {}, rewriteStatus: {}, scheduledAt: {} } }));
mock.module('drizzle-orm', () => ({ eq: () => ({}), and: () => ({}), lte: () => ({}) }));
mock.module('$lib/server/db', () => ({
	db: {
		select: () => { const c: Record<string, unknown> = { from: () => c, where: () => c, limit: () => c, then: (r: (v: unknown[]) => unknown) => r(queue.shift() ?? []) }; return c; },
		update: () => ({ set: () => ({ where: async () => ({ rowsAffected: claimRows }) }) })
	}
}));
mock.module('$lib/server/content/publisher', () => ({
	publishArticleToWordpress: async (_t: string, id: string) => { published.push(id); return { ok: true, wpPostId: 1, link: null, publishStatus: 'published' }; }
}));

const { processContentAutoPublish } = await import('../content-auto-publish');

describe('processContentAutoPublish', () => {
	test('publică scadentele prinse de claim; dryRun nu publică', async () => {
		published.length = 0; claimRows = 1;
		queue.push([{ id: 'a1', tenantId: 'tn' }, { id: 'a2', tenantId: 'tn' }]);
		const dry = await processContentAutoPublish({ dryRun: true });
		expect(dry.due).toBe(2);
		expect(published.length).toBe(0); // dryRun nu revendică, nu publică

		queue.push([{ id: 'a1', tenantId: 'tn' }, { id: 'a2', tenantId: 'tn' }]);
		const live = await processContentAutoPublish({ dryRun: false });
		expect(live.published).toBe(2);
		expect(published).toEqual(['a1', 'a2']);
	});

	test('claim eșuat (rowsAffected=0) → sare articolul, nu publică dublu', async () => {
		published.length = 0; claimRows = 0; // altcineva l-a luat deja
		queue.push([{ id: 'a1', tenantId: 'tn' }]);
		const res = await processContentAutoPublish({ dryRun: false });
		expect(res.published).toBe(0);
		expect(res.skipped).toBe(1);
		expect(published.length).toBe(0);
	});
});
```

- [ ] **Step 2: Rulează testul — verifică că EȘUEAZĂ**

Run: `bun test src/lib/server/scheduler/tasks/__tests__/content-auto-publish.test.ts`
Expected: FAIL — modul inexistent.

- [ ] **Step 3: Implementează content-auto-publish.ts**

`app/src/lib/server/scheduler/tasks/content-auto-publish.ts`:
```ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, lte } from 'drizzle-orm';
import { publishArticleToWordpress } from '$lib/server/content/publisher';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

/**
 * Publică articolele programate scadente (publish_status='scheduled',
 * rewrite_status='ready', scheduled_at<=now). Sequential, per-articol
 * failure swallow-uit. `dryRun` doar numără.
 */
export async function processContentAutoPublish(params: Record<string, unknown> = {}) {
	const dryRun = params.dryRun === true;
	const now = new Date();

	// Gate = starea ARTICOLULUI (publish_status='scheduled'), NU modul website-ului:
	// și website-urile 'auto' au articole programate care trebuie publicate aici.
	// leftJoin la profil pentru a respecta defaultWpStatus (draft|publish) per website.
	const due = await db
		.select({
			id: table.contentArticle.id,
			tenantId: table.contentArticle.tenantId,
			defaultWpStatus: table.websiteContentProfile.defaultWpStatus
		})
		.from(table.contentArticle)
		.leftJoin(
			table.websiteContentProfile,
			eq(table.websiteContentProfile.websiteId, table.contentArticle.websiteId)
		)
		.where(
			and(
				eq(table.contentArticle.publishStatus, 'scheduled'),
				eq(table.contentArticle.rewriteStatus, 'ready'),
				lte(table.contentArticle.scheduledAt, now)
			)
		)
		.limit(100);

	if (dryRun) {
		logInfo('content', `[auto-publish] dryRun — ${due.length} articole scadente`, { metadata: { due: due.length } });
		return { success: true, due: due.length, published: 0, failed: 0, skipped: 0 };
	}

	let published = 0;
	let failed = 0;
	let skipped = 0;
	for (const a of due) {
		// Claim atomic: revendică rândul DOAR dacă e încă 'scheduled'. O rulare
		// suprapusă / retry BullMQ îl vede deja 'publishing' → rowsAffected=0 → skip.
		const claim = await db
			.update(table.contentArticle)
			.set({ publishStatus: 'publishing', updatedAt: new Date() })
			.where(
				and(
					eq(table.contentArticle.id, a.id),
					eq(table.contentArticle.publishStatus, 'scheduled')
				)
			);
		const claimed = (claim as { rowsAffected?: number })?.rowsAffected ?? 0;
		if (claimed !== 1) {
			skipped++;
			continue;
		}
		try {
			// Respectă politica per website: 'draft' → ciornă în WP, altfel live.
			const status: 'draft' | 'publish' = a.defaultWpStatus === 'draft' ? 'draft' : 'publish';
			// publishArticleToWordpress setează la final publishStatus='published'/'draft' (sau 'failed'),
			// suprascriind starea tranzitorie 'publishing'.
			await publishArticleToWordpress(a.tenantId, a.id, { status });
			published++;
		} catch (err) {
			failed++;
			const { message, stack } = serializeError(err);
			logWarning('content', `[auto-publish] eșec pe ${a.id}: ${message}`, {
				tenantId: a.tenantId,
				metadata: { articleId: a.id },
				stackTrace: stack
			});
		}
	}
	logInfo('content', `[auto-publish] ${published}/${due.length} publicate (${failed} eșecuri, ${skipped} sărite)`, {
		metadata: { due: due.length, published, failed, skipped }
	});
	return { success: true, due: due.length, published, failed, skipped };
}
```

- [ ] **Step 4: Rulează testul — verifică că TRECE**

Run: `bun test src/lib/server/scheduler/tasks/__tests__/content-auto-publish.test.ts`
Expected: PASS.

- [ ] **Step 5: Înregistrează task-ul în scheduler/index.ts**

`import` (după linia 46):
```ts
import { processContentAutoPublish } from './tasks/content-auto-publish';
```
`taskHandlers` (după `hosting_expiry_guard`):
```ts
	content_auto_publish: processContentAutoPublish,
```
`expectedJobIds` set (adaugă): `'content-auto-publish'`.
`JOB_LABELS`: `content_auto_publish: 'Auto-publicare Conținut Programat',`.
Înregistrare (după blocul hosting-expiry-guard, ~1069) — orar:
```ts
	// Content auto-publish — orar. Publică articolele programate scadente pe WordPress.
	await schedulerQueue.add(
		'content-auto-publish',
		{ type: 'content_auto_publish', params: { dryRun: false } },
		{ repeat: { pattern: '0 * * * *', tz: 'Europe/Bucharest' }, jobId: 'content-auto-publish' }
	);
	logInfo('scheduler', '[scheduler] content-auto-publish registered (0 * * * * Europe/Bucharest, LIVE)');
```

- [ ] **Step 6: svelte-check + commit**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error 2>&1 | tail -5`
Expected: 0 erori noi.
```bash
git add src/lib/server/scheduler/tasks/content-auto-publish.ts src/lib/server/scheduler/tasks/__tests__/content-auto-publish.test.ts src/lib/server/scheduler/index.ts
git commit -m "feat(content): scheduler content-auto-publish (programate scadente) (F3)"
```

---

## Task 8: Scheduler task `content-auto-generate`

**Context:** Zilnic. Pentru fiecare website cu `publish_mode='auto'`: dacă are sub `cadence_per_week` articole programate în următoarele 7 zile, rescrie surse nerescrise, le programează pe următoarele sloturi libere (`nextSlots`), și — dacă `auto_approve` — le lasă `ready`+`scheduled` (le va lua auto-publish); altfel `scheduled` pt review. Bounded la `cadence_per_week`/rulare. `dryRun` pt test.

**Files:**
- Create: `app/src/lib/server/scheduler/tasks/content-auto-generate.ts`
- Create: `app/src/lib/server/scheduler/tasks/__tests__/content-auto-generate.test.ts`
- Modify: `app/src/lib/server/scheduler/index.ts`

- [ ] **Step 1: Scrie testul care eșuează**

`app/src/lib/server/scheduler/tasks/__tests__/content-auto-generate.test.ts`:
```ts
import { describe, test, expect, mock } from 'bun:test';

const rewritten: string[] = [];
const scheduled: Array<{ id: string; at: Date }> = [];
const q: unknown[][] = [];

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({ logInfo: () => {}, logWarning: () => {}, logError: () => {}, serializeError: (e: unknown) => ({ message: String(e), stack: '' }) }));
mock.module('$lib/server/db/schema', () => ({ websiteContentProfile: { publishMode: {}, tenantId: {}, websiteId: {} }, contentArticle: { id: {}, websiteId: {}, tenantId: {}, rewriteStatus: {}, scheduledAt: {}, publishStatus: {} } }));
mock.module('drizzle-orm', () => ({ eq: () => ({}), and: () => ({}), gte: () => ({}), isNull: () => ({}) }));
mock.module('$lib/server/db', () => ({
	db: {
		select: () => { const c: Record<string, unknown> = { from: () => c, where: () => c, limit: () => c, orderBy: () => c, then: (r: (v: unknown[]) => unknown) => r(q.shift() ?? []) }; return c; },
		update: () => ({ set: (p: Record<string, unknown>) => ({ where: async () => { if (p.publishStatus === 'scheduled') scheduled.push({ id: 'x', at: p.scheduledAt as Date }); } }) })
	}
}));
mock.module('$lib/server/content/article-generator', () => ({ generateArticle: async () => ({ title: 'T', html: '<p>x</p>', excerpt: 'E', model: 'm', focusKeyword: '', seoTitle: '', metaDescription: '', slug: 's' }) }));

const { processContentAutoGenerate } = await import('../content-auto-generate');

describe('processContentAutoGenerate', () => {
	test('dryRun raportează planul fără să scrie', async () => {
		// 1) websites auto; 2) programate existente (0); 3) surse nerescrise
		q.push([{ websiteId: 'w1', tenantId: 'tn', cadencePerWeek: 3, daysOfWeek: null, publishTime: '10:00', autoApprove: false }]);
		q.push([]); // programate în 7z
		q.push([{ id: 's1' }, { id: 's2' }, { id: 's3' }]); // surse candidate
		const res = await processContentAutoGenerate({ dryRun: true });
		expect(res.websites).toBe(1);
		expect(res.planned).toBeGreaterThan(0);
	});
});
```

- [ ] **Step 2: Rulează testul — verifică că EȘUEAZĂ**

Run: `bun test src/lib/server/scheduler/tasks/__tests__/content-auto-generate.test.ts`
Expected: FAIL — modul inexistent.

- [ ] **Step 3: Implementează content-auto-generate.ts**

`app/src/lib/server/scheduler/tasks/content-auto-generate.ts`:
```ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { nextSlots } from '$lib/content/publish-schedule';
import { generateArticle } from '$lib/server/content/article-generator';
import { renderMarkdownNoop } from '$lib/utils/markdown'; // vezi nota: generateArticle întoarce deja html
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

/**
 * Pentru fiecare website 'auto': umple calendarul până la cadence_per_week în
 * următoarele 7 zile, rescriind surse nerescrise și programându-le pe sloturi
 * libere. auto_approve → ready (le ia auto-publish); altfel scheduled pt review.
 * Bounded la cadence/rulare. `dryRun` doar planifică.
 */
export async function processContentAutoGenerate(params: Record<string, unknown> = {}) {
	const dryRun = params.dryRun === true;
	const now = new Date();
	const weekAhead = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

	// 1) profilele 'auto'
	const autos = await db
		.select({
			websiteId: table.websiteContentProfile.websiteId,
			tenantId: table.websiteContentProfile.tenantId,
			cadencePerWeek: table.websiteContentProfile.cadencePerWeek,
			daysOfWeek: table.websiteContentProfile.daysOfWeek,
			publishTime: table.websiteContentProfile.publishTime,
			autoApprove: table.websiteContentProfile.autoApprove
		})
		.from(table.websiteContentProfile)
		.where(eq(table.websiteContentProfile.publishMode, 'auto'))
		.limit(100);

	let planned = 0;
	let generated = 0;
	for (const w of autos) {
		try {
			// 2) programate deja în fereastra de 7z
			const upcoming = await db
				.select({ scheduledAt: table.contentArticle.scheduledAt })
				.from(table.contentArticle)
				.where(
					and(
						eq(table.contentArticle.websiteId, w.websiteId),
						eq(table.contentArticle.publishStatus, 'scheduled'),
						gte(table.contentArticle.scheduledAt, now)
					)
				)
				.limit(50);
			const need = Math.max(0, (w.cadencePerWeek ?? 3) - upcoming.length);
			if (need === 0) continue;

			// 3) surse nerescrise candidate
			const sources = await db
				.select({ id: table.contentArticle.id })
				.from(table.contentArticle)
				.where(
					and(
						eq(table.contentArticle.websiteId, w.websiteId),
						eq(table.contentArticle.rewriteStatus, 'none')
					)
				)
				.limit(need);

			// daysOfWeek e stocat ca JSON array de string (updateWebsitePublishPolicy). Parse defensiv.
			let days: number[] = [];
			try { days = w.daysOfWeek ? (JSON.parse(w.daysOfWeek) as number[]) : []; } catch { days = []; }
			const existing = upcoming.map((u) => u.scheduledAt).filter((d): d is Date => d instanceof Date);
			const slots = nextSlots({ from: now, count: sources.length, daysOfWeek: days, publishTime: w.publishTime ?? '10:00', existing });
			planned += slots.length;
			if (slots.length < sources.length) {
				logWarning('content', `[auto-generate] doar ${slots.length}/${sources.length} sloturi libere pt website ${w.websiteId}`, {
					tenantId: w.tenantId, metadata: { websiteId: w.websiteId, wanted: sources.length, got: slots.length }
				});
			}

			if (dryRun) continue;

			for (let i = 0; i < sources.length; i++) {
				const src = sources[i];
				const at = slots[i];
				if (!at) break;
				// rescrie sursa (loadContentProfile-ul e în generateArticle prin remote; aici direct)
				// NB: reutilizăm doRewrite-ul din remote NU e posibil (event); publicăm minimal:
				await generateAndScheduleSource(w.tenantId, w.websiteId, src.id, at, w.autoApprove === true);
				generated++;
			}
		} catch (err) {
			const { message, stack } = serializeError(err);
			logWarning('content', `[auto-generate] eșec pe website ${w.websiteId}: ${message}`, {
				tenantId: w.tenantId,
				metadata: { websiteId: w.websiteId },
				stackTrace: stack
			});
		}
	}
	logInfo('content', `[auto-generate] ${generated} generate, ${planned} planificate pe ${autos.length} website-uri`, {
		metadata: { websites: autos.length, planned, generated }
	});
	return { success: true, websites: autos.length, planned, generated };
}

/** Rescrie o sursă + o programează (helper intern; profil încărcat inline). */
async function generateAndScheduleSource(
	tenantId: string,
	websiteId: string,
	articleId: string,
	at: Date,
	autoApprove: boolean
) {
	const [a] = await db
		.select()
		.from(table.contentArticle)
		.where(and(eq(table.contentArticle.id, articleId), eq(table.contentArticle.tenantId, tenantId)))
		.limit(1);
	if (!a) return;
	const [profile] = await db
		.select()
		.from(table.websiteContentProfile)
		.where(and(eq(table.websiteContentProfile.websiteId, websiteId), eq(table.websiteContentProfile.tenantId, tenantId)))
		.limit(1);
	const gen = await generateArticle(tenantId, {
		profile: profile ?? null,
		direction: a.articleDirection,
		mode: 'rewrite',
		sourceText: a.bodyText || a.bodyHtml || a.title || ''
	});
	// auto_approve gating (confirmat): true → 'scheduled' (auto-publish îl va publica la slot);
	// false → 'none' (apare pe calendar prin scheduled_at, dar NU se auto-publică — așteaptă
	// review uman; omul îl aprobă și-l pune pe 'scheduled' din editor cu „Programează").
	const publishStatus = autoApprove ? 'scheduled' : 'none';
	await db
		.update(table.contentArticle)
		.set({
			generatedTitle: gen.title,
			generatedExcerpt: gen.excerpt,
			generatedHtml: gen.html,
			seoTitle: gen.seoTitle,
			metaDescription: gen.metaDescription,
			focusKeyword: gen.focusKeyword,
			slug: gen.slug,
			origin: 'rewrite',
			rewriteStatus: 'ready',
			scheduledAt: at,
			publishStatus,
			generatedAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(table.contentArticle.id, articleId));
}
```
**NOTĂ importantă pt implementator:** `generateArticle` întoarce deja `html` (a rulat `renderMarkdown` intern) — ȘTERGE importul `renderMarkdownNoop` (nu există; e un placeholder ca să te oprești aici). Nu importa nimic din markdown în acest fișier. Testul mock-uiește `generateArticle`, deci nu atinge Claude.

- [ ] **Step 4: Rulează testul — verifică că TRECE**

Run: `bun test src/lib/server/scheduler/tasks/__tests__/content-auto-generate.test.ts`
Expected: PASS (după ce ai șters linia `renderMarkdownNoop`).

- [ ] **Step 5: Înregistrează în scheduler/index.ts**

`import`:
```ts
import { processContentAutoGenerate } from './tasks/content-auto-generate';
```
`taskHandlers`: `content_auto_generate: processContentAutoGenerate,`
`expectedJobIds`: `'content-auto-generate'`
`JOB_LABELS`: `content_auto_generate: 'Auto-generare Conținut (mod auto)',`
Înregistrare (zilnic 06:30, înainte de auto-publish orar):
```ts
	// Content auto-generate — zilnic 06:30. Umple calendarul website-urilor 'auto' pe cadență.
	await schedulerQueue.add(
		'content-auto-generate',
		{ type: 'content_auto_generate', params: { dryRun: false } },
		{ repeat: { pattern: '30 6 * * *', tz: 'Europe/Bucharest' }, jobId: 'content-auto-generate' }
	);
	logInfo('scheduler', '[scheduler] content-auto-generate registered (30 6 * * * Europe/Bucharest, LIVE)');
```

- [ ] **Step 6: svelte-check + commit**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error 2>&1 | tail -5`
Expected: 0 erori noi.
```bash
git add src/lib/server/scheduler/tasks/content-auto-generate.ts src/lib/server/scheduler/tasks/__tests__/content-auto-generate.test.ts src/lib/server/scheduler/index.ts
git commit -m "feat(content): scheduler content-auto-generate (umple calendarul auto) (F3)"
```

---

## Task 9: UI — acțiuni publicare (editor) + tab-uri Calendar & Setări

**Files:**
- Modify: `app/src/routes/[tenant]/content/[websiteId]/[articleId]/+page.svelte`
- Modify: `app/src/routes/[tenant]/content/[websiteId]/+page.svelte`
- Modify: `app/src/routes/[tenant]/content/content.css`

**REGULĂ:** toate editările `.svelte` trec prin agentul `svelte:svelte-file-editor` + `svelte-autofixer` (rulează autofixer după fiecare fișier, repară până e curat).

### 9a — Editor: acțiuni Publică / Programează

- [ ] **Step 1: Importă remote-urile noi + iconițe în `[articleId]/+page.svelte`**

În blocul de import remote (5-13), adaugă `publishArticle, scheduleArticle`. Adaugă iconițe:
```ts
	import SendIcon from '@lucide/svelte/icons/send';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
```

- [ ] **Step 2: State + handlers pt publicare/programare**

În `<script>`, adaugă:
```ts
	let publishing = $state(false);
	let scheduleOpen = $state(false);
	let scheduleValue = $state(''); // datetime-local

	async function publishNow(mode: 'draft' | 'publish') {
		if (publishing) return;
		publishing = true;
		try {
			const r = await publishArticle({ articleId, mode });
			toast.success(mode === 'publish' ? 'Publicat pe WordPress' : 'Trimis ca ciornă în WordPress');
			if (r?.link) window.open(r.link, '_blank', 'noopener');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Publicare eșuată');
		} finally {
			publishing = false;
		}
	}

	async function scheduleNow() {
		if (!scheduleValue) return;
		try {
			await scheduleArticle({ articleId, scheduledAt: new Date(scheduleValue).toISOString() });
			toast.success('Articol programat');
			scheduleOpen = false;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Programare eșuată');
		}
	}
```
(`articleId` derivat există deja în fișier — verifică numele exact al variabilei; e folosit în `save`.)

- [ ] **Step 3: Butoane în bara de acțiuni (lângă Aprobă, ~195-204)**

Adaugă după butonul „Aprobă":
```svelte
			<button class="cl-btn-secondary" onclick={() => (scheduleOpen = !scheduleOpen)} disabled={publishing}>
				<CalendarClockIcon size={15} /> Programează
			</button>
			<button class="cl-btn-primary" onclick={() => publishNow('publish')} disabled={publishing}>
				<SendIcon size={15} /> {publishing ? 'Se publică…' : 'Publică'}
			</button>
```
Și un mic panel de programare (sub bară):
```svelte
	{#if scheduleOpen}
		<div class="cl-schedule-row">
			<input type="datetime-local" class="cl-input" bind:value={scheduleValue} />
			<button class="cl-btn-primary" onclick={scheduleNow} disabled={!scheduleValue}>Confirmă programarea</button>
		</div>
	{/if}
```

- [ ] **Step 4: Autofixer + svelte-check**

Rulează `svelte-autofixer` pe `[articleId]/+page.svelte` (prin agent) până 0 probleme.
Run: `NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error 2>&1 | tail -5`

### 9b — Pagina website: tab-uri Calendar + Setări

- [ ] **Step 5: Extinde tipul `Tab` + importuri**

În `[websiteId]/+page.svelte`, schimbă:
```ts
	type Tab = 'articole' | 'context' | 'calendar' | 'setari';
```
Importă remote-urile noi:
```ts
	import { getWebsiteCalendar, getTenantWordpressSites, setWebsiteWpSite, unscheduleArticle } from '$lib/remotes/content-articles.remote';
	import { updateWebsitePublishPolicy } from '$lib/remotes/website-content-profile.remote';
	import { buildMonthGrid } from '$lib/content/calendar';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
```

- [ ] **Step 6: State calendar + citire date**

```ts
	const today = new Date();
	let calYear = $state(today.getFullYear());
	let calMonth = $state(today.getMonth()); // 0-based
	const grid = $derived(buildMonthGrid(calYear, calMonth));
	const calArticles = $derived(await getWebsiteCalendar({ websiteId, year: calYear, month: calMonth }));
	// mapează pe zi (iso YYYY-MM-DD)
	const byDay = $derived.by(() => {
		const m = new Map<string, typeof calArticles>();
		for (const a of calArticles) {
			if (!a.scheduledAt) continue;
			const d = a.scheduledAt instanceof Date ? a.scheduledAt : new Date(a.scheduledAt);
			const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
			const arr = m.get(iso) ?? [];
			arr.push(a);
			m.set(iso, arr);
		}
		return m;
	});
	function prevMonth() { if (calMonth === 0) { calMonth = 11; calYear--; } else calMonth--; }
	function nextMonthNav() { if (calMonth === 11) { calMonth = 0; calYear++; } else calMonth++; }
	const MONTHS = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];
```

- [ ] **Step 7: State Setări (WP link + politică)**

```ts
	const wpSites = $derived(await getTenantWordpressSites());
	const DOW = [[1,'Lu'],[2,'Ma'],[3,'Mi'],[4,'Jo'],[5,'Vi'],[6,'Sâ'],[0,'Du']] as const;
	let policyForm = $state<{ publishMode: 'manual'|'scheduled'|'auto'; cadencePerWeek: number; daysOfWeek: number[]; publishTime: string; defaultWpStatus: 'draft'|'publish'; autoApprove: boolean }>({ publishMode: 'manual', cadencePerWeek: 3, daysOfWeek: [], publishTime: '10:00', defaultWpStatus: 'draft', autoApprove: false });
	let policyLoadedFor = $state<string | null>(null);
	let selectedWpSiteId = $state<string>('');
	let savingPolicy = $state(false);

	function parseDays(raw: string | null | undefined): number[] {
		if (!raw) return [];
		try { const a = JSON.parse(raw); return Array.isArray(a) ? a.filter((n) => typeof n === 'number') : []; } catch { return []; }
	}
	function toggleDay(d: number) {
		policyForm.daysOfWeek = policyForm.daysOfWeek.includes(d)
			? policyForm.daysOfWeek.filter((x) => x !== d)
			: [...policyForm.daysOfWeek, d];
	}

	$effect(() => {
		if (profile && policyLoadedFor !== websiteId) {
			policyForm = {
				publishMode: (profile.publishMode as 'manual'|'scheduled'|'auto') ?? 'manual',
				cadencePerWeek: profile.cadencePerWeek ?? 3,
				daysOfWeek: parseDays(profile.daysOfWeek),
				publishTime: profile.publishTime ?? '10:00',
				defaultWpStatus: (profile.defaultWpStatus as 'draft'|'publish') ?? 'draft',
				autoApprove: profile.autoApprove ?? false
			};
			policyLoadedFor = websiteId;
		}
	});
	$effect(() => { if (site) selectedWpSiteId = site.wpSiteId ?? ''; });

	async function savePolicy() {
		if (savingPolicy) return;
		savingPolicy = true;
		try {
			await updateWebsitePublishPolicy({
				websiteId,
				publishMode: policyForm.publishMode,
				cadencePerWeek: Number(policyForm.cadencePerWeek),
				daysOfWeek: policyForm.daysOfWeek,
				publishTime: policyForm.publishTime,
				defaultWpStatus: policyForm.defaultWpStatus,
				autoApprove: policyForm.autoApprove
			}).updates(getWebsiteContentProfile(websiteId));
			toast.success('Politică salvată');
		} catch (e) { toast.error(e instanceof Error ? e.message : 'Eroare'); }
		finally { savingPolicy = false; }
	}
	async function saveWpLink() {
		try {
			await setWebsiteWpSite({ websiteId, wpSiteId: selectedWpSiteId || null }).updates(getContentWebsites());
			toast.success('Legătură WordPress salvată');
		} catch (e) { toast.error(e instanceof Error ? e.message : 'Eroare'); }
	}
```

- [ ] **Step 8: Butoane tab în `cl-tabs` (după „Context brand")**
```svelte
				<button class="cl-tab" class:active={activeTab === 'calendar'} onclick={() => (activeTab = 'calendar')}>
					<CalendarIcon size={13} /> Calendar
				</button>
				<button class="cl-tab" class:active={activeTab === 'setari'} onclick={() => (activeTab = 'setari')}>
					<Settings2Icon size={13} /> Setări
				</button>
```

- [ ] **Step 9: Secțiunea Calendar (după blocul tab-ului `context`)**
```svelte
	{#if activeTab === 'calendar'}
		<svelte:boundary>
			<div class="cl-ctx">
				<div class="cl-cal-head">
					<button class="cl-btn-secondary" onclick={prevMonth} aria-label="Luna anterioară">‹</button>
					<strong>{MONTHS[calMonth]} {calYear}</strong>
					<button class="cl-btn-secondary" onclick={nextMonthNav} aria-label="Luna următoare">›</button>
				</div>
				<div class="cl-cal-grid">
					{#each ['Lu','Ma','Mi','Jo','Vi','Sâ','Du'] as dn (dn)}<div class="cl-cal-dow">{dn}</div>{/each}
					{#each grid as week (week[0].iso)}
						{#each week as d (d.iso)}
							<div class="cl-cal-cell" class:out={!d.inMonth}>
								<span class="cl-cal-num">{d.day}</span>
								{#each byDay.get(d.iso) ?? [] as a (a.id)}
									<button class="cl-cal-chip {a.publishStatus}" onclick={() => openArticle(a.id)} title={a.generatedTitle ?? a.title ?? ''}>
										{(a.generatedTitle ?? a.title ?? '—').slice(0, 22)}
									</button>
								{/each}
							</div>
						{/each}
					{/each}
				</div>
			</div>
			{#snippet pending()}<div class="cl-ctx"><div class="cl-section ct-skel" style="height:360px"></div></div>{/snippet}
			{#snippet failed(error, reset)}
				<div class="cl-ctx"><div class="cl-empty"><TriangleAlertIcon size={32} /><h3>Eroare calendar</h3><p>{error instanceof Error ? error.message : ''}</p><button class="cl-btn-secondary" onclick={reset}>Reîncearcă</button></div></div>
			{/snippet}
		</svelte:boundary>
	{/if}
```

- [ ] **Step 10: Secțiunea Setări (WP link + politică publicare)**
```svelte
	{#if activeTab === 'setari'}
		<svelte:boundary>
			<div class="cl-ctx">
				<div class="cl-section">
					<div class="cl-field">
						<label for="wp-site">Site WordPress (publicare)</label>
						<div style="display:flex; gap:10px">
							<select id="wp-site" class="cl-input" bind:value={selectedWpSiteId}>
								<option value="">— nelegat —</option>
								{#each wpSites as s (s.id)}<option value={s.id}>{s.siteUrl}</option>{/each}
							</select>
							<button class="cl-btn-secondary" onclick={saveWpLink}>Salvează</button>
						</div>
					</div>

					<div class="cl-field" style="margin-top:16px">
						<label for="pub-mode">Mod publicare</label>
						<div class="cl-seg" id="pub-mode">
							{#each [['manual','Manual'],['scheduled','Programat'],['auto','Auto']] as [val, lbl] (val)}
								<button class="cl-seg-btn" class:active={policyForm.publishMode === val} onclick={() => (policyForm.publishMode = val)}>{lbl}</button>
							{/each}
						</div>
					</div>

					<div class="cl-form-row two" style="margin-top:12px">
						<div class="cl-field">
							<label for="cadence">Articole / săptămână</label>
							<input id="cadence" type="number" min="0" max="21" class="cl-input" bind:value={policyForm.cadencePerWeek} />
						</div>
						<div class="cl-field">
							<label for="ptime">Ora publicării</label>
							<input id="ptime" type="time" class="cl-input" bind:value={policyForm.publishTime} />
						</div>
					</div>

					<div class="cl-field" style="margin-top:12px">
						<span class="cl-lbl">Zile de publicare (mod programat/auto)</span>
						<div class="cl-seg" role="group" aria-label="Zile de publicare">
							{#each DOW as [d, lbl] (d)}
								<button type="button" class="cl-seg-btn" class:active={policyForm.daysOfWeek.includes(d)} onclick={() => toggleDay(d)}>{lbl}</button>
							{/each}
						</div>
					</div>

					<div class="cl-form-row two" style="margin-top:12px">
						<div class="cl-field">
							<label for="dwstatus">Status WP implicit</label>
							<select id="dwstatus" class="cl-input" bind:value={policyForm.defaultWpStatus}>
								<option value="draft">Ciornă</option>
								<option value="publish">Publicat</option>
							</select>
						</div>
						<div class="cl-field">
							<label for="autoappr">Auto-aprobare</label>
							<label class="cl-check"><input id="autoappr" type="checkbox" bind:checked={policyForm.autoApprove} /> Publică automat fără review (mod auto)</label>
						</div>
					</div>

					<div style="display:flex; justify-content:flex-end; margin-top:16px">
						<button class="cl-btn-primary" disabled={savingPolicy} onclick={savePolicy}><SaveIcon size={13} /> Salvează politica</button>
					</div>
				</div>
			</div>
			{#snippet pending()}<div class="cl-ctx"><div class="cl-section ct-skel" style="height:300px"></div></div>{/snippet}
			{#snippet failed(error, reset)}<div class="cl-ctx"><div class="cl-empty"><TriangleAlertIcon size={32} /><h3>Eroare setări</h3><button class="cl-btn-secondary" onclick={reset}>Reîncearcă</button></div></div>{/snippet}
		</svelte:boundary>
	{/if}
```

- [ ] **Step 11: CSS pentru calendar + segmented în `content.css`**

Adaugă la finalul `content.css`:
```css
.cl-cal-head { display:flex; align-items:center; justify-content:center; gap:16px; margin-bottom:14px; }
.cl-cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; }
.cl-cal-dow { text-align:center; font-size:12px; color:var(--cl-text-3); font-weight:600; padding:4px 0; }
.cl-cal-cell { min-height:84px; border:1px solid var(--cl-border); border-radius:8px; padding:6px; background:var(--cl-surface); display:flex; flex-direction:column; gap:4px; }
.cl-cal-cell.out { opacity:.45; }
.cl-cal-num { font-size:12px; color:var(--cl-text-3); font-variant-numeric:tabular-nums; }
.cl-cal-chip { text-align:left; font-size:11px; padding:3px 6px; border-radius:5px; border:0; cursor:pointer; background:var(--cl-accent-soft, #e7f0ff); color:var(--cl-accent, #1877f2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cl-cal-chip.published { background:#e6f7ec; color:#137333; }
.cl-cal-chip.failed { background:#fce8e6; color:#c5221f; }
.cl-seg { display:inline-flex; border:1px solid var(--cl-border); border-radius:8px; overflow:hidden; }
.cl-seg-btn { border:0; background:transparent; padding:8px 16px; cursor:pointer; font-size:13px; color:var(--cl-text-2); }
.cl-seg-btn.active { background:var(--cl-accent, #1877f2); color:#fff; }
.cl-check { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--cl-text-2); }
.cl-lbl { display:block; font-size:13px; color:var(--cl-text-2); margin-bottom:6px; }
.cl-schedule-row { display:flex; gap:10px; align-items:center; margin:0 28px 14px; }
```
(Verifică numele token-urilor `--cl-*` existente în `content.css`; ajustează fallback-urile dacă diferă.)

- [ ] **Step 12: Autofixer pe ambele pagini + svelte-check final**

Rulează `svelte-autofixer` (via agent) pe `[websiteId]/+page.svelte` și `[articleId]/+page.svelte` până 0 probleme.
Run: `NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error 2>&1 | tail -8`
Expected: 0 erori (baseline 16 err e vechi; nu introduce erori noi).

- [ ] **Step 13: Commit**
```bash
git add src/routes/'[tenant]'/content/
git commit -m "feat(content): UI publicare (editor) + tab-uri Calendar & Setări (F3)"
```

---

## Task 10: Verificare finală + rulare toată suita

- [ ] **Step 1: Rulează toate testele content + scheduler noi**

Run:
```bash
bun test src/lib/content src/lib/server/content src/lib/server/wordpress/__tests__/sync-scope.test.ts src/lib/server/scheduler/tasks/__tests__/content-auto-publish.test.ts src/lib/server/scheduler/tasks/__tests__/content-auto-generate.test.ts
```
Expected: toate PASS (cele ~37 F0-F2 + noile F3).

- [ ] **Step 2: svelte-check final (0 erori)**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error 2>&1 | tail -8`
Expected: 0 erori.

- [ ] **Step 3: Actualizează handoff-ul**

În `docs/superpowers/2026-07-24-content-redesign-HANDOFF.md`, mută F3 din „Ce RĂMÂNE" în „Ce e GATA", notând: publicare WP (manual/programat/auto), calendar lunar, moduri per website, task-uri `content-auto-publish`/`content-auto-generate`, fix coliziune `wordpress_post`, migrări 0432-0433.

- [ ] **Step 4: Commit final**
```bash
git add docs/superpowers/2026-07-24-content-redesign-HANDOFF.md
git commit -m "docs(content): handoff F3 complet (publicare + calendar + automatizare)"
```

---

## Self-Review (verificat față de spec §7)

- **§7.1 Moduri (manual/scheduled/auto)** → Task 6 (policy) + Task 9 (UI Setări) + Task 7/8 (scheduler). ✓
- **§7.2 Path publicare (loadSiteAndClient + extractAndUploadInlineImages + createPost, ținta wpSiteId, persist wp_post_id + publish_status, gate fără wpSiteId)** → Task 5. ✓
- **§7.3 Scheduler (content-auto-publish + content-auto-generate, pattern wordpress-*, AbortSignal)** → Task 7/8 (fetch-urile externe sunt în WpClient, care pune deja AbortSignal.timeout). ✓
- **§7.3 Fix bug upsert wordpress_post fără siteId** → Task 2. ✓
- **§7.4 Calendar lunar pe scheduled_at** → Task 3 (grilă) + Task 6 (query) + Task 9 (UI). ✓
- **§5.1 publish_status column + index** → Task 1. ✓
- **§10 Testare (publish path cu WpClient mock; scheduler dryRun; coliziune wpPostId)** → Task 5, 7, 8, 2. ✓

**Type consistency:** `publishArticleToWordpress(tenantId, articleId, {status, publishedAt?})` — folosit identic în Task 5/6/7. `publish_status` enum stabil peste tot. `nextSlots`/`buildMonthGrid` semnături identice în Task 3/4/8/9. `getWebsiteCalendar({websiteId, year, month})` identic Task 6/9.

**Non-goals respectate:** fără streaming, fără drag-to-reschedule (doar click→editor), fără per-website Claude routing (contextul vine ca prompt), fără push WP-native `future` (CRM scheduler publică — decizia confirmată).
