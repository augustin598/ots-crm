# Audit: Login Admin + Client Login + Reset Password (2026-03-11)

## Probleme Raportate

1. `/login/reset-password/TOKEN` — redirect imediat la "creare cont nou" (pagina register)
2. `/client/ots/login` — audit general

## Buguri Găsite & Fixate

### BUG 1: Reset password — lipsă pre-validare token (CRITIC)
**Fișier**: `app/src/routes/login/reset-password/[token]/+page.server.ts`
**Problemă**: Pagina returna doar `{ token }` fără a verifica dacă token-ul este valid/expirat/folosit. Utilizatorul completa formularul și primea eroare abia la submit.
**Fix**: Adăugat pre-validare: hash token → lookup în `passwordResetToken` → redirect la `/login?error=...&reset=1` dacă invalid. De asemenea, invalidează sesiunea existentă pentru a preveni chain-ul de redirect-uri.

### BUG 2: Reset password — redirect post-reset duce la pagina de register
**Fișier**: `app/src/routes/login/reset-password/[token]/+page.svelte`
**Problemă**: După reset reușit, `goto('/login')` → dacă userul avea sesiune activă, `/login` redirecta la `/` → pagina root arăta "Create Organization" (fără tenants).
**Fix**: Schimbat `goto('/login')` → `goto('/login?reset=success')` (și butonul "Go to Login").

### BUG 3: Login page — lipsă mesaj de succes după reset
**Fișier**: `app/src/routes/login/+page.svelte`
**Problemă**: Pagina citea `reset=1` pentru a arăta tab-ul de reset, dar nu gestiona `reset=success`.
**Fix**: Adăugat banner verde: "Parola a fost resetată cu succes. Te poți autentifica." când `?reset=success`.

### BUG 4: Client signup — eroare email silențioasă
**Fișier**: `app/src/lib/remotes/client-auth.remote.ts` (funcția `clientSignup`)
**Problemă**: Dacă trimiterea email-ului eșua, eroarea era logată dar funcția returna `{ success: true }`. Utilizatorul credea că signup-ul a funcționat dar nu primea niciodată magic link-ul.
**Fix**: Catch block-ul aruncă acum eroare: "Nu am putut trimite email-ul. Încearcă din nou."

### BUG 5: Token-uri magic link — email nestocat normalizat
**Fișier**: `app/src/lib/remotes/client-auth.remote.ts` (funcțiile `clientSignup` + `requestMagicLink`)
**Problemă**: Email-ul era stocat în token record exact cum era trimis de user (cu majuscule posibile), dar la verificare se folosea `.toLowerCase()`. Inconsistență.
**Fix**: Ambele funcții stochează acum `email.toLowerCase()` în token record.

## Fișiere Modificate

| Fișier | Modificare |
|--------|-----------|
| `app/src/routes/login/reset-password/[token]/+page.server.ts` | Pre-validare token + invalidare sesiune existentă |
| `app/src/routes/login/reset-password/[token]/+page.svelte` | Redirect post-reset la `/login?reset=success` |
| `app/src/routes/login/+page.svelte` | Banner succes pentru `?reset=success` |
| `app/src/lib/remotes/client-auth.remote.ts` | Fix email silent fail + normalizare email în tokens |

## Verificare

- Token invalid/expirat → redirect la `/login` cu mesaj de eroare + tab Reset pre-selectat
- Token valid → formularul de reset se afișează corect
- Submit parolă nouă → succes → redirect la `/login?reset=success` → banner verde
- Client signup cu email fail → eroare afișată utilizatorului
- Magic link tokens stochează email normalizat (lowercase)
