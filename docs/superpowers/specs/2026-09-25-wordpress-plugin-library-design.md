# Bibliotecă de plugin-uri WordPress (bulk update prin OTS Connector) — design

Data: 2026-09-25. Înlocuiește modulul standalone `update_module/bulk-zip-plugin-installer.php`
(plugin WP care citea ZIP-uri de pe FTP, compara versiunile local și instala).

## Problema

Plugin-urile premium (Elementor Pro, Astra Pro, WP Mail SMTP Pro etc.) nu se actualizează
prin wordpress.org. Azi operatorul urcă ZIP-ul manual, site cu site, din dialogul
„Upload plugin-uri" de pe pagina de plugin-uri a fiecărui site. Modulul PHP vechi rezolva
asta cu un folder FTP central, dar rula în interiorul fiecărui WP, cu parolă FTP în opțiuni
și fără vizibilitate din CRM.

## Decizie

Bibliotecă de ZIP-uri **în CRM** (MinIO + tabel per tenant) + comparare versiuni **în CRM**
(lista de plugin-uri vine de la conector) + instalare prin endpoint-ul existent al
conectorului `POST /plugins/install` (suprascriere, păstrează starea activ/inactiv).
Nu e nevoie de logică nouă în WordPress pentru fluxul principal.

Presupuneri (sesiune neinteractivă, decise fără confirmare):
- biblioteca e **per tenant** (licențele aparțin agenției, nu clientului);
- **o singură versiune** per slug în bibliotecă (cea mai nouă); o arhivă mai veche e respinsă
  dacă nu e forțată explicit;
- actualizarea în lot e **manuală**, din pagina nouă; fără cron (urmare posibilă);
- plugin-urile din bibliotecă **neinstalate** pe un site se afișează, dar nu se instalează
  automat (instalarea de plugin-uri noi pe site-urile clienților rămâne decizie explicită,
  din dialogul per site);
- `update_module/` rămâne în repo neatins, ca referință; devine învechit.

## Componente

### Date
Tabel nou `wordpress_plugin_library` (migrări 0566 + 0567, câte o instrucțiune per fișier):
`id, tenant_id, slug, plugin_file, name, version, description, author, text_domain,
plugin_uri, update_uri, requires_wp, requires_php, filename, size_bytes, sha256,
object_key, uploaded_by, created_at, updated_at`; index unic `(tenant_id, slug)`.

Obiecte MinIO (bucket `MINIO_BUCKET_NAME`, obligatoriu ca la release-urile conectorului):
`wordpress-plugin-library/<tenantId>/<slug>/<version>-<sha256[0:12]>.zip`. Cheia e mereu
nouă (S3Wrapper-ul navitech servește copii vechi pe chei suprascrise); obiectul vechi se
șterge best-effort după ce rândul a fost înlocuit. La instalare, ZIP-ul citit din MinIO
e verificat SHA-256 față de rând.

### Pachete „unzip first" (decis în timpul testării, 25 sep)
Vendorii livrează arhive care conțin alte ZIP-uri de plugin (Elementor Pro + Elementor,
Rank Math PRO + Rank Math, Wordfence + Activator, Admin Menu Editor Pro + add-on-uri).
Dacă arhiva urcată nu e ea însăși un plugin (`no_plugin_file`), `listNestedZips` caută
ZIP-urile din interior (adâncime ≤ 3, fără `__MACOSX`) și fiecare plugin valid devine o
intrare separată în bibliotecă; răspunsul e `{ outcome: 'package', entries: [...] }` cu
rezultat per plugin interior (added / replaced / rejected_older / error). Versiunea
standard și cea PRO ajung amândouă în bibliotecă; operatorul poate șterge ce nu vrea.

