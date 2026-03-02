# Audit Admin Logs — Sprint 1 (2026-03-02)

## Fisiere afectate
- `app/src/lib/remotes/debug-logs.remote.ts`
- `app/src/lib/remotes/email-logs.remote.ts`
- `app/src/routes/[tenant]/admin/logs/+page.svelte`

## BUG 1: SECURITY — Lipsa verificare rol admin pe remote-uri
**Severitate**: Critica
**Problema**: Toate query-urile si comenzile din `debug-logs.remote.ts` si `email-logs.remote.ts` verificau doar `event.locals.user` si `event.locals.tenant`, fara sa verifice rolul. Orice utilizator autentificat al tenant-ului putea accesa si sterge log-uri.
**Fix**: Adaugat verificare `event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin'` pe toate cele 9 functii (5 debug + 4 email). Eroare: `Forbidden: Admin access required`.

## BUG 2: PERFORMANCE — Toate log-urile incarcate client-side fara limita
**Severitate**: Medie
**Problema**: `getDebugLogs()` si `getEmailLogs()` incarcau TOATE log-urile din DB fara niciun LIMIT. La mii de log-uri, transferul si parsarea in browser erau lente.
**Fix**: Adaugat `.limit(500)` pe ambele query-uri. Paginarea ramane client-side dar pe maxim 500 log-uri recente.

## BUG 3: PERFORMANCE — Stats queries N+1 (5 query-uri separate)
**Severitate**: Medie
**Problema**: `getDebugLogStats()` facea 5 query-uri separate (total, errors, warnings, infos, errors24h). `getEmailLogStats()` facea la fel 5 query-uri (pending, active, completed, failed, delayed).
**Fix**: Consolidat fiecare in un singur query cu `sum(case when ... then 1 else 0 end)`. 10 query-uri → 2 query-uri.

## BUG 4: UI — Animatia de refresh nu functioneaza
**Severitate**: Mica
**Problema**: `refreshEmailLogs()` si `refreshDebugLogs()` setau `refreshing = true`, chemau `revalidate()` (fire-and-forget), apoi in `finally` setau `refreshing = false` instant. Spinner-ul nu se vedea niciodata.
**Fix**: Eliminat try/finally. Folosit `setTimeout(() => refreshing = false, 800)` pentru feedback vizual.

## BUG 5: VALIDATION — deleteDebugLogsByLevel fara picklist
**Severitate**: Mica
**Problema**: Parametrul `level` era validat cu `v.pipe(v.string(), v.minLength(1))`, acceptand orice string.
**Fix**: Inlocuit cu `v.picklist(['info', 'warning', 'error'])` — accepta doar valorile valide.

## BUG 6: UI — Metadata afisat ca JSON raw
**Severitate**: Mica
**Problema**: Campul `metadata` (JSON string) era afisat raw in UI (`{log.metadata}`), dificil de citit.
**Fix**: Adaugat helper `formatMetadata()` care face `JSON.stringify(JSON.parse(raw), null, 2)`. Afisat in `<pre>` cu formatare corecta, atat la email logs cat si la debug logs.

## BUG 7: UI — Label "Total log-uri" confuz
**Severitate**: Mica
**Problema**: In filter bar-ul email logs, `Total log-uri: {paginatedEmailLogs.length} / {filteredEmailLogs.length}` arata numarul paginat vs filtrat, dar label-ul "Total" era inselator.
**Fix**: Inlocuit cu `{filteredEmailLogs.length} log-uri` + indicatorul filtrului activ de status.

## BUG 8: UX — Stergere individuala fara confirmare
**Severitate**: Mica
**Problema**: `handleDeleteEmailLog()` si `handleDeleteDebugLog()` stergeau imediat fara confirmare. Doar stergerile bulk aveau `confirm()`.
**Fix**: Adaugat `confirm('Sigur doriti sa stergeti acest log?')` inainte de stergere pe ambele functii.

## BUG 9: UX — Lipsa filtru tip email
**Severitate**: Mica
**Problema**: Tab-ul Email Logs avea doar filtru de status, dar nu si de tip email (invitation, invoice, task-assignment, etc.).
**Fix**: Adaugat state `emailTypeFilter`, logica de filtrare in `filteredEmailLogs`, reset in `$effect`, si dropdown `<Select>` cu toate cele 11 tipuri de email in filter bar.

## Rezumat
- **Critice**: 1 (security)
- **Medii**: 2 (performance)
- **Mici/UX**: 6 (UI, validation, UX)
- **Total**: 9 buguri fixate
