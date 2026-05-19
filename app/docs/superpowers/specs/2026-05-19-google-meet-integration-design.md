# Google Meet Auto-Generation — Design Spec (v2 — Separate Module)

**Date:** 2026-05-19
**Status:** v2 approved — implementation plan rewritten
**Effort estimate:** ~3 days (~25-31h)
**Revision rationale:** User decision to make Calendar a **separate integration module** with its own OAuth flow, dedicated settings page, and dedicated DB table — rather than extending the Gmail OAuth scope. Same Google account (typically), but independent connection lifecycle.

## Goal

When a user creates a task with `type='meeting'`, the system auto-generates a Google Meet link by creating a Google Calendar event. Calendar integration is a **standalone module** that the tenant connects separately from Gmail (using the same Google account, by recommendation but not enforcement). Bidirectional sync: changes to the task's meeting time/duration/assignees propagate to the Calendar event; task deletion deletes the event.

## Non-Goals (v1)

- Per-tenant calendar picker (always use primary)
- Recurring meetings → recurring Calendar events
- RSVP tracking from Google back to CRM
- Custom invitation email templates
- Working-hours validation
- Cross-account warning (UI does NOT actively verify Calendar account = Gmail account; documented recommendation only)

---

## §1. Integration Architecture — Standalone Calendar Module

**Decision: separate `google_calendar_integration` table + dedicated OAuth flow + dedicated settings page.**

### Why separate (vs. extending Gmail scope)
- **Independent lifecycle:** tenant can have Gmail without Calendar or vice versa; revoke/reconnect one without affecting the other
- **Cleaner mental model for users:** "Email" and "Calendar" are visibly separate features in UI
- **No existing-tenant disruption:** Gmail-connected tenants do NOT need to re-consent; they connect Calendar additionally if they want Meet
- **Simpler scope checking:** Calendar tokens have `calendar.events`. The row's existence implies the scope was granted
- **Token refresh and error handling isolated per integration**

### Connection assumption
- Tenant typically uses the **same Google account** for Gmail + Calendar (Workspace account)
- UI does **NOT verify** the two emails match. Documented as recommendation, not enforced.

## §2. Database Schema

### New table: `google_calendar_integration`

```ts
export const googleCalendarIntegration = sqliteTable('google_calendar_integration', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenant.id),
    email: text('email').notNull(),
    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    lastRefreshAttemptAt: timestamp('last_refresh_attempt_at', { withTimezone: true, mode: 'date' }),
    lastRefreshError: text('last_refresh_error'),
    consecutiveRefreshFailures: integer('consecutive_refresh_failures').default(0),
    grantedScopes: text('granted_scopes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
        .notNull()
        .default(sql`current_timestamp`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
        .notNull()
        .default(sql`current_timestamp`)
});
```

Notes vs. `gmail_integration`:
- Encrypted tokens are **mandatory** (no legacy plain-text columns)
- No sync-related columns — Calendar is write-only, no inbound sync
- One Calendar connection per tenant

### Modified table: `task` — add `googleCalendarEventId`

```ts
googleCalendarEventId: text('google_calendar_event_id')
```

### Migrations (Turso one-statement per file)

- `0336_task_google_calendar_event_id.sql` — single ALTER
- `0337_create_google_calendar_integration.sql` — full CREATE TABLE
- `meta/_journal.json` — 2 new entries

## §3. OAuth Flow — Separate from Gmail

**Start endpoint:** `GET /api/integrations/google-calendar/auth`

Mirrors Gmail OAuth start pattern. Returns Google consent URL with:
- Scope: ONLY `https://www.googleapis.com/auth/calendar.events`
- `access_type: 'offline'`, `prompt: 'consent'`, `state: tenantId`

**Callback endpoint:** `GET /api/integrations/google-calendar/callback`

- Verify `state` matches `event.locals.tenant.id`
- Exchange code for tokens
- Fetch user email via `oauth2.userinfo.get()`
- Encrypt tokens via `encryptVerified(tenantId, token)`
- Delete-then-insert row in `google_calendar_integration` (upsert per tenant)
- Redirect to `/[tenant]/settings/google-calendar?status=connected`

## §4. Calendar Configuration

- **Target calendar:** primary
- **Timezone:** `tenant.timezone` if column exists; else `Europe/Bucharest`
- **Notification:** `sendUpdates: 'all'`
- **Conference:** `conferenceData.createRequest.conferenceSolutionKey.type = 'hangoutsMeet'`

## §5. Attendees — auto-derived

| Trigger | Attendees |
|---|---|
| `createTask({type:'meeting'})` wizard | Agency assignees + client primary email |
| `scheduleMeet` admin modal | Same |
| `client-task-meet-modal.svelte` invite picker | User-selected (existing UI) |

## §6. Trigger Points & Sync (V1+V2 in one)

| Event | Calendar action |
|---|---|
| `createTask` saved with `type='meeting'` + connected | Create event with Meet; persist `meetLink` + `googleCalendarEventId` |
| `scheduleMeet` on task w/o `googleCalendarEventId` | Same |
| `updateTask` changes meetTime/duration/assignees on task with event | `events.patch` |
| `updateTask` changes `type` from `meeting` to other | Delete event, clear DB fields |
| `updateTask` promotes to `type='meeting'` with meetTime | Create event |
| Task `delete` | Delete event pre-DB-delete (best-effort) |

