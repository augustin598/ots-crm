# Audit Marketing — Sprint 3: Document Preview

**Data**: 2026-03-06

## Feature: Preview documente (PDF, DOCX, TXT) in marketing materials

### Funcționalitate nouă

Când utilizatorul dă click pe un material de tip document, se deschide un popup cu vizualizarea documentului (în loc de descărcare în tab nou).

**Tipuri suportate:**
- **PDF** — iframe nativ în card thumbnail + dialog
- **DOCX/DOC** — Google Docs Viewer în dialog (card arată icon)
- **TXT** — conținut text fetch-uit server-side, afișat în dialog

### Modificări

#### 1. Storage — respHeaders pentru presigned URLs
**Fișier**: `app/src/lib/server/storage.ts`
- `getDownloadUrl(filePath, expirySeconds, respHeaders?)` — parametru opțional `respHeaders` pasat la `presignedGetObject()`
- Permite `Content-Disposition: inline` + `Content-Type` custom pe URL-uri presemnate

#### 2. Remote — `getMaterialPreviewUrl` + `getMaterialTextContent`
**Fișier**: `app/src/lib/remotes/marketing-materials.remote.ts`

**`getMaterialPreviewUrl(materialId)`**:
- Generează URL presemnat cu `response-content-disposition: inline` + `response-content-type` setat pe mimeType
- Expiry: 3600s (1 oră) — necesar pentru Google Docs Viewer care e lent la încărcare
- Returnează `{ url, fileName, mimeType }`

**`getMaterialTextContent(materialId)`**:
- Citește fișierul TXT server-side via `storage.getFileBuffer()` (evită CORS)
- Truncare la 500KB (`MAX_TEXT_CONTENT_BYTES = 512 * 1024`)
- Returnează `{ content, truncated, totalSize }`
- Validare: doar `mimeType === 'text/plain'`

#### 3. Material Card — PDF thumbnail
**Fișier**: `app/src/lib/components/marketing/material-card.svelte`
- `$effect` încarcă `getMaterialPreviewUrl` doar pentru PDF-uri (DOCX/TXT nu se pot randa în iframe mic)
- Thumbnail rendering: attached image > PDF iframe > fallback icon
- Import adăugat: `getMaterialPreviewUrl`

#### 4. Preview Dialog — per-type rendering cu loading/error states
**Fișier**: `app/src/lib/components/marketing/material-preview-dialog.svelte`

**PDF:**
- Iframe cu URL presemnat inline
- Loading spinner overlay
- Error fallback cu buton "Descarcă" (timeout 20s)

**DOCX/DOC:**
- Google Docs Viewer iframe (`https://docs.google.com/gview?url=...&embedded=true`)
- Loading spinner + error fallback cu buton "Descarcă"
- Timeout 20s

**TXT:**
- Fetch server-side via `getMaterialTextContent()`
- `<pre>` whitespace-pre-wrap cu font mono
- Loading state cu spinner
- Error state cu buton "Descarcă"
- Mesaj truncare dacă fișier > 500KB

**Toate tipurile:** buton "Descarcă" persistent în footer

#### 5. Marketing Pages — dialog în loc de window.open
**Fișiere** (3 pagini):
- `app/src/routes/[tenant]/marketing/+page.svelte`
- `app/src/routes/[tenant]/clients/[clientId]/marketing/+page.svelte`
- `app/src/routes/client/[tenant]/(app)/marketing/+page.svelte`

- `handlePreview` pentru documente: `getMaterialPreviewUrl` → deschide `MaterialPreviewDialog` cu URL + material
- Import adăugat: `getMaterialPreviewUrl`

### Buguri fixate (audit)

| # | Severitate | Bug | Fix |
|---|-----------|-----|-----|
| 1 | CRITICAL | Presigned URL expiry 300s — Google Docs Viewer nu apucă să încarce | Mărit la 3600s |
| 2 | HIGH | TXT fetch din client — CORS blocat pe MinIO cross-origin | Server-side fetch via `getMaterialTextContent` |
| 3 | HIGH | DOCX iframe în card (prea mic, prea lent) | Eliminat — doar PDF în card, DOCX arată icon |
| 4 | MODERATE | PDF/DOCX fără loading state — iframe gol | Loading spinner + timeout 20s + error fallback |
| 5 | MODERATE | TXT fără error state | Error state cu buton download |
| 6 | LOW | TXT fișiere mari — OOM potential | Truncare server-side la 500KB |
| 7 | LOW | Auto-download la click document | Înlocuit `window.open` cu preview dialog |

### Fișiere modificate

| Fișier | Tip |
|--------|-----|
| `app/src/lib/server/storage.ts` | Backend |
| `app/src/lib/remotes/marketing-materials.remote.ts` | Remote |
| `app/src/lib/components/marketing/material-card.svelte` | Component |
| `app/src/lib/components/marketing/material-preview-dialog.svelte` | Component |
| `app/src/routes/[tenant]/marketing/+page.svelte` | Page |
| `app/src/routes/[tenant]/clients/[clientId]/marketing/+page.svelte` | Page |
| `app/src/routes/client/[tenant]/(app)/marketing/+page.svelte` | Page |
