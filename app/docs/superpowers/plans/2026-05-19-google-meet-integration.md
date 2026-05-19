# Google Meet Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate Google Meet links for tasks of `type='meeting'` via Google Calendar API, with bidirectional CRM↔Calendar sync (create on task save, update on meetTime/duration/assignee/type change, delete on task delete).

**Architecture:** Extend existing per-tenant Gmail OAuth scope with `calendar.events`. New server module `src/lib/server/google-calendar/` (auth + meet CRUD). Hooks in `tasks.remote.ts` for createTask, scheduleMeet, updateTask, deleteTask. Conditional UI based on integration status (no-gmail / no-scope / connected). Non-blocking re-consent banner on Gmail integrations page.

**Tech Stack:** SvelteKit 5 (runes, `$state`, `$derived`, `$effect`), Drizzle ORM, libSQL/Turso, googleapis Node SDK (already a dependency via Gmail), Bun runtime, server-side `query()`/`command()` pattern.

**Reference design:** `app/docs/superpowers/specs/2026-05-19-google-meet-integration-design.md`

---

## File Structure

**New files:**
- `app/src/lib/server/google-calendar/auth.ts` — `getCalendarClient(tenantId)`, scope check helpers
- `app/src/lib/server/google-calendar/meet.ts` — `createMeetEvent`, `updateMeetEvent`, `deleteMeetEvent`
- `app/src/lib/server/google-calendar/__tests__/meet.test.ts` — 8-10 unit tests
- `app/drizzle/0336_task_google_calendar_event_id.sql` — schema migration
- `app/src/lib/remotes/integrations.remote.ts` — `getGmailMeetStatus(tenantId)` query (may already exist — Task 1 verifies)

**Modified files:**
- `app/src/lib/server/gmail/auth.ts` — extend `SCOPES` array
- `app/src/lib/server/db/schema.ts` — add `task.googleCalendarEventId` field + `meta/_journal.json`
- `app/src/lib/remotes/tasks.remote.ts` — wire 4 hooks
- `app/src/lib/server/task-activity.ts` — register new action types
- `app/src/lib/components/create-task-dialog.svelte` — replace promise banner with 3-state conditional
- `app/src/lib/components/task-detail/task-detail-body.svelte` — admin Meet modal conditional
- `app/src/lib/components/client-task/client-task-meet-modal.svelte` — client Meet modal conditional
- `app/src/routes/[tenant]/settings/gmail/+page.svelte` — re-consent banner

---

## Sequencing

```
Task 1 (worktree setup)
  → Task 2 (schema migration foundation)
    → Task 3 (Gmail SCOPES extension)
      → Task 4 (google-calendar/auth.ts)
        → Task 5 (createMeetEvent + test)
          → Task 6 (updateMeetEvent + test)
            → Task 7 (deleteMeetEvent + test)
              → Task 8 (task-activity action types)
                → Task 9 (wire createTask)
                → Task 10 (wire scheduleMeet)
                → Task 11 (wire updateTask diff)
                → Task 12 (wire deleteTask)
                  → Task 13 (getGmailMeetStatus helper)
                    → Task 14 (create-task-dialog conditional banner)
                    → Task 15 (admin Meet modal conditional)
                    → Task 16 (client Meet modal conditional)
                    → Task 17 (gmail/+page.svelte re-consent banner)
                      → Task 18 (manual smoke + final verification)
                        → Task 19 (commit milestone + merge prep)
```

Tasks 9-12 can run sequentially; 14-17 can run in parallel (file-disjoint).

---

## Task 1: Worktree Setup + Branch

**Files:** none (git operation)

- [ ] **Step 1: Create worktree off main**

```bash
cd /Users/augustin598/Projects/CRM
git worktree add -b feat/google-meet-integration ./.claude/worktrees/google-meet main
```

Expected: `Preparing worktree (new branch 'feat/google-meet-integration')` and `HEAD is now at <sha>`.

- [ ] **Step 2: Verify clean state**

```bash
cd /Users/augustin598/Projects/CRM/.claude/worktrees/google-meet
git status --short
git log --oneline -3
```

Expected: clean working tree; HEAD = `afdffe0` (post perf-a11y merge) or later.

- [ ] **Step 3: Commit empty milestone marker**

```bash
git commit --allow-empty -m "feat(meet): start Google Meet integration work"
```

---

## Task 2: Schema Migration — `task.googleCalendarEventId`

**Files:**
- Create: `app/drizzle/0336_task_google_calendar_event_id.sql`
- Modify: `app/drizzle/meta/_journal.json`
- Modify: `app/src/lib/server/db/schema.ts` (the `task` table around line 287)

- [ ] **Step 1: Read current task table definition**

```bash
grep -n "^export const task = sqliteTable" app/src/lib/server/db/schema.ts
```

Expected: line number where `task` table starts (around 287).

Open that section and find the existing `meetLink`/`meetTime`/`meetDurationMinutes` columns (around lines 296-300).

- [ ] **Step 2: Add column to schema.ts**

In `app/src/lib/server/db/schema.ts`, find the `task` table definition. After `meetDurationMinutes`, add:

```ts
googleCalendarEventId: text('google_calendar_event_id'),
```

- [ ] **Step 3: Create migration SQL file**

Create `app/drizzle/0336_task_google_calendar_event_id.sql`:

```sql
ALTER TABLE task ADD COLUMN google_calendar_event_id text;
```

- [ ] **Step 4: Update migration journal**

In `app/drizzle/meta/_journal.json`, find the `"entries"` array. Append (mirroring the existing entry shape):

```json
    {
      "idx": 336,
      "version": "7",
      "when": 1747641600000,
      "tag": "0336_task_google_calendar_event_id",
      "breakpoints": true
    }
```

Confirm the JSON syntax (comma before this entry; the array bracket closes after).

- [ ] **Step 5: Verify with bun**

```bash
cd app
bun run check 2>&1 | tail -10
```

Expected: no new type errors. `task.googleCalendarEventId` is now typed.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/server/db/schema.ts app/drizzle/0336_task_google_calendar_event_id.sql app/drizzle/meta/_journal.json
git commit -m "feat(meet): schema migration — task.googleCalendarEventId column"
```

---

## Task 3: Extend Gmail OAuth Scopes

**Files:**
- Modify: `app/src/lib/server/gmail/auth.ts` (around line 17)

- [ ] **Step 1: Read current SCOPES**

```bash
grep -n "^const SCOPES" app/src/lib/server/gmail/auth.ts
```

Expected: line 17. Current scope list:
- gmail.readonly
- gmail.send
- gmail.modify

- [ ] **Step 2: Add Calendar scope**

In `app/src/lib/server/gmail/auth.ts`, update `SCOPES`:

```ts
const SCOPES = [
	'https://www.googleapis.com/auth/gmail.readonly',
	'https://www.googleapis.com/auth/gmail.send',
	'https://www.googleapis.com/auth/gmail.modify',
	'https://www.googleapis.com/auth/calendar.events'
];
```

Add a JSDoc comment above the array:

```ts
/**
 * OAuth scopes requested at consent.
 *
 * `calendar.events` enables Google Meet auto-generation for meeting tasks.
 * Existing tenants connected before this scope was added have tokens WITHOUT
 * calendar.events — they must reconnect (UI shows banner on gmail settings page).
 * Server checks `gmail_integration.grantedScopes` JSON column to detect this.
 */
