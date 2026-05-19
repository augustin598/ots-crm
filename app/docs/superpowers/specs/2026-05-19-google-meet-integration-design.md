# Google Meet Auto-Generation — Design Spec

**Date:** 2026-05-19
**Status:** Approved — implementation plan to follow
**Effort estimate:** ~2.5-3 days (~21-25h)
**Triggered by:** Broken "Faza 3" promise in `create-task-dialog.svelte` — user-visible auto-generation that doesn't exist

## Goal

When a user creates a task with `type='meeting'`, the system auto-generates a Google Meet link by creating a Google Calendar event on the connected tenant's primary calendar. Bidirectional sync: changes to the task's meeting time/duration/assignees propagate to the Calendar event; task deletion deletes the event.

## Non-Goals (v1)

- Per-tenant calendar picker (always use primary)
- Recurring meetings → recurring Calendar events
- RSVP tracking from Google back to CRM
- Custom invitation email templates
- Working-hours validation

---

## §1. OAuth Strategy — extend existing Gmail flow

**Decision: ADD `calendar.events` to the existing Gmail OAuth scope list.**

Rationale:
- `gmail_integration` table already holds encrypted tokens per-tenant with `grantedScopes` column
- Same Google user that sends mail can manage their Calendar
- Avoids double-OAuth friction

**Migration:**
- `SCOPES` array in `src/lib/server/gmail/auth.ts` extends with `https://www.googleapis.com/auth/calendar.events`
- Existing tokens don't have it → server checks `grantedScopes` JSON before attempting Calendar calls
- Re-consent UX: **banner non-blocking** on Gmail integrations page when `calendar.events` is missing from grantedScopes, with "Reconectează" CTA that triggers `prompt: 'consent'` OAuth
- Tenants without Gmail entirely: separate copy "Conectează Gmail pentru auto-Meet" — task creation still works without link

## §2. Calendar Configuration

- **Target calendar:** primary calendar of the connected Gmail account
- **Timezone:** `tenant.timezone` if column exists; else `Europe/Bucharest` server default
- **Notification:** `sendUpdates: 'all'` — Google emails attendees automatically
- **Conference type:** `conferenceData.createRequest.conferenceSolutionKey.type = 'hangoutsMeet'`

## §3. Attendees — auto-derived from context

| Trigger | Attendees |
|---|---|
| `createTask({type:'meeting'})` wizard | Agency assignees (`task.assigneeUserIds` → `user.email`) + client primary (`client.email`) |
| `scheduleMeet` admin Meet modal | Same as wizard |
| `client-task-meet-modal.svelte` invite picker | User-selected (existing UI: tenant + client users) |

All attendees receive Google Calendar invitations. No invite picker in `create-task-dialog.svelte` v1.

## §4. Trigger Points & Sync Behavior (V1+V2 in one)

| Event | Calendar action | Failure handling |
|---|---|---|
| `createTask` task with `type='meeting'` saved | Create Calendar event with Meet; persist `meetLink` + `googleCalendarEventId` | Task remains; toast warning; log `meet_event_failed` |
| `scheduleMeet({taskId})` on task without `googleCalendarEventId` | Same as create | Same |
| `updateTask` changes `meetTime` or `meetDurationMinutes` on task with `googleCalendarEventId` | Calendar event UPDATE (start/end times); log `meet_event_updated` | Task update succeeds; log fail |
| `updateTask` changes `assigneeUserIds` on task with `googleCalendarEventId` | Calendar event UPDATE (attendees list) | Same |
| `updateTask` changes `type` from `meeting` to other | Calendar event DELETE; clear `meetLink` + `googleCalendarEventId` in DB | Task succeeds; log fail |
| Task `delete` | Calendar event DELETE (best-effort, before DB delete) | DB delete succeeds; log fail |

**Concurrency:** No write lock per Calendar event. Google API tolerates rapid sequential updates — last write wins on Google's side. Acceptable for v1.

## §5. Failure Handling — never block task work

```
DB write succeeds → Calendar API call (async, best-effort)
  ├─ Success → persist event ID/link on task row → audit log
  └─ Failure → toast.warning to actor → audit log `meet_event_*_failed` with error metadata
                → user retries via admin Meet modal (existing fallback)
```

Calendar API errors (network, quota, revoked token, scope missing) **never roll back DB writes**. The CRM task is the source of truth; Calendar is an integration.

## §6. Schema Changes

**Add 1 column to `task` table:**

```ts
googleCalendarEventId: text('google_calendar_event_id')
```

No new tables. No new indexes needed (event ID is opaque, queried only on update/delete paths).

**Migration:** `drizzle/0336_task_google_calendar_event_id.sql` (single-statement, Turso-compatible)

## §7. New Code Surface

**New module:** `src/lib/server/google-calendar/`
- `auth.ts` — `getCalendarClient(tenantId)` returns authenticated googleapis Calendar client; checks `grantedScopes` includes `calendar.events`, throws `CalendarScopeMissing` if not
- `meet.ts`:
  - `createMeetEvent({tenantId, title, startTime, durationMinutes, timezone, attendees, description})` → `{eventId, hangoutLink}`
  - `updateMeetEvent({tenantId, eventId, startTime?, durationMinutes?, attendees?, title?, description?})` → `boolean`
  - `deleteMeetEvent({tenantId, eventId})` → `boolean`
- `__tests__/meet.test.ts` — googleapis mocked; covers happy + scope-missing + token-revoked + concurrent paths

