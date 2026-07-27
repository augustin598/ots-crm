# Team Portal Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aliniază pagina de echipă din portalul clientului (`/client/[tenant]/team`) cu admin-ul (`/ots/team`): invitațiile din portal trimit email real (magic link), butonul „Permisiuni" devine funcțional, rolurile afișate provin din aceleași presete partajate, iar modulele Content și Interviuri intră în sistemul de access flags per-utilizator.

**Architecture:** Extindem `AccessFlags` cu 2 categorii noi (`content`, `interviuri`) în cele 3 locuri sincronizate (server `portal-access.ts`, mirror client `config/team.ts`, catalog `access/catalog.ts`), gate-uim rutele și sidebar-ul portalului pe ele, apoi facem invitația din portal să trimită un email cu magic link (refolosind mecanismul `magicLinkToken` + `sendMagicLinkEmail`) și înlocuim toast-ul „în curând" cu un modal real de permisiuni per-membru (refolosind `updateClientSecondaryEmailAccess`, care deja autorizează contactul primar).

**Tech Stack:** SvelteKit 5 (runes), Bun, Drizzle/libSQL, valibot, remote functions (`query`/`command`), `bun test` pentru module pure.

**Decizii luate (documentate pentru user):**
- Categoriile noi `content`/`interviuri` sunt **false implicit** pentru contactele secundare existente (secure-by-default, pattern F8); contactul primar are mereu totul. Adminul/primarul le poate activa din editoarele de flags.
- Presete: `owner` → content+interviuri ON; `manager` → content+interviuri ON; `marketing` → content ON, interviuri OFF; `viewer` → ambele OFF.
- Invitația din portal folosește magic link (același flux de login ca restul portalului), nu parolă.
- Rolurile portalului devin cele partajate din `CLIENT_ROLE_PRESETS` (Proprietar/Manager/Marketing/Vizitator) — hardcodarea locală owner/admin/member/viewer dispare (era divergentă și ne-persistată).

---

### Task 1: Categorii noi `content` + `interviuri` în access flags (shared/client mirror)

**Files:**
- Test: `src/lib/config/__tests__/team-access-categories.test.ts` (create)
- Modify: `src/lib/config/team.ts`
- Modify: `src/lib/access/catalog.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/config/__tests__/team-access-categories.test.ts
import { describe, it, expect } from 'bun:test';
import {
	ACCESS_CATEGORIES,
	CLIENT_ROLE_PRESETS,
	detectClientRolePreset
} from '$lib/config/team';
import {
	CAPABILITY_IDS,
	legacyFlagsToCapabilities,
	capabilitiesToLegacyFlags,
	routeRequiresCapability,
	CLIENT_PRESET_CAPABILITIES
} from '$lib/access/catalog';

describe('access categories: content + interviuri', () => {
	it('mirror-ul client conține content și interviuri', () => {
		expect(ACCESS_CATEGORIES).toContain('content');
		expect(ACCESS_CATEGORIES).toContain('interviuri');
	});

	it('fiecare preset definește toate categoriile (fără chei lipsă)', () => {
		for (const preset of CLIENT_ROLE_PRESETS) {
			for (const cat of ACCESS_CATEGORIES) {
				expect(typeof preset.flags[cat]).toBe('boolean');
			}
		}
	});

	it('presetele au valorile decise pentru categoriile noi', () => {
		const byId = Object.fromEntries(CLIENT_ROLE_PRESETS.map((p) => [p.id, p.flags]));
		expect(byId.owner.content).toBe(true);
		expect(byId.owner.interviuri).toBe(true);
		expect(byId.manager.content).toBe(true);
		expect(byId.manager.interviuri).toBe(true);
		expect(byId.marketing.content).toBe(true);
		expect(byId.marketing.interviuri).toBe(false);
		expect(byId.viewer.content).toBe(false);
		expect(byId.viewer.interviuri).toBe(false);
	});

	it('detectClientRolePreset rămâne stabil cu categoriile noi', () => {
		const owner = CLIENT_ROLE_PRESETS.find((p) => p.id === 'owner')!;
		expect(detectClientRolePreset({ ...owner.flags })).toBe('owner');
		expect(detectClientRolePreset({ ...owner.flags, interviuri: false })).toBe('custom');
	});

	it('catalogul are capabilitățile portal.content.view / portal.interviuri.view', () => {
		expect(CAPABILITY_IDS).toContain('portal.content.view');
		expect(CAPABILITY_IDS).toContain('portal.interviuri.view');
	});

	it('conversia legacy flags ↔ capabilities acoperă categoriile noi', () => {
		const caps = legacyFlagsToCapabilities({ content: true, interviuri: true });
		expect(caps).toContain('portal.content.view');
		expect(caps).toContain('portal.interviuri.view');
		const flags = capabilitiesToLegacyFlags(['portal.content.view']);
		expect(flags.content).toBe(true);
		expect(flags.interviuri).toBe(false);
	});

	it('rutele /content și /interviuri cer capabilitățile corespunzătoare', () => {
		expect(routeRequiresCapability('/client/ots/content', 'ots')).toBe('portal.content.view');
		expect(routeRequiresCapability('/client/ots/content/abc/editor', 'ots')).toBe('portal.content.view');
		expect(routeRequiresCapability('/client/ots/interviuri', 'ots')).toBe('portal.interviuri.view');
	});

	it('presetele din catalog includ noile capabilități conform deciziei', () => {
		expect(CLIENT_PRESET_CAPABILITIES.owner).toContain('portal.content.view');
		expect(CLIENT_PRESET_CAPABILITIES.owner).toContain('portal.interviuri.view');
		expect(CLIENT_PRESET_CAPABILITIES.marketing).toContain('portal.content.view');
		expect(CLIENT_PRESET_CAPABILITIES.marketing).not.toContain('portal.interviuri.view');
		expect(CLIENT_PRESET_CAPABILITIES.viewer).not.toContain('portal.content.view');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/config/__tests__/team-access-categories.test.ts`
