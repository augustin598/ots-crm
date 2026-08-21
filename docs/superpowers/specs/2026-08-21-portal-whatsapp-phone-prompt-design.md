# Portal client: colectarea numărului de WhatsApp

Data: 2026-08-21

## Problema

Avatarele din CRM vin din WhatsApp, iar un avatar se poate găsi doar dacă știm
numărul persoanei, ținut în `user_whatsapp_link` (UNIQUE pe tenant + user).
Contactele secundare ale unui client n-au avut niciodată un loc unde să-și pună
numărul, așa că majoritatea apar cu inițiale. Administratorul le poate completa
manual sau le poate importa dintr-un grup WhatsApp, dar amândouă cer ca cineva
din agenție să știe numărul personal al fiecăruia.

Soluția: îl cerem chiar de la om, la login în portal.

## Ce construim

Un modal care apare o singură dată pe sesiune, peste dashboard, pentru
utilizatorii de portal fără număr legat. Poate fi amânat. După trei amânări nu
mai apare deloc, iar în locul lui rămâne un banner discret sub bara de sus.

Mock aprobat: `whatsapp-prompt-mock.html` (stările modalului, bannerul, toate
textele).

## Decizii

**Insistență: modal, nu pagină blocantă.** Dashboardul rămâne vizibil în spate.
Cine intră grăbit să vadă o factură apasă „Nu acum" și merge mai departe.

**Verificare soft a numărului.** La salvare, dacă sesiunea WhatsApp a tenantului
e conectată, chemăm `onWhatsApp` o singură dată. Numărul fără WhatsApp e respins
cu un mesaj care spune ce e greșit. Dacă sesiunea nu e conectată, salvăm oricum
cu `whatsappVerified = false` și reverificăm la următorul login al aceleiași
persoane. Nu blocăm niciodată omul din cauza stării sesiunii noastre.

**Contactul principal își pune numărul personal, `client.phone` rămâne neatins.**
Telefonul firmei apare pe facturi și e o dată de business. Numărul personal
merge doar în `user_whatsapp_link`. Nu sincronizăm cele două.

**Starea trăiește în baza de date, nu în localStorage**, ca amânările să nu se
reseteze când omul deschide portalul de pe alt dispozitiv.

**Același număr la doi utilizatori e permis.** Familie sau telefon comun de
birou; indexul pe telefon e deja non-unic.

**GDPR.** Utilizatorii sunt deja în platformă, invitați de clientul lor, iar
numărul servește relației contractuale. Fără casetă de bifat: o propoziție sub
câmp explică folosirea, iar `consentedAt` reține momentul. Numărul se poate
șterge din Setări.

## Model de date

Trei coloane noi pe `user_whatsapp_link`:

| Coloană | Tip | Rol |
| --- | --- | --- |
| `whatsapp_verified` | boolean, default false | a trecut de `onWhatsApp` |
| `verified_at` | timestamp, nullable | când |
| `consented_at` | timestamp, nullable | când a apăsat „Salvează" în portal |

Două coloane noi pe `client_user_preferences`:

| Coloană | Tip | Rol |
| --- | --- | --- |
| `whatsapp_prompt_dismissed_count` | integer, default 0 | de câte ori a amânat |
| `whatsapp_prompt_last_dismissed_at` | timestamp, nullable | ultima amânare |

Valoarea nouă `'self_service'` pentru `user_whatsapp_link.source`, ca să se vadă
că numărul l-a pus chiar omul, nu agenția.

## Cum decidem dacă arătăm modalul

În `client/[tenant]/+layout.server.ts`, care are deja utilizatorul și clientul.
Un singur SELECT indexat pe `user_whatsapp_link` plus preferințele, iar
rezultatul ajunge în `data`. Layoutul `(app)` randează modalul direct, fără o a
doua cerere și fără să clipească.

Regula:

- are legătură → nu arătăm nimic;
- fără legătură, sub trei amânări → modal;
- fără legătură, trei amânări sau mai multe → banner;
- bannerul se poate închide pentru sesiunea curentă.

## Funcții remote

`src/lib/remotes/client-whatsapp-phone.remote.ts`, toate cerând un utilizator de
portal autentificat, cu `tenantId` luat din `locals`:

- `setMyWhatsappPhone({ phone })` — normalizează, verifică soft, scrie legătura
  cu `source: 'self_service'` și `consentedAt`, cere avatarul. Limită: trei
  încercări la 24 de ore per utilizator, prin `checkFixedWindowLimit`.
- `dismissWhatsappPrompt()` — incrementează contorul.
- `deleteMyWhatsappPhone()` — șterge legătura (pentru Setări).

`onWhatsApp` se cheamă doar la salvare, niciodată la afișarea modalului: trafic
inutil spre WhatsApp riscă banarea sesiunii.

## Interfață

- `ClientWhatsappPhonePrompt.svelte` — modalul, montat în layoutul `(app)`.
- `ClientWhatsappPhoneBanner.svelte` — bannerul de după trei amânări.
- În Setări, un câmp „Numărul tău de WhatsApp" cu Schimbă și Șterge.

Textele sunt cele din mock, trecute prin humanizer.

## Verificare

- Teste pe decizia de afișare (are număr, zero/una/trei amânări) și pe
  normalizarea numărului.
- Teste pe comandă: refuz peste limita de încercări, respingere la număr fără
  WhatsApp, salvare cu `verified = false` când sesiunea e deconectată.
- Verificare în browser pe portalul unui client real, ambele teme.
