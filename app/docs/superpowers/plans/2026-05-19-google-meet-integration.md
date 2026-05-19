# Google Meet Integration Implementation Plan (v2 — Separate Module)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate Google Meet links for tasks of `type='meeting'` via Google Calendar API. Calendar is a **separate per-tenant integration** with its own OAuth flow, DB table, and settings page — independent from Gmail. Bidirectional sync: create on save, update on changes, delete on task delete.

**Architecture:** New `google_calendar_integration` table mirroring `gmail_integration` shape; dedicated `/api/integrations/google-calendar/{auth,callback}` OAuth flow with only `calendar.events` scope; new `/[tenant]/settings/google-calendar` page. New `src/lib/server/google-calendar/` module. Hooks in `tasks.remote.ts` for createTask/scheduleMeet/updateTask/deleteTask. 2-state UI (connected / not connected).

**Tech Stack:** SvelteKit 5 (runes), Drizzle ORM, libSQL/Turso, googleapis SDK, Bun.

**Reference spec:** `app/docs/superpowers/specs/2026-05-19-google-meet-integration-design.md` (v2)

---

## File Structure

**New files:**
- `app/src/lib/server/google-calendar/auth.ts`
- `app/src/lib/server/google-calendar/meet.ts`
- `app/src/lib/server/google-calendar/__tests__/meet.test.ts`
- `app/drizzle/0336_task_google_calendar_event_id.sql`
- `app/drizzle/0337_create_google_calendar_integration.sql`
- `app/src/routes/api/integrations/google-calendar/auth/+server.ts`
- `app/src/routes/api/integrations/google-calendar/callback/+server.ts`
- `app/src/routes/[tenant]/settings/google-calendar/+page.svelte`
- `app/src/routes/[tenant]/settings/google-calendar/+page.server.ts`
- `app/src/lib/remotes/integrations.remote.ts` (extend if exists)

**Modified:**
- `app/src/lib/server/db/schema.ts` — add `googleCalendarIntegration` table + relations + `task.googleCalendarEventId`
- `app/drizzle/meta/_journal.json` — 2 new entries
- `app/src/lib/remotes/tasks.remote.ts` — 4 hooks
- `app/src/lib/server/task-activity.ts` — register action types
- `app/src/lib/components/create-task-dialog.svelte` — 2-state banner
- `app/src/lib/components/task-detail/task-detail-body.svelte` — admin Meet modal banner
- `app/src/lib/components/client-task/client-task-meet-modal.svelte` — client Meet modal banner

---

## Sequencing

```
Task 1 (worktree) — DONE manually
Task 2 (schema: task column + new table) → Task 3 (2 migrations) → Task 4 (journal)
  → Task 5 (auth.ts) → Task 6 (createMeetEvent + 2 tests)
    → Task 7 (updateMeetEvent + test) → Task 8 (deleteMeetEvent + 2 tests)
      → Task 9 (OAuth start route) → Task 10 (OAuth callback route)
        → Task 11 (settings page UI + server load)
          MILESTONE 1
          → Task 12 (action types) → Task 13 (createTask hook)
            → Task 14 (scheduleMeet hook) → Task 15 (updateTask diff)
              → Task 16 (deleteTask hook) → Task 17 (status query)
                MILESTONE 2
                → Task 18 (dialog banner) || Task 19 (admin Meet conditional) || Task 20 (client Meet conditional) — PARALLEL
                  → Task 21 (smoke + final verify + merge gate)
```

---

## Task 1: Worktree Setup — DONE

Worktree exists at `/Users/augustin598/Projects/CRM/.claude/worktrees/google-meet`, branch `feat/google-meet-integration`, off main, with empty milestone commit + cherry-picked spec + plan.

---

## Task 2: Schema — `task.googleCalendarEventId` + `googleCalendarIntegration` Table

**Files:**
- Modify: `app/src/lib/server/db/schema.ts`

- [ ] **Step 1: Locate task table**

```bash
grep -n "^export const task = sqliteTable" app/src/lib/server/db/schema.ts
```

Expected: line ~287.

- [ ] **Step 2: Add column to `task` table**

In the `task` table definition, after the existing `meetDurationMinutes` line, add:

```ts
googleCalendarEventId: text('google_calendar_event_id'),
```

- [ ] **Step 3: Add new `googleCalendarIntegration` table**

Locate the existing `gmailIntegration` definition (around line 2019). Add immediately AFTER it:

```ts
export const googleCalendarIntegration = sqliteTable('google_calendar_integration', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
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

- [ ] **Step 4: Add relations declaration**

Find the `gmailIntegrationRelations` declaration (around line 3281). Add immediately AFTER:

```ts
export const googleCalendarIntegrationRelations = relations(googleCalendarIntegration, ({ one }) => ({
	tenant: one(tenant, {
		fields: [googleCalendarIntegration.tenantId],
		references: [tenant.id]
	})
}));
```

Also, find the `tenant`'s relations block (look for `googleAdsAccount: many(...)` or similar in `tenantRelations`) and add `googleCalendarIntegration: one(googleCalendarIntegration)` to the existing relations object.

- [ ] **Step 5: Export type aliases**

Find existing `export type GmailIntegration = typeof gmailIntegration.$inferSelect;` (around line 4029) and add right after:

```ts
export type GoogleCalendarIntegration = typeof googleCalendarIntegration.$inferSelect;
export type NewGoogleCalendarIntegration = typeof googleCalendarIntegration.$inferInsert;
```

- [ ] **Step 6: Verify**

```bash
cd app
bun run check 2>&1 | tail -5
```

Expected: no new errors. `task.googleCalendarEventId` and `googleCalendarIntegration` are now typed.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/server/db/schema.ts
git commit -m "feat(meet): schema — task.googleCalendarEventId + googleCalendarIntegration table"
```

