# Content F0 — Fundație date + import local (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivotează `content_article` de la string `brand` la `websiteId` (hub `clientWebsite`), leagă website→WordPress, creează tabelul de profil brand, apoi importă cele 113 rescrieri locale în DB și face backfill pe cele 3 brand-uri (heylux/preziosa/lucky).

**Architecture:** Migrări hand-authored (un statement/fișier, journal patch manual — `db:gen` le-ar drop-a) + `db:migrate` pe Turso. Backfill și import prin **endpoint-uri admin-gated `[tenant]/api/_debug-*`** (nu bun scripts — `$lib` nu se rezolvă acolo), idempotente, `UPDATE` pe `id`. Helper-e pure (parser frontmatter, map brand→domeniu, normalizare domeniu) unit-testate TDD.

**Tech Stack:** SvelteKit 5, Bun, Drizzle ORM, libSQL/Turso, `marked` (^17), Vitest.

**Referință spec:** `docs/superpowers/specs/2026-07-24-content-multi-website-design.md` (§5 model, §5.4 backfill, §5.5 import).

**Date verificate (Turso PROD):** client Lucky Group `lu44x3vi4e5yom6jb2bq6mbi`; clientWebsite: heylux `a9412aba640f436c8cdf69f8865199`(heylux.ro), lucky `az5wrkjreui6ctzooy3uhq5z`(www.luckystudio.ro), preziosa `rk32c2mnwxwwjv53ynqqkgdv`(preziosa.ro); wordpress_site: Heylux.ro `npm3eomh56zhzhd2euwkx77e`, Luckystudio.ro `oiwi5piy5elxzj2ycb6mbh2e`, Preziosa.ro `mpw2vpynpi5ciiqety7acsbj` (toate client_id=null). Backfill-ul rezolvă id-urile **prin match pe domeniu la runtime**, nu le hardcodează (scalabil).

