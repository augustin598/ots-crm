# WhatsApp Profile Pictures — Design

**Status:** Approved for implementation planning
**Date:** 2026-04-24
**Area:** `app/src/lib/server/whatsapp/`, `app/src/routes/[tenant]/whatsapp/`, `app/src/lib/components/`

## Problem

The WhatsApp integration currently displays only `name + phone` in the conversations list and thread header. When a WhatsApp contact is linked to a CRM client by phone number, no avatar propagates to the client's profile either. We want profile pictures from WhatsApp to appear in both the WA UI and — when phone matches a CRM client — to become the client's avatar across the CRM.

## Goals

- Show contact profile picture in WhatsApp conversations list and thread header.
- When a matching CRM client exists (phone-match), propagate the picture as the client's avatar everywhere the client appears in the CRM (client list, client profile, invoice previews, etc. — anywhere the client has a name, it should get the avatar).
- Fall back to colored initials when no picture is available or the user has hidden it.
- Respect Baileys rate-limits; no synchronous blocking of UI.

## Non-goals

- Group chat avatars (current WhatsApp scope is 1:1 conversations).
- User-uploaded overrides for client avatars (can be added later; for now WhatsApp is authoritative when a match exists).
- Cross-tenant avatar sharing.

## Data model

### `whatsapp_contact` — 4 new columns

```ts
avatarPath:      text('avatar_path')          // MinIO key or null
avatarMimeType:  text('avatar_mime_type')     // typically 'image/jpeg'
avatarFetchedAt: timestamp('avatar_fetched_at', { withTimezone: true, mode: 'date' })
avatarHidden:    integer('avatar_hidden', { mode: 'boolean' }).default(false)
```

### `client` — 2 new columns

```ts
avatarPath:    text('avatar_path')                        // MinIO key or null
avatarSource:  text('avatar_source').default('whatsapp')  // 'whatsapp' | 'manual' — forward-compat for manual-override
```

Auto-sync from WhatsApp only overwrites `client.avatarPath` when `avatarSource = 'whatsapp'`. Setting `avatarSource = 'manual'` (future manual-upload feature) locks the avatar from WA overwrites.

### Migrations

6 separate migration files (Turso one-statement-per-file rule):

1. `add_whatsapp_contact_avatar_path.sql`
2. `add_whatsapp_contact_avatar_mime_type.sql`
3. `add_whatsapp_contact_avatar_fetched_at.sql`
4. `add_whatsapp_contact_avatar_hidden.sql`
5. `add_client_avatar_path.sql`
6. `add_client_avatar_source.sql`

## Fetch pipeline

### Module: `src/lib/server/whatsapp/avatar-fetcher.ts`

In-memory FIFO queue per tenant, with a **global rate ceiling** layered on top:

- `enqueueFetch(tenantId, phoneE164): void` — idempotent. Dedup checks BOTH the pending queue AND an in-flight `Set<phoneE164>` per tenant (prevents double-fetch when `contacts.update` fires mid-fetch for a lazy-triggered phone).
- Per-tenant worker loop, serial, **3s pacing** between jobs (per Baileys research).
- Global token bucket — **1 req/s hard ceiling across all tenants** — protects against a burst when 50 tenants each have a queue ready. Per-tenant worker awaits a global token before calling Baileys.
- On `stopSession(tenantId)` — drop pending + in-flight for that tenant.
- Volatile by design. Process restart loses pending fetches; lazy-trigger picks them up on next conversation view.

### Triggers (3 entry points)

1. **Lazy on-demand** — `listWhatsappConversations` enqueues fetches for contacts where `avatarPath IS NULL AND (avatarHidden = false OR avatarFetchedAt < now() - 7 days)`. The staleness guard prevents hammering WhatsApp on every refresh for contacts that permanently hid their photo — we'll retry weekly in case they re-enable it. Query returns immediately; UI shows initials until the fetch completes and polling (existing 3s refresh) picks up the path.

