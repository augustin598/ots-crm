# Predare — WordPress: backup/restore pe pași, update-uri, bibliotecă (25 sep 2026)

Pentru sesiunea următoare: **audit de flow + debug** pe modulul WordPress din CRM
(`/ots/wordpress`). Totul de mai jos e comis, împins în `main` și deployat pe prod.

## Starea acum

| Ce | Stare |
|---|---|
| Cod | `main` = `feat/hour-credits-f1-hourly-rates` = `c60409f4`, împins |
| Prod | deploy `#f0acf26c` (conține tot până la `c60409f4`); verifică `https://clients.onetopsolution.ro/_app/version.json` ≠ `1790364441134` |
| OTS Connector | **0.8.3** publicat în MinIO (`ots-connector/latest-v2.json`) și instalat pe **8/9** site-uri |
| Wow Agency | rămas pe 0.7.0, status `disconnected` — vezi „Probleme deschise" |
| Teste | `bun run test` → toate trec (≈2800) |

Commit-urile sesiunii (cele mai noi primele):
`c60409f4` up-to-date verificat după versiune (0.8.3) · `d953e9ca` modale + eșecuri clare (0.8.2) ·
`cf478933` ZIP-uri cu fișiere în plus · `21295fc7` fix implode (0.8.1) + progres general ·
`7b0b4ea4` bară de progres backup/restore · `5d7b4de9` backup/restore pe pași (0.8.0) ·
`ca056e18` bibliotecă plugin-uri + ștergere site + status real.

## Ce s-a construit

### Backup / restore pe pași (conector ≥ 0.8.0)
- Cauza eșecurilor vechi: proxy-ul hostingului taie cererile lungi (500/503 după 30 s–2 min)
  sau le **retrimite** → 401 (fereastra HMAC de 60 s) și backup dublu în paralel.
- Conector: `POST /backup/start|step`, `POST /restore/start|step`, ~10 s de lucru per apel,
  cursor pe disc în `uploads/ots-backups/ots-backup-<ts>-<rand8>/`, lock `busy`.
  DB în `database-NNN.sql.gz`, fișiere în `files-NNN.zip`, fișiere > 64 MB în `large-NNNN.bin`
  (bucăți de 5 MB), `manifest.json` cu numărul de rânduri per tabelă.
- Restore: import în tabele `otsr_*`, **verificare rânduri per tabelă** față de manifest, abia
  apoi `RENAME TABLE` atomic; secretul și activarea conectorului supraviețuiesc; folderul
  conectorului nu e suprascris; FK-urile (WooCommerce) re-țintite.
- CRM: `$lib/server/wordpress/backup-jobs.ts` (gate ≥ 0.8.0, `driveSteps` ≤ 20 s per cerere),
  `backup-runner.ts`, endpoint-uri `backups/[id]/step` și `backups/[id]/restore/step`
  (atenție: `.gitignore` are `backups/` → fișierele din acest folder se adaugă cu `git add -f`),
  helper browser `$lib/logic/wordpress-backup-run.ts`, banner `WpJobProgress.svelte`.
- Validat live: stropuva 1,36 GB / 47.779 fișiere în 35 s; heylux 3,09 GB / 52.204 fișiere în
  5 min, din prod. **Restore testat doar în Docker** (niciodată pe un site de client).

