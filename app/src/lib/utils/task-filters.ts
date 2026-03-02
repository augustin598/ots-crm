/**
 * Utility functions for task filtering and date calculations
 * Types, formatStatus, formatPriority, getPriorityColor are re-exported from task-kanban-utils (single source of truth)
 */

export {
	type TaskStatus,
	type TaskPriority,
	TASK_STATUSES,
	TASK_PRIORITIES,
	formatStatus,
	formatPriority,
	getPriorityColor
} from '$lib/components/task-kanban-utils';

/**
 * Calculate date ranges for filter options
 */
export function getDateRange(filter: string): { start: Date; end: Date } | null {
	const now = new Date();
	now.setHours(0, 0, 0, 0);
	const todayEnd = new Date(now);
	todayEnd.setHours(23, 59, 59, 999);

	switch (filter) {
		case 'overdue':
			return {
				start: new Date(0), // Beginning of time
				end: new Date(now.getTime() - 1) // One millisecond before today
			};
		case 'today':
			return {
				start: now,
				end: todayEnd
			};
		case 'thisWeek': {
			const weekEnd = new Date(now);
			weekEnd.setDate(weekEnd.getDate() + 7);
			return {
				start: now,
				end: weekEnd
			};
		}
		case 'thisMonth': {
			const monthEnd = new Date(now);
			monthEnd.setMonth(monthEnd.getMonth() + 1);
			return {
				start: now,
				end: monthEnd
			};
		}
		default:
			if (filter.startsWith('dateRange:')) {
				const [startStr, endStr] = filter.replace('dateRange:', '').split(':');
				const start = new Date(startStr);
				const end = new Date(endStr);
				end.setHours(23, 59, 59, 999);
				return { start, end };
			}
			return null;
	}
}

/**
 * Format date range for display
 */
export function formatDateRange(filter: string): string {
	switch (filter) {
		case 'overdue':
			return 'Overdue';
		case 'today':
			return 'Today';
		case 'thisWeek':
			return 'This Week';
		case 'thisMonth':
			return 'This Month';
		default:
			if (filter.startsWith('dateRange:')) {
				const [startStr, endStr] = filter.replace('dateRange:', '').split(':');
				const start = new Date(startStr);
				const end = new Date(endStr);
				return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
			}
			return filter;
	}
}

/**
 * Check if a task is overdue
 */
export function isTaskOverdue(dueDate: Date | string | null): boolean {
	if (!dueDate) return false;
	const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
	const now = new Date();
	now.setHours(0, 0, 0, 0);
	return due < now;
}
