# Modul PageSpeed Insights (SEO Links → PageSpeed)

Monitorizare săptămânală a performanței site-urilor prin Google PageSpeed Insights API v5
(Lighthouse + CrUX), cu scanare manuală din UI și raport pe email.

## Arhitectură

- **Client API**: `src/lib/server/pagespeed/client.ts` — `fetchPagespeed(url, strategy)`.
  Timeout 60 s, retry ×2 cu backoff exponențial + jitter (doar erori tranzitorii: rețea,
  429, 5xx). Cheia din env `PSI_API_KEY` (doar server; fără cheie funcționează cu cota
  anonimă Google, foarte mică — doar pentru dev).
- **Scanare**: `src/lib/server/pagespeed/scan.ts` — secvențial, max ~1 cerere/secundă
  (cota PSI). Progresul în Redis `{tenantId}:pagespeed:scan` (vizibil de pe orice
  instanță); dublă lansare = no-op. O eroare pe un site NU oprește restul cozii —
  se scrie un rând `status='failed'` cu `error_message`.
- **Scanare manuală**: remote `startPagespeedScan(siteIds?)` → job BullMQ one-shot
  `pagespeed_scan`; UI-ul face polling `getPagespeedScanStatus` la 2,5 s DOAR cât e
  scanarea activă.
- **Job săptămânal**: `scheduler/tasks/pagespeed-weekly-report.ts`, cron ORAR
  (`0 * * * *` Europe/Bucharest). Compară ziua/ora din `pagespeed_settings` per tenant
  cu calendarul Bucureștiului; idempotent prin unique `(tenant_id, week_key)` pe
  `pagespeed_report`. Log în `debug_log` (sursa `scheduler`, Admin→Logs).
- **Email**: `sendPagespeedReportEmail` (email.ts, tip `pagespeed-report`, în
  `EMAIL_SEND_REGISTRY` — re-trimitere din admin). HTML prin `renderBrandedEmail` +
  corp din `pagespeed/report-html.ts` (pur). Subiect: `Raport PageSpeed — S<nn> (<interval>)`.
  Evidențiere: scoruri < 50 și scăderi ≥ prag pe fundal roșu. Opțional PDF
  (`pagespeed/report-pdf.ts`, pdfkit + DejaVu) și trimitere către emailul clientului.
  Preview local: `bun run scripts/demo-pagespeed-report-email.ts`.

## Model de date (migrări 0497–0504)

- `pagespeed_site` — tenant, client opțional, `pages` JSON (prima pagină = cea măsurată),
  `strategies` JSON (mobile/desktop), `alert_threshold`, `active`.
- `pagespeed_measurement` — per site+strategie: scoruri (performance/accessibility/
  best_practices/seo, 0–100), metrici laborator în ms (`lcp_ms`, `tbt_ms`, `fcp_ms`,
  `speed_index_ms`, `inp_ms`, `ttfb_ms`) + `cls` real, CrUX p75 (`field_*`),
  `opportunities` JSON (top 6), `status` ok/failed + `error_message`, `week_key` ISO.
- `pagespeed_settings` — 1/tenant: zi (1=Luni…7), oră, strategii, destinatari,
  prag alertă, toggles (only_on_drop, include_opportunities, attach_pdf, send_to_client).
- `pagespeed_report` — istoricul rulărilor: agregate + status sent/partial/skipped/failed
  + unique (tenant, săptămână).

**Trendul** din tabel = diferența față de măsurătoarea anterioară `ok`, același site +
aceeași strategie. Pragurile de culoare: verde ≥ 90, portocaliu 50–89, roșu < 50
(`$lib/logic/pagespeed.ts` — praguri, formatare ro, săptămâni ISO; modul pur, testat).

## UI

`src/routes/[tenant]/seo-links/pagespeed` (ssr=false) → `$lib/components/pagespeed/*`.
Port 1:1 din design-ul Claude (referință: `docs/superpowers/plans/2026-08-31-pagespeed-design/`).
CSS scopat pe `.cl-wrap` cu dark mode (`.dark .cl-wrap`), model `interviuri.css`.
Remote functions în `$lib/remotes/pagespeed.remote.ts` (toate cu `requireStaff` +
scoping strict pe tenant; deviație documentată față de REST-ul din spec).

## Operațional

- Env: `PSI_API_KEY` (+ `.env.example`). Fără cheie → cota anonimă (429 rapid).
- Debug: `GET /[tenant]/api/_debug-pagespeed-health` (admin) — prezența cheii (nu
  valoarea), nr. site-uri, ultima măsurătoare, scan activ; `?probe=1` = apel PSI real.
- Cotă: 25.000 interogări/zi cu cheie; scanarea e limitată la ~1 req/s.
