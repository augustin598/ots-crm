# WordPress Sentinel — jurnal de securitate prin conector + pagină în CRM + rezumat Telegram

Data: 28 septembrie 2026 · Repo-uri: `CRM/app` și `CRM/ots-wp-connector`

## Context

Pe arenishaorma.ro și nevadasuceava.ro rulează din 23.09 mu-plugin-ul `ots-sentinel.php` (sursa în
`~/Wordpress/WooProducts/arenishaorma.ro/mu-plugins/`). Scrie evenimente JSON în
`wp-content/ots-sentinel/sentinel.log`, dar nu anunță pe nimeni: jurnalul se citește manual prin FTP.
Breșa din 2025 de pe areni a stat un an nedescoperită tocmai din lipsa unui semnal.

Presupunere: pe ambele site-uri rulează versiunea **1.0** (sursa de mai sus). Varianta 1.1 din
`~/Wordpress/WooProducts/ots-guard/` (upload, `upload_blocat`, `fisiere_*`, scan orar) NU se portează;
dacă evenimentele ei apar în jurnal, CRM-ul le clasifică (vezi §3), atât.

## Decizii

- Sentinel devine **modul în conectorul OTS** (0.9.0) → ajunge pe toate site-urile prin auto-update.
- **CRM-ul trage** evenimentele **o dată pe zi** (09:00 Europe/Bucharest) prin canalul semnat existent. Nicio rută nouă spre CRM, nicio configurare pe site. O alertă gravă se vede a doua zi dimineață — acceptat.
- Regulile (ce e critic/important) trăiesc **în CRM**, unde e istoricul; se schimbă fără release de plugin.
- Notificare: **un singur mesaj Telegram pe zi** pentru toate site-urile; ziua liniștită = o linie (și semn că sistemul trăiește).
- Pagină nouă **`/[tenant]/wordpress/security`**.

## Non-scop

Blocare activă (IP ban, rate-limit), integritatea fișierelor core/plugin, notificări in-app/email,
trimitere instant (push) de pe site. Se pot adăuga ulterior peste același tabel de evenimente.

## 1. Conector 0.9.0 (`ots-wp-connector`)

**Secțiune nouă în `ots-connector.php`** — conectorul e un singur fișier și `build.sh` împachetează
doar acel fișier. Clasa `OTS_Connector_Sentinel` (nume diferit de vechiul `OTS_Sentinel`). Portează hook-urile existente: `wp_insert_post` (cu contor
per request, >5 = ALERT), `user_register`, `set_user_role`, `profile_update` (email/parolă),
`deleted_user`, `wp_login`, `wp_login_failed`, `activated_plugin`, `deactivated_plugin`, `switch_theme`,
`upgrader_process_complete`, `update_option_{siteurl,home,users_can_register,default_role,admin_email}`.

Modificări față de mu-plugin:
- Fiecare linie nouă primește `id` = `bin2hex(random_bytes(6))`. Liniile vechi (fără `id`) primesc la citire `id = sha1(linia brută) . '-' . n`, unde `n` = a câta apariție a liniei identice în fișier (două eșecuri de login identice în aceeași secundă rămân două evenimente, altfel regula „≥ 3” subnumără).
- `login_esuat` adaugă `exista: bool` (`username_exists || email_exists`) — necesar pentru regula de brute-force.
- Fiecare linie nouă are și `ip_remote` = `REMOTE_ADDR` brut. `ip` (CF-Connecting-IP / X-Forwarded-For / REMOTE_ADDR) rămâne pentru continuitate, dar pe un site fără proxy oricine poate trimite `X-Forwarded-For: <IP OTS>`; regulile din CRM verifică `ip_remote` (§3).
- Rotirile se curăță: se păstrează cele mai noi 5 fișiere rotite (8 MB fiecare — hosting partajat cu cotă). Fără secret (opțiunea goală) nu se scrie nimic — altfel numele fișierului ar fi calculabil public.
- Scanarea uploads **nu mai e pe wp-cron**; rulează la cererea CRM-ului. Modulul face `wp_clear_scheduled_hook('ots_sentinel_scan')` doar când clasa `OTS_Sentinel` lipsește (cronul rămas după ștergerea mu-plugin-ului); cât timp mu-plugin-ul există, el își reprogramează hook-ul la fiecare `plugins_loaded`, deci ștergerea ar fi inutilă.
- Fiecare callback e în `try { } catch ( Throwable $e ) { }` — o eroare în Sentinel nu poate opri site-ul.
- `wp_insert_post` ignoră și `attachment` (un upload de galerie ar număra ca inserare în masă).
- Același director `wp-content/ots-sentinel/` și aceeași protecție (`.htaccess` deny, `index.php`), dar fișierul nou se numește `sentinel-<hash>.log`, `hash = substr(hash_hmac('sha256', 'sentinel-log', secret), 0, 16)` — `.htaccess` nu face nimic pe Nginx, iar numele derivat din secretul conectorului nu se poate ghici. Rotire la 8 MB în `sentinel-<hash>-<Ymd-His>.log`. Jurnalul vechi `sentinel.log` (+ rotirile lui) se citește în continuare cât există.

