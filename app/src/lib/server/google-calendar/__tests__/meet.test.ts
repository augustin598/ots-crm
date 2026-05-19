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
		mockGetCalendarClient.mockImplementationOnce(async () => {
			throw new MockCalendarNotConnected('tenant-x');
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