### Update-uri
- Pagina `/wordpress/[siteId]/plugins`: bife + „Actualizează selectate", buton „(bibliotecă)",
  panou cu plan (bază → PRO, `buildBulkSitePlan`), progres general („Pasul 4/13"), rezultat cu
  listă explicită a eșecurilor + explicație (`stepErrorHint`).
- Rularea pașilor e comună cu Biblioteca: `$lib/logic/wordpress-plugin-run.ts`.
- `normalizePluginZip` (plugin-zip.ts): reîmpachetează ZIP-uri cu wrapper sau fișiere în plus la
  rădăcină (PCF 5.9.2 avea `woocommerce-pip.zip` → „No valid plugins were found").

### Lista de site-uri
- Buton de ștergere site (dezleagă `client_website.wp_site_id` și `content_article.target_wp_site_id`).
- Verificare live `/health` la deschiderea paginii; „Nu răspunde" / motivul pentru Deconectat.
- Cardul Updates numără și update-urile din bibliotecă.

## Probleme deschise (prioritate)

1. **Golire cache după update-uri — cerut de user, NEFĂCUT.** Site-urile au:
   LiteSpeed Cache activ pe centrale-seminee, centrale-pellet, heylux, luckystudio;
   Perfmatters pe heylux, luckystudio; LiteSpeed inactiv pe stropuva, liepsnele.
   Propunere: rută în conector `POST /cache/purge` apelată după fiecare lot de update-uri
   (și după restore), care detectează și golește: LiteSpeed (`do_action('litespeed_purge_all')`),
   WP Rocket (`rocket_clean_domain()`), W3TC (`w3tc_flush_all()`), WP Super Cache
   (`wp_cache_clear_cache()`), WP Fastest Cache (`do_action('wpfc_clear_all_cache')`),
   SG Optimizer, Breeze, Autoptimize, object cache (`wp_cache_flush()`), OPcache.
   Rezultatul (ce s-a golit) afișat în panoul de update.
2. **centrale-pellet.ro:** Customer Reviews (5.116.0), Permalink Manager (1.0.8.4), WPForms
   Lite (2.0.0.2) au rămas pe versiunea veche — WordPress a zis „is at the latest version".
   Cu 0.8.3 (cache reîmprospătat înainte de upgrade) de reîncercat și de confirmat.
   De înțeles de ce cache-ul nu avea intrarea: eșecurile veneau de obicei imediat după un
   upgrade reușit (WP golește `update_plugins` după fiecare upgrade).
3. **Wow Agency (wow-agency.ro):** Cloudflare întoarce 403 doar pentru IP-ul serverului CRM de
   prod; aceeași cerere semnată de pe IP local → 200. Fix: regulă WAF „Skip" pentru
   `/wp-json/ots-connector/` în Cloudflare-ul site-ului (cererile sunt semnate HMAC).
4. **Preziosa, Heyluxsuceava:** `GET /plugins` a dat eroare din prod la sfârșitul sesiunii —
   de investigat (timeout? `/_debug-wordpress-probe?siteId=…`).
5. **Astra Pro:** ZIP-ul din `~/Downloads/Plugins/astra-pro-addon-4.13.10.zip` e trunchiat
   (1.668.645 octeți, fără directorul central) — identic la două descărcări. Pe site-uri
   update-ul WordPress dă „Download failed. Forbidden" (licență inactivă).
6. **Retenție backup-uri:** fiecare backup ocupă GB pe hostingul clientului (heylux +3 GB,
   stropuva +1,4 GB). Nu există politică de retenție.
7. **Dev server local:** `bun run build` / `svelte-check` rulează `svelte-kit sync` și strică
   dev serverele pornite (500 ENOENT `.svelte-kit/types/...$types.d.ts`). Reparare:
   `npx svelte-kit sync && touch vite.config.ts`; `bun run dev --force` poate rămâne agățat →
   Ctrl+C și repornire.

## Idei pentru auditul de flow

- Flow complet „update site": plan → backup (opțional) → pași → golire cache → reîncărcare listă.
  Ce se întâmplă la tab închis în mijloc (backup: butonul „Continuă"; update-uri: nimic).
- „Up to date" fals și cache-ul de update-uri al WordPress (punctul 2).
- Biblioteca: compararea folosește `?light=1` (cache WP) — poate rămâne în urmă față de
  lista proaspătă; planificatorul preferă deja versiunea WP mai nouă.
- Restore pe un site real mic (de ales cu userul) — singura bucată netestată live.
- Mesaje de eroare: `library-install` taie `bodySnippet` la 300 de caractere (a ascuns fatal-ul
  din 0.8.0); `/plugins/install` direct nu scrie job în `wordpress_update_job`.

## Unelte de debug folosite

- **WordPress local în Docker** (mariadb:11 + wordpress:php8.2-apache + wordpress:cli), cu
  conectorul montat din `ots-wp-connector/`:
  ```yaml
  services:
    db: { image: mariadb:11, environment: { MARIADB_ROOT_PASSWORD: root, MARIADB_DATABASE: wp, MARIADB_USER: wp, MARIADB_PASSWORD: wp } }
    wp:
      image: wordpress:php8.2-apache
      ports: ["8089:80"]
      environment: { WORDPRESS_DB_HOST: db, WORDPRESS_DB_USER: wp, WORDPRESS_DB_PASSWORD: wp, WORDPRESS_DB_NAME: wp }
      volumes: [wpdata:/var/www/html, ./ots-wp-connector:/var/www/html/wp-content/plugins/ots-connector]
    cli: { image: wordpress:cli-php8.2, user: "33:33", entrypoint: [sleep, infinity], volumes: [wpdata:/var/www/html, ./ots-wp-connector:/var/www/html/wp-content/plugins/ots-connector], environment: { WORDPRESS_DB_HOST: db, WORDPRESS_DB_USER: wp, WORDPRESS_DB_PASSWORD: wp, WORDPRESS_DB_NAME: wp } }
  volumes: { wpdata: {} }
  ```
  Apoi `wp core install`, `wp plugin activate ots-connector`, `wp option update ots_connector_secret <64 hex>`.
  „Hosting lent": mu-plugin cu `add_filter('query', fn($q) => (usleep(20000) ?: $q))` pe rutele conectorului.
- **Cerere semnată către un site real de pe IP-ul local:** copie a
  `src/lib/server/plugins/smartbill/crypto.ts` cu `$env/dynamic/private` → `process.env`,
  `decrypt(tenant_id, secret_key)` din `wordpress_site`, apoi HMAC
  `"${ts}\n${METHOD}\n/wp-json/ots-connector/v1/<ruta>\n${body}"`. Rulare cu `bun --env-file=.env`.
- Eroarea completă a unui fatal WordPress: răspunsul JSON are `data.error.file` și `line`.
- Diagnostic upgrader: mu-plugin pe `upgrader_source_selection` care loghează `scandir($source)`.
- Publicare conector: `cd app && bun run connector:build && bun --bun scripts/publish-connector.ts "" "<note>"`,
  apoi `POST /ots/api/wordpress/connector-bulk-update` (sau butonul „Update connector").
- Deploy: `bun run build` local → `hosted deploy --env production` din rădăcina repo →
  așteaptă schimbarea `/_app/version.json`.