**Coexistență cu mu-plugin-ul vechi:** dacă la `plugins_loaded` există deja clasa `OTS_Sentinel`,
modulul NU înregistrează hook-urile (evită dublurile), dar ruta servește în continuare jurnalul și
raportează `legacyMuPlugin: true`.

**Rută nouă** `POST /ots-connector/v1/sentinel`, body JSON `{ "since": "<ISO 8601>" | null, "skip": n }`,
`permission_callback` = `ots_connector_verify_request`. POST, nu GET: query string-ul nu intră în
semnătura HMAC (vezi `client.ts request()`), body-ul da — altfel o cerere interceptată în fereastra
de 60 s se putea rejuca cu alt `since`/`skip`.

```json
{
  "sentinel": { "version": "0.9.0", "legacyMuPlugin": false, "logBytes": 29841 },
  "events": [ { "id": "a1b2c3d4e5f6", "t": "...", "sev": "WARN", "ev": "login_ok",
                "user": "-", "uid": 0, "ip": "...", "uri": "...", "ua": "...", "date": { } } ],
  "hasMore": false,
  "scan": { "files": [ { "path": "/sucuri/x.php", "size": 99, "mtime": "...", "sha1": "..." } ],
            "scannedFiles": 4210, "truncated": false, "durationMs": 840 },
  "errors": []
}
```

- Evenimente cu `t >= since`, cele mai vechi primele, din **toate** fișierele `sentinel*.log` din director cu `mtime >= since` (un val de brute-force poate roti de mai multe ori între două citiri), în ordinea numelui; maximum 5000/răspuns (`hasMore`). `skip` = câte evenimente din setul filtrat se sar — paginare stabilă și când multe evenimente au același `t` (un `since = t_ultim` ar bate pasul pe loc la un val de login-uri).
- Citirea e în doi pași: întâi chei compacte (`t|index|fișier|offset`, ~100 B/eveniment), sortare, pagină; apoi se decodează pe offset doar liniile paginii. Un jurnal decodat integral costă ~2 KB/eveniment (prima citire ≈ 170k evenimente ≈ 330 MB) — fatal pe `memory_limit` 128 MB. Liniile cu `t`/`id` care nu sunt string se sar și se raportează în `errors[]`; ruta prinde `Throwable` și răspunde 200 cu `errors[]`.
- Scanare: PHP executabil (`.php|.phtml|.php[0-9]|.phar`) în uploads, `index.php` < 40 octeți ignorat; se parcurg **toate** fișierele cu buget **15 s măsurat de la începutul cererii** (proxy-urile de hosting taie la ~30 s) → `truncated: true`; se întorc cele mai noi 200 după `mtime` + `scannedFiles` (total); fără sha1 peste 5 MB. Un shell nou e mereu printre cele mai noi; o limită pe primele 200 găsite s-ar fi păcălit cu 200 de fișiere PHP inofensive.
- Erori parțiale → în `errors[]`, răspunsul rămâne 200.
- `CHANGELOG.md` + bump `Version:` și `OTS_CONNECTOR_VERSION` (0.8.5 → 0.9.0).