```

- [ ] **Step 3: Verify check**

```bash
cd app
bun run check 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/server/gmail/auth.ts
git commit -m "feat(meet): add calendar.events to Gmail OAuth SCOPES"
```

---

## Task 4: `google-calendar/auth.ts` — Client Getter + Scope Check

**Files:**
- Create: `app/src/lib/server/google-calendar/auth.ts`

- [ ] **Step 1: Create the file with full content**

Create `app/src/lib/server/google-calendar/auth.ts`:

```ts
import { google } from 'googleapis';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { logInfo, logWarning } from '$lib/server/logger';
import { decrypt } from '$lib/server/plugins/smartbill/crypto';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export class CalendarScopeMissing extends Error {
	constructor(tenantId: string) {
		super(`Tenant ${tenantId} has Gmail connected but missing calendar.events scope`);
		this.name = 'CalendarScopeMissing';
	}
}

export class CalendarNotConnected extends Error {
	constructor(tenantId: string) {
		super(`Tenant ${tenantId} has no active Gmail integration`);
		this.name = 'CalendarNotConnected';
	}
}

export type CalendarStatus = {
	connected: boolean;
	hasCalendarScope: boolean;
	email: string | null;
};

/**
 * Cheap status check — used by UI to decide which banner to show.
 * Never throws; returns shape always.
 */
export async function getCalendarStatus(tenantId: string): Promise<CalendarStatus> {
	const [integration] = await db
		.select({
			email: table.gmailIntegration.email,
			isActive: table.gmailIntegration.isActive,
			grantedScopes: table.gmailIntegration.grantedScopes
		})
		.from(table.gmailIntegration)
		.where(eq(table.gmailIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration || !integration.isActive) {
		return { connected: false, hasCalendarScope: false, email: null };
	}

	let scopes: string[] = [];
	if (integration.grantedScopes) {
		try {
			scopes = JSON.parse(integration.grantedScopes);
		} catch {
			scopes = [];
		}
	}

	return {
		connected: true,
		hasCalendarScope: scopes.includes(CALENDAR_SCOPE),
		email: integration.email
	};
}

/**
 * Build an authenticated Calendar API client for a tenant.
 * Throws CalendarNotConnected / CalendarScopeMissing for upstream graceful handling.
 */
export async function getCalendarClient(tenantId: string) {
	const [integration] = await db
		.select()
		.from(table.gmailIntegration)
		.where(eq(table.gmailIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration || !integration.isActive) {
		throw new CalendarNotConnected(tenantId);
	}

	let grantedScopes: string[] = [];
	if (integration.grantedScopes) {
		try {
			grantedScopes = JSON.parse(integration.grantedScopes);
		} catch {
			grantedScopes = [];
		}
	}

	if (!grantedScopes.includes(CALENDAR_SCOPE)) {
		throw new CalendarScopeMissing(tenantId);
	}

	let accessToken: string;
	let refreshToken: string;

	if (integration.accessTokenEncrypted) {
		try {
			accessToken = decrypt(tenantId, integration.accessTokenEncrypted);
		} catch (err) {
			logWarning('google-calendar', 'accessToken decrypt failed, fallback to plain', { tenantId });
			accessToken = integration.accessToken;
		}
	} else {
		accessToken = integration.accessToken;
	}

	if (integration.refreshTokenEncrypted) {
		try {
			refreshToken = decrypt(tenantId, integration.refreshTokenEncrypted);
		} catch (err) {
			logWarning('google-calendar', 'refreshToken decrypt failed, fallback to plain', { tenantId });
			refreshToken = integration.refreshToken;
		}
	} else {
		refreshToken = integration.refreshToken;
	}

	const oauth2Client = new google.auth.OAuth2(
		env.GOOGLE_CLIENT_ID,
		env.GOOGLE_CLIENT_SECRET,
		env.GOOGLE_REDIRECT_URI
	);
	oauth2Client.setCredentials({
		access_token: accessToken,
		refresh_token: refreshToken,
		expiry_date: integration.tokenExpiresAt.getTime()
	});

	logInfo('google-calendar', 'Calendar client built', { tenantId, metadata: { email: integration.email } });

	return google.calendar({ version: 'v3', auth: oauth2Client });
}
```

- [ ] **Step 2: Verify check**

```bash
cd app
bun run check 2>&1 | tail -5
```

Expected: no errors. Imports resolve.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/google-calendar/auth.ts
git commit -m "feat(meet): google-calendar/auth.ts — client builder + scope check"
```

---

## Task 5: `meet.ts` — createMeetEvent

**Files:**
- Create: `app/src/lib/server/google-calendar/meet.ts`
- Create: `app/src/lib/server/google-calendar/__tests__/meet.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/server/google-calendar/__tests__/meet.test.ts`:

```ts
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock googleapis BEFORE import
mock.module('googleapis', () => ({
	google: {
		calendar: () => ({
			events: {
				insert: mock(async ({ requestBody, conferenceDataVersion }) => ({
					data: {
						id: 'evt_test_123',
						hangoutLink: 'https://meet.google.com/abc-defg-hij',
						start: requestBody.start,
						end: requestBody.end,
						attendees: requestBody.attendees
					}
				})),
				update: mock(async ({ eventId, requestBody }) => ({
					data: { id: eventId, ...requestBody }
				})),
				delete: mock(async ({ eventId }) => ({ data: {} }))
			}
		}),
		auth: { OAuth2: class { setCredentials() {} } }
	}
}));

// Mock the auth getter to avoid DB hits
mock.module('$lib/server/google-calendar/auth', () => ({
	getCalendarClient: mock(async (tenantId: string) => {
		const { google } = await import('googleapis');
		return google.calendar();
	}),
	getCalendarStatus: mock(async () => ({ connected: true, hasCalendarScope: true, email: 'a@b.com' })),
	CalendarScopeMissing: class extends Error {},
	CalendarNotConnected: class extends Error {}
}));

import { createMeetEvent } from '../meet';

describe('createMeetEvent', () => {
	it('returns eventId and hangoutLink on success', async () => {
		const result = await createMeetEvent({
			tenantId: 'tenant-a',
			title: 'Test Meeting',
			startTime: new Date('2026-05-20T10:00:00Z'),
			durationMinutes: 30,
			timezone: 'Europe/Bucharest',
			attendees: ['user@example.com'],
			description: 'Test description'
		});

		expect(result.eventId).toBe('evt_test_123');
		expect(result.hangoutLink).toBe('https://meet.google.com/abc-defg-hij');
	});
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd app
bun test src/lib/server/google-calendar/__tests__/meet.test.ts 2>&1 | tail -5
```

Expected: FAIL with "Cannot find module '../meet'" or equivalent.

- [ ] **Step 3: Create meet.ts with createMeetEvent**

Create `app/src/lib/server/google-calendar/meet.ts`:

```ts
import { getCalendarClient } from './auth';
import { logInfo, logError, serializeError } from '$lib/server/logger';

export type CreateMeetEventInput = {
	tenantId: string;
	title: string;
	startTime: Date;
	durationMinutes: number;
	timezone: string;
	attendees: string[];
	description?: string;
};

export type CreateMeetEventResult = {
	eventId: string;
	hangoutLink: string;
};

/**
 * Create a Google Calendar event with a Meet conference. Returns event id and hangout link.
 * Throws if Calendar API errors; caller decides graceful fallback.
 */
export async function createMeetEvent(input: CreateMeetEventInput): Promise<CreateMeetEventResult> {
	const calendar = await getCalendarClient(input.tenantId);
	const endTime = new Date(input.startTime.getTime() + input.durationMinutes * 60_000);

	const requestBody = {
		summary: input.title,
		description: input.description ?? '',
		start: { dateTime: input.startTime.toISOString(), timeZone: input.timezone },
		end: { dateTime: endTime.toISOString(), timeZone: input.timezone },
		attendees: input.attendees.filter(Boolean).map((email) => ({ email })),
		conferenceData: {
			createRequest: {
				requestId: `ots-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
				conferenceSolutionKey: { type: 'hangoutsMeet' }
			}
		}
	};

	try {
		const res = await calendar.events.insert({
			calendarId: 'primary',
			conferenceDataVersion: 1,
			sendUpdates: 'all',
			requestBody
		});

		const eventId = res.data.id;
		const hangoutLink = res.data.hangoutLink;

		if (!eventId || !hangoutLink) {
			throw new Error('Calendar API returned event without id or hangoutLink');
		}

		logInfo('google-calendar', 'Meet event created', {
			tenantId: input.tenantId,
			metadata: { eventId, attendeeCount: input.attendees.length }
		});

		return { eventId, hangoutLink };
	} catch (err) {
		logError('google-calendar', 'createMeetEvent failed', {
			tenantId: input.tenantId,
			metadata: { error: serializeError(err) }
		});
		throw err;
	}
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd app
bun test src/lib/server/google-calendar/__tests__/meet.test.ts 2>&1 | tail -5
```

Expected: `1 pass / 0 fail`.

- [ ] **Step 5: Add second test — scope missing**

Append to `meet.test.ts`:

```ts
describe('createMeetEvent — scope missing', () => {
	it('throws CalendarScopeMissing when scope absent', async () => {
		// Override the auth mock for this case
		const { getCalendarClient, CalendarScopeMissing } = await import('$lib/server/google-calendar/auth');
		(getCalendarClient as any).mockImplementationOnce(async () => {
			throw new CalendarScopeMissing('tenant-x');
		});

		await expect(
			createMeetEvent({
				tenantId: 'tenant-x',
				title: 'No scope',
				startTime: new Date('2026-05-20T10:00:00Z'),
				durationMinutes: 30,
				timezone: 'Europe/Bucharest',
				attendees: []
			})
		).rejects.toThrow('CalendarScopeMissing');
	});
});
```

- [ ] **Step 6: Run test — both pass**

```bash
cd app
bun test src/lib/server/google-calendar/__tests__/meet.test.ts 2>&1 | tail -5
```

Expected: `2 pass / 0 fail`.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/server/google-calendar/meet.ts app/src/lib/server/google-calendar/__tests__/meet.test.ts
git commit -m "feat(meet): createMeetEvent + 2 tests"
```

