import { describe, test, expect, beforeEach, mock } from 'bun:test';

// SvelteKit virtual modules + db must be mocked before importing the SUT.
type Row = Record<string, unknown>;
let staleRows: Row[] = [];
const updates: Array<{ values: Row }> = [];
const activities: Row[] = [];

const dbMock = {
	select: () => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			where: () => chain,
			then: (resolve: (rows: Row[]) => unknown) => resolve(staleRows)
		};
		return chain;
	},
	update: () => {
		const chain: Record<string, unknown> = {
			set: (values: Row) => {
				updates.push({ values });
				return chain;
			},
			where: () => chain,
			then: (resolve: (v: unknown) => unknown) => resolve(undefined)
		};
		return chain;
	}
};

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));
mock.module('$lib/server/email', () => ({ sendTaskAssignmentEmail: async () => {} }));
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('../../db', () => ({ db: dbMock }));
mock.module('$lib/server/db/schema', () => ({ task: {} }));
mock.module('../../db/schema', () => ({ task: {} }));
mock.module('$lib/server/task-activity', () => ({
	recordTaskActivity: async (params: Row) => {
		activities.push(params);
	}
}));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' })
}));

const { processRecurringTasksCatchup } = await import('../recurring-tasks-catchup');

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const todayMidnight = () => {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d;
};
const daysAgo = (n: number) => {
	const d = todayMidnight();
	d.setDate(d.getDate() - n);
	return d;
};
const daysLate = (d: Date) => Math.round((todayMidnight().getTime() - d.getTime()) / 86_400_000);
const baseRow = (over: Row): Row => ({
	id: 'task-1',
	tenantId: 't-1',
	title: 'Raport săptămânal',
	recurringType: 'weekly',
	recurringInterval: 1,
	recurringEndDate: null,
	createdByUserId: 'u-1',
	...over
});

describe('processRecurringTasksCatchup', () => {
	beforeEach(() => {
		staleRows = [];
		updates.length = 0;
		activities.length = 0;
	});

	test('does nothing when there is no stale occurrence', async () => {
		const result = await processRecurringTasksCatchup();
		expect(result).toEqual({ success: true, rolled: 0 });
		expect(updates).toHaveLength(0);
	});

	test('rolls a weekly occurrence stale by 20 days onto the current period', async () => {
		staleRows = [baseRow({ dueDate: daysAgo(20) })];

		const result = await processRecurringTasksCatchup();

		expect(result.rolled).toBe(1);
		expect(updates).toHaveLength(1);
		// Occurrences fall on day -13, -6 and +1; the latest one still <= today is -6.
		// The row ends up late by less than one interval instead of by three weeks.
		expect(daysLate(updates[0].values.dueDate as Date)).toBe(6);
	});

	test('never moves a due date into the future', async () => {
		staleRows = [baseRow({ dueDate: daysAgo(20) })];

		await processRecurringTasksCatchup();

		expect(daysLate(updates[0].values.dueDate as Date)).toBeGreaterThanOrEqual(0);
	});

	test('records the missed periods in the task activity', async () => {
		staleRows = [baseRow({ dueDate: daysAgo(20) })];

		await processRecurringTasksCatchup();

		expect(activities).toHaveLength(1);
		expect(activities[0].action).toBe('recurring_occurrence_rolled');
		expect(activities[0].taskId).toBe('task-1');
		const payload = JSON.parse(activities[0].newValue as string);
		expect(payload.missed).toBe(2); // the anchor plus one intermediate week
		expect(payload.from).toBeString();
		expect(payload.to).toBeString();
	});

	test('leaves an occurrence late by less than one full period alone', async () => {
		staleRows = [baseRow({ dueDate: daysAgo(3) })];

		const result = await processRecurringTasksCatchup();

		expect(result.rolled).toBe(0);
		expect(updates).toHaveLength(0);
		expect(activities).toHaveLength(0);
	});

	test('does not reschedule past the series end date', async () => {
		staleRows = [
			baseRow({ dueDate: daysAgo(21), recurringEndDate: daysAgo(14) })
		];

		const result = await processRecurringTasksCatchup();

		expect(result.rolled).toBe(0);
		expect(result.chainsEnded).toBe(1);
		expect(updates).toHaveLength(0);
	});

	test('keeps going when one row throws', async () => {
		staleRows = [
			baseRow({ id: 'bad', dueDate: daysAgo(21), recurringType: 'hourly' }),
			baseRow({ id: 'good', dueDate: daysAgo(21) })
		];

		const result = await processRecurringTasksCatchup();

		expect(result.rolled).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors?.[0].id).toBe('bad');
	});

	test('monthly series keeps its day-of-month anchor', async () => {
		// Fixed dates rather than daysAgo so the assertion is not calendar-dependent.
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const anchor = at(today.getFullYear() - 1, 1, 15);
		staleRows = [baseRow({ dueDate: anchor, recurringType: 'monthly' })];

		await processRecurringTasksCatchup();

		const newDue = updates[0].values.dueDate as Date;
		expect(newDue.getDate()).toBe(15);
		expect(newDue.getTime()).toBeLessThanOrEqual(today.getTime());
		expect(newDue.getTime()).toBeGreaterThan(anchor.getTime());
	});
});