## 2. CRM — date

Tabel nou `wordpress_security_event`:

| coloană | tip | note |
|---|---|---|
| id | text PK | base32 ca restul |
| tenant_id | text FK tenant | |
| site_id | text FK wordpress_site | |
| event_uid | text | `id` venit de pe site; **unique (site_id, event_uid)** → dedupe |
| occurred_at | timestamp | `t` |
| sentinel_sev | text | INFO/WARN/ALERT de pe site |
| level | text | `critical` / `important` / `normal` — calculat în CRM |
| event | text | `ev` |
| username, ip, uri, user_agent | text | |
| data | text (JSON) | `date` |
| created_at | timestamp | |

Index pe `(tenant_id, occurred_at)` și `(site_id, event, occurred_at)`.
**Retenție: 7 zile** — jobul zilnic șterge evenimentele mai vechi. Tot ce trebuie ținut minte mai
mult (IP-uri de admin, baseline uploads) stă în `sentinel_state`, nu în evenimente.

Coloane noi pe `wordpress_site`: `sentinel_last_pull_at`, `sentinel_last_pull_status`
(`ok` / `error` / `unsupported` / `legacy`), `sentinel_failures` (int, default 0),
`sentinel_state` (JSON):

```json
{
  "baselineDone": true,
  "uploadsBaseline": { "/sucuri/x.php": "sha1…" },
  "adminIps": { "admin_y7a8w2a4": { "5.6.7.8": "2026-09-28T07:12:00Z" } },
  "lastError": null
}
```

`adminIps[user][ip]` = ultima logare reușită a unui administrator de pe acel IP; intrările mai vechi
de 90 de zile se curăță la fiecare citire.

Migrări **scrise de mână** (`drizzle-kit generate` e stricat; `fix-migrations.ts` ar adăuga
`IF NOT EXISTS`, interzis): 0569–0576, un statement per fișier (tabel, 2 indexuri, unique, 4 coloane),
fără `IF NOT EXISTS`, intrări în `_journal.json` cu `when` = ultimul + 1, +2…; `grep` numele în
`drizzle/*.sql` înainte; verificare pe bază curată (`SQLITE_PATH` gol + `drizzle-kit migrate`).

## 3. CRM — citire și reguli

`WpClient.sentinel({ since, skip })` în `src/lib/server/wordpress/client.ts` (`POST /sentinel`, timeout 45 s — scanarea singură are buget 20 s).

`src/lib/server/wordpress/sentinel/`:
- `pull.ts` — `pullSite(site)`: `since = sentinel_last_pull_at − 1h` (sau fără `since` la prima citire), paginează cu `skip` cât timp `hasMore`, inserează cu ignore pe conflict, actualizează coloanele `sentinel_*`. Conector < 0.9.0 (`compareConnectorVersions` din `connector-release.ts`, ca `supportsCachePurge()`) → status `unsupported`, fără eroare. Ordinea contează: `detectFindings` primește `sentinel_state` **de dinainte** de citire (altfel orice IP e deja „cunoscut”), apoi starea se actualizează cu IP-urile și fișierele din lot.
- `rules.ts` — funcții pure `classify(event, context) → level` și `detectFindings(events, state) → { findings, nextState }`.
- `digest.ts` — construiește textul Telegram din findings; dacă depășește 4096 caractere, împarte pe linii întregi și ține liniile unui site împreună (antetul se repetă cu „(2/3)”).
- etichetele în română (evenimente, niveluri) în `src/lib/logic/wordpress-sentinel-labels.ts` — sub `logic/`, nu `server/`, ca pagina să le poată importa; le folosesc și `digest.ts`, și pagina.

**Niveluri**