2. **Reactive** — `session-manager.ts` registers a `contacts.update` handler:
   - `imgUrl === 'changed'` → `enqueueFetch(tenantId, phoneE164)`
   - `imgUrl === null` → clear `avatarPath` on `whatsapp_contact`, set `avatarHidden = true`, **delete the MinIO object** (privacy — don't keep a removed photo around); if a matching client has `avatarSource = 'whatsapp'`, clear `client.avatarPath` too (leave `avatarSource = 'whatsapp'` so a future re-upload re-propagates)

3. **Initial history sync** — `messaging-history.set` can emit hundreds of contacts at once. Do NOT auto-enqueue all of them (rate-limit storm). Lazy-trigger (1) handles them naturally when the user views the conversations list.

### Worker — `fetchAndStoreAvatar(tenantId, phoneE164)`

1. Resolve `sock` via `sessions.get(tenantId)`. If absent, drop the job.
2. JID = `e164ToJid(phoneE164)`.
3. `await sock.profilePictureUrl(jid, 'preview', 8000)` inside try/catch:
   - Returns `undefined` OR throws 404 → mark `avatarHidden = true`, `avatarFetchedAt = now()`, stop.
   - Throws 429 → re-enqueue with 30s delay, max **1 retry**, then mark `avatarFetchedAt = now()` and stop (don't retry-storm).
   - Other errors → log to `debugLog` table, set `avatarFetchedAt = now()`, stop.
4. `fetch(url)` with `AbortSignal.timeout(10000)` (memory rule: external fetch timeouts).
5. **Validate magic bytes** on the first 12 bytes of the buffer — accept JPEG (`FF D8 FF`), PNG (`89 50 4E 47`), WebP (`RIFF...WEBP`). Reject anything else (guards against corruption / empty / HTML error pages masquerading as images). Detected MIME becomes `avatarMimeType`.
6. Upload to MinIO at `{tenantId}/whatsapp/avatars/{phoneE164}.jpg` (stable path — overwrites previous).
7. Update `whatsapp_contact SET avatarPath, avatarMimeType, avatarFetchedAt = now(), avatarHidden = false`.
8. **Propagate to client:** resolve CRM client via the same normalized-phone logic used for message linking (`phoneE164Variants` fast path + `tryToE164` normalized fallback). On match where `client.avatarSource = 'whatsapp'` (default), `UPDATE client SET avatarPath` to the same MinIO key. Never overwrite when `avatarSource = 'manual'`.

Choice of `'preview'` over `'image'`: lower rate-limit risk, never displayed above 96px, less likely to be blocked by privacy settings.

## Storage & serving

### Paths

- Stable: `{tenantId}/whatsapp/avatars/{phoneE164}.jpg`
- Overwrite on re-fetch — no versioning
- Both `whatsapp_contact.avatarPath` and `client.avatarPath` point to the same MinIO key when the client is linked

### Serving — SvelteKit proxy (not 302 redirect)

Proxying through a SvelteKit endpoint is better than redirecting to a presigned URL for small images:
- Browser cache is stable (no per-request presigned URL churn)
- MinIO access stays server-side
- Image size is ~5-30 KB — streaming cost negligible

New endpoint `src/routes/[tenant]/api/whatsapp/avatar/[phoneE164]/+server.ts`:

- Auth: tenant member
- Look up `whatsapp_contact.avatarPath`, return 404 if null
- `GetObject` from MinIO, stream bytes in response
- Headers: `Content-Type: <avatarMimeType>`, `Cache-Control: private, max-age=3600`, `ETag: <avatarFetchedAt timestamp>`
- Handle `If-None-Match` → 304

Second endpoint `src/routes/[tenant]/api/clients/[clientId]/avatar/+server.ts`:

- Same pattern, reads `client.avatarPath`

Both use SvelteKit's `[tenant]` scoping (memory rule — no top-level `/api/*`).

## UI

### New component: `src/lib/components/ui/contact-avatar.svelte`

Props:

```ts
{
  src: string | null;         // URL to image (null → show initials)
  name: string;               // For initials + aria-label
  phoneE164?: string | null;  // Seed for color hash (falls back to name)
  size?: 'sm' | 'md' | 'lg';  // 32/40/48 px
}
```

Behavior:

- If `src` present → `<img>` with lazy loading, fallback on error to initials
- Otherwise → 2 initials from `name` (first letter of first 2 words, or first 2 letters), background color from a deterministic hash of `phoneE164 ?? name` picking from a fixed palette (~8 colors) for visual consistency
- Accessible: `alt` = `name`, role="img"

### Integration points

1. WA conversations list — before the name
2. WA thread header — before the name
3. Client list, client profile page, anywhere a client name is shown alongside contact info — pass `client.avatarPath` through a presigned-URL helper (or use the serving endpoint)

## Error handling & observability

Per `api-integrations` skill:

- **Transient vs permanent:** 404 / "hidden" → permanent (mark `avatarHidden`); 429 → transient (1 retry with backoff); network → log and skip (no retry storm)
- **Per-tenant isolation:** queue is keyed by tenantId; one tenant's 429 storm can't starve others
- **Debug log:** fetches that fail unexpectedly write to the `debugLog` table, redacted (no URL tokens)
- **No circuit breaker needed at this layer** — the queue serializes fetches and max-1-retry on 429 is the natural breaker

## Privacy fallback

When `avatarHidden = true` OR `avatarPath IS NULL`, the UI shows initials (per section above). Users who hide their WA photo get consistent initials. No "last known" fallback — if a photo is removed upstream we clear our copy.

## Rollout

1. Migrations (5 files)
2. Module `avatar-fetcher.ts`
3. Hook `contacts.update` in `session-manager.ts`
4. Serving endpoints (2)
5. `ContactAvatar.svelte` component
6. Wire UI into WA list + thread header
7. Wire into client pages (separate PR-scope — can land later without blocking WA part)
8. **Backfill** (optional one-shot script): for existing linked clients, enqueue a fetch for their phone when the WA session is open. Simpler than a dedicated script — just wait for users to open the conversation.

## Out of scope for this spec

- Group avatars
- Manual avatar upload for clients (would require a separate UI + decide precedence between manual upload and WA sync)
- Avatar versioning / history
- Thumbnail vs full-size distinction (we only store preview)
