import { describe, it, expect, mock } from 'bun:test';

// Mock ALL SvelteKit virtual modules — hoisted before any module resolution
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/db/schema', () => ({}));
mock.module('$lib/server/plugins/smartbill/crypto', () => ({
	encryptVerified: (t: string, v: string) => `enc:${v}`,
	decrypt: (_t: string, v: string) => v.replace('enc:', '')
}));
mock.module('@oslojs/encoding', () => ({
	encodeBase32LowerCase: () => 'testid123'
}));

// Mock googleapis
mock.module('googleapis', () => ({
	google: {
		calendar: () => ({
			events: {
				insert: mock(async ({ requestBody }: { requestBody: Record<string, unknown> }) => ({
					data: {
						id: 'evt_test_123',
						hangoutLink: 'https://meet.google.com/abc-defg-hij',
						start: requestBody.start,
						end: requestBody.end,
						attendees: requestBody.attendees
					}
				})),
				patch: mock(
					async ({
						eventId,
						requestBody
					}: {
						eventId: string;
						requestBody: Record<string, unknown>;
					}) => ({
						data: { id: eventId, ...requestBody }
					})
				),
				delete: mock(async () => ({ data: {} }))
			}
		}),
		auth: { OAuth2: class { setCredentials() {} } },
		oauth2: () => ({
			userinfo: { get: async () => ({ data: { email: 'test@example.com' } }) }
		})
	}
}));

// Mock the auth module using the $lib path alias (how meet.ts references it after bundler resolution)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetCalendarClient = mock(async (): Promise<any> => {
	const { google } = await import('googleapis');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (google.calendar as any)();
});
const mockGetCalendarStatus = mock(async () => ({ connected: true, email: 'a@b.com' }));

class MockCalendarNotConnected extends Error {
	constructor(tenantId: string) {
		super(`Tenant ${tenantId} has no active Google Calendar integration`);
		this.name = 'CalendarNotConnected';
	}
}

mock.module('../auth', () => ({
	getCalendarClient: mockGetCalendarClient,
	getCalendarStatus: mockGetCalendarStatus,
	CalendarNotConnected: MockCalendarNotConnected
}));

// Also mock via $lib path in case meet.ts resolution differs
mock.module('$lib/server/google-calendar/auth', () => ({
	getCalendarClient: mockGetCalendarClient,
	getCalendarStatus: mockGetCalendarStatus,
	CalendarNotConnected: MockCalendarNotConnected
}));

// Mock logger
mock.module('$lib/server/logger', () => ({
	logInfo: mock(() => {}),
	logWarning: mock(() => {}),
	logError: mock(() => {}),
	serializeError: (e: unknown) => String(e)
}));

const { createMeetEvent, updateMeetEvent, deleteMeetEvent } = await import('../meet');