- 🔴 **critical**: `role_changed` spre administrator; `user_registered` cu rol administrator; `option_changed`; `post_created` cu `nr_in_request > 20` (constantă în `rules.ts`; site-ul marchează ALERT de la 6, dar un import CSV WooCommerce sau un meniu salvat trec de 5); fișier PHP în uploads nou sau cu sha1 schimbat față de `uploadsBaseline`; `plugin_deactivated` al conectorului însuși (plugin care începe cu `ots-wp-connector/`); `php_in_uploads`, `fisiere_modificate`, `upload_blocat` venite de la mu-plugin-ul vechi; citire eșuată **2 zile la rând**.
- 🟠 **important**: `login_ok` cu rol administrator (`date.roluri` conține `administrator`) de pe un IP absent din `sentinel_state.adminIps[user]` — un singur finding per (site, user, IP) per citire. IP-urile OTS (`82.77.19.195`, `213.157.186.85`, constantă în `rules.ts`) sunt excluse doar când `ip_remote` e tot IP OTS, e privat (proxy local) sau lipsește (linie veche) — un `X-Forwarded-For` falsificat cu IP OTS de pe un `ip_remote` public străin NU e exclus; `plugin_activated` / `plugin_deactivated`; `theme_switched`; `user_registered` cu alt rol decât `customer`/`subscriber`; `profile_update` (email sau parolă) pe un administrator; **≥ 3 `login_esuat` cu `exista: true` pe același username în 24 h** (un singur finding per username, cu numărul de IP-uri distincte); prima zi de citire eșuată.

Un singur finding per (site, user id) când același user apare și în `user_registered`, și în `role_changed` în aceeași citire.
- ⚪ **normal**: restul (logări de pe IP cunoscut, comenzi, update-uri, scanare curată) și orice eveniment necunoscut.

**Baseline:** la prima citire a unui site, IP-urile de admin și fișierele PHP din uploads existente devin
cunoscute; nu se generează findings de tip „IP nou” sau „PHP nou”. Evenimentele se salvează oricum.

## 4. CRM — job zilnic și Telegram

Task `src/lib/server/scheduler/tasks/wordpress-sentinel-daily.ts`, tip `wordpress_sentinel_daily`,
repeat `0 9 * * *`, `tz: 'Europe/Bucharest'` — exact ca `wordpress-connector-auto-update`. Înregistrare în
`scheduler/index.ts`: harta de handlere, `expectedJobIds`, `schedulerQueue.add(...)` și `JOB_LABELS`
(„Sentinel WordPress”).

Pentru fiecare tenant: toate site-urile cu `paused = 0` → `pullSite` (o eroare pe un site nu le oprește
pe celelalte) → findings → un mesaj → trimis la fiecare `tenantUser` prin `sendTelegramMessage`
(modelul `notifyAdmins` din `personalops-heartbeat-monitor.ts`; utilizatorii fără Telegram legat sunt săriți).

```
🛡 Sentinel · 29 sept
🔴 nevada: PHP nou în uploads /2026/09/x.php
🟠 nevada: 3 logări eșuate pe admin_y7a8w2a4 (3 IP-uri)
🟠 areni: logare admin de pe IP nou 5.6.7.8
🟠 topderma: nu răspunde (prima zi)
✅ 14 site-uri liniștite
→ https://clients.onetopsolution.ro/<tenant>/wordpress/security
```

Ziua fără findings: `🛡 Sentinel · 29 sept — ✅ 16 site-uri liniștite`. Site-urile `unsupported` nu apar în mesaj.

**Idempotență:** cheie Redis `sentinel:digest:<tenantId>:<YYYY-MM-DD>`, TTL 36 h. `GET` înainte de
trimitere (există → sari), `SET NX EX` **după prima trimitere reușită** — dacă Telegram pică pentru
toți userii, cheia lipsește și reîncercarea jobului retrimite. Pattern-ul Bun
`redis.send('SET', [key, '1', 'NX', 'EX', ttl])` din `tasks/token-refresh.ts`.

## 5. Pagina `/[tenant]/wordpress/security`

