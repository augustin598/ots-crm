# Bibliotecă de plugin-uri WordPress — plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Din CRM, încarcă ZIP-uri de plugin-uri în lot, compară versiunile cu fiecare site WordPress și actualizează în lot prin OTS Connector.

**Architecture:** Bibliotecă per tenant (tabel `wordpress_plugin_library` + obiecte MinIO), comparare în CRM pe baza listei de plugin-uri de la conector (`GET /plugins`), instalare prin `POST /plugins/install` (suprascriere). Logica pură (parsare header, matching, comparare, decizie upsert) stă în module fără dependențe și e testată cu `bun run test`.

**Tech Stack:** SvelteKit 5 (runes), Bun, Drizzle/libSQL (Turso), MinIO (`minio`), JSZip, shadcn-svelte (Card/Table/Dialog/Badge/Checkbox), svelte-sonner.

Spec: `docs/superpowers/specs/2026-09-25-wordpress-plugin-library-design.md`.

---

## Fișiere

- Create `app/src/lib/server/wordpress/plugin-match.ts` — `compareWpVersions`, `scoreCandidate`, `pickMatch` + tipuri.
- Create `app/src/lib/server/wordpress/plugin-zip.ts` — `parsePluginHeader`, `inspectPluginZip`, `PluginZipError`, `PluginZipInfo`.
- Create `app/src/lib/server/wordpress/plugin-library-compare.ts` — `compareLibraryWithInstalled`, `decideLibraryUpsert`.
- Create `app/src/lib/server/wordpress/plugin-library.ts` — DB + MinIO.
- Modify `app/src/routes/[tenant]/api/wordpress/sites/[siteId]/plugins/inspect/+server.ts` — importă din modulele noi (fără schimbare de comportament).
- Modify `app/src/lib/server/db/schema.ts` — tabel `wordpressPluginLibrary`.
- Create `app/drizzle/0566_wordpress_plugin_library.sql`, `app/drizzle/0567_wordpress_plugin_library_tenant_slug_uidx.sql` + intrări în `_journal.json`.
- Create `app/src/routes/[tenant]/api/wordpress/plugin-library/+server.ts` (GET, POST), `.../plugin-library/[id]/+server.ts` (DELETE).
- Create `app/src/routes/[tenant]/api/wordpress/sites/[siteId]/plugins/library-compare/+server.ts` (GET), `.../library-install/+server.ts` (POST).
- Modify `app/src/lib/server/wordpress/client.ts` — `listPlugins({ light })`.
- Modify `ots-wp-connector/ots-connector.php` (param `light`, versiune 0.7.1), `CHANGELOG.md`, `README.md`.
- Create `app/src/routes/[tenant]/wordpress/plugin-library/+page.svelte`, `+page.ts`.
- Modify `app/src/routes/[tenant]/wordpress/+page.svelte` — buton către bibliotecă.
- Tests: `app/src/lib/server/wordpress/__tests__/plugin-match.test.ts`, `plugin-zip.test.ts`, `plugin-library-compare.test.ts`, `plugin-library.test.ts`.

---

### Task 1: plugin-match.ts (versiuni + matching)

