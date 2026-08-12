# AEO & GEO în catalogul de servicii OTS

**Data:** 2026-08-12
**Branch:** `feat/services-aeo-geo`
**Pagini afectate:** `/ots/services` (admin) și `/client/ots/services` (portal client)

## Problema

Catalogul OTS (`app/src/lib/constants/ots-catalog.ts`) are 14 servicii, dintre care
un singur serviciu organic: SEO. Vizibilitatea în motoarele de răspuns (AI Overviews,
featured snippets) și în motoarele generative (ChatGPT, Perplexity, Gemini, Claude)
nu se poate vinde ca ofertă distinctă. Singura urmă în catalog este feature-ul
`seo-22 „AI Overviews și SGE optimization"`, disponibil pe SEO Gold și Platinum.

Consecințe:

- Nu putem vinde AI Search unui client care are deja SEO la altă agenție.
- Nu putem factura separat munca de AEO/GEO — intră tăcut în abonamentul SEO.
- Wizardul de recomandare și dialogul de discounturi nu au ce recomanda pe zona AI.

## Decizii luate

| Decizie | Alegere | Motiv |
|---|---|---|
| Structură | Un singur serviciu `aeo-geo` | AEO și GEO împart ~70% din livrabile (schema entități, conținut citabil, E-E-A-T). Două carduri separate ar canibaliza vânzarea. |
| Preț | 350 / 500 / 750 / 1.100 € | Complementar SEO (500→1.400), vizibil mai ieftin, dar nu add-on de doi lei. |
| Setup | 400 € one-time | Sub setup-ul SEO (500 €); gratuit la contract 6+ luni, ca la SEO. |
| Suprapunere | `seo-22` iese din SEO | Elimină întrebarea „de ce plătesc separat dacă e deja în SEO Gold?". |
| Scope | Include bundles + wizard | Fără ele serviciul rămâne izolat: nu apare în discounturi și nu e recomandat niciodată. |

## Modificări

### 1. Serviciu nou în `CATEGORIES`

```
slug:     'aeo-geo'
name:     'AEO & GEO'
tagline:  'Vizibilitate în AI Search (AI Overviews, ChatGPT, Perplexity)'
icon:     'sparkles'
prices:   { bronze: 350, silver: 500, gold: 750, platinum: 1100 }
setupFees: 400 pe toate palierele
```

`setupDescription` — audit AI-visibility inițial: baseline citări brand pe platformele
monitorizate, audit entități și schema, verificare acces boți AI (GPTBot, ClaudeBot,
PerplexityBot, Google-Extended), `llms.txt`, plan de acțiune 3-6 luni. Gratuit la
contractare minimă 6 luni.

`priceNote` — abonament lunar, EUR fără TVA. Audit inclus la contract 6+ luni.
Rezultatele se măsoară în citări și share of voice, nu în poziții; primele mișcări
apar tipic în 2-4 luni.

`notes` — precizare că AEO/GEO nu înlocuiește SEO: indexarea clasică rămâne
sursa din care se alimentează motoarele generative.

**23 de features (`aeo-1` … `aeo-23`)**, gradate pe 5 axe:

*Monitorizare*
- Platforme monitorizate: `ChatGPT + AI Overviews` / `+ Perplexity` / `+ Gemini + Copilot` / `Toate + Claude + Grok`
- Prompturi monitorizate lunar: 10 / 25 / 50 / 100
- Raport lunar citări în CRM: toate palierele
- Raportare săptămânală în CRM: Gold+
- Share of Voice vs. competiție în AI answers: Gold+
- Alertă la pierderea unei citări: Platinum

*Tehnic*
- Audit vizibilitate AI (baseline citări brand): toate
- Schema markup entități (Organization, Person, Product): toate
- `llms.txt` + acces boți AI (GPTBot, ClaudeBot, PerplexityBot): toate
- Optimizare AI Overviews (Google SGE): toate
- Featured snippets și People Also Ask: toate
- Knowledge Graph / Wikidata entity building: Gold+