**Convenții:** un statement/migrare; verifică `PRAGMA table_info` pe Turso după `db:migrate`; NU adăuga coloană în schema.ts înainte de aplicarea migrării (select-all hazard → „no such column"); `requireStaff`/owner-admin gate pe endpoint-uri; ultima migrare = `0416`, deci pornim de la `0417`.

---

## File Structure

- `drizzle/0417_*.sql` … `drizzle/0426_*.sql` — Create (migrări, un statement fiecare)
- `drizzle/meta/_journal.json` — Modify (append idx 417-426)
- `src/lib/server/db/schema.ts` — Modify (coloane noi + tabel `websiteContentProfile` + relații)
- `src/lib/server/content/frontmatter.ts` — Create (parser frontmatter MD, pur)
- `src/lib/server/content/__tests__/frontmatter.test.ts` — Create (test)
- `src/lib/server/content/website-resolver.ts` — Create (map brand→domeniu + normalizare domeniu, pur)
- `src/lib/server/content/__tests__/website-resolver.test.ts` — Create (test)
- `src/routes/[tenant]/api/_debug-backfill-content-websites/+server.ts` — Create (backfill)
- `src/routes/[tenant]/api/_debug-import-content/+server.ts` — Create (import local)

---

## Task 1: Migrări pivot `content_article` (7 coloane)

**Files:**
- Create: `drizzle/0417_content_article_website_id.sql` … `drizzle/0423_content_article_generated_at.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Scrie cele 7 fișiere de migrare (un ADD COLUMN fiecare)**

`drizzle/0417_content_article_website_id.sql`:
```sql
ALTER TABLE `content_article` ADD COLUMN `website_id` text;
```
`drizzle/0418_content_article_client_id.sql`:
```sql
ALTER TABLE `content_article` ADD COLUMN `client_id` text;
```
`drizzle/0419_content_article_origin.sql`:
```sql
ALTER TABLE `content_article` ADD COLUMN `origin` text DEFAULT 'scraped' NOT NULL;
```
`drizzle/0420_content_article_generated_title.sql`:
```sql
ALTER TABLE `content_article` ADD COLUMN `generated_title` text;
```
`drizzle/0421_content_article_generated_html.sql`:
```sql
ALTER TABLE `content_article` ADD COLUMN `generated_html` text;
```
`drizzle/0422_content_article_generated_excerpt.sql`:
```sql
ALTER TABLE `content_article` ADD COLUMN `generated_excerpt` text;
```
`drizzle/0423_content_article_generated_at.sql`:
```sql
ALTER TABLE `content_article` ADD COLUMN `generated_at` timestamp;
```

- [ ] **Step 2: Adaugă intrările în `_journal.json`**

În array-ul `entries` (după idx 416), append 7 obiecte, incrementând `idx` și `when`:
```json
    { "idx": 417, "version": "6", "when": 1779916800027527, "tag": "0417_content_article_website_id", "breakpoints": true },
    { "idx": 418, "version": "6", "when": 1779916800027528, "tag": "0418_content_article_client_id", "breakpoints": true },
    { "idx": 419, "version": "6", "when": 1779916800027529, "tag": "0419_content_article_origin", "breakpoints": true },
    { "idx": 420, "version": "6", "when": 1779916800027530, "tag": "0420_content_article_generated_title", "breakpoints": true },
    { "idx": 421, "version": "6", "when": 1779916800027531, "tag": "0421_content_article_generated_html", "breakpoints": true },
    { "idx": 422, "version": "6", "when": 1779916800027532, "tag": "0422_content_article_generated_excerpt", "breakpoints": true },
    { "idx": 423, "version": "6", "when": 1779916800027533, "tag": "0423_content_article_generated_at", "breakpoints": true }
```
(Precede idx 417 cu virgulă după blocul 416; păstrează JSON valid.)

- [ ] **Step 3: Verifică journal valid**

Run: `cd app && bun -e "JSON.parse(require('fs').readFileSync('drizzle/meta/_journal.json','utf8')); console.log('journal OK')"`
Expected: `journal OK`

- [ ] **Step 4: NU rula încă `db:migrate`** — se rulează după Task 2 (toate migrările deodată).

- [ ] **Step 5: Commit**
```bash
cd /Users/augustin598/Projects/CRM
git add app/drizzle/0417_*.sql app/drizzle/0418_*.sql app/drizzle/0419_*.sql app/drizzle/0420_*.sql app/drizzle/0421_*.sql app/drizzle/0422_*.sql app/drizzle/0423_*.sql app/drizzle/meta/_journal.json
git commit -m "feat(content): migrări pivot content_article -> website (7 coloane)"
```

---

## Task 2: Migrări `client_website.wp_site_id` + tabel `website_content_profile`

**Files:**
- Create: `drizzle/0424_client_website_wp_site_id.sql`, `drizzle/0425_website_content_profile.sql`, `drizzle/0426_content_article_website_idx.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: `drizzle/0424_client_website_wp_site_id.sql`**
```sql
ALTER TABLE `client_website` ADD COLUMN `wp_site_id` text;
```

- [ ] **Step 2: `drizzle/0425_website_content_profile.sql`** (un singur CREATE TABLE, UNIQUE inline)
```sql
CREATE TABLE IF NOT EXISTS `website_content_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`website_id` text NOT NULL,
	`tone` text,
	`audience` text,
	`language` text DEFAULT 'ro' NOT NULL,
	`keywords` text,
	`topics` text,
	`do_list` text,
	`dont_list` text,
	`guardrails` text,
	`sample_urls` text,
	`extra_notes` text,
	`publish_mode` text DEFAULT 'manual' NOT NULL,
	`cadence_per_week` integer DEFAULT 3 NOT NULL,
	`days_of_week` text,
	`publish_time` text DEFAULT '10:00' NOT NULL,
	`default_wp_status` text DEFAULT 'draft' NOT NULL,
	`auto_approve` number DEFAULT false NOT NULL,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`),
	FOREIGN KEY (`website_id`) REFERENCES `client_website`(`id`)
);
```

- [ ] **Step 3: `drizzle/0426_content_article_website_idx.sql`**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS `website_content_profile_website_idx` ON `website_content_profile` (`website_id`);
```

- [ ] **Step 4: Append journal idx 424-426**
```json
    { "idx": 424, "version": "6", "when": 1779916800027534, "tag": "0424_client_website_wp_site_id", "breakpoints": true },
    { "idx": 425, "version": "6", "when": 1779916800027535, "tag": "0425_website_content_profile", "breakpoints": true },
    { "idx": 426, "version": "6", "when": 1779916800027536, "tag": "0426_content_article_website_idx", "breakpoints": true }
```

- [ ] **Step 5: Aplică toate migrările pe Turso**

Run: `cd app && bun run db:migrate`
Expected: aplică 0417-0426 fără eroare (`migrations applied`).

- [ ] **Step 6: Verifică pe Turso (PRAGMA)**

Run:
```bash
cd app && bun -e "
const {createClient}=require('@libsql/client');
const db=createClient({url:process.env.SQLITE_URI,authToken:process.env.SQLITE_AUTH_TOKEN});
(async()=>{
 const a=await db.execute('PRAGMA table_info(content_article)');
 console.log('content_article cols:', a.rows.map(r=>r.name).filter(n=>['website_id','client_id','origin','generated_title','generated_html','generated_excerpt','generated_at'].includes(n)));
 const w=await db.execute('PRAGMA table_info(client_website)');
 console.log('client_website has wp_site_id:', w.rows.some(r=>r.name==='wp_site_id'));
 const p=await db.execute('PRAGMA table_info(website_content_profile)');
 console.log('website_content_profile cols:', p.rows.length);
})();"
```
Expected: cele 7 coloane listate, `wp_site_id: true`, `website_content_profile cols: 20`.

- [ ] **Step 7: Commit**
```bash
cd /Users/augustin598/Projects/CRM
git add app/drizzle/0424_*.sql app/drizzle/0425_*.sql app/drizzle/0426_*.sql app/drizzle/meta/_journal.json
git commit -m "feat(content): client_website.wp_site_id + tabel website_content_profile"
```

---

## Task 3: Update `schema.ts` (coloane + tabel + relații)

**Files:**
- Modify: `src/lib/server/db/schema.ts` (contentArticle ~2007, clientWebsite ~1946, adaugă websiteContentProfile după clientWebsite)

- [ ] **Step 1: Adaugă coloanele în `contentArticle`** (după `brand`, înainte de `sourceUrl` pentru pivot; și grupul generat lângă rewriteStatus). Inserează:
```ts
	// Pivot multi-website (F0):
	websiteId: text('website_id').references(() => clientWebsite.id),
	clientId: text('client_id').references(() => client.id),
	origin: text('origin').notNull().default('scraped'), // scraped|rewrite|brief
	// Output generat (separat de sursă):
	generatedTitle: text('generated_title'),
	generatedHtml: text('generated_html'),
	generatedExcerpt: text('generated_excerpt'),
	generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' }),
```
(Plasează `websiteId/clientId/origin` imediat după linia `brand: text('brand')...`; grupul `generated*` imediat după `rewriteStatus`.)

- [ ] **Step 2: Adaugă `wpSiteId` în `clientWebsite`** (după `isDefault`):
```ts
	wpSiteId: text('wp_site_id').references(() => wordpressSite.id),
```

- [ ] **Step 3: Adaugă tabelul `websiteContentProfile`** (imediat după blocul `clientWebsite`):
```ts
export const websiteContentProfile = sqliteTable('website_content_profile', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id').notNull().references(() => tenant.id),
	websiteId: text('website_id').notNull().references(() => clientWebsite.id).unique(),
	// Profil brand (context AI general)
	tone: text('tone'),
	audience: text('audience'),
	language: text('language').notNull().default('ro'),
	keywords: text('keywords'), // JSON string[]
	topics: text('topics'), // JSON string[]
	doList: text('do_list'),
	dontList: text('dont_list'),
	guardrails: text('guardrails'), // „Mesaje INTERZISE"
	sampleUrls: text('sample_urls'), // JSON string[]
	extraNotes: text('extra_notes'),
	// Politică publicare
	publishMode: text('publish_mode').notNull().default('manual'), // manual|scheduled|auto
	cadencePerWeek: integer('cadence_per_week').notNull().default(3),
	daysOfWeek: text('days_of_week'), // JSON number[]
	publishTime: text('publish_time').notNull().default('10:00'),
	defaultWpStatus: text('default_wp_status').notNull().default('draft'),
	autoApprove: boolean('auto_approve').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`current_timestamp`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`current_timestamp`)
});
```

- [ ] **Step 4: Verifică type-check** (baseline: 16 err/56 warn — nu introduce erori noi)

Run: `cd app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error 2>&1 | tail -5`
Expected: fără erori NOI legate de `content_article`/`website_content_profile` (numărul de erori ≤ baseline 16).

- [ ] **Step 5: Commit**
```bash
cd /Users/augustin598/Projects/CRM
git add app/src/lib/server/db/schema.ts
git commit -m "feat(content): schema.ts — coloane pivot + tabel websiteContentProfile"
```

---

## Task 4: Parser frontmatter MD (pur, TDD)

**Files:**
- Create: `src/lib/server/content/frontmatter.ts`
- Test: `src/lib/server/content/__tests__/frontmatter.test.ts`

- [ ] **Step 1: Scrie testul (eșuează)**

`src/lib/server/content/__tests__/frontmatter.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../frontmatter';

