# Audit Marketing Materials — Sprint 1

**Data**: 2026-03-03
**Modul**: Marketing Materials (upload, asocieri client, CRUD, UI)

---

## Buguri fixate

### BUG 1 — CRITIC: URL materials salvate ca type='video'
- **Cauza**: `material-upload-dialog.svelte:164` folosea `type: 'video'` pentru materiale de tip URL extern
- **Impact**: VideoIcon afișat incorect, filtrul Video amesteca URL-uri cu video-uri reale, imposibil de filtrat doar URL-uri
- **Fix**:
  - Adăugat `type: 'url'` la schema (comment + picklist)
  - Upload dialog: `type: 'video'` → `type: 'url'`
  - Material card: adăugat `url: ExternalLinkIcon` la typeIcons
  - Material filters: adăugat buton filtru "URL" cu LinkIcon
  - Edit dialog: condiție `material.type === 'url'` pt câmpul URL
  - Migrare date: `UPDATE marketing_material SET type = 'url' WHERE type = 'video' AND external_url IS NOT NULL AND file_path IS NULL`
- **Fișiere**: schema.ts, marketing-materials.remote.ts, material-upload-dialog.svelte, material-card.svelte, material-filters.svelte, material-edit-dialog.svelte, 0058_marketing_materials_fixes.sql

### BUG 2 — HIGH: window.location.reload() în loc de .revalidate()
- **Cauza**: `handleUploaded()` și `handleUpdated()` făceau `window.location.reload()` în 3 pagini
- **Impact**: Full page reload la upload/edit — pierderea scroll position, UX slab
- **Fix**: Înlocuit cu `materialsQuery.revalidate()` (pattern confirmat din admin logs)
- **Fișiere**: [tenant]/marketing/+page.svelte, [tenant]/clients/[clientId]/marketing/+page.svelte, client/[tenant]/marketing/+page.svelte

### BUG 3 — HIGH: createSchema accepta filePath/fileSize/mimeType/fileName
- **Cauza**: Valibot schema permitea trimiterea de metadata fișier prin remote RPC
- **Impact**: Securitate — posibilitate de a injecta filePath fals spre fișiere ale altor tenanti
- **Fix**: Scos `filePath`, `fileSize`, `mimeType`, `fileName`, `dimensions` din createSchema și din values-ul insert-ului
- **Fișier**: marketing-materials.remote.ts

### BUG 4 — MEDIUM: clientUser?.id defaults la '' în update/delete
- **Cauza**: `(event.locals as any).clientUser?.id || ''` — dacă id undefined, queryul nu returna niciodată match
- **Impact**: Client user primea eroare generică fără explicație
- **Fix**: Guard explicit cu `throw new Error('Sesiune client invalidă')` dacă `clientUserId` e undefined
- **Fișier**: marketing-materials.remote.ts (updateMarketingMaterial + deleteMarketingMaterial)

### BUG 5 — MEDIUM: detectType() default la 'document' pt tipuri necunoscute
- **Cauza**: Funcția returna 'document' ca fallback fără a verifica explicit lista de tipuri document
- **Fix**: Adăugat verificare `ALLOWED_DOC_TYPES.includes(mimeType)` + throw pentru necunoscute
- **Fișier**: marketing-upload.ts

### BUG 6 — MEDIUM: validateMagicBytes return true pt tipuri necunoscute
- **Cauza**: Fallthrough `return true` la linia 85 permitea orice fișier cu tip necunoscut
- **Fix**: `return true` → `return false` (deny by default)
- **Fișier**: marketing-upload.ts

### BUG 7 — MEDIUM: Lipsă validare dimensiune fișier client-side
- **Cauza**: Nicio verificare de tip/size la selectarea fișierului
- **Impact**: Userul putea selecta fișier de 200MB, aștepta upload, apoi primea eroare server
- **Fix**: Adăugat `validateFile()` cu verificare tip MIME + dimensiune maximă la `handleFileSelect()` și `handleDrop()`
- **Fișier**: material-upload-dialog.svelte