*Conținut*
- Restructurare conținut în format citabil (pagini/lună): 2 / 4 / 8 / 15
- Conținut nou optimizat AEO (articole/lună): Nu / 1 / 3 / 6
- Pagini FAQ + FAQPage schema: Silver+
- Statistici și date proprii (citation bait): Silver+
- E-E-A-T: autor, bio, credențiale, surse: Silver+

*Off-site*
- Mențiuni pe surse citate de LLM-uri (Reddit, Quora, forumuri): Gold+
- Prezență în listicle și comparații („best X"): Gold+
- Optimizare AI shopping (Perplexity Shopping, Google AI): Platinum

*Relație*
- Suport clienți: E-mail / E-mail / E-mail și telefon / E-mail și telefon
- Consultanță strategie AI Search: Gold+
- Meeting lunar de strategie: Gold+

### 2. Grupul `organic`

```
label:       'Organic & SEO'  →  'Organic, SEO & AI Search'
description: menționează explicit și motoarele generative
slugs:       ['seo']  →  ['seo', 'aeo-geo']
```

Chip-ul de filtrare din ambele pagini afișează `(2)`; `Toate` devine `(15)`.

### 3. SEO — eliminarea suprapunerii

`seo-22 „AI Overviews și SGE optimization"` se șterge din `CATEGORIES['seo'].features`.
ID-urile rămase nu se renumerotează (sunt chei de listă `{#each}`, nu ordinal afișat).
În `notes` la SEO se adaugă linia care trimite către AEO & GEO, ca dispariția
rândului din tabel să nu citească a scădere de valoare.

### 4. Bundles

| Bundle | Servicii | Discount | Badge |
|---|---|---|---|
| `ai-search-duo` (nou) | `seo` + `aeo-geo` | −15% | `new` |
| `full-paid-organic` | + `aeo-geo` (5 servicii) | −20% (neschimbat) | `best-value` |
| `enterprise` | + `aeo-geo` (7 servicii) | −22% (neschimbat) | `new` |

`ai-search-duo`, use-case `branding`: 850 €/lună listă → **723 €/lună** pe Bronze.
Taglines actualizate pentru cele două bundle-uri existente.

### 5. Wizard (`app/src/lib/logic/wizard-engine.ts`)

- `funnelCoverageScore`: `hasOrganic` devine `bundle.services.some((s) => ['seo', 'aeo-geo'].includes(s))`
- `platformBonus`: `+8` când obiectivul e `brand-awareness` sau `leads` și bundle-ul conține `aeo-geo`

Regula de business local (`['google-ads', 'seo']`) rămâne neatinsă — AI Search nu e
un canal local.

### 6. Icon

`CategoryIcon.svelte` primește ramura `aeo-geo` → `SparklesIcon` din `@lucide/svelte`.
Fără ea, cardul cade pe `SettingsIcon` (roată dințată), care citește a bug.

## Teste

`app/src/lib/constants/__tests__/ots-catalog-aeo-geo.test.ts`

1. `aeo-geo` există în `CATEGORIES` cu prețurile 350/500/750/1100 și setup 400 pe toate palierele
2. toate feature-urile au valoare definită pe toate cele 4 paliere (fără chei lipsă)
3. ID-urile de features sunt unice în cadrul serviciului
4. `seo-22` nu mai există în serviciul SEO
5. grupul `organic` conține exact `['seo', 'aeo-geo']` și `getCategoriesInGroup('organic')` întoarce 2 categorii
6. fiecare slug din fiecare bundle există în `CATEGORIES` (protejează contra typo-urilor la editare)
7. `ai-search-duo` există, are exact `seo` + `aeo-geo` și discount 15

`app/src/lib/logic/__tests__/wizard-organic.test.ts`

8. un bundle care conține doar `aeo-geo` primește scor de acoperire organică (nu 0) pe obiectivul `brand-awareness`
9. bonusul de platformă crește pentru `brand-awareness` + `aeo-geo`

## Non-scop

- Fără migrare DB. Catalogul e constante TypeScript; `package_request.categorySlug` e text liber, deci cererile existente nu se ating.
- Fără schimbări de preț la SEO. Scoaterea lui `seo-22` nu reduce tariful.
- Fără serviciu separat de „AI content" — restructurarea de conținut e feature în AEO & GEO.