describe('parseFrontmatter', () => {
	it('parsează frontmatter cu valori citate și corpul', () => {
		const md = `---\nid: "abc123"\nbrand: "heylux"\nrewrittenTitle: "Job videochat Iași — Heylux"\nrewrittenExcerpt: "Angajare fără experiență."\n---\n\nCorpul articolului.\n\n## Secțiune`;
		const { data, body } = parseFrontmatter(md);
		expect(data.id).toBe('abc123');
		expect(data.brand).toBe('heylux');
		expect(data.rewrittenTitle).toBe('Job videochat Iași — Heylux');
		expect(data.rewrittenExcerpt).toBe('Angajare fără experiență.');
		expect(body.startsWith('Corpul articolului.')).toBe(true);
		expect(body.includes('## Secțiune')).toBe(true);
	});

	it('returnează body gol când nu e frontmatter', () => {
		const { data, body } = parseFrontmatter('doar text');
		expect(data).toEqual({});
		expect(body).toBe('doar text');
	});
});
```

- [ ] **Step 2: Rulează testul — eșuează**

Run: `cd app && npx vitest run src/lib/server/content/__tests__/frontmatter.test.ts`
Expected: FAIL (`parseFrontmatter is not a function` / modul negăsit).

- [ ] **Step 3: Implementează parser-ul**

`src/lib/server/content/frontmatter.ts`:
```ts
/**
 * Parser minimal de frontmatter YAML-like pentru fișierele content/heylux/*.md.
 * Format: `---\n key: "value" \n---\n body`. Valorile sunt string-uri (cu sau fără ghilimele).
 * Fără dependență externă (nu avem gray-matter/js-yaml).
 */