---

## Task 3: Two Migrations

**Files:**
- Create: `app/drizzle/0336_task_google_calendar_event_id.sql`
- Create: `app/drizzle/0337_create_google_calendar_integration.sql`
- Modify: `app/drizzle/meta/_journal.json`

- [ ] **Step 1: Create migration 0336 (single ALTER)**

Create `app/drizzle/0336_task_google_calendar_event_id.sql`:

```sql
ALTER TABLE task ADD COLUMN google_calendar_event_id text;
```

- [ ] **Step 2: Create migration 0337 (single CREATE TABLE)**

Create `app/drizzle/0337_create_google_calendar_integration.sql`:

```sql
CREATE TABLE IF NOT EXISTS google_calendar_integration (
	id text PRIMARY KEY NOT NULL,
	tenant_id text NOT NULL REFERENCES tenant(id),
	email text NOT NULL,
	access_token_encrypted text NOT NULL,
	refresh_token_encrypted text NOT NULL,
	token_expires_at integer NOT NULL,
	is_active integer NOT NULL DEFAULT 1,
	last_refresh_attempt_at integer,
	last_refresh_error text,
	consecutive_refresh_failures integer DEFAULT 0,
	granted_scopes text,
	created_at integer NOT NULL DEFAULT (unixepoch()),
	updated_at integer NOT NULL DEFAULT (unixepoch())
);
```

- [ ] **Step 3: Append both entries to `_journal.json`**

Open `app/drizzle/meta/_journal.json`. Find the `entries` array (sorted by `idx`). Append:

```json
,
{
  "idx": 336,
  "version": "7",
  "when": 1747641600000,
  "tag": "0336_task_google_calendar_event_id",
  "breakpoints": true
},
{
  "idx": 337,
  "version": "7",
  "when": 1747641700000,
  "tag": "0337_create_google_calendar_integration",
  "breakpoints": true
}
```

Read the existing last entry first to copy the EXACT `version` value used (probably `"7"` but verify).

- [ ] **Step 4: Verify journal is valid JSON**

```bash
cd app
bun -e "JSON.parse(require('fs').readFileSync('drizzle/meta/_journal.json', 'utf8')); console.log('valid')"
```

Expected: `valid`.

- [ ] **Step 5: Commit**

```bash
git add app/drizzle/0336_task_google_calendar_event_id.sql app/drizzle/0337_create_google_calendar_integration.sql app/drizzle/meta/_journal.json
git commit -m "feat(meet): migrations 0336 (task column) + 0337 (calendar integration table)"
```

---

## Task 4: `google-calendar/auth.ts` Foundation

**Files:**
- Create: `app/src/lib/server/google-calendar/auth.ts`

- [ ] **Step 1: Verify the OAuth utils path**

```bash
grep -n "google.auth.OAuth2\|encryptVerified" app/src/lib/server/gmail/auth.ts | head -5
```

Confirm the crypto helper import path. The Gmail flow uses `from '$lib/server/plugins/smartbill/crypto'`.

- [ ] **Step 2: Create `auth.ts` with full content**

Create `app/src/lib/server/google-calendar/auth.ts`:

```ts
import { google } from 'googleapis';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';
import { encryptVerified, decrypt } from '$lib/server/plugins/smartbill/crypto';
import { encodeBase32LowerCase } from '@oslojs/encoding';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const SCOPES = [SCOPE];

export class CalendarNotConnected extends Error {
	constructor(tenantId: string) {
		super(`Tenant ${tenantId} has no active Google Calendar integration`);
		this.name = 'CalendarNotConnected';
	}
}

export type CalendarStatus = {
	connected: boolean;
	email: string | null;
};

function getOAuth2Client() {
	return new google.auth.OAuth2(
		env.GOOGLE_CLIENT_ID,
		env.GOOGLE_CLIENT_SECRET,
		env.GOOGLE_REDIRECT_URI_CALENDAR ?? env.GOOGLE_REDIRECT_URI
	);
}

function generateId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Cheap status check — used by UI to decide which banner to show. Never throws.
 */
export async function getCalendarStatus(tenantId: string): Promise<CalendarStatus> {
	const [integration] = await db
		.select({
			email: table.googleCalendarIntegration.email,
			isActive: table.googleCalendarIntegration.isActive
		})
		.from(table.googleCalendarIntegration)
		.where(eq(table.googleCalendarIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration || !integration.isActive) {
		return { connected: false, email: null };
	}
	return { connected: true, email: integration.email };
}

/**
 * Build an authenticated Calendar API client for a tenant.
 * Throws CalendarNotConnected if no active integration.
 */
export async function getCalendarClient(tenantId: string) {
	const [integration] = await db
		.select()
		.from(table.googleCalendarIntegration)
		.where(eq(table.googleCalendarIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration || !integration.isActive) {
		throw new CalendarNotConnected(tenantId);
	}

	let accessToken: string;
	let refreshToken: string;

	try {
		accessToken = decrypt(tenantId, integration.accessTokenEncrypted);
	} catch (err) {
		logWarning('google-calendar', 'accessToken decrypt failed', { tenantId, metadata: { error: serializeError(err) } });
		throw new Error('Calendar token decrypt failed; reconnect required');
	}

	try {
		refreshToken = decrypt(tenantId, integration.refreshTokenEncrypted);
	} catch (err) {
		logWarning('google-calendar', 'refreshToken decrypt failed', { tenantId, metadata: { error: serializeError(err) } });
		throw new Error('Calendar token decrypt failed; reconnect required');
	}

	const oauth2Client = getOAuth2Client();
	oauth2Client.setCredentials({
		access_token: accessToken,
		refresh_token: refreshToken,
		expiry_date: integration.tokenExpiresAt.getTime()
	});

	logInfo('google-calendar', 'Calendar client built', { tenantId, metadata: { email: integration.email } });

	return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Build the Google OAuth consent URL for connecting Calendar.
 */
export function getOAuthUrl(tenantId: string): string {
	const oauth2Client = getOAuth2Client();
	const url = oauth2Client.generateAuthUrl({
		access_type: 'offline',
		scope: SCOPES,
		prompt: 'consent',
		state: tenantId,
		include_granted_scopes: true
	});
	logInfo('google-calendar', 'OAuth: Generated auth URL', { tenantId });
	return url;
}

/**
 * Exchange authorization code for tokens and persist as integration row.
 * Upserts: deletes any existing row for this tenant first.
 */
export async function exchangeCodeAndSave(tenantId: string, code: string): Promise<{ email: string }> {
	const oauth2Client = getOAuth2Client();
	const { tokens } = await oauth2Client.getToken(code);

	if (!tokens.access_token || !tokens.refresh_token) {
		throw new Error('Google did not return tokens (missing access_token or refresh_token)');
	}

	oauth2Client.setCredentials(tokens);

	// Fetch user info to get email
	const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
	const userInfo = await oauth2.userinfo.get();
	const email = userInfo.data.email;
	if (!email) throw new Error('Google did not return user email');

	const accessTokenEnc = encryptVerified(tenantId, tokens.access_token);
	const refreshTokenEnc = encryptVerified(tenantId, tokens.refresh_token);
	const tokenExpiresAt = new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000);
	const grantedScopes = JSON.stringify(tokens.scope?.split(' ') ?? SCOPES);

	// Delete-then-insert (one integration per tenant)
	await db
		.delete(table.googleCalendarIntegration)
		.where(eq(table.googleCalendarIntegration.tenantId, tenantId));

	await db.insert(table.googleCalendarIntegration).values({
		id: generateId(),
		tenantId,
		email,
		accessTokenEncrypted: accessTokenEnc,
		refreshTokenEncrypted: refreshTokenEnc,
		tokenExpiresAt,
		isActive: true,
		grantedScopes
	});

	logInfo('google-calendar', 'OAuth: Integration saved', { tenantId, metadata: { email } });
	return { email };
}

/**
 * Soft-delete the Calendar integration for a tenant.
 */
export async function disconnectCalendar(tenantId: string): Promise<void> {
	await db
		.update(table.googleCalendarIntegration)
		.set({ isActive: false, updatedAt: new Date() })
		.where(eq(table.googleCalendarIntegration.tenantId, tenantId));

	logInfo('google-calendar', 'Calendar integration disconnected', { tenantId });
}
```

- [ ] **Step 3: Verify check**

```bash
cd app
bun run check 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/server/google-calendar/auth.ts
git commit -m "feat(meet): google-calendar/auth.ts — client + status + OAuth helpers + disconnect"
```

---

## Task 5: `createMeetEvent` + 2 Tests (TDD)

**Files:**
- Create: `app/src/lib/server/google-calendar/meet.ts`
- Create: `app/src/lib/server/google-calendar/__tests__/meet.test.ts`

- [ ] **Step 1: Write failing test**

Create `app/src/lib/server/google-calendar/__tests__/meet.test.ts`:

```ts
import { describe, it, expect, mock } from 'bun:test';

// Mock googleapis BEFORE import
mock.module('googleapis', () => ({
	google: {
		calendar: () => ({
			events: {
				insert: mock(async ({ requestBody }) => ({
					data: {
						id: 'evt_test_123',
						hangoutLink: 'https://meet.google.com/abc-defg-hij',
						start: requestBody.start,
						end: requestBody.end,
						attendees: requestBody.attendees
					}
				})),
				patch: mock(async ({ eventId, requestBody }) => ({
					data: { id: eventId, ...requestBody }
				})),
				delete: mock(async () => ({ data: {} }))
			}
		}),
		auth: { OAuth2: class { setCredentials() {} } }
	}
}));

mock.module('$lib/server/google-calendar/auth', () => ({
	getCalendarClient: mock(async () => {
		const { google } = await import('googleapis');
		return google.calendar();
	}),
	getCalendarStatus: mock(async () => ({ connected: true, email: 'a@b.com' })),
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

	it('throws CalendarNotConnected when integration missing', async () => {
		const { getCalendarClient, CalendarNotConnected } = await import('$lib/server/google-calendar/auth');
		(getCalendarClient as any).mockImplementationOnce(async () => {
			throw new CalendarNotConnected('tenant-x');
		});

		await expect(
			createMeetEvent({
				tenantId: 'tenant-x',
				title: 'No connection',
				startTime: new Date('2026-05-20T10:00:00Z'),
				durationMinutes: 30,
				timezone: 'Europe/Bucharest',
				attendees: []
			})
		).rejects.toThrow();
	});
});
```

- [ ] **Step 2: Run — fails (no implementation)**