`+page.ts` cu `ssr = false` (ca `plugin-library`; `diagnostics` n-are `+page.ts`). Datele vin prin
**remote functions** — standardul proiectului pentru pagini noi (`$derived(await query(args))`,
`<svelte:boundary>` per secțiune, `.updates(...)` pe mutații, ca `hosting/provisioning`), nu prin rute
`api/` ca restul modulului WordPress. Buton „Securitate” în header-ul `wordpress/+page.svelte`, lângă
„Bibliotecă plugin-uri” și „Diagnostics”.

- **Carduri per site**: stare (`ok` cu data ultimei citiri / nu răspunde / conector prea vechi / „șterge mu-plugin-ul vechi” când `legacy`), contoare pe 7 zile (critice, importante, logări eșuate, logări admin), buton **„Citește acum”**.
- **Tabel evenimente**: filtre site, nivel, tip, perioadă (24 h / 7 z / 30 z), căutare IP/user; coloane ora RO, site, nivel (badge), eveniment (etichetă RO), user, IP; rând expandabil cu uri, user-agent, `data`. Paginare 100/pagină.

`src/lib/remotes/wordpress-security.remote.ts` (fiecare funcție cu `requireStaff` — F8 — și scoping pe
tenantul din sesiune):
- `getSecurityOverview()` — query: carduri per site.
- `getSecurityEvents({ siteId, level, event, period, q, cursor })` — query, 100/pagină.
- `pullSiteNow({ siteId })` — command: `pullSite` pentru un site, fără Telegram; întoarce rezumatul; pagina îl apelează cu `.updates(getSecurityOverview(), getSecurityEvents(args))`.

## 6. Erori

- Site: `try/catch (Throwable)` pe fiecare callback și în rută; limite de timp și volum ca mai sus.
- CRM: eșec la citire → `sentinel_last_pull_status = 'error'`, `sentinel_failures++`, `lastError` în `sentinel_state`; succes → `sentinel_failures = 0`.
- Trimitere Telegram eșuată → logWarning per user, jobul nu cade.

## 7. Testare

- Pasul zero: **descărcarea jurnalelor** prin FTP de pe areni și nevada (nu există nicio copie locală) în `src/lib/server/wordpress/sentinel/__tests__/fixtures/`, **anonimizate** (IP-uri și username-uri înlocuite, structura păstrată).
- `bun run test` (NU `bun test` — mock-urile globale strică restul suitei) pe `rules.ts` și `digest.ts` cu fixture-urile de mai sus. Așteptat: nevada → un finding 🟠 brute-force (3 eșecuri, 3 IP-uri); fișierele Sucuri → baseline, fără finding; Jetpack/traduceri/comenzi → ⚪; areni → fără findings.
- Test pentru împărțirea mesajului la 4096 (liniile unui site rămân în același mesaj) și pentru mesajul „liniștit”.
- Recenzie Gemini 28.09 integrată: POST cu body semnat, nume de fișier derivat din secret (Nginx), toate fișierele rotite, scanare completă cu top 200 după mtime, `attachment` exclus, prag 20, împărțire pe site-uri. Respinse: `pre_update_option` (zgomot), eliminarea `exista` (vizibil doar prin ruta semnată), IP nou de admin → ⚪ (rămâne 🟠; regula e în CRM și se poate relaxa oricând).
- Test dedupe: aceeași pagină importată de două ori → aceleași rânduri.
- Conector: `php -l` pe PHP 7.4 și 8.x.

## 8. Ordine de livrare

1. Conector 0.9.0 (modul + rută), build local — **fără** publicare în MinIO.
2. CRM: schema + migrare, `getSentinel`, `pull/rules/digest`, job, API, pagină.
3. Pilot pe areni + nevada (conectate în CRM de utilizator): întâi confirmă că `wordpress-connector-auto-update` nu face **downgrade** (0.9.0 instalat manual vs 0.8.5 publicat), apoi instalare manuală 0.9.0, ștergere `mu-plugins/ots-sentinel.php`, „Citește acum”, verificare pagină, rulare manuală a jobului o dată.
4. Abia după pilot: `bun run connector:release` → auto-update-ul de la 04:30 îl duce pe toate site-urile.
