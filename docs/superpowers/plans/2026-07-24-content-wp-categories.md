# Categorii WordPress vizibile în modulul Content (/ots/content)

## Scop
Articolele publicate/programate pe WP să-și arate categoriile în CRM (lista de articole +
editor). Conectorul OTS devine sursa: expune categoriile, iar CRM le persistă local.

## Straturi
1. **Plugin `ots-wp-connector/ots-connector.php`** (v0.6.8 → v0.7.0):
   - `ots_connector_shape_post`: + `categories: [{id, name, slug}]` (get_the_category).
   - `ots_connector_build_post_args`/create/update: acceptă `categoryIds: int[]` → `post_category`
     (viitor: setare categorie din CRM prin conector, fără App Password).
   - Rută nouă `GET /categories`: toate categoriile (id, name, slug, count), hide_empty=false.
2. **`WpClient`** (client.ts): `WpPost.categories?`, `WpPostPayload.categoryIds?`,
   `WpCategory` + `listCategories()`.
3. **DB**: migrare 0434 hand-authored, UN singur statement:
   `ALTER TABLE content_article ADD COLUMN wp_categories text;` (JSON [{id,name,slug}]).
   Ordine STRICTĂ (memorie schema-select-all-hazard): migrare → db:migrate → PRAGMA verify pe
   Turso → abia apoi coloana în schema.ts.
4. **Remote** (content-articles.remote.ts): `wpCategories` în getWebsiteArticles +
   getContentArticle; comandă nouă `refreshWebsiteWpCategories(websiteId)` — listPosts prin
   conector, mapează wp_post_id → categories, update local.
5. **Publisher**: după createPost salvează categoriile din răspuns în `wp_categories`.
6. **UI** `[websiteId]/+page.svelte`: coloană „Categorii" (badge-uri) + buton refresh;
   editorul arată categoriile ca etichete read-only.
7. **Backfill heylux (acum, fără deploy plugin)**: cele 12 postări au categorii deja pe WP;
   REST public `/wp-json/wp/v2/posts?include=…&_fields=id,categories` + `/categories` →
   script scratchpad scrie `wp_categories` pt cele 12.
8. **Release plugin**: bump versiune + zip prin fluxul connector-release (MinIO + latest.json);
   site-urile îl preiau la update. Până la update-ul pluginului pe heylux.ro, refresh-ul din
   UI va întoarce categorii goale (răspunsul conectorului vechi nu are câmpul) — tolerat.

## Verificare
bun test (content + wordpress), svelte-autofixer pe pagină, svelte-check, PRAGMA pe Turso,
backfill rulat + categorii vizibile în UI la heylux.