**Modified files:**
- `src/lib/server/gmail/auth.ts` — `SCOPES` add `calendar.events`
- `src/lib/server/db/schema.ts` — add `task.googleCalendarEventId`
- `drizzle/0336_task_google_calendar_event_id.sql` — migration
- `src/lib/remotes/tasks.remote.ts`:
  - `createTask` — post-insert hook for type=meeting
  - `scheduleMeet` — same hook
  - `updateTask` — diff old vs new on meetTime/duration/assignees/type, fire updateMeetEvent or deleteMeetEvent accordingly
  - `deleteTask` — pre-delete hook fires deleteMeetEvent
- `src/lib/server/task-activity.ts` — new actions: `meet_event_created`, `meet_event_updated`, `meet_event_deleted`, `meet_event_failed`
- `src/lib/components/create-task-dialog.svelte` — conditional banner based on integration status (3 states: no-gmail / gmail-no-calendar-scope / fully-connected)
- `src/lib/components/task-detail/task-detail-body.svelte` — admin Meet modal: if `googleCalendarEventId` exists, show "Calendar event #..." instead of paste field
- `src/lib/components/client-task/client-task-meet-modal.svelte` — same conditional UX
- `src/routes/[tenant]/integrations/gmail/+page.svelte` (or equivalent) — re-consent banner

**Helper for conditional UI:** `src/lib/remotes/integrations.remote.ts` (or extend tasks.remote.ts) — query `getGmailMeetStatus(tenantId)` → `{ connected: bool, hasCalendarScope: bool, email: string | null }`. UI components consume this.

## §8. Multi-Tenant Safety

- `getCalendarClient(tenantId)` ALWAYS scopes to the requesting tenant's `gmail_integration` row
- Calendar event IDs are opaque to clients — never accept event ID from request body for mutation paths; always derive from `task.googleCalendarEventId` after tenant-scoped task fetch
- Audit log every Calendar mutation through `recordTaskActivity` with `userId` from `event.locals.user.id`

## §9. Testing Plan

- **Unit tests** (Bun script): 8-10 cases mocking googleapis
  - createMeetEvent happy path
  - createMeetEvent with no Calendar scope → CalendarScopeMissing
  - createMeetEvent with revoked token → handles error gracefully
  - updateMeetEvent happy path
  - updateMeetEvent on non-existent event → 404 surfaced
  - deleteMeetEvent happy path
  - createTask + meeting type integration happy path
  - createTask + meeting + Calendar fail → task still saved, log captured
  - Multi-tenant: tenant A cannot create event on tenant B's calendar (impossible by construction)
  - updateTask diff detects assignee change and updates Calendar attendees

- **Integration smoke** (post-deploy): manual checklist
  - Create meeting task with type=meeting → verify Calendar event + Meet link
  - Edit meetTime → verify Calendar event updated
  - Change assignees → verify Calendar attendees updated
  - Delete task → verify Calendar event deleted

## §10. Effort Breakdown

| Phase | Scope | Effort |
|---|---|---|
| 1. Server foundation | `google-calendar/` module (auth + meet 3 methods) + scope upgrade + schema migration | ~4-6h |
| 2. `createTask` + `scheduleMeet` wiring | Hook in create paths + audit logging | ~3h |
| 3. `updateTask` + delete sync (V2 capabilities) | Diff detection + update/delete event handlers | ~4-5h |
| 4. UI conditional copy | 3-state banner in create-task-dialog + Meet modals; helper query | ~3h |
| 5. Re-consent banner on integrations page | Gmail card detects missing scope, shows Reconectează CTA | ~2h |
| 6. Tests | 8-10 unit + smoke checklist | ~5h |
| 7. Polish + audit edge cases | Concurrency review, error copy, manual recovery flow | ~2-3h |
| **TOTAL** | | **~23-27h, ~2.5-3 days** |

## §11. Rollout Sequence

1. Ship in feature branch `feat/google-meet-integration`
2. **Pre-deploy:** verify `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` env vars unchanged (no infra change needed)
3. **Deploy code:** existing tenants see banner immediately; meet-type tasks created post-deploy try Calendar (gracefully fail until tenant re-consents)
4. **Manual smoke:** verify with a connected tenant (Augustin's own OTS tenant) before broadcasting
5. **Communication:** brief in-app announcement bar "Generare automată Meet — reconectează Gmail" pentru tenanții relevanți (out of scope for this design but recommended)

## §12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Existing tenants confused by re-consent prompt | Banner copy is explicit; Gmail send keeps working; no forced re-OAuth |
| Calendar API quota (1M req/day default) | Quota is per-project, not per-tenant; current scale (~50 tenants) far below |
| Token refresh while in-flight Calendar call | Existing `gmail/transporter.ts` retry pattern reused |
| User edits task right after creation; first event still creating | Defer Calendar create to a small `await` immediately after task insert (sequential, simple); for v2 consider background job |
| Calendar event ID drift (manual deletion outside CRM) | updateMeetEvent surfaces 404 → log `meet_event_orphaned`, clear `googleCalendarEventId`, prompt user to re-link |
| Client portal users cannot create Calendar events (no isClientUser path) | All `isClientUser` blocks in remote handlers (already in place from hotfix) prevent this |

---

## Spec Self-Review

- **Placeholder scan:** none (all sections concrete)
- **Internal consistency:** §4 trigger table + §7 modified files list align (createTask/updateTask/deleteTask all listed)
- **Scope check:** single subsystem (Meet integration); does not bleed into invoices, contracts, etc. ✅
- **Ambiguity check:** §2 "primary calendar" = user's Google Calendar default; §3 "agency assignees" = users in `taskAssignee` table for this task. Both unambiguous.