---

## Task 6: `meet.ts` — updateMeetEvent

**Files:**
- Modify: `app/src/lib/server/google-calendar/meet.ts`
- Modify: `app/src/lib/server/google-calendar/__tests__/meet.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `meet.test.ts`:

```ts
import { updateMeetEvent } from '../meet';

describe('updateMeetEvent', () => {
	it('returns true on successful update with new times and attendees', async () => {
		const result = await updateMeetEvent({
			tenantId: 'tenant-a',
			eventId: 'evt_test_123',
			startTime: new Date('2026-05-20T11:00:00Z'),
			durationMinutes: 60,
			timezone: 'Europe/Bucharest',
			attendees: ['user1@example.com', 'user2@example.com'],
			title: 'Updated Meeting'
		});

		expect(result).toBe(true);
	});
});
```

- [ ] **Step 2: Run — fails**

```bash
cd app
bun test src/lib/server/google-calendar/__tests__/meet.test.ts 2>&1 | tail -5
```

Expected: FAIL — `updateMeetEvent` undefined.

- [ ] **Step 3: Implement updateMeetEvent**

In `app/src/lib/server/google-calendar/meet.ts`, append:

```ts
export type UpdateMeetEventInput = {
	tenantId: string;
	eventId: string;
	startTime?: Date;
	durationMinutes?: number;
	timezone?: string;
	attendees?: string[];
	title?: string;
	description?: string;
};

/**
 * Patch a Google Calendar event. Only provided fields are sent.
 * Returns true on success, throws on Calendar API error.
 */
export async function updateMeetEvent(input: UpdateMeetEventInput): Promise<boolean> {
	const calendar = await getCalendarClient(input.tenantId);
	const requestBody: Record<string, unknown> = {};

	if (input.title !== undefined) requestBody.summary = input.title;
	if (input.description !== undefined) requestBody.description = input.description;

	if (input.startTime && input.durationMinutes !== undefined && input.timezone) {
		const endTime = new Date(input.startTime.getTime() + input.durationMinutes * 60_000);
		requestBody.start = { dateTime: input.startTime.toISOString(), timeZone: input.timezone };
		requestBody.end = { dateTime: endTime.toISOString(), timeZone: input.timezone };
	}

	if (input.attendees !== undefined) {
		requestBody.attendees = input.attendees.filter(Boolean).map((email) => ({ email }));
	}

	try {
		await calendar.events.patch({
			calendarId: 'primary',
			eventId: input.eventId,
			sendUpdates: 'all',
			requestBody
		});

		logInfo('google-calendar', 'Meet event updated', {
			tenantId: input.tenantId,
			metadata: { eventId: input.eventId, fields: Object.keys(requestBody) }
		});

		return true;
	} catch (err) {
		logError('google-calendar', 'updateMeetEvent failed', {
			tenantId: input.tenantId,
			metadata: { eventId: input.eventId, error: serializeError(err) }
		});
		throw err;
	}
}
```

Also update the googleapis mock at the top of the test file — change `update: mock(...)` to `patch: mock(...)`:

```ts
patch: mock(async ({ eventId, requestBody }) => ({
    data: { id: eventId, ...requestBody }
}))
```

- [ ] **Step 4: Run — both tests pass**

```bash
cd app
bun test src/lib/server/google-calendar/__tests__/meet.test.ts 2>&1 | tail -5
```

Expected: `3 pass / 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/google-calendar/meet.ts app/src/lib/server/google-calendar/__tests__/meet.test.ts
git commit -m "feat(meet): updateMeetEvent (patch) + test"
```

---

## Task 7: `meet.ts` — deleteMeetEvent

**Files:**
- Modify: `app/src/lib/server/google-calendar/meet.ts`
- Modify: `app/src/lib/server/google-calendar/__tests__/meet.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `meet.test.ts`:

```ts
import { deleteMeetEvent } from '../meet';

describe('deleteMeetEvent', () => {
	it('returns true on successful delete', async () => {
		const result = await deleteMeetEvent({ tenantId: 'tenant-a', eventId: 'evt_test_123' });
		expect(result).toBe(true);
	});

	it('returns true (idempotent) when event is already gone (404)', async () => {
		const { getCalendarClient } = await import('$lib/server/google-calendar/auth');
		(getCalendarClient as any).mockImplementationOnce(async () => ({
			events: {
				delete: async () => {
					const err: any = new Error('Not Found');
					err.code = 404;
					throw err;
				}
			}
		}));

		const result = await deleteMeetEvent({ tenantId: 'tenant-a', eventId: 'evt_gone' });
		expect(result).toBe(true);
	});
});
```

- [ ] **Step 2: Run — fails**

```bash
cd app
bun test src/lib/server/google-calendar/__tests__/meet.test.ts 2>&1 | tail -5
```

Expected: FAIL — `deleteMeetEvent` undefined.

- [ ] **Step 3: Implement deleteMeetEvent**

In `app/src/lib/server/google-calendar/meet.ts`, append:

```ts
export type DeleteMeetEventInput = {
	tenantId: string;
	eventId: string;
};

/**
 * Delete a Google Calendar event. Idempotent — 404 is treated as success.
 * Returns true on success/idempotent, throws on other Calendar API errors.
 */
export async function deleteMeetEvent(input: DeleteMeetEventInput): Promise<boolean> {
	const calendar = await getCalendarClient(input.tenantId);

	try {
		await calendar.events.delete({
			calendarId: 'primary',
			eventId: input.eventId,
			sendUpdates: 'all'
		});

		logInfo('google-calendar', 'Meet event deleted', {
			tenantId: input.tenantId,
			metadata: { eventId: input.eventId }
		});

		return true;
	} catch (err: any) {
		// 404 = already deleted upstream → idempotent success
		if (err?.code === 404 || err?.response?.status === 404) {
			logInfo('google-calendar', 'Meet event already gone (404) — idempotent', {
				tenantId: input.tenantId,
				metadata: { eventId: input.eventId }
			});
			return true;
		}

		logError('google-calendar', 'deleteMeetEvent failed', {
			tenantId: input.tenantId,
			metadata: { eventId: input.eventId, error: serializeError(err) }
		});
		throw err;
	}
}
```

- [ ] **Step 4: Run — all tests pass**

```bash
cd app
bun test src/lib/server/google-calendar/__tests__/meet.test.ts 2>&1 | tail -5
```

Expected: `5 pass / 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/google-calendar/meet.ts app/src/lib/server/google-calendar/__tests__/meet.test.ts
git commit -m "feat(meet): deleteMeetEvent (idempotent 404) + 2 tests"
```

---

## Task 8: New Action Types in task-activity.ts

**Files:**
- Modify: `app/src/lib/server/task-activity.ts`

- [ ] **Step 1: Read current action union**

```bash
grep -n "action\|ACTIONS\|TaskActivityAction" app/src/lib/server/task-activity.ts | head -10
```

Expected: find where action types are declared (union string or const array).

- [ ] **Step 2: Add new actions**

In `app/src/lib/server/task-activity.ts`, find the union type or const array of allowed actions. If it's a TS union, extend with:

```ts
| 'meet_event_created'
| 'meet_event_updated'
| 'meet_event_deleted'
| 'meet_event_failed'
| 'meet_event_orphaned'
```

If it's a const array, append:

```ts
'meet_event_created',
'meet_event_updated',
'meet_event_deleted',
'meet_event_failed',
'meet_event_orphaned'
```

- [ ] **Step 3: Verify check**

```bash
cd app
bun run check 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/server/task-activity.ts
git commit -m "feat(meet): register meet_event_* action types in task-activity"
```

---

## Task 9: Wire `createTask` to createMeetEvent

**Files:**
- Modify: `app/src/lib/remotes/tasks.remote.ts` (`createTask` function)

- [ ] **Step 1: Find createTask + insert location**

```bash
grep -n "^export const createTask" app/src/lib/remotes/tasks.remote.ts
```

Open the function, find where the new task row is inserted (`db.insert(table.task).values({...})`), and where `return { ...newTask }` or similar happens.

- [ ] **Step 2: Add post-insert Meet creation hook**

After the task row is inserted (and subtasks/tags/assignees if any), but BEFORE the function returns, add a try/catch block. Pseudocode for placement: right before `return ...newTask` at the end.

Add the imports at top of `tasks.remote.ts`:

```ts
import { createMeetEvent } from '$lib/server/google-calendar/meet';
import { getCalendarStatus, CalendarScopeMissing, CalendarNotConnected } from '$lib/server/google-calendar/auth';
```

Then add this block right before the final return inside `createTask`:

```ts
// Auto-generate Google Meet link for type=meeting tasks
if (data.type === 'meeting' && data.meetTime) {
	const status = await getCalendarStatus(event.locals.tenant.id);
	if (status.connected && status.hasCalendarScope) {
		try {
			// Resolve attendee emails: assignees + client
			const attendeeEmails: string[] = [];
			if (data.assigneeUserIds?.length) {
				const users = await db
					.select({ email: table.user.email })
					.from(table.user)
					.where(inArray(table.user.id, data.assigneeUserIds));
				attendeeEmails.push(...users.map((u) => u.email).filter(Boolean));
			}
			if (data.clientId) {
				const [client] = await db
					.select({ email: table.client.email })
					.from(table.client)
					.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, event.locals.tenant.id)))
					.limit(1);
				if (client?.email) attendeeEmails.push(client.email);
			}

			// Parse meetTime: expecting "YYYY-MM-DDTHH:MM" format from datetime-local input
			const startTime = new Date(data.meetTime);
			const meetResult = await createMeetEvent({
				tenantId: event.locals.tenant.id,
				title: data.title,
				startTime,
				durationMinutes: data.meetDurationMinutes ?? 30,
				timezone: 'Europe/Bucharest',
				attendees: attendeeEmails,
				description: data.description ?? undefined
			});

			// Persist on the task row
			await db
				.update(table.task)
				.set({
					meetLink: meetResult.hangoutLink,
					googleCalendarEventId: meetResult.eventId
				})
				.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)));

			await recordTaskActivity({
				taskId,
				userId: event.locals.user.id,
				action: 'meet_event_created',
				metadata: { eventId: meetResult.eventId, attendeeCount: attendeeEmails.length }
			});
		} catch (err) {
			// Calendar API failed — task stays, log warning, frontend gets a follow-up flag
			await recordTaskActivity({
				taskId,
				userId: event.locals.user.id,
				action: 'meet_event_failed',
				metadata: { stage: 'create', error: err instanceof Error ? err.message : String(err) }
			});
			// Don't rethrow — task creation succeeds regardless
		}
	}
}
```

Make sure `inArray` is imported from `drizzle-orm` (it likely is for the existing query patterns; verify).

- [ ] **Step 3: Verify check + tests**

```bash
cd app
bun run check 2>&1 | tail -5
bun test src/lib/remotes/__tests__/tasks.remote.test.ts 2>&1 | tail -5
```

