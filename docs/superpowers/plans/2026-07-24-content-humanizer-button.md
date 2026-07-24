# Buton „Humanizer" în editorul de articol (/ots/content/[websiteId]/[articleId])

## Scop
Pass secundar de rescriere pe articolul generat curent care elimină tiparele de text AI
(regulile humanizer, deja injectate condensat la generare), fără a pierde fapte.
Complementar cu „Modifică" (instrucțiune liberă) și „Regenerează" (full din sursă).

## Pași
1. `article-prompt.ts` — `buildHumanizeSystemPrompt(profile)`: rol de editor (nu copywriter),
   HUMANIZER_RULES integral, regulă strictă „păstrează toate faptele, nu adăuga informații noi",
   ton/audiență din profil pentru voce, output JSON `{title, excerpt, body_markdown}`
   (compatibil `parseGeneration`). TDD: teste pure în `__tests__/article-generator.test.ts`.
2. `article-generator.ts` — mode `'humanize'` în `GenerateOpts` (folosește `currentText`);
   system = buildHumanizeSystemPrompt, userMsg = articolul curent.
3. `content-articles.remote.ts` — comandă `humanizeArticle(articleId)` în oglindă cu
   `modifyArticle` (staff guard, tenant scoping, drafting→ready, failure restaurează ready).
4. UI `[articleId]/+page.svelte` — buton „Humanizer" (Sparkles, `cl-btn-ai cl-btn-sm`) în bara
   `.ct-modify`, cu stare `humanizing` + refresh `getContentArticle`/`getWebsiteArticles`.
5. Verificare: bun test content, svelte-autofixer pe pagină, svelte-check, review pe diff.
