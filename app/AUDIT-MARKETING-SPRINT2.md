# Audit Marketing — Sprint 2 Bugfix

**Data**: 2026-03-05

## Fix-uri aplicate

### FIX-1 (HIGH): Edit dialog — JSON structurat protejat la editare
**Fișier**: `app/src/lib/components/marketing/material-edit-dialog.svelte`
- Categoriile `google-ads`, `tiktok-ads`, `facebook-ads` au conținut JSON structurat (headlines/descriptions, URL sets)
- Textarea editabilă corupa JSON-ul → acum afișează mesaj read-only "Conținut structurat — editează prin dialogul dedicat categoriei"
- `textContent` nu se mai trimite la server pentru categoriile structurate

### FIX-2 (HIGH): Edit dialog — form reset la închidere
**Fișier**: `app/src/lib/components/marketing/material-edit-dialog.svelte`
- Adăugat `onOpenChange` handler pe `Dialog.Root` care resetează toate câmpurile la închidere
- Previne afișarea datelor stale de la materialul anterior

### FIX-3 (HIGH): Per-client admin — SocialUrlDialog pentru TikTok/Facebook
**Fișier**: `app/src/routes/[tenant]/clients/[clientId]/marketing/+page.svelte`
- Adăugat import `SocialUrlDialog` + state `socialUrlDialogOpen`
- Butonul "Adaugă Material" deschide acum dialogul corect per categorie:
  - `google-ads` → GoogleAdsAssetDialog
  - `tiktok-ads` / `facebook-ads` → SocialUrlDialog
  - restul → MaterialUploadDialog

### FIX-4 (MEDIUM): Presigned URL cache cu TTL pe toate 3 paginile
**Fișiere**: Toate 3 paginile marketing (client, admin, per-client)
- `thumbnailCache: Record<string, { url: string; fetchedAt: number }>` cu TTL 240s (4 min)
- URL-urile presemnate expiră la 300s (5 min) — re-fetch automat înainte de expirare
- Cache-ul se golește la schimbarea categoriei/clientului

### FIX-5 (MEDIUM): Delete — DB first, apoi storage
**Fișier**: `app/src/lib/remotes/marketing-materials.remote.ts`
- Inversată ordinea: DB delete înainte de storage delete
- Un fișier orfan în MinIO e mai puțin grav decât un record DB cu fișier lipsă

### FIX-6 (MEDIUM): Client users nu pot schimba status
**Fișier**: `app/src/lib/remotes/marketing-materials.remote.ts`
- `updateMarketingMaterial`: câmpul `status` ignorat pentru `isClientUser`
- Doar adminii pot seta draft/archived

### FIX-7 (MEDIUM): Edit dialog — footer mutat în `{#if material}`
**Fișier**: `app/src/lib/components/marketing/material-edit-dialog.svelte`
- `Dialog.Footer` era afișat și când `material` era null → mutat în blocul condiționat

### FIX-8 (MEDIUM): Dimensiuni imagine salvate în DB la upload
**Fișier**: `app/src/lib/server/marketing-upload.ts`
- `getImageDimensions()` era deja implementat dar rezultatul nu se salva
- Acum salvează `dimensions` ca string `"WxH"` (ex: `"1200x628"`) în insert

### FIX-9 (LOW): Status labels traduse în română
**Fișiere**: `material-card.svelte`, `material-list-view.svelte`
- Map: `active → Activ`, `draft → Ciornă`, `archived → Arhivat`
- Eliminat `capitalize` CSS class, folosit label explicit

### FIX-10 (LOW): "Resetează" buton — clear filter, nu select all
**Fișier**: `app/src/routes/[tenant]/marketing/+page.svelte`
- Butonul "Resetează" din popover-ul de clienți chema `selectAllClients` → acum cheamă `clearClientFilter`
- Vizibil când `selectedClientIds.length > 0` (nu doar când < total)

### FIX-11 (LOW): refreshKey pattern — verificat, funcționează corect
- `_refresh: refreshKey` ca cache-buster în query → incrementarea forțează re-derivarea
- `deleteMarketingMaterial` folosește deja `.updates(materialsQuery)` corect
- Nu a fost nevoie de modificări

## Fișiere modificate

| Fișier | Fix-uri |
|--------|---------|
| `app/src/lib/components/marketing/material-edit-dialog.svelte` | FIX-1, FIX-2, FIX-7 |
| `app/src/routes/[tenant]/clients/[clientId]/marketing/+page.svelte` | FIX-3, FIX-4 |
| `app/src/routes/[tenant]/marketing/+page.svelte` | FIX-4, FIX-10 |
| `app/src/routes/client/[tenant]/(app)/marketing/+page.svelte` | FIX-4 |
| `app/src/lib/remotes/marketing-materials.remote.ts` | FIX-5, FIX-6 |
| `app/src/lib/server/marketing-upload.ts` | FIX-8 |
| `app/src/lib/components/marketing/material-card.svelte` | FIX-9 |
| `app/src/lib/components/marketing/material-list-view.svelte` | FIX-9 |
