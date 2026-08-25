import { describe, test, expect, mock } from 'bun:test';

// Must mock SvelteKit virtual modules BEFORE any module loads
mock.module('$app/server', () => ({
	query: (schema: unknown, fn: unknown) => fn,
	command: (schema: unknown, fn: unknown) => fn,
	getRequestEvent: () => null,
}));
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/db/schema', () => ({}));
mock.module('$lib/server/email', () => ({ sendTaskAssignmentEmail: async () => {} }));
mock.module('$lib/server/task-activity', () => ({ recordTaskActivity: async () => {} }));
mock.module('$lib/server/logger', () => ({
	logError: () => {},
	logWarning: () => {},
	logInfo: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' }),
}));

const { calculateNextTaskDueDate, nextRecurringDueDateAfter, currentRecurringDueDate, startOfToday } =
	await import('../recurring-tasks');

/** Local midnight, so tests never straddle a UTC day boundary. */
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('calculateNextTaskDueDate', () => {
	test('daily adds the interval in days', () => {
		expect(iso(calculateNextTaskDueDate(at(2026, 8, 1), 'daily', 3))).toBe('2026-08-04');
	});

	test('weekly adds interval * 7 days', () => {
		expect(iso(calculateNextTaskDueDate(at(2026, 8, 1), 'weekly', 2))).toBe('2026-08-15');
	});

	test('monthly clamps to the last day of a shorter month', () => {
		expect(iso(calculateNextTaskDueDate(at(2026, 1, 31), 'monthly', 1))).toBe('2026-02-28');
	});

	test('yearly clamps Feb 29 onto a non-leap year', () => {
		expect(iso(calculateNextTaskDueDate(at(2024, 2, 29), 'yearly', 1))).toBe('2025-02-28');
	});

	test('throws on an unknown type', () => {
		expect(() => calculateNextTaskDueDate(at(2026, 8, 1), 'hourly', 1)).toThrow('Unknown recurring type');
	});
});

describe('nextRecurringDueDateAfter', () => {
	test('on-time completion just advances one interval', () => {
		const r = nextRecurringDueDateAfter(at(2026, 8, 20), 'daily', 1, at(2026, 8, 20));
		expect(iso(r.dueDate)).toBe('2026-08-21');
		expect(r.skipped).toBe(0);
	});

	test('late completion never produces a due date in the past', () => {
		// The bug this fixes: due Aug 1, ticked Aug 20 used to spawn a child due Aug 2.
		const r = nextRecurringDueDateAfter(at(2026, 8, 1), 'daily', 1, at(2026, 8, 20));
		expect(iso(r.dueDate)).toBe('2026-08-21');
		expect(r.skipped).toBe(19);
	});

	test('weekly chain lands on the next occurrence of the same weekday', () => {
		const r = nextRecurringDueDateAfter(at(2026, 8, 1), 'weekly', 1, at(2026, 8, 20));
		expect(iso(r.dueDate)).toBe('2026-08-22');
		expect(r.skipped).toBe(2);
	});

	test('monthly keeps the calendar anchor instead of drifting', () => {
		// Chaining month by month would clamp Jan 31 → Feb 28 and then stay on the 28th.
		const r = nextRecurringDueDateAfter(at(2026, 1, 31), 'monthly', 1, at(2026, 3, 10));
		expect(iso(r.dueDate)).toBe('2026-03-31');
		expect(r.skipped).toBe(1); // only Feb 28 went by
	});

	test('a due date already in the future is left anchored where it is', () => {
		const r = nextRecurringDueDateAfter(at(2026, 9, 1), 'monthly', 1, at(2026, 8, 20));
		expect(iso(r.dueDate)).toBe('2026-10-01');
		expect(r.skipped).toBe(0);
	});

	test('treats a null/zero interval as 1 rather than looping forever', () => {
		const r = nextRecurringDueDateAfter(at(2026, 8, 1), 'daily', 0 as unknown as number, at(2026, 8, 5));
		expect(iso(r.dueDate)).toBe('2026-08-06');
	});
});

describe('currentRecurringDueDate', () => {
	test('returns null when less than one full period has elapsed', () => {
		expect(currentRecurringDueDate(at(2026, 8, 18), 'weekly', 1, at(2026, 8, 20))).toBeNull();
	});

	test('pulls a stale weekly occurrence onto the current period', () => {
		const r = currentRecurringDueDate(at(2026, 8, 1), 'weekly', 1, at(2026, 8, 20))!;
		expect(iso(r.dueDate)).toBe('2026-08-15');
		expect(r.missed).toBe(2); // Aug 1 and Aug 8 went by unfinished
	});

	test('never moves the due date into the future', () => {
		const r = currentRecurringDueDate(at(2026, 8, 1), 'daily', 1, at(2026, 8, 20))!;
		expect(iso(r.dueDate)).toBe('2026-08-20');
		expect(r.missed).toBe(19);
	});

	test('an occurrence landing exactly on today is the current one', () => {
		const r = currentRecurringDueDate(at(2026, 8, 13), 'weekly', 1, at(2026, 8, 20))!;
		expect(iso(r.dueDate)).toBe('2026-08-20');
		expect(r.missed).toBe(1);
	});

	test('monthly stays on the anchor day of month', () => {
		const r = currentRecurringDueDate(at(2026, 1, 31), 'monthly', 1, at(2026, 5, 10))!;
		expect(iso(r.dueDate)).toBe('2026-04-30');
		expect(r.missed).toBe(3);
	});
});

describe('startOfToday', () => {
	test('zeroes the clock so it matches the isTaskOverdue boundary', () => {
		const d = startOfToday(new Date(2026, 7, 20, 15, 42, 7));
		expect(d.getHours()).toBe(0);
		expect(d.getMinutes()).toBe(0);
		expect(iso(d)).toBe('2026-08-20');
	});
});
