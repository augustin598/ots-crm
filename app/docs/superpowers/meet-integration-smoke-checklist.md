# Google Meet Integration — Post-Deploy Smoke Checklist

**Date:** 2026-05-19
**Branch:** `feat/google-meet-integration`
**Pre-deploy:** apply migrations 0336 + 0337 on Turso

---

## 0. Pre-conditions

- [ ] Migrations 0336 (task.google_calendar_event_id column) + 0337 (google_calendar_integration table) applied on Turso
- [ ] Confirm via:
    ```sql
    PRAGMA table_info(task);  -- shows google_calendar_event_id column
    SELECT name FROM sqlite_master WHERE type='table' AND name='google_calendar_integration';
    ```
- [ ] OAuth env vars present: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (or `GOOGLE_REDIRECT_URI_CALENDAR` if different from Gmail)
- [ ] OAuth redirect URI registered in Google Cloud Console for the project — point at `/api/integrations/google-calendar/callback` (production hostname)

---

## 1. Connect flow

- [ ] Navigate to `/{tenant}/settings/google-calendar` as admin
- [ ] Click "Conectează Google Calendar" → redirects to Google consent screen
- [ ] Consent requests only `calendar.events` scope (verify in Google's UI)
- [ ] Approve → redirects back to `/{tenant}/settings/google-calendar?status=connected&email=...`
- [ ] Settings page now shows green "Conectat" card with email
- [ ] DB verify: `SELECT email, is_active FROM google_calendar_integration WHERE tenant_id = '<tenantId>';` returns the row

## 2. Create task with Meet (happy path)

- [ ] Open `/{tenant}/tasks` → click "+" → select type **Meeting**
- [ ] Wizard step 1: GREEN banner shows "✓ Linkul Meet va fi generat automat (cont {email})"
- [ ] (NO more "Faza 3" copy visible)
- [ ] Fill title, time, duration; assign 1-2 agency users; pick a client; submit
- [ ] Open the created task
    - [ ] `meetLink` shows a real `https://meet.google.com/...` URL
    - [ ] `task.googleCalendarEventId` is populated (check DB or detail panel)
- [ ] Open Google Calendar in browser → event exists at the correct time, with the correct attendees, with the Meet link

## 3. Update flow — time + duration

- [ ] Edit the task → change `meetTime` to a new value (e.g., +1 hour)
- [ ] Open Google Calendar → event start time updated, end time = start + duration
- [ ] Change `meetDurationMinutes` (e.g., 30 → 60)
- [ ] Calendar event end time shifted accordingly

## 4. Update flow — assignees

- [ ] Edit the task → add a new assignee
- [ ] Open Google Calendar → new attendee appears on the event (they receive email invitation)
- [ ] Remove an assignee → attendee list shrinks accordingly

## 5. Update flow — type demotion

- [ ] Edit a meeting task → change `type` from `meeting` to `design` (or any non-meeting)
- [ ] Open Google Calendar → event has been DELETED
- [ ] `task.meetLink` cleared (null), `task.googleCalendarEventId` cleared (null)
- [ ] Audit log shows `meet_event_deleted` action

## 6. Update flow — type promotion

- [ ] Pick a non-meeting task with a future date → change `type` to `meeting`, set `meetTime`
- [ ] New event created in Calendar, `meetLink` + `googleCalendarEventId` populated
- [ ] Audit log shows `meet_event_created` action

## 7. Delete flow

- [ ] Delete the meeting task
- [ ] Open Google Calendar → event removed (or 404 if URL checked manually)
- [ ] If the event was manually deleted in Google before this step, no errors — idempotent

## 8. Fallback flow — Calendar NOT connected

- [ ] Click "Deconectează" on `/{tenant}/settings/google-calendar`
- [ ] Page now shows "Neconectat" card
- [ ] Open create dialog → wizard shows AMBER banner "Conectează Google Calendar..." with link
- [ ] Submit a meeting task anyway → succeeds; `meetLink` is null; `googleCalendarEventId` is null
- [ ] Open admin task detail → existing manual `meetLink` paste input visible (fallback UI)
- [ ] Paste a manual Meet URL → saves successfully

## 9. Audit log verification

- [ ] Open a meeting task's activity timeline
- [ ] Confirm entries: `meet_event_created`, `meet_event_updated`, `meet_event_deleted` appear with timestamps + actor
- [ ] Try a flow that should fail (e.g., revoke Calendar access in Google, then try update) → entry `meet_event_failed` with error metadata

## 10. Multi-tenant smoke

- [ ] Switch to a different tenant (one without Calendar connected)
- [ ] Open create dialog → AMBER banner (no Calendar)
- [ ] Submit meeting task → succeeds, no Calendar action
- [ ] Verify tenant A's Calendar events are NOT created on tenant B's calendar
- [ ] Verify `google_calendar_integration` table query scoped by tenant returns only own row

## 11. Client portal sanity

- [ ] Log in as client portal user (`isClientUser=true`)
- [ ] Try `/api/integrations/google-calendar/auth` → 403 Forbidden (admin-only)
- [ ] Open `/client/{tenant}/tasks/{taskId}` → if task has googleCalendarEventId, client sees `meetLink`
- [ ] Open client Meet modal → status banner reflects tenant's Calendar connection state (cannot connect from client portal)

## 12. Edge cases

- [ ] Refresh token expired (manually expire in `google_calendar_integration.token_expires_at` to far past)
    - On next Calendar API call, googleapis auto-refreshes; if refresh token revoked, audit log shows `meet_event_failed`
- [ ] Calendar event deleted manually in Google → update attempt logs `meet_event_failed` with 404
- [ ] Two users editing same meeting simultaneously → last writer wins on Google (acceptable for v1)

---

## Rollback plan

If integration causes production issues:

1. Disconnect via Settings → `disconnectCalendar` sets `is_active=false`; subsequent task creates fall through gracefully
2. Or revert the merge: `git revert <merge-commit>` — restores pre-Meet behavior; existing google_calendar_integration rows remain but unused
3. Manual nuke of orphaned Calendar events not implemented (out of scope) — operator removes via Google Calendar UI

---

## Sign-off

- [ ] All boxes above checked
- [ ] Reporter: ___________
- [ ] Date: ___________
- [ ] Notes / deviations: ___________
