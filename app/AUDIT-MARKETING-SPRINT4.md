# Audit Marketing — Sprint 4: Validări & Toast Messages

Data: 2026-03-06

## Rezumat
14 buguri fixate: validări lipsă, toast messages, securitate, UX inconsistent pe toate cele 3 pagini de marketing (admin, per-client admin, client portal).

---

## BUG 1 — CRITICAL: Client portal deschidea dialog greșit pentru TikTok/Facebook
**Fișier**: `client/[tenant]/(app)/marketing/+page.svelte`
- Butonul "Adaugă Material" pe tab-urile tiktok-ads/facebook-ads deschidea `MaterialUploadDialog` în loc de `SocialUrlDialog` (care nici nu era importat)
- **Fix**: Ascuns butonul pentru aceste categorii (linia 235 + linia 302 — `&& activeCategory !== 'tiktok-ads' && activeCategory !== 'facebook-ads'`)

## BUG 2 — HIGH: Edit dialog arăta Status selector la client users
**Fișier**: `material-edit-dialog.svelte`
- Server-ul ignoră statusul de la client users, dar UI-ul arăta selectorul
- **Fix**: Adăugat prop `isClientUser` (default `false`), wrap status selector cu `{#if !isClientUser}`, pasat `isClientUser={true}` din client portal

## BUG 3 — HIGH: Edit dialog arăta "Draft" în loc de "Ciornă"
**Fișier**: `material-edit-dialog.svelte` linia 187
- Card/list views foloseau "Ciornă", dar edit dialog-ul zicea "Draft"
- **Fix**: Schimbat `'Draft'` → `'Ciornă'` în trigger și opțiuni

## BUG 4 — HIGH: Mesaj validare taguri eronat
**Fișier**: `marketing-materials.remote.ts` (3 locuri)
- Mesajul zicea "Maximum 10 taguri, fiecare maxim 50 caractere" dar codul verifica max 7 / max 30
- **Fix**: Actualizat la "Maximum 7 taguri, fiecare maxim 30 caractere"

## BUG 5 — HIGH: Lipsă loading indicator la încărcarea materialelor
**Fișiere**: Toate 3 paginile
- Cât query-ul era în curs, pagina arăta "0 materiale" și empty state
- **Fix**: Adăugat `loading` derived + spinner + `{#if loading} ... {:else} ... {/if}` wrapper pe stats+content

## BUG 6 — HIGH: Admin page seoLinks scoped greșit pentru edit dialog
**Fișier**: `[tenant]/marketing/+page.svelte`
- `seoLinksQuery` folosea `uploadClientId` (clientul selectat pt upload), nu clientul materialului editat
- **Fix**: Adăugat `editSeoLinksQuery` bazat pe `editMaterial?.clientId` și pasat `seoLinks={editSeoLinks}` la `MaterialEditDialog`

## BUG 7 — VERIFIED OK: taskMarketingMaterial cascade
- Schema avea deja `onDelete: 'cascade'` pe `marketingMaterialId`. Nu a necesitat modificare.

## BUG 8 — MEDIUM: Social URL dialog trimitea taguri non-JSON
**Fișier**: `social-url-dialog.svelte`
- Mentions+hashtags concatenate ca text simplu, `parseColorTags()` returna `[]` la display
- **Fix**: Înlocuit inputs-urile text (mentions/hashtags) cu `MaterialColorTagPicker` + `serializeColorTags(tags)` la save

## BUG 9 — MEDIUM: handlePreview tăcea pentru URL fără conținut
**Fișiere**: Toate 3 paginile
- Dacă materialul URL nu avea nici `externalUrl` nici `textContent`, click-ul nu făcea nimic
- **Fix**: Adăugat `else { toast.error('Materialul nu are conținut de previzualizat'); }`

## BUG 10 — MEDIUM: createMarketingMaterial putea crea material fără owner
**Fișier**: `marketing-materials.remote.ts`
- Dacă `isClientUser=true` dar `clientUser` era null pe locals, materialul avea `uploadedByClientUserId=null`
- **Fix**: Guard `if (isClientUser && !clientUserId) throw Error('Sesiune client invalidă')` în `createMarketingMaterial` + `createSocialUrlSets`

## BUG 11 — MEDIUM: textContent maxlength mismatch UI vs server
- Upload dialog: `maxlength={5000}`, server: `v.maxLength(50000)`
- **Fix**: Aliniat UI-ul la 50000 în `material-upload-dialog.svelte` și `material-edit-dialog.svelte`

## BUG 12 — LOW: Lipsă noopener/noreferrer pe window.open
**Fișiere**: Toate paginile + `material-preview-dialog.svelte` + `material-card.svelte` + `material-list-view.svelte`
- **Fix**: `window.open(url, '_blank', 'noopener,noreferrer')` peste tot (12 instanțe)

## BUG 13 — LOW: Lipsă character counter pe câmpul Description
**Fișiere**: `material-upload-dialog.svelte`, `article-upload-dialog.svelte`, `material-edit-dialog.svelte`
- TextContent avea counter, Description nu
- **Fix**: Adăugat `<p class="text-xs text-muted-foreground text-right">{description.length}/1000</p>`

## BUG 14 — LOW: Google Ads dialog nu se închidea după save
**Fișier**: `google-ads-asset-dialog.svelte`
- După salvare toast success apărea dar dialog-ul rămânea deschis
- **Fix**: Adăugat `open = false;` după `onSaved?.()` (resetDialog se apelează automat via onOpenChange)

---

## Fișiere modificate (11 fișiere)

| Fișier | Buguri |
|--------|--------|
| `app/src/lib/remotes/marketing-materials.remote.ts` | BUG 4, 10 |
| `app/src/lib/components/marketing/material-edit-dialog.svelte` | BUG 2, 3, 11, 13 |
| `app/src/lib/components/marketing/material-upload-dialog.svelte` | BUG 11, 13 |
| `app/src/lib/components/marketing/social-url-dialog.svelte` | BUG 8 |
| `app/src/lib/components/marketing/google-ads-asset-dialog.svelte` | BUG 14 |
| `app/src/lib/components/marketing/article-upload-dialog.svelte` | BUG 13 |
| `app/src/lib/components/marketing/material-preview-dialog.svelte` | BUG 12 |
| `app/src/lib/components/marketing/material-card.svelte` | BUG 12 |
| `app/src/lib/components/marketing/material-list-view.svelte` | BUG 12 |
| `app/src/routes/[tenant]/marketing/+page.svelte` | BUG 5, 6, 9, 12 |
| `app/src/routes/[tenant]/clients/[clientId]/marketing/+page.svelte` | BUG 5, 9, 12 |
| `app/src/routes/client/[tenant]/(app)/marketing/+page.svelte` | BUG 1, 2, 5, 9, 12 |

## Verificare
- `npx svelte-check` — 0 erori noi în fișierele marketing