export function parseFrontmatter(md: string): { data: Record<string, string>; body: string } {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
	if (!m) return { data: {}, body: md };
	const data: Record<string, string> = {};
	for (const line of m[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line.trim());
		if (!kv) continue;
		let val = kv[2].trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		data[kv[1]] = val;
	}
	return { data, body: m[2].replace(/^\r?\n/, '') };
}
```

- [ ] **Step 4: Rulează testul — trece**

Run: `cd app && npx vitest run src/lib/server/content/__tests__/frontmatter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
cd /Users/augustin598/Projects/CRM
git add app/src/lib/server/content/frontmatter.ts app/src/lib/server/content/__tests__/frontmatter.test.ts
git commit -m "feat(content): parser frontmatter MD + test"
```

---

## Task 5: Resolver website (brand→domeniu + normalizare, pur, TDD)

**Files:**
- Create: `src/lib/server/content/website-resolver.ts`
- Test: `src/lib/server/content/__tests__/website-resolver.test.ts`

- [ ] **Step 1: Scrie testul (eșuează)**

`src/lib/server/content/__tests__/website-resolver.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeDomain, brandToDomain, resolveWebsiteId } from '../website-resolver';

describe('normalizeDomain', () => {
	it('scoate www și trailing slash, lowercase', () => {
		expect(normalizeDomain('https://www.LuckyStudio.ro/')).toBe('luckystudio.ro');
		expect(normalizeDomain('https://preziosa.ro/')).toBe('preziosa.ro');
		expect(normalizeDomain('heylux.ro')).toBe('heylux.ro');
	});
});

