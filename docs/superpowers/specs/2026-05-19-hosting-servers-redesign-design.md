# Hosting Servers — page redesign (1:1 match cu pack-ul Claude Design)

_2026-05-19 · OTS CRM_

## Context

Pagina `/[tenant]/hosting/servers` (`app/src/routes/[tenant]/hosting/servers/+page.svelte`) afișează în prezent serverele DirectAdmin într-un layout simplu cu tabel + formular inline. Pack-ul de design (`Hosting Servers.html` din `89of3TV7yDdAeAzD-wD8eA`) propune o redesign completă: hero, KPI-uri, grid/tabel switcher, drawer cu detalii, modal pentru server nou.

## Scope

**Doar pagina `servers/+page.svelte` și CSS-ul aferent.** Nu modificăm:

- Schema DB (`daServer` rămâne neschimbat — nu adăugăm `ip`, `location`, `datacenter`, `os`, `panel`, `cpuModel` etc. la această iterație).
- Remote functions — folosim ce există: `getDAServers`, `addDAServer`, `testDAServer`, `syncDAPackages`, `deleteDAServer`.
- Pagina de detalii server `servers/[serverId]/+page.svelte` (rămâne ca fallback link).

## Data reality

Designul presupune ~25 de câmpuri (CPU%, RAM%, disk%, ping, uptime, load1/5/15, conturi count, packages count, etc.). În realitate, în DB avem doar:

```
id, name, hostname, port, useHttps, isActive, lastCheckedAt, lastError, daVersion, lastSyncResult, createdAt, updatedAt
```

Strategie: **structura vizuală 1:1, dar valori reale unde le avem, „—" unde nu.** Concret:

| Designul cere     | Realitatea CRM                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `hostname`        | `srv.hostname:srv.port`                                                                     |
| `ip`              | „—" (sau hostname dacă e IP)                                                                |
| `location`, `flag`, `datacenter` | „—"                                                                          |
| `status`          | derivat: `lastError != null ? 'warning' : 'online'`                                         |
| `ping`            | „—" (nu măsurăm istoric)                                                                    |
| `uptimeDays`      | calculat din `createdAt`                                                                    |
| `cpu`, `ram`, `disk`, `bandwidth` | „—" + bar gri la 0% (nu fabricăm metrici)                                  |
| `accounts`, `packages` | numărate prin agregare (vezi mai jos)                                                  |
| `lastSync`        | `lastSyncResult?.ranAt` formatat „acum X min"                                               |
| `os`, `panel`, `cpuModel` | „—" (sau `daVersion` pt. panel)                                                     |
| `load1/5/15`, `uptimeHistory` | „—" / bar gol                                                                   |

**Counts pe server** (accounts/packages):

- `packages`: COUNT din `da_package WHERE daServerId = ? AND isActive = true`
- `accounts`: COUNT din `hosting_account WHERE daServerId = ?` (există FK)

Adăugăm un nou query `getDAServersWithStats` care returnează `getDAServers()` + counts join-uite. Nu modificăm ce există.

## Vizual — 1:1 cu pack-ul

### Paleta (extrasă din `hosting-styles.css`)

- Background pagină: `#f4f6fa`
- Card background: `white`
- Border: `#e5e9f0`
- Border subtle: `#f1f5f9`
- Primary: `#1877F2` (NU blue-600 / Tailwind — primary brand al pack-ului)
- Primary hover: `#0d5cc7`
- Text: `#0f172a` (heading) / `#475569` (body) / `#94a3b8` (muted)
- Success: `#10b981`, warn: `#f59e0b`, danger: `#ef4444`
- Status bg-uri: `rgba(16,185,129,.12)` / `rgba(245,158,11,.14)` / `#f1f5f9` / `#fee2e2`

### Tipografie

- Font principal: Inter (loaded global)
- Hostname / IP / cod: `ui-monospace, "SF Mono", Menlo, monospace`
- Heading hero: `24px / 700 / -.02em`
- Card title: `14px / 700`
- KPI value: `28px / 800 / -.02em` (vine din `dash-kpi` shared)
- Metric label: `10.5px / 600 / uppercase / .04em`

### Structură

