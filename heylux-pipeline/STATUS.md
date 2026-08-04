# Heylux content pipeline — unde am rămas (2026-07-25)

Rescriere SEO + umanizare + categorii pentru articolele Heylux din CRM (website
`a9412aba640f436c8cdf69f8865199`, tenant ots). Eu (Claude) orchestrez și validez;
**agenți Sonnet scriu** (cerința userului). Fără API Anthropic — modelul din sesiune scrie.

## Stadiu
- **30 / 113 articole GATA și aplicate în DB** (batch 00, 01, 02, 05, 06 — vezi `results/`).
  Fiecare: text umanizat ≥620 cuvinte, FAQ, scor SEO 94–98 (rubrica reală `analyzeSeo` din app),
  focusKeyword divers, titlu SEO ≤60, meta 120–160, slug cu kw, categorie WP pusă.
- **83 de articole rămase** = batch 03, 04, 07–22 din exportul original (5/batch).
- Alte 58 de articole au `rewrite_status='none'` (nerescrise deloc) — NU sunt în scope-ul ăsta.

## Cum se reia (pașii exacți)
1. Re-exportă batch-urile DOAR pentru articolele neprocesate — rulează din `app/`:
   `set -a; source .env; set +a; bun ../heylux-pipeline/export.ts`
   ⚠️ ÎNTÂI editează `export.ts`: adaugă în WHERE `AND coalesce(focus_keyword,'')=''`
   (altfel re-exportă și cele 30 făcute). Batch-urile ies în `heylux-pipeline/batches/`.
2. Per batch, lansează un agent **Sonnet** (general-purpose, background) cu promptul:
   citește ÎN ORDINE (1) `~/.claude/skills/humanizer/SKILL.md`, (2) `~/.claude/skills/humanizer/romanian.md`,
   (3) `heylux-pipeline/BRIEF.md`; apoi batch-XX.json; scrie `results/result-XX.json`;
   rulează `validate.ts` pe rezultat și corectează până `N/N trec.`
3. Eu re-validez independent (`bun validate.ts results/result-XX.json` — ATENȚIE: fără
   `| tail` pe lângă `&&`, pipe-ul maschează exit code-ul!) și aplic: `bun apply.ts results/result-XX.json`
   (rulate din `app/` cu .env sourced). Valuri de ~5 agenți paraleli merg bine (~20-25 min/batch).

## Reguli învățate pe parcurs (deja în BRIEF.md + validate.ts — nu le pierde)
- **Reguli noi de scriere (cerute de user)**: humanizer SKILL.md + romanian.md (norme DOOM,
  ghilimele „…", fără „ca și" (exceptând „ca și cum/când" și „ca și X să…" cu și adverbial),
  „decât" doar cu negație, calcuri interzise: inovativ/focusat/a impacta/a adresa/seamless/
  a face diferența/a performa). Validatorul le verifică mecanic.
- **Guardrails client** (website_content_profile): NICIODATĂ Lucky Studio; fără CTA/telefon/
  URL/linkuri (deloc, nici interne); „premium" DOAR LiveJasmin; fără em/en dash; fără emoji.
- **Orașe non-Iași** (ex. Baia Mare): Heylux are studio DOAR în Iași — reformulare onestă cu
  relocare + cazare gratuită 2 luni; cifrele altor studiouri NU se atribuie Heylux.
- **Cifre**: cele din advertorialele-sursă Heylux se păstrează (ex. 400–2.000 lei/zi „scris pe
  mașini", comision 60% part-time/70% full-time); canonul site-ului: 300–1.200 lei/zi, 70%/80%,
  600 lei interviu-bonus, fidelitate 4.300, recomandare 2.000 €, plată zilnică, record $132.795.
- **Praguri validator** (rubrica app `src/lib/content/seo-analysis.ts`): ≥600 cuvinte (cerem 620),
  meta 120–160, kw în titlu/meta/primele 600 caractere (<90 cuvinte în fereastră!)/H2-H3/slug,
  densitate 0,5–2,5%, FAQ cu „?" în subtitluri, o listă, cifre. Singurul warn acceptat: `links`.

## Context brand (heylux.ro parsat 2026-07-25 — detalii complete în BRIEF.md)
Studio videochat Iași, echipă+management 100% feminin, LiveJasmin (nr. 1 Europa la încasări,
singura „premium"), comision 70% (80% de la alt studio), plată zilnică cash/card, 2.000 €
recomandare, fără experiență, 21 traineri, foto/video gratuite, 100% discreție, cazare 2 luni,
împrumuturi, vacanțe Dubai/Ibiza/Santorini, bursă plătită studentelor, record $132.795.
Blog: 14 pagini; categorii WP: De ce Heylux?(15), Câștiguri financiare(14), Avantaje(19),
Tips and tricks(18), Vacanțe(12), Sfaturi(10). Titluri conversaționale; emoji-urile din
titlurile vechi NU se preiau (guardrail).

## Fixuri punctuale făcute pe conținut aplicat
- Baia Mare (aqjef2ms…): rescris de mine integral (era „Heylux în Baia Mare" = fals).
- 3 fraze corectate la reguli noi: 2× „face diferența", 1× „ca și" (result-01/02/06 re-aplicate).