describe('brandToDomain', () => {
	it('mapează cele 3 brand-uri', () => {
		expect(brandToDomain('heylux')).toBe('heylux.ro');
		expect(brandToDomain('luckystudio')).toBe('luckystudio.ro');
		expect(brandToDomain('preziosa')).toBe('preziosa.ro');
	});
	it('returnează null pt brand-uri excluse', () => {
		expect(brandToDomain('forumvideochat')).toBeNull();
		expect(brandToDomain('vivadiva')).toBeNull();
		expect(brandToDomain('unknown')).toBeNull();
	});
});

describe('resolveWebsiteId', () => {
	const websites = [
		{ id: 'w-heylux', url: 'https://heylux.ro' },
		{ id: 'w-lucky', url: 'https://www.luckystudio.ro/' },
		{ id: 'w-preziosa', url: 'https://preziosa.ro/' }
	];
	it('rezolvă brand->websiteId prin domeniu', () => {
		expect(resolveWebsiteId('heylux', websites)).toBe('w-heylux');
		expect(resolveWebsiteId('luckystudio', websites)).toBe('w-lucky');
		expect(resolveWebsiteId('preziosa', websites)).toBe('w-preziosa');
	});
	it('returnează null pt brand exclus sau website lipsă', () => {
		expect(resolveWebsiteId('forumvideochat', websites)).toBeNull();
		expect(resolveWebsiteId('heylux', [])).toBeNull();
	});
});
```

- [ ] **Step 2: Rulează testul — eșuează**

Run: `cd app && npx vitest run src/lib/server/content/__tests__/website-resolver.test.ts`
Expected: FAIL (modul negăsit).

- [ ] **Step 3: Implementează resolver-ul**

`src/lib/server/content/website-resolver.ts`:
```ts
/**
 * Rezolvare brand -> clientWebsite pt backfill/import content (F0).
 * Scope: doar cele 3 brand-uri active (heylux/luckystudio/preziosa). Restul -> null (ignorate).
 * Normalizarea domeniului = aceeași convenție ca extractDomainFromUrl din SEO (www + trailing slash).
 */
const BRAND_DOMAIN: Record<string, string> = {
	heylux: 'heylux.ro',
	luckystudio: 'luckystudio.ro',
	preziosa: 'preziosa.ro'
};

