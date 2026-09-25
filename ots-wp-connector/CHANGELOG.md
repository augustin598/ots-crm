# OTS Connector Changelog

All notable changes to the OTS Connector WordPress plugin are tracked
here. Every release bumps the `Version:` header in `ots-connector.php`
and the `OTS_CONNECTOR_VERSION` constant, then gets published to MinIO
with `bun run connector:release` from the CRM repo.

The CRM auto-updates sites to the latest release daily at 04:30 EEST
and exposes a manual "Update connector" button per site.

## 0.8.1 — 2026-09-25

- Fix: când WordPress refuza instalarea unui plugin (`/plugins/install`) sau
  un update (`/updates/apply`), conectorul făcea `implode()` pe mesajul de
  eroare al skin-ului, care e deja un string → TypeError pe PHP 8 și HTTP 500
  „eroare critică", iar motivul real se pierdea (Product Catalog Feed Pro pe
  stropuva-romania.ro). Acum mesajul WordPress ajunge în CRM.

## 0.8.0 — 2026-09-25

Backup și restore pe pași. Backup-ul dintr-o singură cerere pica pe toate
site-urile reale: proxy-ul hostingului taie cererea după 30 s – 2 min
(HTTP 500/503) sau o retrimite, iar retrimiterea pică fereastra HMAC de
60 s (HTTP 401). Același principiu ca All-in-One WP Migration (pași de
~10 s, stare pe disc), fără cererile loopback ale acestuia.

- `POST /backup/start` creează job-ul `uploads/ots-backups/ots-backup-<ts>-<rand8>/`
  (sau îl întoarce pe cel rămas în curs, `resumed: true`); `POST /backup/step`
  `{ backup, budgetSec }` avansează ~10 s și salvează cursorul după fiecare
  felie. Baza de date: `database-NNN.sql.gz`, un statement pe linie, doar
  tabelele de bază cu prefixul site-ului (fără VIEW-uri), paginare pe cheia
  primară. Fișierele: `files-NNN.zip` (media stocată, restul deflate),
  fișierele > 64 MB copiate brut în bucăți de 5 MB (`large-NNNN.bin`).
  Excluse: cache, upgrade, ots-backups, arhivele altor pluginuri de backup
  (ai1wm-backups, updraft, duplicator, wpvivid). `manifest.json` la final,
  cu numărul de rânduri per tabelă.
- `POST /restore/start` + `POST /restore/step`: baza se importă în tabele
  `otsr_*`; înainte de swap se verifică numărul de rânduri al fiecărei
  tabele față de manifest (altfel nimic nu se schimbă și tabelele temporare
  se șterg), apoi un singur `RENAME TABLE` atomic. Secretul conectorului și
  activarea lui supraviețuiesc swap-ului, iar folderul lui nu e suprascris
  cu copia mai veche din backup. Cheile străine (WooCommerce) sunt redenumite
  și re-țintite pe tabelele temporare.
- Lock exclusiv per job: un pas retrimis de proxy în timp ce primul rulează
  primește `busy: true` în loc să ruleze în paralel.
- Numele de backup nou are un sufix aleator și directorul refuză accesul web
  (vechile `ots-backup-<ts>.zip` erau ghicibile după timestamp).
- `DELETE /backup` șterge și directoarele de backup pe pași.
- Job-urile abandonate (fără manifest, neatinse de 6 h) și fișierele
  `db-*.sql` rămase de la backup-urile vechi întrerupte se curăță la start.
- `POST /backup` și `POST /restore` (o singură cerere) rămân pentru CRM-urile
  vechi și pentru backup-urile `.zip` existente.

## 0.7.1 — 2026-09-25