describe('createMeetEvent', () => {
	it('returns eventId and hangoutLink on success', async () => {
		const result = await createMeetEvent({
			tenantId: 'tenant-a',
			title: 'Test Meeting',
			startTime: '2026-05-20T10:00:00',
			durationMinutes: 30,
			timezone: 'Europe/Bucharest',
			attendees: ['user@example.com'],
			description: 'Test description'
		});

		expect(result.eventId).toBe('evt_test_123');
		expect(result.hangoutLink).toBe('https://meet.google.com/abc-defg-hij');
	});

	// Regression: production (UTC container) sent `10:00` as `10:00Z` and Google
	// ignores `timeZone` when the dateTime carries an offset, so every Romanian
	// meeting landed three hours late. The payload must stay offset-free.
	it('sends offset-free local times so Google honours the timeZone field', async () => {
		const insert = mock(async ({ requestBody }: { requestBody: Record<string, unknown> }) => ({
			data: {
				id: 'evt_tz',
				hangoutLink: 'https://meet.google.com/tz',
				start: requestBody.start,
				end: requestBody.end
			}
		}));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockGetCalendarClient.mockImplementationOnce(async (): Promise<any> => ({
			events: { insert }
		}));

		await createMeetEvent({
			tenantId: 'tenant-a',
			title: 'TZ check',
			startTime: '2026-08-21T10:00:00',
			durationMinutes: 30,
			timezone: 'Europe/Bucharest',
			attendees: []
		});

		const body = insert.mock.calls[0][0].requestBody as {
			start: { dateTime: string; timeZone: string };
			end: { dateTime: string; timeZone: string };
		};
		expect(body.start.dateTime).toBe('2026-08-21T10:00:00');
		expect(body.start.timeZone).toBe('Europe/Bucharest');
		expect(body.end.dateTime).toBe('2026-08-21T10:30:00');
		expect(body.start.dateTime).not.toContain('Z');
		expect(body.end.dateTime).not.toContain('Z');
	});

	// The old code threw when hangoutLink was absent, *after* Google had already
	// created the event — leaving an orphan nobody could update or delete.
	it('keeps the eventId when the Meet link is still being provisioned', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockGetCalendarClient.mockImplementationOnce(async (): Promise<any> => ({
			events: {
				insert: async () => ({
					data: {
						id: 'evt_pending',
						conferenceData: { createRequest: { status: { statusCode: 'pending' } } }
					}
				}),
				get: async () => ({ data: { id: 'evt_pending' } })
			}
		}));

		const result = await createMeetEvent({
			tenantId: 'tenant-a',
			title: 'Pending conference',
			startTime: '2026-08-21T10:00:00',
			durationMinutes: 30,
			timezone: 'Europe/Bucharest',
			attendees: []
		});

		expect(result.eventId).toBe('evt_pending');
		expect(result.hangoutLink).toBeNull();
	});

	it('falls back to the video entry point when hangoutLink is absent', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockGetCalendarClient.mockImplementationOnce(async (): Promise<any> => ({
			events: {
				insert: async () => ({
					data: {
						id: 'evt_entry',
						conferenceData: {
							entryPoints: [
								{ entryPointType: 'phone', uri: 'tel:+40000' },
								{ entryPointType: 'video', uri: 'https://meet.google.com/xyz-abcd-efg' }
							]
						}
					}
				})
			}
		}));

		const result = await createMeetEvent({
			tenantId: 'tenant-a',
			title: 'Entry point',
			startTime: '2026-08-21T10:00:00',
			durationMinutes: 30,
			timezone: 'Europe/Bucharest',
			attendees: []
		});

		expect(result.hangoutLink).toBe('https://meet.google.com/xyz-abcd-efg');
	});

	it('throws CalendarNotConnected when integration missing', async () => {
		mockGetCalendarClient.mockImplementationOnce(async () => {
			throw new MockCalendarNotConnected('tenant-x');
		});

		await expect(
			createMeetEvent({
				tenantId: 'tenant-x',
				title: 'No connection',
				startTime: '2026-05-20T10:00:00',
				durationMinutes: 30,
				timezone: 'Europe/Bucharest',
				attendees: []
			})
		).rejects.toThrow();
	});
});

describe('updateMeetEvent', () => {
	it('returns true on successful patch with new times and attendees', async () => {
		const result = await updateMeetEvent({
			tenantId: 'tenant-a',
			eventId: 'evt_test_123',
			startTime: '2026-05-20T11:00:00',
			durationMinutes: 60,
			timezone: 'Europe/Bucharest',
			attendees: ['user1@example.com', 'user2@example.com'],
			title: 'Updated Meeting'
		});
		expect(result.ok).toBe(true);
	});

	it('patches offset-free local times', async () => {
		const patch = mock(async ({ requestBody }: { requestBody: Record<string, unknown> }) => ({
			data: { id: 'evt_test_123', ...requestBody }
		}));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockGetCalendarClient.mockImplementationOnce(async (): Promise<any> => ({
			events: { patch }
		}));

		await updateMeetEvent({
			tenantId: 'tenant-a',
			eventId: 'evt_test_123',
			startTime: '2026-08-21T14:00:00',
			durationMinutes: 90,
			timezone: 'Europe/Bucharest'
		});

		const body = patch.mock.calls[0][0].requestBody as {
			start: { dateTime: string; timeZone: string };
			end: { dateTime: string };
		};
		expect(body.start.dateTime).toBe('2026-08-21T14:00:00');
		expect(body.start.timeZone).toBe('Europe/Bucharest');
		expect(body.end.dateTime).toBe('2026-08-21T15:30:00');
	});
});

describe('deleteMeetEvent', () => {
	it('returns true on successful delete', async () => {
		const result = await deleteMeetEvent({ tenantId: 'tenant-a', eventId: 'evt_test_123' });
		expect(result).toBe(true);
	});

	it('returns true (idempotent) when event is already gone (404)', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockGetCalendarClient.mockImplementationOnce(async (): Promise<any> => ({
			events: {
				delete: async () => {
					const err = Object.assign(new Error('Not Found'), { code: 404 });
					throw err;
				}
			}
		}));
		const result = await deleteMeetEvent({ tenantId: 'tenant-a', eventId: 'evt_gone' });
		expect(result).toBe(true);
	});
});
