---
name: crm-dev-flow
description: Use when implementing any feature, bugfix, or refactor in the OTS CRM codebase — before reading code, exploring files, or writing any implementation. Also use when tempted to skip process because the task is "urgent", "simple", or "small".
---

# CRM Dev Flow

## Overview

Flow-ul standard obligatoriu pentru orice modificare de cod în OTS CRM. Ordinea pașilor NU e negociabilă. „Urgent" sau „simplu" nu sunt motive de a sări pași — sunt exact situațiile în care pașii săriți produc buguri în producție (vezi incidentele TVA, nevadasuceava, F8).

**Violating the letter of the flow is violating the spirit of the flow.**

## Flow (în ordine)

0. **Branch guard** — verifică `git branch --show-current` ≠ main; dacă ești pe main, creează branch de feature înainte de orice modificare.
1. **graphify** — `graphify explain/path/query` pe zona afectată ÎNAINTE de orice grep/Read. Dacă graful e stale: `graphify . --update`.
2. **superpowers:brainstorming** — clarifică cerințele cu userul. Sari DOAR dacă userul a dat deja o cerință cu criteriu de acceptare clar (spec scris); „mi se pare evident" NU e o excepție.
3. **superpowers:writing-plans** — plan scris obligatoriu dacă taskul atinge >1 fișier SAU schimbă schema DB. Sub prag: sari la 4.
4. **Implementare cu TDD** — încarcă `ots-crm-dev` + skill-urile de domeniu relevante (`multi-tenant`, `error-handling`, `email-delivery`, `database-migrations`, `api-integrations`) și, pentru orice fișier .svelte/.svelte.ts, `svelte:svelte-core-bestpractices` — ÎNAINTE de a crea fișiere noi. Testele se scriu ÎNAINTE de cod (superpowers:test-driven-development). „Test manual rapid" NU înlocuiește testele.
5. **svelte-autofixer + /build-check** — autofixer pe fiecare componentă .svelte modificată; apoi `/build-check` (svelte-check cu heap 8GB, baseline 16 err/56 warn). Pentru schimbări de UI: testează fluxul în browser cu **testermcp** (golden path + edge cases).
6. **superpowers:verification-before-completion** — rulează comenzile de verificare și confirmă output-ul înainte de orice "gata".
7. **Review** — superpowers:requesting-code-review; pentru security / PR mare / arhitectură, și gemini ca second opinion.
8. **Fix din review** → repetă 5–6.
9. **superpowers:finishing-a-development-branch** — commit & push; propune deploy, așteaptă „go" de la user.

**Oricând apare un bug pe parcurs** → superpowers:systematic-debugging (nu ghici-și-repară).

## Red Flags — STOP, întoarce-te la flow

- „E urgent, sar peste plan/teste"
- „E prea simplu pentru graphify/plan"
- „Testez manual, e mai rapid"
- „Scriu testele după ce merge"
- „Fac review doar dacă cere userul"
- Ai deschis un fișier sursă înainte de graphify
- Ai creat un +server.ts fără să încarci skill-urile de domeniu
- Ai modificat un .svelte fără svelte-core-bestpractices încărcat
- Ai livrat o schimbare de UI fără s-o vezi în browser (testermcp)
- Faci commit direct pe main

## Rationalizări

| Scuză | Realitate |
|---|---|
| „E urgent" | Bugul din producție costă mai mult decât cei 5 pași. Flow-ul complet ia minute, incidentul ia zile. |
| „E un fix de 3 linii" | Fixurile de 3 linii au produs incidentul nevadasuceava și coerciția TVA 0%→19. |
| „Graphify e overkill aici" | Graphify e mai ieftin decât grep-uri repetate și găsește dependențe pe care nu le cauți. |
| „Testele după implementare sunt la fel" | Tests-after = „ce face codul?". Tests-first = „ce TREBUIE să facă?". |