1. **Hero** — h1 „Servere DirectAdmin" + p stats (`X online · Y atenție · Z mentenanță · găzduiesc N conturi`); right-aligned action buttons („Sync toate", „Server nou").
2. **KPI grid** — 6 coloane: Servere, CPU mediu, Disk total, Conturi găzduite, Uptime mediu, Alerte active. Reuse stilul `dash-kpi` din `dashboard-styles.css` (îl inline-uim în page styles).
3. **Toolbar** — search box (320px), 4 filter chips (Toate/Online/Atenție/Mentenanță), spacer, view toggle (Carduri/Tabel), Export button.
4. **Grid view** — `repeat(auto-fill, minmax(380px, 1fr))` cu cards conținând: head (icon + name + meta + status pill), 2×2 metrics, foot (info + actions).
5. **Table view** — server / locație / CPU / RAM / Disk / Trafic / Conturi / Status / Acțiuni.
6. **Drawer** — slide-in din dreapta (600px), 5 secțiuni KV-grid: Resurse, Network & Identitate, Credențiale, Health & Uptime, Conținut găzduit. Footer: Sync, DA, SSH (disabled — neimplementat), Editează (link la `[serverId]`).
7. **Modal „Server nou"** — 880px wide, 2-col grid (`columnGap: 28px, rowGap: 22px`), 6 fields (Nume / Hostname / Port / Protocol / User / Password), URL preview box, test result alert, footer buttons.
8. **Toast** — confirm flash bottom-right după add.

### Stări status server

```
online    →  badge green   (lastError == null)
warning   →  badge orange  (lastError != null)
maintenance, offline  →  ignorate (nu avem aceste stări în DB)
```

Filter chip „Mentenanță" rămâne în UI dar va avea count 0 — păstrează parity-ul vizual cu designul.

### Acțiuni grid

- `Sync` icon-btn → `syncDAPackages(srv.id)`
- `External link` icon-btn → deschide `https://hostname:port` în tab nou
- `More` icon-btn → deschide drawer (`onOpen`)

Acțiuni drawer footer:

- `Sync acum` → `syncDAPackages`
- `Deschide DA` → external link
- `SSH` → disabled (nu avem)
- `Editează` → `goto(/[tenant]/hosting/servers/[id])`

Acțiuni modal:

- `Adaugă & testează` → `addDAServer(...)` apoi toast cu rezultat din `result.online`.

### Sync toate

Buton hero „Sync toate" → `Promise.allSettled(servers.map(s => syncDAPackages(s.id)))` cu un toast agregat la final.

### Export

Buton din toolbar → CSV download cu colonele tabelului (jsonToCsv simplu inline).

## Tehnic — Svelte 5

- Single `+page.svelte` (existing) — rewrite complet.
- CSS scoped în `<style>` block (700+ lines extras din `hosting-styles.css`, doar selectorii folosiți pe pagina asta).
- Folosim `$state`, `$derived`, `$effect` (Svelte 5 runes).
- Importăm icons din `@lucide/svelte/icons/*`.
- Folosim `goto` din `$app/navigation`.
- Folosim toast-ul existent: `svelte-sonner`.
- Componente inline (ServerCard, ServerDrawer, NewServerModal) — nu le extragem în fișiere separate (single-use, page-local).

## Securitate

- `addDAServer` rămâne cu validările existente (SSRF guard, hostname parsing, encrypt). Modalul nu schimbă nimic în backend.
- Drawer-ul afișează `apiUser` / `apiKey` masked — în realitate **NU avem decrypt în query-ul de listare** (intenționat). Pentru parity vizuală cu designul, afișăm `username: srv.name` placeholder sau dacă vrem cu adevărat decrypt → endpoint nou. **La iterația asta: secțiunea credențiale arată mesaj „Credențialele sunt criptate AES-256-GCM; vizibile la editare."** Nu fabricăm valori.
- `lastError` rămâne redactat pentru utilizatori fără `admin.hosting.servers.manage` (deja face `redactLastError`).

## A11y

- Drawer overlay are `role="dialog"` și focus trap (Svelte's portal pattern + escape key handler).
- Modal idem.
- Toate butoanele icon au `aria-label`.
- Filter chips → `aria-pressed`.

## Testare

- Type check: `bun run check` (svelte-check threshold warning).
- Visual check: `bun run dev` și deschidere `/ots/hosting/servers`.
- Test flows: adăugare server (succes + erori), test connection, sync, delete, switch view, filter, search, deschidere drawer, export CSV.

## Out of scope (follow-up tasks dacă vrei)

- Migrare schema pentru `ip`, `location`, `datacenter`, `os`, `panel`, `cpuModel`.
- Background job care colectează metrici live din DA (`/CMD_API_SERVER_STATS` etc.).
- Uptime tracker cu istoric 7 zile (necesită nouă tabelă + scheduler).
- Sparkline-uri reale pe KPI tiles.

## Acceptance

- Layout identic cu pack-ul (hero / KPIs / toolbar / grid+table / drawer / modal).
- Funcționalitatea actuală păstrată: add / test / sync / delete servers, navigate la detalii.
- Zero `any` în noul cod TS.
- `svelte-check` rulează clean (0 erori, max 0 warnings noi în acest fișier).
- Modalul se închide pe ESC și click pe backdrop.
- Drawer-ul se închide pe ESC și click pe backdrop.
- Search + filter + view toggle funcționale local (fără re-fetch).
