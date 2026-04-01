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
	new: 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-200',
	contacted: 'bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-200',
	qualified: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-200',
	converted: 'bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-200',
	disqualified: 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-200'
};

export const LEAD_STATUS_DOT_COLORS: Record<LeadStatus, string> = {
	new: 'bg-blue-500',
	contacted: 'bg-violet-500',
	qualified: 'bg-amber-500',
	converted: 'bg-green-500',
	disqualified: 'bg-red-500'
};

export function getStatusBorderColor(status: string): string {
	switch (status) {
		case 'new':
			return 'border-l-4 border-l-blue-500';
		case 'contacted':
			return 'border-l-4 border-l-violet-500';
		case 'qualified':
			return 'border-l-4 border-l-amber-500';
		case 'converted':
			return 'border-l-4 border-l-green-500';
		case 'disqualified':
			return 'border-l-4 border-l-red-500';
		default:
			return 'border-l-4 border-l-gray-400';
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
