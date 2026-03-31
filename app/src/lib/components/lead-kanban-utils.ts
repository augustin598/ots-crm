/**
 * Shared constants and utilities for lead Kanban board
 */

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'disqualified'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
	new: 'Nou',
	contacted: 'Contactat',
	qualified: 'Calificat',
	converted: 'Convertit',
	disqualified: 'Descalificat'
};

export const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
	new: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
	contacted: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
	qualified: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
	converted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
	disqualified: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
};

export function getStatusBorderColor(status: string): string {
	switch (status) {
		case 'new':
			return 'border-l-4 border-l-blue-500';
		case 'contacted':
			return 'border-l-4 border-l-yellow-500';
		case 'qualified':
			return 'border-l-4 border-l-green-500';
		case 'converted':
			return 'border-l-4 border-l-emerald-500';
		case 'disqualified':
			return 'border-l-4 border-l-red-500';
		default:
			return 'border-l-4 border-l-gray-400';
	}
}

export function getColumnHeaderColor(status: string): string {
	switch (status) {
		case 'new':
			return 'text-blue-700 dark:text-blue-400';
		case 'contacted':
			return 'text-yellow-700 dark:text-yellow-400';
		case 'qualified':
			return 'text-green-700 dark:text-green-400';
		case 'converted':
			return 'text-emerald-700 dark:text-emerald-400';
		case 'disqualified':
			return 'text-red-700 dark:text-red-400';
		default:
			return 'text-gray-700 dark:text-gray-400';
	}
}

export function formatLeadDate(date: Date | string | null): string {
	if (!date) return '-';
	const d = date instanceof Date ? date : new Date(date);
	return d.toLocaleDateString('ro-RO', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}