**Failure handling:** DB writes always succeed; Calendar errors logged via `recordTaskActivity` with `meet_event_failed` action. If `CalendarNotConnected` thrown, skip silently (expected state).

## §7. New Code Surface

**New server module:** `src/lib/server/google-calendar/`
- `auth.ts` — `getCalendarStatus`, `getCalendarClient`, `getOAuthUrl`, `exchangeCodeAndSave`, `disconnectCalendar`
- `meet.ts` — `createMeetEvent`, `updateMeetEvent`, `deleteMeetEvent`
- `__tests__/meet.test.ts` — 5 unit tests

**New routes:**
- `src/routes/api/integrations/google-calendar/auth/+server.ts`
- `src/routes/api/integrations/google-calendar/callback/+server.ts`
- `src/routes/[tenant]/settings/google-calendar/+page.svelte`
- `src/routes/[tenant]/settings/google-calendar/+page.server.ts`

**Modified files:**
- `src/lib/server/db/schema.ts` — `googleCalendarIntegration` table + relations + `task.googleCalendarEventId`
- `drizzle/0336_*.sql`, `drizzle/0337_*.sql`, `drizzle/meta/_journal.json`
- `src/lib/remotes/tasks.remote.ts` — hooks in createTask/scheduleMeet/updateTask/deleteTask
- `src/lib/remotes/integrations.remote.ts` — `getGoogleCalendarStatus()` query
- `src/lib/server/task-activity.ts` — register `meet_event_*` action types
- `src/lib/components/create-task-dialog.svelte` — 2-state banner
- `src/lib/components/task-detail/task-detail-body.svelte` — admin Meet modal
- `src/lib/components/client-task/client-task-meet-modal.svelte` — client Meet modal

**Removed from v1 plan:**
- ~~Gmail SCOPES extension~~ (not needed)
- ~~Gmail settings page re-consent banner~~ (replaced by dedicated Calendar settings page)

## §8. Multi-Tenant Safety

- `google_calendar_integration.tenantId` is the tenant scope
- All queries `WHERE tenant_id = event.locals.tenant.id`
- `getCalendarClient(tenantId)` ALWAYS uses passed `tenantId`
- Calendar event IDs never accepted from request body
- OAuth `state` parameter = tenantId, verified in callback against `event.locals.tenant.id`

## §9. UI — 2-state model

**Banner copy (Meet modals + create-task-dialog):**

| State | UI |
|---|---|
| **Not connected** | Amber: "Conectează Google Calendar pentru auto-generare Meet. [Conectează]" → `/[tenant]/settings/google-calendar` |
| **Connected** | Green: "✓ Linkul Meet va fi generat automat (cont {email})" |

**Settings page `/settings/google-calendar`:**
- Status card: "Conectat ca {email}" (green) OR "Nu este conectat" (gray)
- Connect button (when not connected) → OAuth start
- Disconnect button (when connected) → sets `isActive=false`
- Note: "Folosește același cont Google ca Gmail pentru consistență"

## §10. Testing

- **Unit tests** (Bun, mocked googleapis):
  - createMeetEvent happy
  - createMeetEvent — `CalendarNotConnected` thrown → caller can catch
  - updateMeetEvent happy (patch)
  - deleteMeetEvent happy
  - deleteMeetEvent — 404 idempotent
- **Multi-tenant smoke:** assert tenant A cannot fetch B's integration row
- **Post-deploy manual checklist** at `app/docs/superpowers/meet-integration-smoke-checklist.md`

## §11. Effort Breakdown

| Phase | Scope | Effort |
|---|---|---|
| 1. Schema | `google_calendar_integration` table + `task.googleCalendarEventId` + 2 migrations | ~2h |
| 2. `auth.ts` | client + status + OAuth helpers + disconnect | ~3-4h |
| 3. `meet.ts` 3 fns + 5 tests | TDD per function | ~4-5h |
| 4. OAuth routes (start + callback) | start + callback endpoints | ~3h |
| 5. Settings page | UI + load + actions | ~3h |
| 6. `createTask` + `scheduleMeet` hooks | Post-insert + audit | ~3h |
| 7. `updateTask` + `deleteTask` hooks | Diff + bidirectional sync | ~4-5h |
| 8. UI conditional 2-state banners | 3 components | ~2h |
| 9. Tests + smoke + verification | Final pass | ~2h |
| **TOTAL** | | **~26-31h, ~3 days** |

## §12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| User connects Calendar with different account than Gmail | Document recommendation; no enforcement; both work independently |
| Token refresh race during Calendar call | Reuse googleapis OAuth2Client auto-refresh; existing pattern |
| User edits task rapidly; first event still creating | Sequential `await` after task insert; simple v1 |
| Calendar event manually deleted in Google | `updateMeetEvent` 404 → log `meet_event_orphaned`, clear `googleCalendarEventId`, surface in UI |
| Calendar API quota (1M req/day) | Per-project; ~50 tenants far below |
| Client portal users invoking admin mutations | All `isClientUser` blocks already in place from prior hotfix |

---

## Spec Self-Review

- **Placeholder scan:** none
- **Internal consistency:** §6 trigger table + §7 modified files align
- **Scope check:** single subsystem (Calendar Meet)
- **Ambiguity check:** §1 "same account" = recommendation only, not enforced; §4 "primary calendar" = Google Calendar default per-user; §9 UI states are mutually exclusive (no scope-missing state needed since v1's 3-state collapsed to 2-state)