export function normalizeDomain(url: string): string {
	let host = url.trim();
	try {
		host = new URL(host.includes('://') ? host : `https://${host}`).hostname;
	} catch {
		host = host.replace(/^https?:\/\//, '').split('/')[0];
	}
	return host.replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();
}

export function brandToDomain(brand: string): string | null {
	return BRAND_DOMAIN[brand] ?? null;
}

export function resolveWebsiteId(
	brand: string,
	websites: Array<{ id: string; url: string }>
): string | null {
	const domain = brandToDomain(brand);
	if (!domain) return null;
	const match = websites.find((w) => normalizeDomain(w.url) === domain);
	return match ? match.id : null;
}
```

- [ ] **Step 4: Rulează testul — trece**

Run: `cd app && npx vitest run src/lib/server/content/__tests__/website-resolver.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**
```bash
cd /Users/augustin598/Projects/CRM
git add app/src/lib/server/content/website-resolver.ts app/src/lib/server/content/__tests__/website-resolver.test.ts
git commit -m "feat(content): resolver brand->website + normalizare domeniu + test"
```

---

## Task 6: Endpoint backfill website/WP/profile

**Files:**
- Create: `src/routes/[tenant]/api/_debug-backfill-content-websites/+server.ts`

Face 4 lucruri idempotent, tenant-scoped: (1) `content_article.websiteId`+`clientId` din brand; (2) `clientWebsite.wpSiteId` auto-match domeniu; (3) `wordpressSite.clientId` bonus; (4) seed `website_content_profile` pt cele 3 website-uri (heylux: `extraNotes` = brand-context.md).

- [ ] **Step 1: Scrie endpoint-ul**

`src/routes/[tenant]/api/_debug-backfill-content-websites/+server.ts`:
```ts
import { json, error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { serializeError } from '$lib/server/logger';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { normalizeDomain, brandToDomain, resolveWebsiteId } from '$lib/server/content/website-resolver';
import type { RequestHandler } from './$types';

function generateId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	const role = locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: admin access required');
	const tenantId = locals.tenant.id;
	const now = new Date();

	try {
		// 1. Website-urile tenantului (id, url, clientId)
		const websites = await db
			.select({ id: table.clientWebsite.id, url: table.clientWebsite.url, clientId: table.clientWebsite.clientId })
			.from(table.clientWebsite)
			.where(eq(table.clientWebsite.tenantId, tenantId));

		// 2. Backfill content_article.websiteId + clientId din brand (doar cele 3 brand-uri)
		const articles = await db
			.select({ id: table.contentArticle.id, brand: table.contentArticle.brand })
			.from(table.contentArticle)
			.where(eq(table.contentArticle.tenantId, tenantId));
		let assigned = 0;
		for (const a of articles) {
			const wid = resolveWebsiteId(a.brand, websites);
			if (!wid) continue;
			const w = websites.find((x) => x.id === wid)!;
			await db.update(table.contentArticle)
				.set({ websiteId: wid, clientId: w.clientId, updatedAt: now })
				.where(eq(table.contentArticle.id, a.id));
			assigned++;
		}

		// 3. clientWebsite.wpSiteId auto-match domeniu
		const wpSites = await db
			.select({ id: table.wordpressSite.id, siteUrl: table.wordpressSite.siteUrl, clientId: table.wordpressSite.clientId })
			.from(table.wordpressSite)
			.where(eq(table.wordpressSite.tenantId, tenantId));
		let wpLinked = 0, wpClientSet = 0;
		for (const w of websites) {
			const wpMatch = wpSites.find((s) => normalizeDomain(s.siteUrl) === normalizeDomain(w.url));
			if (!wpMatch) continue;
			await db.update(table.clientWebsite).set({ wpSiteId: wpMatch.id, updatedAt: now }).where(eq(table.clientWebsite.id, w.id));
			wpLinked++;
			// 3b. bonus: setează wordpressSite.clientId dacă e null
			if (!wpMatch.clientId && w.clientId) {
				await db.update(table.wordpressSite).set({ clientId: w.clientId, updatedAt: now }).where(eq(table.wordpressSite.id, wpMatch.id));
				wpClientSet++;
			}
		}

		// 4. Seed website_content_profile pt cele 3 website-uri active
		let profilesCreated = 0;
		let brandContext = '';
		try {
			brandContext = readFileSync(join(process.cwd(), '..', 'content', 'heylux', 'brand-context.md'), 'utf8');
		} catch { /* opțional */ }
		for (const w of websites) {
			const dom = normalizeDomain(w.url);
			const isActive = ['heylux.ro', 'luckystudio.ro', 'preziosa.ro'].includes(dom);
			if (!isActive) continue;
			const existing = await db.select({ id: table.websiteContentProfile.id })
				.from(table.websiteContentProfile)
				.where(eq(table.websiteContentProfile.websiteId, w.id)).limit(1);
			if (existing.length) continue;
			await db.insert(table.websiteContentProfile).values({
				id: generateId(),
				tenantId,
				websiteId: w.id,
				language: 'ro',
				extraNotes: dom === 'heylux.ro' ? brandContext : null,
				createdAt: now,
				updatedAt: now
			});
			profilesCreated++;
		}

		return json({ ok: true, assigned, wpLinked, wpClientSet, profilesCreated, websites: websites.length, articles: articles.length });
	} catch (e) {
		console.error('[backfill-content-websites]', serializeError(e));
		throw error(500, 'Backfill eșuat: ' + serializeError(e));
	}
};
```

- [ ] **Step 2: Type-check endpoint**

Run: `cd app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error 2>&1 | grep -i 'backfill-content' || echo "fără erori pe endpoint"`
Expected: `fără erori pe endpoint`.

- [ ] **Step 3: Commit**
```bash
cd /Users/augustin598/Projects/CRM
git add "app/src/routes/[tenant]/api/_debug-backfill-content-websites/+server.ts"
git commit -m "feat(content): endpoint backfill website/WP/profile"
```

---

## Task 7: Endpoint import local `raw`/`rewritten` → DB

**Files:**
- Create: `src/routes/[tenant]/api/_debug-import-content/+server.ts`

Match pe `id`, `UPDATE` (toate există în DB): rewritten → `generated_*` + `origin='rewrite'` + `rewrite_status='ready'`; raw fără rewrite → doar confirmă (no-op pe generated).

- [ ] **Step 1: Scrie endpoint-ul**

`src/routes/[tenant]/api/_debug-import-content/+server.ts`:
```ts
import { json, error } from '@sveltejs/kit';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { serializeError } from '$lib/server/logger';
import { renderMarkdown } from '$lib/utils/markdown';
import { parseFrontmatter } from '$lib/server/content/frontmatter';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	const role = locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: admin access required');
	const tenantId = locals.tenant.id;
	const now = new Date();

	const dir = join(process.cwd(), '..', 'content', 'heylux', 'rewritten');
	if (!existsSync(dir)) throw error(400, 'Lipsă content/heylux/rewritten');

	try {
		const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
		let updated = 0, notFound = 0;
		const missing: string[] = [];
		for (const f of files) {
			const md = readFileSync(join(dir, f), 'utf8');
			const { data, body } = parseFrontmatter(md);
			if (!data.id) continue;
			const html = renderMarkdown(body.trim());
			const res = await db.update(table.contentArticle)
				.set({
					generatedTitle: data.rewrittenTitle ?? null,
					generatedExcerpt: data.rewrittenExcerpt ?? null,
					generatedHtml: html,
					origin: 'rewrite',
					rewriteStatus: 'ready',
					generatedAt: now,
					updatedAt: now
				})
				.where(and(eq(table.contentArticle.id, data.id), eq(table.contentArticle.tenantId, tenantId)))
				.returning({ id: table.contentArticle.id });
			if (res.length) updated++;
			else { notFound++; missing.push(data.id); }
		}
		return json({ ok: true, files: files.length, updated, notFound, missing: missing.slice(0, 10) });
	} catch (e) {
		console.error('[import-content]', serializeError(e));
		throw error(500, 'Import eșuat: ' + serializeError(e));
	}
};
```

- [ ] **Step 2: Type-check**

Run: `cd app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error 2>&1 | grep -i 'import-content' || echo "fără erori pe endpoint"`
Expected: `fără erori pe endpoint`.

- [ ] **Step 3: Commit**
```bash
cd /Users/augustin598/Projects/CRM
git add "app/src/routes/[tenant]/api/_debug-import-content/+server.ts"
git commit -m "feat(content): endpoint import local raw/rewritten -> DB"
```

---

## Task 8: Rulează backfill + import pe Turso și verifică

**Files:** niciunul (operare). Necesită dev server pornit din `main` (preview local citește din main — vezi memory „Local preview needs main"). Alternativ, rulează endpoint-urile cu server dev pe branch.

- [ ] **Step 1: Pornește dev server** (dacă nu rulează)

Run: `cd app && bun run dev` (fundal). Autentifică-te ca owner (office@onetopsolution.ro / sghp910o, tenant ots).

- [ ] **Step 2: Rulează backfill-ul**

Run:
```bash
curl -s -X POST http://localhost:5173/ots/api/_debug-backfill-content-websites -H "Cookie: $COOKIE" | python3 -m json.tool
```
(`$COOKIE` = sesiunea autentificată; sau apelează din browser DevTools fetch cu credențiale.)
Expected (aprox): `assigned: 285` (171 heylux + 72 lucky + 42 preziosa), `wpLinked: 3`, `wpClientSet: 3`, `profilesCreated: 3`.

- [ ] **Step 3: Rulează import-ul local**

Run:
```bash
curl -s -X POST http://localhost:5173/ots/api/_debug-import-content -H "Cookie: $COOKIE" | python3 -m json.tool
```
Expected: `files: 113, updated: 113, notFound: 0`.

- [ ] **Step 4: Verifică pe Turso**

Run:
```bash
cd app && bun -e "
const {createClient}=require('@libsql/client');
const db=createClient({url:process.env.SQLITE_URI,authToken:process.env.SQLITE_AUTH_TOKEN});
(async()=>{
 const perSite=await db.execute(\"SELECT website_id, count(*) n, sum(case when rewrite_status='ready' then 1 else 0 end) ready FROM content_article WHERE website_id IS NOT NULL GROUP BY website_id\");
 console.table(perSite.rows);
 const nullw=await db.execute('SELECT count(*) n FROM content_article WHERE website_id IS NULL');
 console.log('websiteId NULL (excluse):', nullw.rows[0].n);
 const wp=await db.execute('SELECT count(*) n FROM client_website WHERE wp_site_id IS NOT NULL');
 console.log('clientWebsite cu wpSiteId:', wp.rows[0].n);
 const prof=await db.execute('SELECT count(*) n FROM website_content_profile');
 console.log('profiluri:', prof.rows[0].n);
})();"
```
Expected: 3 website-uri cu articole (heylux ~171 / 113 ready, lucky 72 / 0 ready, preziosa 42 / 0 ready), `websiteId NULL: 41` (15 forumvideochat + 2 vivadiva + 24 unknown), `wpSiteId: 3`, `profiluri: 3`.

- [ ] **Step 5: Commit** (dacă e nevoie de fix-uri de date sau note)
```bash
cd /Users/augustin598/Projects/CRM
git commit --allow-empty -m "chore(content): F0 backfill + import rulate și verificate pe Turso"
```

---

## Self-Review (acoperire spec)

- §5.1 coloane content_article → Task 1, 3 ✓ (F0 subset: websiteId/clientId/origin/generated_*; brief/generation_error/model_used/publish_status/needs_review/article_direction amânate la F2/F3 — YAGNI)
- §5.2 clientWebsite.wpSiteId → Task 2, 3 ✓
- §5.3 website_content_profile → Task 2, 3 ✓
- §5.4 backfill (3 brand-uri, wpSiteId, wordpressSite.clientId, seed profil) → Task 6, 8 ✓
- §5.5 import local (rewritten → generated_*, marked→HTML, ready) → Task 4, 7, 8 ✓
- Verificare Turso PRAGMA + counts → Task 2, 8 ✓
- Testare (frontmatter, resolver) → Task 4, 5 ✓

**Notă amânări (documentate):** coloanele `brief`, `article_direction`, `generation_error`, `model_used`, `publish_status`, `needs_review` se adaugă în F2/F3 când apar consumatorii lor (generare/publicare). F0 livrează exact pivotul + importul.
