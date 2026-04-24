# OTS Connector Changelog

All notable changes to the OTS Connector WordPress plugin are tracked
here. Every release bumps the `Version:` header in `ots-connector.php`
and the `OTS_CONNECTOR_VERSION` constant, then gets published to MinIO
with `bun run connector:release` from the CRM repo.

The CRM auto-updates sites to the latest release daily at 04:30 EEST
and exposes a manual "Update connector" button per site.

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