- `GET /plugins` acceptă `?light=1`: nu mai șterge transientul
  `update_plugins` și nu mai forțează `wp_update_plugins()` (apelul la
  api.wordpress.org). Răspunsul vine din cache-ul existent al WP; filtrele
  `site_transient_update_plugins` ale vendorilor cu licență pot totuși
  rula dacă propriul lor cache a expirat. Folosit de biblioteca de
  plugin-uri din CRM (`/wordpress/plugin-library`), care are nevoie în
  primul rând de versiunile instalate. Fără parametru comportamentul e
  neschimbat; CRM-urile mai vechi nu îl trimit.
- `GET /plugins` întoarce și `requiresPlugins` (header-ul `Requires Plugins`
  din WordPress 6.5+). CRM-ul îl folosește ca să actualizeze plugin-ul de
  bază înaintea celui PRO.
- Pagina de admin listează și rutele `/plugins` + `/plugins/install`.

## 0.7.0 — 2026-07-24

- `GET /posts` și `GET /posts/{id}` includ acum `categories`
  (`[{id, name, slug}]`) în shape-ul postării.
- Rută nouă `GET /categories` — toate categoriile site-ului
  (id, name, slug, count), inclusiv cele goale.
- `POST /posts` / `PUT /posts/{id}` acceptă opțional `categoryIds:
  int[]` → `post_category`. Câmp omis, listă goală sau integral
  invalidă = categoriile existente rămân neatinse (nu resetăm
  niciodată silențios la Uncategorized; backwards compatible cu
  CRM-urile care nu trimit câmpul). Elementele non-numerice sunt
  ignorate, nu coerce-uite.

## 0.6.8 — 2026-04-23

- HOTFIX follow-up to v0.6.7: FPM workers that handled v0.6.6 still have
  `WP_ADMIN` defined (PHP constants are process-scoped), which caused
  plugin admin hooks to fatal when fired from `load-plugins.php`. The
  empty plugin list was the visible symptom — the route ran, caught no
  error, but aborted enumeration early.
- Remove `do_action('load-plugins.php')` entirely. The remaining
  `wp_update_plugins()` + `do_action('wp_update_plugins')` are enough
  for licence-gated update plugins that hook the
  `site_transient_update_plugins` filter, and they don't touch
  admin-screen assumptions.
- Defensive try/catch \Throwable around every update-refresh call
  (`wp_update_plugins`, `get_plugin_updates`, `in_plugin_update_message-*`)
  so one misbehaving plugin can't empty the list response. Buffer state
  is reset in the catch so a failed notice doesn't leave `ob_` stacks
  unbalanced.

## 0.6.7 — 2026-04-23

- HOTFIX: remove `define('WP_ADMIN', true)` from `/plugins` endpoint.
  PHP constants are process-scoped — once defined in an FPM worker, they
  persist across unrelated subsequent requests. This caused other plugins
  on the same site to spuriously load their admin-only code paths and
  sometimes fatal, which broke the `/plugins` list response. The
  `do_action('load-plugins.php')` hook is enough on its own: license-gated
  update plugins already listen to it. Symptom: CRM's plugins page
  rendered empty on sites that had been self-updated to v0.6.6.

## 0.6.6 — 2026-04-23

- `/plugins/install`: the post-install `activate_plugin()` call is now
  routed through `ots_safe_activate_plugin()`, the same wrapper used by
  `/plugins/activate` and `/apply-updates`. Captures plugin-side output
  and fatals so a misbehaving activation hook can't corrupt the JSON
  response or return a misleading 500.
- `/plugins/install`: opcache invalidation now gated on
  `extension_loaded('Zend OPcache') && opcache.enable=1` to avoid PHP
  warnings on APC/WinCache hosts. The previous "glob the plugin dir
  and invalidate every .php" sweep is replaced by a single
  `opcache_invalidate($main_file, true)` — less collateral eviction
  for multi-file plugins the install didn't touch.
- `/plugins` list: on multisite installs, refreshes the update cache
  with `delete_transient('update_plugins')` (per-site) instead of
  `delete_site_transient` (network-wide). Prevents one list call from
  invalidating update caches for ~50+ sub-sites.