Expected: no new errors; existing 64 tests still pass (the mock layer doesn't have googleapis so the if-branch won't execute in tests).

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/remotes/tasks.remote.ts
git commit -m "feat(meet): wire createTask to createMeetEvent for type=meeting (graceful fallback)"
```

---

## Task 10: Wire `scheduleMeet` to createMeetEvent

**Files:**
- Modify: `app/src/lib/remotes/tasks.remote.ts` (`scheduleMeet` function around line 2638)

- [ ] **Step 1: Find scheduleMeet body**

```bash
grep -n "^export const scheduleMeet" app/src/lib/remotes/tasks.remote.ts
```

Expected: line ~2638.

- [ ] **Step 2: Add Calendar generation when no eventId exists yet**

In the body of `scheduleMeet`, just before the final `return { success: true }`, fetch the task row to check `googleCalendarEventId`, and if absent + meetTime is provided, attempt creation:

```ts
// Post-update: if no Calendar event yet AND we have meetTime, attempt auto-generation
if (meetTime) {
	const [taskRow] = await db
		.select({
			id: table.task.id,
			title: table.task.title,
			description: table.task.description,
			clientId: table.task.clientId,
			meetDurationMinutes: table.task.meetDurationMinutes,
			googleCalendarEventId: table.task.googleCalendarEventId
		})
		.from(table.task)
		.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (taskRow && !taskRow.googleCalendarEventId) {
		const status = await getCalendarStatus(event.locals.tenant.id);
		if (status.connected && status.hasCalendarScope) {
			try {
				// Resolve assignees via taskAssignee
				const assignees = await db
					.select({ email: table.user.email })
					.from(table.taskAssignee)
					.innerJoin(table.user, eq(table.taskAssignee.userId, table.user.id))
					.where(eq(table.taskAssignee.taskId, taskId));
				const attendeeEmails: string[] = assignees.map((a) => a.email).filter(Boolean);

				if (taskRow.clientId) {
					const [client] = await db
						.select({ email: table.client.email })
						.from(table.client)
						.where(
							and(
								eq(table.client.id, taskRow.clientId),
								eq(table.client.tenantId, event.locals.tenant.id)
							)
						)
						.limit(1);
					if (client?.email) attendeeEmails.push(client.email);
				}

				const meetResult = await createMeetEvent({
					tenantId: event.locals.tenant.id,
					title: taskRow.title,
					startTime: new Date(meetTime),
					durationMinutes: meetDurationMinutes ?? taskRow.meetDurationMinutes ?? 30,
					timezone: 'Europe/Bucharest',
					attendees: attendeeEmails,
					description: taskRow.description ?? undefined
				});

				await db
					.update(table.task)
					.set({
						meetLink: meetResult.hangoutLink,
						googleCalendarEventId: meetResult.eventId
					})
					.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)));

				await recordTaskActivity({
					taskId,
					userId: event.locals.user.id,
					action: 'meet_event_created',
					metadata: { eventId: meetResult.eventId, attendeeCount: attendeeEmails.length }
				});
			} catch (err) {
				await recordTaskActivity({
					taskId,
					userId: event.locals.user.id,
					action: 'meet_event_failed',
					metadata: { stage: 'schedule', error: err instanceof Error ? err.message : String(err) }
				});
			}
		}
	}
}
```

- [ ] **Step 3: Verify check + tests**

```bash
cd app
bun run check 2>&1 | tail -5
bun test src/lib/remotes/__tests__/tasks.remote.test.ts 2>&1 | tail -5
```

Expected: 64 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/remotes/tasks.remote.ts
git commit -m "feat(meet): wire scheduleMeet to auto-create Meet event when missing"
```

---

## Task 11: Wire `updateTask` — diff + update/delete Calendar event

**Files:**
- Modify: `app/src/lib/remotes/tasks.remote.ts` (`updateTask` function)

- [ ] **Step 1: Find updateTask + understand current shape**

```bash
grep -n "^export const updateTask" app/src/lib/remotes/tasks.remote.ts
```

Read the function. It fetches existing task, applies diff, writes. We add a post-write hook.

- [ ] **Step 2: Capture old vs new for relevant fields**

Just before the actual `db.update(table.task).set(...)`, capture the pre-update snapshot of the relevant fields:

```ts
const [preUpdate] = await db
	.select({
		type: table.task.type,
		meetTime: table.task.meetTime,
		meetDurationMinutes: table.task.meetDurationMinutes,
		googleCalendarEventId: table.task.googleCalendarEventId,
		title: table.task.title,
		description: table.task.description
	})
	.from(table.task)
	.where(and(eq(table.task.id, data.taskId), eq(table.task.tenantId, event.locals.tenant.id)))
	.limit(1);
```