- [ ] Scrie `__tests__/plugin-match.test.ts`: `compareWpVersions` ('1.0'<'1.0.1', '3.20.1'<'3.21', '1.0-beta'<'1.0', '1.0-rc1'<'1.0-rc2', egal=0); `scoreCandidate` (text domain 100, slug 85, name+author 75, fuzzy <60 fără alte semnale, 0 fără semnale, bonus +5 la semnale multiple); `pickMatch` (winner ≥85; ambiguu când top<85 și #2 la <10 pct; null sub 60).
- [ ] `bun run test plugin-match` → FAIL (modul inexistent).
- [ ] Creează `plugin-match.ts` mutând funcțiile din `plugins/inspect/+server.ts` (identic ca logică).
- [ ] `bun run test plugin-match` → PASS.

### Task 2: plugin-zip.ts (inspecție ZIP)

- [ ] Scrie `__tests__/plugin-zip.test.ts` cu fixture-uri JSZip: layout standard, wrapper (`download/astra-pro/astra-pro.php` → slug `astra-pro`, `pluginFile` `astra-pro/astra-pro.php`), header cu `*` și CRLF, fără fișier de plugin → `PluginZipError('no_plugin_file')`, fără Version → `no_version`, bytes invalizi → `invalid_zip`.
- [ ] FAIL, apoi implementează `plugin-zip.ts` (mută `parseHeader`, `findPluginFile`, `snip`); PASS.
- [ ] Refactor `plugins/inspect/+server.ts` să importe din `plugin-zip.ts` + `plugin-match.ts`; păstrează mesajele RO existente per cod de eroare.

### Task 3: plugin-library-compare.ts

- [ ] Scrie `__tests__/plugin-library-compare.test.ts`: update_available / up_to_date / downgrade / not_installed / ambiguous; `active` propagat; conflict (două rânduri din bibliotecă → același plugin instalat: scorul mai mare câștigă, celălalt devine `ambiguous`); ordonare (update_available, downgrade, ambiguous, up_to_date, not_installed, apoi nume); `decideLibraryUpsert` (null→added/none; newer→replaced/newer; same→replaced/same; older→rejected_older/older; older+force→replaced/older).
- [ ] FAIL → implementează → PASS.

### Task 4: schema + migrări

- [ ] Adaugă `wordpressPluginLibrary` în `schema.ts` (după `wordpressPostRelations`), cu `uniqueIndex('wordpress_plugin_library_tenant_slug_uidx').on(t.tenantId, t.slug)`.
- [ ] Scrie `0566_wordpress_plugin_library.sql` (CREATE TABLE, fără IF NOT EXISTS) și `0567_wordpress_plugin_library_tenant_slug_uidx.sql` (CREATE UNIQUE INDEX).
- [ ] Adaugă în `_journal.json` intrările idx 566/567 cu `when` 1788786476916026 / 1788786476917026 (peste max remote 1788786476915026).
- [ ] `cd app && bun run db:migrate`; verifică `PRAGMA table_info(wordpress_plugin_library)` și `PRAGMA index_list` pe remote.

### Task 5: plugin-library.ts (DB + MinIO)

- [ ] Scrie `__tests__/plugin-library.test.ts` cu `mock.module` pentru db/minio: `addLibraryPlugin` → `added` inserează + putObject; `replaced` face update + removeObject pe cheia veche; `rejected_older` nu scrie nimic; `fetchLibraryPluginZip` aruncă la sha mismatch.
- [ ] FAIL → implementează → PASS.

### Task 6: endpoint-uri API

- [ ] `plugin-library/+server.ts` GET/POST, `plugin-library/[id]/+server.ts` DELETE, `library-compare`, `library-install` (toate: guard locals + `requireStaff(event)`, tenant scoping, log).
- [ ] `bun run test wordpress` verde.

### Task 7: conector `light` + client

- [ ] `client.ts`: `listPlugins(opts?: { light?: boolean; ... })` → path `/plugins?light=1`.
- [ ] `ots-connector.php`: în `ots_connector_route_list_plugins`, dacă `$request->get_param('light')` e truthy sare peste delete transient + wp_update_plugins; header/const 0.7.1; CHANGELOG + README.
- [ ] `php -l ots-wp-connector/ots-connector.php` (dacă php e disponibil).

### Task 8: UI

- [ ] `+page.ts` cu `export const ssr = false;`, `+page.svelte` conform spec (stări loading/empty/error).
- [ ] Buton „Bibliotecă plugin-uri" în antetul `/[tenant]/wordpress/+page.svelte`.
- [ ] svelte-autofixer pe ambele componente; `/build-check`; design-auditor + web-design-guidelines; testermcp pe golden path (upload, verificare, update).

### Task 9: finalizare

- [ ] `bun run test` complet, commit scoped (fără `git add -A`), `graphify . --update`.