```bash
cd app
bun test src/lib/server/google-calendar/__tests__/meet.test.ts 2>&1 | tail -5
```

Expected: FAIL with `Cannot find module '../meet'`.

- [ ] **Step 3: Implement `createMeetEvent`**

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

- [ ] **Step 4: Run — passes**

```bash
cd app
bun test src/lib/server/google-calendar/__tests__/meet.test.ts 2>&1 | tail -5
```

Expected: `2 pass / 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/google-calendar/meet.ts app/src/lib/server/google-calendar/__tests__/meet.test.ts
git commit -m "feat(meet): createMeetEvent + 2 tests (happy + not-connected)"
```

---

## Task 6: `updateMeetEvent` + 1 Test

**Files:**
- Modify: `app/src/lib/server/google-calendar/meet.ts`
- Modify: `app/src/lib/server/google-calendar/__tests__/meet.test.ts`

- [ ] **Step 1: Write test**

Append to `meet.test.ts`:

```ts
import { updateMeetEvent } from '../meet';

describe('updateMeetEvent', () => {
	it('returns true on successful patch with new times and attendees', async () => {
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

- [ ] **Step 3: Implement**

Append to `meet.ts`:

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

- [ ] **Step 4: Run — 3 tests pass**

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

## Task 7: `deleteMeetEvent` + 2 Tests (idempotent 404)

**Files:**
- Modify: `app/src/lib/server/google-calendar/meet.ts`
- Modify: `app/src/lib/server/google-calendar/__tests__/meet.test.ts`

- [ ] **Step 1: Write 2 tests**

Append:

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

Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `meet.ts`:

```ts
export type DeleteMeetEventInput = {
	tenantId: string;
	eventId: string;
};

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
		if (err?.code === 404 || err?.response?.status === 404) {
			logInfo('google-calendar', 'Meet event already gone (404 idempotent)', {
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

- [ ] **Step 4: Run — 5 tests pass**

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

## Task 8: OAuth Start Route

**Files:**
- Create: `app/src/routes/api/integrations/google-calendar/auth/+server.ts`

- [ ] **Step 1: Verify Gmail auth route exists for pattern reference**

```bash
find app/src/routes/api -path "*gmail*" -name "+server.ts" 2>/dev/null | head -5
```

Expected: at least one Gmail OAuth start route. Read it for pattern.

- [ ] **Step 2: Create the auth start route**

Create `app/src/routes/api/integrations/google-calendar/auth/+server.ts`:

```ts
import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOAuthUrl } from '$lib/server/google-calendar/auth';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	// Block client users from initiating Calendar OAuth
	if (event.locals.isClientUser) {
		throw error(403, 'Forbidden');
	}

	const url = getOAuthUrl(event.locals.tenant.id);
	throw redirect(302, url);
};
```

- [ ] **Step 3: Verify**

```bash
cd app
bun run check 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add app/src/routes/api/integrations/google-calendar/auth/+server.ts
git commit -m "feat(meet): /api/integrations/google-calendar/auth — OAuth start (admin only)"
```

---

## Task 9: OAuth Callback Route

**Files:**
- Create: `app/src/routes/api/integrations/google-calendar/callback/+server.ts`

- [ ] **Step 1: Create callback route**

Create `app/src/routes/api/integrations/google-calendar/callback/+server.ts`:

```ts
import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exchangeCodeAndSave } from '$lib/server/google-calendar/auth';
import { logError, serializeError } from '$lib/server/logger';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	if (event.locals.isClientUser) {
		throw error(403, 'Forbidden');
	}

	const url = new URL(event.request.url);
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const errorParam = url.searchParams.get('error');

	const tenantSlug = event.params.tenant ?? event.locals.tenant.slug;
	const redirectBase = `/${tenantSlug}/settings/google-calendar`;

	if (errorParam) {
		logError('google-calendar', 'OAuth callback error', {
			tenantId: event.locals.tenant.id,
			metadata: { error: errorParam }
		});
		throw redirect(302, `${redirectBase}?status=error&reason=${encodeURIComponent(errorParam)}`);
	}

	if (!code || !state) {
		throw redirect(302, `${redirectBase}?status=error&reason=missing_params`);
	}

	if (state !== event.locals.tenant.id) {
		logError('google-calendar', 'OAuth callback state mismatch', {
			tenantId: event.locals.tenant.id,
			metadata: { receivedState: state }
		});
		throw redirect(302, `${redirectBase}?status=error&reason=state_mismatch`);
	}

	try {
		const { email } = await exchangeCodeAndSave(event.locals.tenant.id, code);
		throw redirect(302, `${redirectBase}?status=connected&email=${encodeURIComponent(email)}`);
	} catch (err) {
		// Redirects throw a special error; let SvelteKit's redirect propagate
		if (err && typeof err === 'object' && 'status' in err && (err as any).status === 302) {
			throw err;
		}
		logError('google-calendar', 'OAuth exchange failed', {
			tenantId: event.locals.tenant.id,
			metadata: { error: serializeError(err) }
		});
		throw redirect(302, `${redirectBase}?status=error&reason=exchange_failed`);
	}
};
```

- [ ] **Step 2: Verify**

```bash
cd app
bun run check 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add app/src/routes/api/integrations/google-calendar/callback/+server.ts
git commit -m "feat(meet): /api/integrations/google-calendar/callback — exchange + persist"
```

---

## Task 10: Settings Page `/settings/google-calendar`

**Files:**
- Create: `app/src/routes/[tenant]/settings/google-calendar/+page.server.ts`
- Create: `app/src/routes/[tenant]/settings/google-calendar/+page.svelte`

- [ ] **Step 1: Create server load**

Create `app/src/routes/[tenant]/settings/google-calendar/+page.server.ts`:

```ts
import type { PageServerLoad, Actions } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { getCalendarStatus, disconnectCalendar } from '$lib/server/google-calendar/auth';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	if (event.locals.isClientUser) {
		throw error(403, 'Forbidden');
	}

	const status = await getCalendarStatus(event.locals.tenant.id);
	return { status };
};

export const actions: Actions = {
	disconnect: async (event) => {
		if (!event.locals.user || !event.locals.tenant || event.locals.isClientUser) {
			throw error(403, 'Forbidden');
		}
		await disconnectCalendar(event.locals.tenant.id);
		throw redirect(303, `/${event.params.tenant}/settings/google-calendar?status=disconnected`);
	}
};
```

- [ ] **Step 2: Create page UI**

Create `app/src/routes/[tenant]/settings/google-calendar/+page.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import CalendarIcon from '@lucide/svelte/icons/calendar';

	let { data }: { data: { status: { connected: boolean; email: string | null } } } = $props();
	const tenantSlug = $derived(page.params.tenant ?? '');
	const statusParam = $derived(page.url.searchParams.get('status'));
	const emailParam = $derived(page.url.searchParams.get('email'));
	const reasonParam = $derived(page.url.searchParams.get('reason'));
</script>

<svelte:head>
	<title>Google Calendar · Setări</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6 p-6">
	<header class="space-y-1">
		<h1 class="text-2xl font-bold text-slate-900">Google Calendar</h1>
		<p class="text-sm text-slate-600">
			Conectează un cont Google pentru a genera automat linkuri Google Meet la crearea task-urilor de tip meeting.
			<br />
			<strong>Recomandare:</strong> folosește același cont Google ca Gmail-ul pentru consistență.
		</p>
	</header>

	{#if statusParam === 'connected' && emailParam}
		<div class="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
			✓ Conectat cu succes ca <strong>{emailParam}</strong>.
		</div>
	{:else if statusParam === 'disconnected'}
		<div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
			Conexiunea a fost dezactivată.
		</div>
	{:else if statusParam === 'error'}
		<div class="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
			Eroare la conectare: <code>{reasonParam ?? 'unknown'}</code>. Încearcă din nou.
		</div>
	{/if}

	<div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
		<div class="flex items-start gap-4">
			<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
				<CalendarIcon class="h-6 w-6" />
			</div>
			<div class="flex-1 space-y-3">
				{#if data.status.connected}
					<div class="flex items-center gap-2">
						<CheckCircleIcon class="h-5 w-5 text-emerald-600" />
						<h2 class="text-lg font-bold text-slate-900">Conectat</h2>
					</div>
					<p class="text-sm text-slate-600">
						Cont activ: <strong class="text-slate-900">{data.status.email}</strong>
					</p>
					<form method="POST" action="?/disconnect" class="pt-2">
						<button
							type="submit"
							class="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:border-red-300 hover:bg-red-50"
						>
							Deconectează
						</button>
					</form>
				{:else}
					<div class="flex items-center gap-2">
						<XCircleIcon class="h-5 w-5 text-slate-400" />
						<h2 class="text-lg font-bold text-slate-900">Neconectat</h2>
					</div>
					<p class="text-sm text-slate-600">
						Conectează contul Google pentru a activa generarea automată de linkuri Meet.
					</p>
					<a
						href="/api/integrations/google-calendar/auth"
						class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
					>
						<CalendarIcon class="h-4 w-4" />
						Conectează Google Calendar
					</a>
				{/if}
			</div>
		</div>
	</div>

	<div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
		<strong>Cum funcționează:</strong> când creezi un task de tip <em>Meeting</em>, sistemul creează automat un eveniment în Google Calendar și generează un link Google Meet. Participanții primesc invitația prin email automat. La modificarea task-ului (ora, durată, participanți), evenimentul se actualizează. La ștergerea task-ului, evenimentul se șterge.
	</div>
</div>
```

- [ ] **Step 3: Verify**

```bash
cd app
bun run check 2>&1 | tail -5
```

Run autofixer on the new `.svelte` file via Svelte MCP.

- [ ] **Step 4: Commit**

```bash
git add app/src/routes/\[tenant\]/settings/google-calendar/+page.server.ts app/src/routes/\[tenant\]/settings/google-calendar/+page.svelte
git commit -m "feat(meet): /settings/google-calendar page — connect/disconnect UI"
```

---

## MILESTONE 1 — Module + OAuth + Settings ready

Report state: 10 commits on branch; 5 tests passing in meet.test.ts; settings page reachable.

---

## Task 11: Register `meet_event_*` Action Types

**Files:**
- Modify: `app/src/lib/server/task-activity.ts`

- [ ] **Step 1: Find the action type union/list**

```bash
grep -n "action:\|ACTIONS\|TaskActivityAction\|type Action" app/src/lib/server/task-activity.ts | head -10
```

- [ ] **Step 2: Add 5 action types**

Extend the union/list with:
```
meet_event_created
meet_event_updated
meet_event_deleted
meet_event_failed
meet_event_orphaned
```

- [ ] **Step 3: Verify + commit**

```bash
cd app
bun run check 2>&1 | tail -5
git add app/src/lib/server/task-activity.ts
git commit -m "feat(meet): register meet_event_* action types"
```

---

## Task 12: Wire `createTask` Hook

**Files:**
- Modify: `app/src/lib/remotes/tasks.remote.ts`

- [ ] **Step 1: Add imports at top**

```ts
import { createMeetEvent } from '$lib/server/google-calendar/meet';
import { getCalendarStatus, CalendarNotConnected } from '$lib/server/google-calendar/auth';
```

- [ ] **Step 2: Find the createTask function end**

```bash
grep -n "^export const createTask\|^const createTask" app/src/lib/remotes/tasks.remote.ts
```

- [ ] **Step 3: Add post-insert Calendar hook**

Inside `createTask`, after the task row is inserted (and after subtasks/tags/assignees are linked), BEFORE the function returns, add:

```ts
// Auto-generate Google Meet for type=meeting tasks (separate integration)
if (data.type === 'meeting' && data.meetTime) {
	const status = await getCalendarStatus(event.locals.tenant.id);
	if (status.connected) {
		try {
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
			if (!(err instanceof CalendarNotConnected)) {
				await recordTaskActivity({
					taskId,
					userId: event.locals.user.id,
					action: 'meet_event_failed',
					metadata: { stage: 'create', error: err instanceof Error ? err.message : String(err) }
				});
			}
			// Task succeeds regardless
		}
	}
}
```

Ensure `inArray` is imported from `drizzle-orm` (likely already).

- [ ] **Step 4: Verify + commit**

```bash
cd app
bun run check 2>&1 | tail -5
bun test src/lib/remotes/__tests__/tasks.remote.test.ts 2>&1 | tail -5
git add app/src/lib/remotes/tasks.remote.ts
git commit -m "feat(meet): wire createTask Calendar hook (post-insert, graceful fallback)"
```

Expected: existing tasks tests still pass.

---

## Task 13: Wire `scheduleMeet` Hook

**Files:**
- Modify: `app/src/lib/remotes/tasks.remote.ts`

- [ ] **Step 1: Find scheduleMeet body**

```bash
grep -n "^export const scheduleMeet" app/src/lib/remotes/tasks.remote.ts
```

- [ ] **Step 2: Add Calendar create when no eventId exists**

Before the final return in `scheduleMeet`, add the same pattern as Task 12 but reading the task first to get title/description/clientId. Code pattern (adapt as needed):

```ts
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
		if (status.connected) {
			try {
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
						.where(and(eq(table.client.id, taskRow.clientId), eq(table.client.tenantId, event.locals.tenant.id)))
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
					.set({ meetLink: meetResult.hangoutLink, googleCalendarEventId: meetResult.eventId })
					.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)));

				await recordTaskActivity({
					taskId,
					userId: event.locals.user.id,
					action: 'meet_event_created',
					metadata: { eventId: meetResult.eventId, attendeeCount: attendeeEmails.length }
				});
			} catch (err) {
				if (!(err instanceof CalendarNotConnected)) {
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
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd app
bun run check 2>&1 | tail -5
bun test src/lib/remotes/__tests__/tasks.remote.test.ts 2>&1 | tail -5
git add app/src/lib/remotes/tasks.remote.ts
git commit -m "feat(meet): wire scheduleMeet Calendar hook (create if missing)"
```

---

## Task 14: Wire `updateTask` Diff + Bidirectional Sync

**Files:**
- Modify: `app/src/lib/remotes/tasks.remote.ts`

- [ ] **Step 1: Find updateTask + capture pre-update snapshot**

In `updateTask`, just before the DB UPDATE, ensure we have a snapshot of `{type, meetTime, meetDurationMinutes, googleCalendarEventId, title, description, clientId}` for the existing row. If `existing` is already fetched earlier, reuse; otherwise add the SELECT.

- [ ] **Step 2: After DB write, add 3-case Calendar sync**

Add the full block from spec §6 — Case A (delete on type change), Case B (update on field change with existing event), Case C (create on type promotion). The plan in `2026-05-19-google-meet-integration.md` v1 had the full code in Task 11; reuse it but replace `getCalendarStatus.hasCalendarScope` check with just `status.connected` (the v2 status object doesn't have `hasCalendarScope`).

Three cases:
1. `hadEvent && !isStillMeeting` → `deleteMeetEvent`, clear DB fields, log
2. `hadEvent && isStillMeeting && (any relevant field changed)` → `updateMeetEvent` with diff, log
3. `!hadEvent && isStillMeeting && newMeetTime && data.type === 'meeting'` → `createMeetEvent`, persist, log

Use dynamic imports for `updateMeetEvent`/`deleteMeetEvent`:
```ts
const { updateMeetEvent } = await import('$lib/server/google-calendar/meet');
const { deleteMeetEvent } = await import('$lib/server/google-calendar/meet');
```

- [ ] **Step 3: Verify + commit**

```bash
cd app
bun run check 2>&1 | tail -5
bun test src/lib/remotes/__tests__/tasks.remote.test.ts 2>&1 | tail -5
git add app/src/lib/remotes/tasks.remote.ts
git commit -m "feat(meet): updateTask diff → create/update/delete Calendar event"
```

---

## Task 15: Wire `deleteTask` Pre-Hook

**Files:**
- Modify: `app/src/lib/remotes/tasks.remote.ts`

- [ ] **Step 1: Find deleteTask body**

```bash
grep -n "^export const deleteTask" app/src/lib/remotes/tasks.remote.ts
```

- [ ] **Step 2: Add pre-delete Calendar cleanup**

Before the `db.delete(table.task)`, fetch `googleCalendarEventId` and fire deleteMeetEvent if present:

```ts
const [taskRow] = await db
	.select({ googleCalendarEventId: table.task.googleCalendarEventId })
	.from(table.task)
	.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
	.limit(1);

if (taskRow?.googleCalendarEventId) {
	const status = await getCalendarStatus(event.locals.tenant.id);
	if (status.connected) {
		try {
			const { deleteMeetEvent } = await import('$lib/server/google-calendar/meet');
			await deleteMeetEvent({ tenantId: event.locals.tenant.id, eventId: taskRow.googleCalendarEventId });
		} catch (err) {
			logWarning('google-calendar', 'Calendar event delete failed during task delete', {
				tenantId: event.locals.tenant.id,
				metadata: { taskId, eventId: taskRow.googleCalendarEventId, error: err instanceof Error ? err.message : String(err) }
			});
		}
	}
}
```

Ensure `logWarning` is imported.

- [ ] **Step 3: Verify + commit**

```bash
cd app
bun run check 2>&1 | tail -5
bun test src/lib/remotes/__tests__/tasks.remote.test.ts 2>&1 | tail -5
git add app/src/lib/remotes/tasks.remote.ts
git commit -m "feat(meet): deleteTask cleans up Calendar event (best-effort)"
```

---

## Task 16: `getGoogleCalendarStatus` Remote Query

**Files:**
- Create or extend: `app/src/lib/remotes/integrations.remote.ts`

- [ ] **Step 1: Check if file exists**

```bash
ls app/src/lib/remotes/integrations.remote.ts 2>/dev/null
```

- [ ] **Step 2: Add the query**

```ts
import { query, getRequestEvent } from '$app/server';
import { getCalendarStatus } from '$lib/server/google-calendar/auth';

export const getGoogleCalendarStatus = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		return { connected: false, email: null };
	}
	return getCalendarStatus(event.locals.tenant.id);
});
```

- [ ] **Step 3: Verify + commit**

```bash
cd app
bun run check 2>&1 | tail -5
git add app/src/lib/remotes/integrations.remote.ts
git commit -m "feat(meet): getGoogleCalendarStatus query (UI conditional banner)"
```

---

## MILESTONE 2 — Backend Complete

Tasks 1-16 done; 15+ commits; backend fully wired for V1+V2 bidirectional sync.

---

## Task 17: Create-Task-Dialog 2-State Banner

**Files:**
- Modify: `app/src/lib/components/create-task-dialog.svelte`

- [ ] **Step 1: Add status query**

In `<script>` at top, add:

```ts
import { getGoogleCalendarStatus } from '$lib/remotes/integrations.remote';
import { page } from '$app/state';

const calStatusQuery = $derived(isMeet ? getGoogleCalendarStatus() : null);
const calStatus = $derived(calStatusQuery?.current);
const tenantSlug = $derived(page.params.tenant ?? '');
```

(Verify `page` is not already imported; only add if missing.)

- [ ] **Step 2: Replace "Faza 3" banner**

Find lines around 408-414 (the "Link Google Meet va fi generat automat la creare (Faza 3)" block). Replace with:

```svelte
<!-- Meet integration status banner -->
<div class="col-span-2">
	{#if !calStatus}
		<!-- loading or non-meeting → no banner -->
	{:else if !calStatus.connected}
		<div class="flex items-start gap-3 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
			<span class="mt-0.5 text-amber-600">⚠</span>
			<div class="text-xs text-amber-800">
				<strong>Conectează Google Calendar</strong> pentru a genera automat linkul Meet.
				<a href="/{tenantSlug}/settings/google-calendar" class="ml-1 font-semibold underline">Conectează</a>
			</div>
		</div>
	{:else}
		<div class="flex items-center gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
			<span class="text-emerald-600">✓</span>
			<div class="text-xs text-emerald-800">
				<strong>Linkul Meet va fi generat automat</strong> când salvezi (cont {calStatus.email}).
			</div>
		</div>
	{/if}
</div>
```

Also find line 727-742 (the "Upload disponibil în Faza 3" stub) — replace by removing the misleading copy. Keep the dropzone visual but remove "Faza 3" line:

```svelte
<p class="mt-0.5">sau click pentru a selecta · max 25MB</p>
<!-- "Faza 3" copy removed; upload wiring is a separate backlog item -->
```

- [ ] **Step 3: Autofixer + verify + commit**

```bash
cd app
# Run Svelte MCP autofixer on the file
bun run check 2>&1 | tail -5
git add app/src/lib/components/create-task-dialog.svelte
git commit -m "fix(create-task): 2-state Calendar banner (replaces Faza 3 promise)"
```

---

## Task 18: Admin Meet Modal Conditional

**Files:**
- Modify: `app/src/lib/components/task-detail/task-detail-body.svelte`

- [ ] **Step 1: Add status query**

```ts
import { getGoogleCalendarStatus } from '$lib/remotes/integrations.remote';
const calStatus = $derived(getGoogleCalendarStatus());
const calStatusValue = $derived(calStatus.current);
```

- [ ] **Step 2: Wrap meetLink paste field**

Find the admin Meet modal (around line 1073 or wherever `meetLink` paste input lives). Wrap with:

```svelte
{#if currentTask?.googleCalendarEventId}
	<div class="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-800">
		✓ Linkul Meet a fost generat automat. Evenimentul există în Google Calendar.
	</div>
{:else if calStatusValue?.connected}
	<div class="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-800">
		Linkul Meet se va genera automat când salvezi (cont {calStatusValue.email}).
	</div>
{:else}
	<!-- existing manual paste input -->
{/if}
```

- [ ] **Step 3: Autofixer + verify + commit**

```bash
cd app
bun run check 2>&1 | tail -5
git add app/src/lib/components/task-detail/task-detail-body.svelte
git commit -m "fix(task-detail): admin Meet modal — hide manual paste when auto-gen active"
```

---

## Task 19: Client Meet Modal Conditional

**Files:**
- Modify: `app/src/lib/components/client-task/client-task-meet-modal.svelte`

- [ ] **Step 1: Add status banner**

```ts
import { getGoogleCalendarStatus } from '$lib/remotes/integrations.remote';
const calStatusQuery = $derived(open ? getGoogleCalendarStatus() : null);
const calStatus = $derived(calStatusQuery?.current);
```

In modal body, after the header:

```svelte
{#if calStatus}
	{#if !calStatus.connected}
		<div class="mx-5 mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
			Google Calendar neconectat. Meeting-ul se programează dar linkul Meet trebuie adăugat manual.
		</div>
	{:else}
		<div class="mx-5 mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
			✓ Linkul Meet va fi generat automat la salvare (cont {calStatus.email}).
		</div>
	{/if}
{/if}
```

- [ ] **Step 2: Autofixer + verify + commit**

```bash
cd app
bun run check 2>&1 | tail -5
git add app/src/lib/components/client-task/client-task-meet-modal.svelte
git commit -m "fix(client-task): Meet modal shows Calendar status banner"
```

---

## Task 20: Smoke Verification + Milestone

**Files:**
- Create: `app/docs/superpowers/meet-integration-smoke-checklist.md`

- [ ] **Step 1: Final svelte-check + tests**

```bash
cd app
NODE_OPTIONS="--max-old-space-size=8192" bunx svelte-check --threshold error 2>&1 | tail -5
bun test src/lib/server/google-calendar/__tests__/meet.test.ts 2>&1 | tail -5
bun test src/lib/remotes/__tests__/tasks.remote.test.ts 2>&1 | tail -5
```

Expected: meet tests = 5 pass; tasks tests = 64+ pass; svelte-check baseline.

- [ ] **Step 2: Write smoke checklist**

Create `app/docs/superpowers/meet-integration-smoke-checklist.md`:

```markdown
# Google Meet Integration — Post-Deploy Smoke

Run AFTER deploy + migrations 0336+0337 applied on Turso.

## Pre-conditions
- [ ] Settings → Google Calendar → Connect with a Workspace account
- [ ] Verify `google_calendar_integration` row exists with `is_active=1`

## Create flow
- [ ] Open Tasks → + → Meeting type
- [ ] Wizard shows GREEN banner with the connected email
- [ ] Submit; open created task → meetLink shows real `meet.google.com/...`
- [ ] Open Google Calendar → event exists with same time + attendees

## Update flow
- [ ] Edit meeting task: change meetTime → Calendar event time updated
- [ ] Edit assignees → Calendar attendees updated
- [ ] Change type meeting→design → Calendar event deleted; meetLink cleared

## Delete flow
- [ ] Delete the task → Calendar event removed

## Fallback (disconnected)
- [ ] Disconnect from Settings → open create dialog → AMBER banner
- [ ] Submit meeting task → succeeds; meetLink null
```

- [ ] **Step 3: Milestone commit + ask user for merge**

```bash
git add app/docs/superpowers/meet-integration-smoke-checklist.md
git commit -m "docs(meet): post-deploy smoke checklist"
git commit --allow-empty -m "milestone: Google Meet integration v1 complete (separate module)"
```

Then report back to user with summary. Wait for explicit merge authorization.

---

## Self-Review

**1. Spec coverage:**
- §1 Architecture (separate module) → Task 2 (table) + Task 8-10 (OAuth + settings)
- §2 Schema → Task 2 + Task 3
- §3 OAuth flow → Tasks 8-9
- §4 Calendar config → Task 4 (auth.ts) + Task 5 (meet.ts defaults)
- §5 Attendees → Tasks 12-14 (auto-derived from assignees + client)
- §6 Trigger points + sync → Tasks 12-15
- §7 New code surface → all mapped
- §8 Multi-tenant safety → every hook scopes by `event.locals.tenant.id`
- §9 UI 2-state → Tasks 17-19
- §10 Testing → Tasks 5-7 (unit) + Task 20 (smoke)
- §11 Effort estimate aligns
- §12 Risks → mitigations in fallback code in Tasks 12-15

**2. Placeholder scan:** No "TBD"/"implement later". Each code step has full code.

**3. Type consistency:**
- `CalendarStatus = { connected, email }` — same in auth.ts (Task 4), integrations.remote.ts (Task 16), all UI consumers (Tasks 17-19)
- `googleCalendarEventId` column name consistent in schema (Task 2), migration (Task 3), all UPDATE statements (Tasks 12-15)
- Action types `meet_event_*` declared once (Task 11), used consistently
- `getCalendarClient` / `getCalendarStatus` / `getOAuthUrl` / `exchangeCodeAndSave` / `disconnectCalendar` — all defined in Task 4, consumed elsewhere

---

## Execution Handoff

Plan saved. **Execute via superpowers:subagent-driven-development.** Fresh subagent per task cluster + two-stage review.
