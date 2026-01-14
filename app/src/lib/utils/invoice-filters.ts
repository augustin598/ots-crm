/**
 * Utility functions for invoice filtering and date calculations
 */

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';

export const INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];

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
		case 'lastMonth': {
			const lastMonthStart = new Date(now);
			lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
			lastMonthStart.setDate(1);
			lastMonthStart.setHours(0, 0, 0, 0);
			const lastMonthEnd = new Date(now);
			lastMonthEnd.setDate(0); // Last day of previous month
			lastMonthEnd.setHours(23, 59, 59, 999);
			return {
				start: lastMonthStart,
				end: lastMonthEnd
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
 * Format status for display
 */
export function formatStatus(status: string): string {
	return status.charAt(0).toUpperCase() + status.slice(1);
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
		case 'lastMonth':
			return 'Last Month';
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