### Module server (`app/src/lib/server/wordpress/`)
- `plugin-zip.ts` — `parsePluginHeader`, `inspectPluginZip(buffer)` → `PluginZipInfo`
  (extras din endpoint-ul `plugins/inspect`, care îl importă de acum), `listNestedZips`;
  `invalid_zip` include motivul decodorului (ex. „can't find end of central directory").
- `plugin-match.ts` — `compareWpVersions`, `scoreCandidate`, `pickMatch` (extras din
  același endpoint; scorurile și pragurile rămân identice).
- `plugin-library-compare.ts` — pur: `compareLibraryWithInstalled(library, installed)` →
  stări `update_available | up_to_date | downgrade | not_installed | ambiguous`, cu
  plugin-ul instalat, versiunea, `active`, scorul; `decideLibraryUpsert(existing, incoming, force)`.
- `plugin-library.ts` — DB + MinIO: `listLibraryPlugins`, `addLibraryPlugin`,
  `addLibraryUpload` (plugin sau pachet), `fetchLibraryPluginZip`, `deleteLibraryPlugin`.
- `site-client.ts` — `loadSiteAndClient(siteId, tenantId)` comun pentru rutele noi.

### API (`[tenant]/api/wordpress/...`, toate cu `requireStaff`)
- `GET  plugin-library` — lista bibliotecii tenantului.
- `POST plugin-library` `{ filename, dataBase64, force? }` → `{ item, outcome, relation }`
  sau `{ outcome: 'package', entries }` pentru arhive „unzip first";
  409 `{ code: 'older_version', existingVersion }` când arhiva e mai veche și nu e forțată.
- `DELETE plugin-library/[id]`.
- `GET  sites/[siteId]/plugins/library-compare` → `{ site, items, checkedAt }`.
- `POST sites/[siteId]/plugins/library-install` `{ libraryPluginId, activate }` →
  `{ success, plugin, activated, fromVersion, toVersion }`; scrie rând în
  `wordpress_update_job` (audit, `source: 'library'`).

### Conector (opțional, compatibil înapoi)
`GET /plugins?light=1` sare peste reîmprospătarea transientului de update-uri
(apelul la api.wordpress.org). Comparația bibliotecii are nevoie doar de versiunile
instalate. Conectoarele vechi ignoră parametrul. Versiune 0.7.1 + CHANGELOG.
Publicarea (`bun run connector:release`) rămâne decizia userului.

### UI — pagină nouă `/[tenant]/wordpress/plugin-library`
1. Antet: înapoi, titlu, „Upload ZIP-uri", „Verifică site-urile".
2. Card „Bibliotecă": tabel (nume+slug, versiune, autor, mărime, încărcat, ștergere); dialog
   de upload cu coadă per fișier (inspectat de server; „mai vechi" → bifă Forțează).
3. Card „Site-uri": rând per site (stare verificare, câte update-uri, chips `Nume a → b`,
   buton „Actualizează (n)"), detalii expandabile cu toate plugin-urile din bibliotecă și
   bifă per update; „Actualizează toate" cu confirmare. Rulare: max 2 site-uri în paralel,
   câte un plugin pe rând per site, re-verificare după fiecare site; rezultatele rămân în tabel.
4. Buton „Bibliotecă plugin-uri" în antetul paginii principale WordPress.

Stări obligatorii: loading, gol (bibliotecă goală / niciun site), eroare per site și per
fișier; site-urile `paused`/`disconnected` sunt sărite vizibil.

## Erori
Erorile conectorului trec prin `WpError` (cod + subcod), ca la celelalte endpoint-uri:
502 pentru transport, 200 cu `success:false` pentru eșecuri de activare raportate structurat.
Toate acțiunile se loghează cu `logInfo/logWarning('wordpress', …)` cu `tenantId`, `userId`, `siteId`.

## Teste
Module pure cu `bun run test` (versiuni, matching, inspecție ZIP cu fixture-uri JSZip,
comparare bibliotecă↔site, decizia de upsert). Endpoint-urile refolosesc modulele testate;
fluxul complet se verifică în browser (testermcp) pe dev.

## Ce rămâne în afara acestei livrări
- Cron de actualizare automată din bibliotecă (echivalentul `ots_auto_update_plugins`).
- Instalarea în lot a plugin-urilor lipsă pe site-uri.
- Istoric de versiuni în bibliotecă / rollback.
