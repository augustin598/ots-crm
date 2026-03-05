# Audit: Client Email Uniqueness + Toast Messages (2026-03-05)

## Probleme identificate

### BUG 1: Email primar duplicat pe mai mulți clienți
- `client.email` nu avea constraint UNIQUE în DB
- `createClient` și `updateClient` nu validau unicitatea emailului
- Exemplu: `augustin598@gmail.com` setat pe 3 clienți diferiți
- **Impact**: Google OAuth login (`findOrCreateClientSession`) face `LIMIT 1` și returnează un match arbitrar → clientul se loghează pe contul greșit

### BUG 2: Lipsă toast feedback la salvare client
- Edit page folosea doar `error` div pentru erori, fără `toast.success` la salvare
- Inconsistență cu restul app-ului care folosește `svelte-sonner` toast-uri

### BUG 3: Cross-check lipsă între email primar și secundar
- Se putea adăuga un email secundar identic cu emailul primar al altui client
- Se putea seta un email primar identic cu un email secundar existent

##Fix-uri aplicate

### 1. Validare unicitate email server-side
**Fișier**: `app/src/lib/remotes/clients.remote.ts`
- `createClient`: verifică emailul contra altor clienți primari + emailuri secundare din tenant
- `updateClient`: aceeași verificare înainte de transaction când emailul se schimbă
- Import adăugat: `ne` din `drizzle-orm`
- Erori: "Acest email este deja asociat altui client." / "Acest email este deja folosit ca email secundar."

### 2. Toast messages pe edit page
**Fișier**: `app/src/routes/[tenant]/clients/[clientId]/edit/+page.svelte`
- `toast.success('Client actualizat')` înainte de redirect
- `toast.error(...)` în catch (înlocuiește error div)

### 3. Cross-check email secundar vs primar alți clienți
**Fișier**: `app/src/lib/remotes/client-secondary-emails.remote.ts`
- `createClientSecondaryEmail`: verifică dacă emailul e deja primar pe alt client din tenant
- Import adăugat: `ne` din `drizzle-orm`
- Eroare: "Acest email este deja emailul principal al altui client."

### 4. Unique index DB
**Migrare**: `app/drizzle/0063_client_email_unique.sql`
- `CREATE UNIQUE INDEX client_email_tenant_idx ON client (tenant_id, email)`
- SQLite permite multiple NULL-uri → clienți fără email nu intră în conflict
- Aplicat pe local + remote DB

### 5. Cleanup date existente (anterior)
- Fixat `clientUser` duplicat pentru GLOBAL SOCIAL PLATFORMS, Wow Agency, Meduza Agency
- Fixat emailuri duplicate în local DB (sync din remote)
- Adăugat logică `clientUser` lifecycle în `updateClient` (sync la schimbare email primar)

## Fișiere modificate
1. `app/src/lib/remotes/clients.remote.ts` — validare unicitate + `ne` import
2. `app/src/routes/[tenant]/clients/[clientId]/edit/+page.svelte` — toast success/error
3. `app/src/lib/remotes/client-secondary-emails.remote.ts` — cross-check primar alți clienți
4. `app/drizzle/0063_client_email_unique.sql` — unique index (NOU)

## Verificare
1. Setează același email pe 2 clienți → eroare toast "Acest email este deja asociat altui client."
2. Adaugă email secundar = primar alt client → eroare
3. Setează email primar = secundar existent → eroare
4. Salvare client cu succes → toast "Client actualizat"
5. DB check: `SELECT tenant_id, email, COUNT(*) FROM client WHERE email IS NOT NULL GROUP BY tenant_id, email HAVING COUNT(*) > 1` → gol