(If this snapshot is already taken earlier for the existing `existing` row, reuse — don't duplicate.)

- [ ] **Step 3: After DB write, add Calendar sync**

Append after the existing UPDATE statement, before returning:

```ts
// Calendar sync for meeting tasks
const hadEvent = !!preUpdate?.googleCalendarEventId;
const isStillMeeting = (data.type ?? preUpdate?.type) === 'meeting';
const newMeetTime = data.meetTime !== undefined ? data.meetTime : preUpdate?.meetTime;
const newDuration = data.meetDurationMinutes !== undefined ? data.meetDurationMinutes : preUpdate?.meetDurationMinutes;

// Case A: was meeting, no longer meeting → DELETE event
if (hadEvent && !isStillMeeting) {
	const status = await getCalendarStatus(event.locals.tenant.id);
	if (status.connected && status.hasCalendarScope) {
		try {
			const { deleteMeetEvent } = await import('$lib/server/google-calendar/meet');
			await deleteMeetEvent({ tenantId: event.locals.tenant.id, eventId: preUpdate!.googleCalendarEventId! });
			await db.update(table.task)
				.set({ meetLink: null, googleCalendarEventId: null })
				.where(and(eq(table.task.id, data.taskId), eq(table.task.tenantId, event.locals.tenant.id)));
			await recordTaskActivity({
				taskId: data.taskId,
				userId: event.locals.user.id,
				action: 'meet_event_deleted',
				metadata: { eventId: preUpdate!.googleCalendarEventId!, reason: 'type_changed' }
			});
		} catch (err) {
			await recordTaskActivity({
				taskId: data.taskId,
				userId: event.locals.user.id,
				action: 'meet_event_failed',
				metadata: { stage: 'delete_on_type_change', error: err instanceof Error ? err.message : String(err) }
			});
		}
	}
}

// Case B: still meeting with existing event → UPDATE if relevant fields changed
if (hadEvent && isStillMeeting) {
	const timeChanged = data.meetTime !== undefined && data.meetTime !== preUpdate?.meetTime;
	const durationChanged = data.meetDurationMinutes !== undefined && data.meetDurationMinutes !== preUpdate?.meetDurationMinutes;
	const titleChanged = data.title !== undefined && data.title !== preUpdate?.title;
	const descChanged = data.description !== undefined && data.description !== preUpdate?.description;
	const assigneesChanged = data.assigneeUserIds !== undefined;

	if (timeChanged || durationChanged || titleChanged || descChanged || assigneesChanged) {
		const status = await getCalendarStatus(event.locals.tenant.id);
		if (status.connected && status.hasCalendarScope) {
			try {
				const { updateMeetEvent } = await import('$lib/server/google-calendar/meet');

				let attendees: string[] | undefined;
				if (assigneesChanged) {
					const ids = data.assigneeUserIds ?? [];
					if (ids.length) {
						const users = await db
							.select({ email: table.user.email })
							.from(table.user)
							.where(inArray(table.user.id, ids));
						attendees = users.map((u) => u.email).filter(Boolean);

						// Add client too
						const clientId = data.clientId !== undefined ? data.clientId : preUpdate?.clientId;
						if (clientId) {
							const [client] = await db
								.select({ email: table.client.email })
								.from(table.client)
								.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, event.locals.tenant.id)))
								.limit(1);
							if (client?.email) attendees!.push(client.email);
						}
					} else {
						attendees = [];
					}
				}

				await updateMeetEvent({
					tenantId: event.locals.tenant.id,
					eventId: preUpdate!.googleCalendarEventId!,
					startTime: (timeChanged && newMeetTime) ? new Date(newMeetTime) : undefined,
					durationMinutes: (durationChanged || timeChanged) ? (newDuration ?? 30) : undefined,
					timezone: (timeChanged || durationChanged) ? 'Europe/Bucharest' : undefined,
					title: titleChanged ? data.title : undefined,
					description: descChanged ? (data.description ?? undefined) : undefined,
					attendees
				});

				await recordTaskActivity({
					taskId: data.taskId,
					userId: event.locals.user.id,
					action: 'meet_event_updated',
					metadata: { eventId: preUpdate!.googleCalendarEventId! }
				});
			} catch (err) {
				await recordTaskActivity({
					taskId: data.taskId,
					userId: event.locals.user.id,
					action: 'meet_event_failed',
					metadata: { stage: 'update', error: err instanceof Error ? err.message : String(err) }
				});
			}
		}
	}
}

// Case C: was not meeting, became meeting with meetTime → CREATE
if (!hadEvent && isStillMeeting && newMeetTime && data.type === 'meeting') {
	// Reuse the createTask post-insert pattern (extract to helper if duplication grows)
	const status = await getCalendarStatus(event.locals.tenant.id);
	if (status.connected && status.hasCalendarScope) {
		try {
			const attendeeEmails: string[] = [];
			const ids = data.assigneeUserIds;
			if (ids?.length) {
				const users = await db
					.select({ email: table.user.email })
					.from(table.user)
					.where(inArray(table.user.id, ids));
				attendeeEmails.push(...users.map((u) => u.email).filter(Boolean));
			}
			const clientId = data.clientId !== undefined ? data.clientId : preUpdate?.clientId;
			if (clientId) {
				const [client] = await db
					.select({ email: table.client.email })
					.from(table.client)
					.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, event.locals.tenant.id)))
					.limit(1);
				if (client?.email) attendeeEmails.push(client.email);
			}

			const meetResult = await createMeetEvent({
				tenantId: event.locals.tenant.id,
				title: data.title ?? preUpdate?.title ?? 'Meeting',
				startTime: new Date(newMeetTime),
				durationMinutes: newDuration ?? 30,
				timezone: 'Europe/Bucharest',
				attendees: attendeeEmails,
				description: data.description ?? preUpdate?.description ?? undefined
			});

			await db.update(table.task)
				.set({ meetLink: meetResult.hangoutLink, googleCalendarEventId: meetResult.eventId })
				.where(and(eq(table.task.id, data.taskId), eq(table.task.tenantId, event.locals.tenant.id)));

			await recordTaskActivity({
				taskId: data.taskId,
				userId: event.locals.user.id,
				action: 'meet_event_created',
				metadata: { eventId: meetResult.eventId, stage: 'type_promotion' }
			});
		} catch (err) {
			await recordTaskActivity({
				taskId: data.taskId,
				userId: event.locals.user.id,
				action: 'meet_event_failed',
				metadata: { stage: 'create_on_type_promotion', error: err instanceof Error ? err.message : String(err) }
			});
		}
	}
}
```

- [ ] **Step 4: Verify check + tests**

```bash
cd app
bun run check 2>&1 | tail -5
bun test src/lib/remotes/__tests__/tasks.remote.test.ts 2>&1 | tail -5
```

Expected: 64 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/remotes/tasks.remote.ts
git commit -m "feat(meet): updateTask Calendar sync — create/update/delete based on diff"
```

---

## Task 12: Wire `deleteTask` Pre-Delete Hook

**Files:**
- Modify: `app/src/lib/remotes/tasks.remote.ts` (`deleteTask` function)

- [ ] **Step 1: Find deleteTask**

```bash
grep -n "^export const deleteTask" app/src/lib/remotes/tasks.remote.ts
```

- [ ] **Step 2: Add pre-delete Calendar cleanup**

Before the `db.delete(table.task)` call, fetch the `googleCalendarEventId` and fire deleteMeetEvent if present:

```ts
// Pre-delete: clean up Calendar event if exists
const [taskRow] = await db
	.select({ googleCalendarEventId: table.task.googleCalendarEventId })
	.from(table.task)
	.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
	.limit(1);

if (taskRow?.googleCalendarEventId) {
	const status = await getCalendarStatus(event.locals.tenant.id);
	if (status.connected && status.hasCalendarScope) {
		try {
			const { deleteMeetEvent } = await import('$lib/server/google-calendar/meet');
			await deleteMeetEvent({ tenantId: event.locals.tenant.id, eventId: taskRow.googleCalendarEventId });
		} catch (err) {
			// Best-effort: task deletion proceeds even if Calendar cleanup fails.
			// Activity log won't be reachable post-delete (cascade), so log centrally.
			logWarning('google-calendar', 'Calendar event delete failed during task delete', {
				tenantId: event.locals.tenant.id,
				metadata: { taskId, eventId: taskRow.googleCalendarEventId, error: err instanceof Error ? err.message : String(err) }
			});
		}
	}
}
```

Ensure `logWarning` is imported at the top of `tasks.remote.ts` (check existing imports).

- [ ] **Step 3: Verify**

```bash
cd app
bun run check 2>&1 | tail -5
bun test src/lib/remotes/__tests__/tasks.remote.test.ts 2>&1 | tail -5
```

Expected: 64 tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/remotes/tasks.remote.ts
git commit -m "feat(meet): deleteTask cleans up Calendar event (best-effort)"
```

---

## Task 13: `getGmailMeetStatus` Remote Query

**Files:**
- Create or extend: `app/src/lib/remotes/integrations.remote.ts`

- [ ] **Step 1: Check if file exists**

```bash
ls app/src/lib/remotes/integrations.remote.ts 2>/dev/null
```

If it does not exist, create it. If it exists (e.g., for Stripe), extend it.

- [ ] **Step 2: Add the query**

In `app/src/lib/remotes/integrations.remote.ts`, add (or create with):

```ts
import { query, getRequestEvent } from '$app/server';
import { getCalendarStatus } from '$lib/server/google-calendar/auth';

/**
 * Get the Gmail+Calendar integration status for the current tenant.
 * Used by UI to decide which Meet banner to show.
 */
export const getGmailMeetStatus = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		return { connected: false, hasCalendarScope: false, email: null };
	}
	return getCalendarStatus(event.locals.tenant.id);
});
```

- [ ] **Step 3: Verify**

```bash
cd app
bun run check 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/remotes/integrations.remote.ts
git commit -m "feat(meet): getGmailMeetStatus query for UI conditional banner"
```

---

## Task 14: Create-Task-Dialog Conditional Banner

**Files:**
- Modify: `app/src/lib/components/create-task-dialog.svelte` (around line 408-414)

- [ ] **Step 1: Read current Meet banner**

```bash
sed -n '405,415p' app/src/lib/components/create-task-dialog.svelte
```

Confirm the current banner with "Link Google Meet va fi generat automat la creare (Faza 3)".

- [ ] **Step 2: Add status query + replace banner**

In the `<script>` block at the top, add the import:

```ts
import { getGmailMeetStatus } from '$lib/remotes/integrations.remote';
```

Add the query subscription somewhere in the script:

```ts
const meetStatusQuery = $derived(isMeet ? getGmailMeetStatus() : null);
const meetStatus = $derived(meetStatusQuery?.current);
```

Now replace lines 407-414 (the existing banner block) with:

```svelte
<!-- Meet integration status banner — 3 states -->
<div class="col-span-2">
	{#if !meetStatus}
		<!-- Loading or non-meeting type — no banner -->
	{:else if !meetStatus.connected}
		<div class="flex items-start gap-3 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
			<span class="mt-0.5 text-amber-600">⚠</span>
			<div class="text-xs text-amber-800">
				<strong>Conectează Gmail</strong> pentru a genera automat linkul Google Meet. Până atunci, linkul îl adaugi manual din panoul de detalii al taskului.
				<a href="/{tenantSlug}/settings/gmail" class="ml-1 font-semibold underline">Conectează</a>
			</div>
		</div>
	{:else if !meetStatus.hasCalendarScope}
		<div class="flex items-start gap-3 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
			<span class="mt-0.5 text-amber-600">⚠</span>
			<div class="text-xs text-amber-800">
				<strong>Reconectează Gmail</strong> pentru a activa generarea automată Meet. Contul {meetStatus.email} e conectat, dar îi lipsește permisiunea pentru Calendar.
				<a href="/{tenantSlug}/settings/gmail" class="ml-1 font-semibold underline">Reconectează</a>
			</div>
		</div>
	{:else}
		<div class="flex items-center gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
			<span class="text-emerald-600">✓</span>
			<div class="text-xs text-emerald-800">
				<strong>Linkul Google Meet va fi generat automat</strong> când salvezi meeting-ul. Invitația se trimite participanților via Google Calendar.
			</div>
		</div>
	{/if}
</div>
```

Verify `tenantSlug` is already available in the script (the dialog likely uses `page.params.tenant` — search for it and add if missing):

```ts
import { page } from '$app/state';
const tenantSlug = $derived(page.params.tenant ?? '');
```

- [ ] **Step 3: Run autofixer**

Use the Svelte MCP autofixer tool on `app/src/lib/components/create-task-dialog.svelte`. Fix any issues.

- [ ] **Step 4: Verify**

```bash
cd app
bun run check 2>&1 | tail -5
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/components/create-task-dialog.svelte
git commit -m "fix(create-task): 3-state Meet banner — no-gmail / no-scope / connected (replaces Faza 3 promise)"
```

---

## Task 15: Admin Meet Modal Conditional

**Files:**
- Modify: `app/src/lib/components/task-detail/task-detail-body.svelte` (admin Meet modal around line 1073)

- [ ] **Step 1: Find admin Meet modal block**

```bash
grep -n "showMeetModal\|meetLink\|admin-meet-modal-title" app/src/lib/components/task-detail/task-detail-body.svelte | head -10
```

Read the modal block.

- [ ] **Step 2: Add status query**

In `<script>`, add:

```ts
import { getGmailMeetStatus } from '$lib/remotes/integrations.remote';
const adminMeetStatus = $derived(getGmailMeetStatus());
const adminMeetStatusValue = $derived(adminMeetStatus.current);
```

- [ ] **Step 3: Conditionally hide meetLink paste field when auto-generation is active**

Inside the modal body, wrap the existing `meetLink` paste input with a conditional. If `task.googleCalendarEventId` exists OR `adminMeetStatusValue.hasCalendarScope` is true, show a notice; else keep the paste input.

```svelte
{#if currentTask?.googleCalendarEventId}
	<div class="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-800">
		Linkul Meet a fost generat automat. Evenimentul există în Google Calendar.
	</div>
{:else if adminMeetStatusValue?.connected && adminMeetStatusValue?.hasCalendarScope}
	<div class="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-800">
		Linkul Meet se va genera automat când salvezi (cont {adminMeetStatusValue.email}).
	</div>
{:else}
	<!-- Existing manual paste UI -->
	<div class="space-y-1.5">
		<label for="meet-link" class="text-xs font-semibold uppercase text-slate-500">Link Meet</label>
		<Input id="meet-link" type="url" bind:value={meetLink} placeholder="https://meet.google.com/..." />
	</div>
{/if}
```

Adapt the existing inputs/Wrappers to match the file's existing pattern. The existing `meetLink` paste flow stays as fallback.

- [ ] **Step 4: Autofixer + check**

```bash
cd app
bun run check 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/components/task-detail/task-detail-body.svelte
git commit -m "fix(task-detail): admin Meet modal — hide manual paste when auto-gen active"
```

---

## Task 16: Client Meet Modal Conditional

**Files:**
- Modify: `app/src/lib/components/client-task/client-task-meet-modal.svelte`

- [ ] **Step 1: Read current modal**

```bash
wc -l app/src/lib/components/client-task/client-task-meet-modal.svelte
```

- [ ] **Step 2: Add status detection + banner inside modal body**

In `<script>`, add:

```ts
import { getGmailMeetStatus } from '$lib/remotes/integrations.remote';
const meetStatusQuery = $derived(open ? getGmailMeetStatus() : null);
const meetStatus = $derived(meetStatusQuery?.current);
```

At the top of the modal body (right after the modal header), add:

```svelte
{#if meetStatus}
	{#if !meetStatus.connected}
		<div class="mx-5 mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
			Gmail nu e conectat. Meeting-ul se va programa, dar linkul va trebui adăugat manual.
		</div>
	{:else if !meetStatus.hasCalendarScope}
		<div class="mx-5 mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
			Reconectează Gmail pentru a activa auto-generarea (linkul îl adaugi manual până atunci).
		</div>
	{:else}
		<div class="mx-5 mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
			✓ Linkul Meet va fi generat automat la salvare.
		</div>
	{/if}
{/if}
```

- [ ] **Step 3: Autofixer + check**

Run Svelte MCP autofixer; ensure clean.

```bash
cd app
bun run check 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/components/client-task/client-task-meet-modal.svelte
git commit -m "fix(client-task): Meet modal shows integration status banner"
```

---

## Task 17: Re-Consent Banner on Gmail Settings Page

**Files:**
- Modify: `app/src/routes/[tenant]/settings/gmail/+page.svelte`

- [ ] **Step 1: Read current page structure**

```bash
wc -l app/src/routes/\[tenant\]/settings/gmail/+page.svelte
grep -n "isActive\|email\|Reconectează\|connect\|reconnect" app/src/routes/\[tenant\]/settings/gmail/+page.svelte | head -10
```

Read enough to understand the existing "Connect Gmail" / status card pattern.

- [ ] **Step 2: Add scope detection banner**

In `<script>`, add:

```ts
import { getGmailMeetStatus } from '$lib/remotes/integrations.remote';
const meetScopeStatus = $derived(getGmailMeetStatus());
const meetScopeStatusValue = $derived(meetScopeStatus.current);
```

In the page body, find the section that displays the connected status (or the "Connect" CTA if not connected). Just below the status header (where `email` is shown if connected), add:

```svelte
{#if meetScopeStatusValue?.connected && !meetScopeStatusValue.hasCalendarScope}
	<div class="my-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
		<div class="flex items-start gap-3">
			<span class="text-lg text-amber-600">⚡</span>
			<div class="flex-1">
				<h4 class="font-bold text-amber-900">Activează generarea automată Google Meet</h4>
				<p class="mt-1 text-sm text-amber-800">
					Contul {meetScopeStatusValue.email} e conectat, dar nu are permisiunea pentru Google Calendar.
					Reconectează-te pentru a permite generarea automată a linkurilor Meet în taskurile de tip meeting.
				</p>
				<a
					href="/api/integrations/gmail/auth"
					class="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
				>
					Reconectează Gmail
				</a>
			</div>
		</div>
	</div>
{/if}
```

**Verify the Gmail OAuth start endpoint** — adjust the `href` path to match the existing pattern in this file (search for the existing "Connect" button to find the right URL).

- [ ] **Step 3: Autofixer + check**

```bash
cd app
bun run check 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add app/src/routes/\[tenant\]/settings/gmail/+page.svelte
git commit -m "fix(gmail-settings): re-consent banner when calendar.events scope is missing"
```

---

## Task 18: Manual Smoke Verification

**Files:** none (verification only)

- [ ] **Step 1: Apply migrations on local Turso**

```bash
cd app
# Per project memory: user runs migrations manually
# Confirm migration 0336 will be picked up when ready to deploy
ls drizzle/0336_task_google_calendar_event_id.sql
```

Expected: file exists, ready to apply.

- [ ] **Step 2: Run full test suite**

```bash
cd app
bun test src/lib/remotes/__tests__/tasks.remote.test.ts 2>&1 | tail -5
bun test src/lib/server/google-calendar/__tests__/meet.test.ts 2>&1 | tail -5
```

Expected: tasks ≥ 64 pass, meet 5 pass.

- [ ] **Step 3: Run svelte-check**

```bash
NODE_OPTIONS="--max-old-space-size=8192" bunx svelte-check --threshold error 2>&1 | tail -5
```

Expected: error count = pre-existing baseline (12). No new errors in google-calendar/ or modified files.

- [ ] **Step 4: Create smoke checklist file**

Create `app/docs/superpowers/meet-integration-smoke-checklist.md` for post-deploy manual verification:

```markdown
# Google Meet Integration — Post-Deploy Smoke

Run these AFTER deploy + migration 0336 applied on Turso.

## Pre-conditions
- [ ] At least one tenant has reconnected Gmail with calendar.events scope (check `gmail_integration.grantedScopes` JSON)

## Create flow
- [ ] Login as admin, open Tasks, click + → Meeting type
- [ ] Wizard shows GREEN "Linkul va fi generat automat" banner
- [ ] Fill title, time, duration, client; submit
- [ ] Open the created task → `meetLink` shows a real `https://meet.google.com/...` URL
- [ ] Open Google Calendar in browser → event exists with the same time + attendees

## Update flow
- [ ] Edit the meeting task → change meetTime
- [ ] Open Google Calendar → event time updated
- [ ] Edit again → change assignees
- [ ] Open Google Calendar → attendees updated

## Delete flow
- [ ] Delete the meeting task
- [ ] Open Google Calendar → event removed (or 404 if checked URL)

## Fallback flow (tenant without re-consent)
- [ ] Use a tenant whose Gmail does NOT have calendar.events scope
- [ ] Open create dialog → AMBER "Reconectează Gmail" banner shows
- [ ] Submit a meeting task → succeeds, meetLink is null
- [ ] Admin Meet modal: shows manual paste input (not the auto-gen notice)

## Re-consent flow
- [ ] Settings → Gmail → see AMBER "Activează auto Meet" banner
- [ ] Click Reconectează → OAuth screen requests calendar.events permission
- [ ] After consent, banner disappears; new meetings auto-generate links
```

- [ ] **Step 5: Commit smoke checklist**

```bash
git add app/docs/superpowers/meet-integration-smoke-checklist.md
git commit -m "docs(meet): smoke verification checklist for post-deploy"
```

---

## Task 19: Final Verification + Milestone Commit

**Files:** none

- [ ] **Step 1: Full svelte-check + tests**

```bash
cd app
NODE_OPTIONS="--max-old-space-size=8192" bunx svelte-check --threshold error 2>&1 | tail -5
bun test 2>&1 | tail -10
```

Document the final pass counts.

- [ ] **Step 2: List all commits**

```bash
cd /Users/augustin598/Projects/CRM/.claude/worktrees/google-meet
git log --oneline main..HEAD
```

Confirm ~19 commits.

- [ ] **Step 3: Milestone marker commit**

```bash
git commit --allow-empty -m "milestone: Google Meet integration complete (~14h, 5 unit tests, 0 regressions)"
```

- [ ] **Step 4: Stop. Ask user for merge authorization.**

Per project convention: do NOT merge to main or push without explicit user "yes". Surface final summary instead, then await answer.

---

## Self-Review

**1. Spec coverage:**
- §1 OAuth strategy → Task 3 (SCOPES extension) + Task 17 (banner)
- §2 Calendar config → Task 5 (createMeetEvent hard-codes 'primary', timezone Europe/Bucharest)
- §3 Attendees → Task 9 + Task 10 + Task 11 (auto-derive from assignees + client)
- §4 Trigger points table → Task 9 (createTask) + Task 10 (scheduleMeet) + Task 11 (updateTask diff) + Task 12 (deleteTask)
- §5 Failure handling → every Calendar call in Tasks 9-12 is in try/catch with `meet_event_failed` audit log
- §6 Schema → Task 2
- §7 Code surface → all files mapped to tasks
- §8 Multi-tenant safety → `getCalendarClient(tenantId)` always tenant-scoped; event IDs derived from tenant-scoped task fetch (never from request body)
- §9 Testing → Tasks 5/6/7 (unit) + Task 18 (smoke)
- §10 Effort → tasks add up to ~21h, aligned with estimate
- §11 Rollout → covered by Task 19 (merge gate)
- §12 Risks → mitigations baked into Tasks 9-12 (graceful failure) and Task 17 (banner)

**2. Placeholder scan:**
- No "TBD" / "implement later"
- Every code step has full code
- All commands have expected output

**3. Type consistency:**
- `eventId: string`, `hangoutLink: string` consistent across createMeetEvent/updateMeetEvent/deleteMeetEvent
- `getCalendarStatus` returns `{connected, hasCalendarScope, email}` — same shape used in Tasks 13, 14, 15, 16, 17
- `googleCalendarEventId` column name consistent in schema (Task 2) + all UPDATE statements (Tasks 9, 11, 12)
- Action types `meet_event_created/updated/deleted/failed/orphaned` declared in Task 8, used in Tasks 9-12

---

## Execution Handoff

Plan complete and saved to `app/docs/superpowers/plans/2026-05-19-google-meet-integration.md`.

User instruction: **execute via subagent-driven-development.**

REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Fresh subagent per task + two-stage review (spec compliance, then code quality).