- Install response now includes `activationSubcode` and
  `activationOutput` from the safe wrapper — same shape as `/plugins/activate`.

## 0.6.5 — 2026-04-23

- `/plugins/install`: invalidates PHP opcache after writing new plugin
  files. Prefers `opcache_reset()` when available; falls back to
  per-file `opcache_invalidate()` on the newly-installed plugin's main
  PHP and sibling files. Fixes a bug where the self-update would leave
  stale `OTS_CONNECTOR_VERSION` in memory for minutes, making
  `/health` report the old version and tricking the CRM into rolling
  its DB record back.

## 0.6.4 — 2026-04-23

- `/plugins` now force-refreshes the update transient every call
  (`delete_site_transient('update_plugins')` + `wp_update_plugins()`),
  fires admin-init hooks (`load-plugins.php`, `wp_update_plugins`), and
  defines `WP_ADMIN` so license-gated vendor plugins (WP Mail SMTP Pro,
  Astra Pro, Elementor Pro, LiteSpeed add-ons) populate their update
  info even in REST context.
- Dual-source update detection: reads both `get_plugin_updates()` and
  the raw `update_plugins` transient response. Pro plugins that gate
  downloads behind a license now show up as "update available" in the
  CRM with a `transient` source flag.
- New fields on every plugin entry:
  - `updateSource`: `'get_plugin_updates' | 'transient' | 'none'`
  - `updatePackage`: ZIP download URL or `null` when license-gated
  - `updateUrl`: vendor changelog/details URL
  - `updateMessage`: vendor's "activate license" notice, captured from
    the `in_plugin_update_message-{$plugin}` hook (HTML-stripped, 500
    char cap).
- `version_compare()` guard on `updateAvailable` — stops empty-package
  transient entries from showing up as fake updates.

## 0.6.3 — 2026-04-23

- `/plugins` now returns `textDomain` and `updateUri` from each plugin's
  header. Used by the CRM's multi-weighted match algorithm in the
  upload dialog to correctly associate ZIPs with installed plugins
  across folder renames.

## 0.6.2 — 2026-04-23

- New `ots_safe_activate_plugin($slug, $network_wide)` helper:
  - Defines `WP_ADMIN = true` so plugins guarding on `is_admin()`
    behave correctly during REST-driven activation.
  - Wraps `activate_plugin()` in nested `ob_start()` + `try/catch
    \Throwable` so activation hooks that echo HTML, call
    `wp_safe_redirect()`, or fatal don't corrupt the REST response.
  - Returns a structured payload (`success`, `error`, `subcode`,
    `output_captured`) instead of throwing a 500. Subcodes:
    `activation_fatal`, `activation_redirect`, `activation_wp_error`,
    `activation_self_deactivated`.
- `/plugins/activate` and `/apply-updates` (post-upgrade reactivation)
  both use the new helper, eliminating false-positive "wp_site_down"
  errors caused by the plugin's own activation logic.
- `ots_connector_snip()` helper for sanitized + truncated output in
  JSON responses.

## 0.6.1 — 2026-04-23

- `/apply-updates`: captures plugin active state before upgrade and
  calls `activate_plugin($slug, '', $was_network_active, silent=true)`
  afterwards if the plugin was active. Previously, WordPress's
  `Plugin_Upgrader::upgrade()` deactivated plugins during upgrade and
  never re-activated them in REST context, leaving them disabled.
- New fields in the per-plugin upgrade result: `was_active`,
  `reactivated`, `reactivation_error`.

## 0.6.0 — Baseline

- Initial release tracked by this changelog. Covers `/health`,
  `/plugins` (list/activate/deactivate/delete/install),
  `/apply-updates`, `/backup`, `/backups/[id]/restore`, `/posts`,
  `/media`, HMAC-SHA256 signing of every request, admin-page secret
  management.
