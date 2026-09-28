# Sentinel WordPress — predare pentru pilot (areni + nevada)

Data: 28 septembrie 2026 · Ramura: `feat/wp-sentinel` (worktree `.claude/worktrees/wp-sentinel`)
Spec: `docs/superpowers/specs/2026-09-28-wp-sentinel-design.md` · Plan: `docs/superpowers/plans/2026-09-28-wp-sentinel.md`

## Stare

| Piesă | Stare |
|---|---|
| Conector 0.9.0 (clasa Sentinel + `POST /sentinel`) | în ramură, build local `ots-wp-connector-v0.9.0.zip`, **NEPUBLICAT** |
| Migrări 0569–0576 (`wordpress_security_event`, `wordpress_site.sentinel_*`) | **aplicate** pe baza partajată (dev = prod), aditive |
| CRM: `pull.ts`, `rules.ts`, `digest.ts`, job 09:00, remote functions, pagina `/wordpress/security` | în ramură, nedeployat |
| Teste | 2950 pass / 0 fail (toată suita); Sentinel: 56 + 14 |

Până la deploy, prod rulează codul vechi: coloanele noi sunt ignorate, jobul nu există. Până la pilot,
niciun site nu are 0.9.0 → pagina arată toate site-urile „Conector vechi”, iar jobul nu trimite nimic
(tenant fără site-uri compatibile = fără mesaj).

## Ce s-a schimbat față de spec-ul inițial (pe baza jurnalelor reale și a recenziilor)

- **Brute-force lent:** fereastra e 7 zile, nu 24 h. Pe nevada, trei eșecuri pe username-ul real de admin
  au venit la câte două zile distanță (23, 25, 27.09), de pe trei IP-uri. Liniile vechi n-au `exista`,
  așa că un username contează și dacă e admin cunoscut.
- **Plugin-uri activate/dezactivate de pe IP-ul OTS** → ⚪ (munca noastră); activarea conectorului → ⚪ mereu.
- **`php_in_uploads` de la mu-plugin** → ⚪ (scanarea conectorului, cu baseline, acoperă același lucru).
- **`ip_remote`** pe fiecare linie nouă: un `X-Forwarded-For` falsificat cu IP-ul OTS nu mai trece drept OTS.
- **`pendingFindings`:** ce găsește „Citește acum” la 15:00 intră în mesajul de a doua zi; se golesc doar
  findings-urile efectiv trimise.
- **Lock per site** (Redis, `sentinel:pull:<siteId>`): „Citește acum” în timpul jobului → „Citire în curs”.
- **Retenție 7 zile**; memoria lungă (IP-uri admin 90 z, eșecuri 7 z, baseline uploads) stă în `sentinel_state`.
- Jurnalul nou se numește `wp-content/ots-sentinel/sentinel-<hash>.log` (hash din secretul conectorului —
  `.htaccess` nu protejează pe Nginx); fără secret nu se scrie nimic; se păstrează 5 rotiri de 8 MB.

## Pilot — pași (manual)

1. **Deploy CRM** din ramură (după PR + „go”): build local de prod înainte (`bun run build`), apoi
   `hosted deploy`. Verifică `/_app/version.json`.
2. **Auto-update-ul de la 04:30 nu dă jos pilotul:** sare site-urile cu versiune ≥ ultima publicată
   (`compareConnectorVersions(current, latest) >= 0`). Verificat în cod.
3. Pe **arenishaorma.ro** și **nevadasuceava.ro**: wp-admin → Plugins → Add New → Upload
   `ots-wp-connector-v0.9.0.zip` → „Replace current with uploaded”.
4. „Citește acum” pe fiecare, **înainte** de a șterge mu-plugin-ul → status „Șterge mu-plugin-ul vechi”
   (`legacy`); evenimentele vechi (23–28.09) apar în tabel; prima citire = baseline.
   Așteptat din datele reale: nevada → un 🟠 „3 logări eșuate pe <admin> în 7 zile (3 IP-uri)”; areni → nimic.
5. Șterge `wp-content/mu-plugins/ots-sentinel.php` pe ambele (FTP). „Citește acum” → status „Citit …”.
6. Fă o logare eșuată de test pe un username inexistent și una pe cel real → „Citește acum” →
   evenimentele apar; cea pe username real are `exista: true`.
7. Rulează jobul o dată manual (pagina de scheduler, `wordpress_sentinel_daily`) → mesaj Telegram.
   A doua rulare în aceeași zi nu retrimite (cheie Redis `sentinel:digest:<tenant>:<zi>`).
8. 2–3 zile de observație la 09:00, apoi `bun run connector:release` → 04:30 îl duce pe toate site-urile.

## De știut înainte de release-ul general

- **Site-urile Liepsnele** (centrale-lemne, centrale-pellet, centrale-seminee, stropuva) au mu-plugin-ul
  **1.1** din `~/Wordpress/WooProducts/ots-guard/` (cu `fisiere_modificate`, `upload_blocat`). După 0.9.0
  vor fi `legacy` până la ștergerea mu-plugin-ului, iar la prima citire evenimentele 1.1 grave din istoric
  pot apărea ca 🔴 („… raportat de mu-plugin”). Șterge mu-plugin-ul pe ele odată cu release-ul.
- **Wow Agency** e după Cloudflare, care blochează IP-ul clusterului (vezi handoff-ul din 25.09) — va apărea
  „nu răspunde” până la regula WAF pentru `/wp-json/ots-connector/*`.
- **Destinatarii** mesajului: toți utilizatorii **activi** ai tenantului (`TODO(user)` în jobul zilnic:
  doar owner/admin?). Mesajul conține username-uri de admin și IP-uri.

## Unelte

- Jurnalele brute (doar citire): `~/Wordpress/WooProducts/ots-guard/citeste_sentinel.py --site nevada`.
- Fixture-uri de test anonimizate: `scripts/anonymize-sentinel-log.ts <in.log> <out.ndjson>`.
- Dev server din worktree pe alt port: `bunx --bun vite dev --port 5174` — cu `node_modules` instalat
  în worktree (`bun install`), NU symlink (Vite refuză fișierele din afara worktree-ului → pagină albă).
