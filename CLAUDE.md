# OTS CRM — Claude Code Instructions

## Stack
SvelteKit 5, Bun, TypeScript, Drizzle ORM, libSQL (Turso), Redis, MinIO (S3)

## Convenții
- Când un prompt se termină cu "Nu scrie cod încă" → doar plan, fără implementare
- Răspunde în română dacă promptul e în română
- Respectă pattern-urile existente din proiect

## Agenți AI disponibili

### Ollama (MCP: ollama) — local, gratuit, rapid
Modele: qwen3-coder (cod), deepseek-coder-v2:lite (rapid), qwen3 (general)
Folosește pentru: boilerplate, documentare, teste, review rapid

### Gemini (CLI) — API, context mare
Folosește pentru: analiză complexă, security review, brainstorming

### Reguli de delegare
1. Task simplu/repetitiv → Ollama (qwen3-coder)
2. Analiză complexă sau fișiere mari → Gemini
3. Decizie finală și arhitectură → Claude
4. "folosește ollama" în prompt → forțează Ollama
5. "folosește gemini" în prompt → forțează Gemini
6. "compară" → trimite la ambele