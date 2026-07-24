# Content în portalul clientului — design

**Data:** 2026-07-24 · **Branch:** feat/heylux-content-rewrite

## Cerință

Modulul Content (`/ots/content`, multi-website) trebuie să apară și în portalul clientului,
cu aceeași asociere ca la SEO links (per website + per client). Adminul OTS controlează
accesul printr-un **singur switch per website**: „Permite folosire AI".

## Decizii

### Asociere client ↔ content
`clientWebsite.clientId` (NOT NULL) există deja — e aceeași asociere folosită de SEO links.
Nu se construiește mecanism nou de matching.

### Switch-ul
- Coloană nouă `allow_client_ai` (boolean, NOT NULL, default false) pe `website_content_profile`
  (tabela de politici per website, 1:1 cu `client_website`, upsert existent).
- Migrare `0435_website_content_profile_allow_client_ai.sql` (un singur statement, Turso).
- Toggle pe fiecare card de website în hub-ul admin `/[tenant]/content` (poziția marcată de user
  în screenshot: colțul dreapta-sus al cardului).
- Comandă nouă staff-only `setWebsiteClientAiAccess({ websiteId, allow })` cu upsert
  (același pattern ca `updateWebsitePublishPolicy`).

### Portal client
- Item nou „Content" în meniul portalului, vizibil doar dacă clientul are ≥1 website cu
  `allowClientAi = true` (query în `client/[tenant]/+layout.server.ts` → `contentEnabled`).
- FĂRĂ categorie nouă în `AccessCategory` — cerința e un singur switch; gating-ul e per website,
  nu per utilizator de portal. (Extensie viitoare posibilă: categorie `content` pentru
  contacte secundare.)
- Rute noi: `client/[tenant]/(app)/content/`, `.../[websiteId]/`, `.../[websiteId]/[articleId]/`
  — wrappere subțiri peste componente comune. Gate 403 în `content/+layout.server.ts`
  dacă `contentEnabled` e false.
- `/content` intră în `restrictedPrefixes` (blur la facturi restante), ca `/backlinks`.

### Refolosirea paginilor („aceeași pagină ca la admin")
Paginile admin se extrag în componente comune sub `$lib/components/content/`:
- `ContentHubView.svelte` — cardurile de website (admin: cu toggle; client: fără, doar site-urile lui).
- `WebsiteContentView.svelte` — pagina per-website; client vede tab-urile **Articole + Calendar**;
  tab-urile **Setări** și **Context** rămân admin-only (politică publicare, WP link, guardrails brand).
- `ArticleEditorView.svelte` — editorul cu acțiuni AI (regenerare, humanize, modificare, SEO),
  salvare/aprobare, publicare/programare. Butonul „Categorii WP" refresh rămâne admin-only.

Props: `basePath` (`/${tenant}/content` vs `/client/${tenant}/content`) + `isClient`.
Rutele admin devin și ele wrappere peste aceleași componente (o singură sursă de adevăr).

### Securitate (pattern F8, ca la seo-links.remote.ts)
Helper `requireContentAccess(event, websiteId)` în content-articles.remote.ts:
- staff → `requireStaff` (neschimbat);
- client user → website-ul trebuie să aparțină `event.locals.client.id` ȘI profilul lui să aibă
  `allowClientAi = true`; altfel 403. Pentru funcțiile pe articol, website-ul articolului se
  verifică la fel (articol fără websiteId → refuzat pentru clienți).

Deschise clienților (cu scoping forțat): `getContentWebsites` (filtrat pe clientId + allowClientAi),
`getWebsiteArticles`, `getContentArticle`, `updateContentArticle`, `generateArticleFromBrief`,
`regenerateArticle`, `modifyArticle`, `humanizeArticle`, `generateArticleSeo`, `getWebsiteCalendar`,
`publishArticle`, `scheduleArticle`, `unscheduleArticle`.

Rămân staff-only: `importHeyluxSources`, `startContentExtraction`, `retryFailedExtractions`,
`rewriteArticle` (legacy), `getContentArticles` (legacy brand), `getContentImportJob`,
`refreshArticleWpCategories`, `getTenantWordpressSites` (expune site-urile WP ale tenantului!),
`setWebsiteWpSite`, `getWebsiteContentProfile`, `updateWebsiteContentProfile`,
`updateWebsitePublishPolicy`, `setWebsiteClientAiAccess`.

### Costuri AI
Generarea folosește `getClaudeClientFor(tenantId, 'copywriting')` — cheia tenantului (adminului).
Switch-ul E consimțământul adminului pentru consumul clientului. Blur-ul de facturi restante
limitează abuzul la neplată.

## Teste (înainte de implementare)
1. Client cu switch ON → vede doar website-urile lui, poate citi/edita/genera articole pe ele.
2. Client cu switch OFF → `getContentWebsites` nu returnează site-ul; orice funcție pe
   websiteId/articleId al site-ului → 403.
3. Client A nu poate accesa website-ul/articolele clientului B (403), indiferent de switch.
4. `setWebsiteClientAiAccess` respins pentru client users.
5. Staff: comportament neschimbat pe toate funcțiile.
