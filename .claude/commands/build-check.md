Rulează build check: cd /Users/augustin598/Projects/CRM/app && npx svelte-check --threshold warning 2>&1 | head -50

Dacă sunt erori, trimite-le la @ollama cu context: "Analizează aceste erori svelte-check și sugerează fix-uri pentru fiecare. Stack: SvelteKit 5, TypeScript, Drizzle ORM."

Dacă nu sunt erori, confirmă "Build clean, 0 erori."