### BUG 8 — MEDIUM: LIKE search nu escape-uiește wildcards (%, _)
- **Cauza**: `%${filters.search.trim()}%` fără escape pe `%` și `_`
- **Impact**: Căutarea cu `%` sau `_` dădea rezultate wildcard neintenționate
- **Fix**: Escape `%` → `\%`, `_` → `\_` + SQL raw template cu `ESCAPE '\\'`
- **Fișier**: marketing-materials.remote.ts

### BUG 9 — MEDIUM: Lipsă indexuri DB
- **Cauza**: Migrarea 0057 nu avea niciun index
- **Impact**: Performanță degradată la query-uri cu filtre pe tenant_id, client_id, category, status
- **Fix**: Adăugat 3 indexuri: `idx_mm_tenant_client`, `idx_mm_tenant_category`, `idx_mm_status`
- **Fișier**: 0058_marketing_materials_fixes.sql

### BUG 10 — MEDIUM: seoLinkId FK fără ON DELETE behavior
- **Cauza**: FK fără `onDelete` — dacă seoLink e șters, marketing materials rămân cu FK orfan
- **Fix**: Adăugat `{ onDelete: 'set null' }` pe referința `seoLinkId` în schema.ts
- **Fișier**: schema.ts

### BUG 11 — LOW: UPDATE WHERE nu include tenant scope
- **Cauza**: SELECT verifica tenant + ownership, dar UPDATE folosea doar `id`
- **Fix**: `.where(eq(id, data.id))` → `.where(conditions!)` cu aceleași condiții ca SELECT
- **Fișier**: marketing-materials.remote.ts (updateMarketingMaterial)

### BUG 12 — LOW: DELETE WHERE nu include tenant scope
- **Cauza**: Same ca BUG 11, pe funcția delete
- **Fix**: `.where(eq(id, materialId))` → `.where(conditions!)`
- **Fișier**: marketing-materials.remote.ts (deleteMarketingMaterial)

### BUG 13 — LOW: $effect thumbnail loading trigger redundant
- **Cauza**: `$effect` citea `thumbnailUrls` (dependință reactivă) → fiecare URL nou declanșa re-evaluare
- **Fix**: Adăugat `Set<string> loadingThumbnailIds` pt tracking "in-flight" requests, prevenind duplicate
- **Fișiere**: toate 3 paginile marketing

### BUG 14 — LOW: Edit dialog ascunde câmpuri text/url dacă valoarea e null
- **Cauza**: Condiția `material.textContent !== null` nu acoperea cazul edge cu text null
- **Fix**: Adăugat `|| material.type === 'text'` și `|| material.type === 'url'` + adăugat `type` la interfața Material
- **Fișier**: material-edit-dialog.svelte

---

## Fișiere modificate

| Fișier | Buguri fixate |
|--------|---------------|
| `app/src/lib/server/db/schema.ts` | BUG 1, BUG 10 |
| `app/drizzle/0058_marketing_materials_fixes.sql` | BUG 1 (data migration), BUG 9 |
| `app/src/lib/remotes/marketing-materials.remote.ts` | BUG 1, 3, 4, 8, 11, 12 |
| `app/src/lib/server/marketing-upload.ts` | BUG 5, 6 |
| `app/src/lib/components/marketing/material-upload-dialog.svelte` | BUG 1, 7 |
| `app/src/lib/components/marketing/material-card.svelte` | BUG 1 |
| `app/src/lib/components/marketing/material-filters.svelte` | BUG 1 |
| `app/src/lib/components/marketing/material-edit-dialog.svelte` | BUG 14 |
| `app/src/routes/[tenant]/marketing/+page.svelte` | BUG 2, 13 |
| `app/src/routes/[tenant]/clients/[clientId]/marketing/+page.svelte` | BUG 2, 13 |
| `app/src/routes/client/[tenant]/(app)/marketing/+page.svelte` | BUG 2, 13 |

## Post-deploy

1. Aplică migrarea `0058_marketing_materials_fixes.sql` pe DB
2. Verifică că materialele URL existente au `type='url'` (nu 'video')
3. Testează upload fișier / text / URL din admin + client portal
