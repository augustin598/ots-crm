import { describe, it, expect } from 'bun:test';
import { describeCalendarError } from '../errors';

describe('describeCalendarError', () => {
	/**
	 * The exact error that broke task `zlg2grifajpwpygsdy6hzgsb` on 2026-08-20 and
	 * was invisible in the UI for two days.
	 */
	it('recognises a disabled Calendar API and links the right Cloud project', () => {
		const err = Object.assign(
			new Error(
				'Google Calendar API has not been used in project 169740600525 before or it is disabled. ' +
					'Enable it by visiting https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=169740600525 then retry.'
			),
			{ code: 403, errors: [{ reason: 'accessNotConfigured' }] }
		);

		const info = describeCalendarError(err);

		expect(info.kind).toBe('api_disabled');
		expect(info.message).toContain('169740600525');
		expect(info.actionUrl).toContain('calendar-json.googleapis.com');
		expect(info.actionUrl).toContain('project=169740600525');
	});

	it('falls back to a generic enable link when no project is named', () => {
		const info = describeCalendarError(new Error('SERVICE_DISABLED'));
		expect(info.kind).toBe('api_disabled');
		expect(info.actionUrl).toBe(
			'https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview'
		);
	});

	it('recognises a missing integration', () => {
		const err = Object.assign(new Error('no integration'), { name: 'CalendarNotConnected' });
		expect(describeCalendarError(err).kind).toBe('not_connected');
	});

	it('recognises revoked or expired authorisation', () => {
		expect(describeCalendarError(new Error('invalid_grant')).kind).toBe('auth_expired');
		expect(
			describeCalendarError(new Error('Calendar token decrypt failed; reconnect required')).kind
		).toBe('auth_expired');
		expect(
			describeCalendarError(Object.assign(new Error('nope'), { code: 401 })).kind
		).toBe('auth_expired');
	});

	it('recognises rate limiting and missing events', () => {
		expect(describeCalendarError(Object.assign(new Error('slow down'), { code: 429 })).kind).toBe(
			'rate_limited'
		);
		expect(describeCalendarError(Object.assign(new Error('gone'), { code: 404 })).kind).toBe(
			'not_found'
		);
	});

	it('always returns a non-empty Romanian message', () => {
		for (const err of [new Error('boom'), 'plain string', { weird: true }, null]) {
			const info = describeCalendarError(err);
			expect(info.message.length).toBeGreaterThan(0);
			expect(typeof info.raw).toBe('string');
		}
	});
});