Expected: FAIL („content" absent din ACCESS_CATEGORIES etc.)

- [ ] **Step 3: Implement — `src/lib/config/team.ts`**

Adaugă `'content', 'interviuri'` la finalul `ACCESS_CATEGORIES`; adaugă `content: true, interviuri: true` în `ALL_ACCESS_TRUE`; `content: false, interviuri: false` în `NO_ACCESS`. Actualizează presetele:
- `manager.flags`: adaugă `content: true, interviuri: true` în overrides.
- `marketing.flags`: adaugă `content: true`.
- (`owner` folosește `ALL_ACCESS_TRUE`; `viewer` moștenește false din `NO_ACCESS`.)

- [ ] **Step 4: Implement — `src/lib/access/catalog.ts`**

În `CAPABILITY_CATALOG` (după `portal.hosting.view`):

```ts
	{
		id: 'portal.content.view',
		domain: 'portal',
		groupLabel: 'Campanii & Marketing',
		label: 'Content',
		description: 'Modulul Content AI — articole, brief-uri, publicare (dacă adminul a activat Acces AI).'
	},
	{
		id: 'portal.interviuri.view',
		domain: 'portal',
		groupLabel: 'Cont companie',
		label: 'Interviuri',
		description: 'Vezi și gestionează interviurile programate ale companiei.'
	},
```

În `CLIENT_PRESET_CAPABILITIES`: owner += ambele; manager += ambele; marketing += `portal.content.view`.
În `LEGACY_FLAG_TO_CAP`: `content: 'portal.content.view'`, `interviuri: 'portal.interviuri.view'`.
În `routeRequiresCapability`, înainte de `return null`: `if (rest.startsWith('/content')) return 'portal.content.view';` și `if (rest.startsWith('/interviuri')) return 'portal.interviuri.view';`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/lib/config/__tests__/team-access-categories.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/config/team.ts src/lib/access/catalog.ts src/lib/config/__tests__/team-access-categories.test.ts
git commit -m "feat(access): categorii content + interviuri în access flags și catalog"
```

### Task 2: Server-side gating pe categoriile noi

**Files:**
- Modify: `src/lib/server/portal-access.ts`
- Modify: `src/lib/remotes/client-secondary-emails.remote.ts`
- Modify: `src/routes/client/[tenant]/+layout.server.ts` (gate `contentEnabled`/`interviuriEnabled` pe access flags)
- Modify: `src/routes/client/[tenant]/(app)/+layout.svelte` (sidebar folosește flag-urile combinate)

- [ ] **Step 1: `portal-access.ts` — extinde tipul + liste + rute**

`AccessCategory` += `'content' | 'interviuri'`; `ACCESS_CATEGORIES` += ambele; `ALL_ACCESS_TRUE` += `content: true, interviuri: true`; `NO_ACCESS` += ambele false. Fallback-ul legacy din `resolveAccessFlags` rămâne (categoriile noi pică pe false din `NO_ACCESS`). În `routeRequiresAccess`: `if (rest.startsWith('/content')) return 'content';` și `if (rest.startsWith('/interviuri')) return 'interviuri';` — layout-ul `(app)/+layout.server.ts` le va aplica automat (nu se modifică).

- [ ] **Step 2: `client-secondary-emails.remote.ts` — schema + fallback-uri**

`accessFlagsSchema` += `content: v.boolean(), interviuri: v.boolean()`. Fallback-ul din `getClientSecondaryEmails` (obiectul construit din notify*) += `content: false, interviuri: false`.

- [ ] **Step 3: `+layout.server.ts` (portal root) — combină client-level cu user-level**

`contentEnabled`/`interviuriEnabled` rămân condiția de nivel client; sidebar-ul trebuie să vadă și flag-ul per-user. Nu schimbăm semnificația: returnăm în plus nimic — combinarea se face în `(app)/+layout.svelte` cu `accessFlags` deja returnate. (Nicio modificare aici dacă `accessFlags` conțin deja categoriile noi — verifică doar că `NO_ACCESS` importat include noile chei.)

- [ ] **Step 4: `(app)/+layout.svelte` — sidebar gating**

Itemul Content: condiția devine `data.contentEnabled && access.content`. Itemul Interviuri: `data.interviuriEnabled && access.interviuri`.

- [ ] **Step 5: Verificare rapidă tip**

Run: `bunx tsc --noEmit -p . 2>&1 | grep -i "portal-access\|client-secondary" | head`
Expected: fără erori pe fișierele modificate (svelte-check complet vine la final).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/portal-access.ts src/lib/remotes/client-secondary-emails.remote.ts "src/routes/client/[tenant]/(app)/+layout.svelte"
git commit -m "feat(portal): gate per-user pe content și interviuri (rute + sidebar)"
```

### Task 3: Invitația din portal trimite email real (magic link)

**Files:**
- Modify: `src/lib/server/email.ts` (funcție nouă `sendClientTeamInviteEmail`)
- Modify: `src/lib/remotes/client-secondary-emails.remote.ts` (create acceptă `accessFlags` + `sendInvite`)
- Modify: `src/lib/components/client-team/client-team-invite-modal.svelte`
- Create: `scripts/demo-client-team-invite-email.ts` (regula: orice template email nou are demo preview)

- [ ] **Step 1: `email.ts` — template invitație portal**

Funcție nouă lângă `sendMagicLinkEmail` (refolosește stilul existent al template-urilor RO):

```ts
export async function sendClientTeamInviteEmail(
	email: string,
	token: string,
	tenantSlug: string,
	clientName: string,
	inviterName: string
): Promise<void>
```

Corp: „{inviterName} te-a invitat în portalul {clientName}", buton „Accesează portalul" → `${baseUrl}/client/${tenantSlug}/verify?token=...`, mențiune expirare (aceeași `MAGIC_LINK_EXPIRY_HOURS`) și că linkul e personal. Trimitere prin același mecanism ca `sendMagicLinkEmail` (`sendMailWithRetry`/persistență — copiază pattern-ul din funcția existentă).

- [ ] **Step 2: `createClientSecondaryEmail` — flags atomice + invitație opțională**

Schema: `accessFlags: v.optional(accessFlagsSchema)`, `sendInvite: v.optional(v.boolean())`. La insert, dacă `accessFlags` e prezent: scrie `accessFlags: JSON.stringify(sanitized)` + dual-write notify* (același sanitize ca în `updateClientSecondaryEmailAccess` — extrage un helper local `sanitizeFlags(flags)`). Dacă `sendInvite`: generează token magic link (același pattern din `requestMagicLink`: `generateMagicLinkToken`+`hashToken` — importă din `$lib/server/client-auth` sau replică helperii locali existenți acolo unde sunt exportați), inserează `magicLinkToken` cu `matchedClientIds: JSON.stringify([clientId])`, apoi `sendClientTeamInviteEmail(...)` în try/catch: dacă emailul eșuează, NU șterge rândul secondary — returnează `{ success: true, id, inviteSent: false }` ca UI-ul să anunțe corect. Numele inviter-ului: `event.locals.user.firstName + lastName` cu fallback email.

- [ ] **Step 3: Modalul din portal — un singur call, mesaj corect**

`handleInvite` devine un singur apel `createClientSecondaryEmail({ clientId, email, accessFlags: preset.flags, sendInvite: true })`; toast: `inviteSent ? 'Invitație trimisă la X' : 'Membru adăugat, dar emailul nu a putut fi trimis — regenerează invitația'`. Șterge pasul 2 (`updateClientSecondaryEmailAccess`) și `ROLE_FLAGS` hardcodat — rolurile vin din `CLIENT_ROLE_PRESETS` (Task 4).

- [ ] **Step 4: Demo preview email**

`scripts/demo-client-team-invite-email.ts` — randează HTML-ul template-ului cu date mock și îl scrie în `/tmp`… nu: folosește scratchpad/`demo-output/` ca la celelalte `demo-*-email.ts` existente (verifică un exemplu existent din `scripts/` și copiază pattern-ul de output).

- [ ] **Step 5: Verificare manuală a template-ului**

Run: `bun --bun scripts/demo-client-team-invite-email.ts` și deschide HTML-ul generat.
Expected: subiect + corp RO corecte diacritic, link `/client/ots/verify?token=DEMO`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/email.ts src/lib/remotes/client-secondary-emails.remote.ts src/lib/components/client-team/client-team-invite-modal.svelte scripts/demo-client-team-invite-email.ts
git commit -m "feat(portal): invitația de coleg trimite email real cu magic link"
```

### Task 4: Roluri partajate + card-uri corecte în portal

**Files:**
- Modify: `src/routes/client/[tenant]/(app)/team/+page.svelte`
- Modify: `src/lib/components/client-team/client-team-invite-modal.svelte` (props roluri)

- [ ] **Step 1: Elimină `ROLE_DEFS` hardcodat**

În `+page.svelte`: importă `CLIENT_ROLE_PRESETS`, `CLIENT_CUSTOM_PILL`, `detectClientRolePreset` din `$lib/config/team`. `members` mapează și `flags: s.accessFlagsResolved`; rolul afișat = `detectClientRolePreset(flags)` → preset sau `CLIENT_CUSTOM_PILL`. Chips-urile de filtrare se generează din `CLIENT_ROLE_PRESETS` + pill „Custom" (count calculat pe detectare). `roleFilter` filtrează pe rolul detectat.

- [ ] **Step 2: Modalul primește presetele**

Pagina pasează `roles={CLIENT_ROLE_PRESETS}`; modalul folosește `preset.flags` direct (deja făcut în Task 3 Step 3 — aici doar tipul propsului: `RoleOption` devine `{ id, label, desc, color, flags }` aliniat la `ClientRolePresetDef`).

- [ ] **Step 3: Commit**

```bash
git add "src/routes/client/[tenant]/(app)/team/+page.svelte" src/lib/components/client-team/client-team-invite-modal.svelte
git commit -m "fix(portal): rolurile echipei vin din CLIENT_ROLE_PRESETS și se detectează din flags"
```

### Task 5: Butonul „Permisiuni" funcțional în portal

**Files:**
- Create: `src/lib/components/client-team/client-team-permissions-modal.svelte`
- Modify: `src/routes/client/[tenant]/(app)/team/+page.svelte`
- Modify: `src/lib/components/team/TeamClientPanel.svelte` (labels categorii noi)
- Modify: `src/lib/components/team/TeamPermissionsMatrix.svelte` (dacă afișează matricea client — verifică; categoriile noi apar automat dacă e generată din catalog)

- [ ] **Step 1: Componenta modal permisiuni**

Modal (pattern vizual identic cu `client-team-invite-modal.svelte`: overlay + focusTrap + Închide) care listează `getClientSecondaryEmails(clientId)` cu: email, pill rol detectat, grid de toggle-uri per categorie (labels RO — reia maparea din `TeamClientPanel.CATEGORY_LABELS` + `content: 'Content'`, `interviuri: 'Interviuri'`; mută maparea în `$lib/config/team.ts` ca `ACCESS_CATEGORY_LABELS` exportat, ca să nu existe 3 copii). Toggle → `updateClientSecondaryEmailAccess({ secondaryEmailId, accessFlags }).updates(query)` cu toast pe succes/eroare. Notă vizibilă: „Contactul principal are automat acces complet."

- [ ] **Step 2: Wire în pagină**

`onPermissionsClick={() => (permissionsOpen = true)}` — șterge toast-ul „va fi disponibilă în curând".

- [ ] **Step 3: `TeamClientPanel.svelte` + orice hartă de labels**

Înlocuiește `CATEGORY_LABELS` local cu importul `ACCESS_CATEGORY_LABELS` din `$lib/config/team`; adaugă cele două chei în fallback-ul `flagsFromRow` (sau mai bine: `{ ...NO_ACCESS }` exportat din config).

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/client-team/client-team-permissions-modal.svelte "src/routes/client/[tenant]/(app)/team/+page.svelte" src/lib/components/team/TeamClientPanel.svelte src/lib/config/team.ts
git commit -m "feat(portal): modal funcțional Roluri & Permisiuni în pagina echipei"
```

### Task 6: Verificare completă

- [ ] Run: `bun test` → toate testele pass (inclusiv cel nou).
- [ ] svelte-autofixer pe fiecare componentă .svelte modificată/creată.
- [ ] `/build-check` (svelte-check heap 8GB) — fără erori noi peste baseline 16 err/56 warn.
- [ ] testermcp: login portal (client user), pagina `/client/ots/team`: invită un email de test → verifică toast + rând nou + email în outbox/log; deschide modalul Permisiuni → toggle o categorie → reload → persistă; verifică sidebar-ul unui secondary fără `interviuri` că nu vede tab-ul și că `/client/ots/interviuri` direct dă 403/redirect.
- [ ] Commit final dacă au ieșit fixuri din verificare.
